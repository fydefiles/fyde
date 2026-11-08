"""Check the configured live services without printing connection strings or credentials."""

import hashlib
import io
import uuid
from types import SimpleNamespace

import httpx
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from exchange import blobstore, neon_auth


class Command(BaseCommand):
    help = "Verify Neon database, Auth and private storage. --write-probe tests synthetic bytes and cleanup."

    def add_arguments(self, parser):
        parser.add_argument("--write-probe", action="store_true")

    def handle(self, *args, **options):
        if settings.FILE_STORAGE != "neon" or not neon_auth.enabled():
            raise CommandError("Configure FILE_STORAGE=neon and AUTH_PROVIDER=neon first.")
        for alias in ("default", "company"):
            db = connections[alias]
            if db.vendor != "postgresql":
                raise CommandError(f"{alias}: configure its independent Neon Postgres connection.")
            with db.cursor() as cursor:
                cursor.execute("SELECT 1")
                cursor.fetchone()
            self.stdout.write(f"{alias}: PostgreSQL reachable")
        if connections["default"].settings_dict["HOST"] == connections["company"].settings_dict["HOST"]:
            raise CommandError("Customer and company runtime must use their separate Neon projects.")
        response, payload = neon_auth.call("get-session")
        if payload is not None:
            raise CommandError("Auth unexpectedly returned an anonymous session.")
        self.stdout.write(f"Auth: reachable ({response.status_code}); anonymous access has no session")
        blobstore.client().head_bucket(Bucket=settings.NEON_STORAGE_BUCKET)
        self.stdout.write("Storage: private bucket reachable with the scoped credential")
        if not options["write_probe"]:
            return
        raw = b"Fyde synthetic private-storage probe. No customer content.\n"
        key = "healthchecks/" + uuid.uuid4().hex
        digest = hashlib.sha256(raw).hexdigest()
        try:
            blobstore.put(key, io.BytesIO(raw), size=len(raw), digest=digest, mime="text/plain")
            with blobstore.open_verified(
                SimpleNamespace(blob_key=key, size=len(raw), sha256=digest)
            ) as source:
                if source.read() != raw:
                    raise CommandError("The storage probe returned different bytes.")
            url = f"{settings.AWS_ENDPOINT_URL_S3.rstrip('/')}/{settings.NEON_STORAGE_BUCKET}/{key}"
            anonymous = httpx.get(url, timeout=15)
            if anonymous.status_code not in (401, 403, 404):
                raise CommandError("Anonymous object access was not denied. Check the bucket visibility.")
            self.stdout.write("Storage probe: upload, verified download and anonymous-access denial passed")
        finally:
            blobstore.delete(key)
        self.stdout.write("Storage probe: synthetic object removed")
