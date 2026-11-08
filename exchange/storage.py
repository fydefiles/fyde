import hashlib
import json
import os
import re
import socket
import struct
import tempfile
import uuid
from pathlib import Path

from django.conf import settings
from django.db import transaction
from django.db.models import Sum

from .models import Document, FileVersion, User
from .policy import PolicyError, audit, entitlement
from . import blobstore

ALLOWED = {
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def blob_path(version):
    return blobstore.local_path(version.blob_key)


def add_file(owner, upload, *, title="", tags="", sensitive=False, document_id=None):
    name = Path(upload.name.replace("\\", "/")).name[:180]
    extension = Path(name).suffix.lower()
    if extension not in ALLOWED:
        raise PolicyError("unsupported_type", "Upload a TXT, Markdown, CSV, PDF, or DOCX file.")
    _, plan, _ = entitlement(owner)
    if upload.size == 0 or upload.size > plan["file_mib"] * 1024 * 1024:
        raise PolicyError("file_size_limit", f"Files must be between 1 byte and {plan['file_mib']} MiB.")
    key = f"{owner.pk}/{uuid.uuid4().hex}"
    digest = hashlib.sha256()
    actual = 0
    uploaded = False
    try:
        with tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b") as target:
            for chunk in upload.chunks():
                actual += len(chunk)
                if actual > plan["file_mib"] * 1024 * 1024:
                    raise PolicyError("file_size_limit", "The file exceeds the upload limit.")
                digest.update(chunk)
                target.write(chunk)
            blobstore.put(key, target, size=actual, digest=digest.hexdigest(), mime=ALLOWED[extension])
            uploaded = True
        with transaction.atomic():
            User.objects.select_for_update().get(pk=owner.pk)
            used = (
                FileVersion.objects.filter(document__owner=owner, document__deleted_at=None).aggregate(
                    n=Sum("size")
                )["n"]
                or 0
            )
            if used + actual > plan["storage_mib"] * 1024 * 1024:
                raise PolicyError(
                    "storage_limit", "Your storage allowance is full. Export or delete files first."
                )
            if document_id:
                try:
                    document = Document.objects.select_for_update().get(
                        pk=document_id, owner=owner, deleted_at=None
                    )
                except (Document.DoesNotExist, ValueError):
                    raise PolicyError("not_found", "The document is unavailable.") from None
            else:
                document = Document.objects.create(
                    owner=owner, title=title[:180] or name, tags=tags[:250], sensitive=sensitive
                )
            number = document.versions.count() + 1
            version = FileVersion.objects.create(
                document=document,
                number=number,
                original_name=name,
                blob_key=key,
                sha256=digest.hexdigest(),
                size=actual,
                mime=ALLOWED[extension],
            )
            if not document.current_version_id:
                document.current_version = version
                document.save(update_fields=["current_version"])
            audit(owner, "file.uploaded", version.pk, "quarantined")
        return version
    except Exception:
        if uploaded:
            try:
                blobstore.delete(key)
            except PolicyError:
                pass
        raise


def clamav_scan(path):
    if not settings.CLAMAV_HOST:
        raise PolicyError("scanner_not_configured", "PDF and DOCX need a configured malware scanner.")
    with socket.create_connection((settings.CLAMAV_HOST, settings.CLAMAV_PORT), timeout=15) as client:
        client.sendall(b"zINSTREAM\x00")
        with path.open("rb") as source:
            while chunk := source.read(65536):
                client.sendall(struct.pack("!I", len(chunk)) + chunk)
        client.sendall(struct.pack("!I", 0))
        result = client.recv(4096)
    if b"stream: OK" not in result:
        raise PolicyError("scan_failed", "The malware scanner did not approve this file.")


def inspect_version(version):
    """Only the customer worker reads uploads. This never runs in a business agent."""
    try:
        with blobstore.materialize(version) as path:
            return inspect_local_version(version, path)
    except PolicyError as error:
        # A temporary network failure can be retried by the worker.
        if error.code == "storage_unavailable":
            return version
        version.extraction_state = "blocked"
        version.check_detail = str(error)[:250]
        version.save(update_fields=["extraction_state", "check_detail"])
        return version


def inspect_local_version(version, path):
    import subprocess
    import sys

    pages = []
    try:
        raw = path.read_bytes()
        if hashlib.sha256(raw).hexdigest() != version.sha256:
            raise PolicyError("hash_mismatch", "Stored content failed its integrity check.")
        if version.mime.startswith("text/"):
            text = raw.decode("utf-8-sig")
            if "\x00" in text or re.search(r"[\x01-\x08\x0b\x0c\x0e-\x1f]", text):
                raise PolicyError(
                    "invalid_text", "Only inert UTF-8 text is accepted by the text-only scanner."
                )
            if settings.SCAN_ADAPTER == "clamav":
                clamav_scan(path)
            elif settings.SCAN_ADAPTER != "text_only":
                raise PolicyError("scanner_disabled", "File checking is disabled.")
            text = text[:250000]
        else:
            if settings.SCAN_ADAPTER != "clamav":
                raise PolicyError(
                    "scanner_not_configured", "PDF and DOCX remain quarantined until ClamAV is configured."
                )
            if version.mime == "application/pdf" and not raw.startswith(b"%PDF-"):
                raise PolicyError("mime_mismatch", "This file does not match its PDF extension.")
            if "wordprocessingml" in version.mime and not raw.startswith(b"PK\x03\x04"):
                raise PolicyError("mime_mismatch", "This file does not match its DOCX extension.")
            clamav_scan(path)
            result = subprocess.run(
                [sys.executable, str(settings.BASE_DIR / "exchange/extract.py"), str(path), version.mime],
                capture_output=True,
                text=True,
                timeout=20,
                env={"PATH": os.defpath},
            )
            if result.returncode:
                raise PolicyError("extraction_failed", "Extraction failed. The file remains quarantined.")
            extracted = json.loads(result.stdout)
            text = extracted["text"][:250000]
            pages = extracted["pages"]
            if not text.strip():
                raise PolicyError("no_extractable_text", "No readable text was found. OCR is not configured.")
        version.state = "ready"
        version.extraction_state = "indexed"
        version.extracted_text = text
        version.check_detail = (
            "UTF-8 text validation"
            if settings.SCAN_ADAPTER == "text_only"
            else "ClamAV and bounded extraction"
        )
    except (PolicyError, UnicodeError, OSError, subprocess.SubprocessError, ValueError, KeyError) as error:
        version.state = "quarantined"
        version.extraction_state = "blocked"
        version.check_detail = (
            str(error)[:250]
            if isinstance(error, PolicyError)
            else "File checks failed; manual review required."
        )
    updated = FileVersion.objects.filter(
        pk=version.pk, document__deleted_at=None, state="quarantined"
    ).update(
        state=version.state,
        extraction_state=version.extraction_state,
        extracted_text=version.extracted_text,
        page_offsets=pages,
        check_detail=version.check_detail,
    )
    if not updated:
        version.refresh_from_db()
        return version
    audit(version.document.owner, "file.indexed", version.pk, version.state)
    if version.state == "ready":
        from .search import enqueue_index

        enqueue_index(version)
    return version
