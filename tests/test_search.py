"""Imported-file search journeys. Provider vectors are synthetic; live model QA is separate."""

import io
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from pypdf import PdfWriter
from pypdf.generic import DictionaryObject, NameObject, DecodedStreamObject

from exchange.commands import resolve_command
from exchange.customer_access import issue_token
from exchange.models import Document, FileVersion, SearchIndex, SearchSegment, Transfer, User
from exchange.search import INDEX_FINGERPRINT, backfill, process_index
from exchange.storage import add_file, inspect_version
from inference.spec import DIMENSIONS, FINGERPRINT


@override_settings(
    AUTH_PROVIDER="local",
    FILE_STORAGE="local",
    EMAIL_ADAPTER="local",
    SCAN_ADAPTER="text_only",
    SEARCH_EMBEDDING_URL="http://127.0.0.1:8068",
    SEARCH_EMBEDDING_AUTH="none",
    SEARCH_MIN_SIMILARITY=0.60,
)
class ImportedFileSearchJourney(TestCase):
    databases = {"default", "company"}

    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        config = override_settings(MEDIA_ROOT=Path(folder.name))
        config.enable()
        self.addCleanup(config.disable)
        self.owner = User.objects.create_user(
            username="search-owner",
            email="search-owner@example.test",
            email_verified=True,
            password="Synthetic-search-728!",
            data_mode="fixture",
        )
        self.other = User.objects.create_user(username="other-search", email="other-search@example.test")
        _, self.key = issue_token(self.owner)
        _, self.other_key = issue_token(self.other)
        self.calls = []
        remote = patch("exchange.embeddings.httpx.post", side_effect=self.provider)
        self.remote = remote.start()
        self.addCleanup(remote.stop)

    def provider(self, url, **kwargs):
        body = kwargs["json"]
        self.calls.append(body)
        vectors = []
        for text in body["inputs"]:
            row = [0.0] * DIMENSIONS
            axis = 0 if any(word in text.lower() for word in ["remotely", "working from home"]) else 1
            row[axis] = 1.0
            vectors.append(row)
        return httpx.Response(
            200, json={"fingerprint": FINGERPRINT, "embeddings": vectors}, request=httpx.Request("POST", url)
        )

    def file(self, text, *, owner=None, name="upload-0239.txt", document=None):
        return inspect_version(
            add_file(
                owner or self.owner,
                SimpleUploadedFile(name, text.encode()),
                document_id=document.pk if document else None,
            )
        )

    def search(self, query, *, key=None):
        response = self.client.post(
            "/api/v1/files/search/",
            {"query": query},
            content_type="application/json",
            HTTP_AUTHORIZATION="Bearer " + (key or self.key),
        )
        self.assertEqual(response.status_code, 200)
        return response.json()

    def index_pending(self):
        while process_index():
            pass

    def delete(self, version):
        self.client.force_login(self.owner)
        response = self.client.post(
            reverse("document", args=[version.document_id]),
            {
                "action": "delete",
                "password": "Synthetic-search-728!",
            },
        )
        self.assertEqual(response.status_code, 302)

    def test_paraphrase_retrieves_current_owner_passages_without_changing_send_resolution(self):
        old = self.file("Old employees may work remotely.")
        current = self.file("Employees may work remotely two days each week.", document=old.document)
        old.document.current_version = current
        old.document.save(update_fields=["current_version"])
        self.file("Unrelated kitchen recipes.", name="recipes.txt")
        private = self.file("Other owner's employees may work remotely.", owner=self.other)
        self.index_pending()
        result = self.search("working from home")
        self.assertEqual(result["mode"], "hybrid")
        self.assertEqual([f["id"] for f in result["files"]], [str(current.pk)])
        self.assertIn("remotely", result["files"][0]["match"]["excerpt"])
        self.assertEqual(
            [f["id"] for f in self.search("working from home", key=self.other_key)["files"]],
            [str(private.pk)],
        )
        self.assertEqual(resolve_command(self.owner, "Send working from home to Sam")["action"], "clarify")
        self.assertEqual(Transfer.objects.count(), 0)

    def test_indexing_and_inference_outage_keep_literal_search_available(self):
        version = self.file("Invoice reference CEDAR-781.")
        self.assertEqual(self.search("CEDAR-781")["semantic_status"], "indexing")
        self.index_pending()
        self.remote.side_effect = httpx.ReadTimeout("synthetic timeout")
        result = self.search("CEDAR-781")
        self.assertEqual(result["semantic_status"], "unavailable")
        self.assertEqual([f["id"] for f in result["files"]], [str(version.pk)])
        with override_settings(SEARCH_EMBEDDING_URL=""):
            self.assertEqual(self.search("CEDAR-781")["semantic_status"], "disabled")
        self.assertEqual(Transfer.objects.count(), 0)

    def test_pdf_pages_survive_extraction_and_multiple_passages_return_one_file(self):
        writer = PdfWriter()
        for text in ["Office policy cover", "Employees may work remotely two days each week."]:
            page = writer.add_blank_page(width=612, height=792)
            font = DictionaryObject(
                {
                    NameObject("/Type"): NameObject("/Font"),
                    NameObject("/Subtype"): NameObject("/Type1"),
                    NameObject("/BaseFont"): NameObject("/Helvetica"),
                }
            )
            page[NameObject("/Resources")] = DictionaryObject(
                {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
            )
            stream = DecodedStreamObject()
            stream.set_data(f"BT /F1 12 Tf 50 700 Td ({text}) Tj ET".encode())
            page[NameObject("/Contents")] = writer._add_object(stream)
        output = io.BytesIO()
        writer.write(output)
        with override_settings(SCAN_ADAPTER="clamav"), patch("exchange.storage.clamav_scan"):
            version = inspect_version(
                add_file(self.owner, SimpleUploadedFile("office.pdf", output.getvalue()))
            )
        self.assertEqual(version.state, "ready")
        self.index_pending()
        result = self.search("working from home")
        self.assertEqual(len(result["files"]), 1)
        self.assertEqual(result["files"][0]["match"]["page"], 2)
        self.assertIn("remotely", result["files"][0]["match"]["excerpt"])
        indexed = SearchSegment.objects.filter(version=version).count()
        self.assertEqual(backfill(), 0)
        self.assertFalse(process_index())
        self.assertEqual(SearchSegment.objects.filter(version=version).count(), indexed)

    def test_deletion_during_indexing_cannot_recreate_searchable_text(self):
        version = self.file("Employees may work remotely.")
        original_provider = self.provider

        def deleting_provider(url, **kwargs):
            self.delete(version)
            return original_provider(url, **kwargs)

        self.remote.side_effect = deleting_provider
        self.assertTrue(process_index())
        self.assertFalse(SearchSegment.objects.filter(version=version).exists())
        self.assertFalse(SearchIndex.objects.filter(version=version).exists())
        self.assertEqual(backfill(), 0)
        self.assertEqual(self.search("working from home")["files"], [])

    def test_deletion_during_query_removes_previously_retrieved_candidates_and_vectors(self):
        version = self.file("Employees may work remotely.")
        self.index_pending()
        original_provider = self.provider

        def deleting_provider(url, **kwargs):
            self.delete(version)
            return original_provider(url, **kwargs)

        self.remote.side_effect = deleting_provider
        self.assertEqual(self.search("remotely")["files"], [])
        self.assertFalse(SearchSegment.objects.filter(version=version).exists())

    def test_invalid_or_incompatible_embeddings_retry_without_publishing_an_index(self):
        version = self.file("Employees may work remotely.")
        for response in [
            {"fingerprint": "different-model", "embeddings": [[1.0] * DIMENSIONS]},
            {"fingerprint": FINGERPRINT, "embeddings": [[1.0]]},
            {"fingerprint": FINGERPRINT, "embeddings": [[0.0] * DIMENSIONS]},
        ]:
            self.remote.side_effect = lambda url, **kwargs: httpx.Response(
                200, json=response, request=httpx.Request("POST", url)
            )
            SearchIndex.objects.filter(version=version).update(available_at=timezone.now())
            self.assertTrue(process_index())
            self.assertFalse(SearchSegment.objects.filter(version=version).exists())
            self.assertEqual(SearchIndex.objects.get(version=version).state, "retry")
            self.assertFalse(process_index())
        self.remote.side_effect = self.provider
        SearchIndex.objects.filter(version=version).update(
            state="running", lease_until=timezone.now() - timedelta(seconds=1)
        )
        self.assertTrue(process_index())
        self.assertEqual(SearchIndex.objects.get(version=version).state, "indexed")
        SearchSegment.objects.filter(version=version).update(fingerprint="old-embedding-space")
        self.calls.clear()
        self.assertEqual(self.search("working from home")["files"], [])
        self.assertEqual(self.calls, [])

    def test_literal_retrieval_has_no_first_thousand_files_cutoff(self):
        documents = [Document(owner=self.owner, title=f"Synthetic {i}") for i in range(1002)]
        Document.objects.bulk_create(documents)
        versions = [
            FileVersion(
                document=document,
                number=1,
                original_name=f"{i}.txt",
                blob_key=uuid.uuid4().hex,
                sha256="0" * 64,
                size=20,
                mime="text/plain",
                state="ready",
                extracted_text="CEDAR-781" if i == 1001 else "Unrelated synthetic text",
            )
            for i, document in enumerate(documents)
        ]
        FileVersion.objects.bulk_create(versions)
        for document, version in zip(documents, versions, strict=True):
            document.current_version = version
        Document.objects.bulk_update(documents, ["current_version"])
        self.assertEqual([f["id"] for f in self.search("CEDAR-781")["files"]], [str(versions[-1].pk)])
        self.assertFalse(SearchSegment.objects.exists())

    def test_another_owner_with_no_files_does_not_trigger_query_inference(self):
        self.file("Employees may work remotely.")
        self.index_pending()
        self.calls.clear()
        self.assertEqual(self.search("working from home", key=self.other_key)["files"], [])
        self.assertEqual(self.calls, [])
        self.assertEqual(SearchSegment.objects.get().fingerprint, INDEX_FINGERPRINT)
