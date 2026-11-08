import hashlib

from botocore.exceptions import ClientError
from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.test.utils import override_settings

from exchange import blobstore
from exchange.models import FileVersion


class Command(BaseCommand):
    help = "Validate and copy the current database's local originals to Neon, preserving their keys. Defaults to dry run."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        if not all(
            (settings.AWS_ENDPOINT_URL_S3, settings.AWS_ACCESS_KEY_ID, settings.AWS_SECRET_ACCESS_KEY)
        ):
            raise CommandError("Configure the scoped Neon storage credential first.")
        copied = total = 0
        for version in (
            FileVersion.objects.filter(document__deleted_at=None).exclude(state="deleted").iterator()
        ):
            path = blobstore.local_path(version.blob_key)
            digest = hashlib.sha256()
            try:
                with path.open("rb") as source:
                    while chunk := source.read(65536):
                        digest.update(chunk)
                    if path.stat().st_size != version.size or digest.hexdigest() != version.sha256:
                        raise CommandError(
                            "A local original failed its recorded size or hash check. Copy stopped."
                        )
                    if options["apply"]:
                        with override_settings(FILE_STORAGE="neon"):
                            try:
                                blobstore.client().head_object(
                                    Bucket=settings.NEON_STORAGE_BUCKET, Key=version.blob_key
                                )
                            except ClientError as error:
                                if str(error.response.get("Error", {}).get("Code")) not in (
                                    "404",
                                    "NoSuchKey",
                                    "NotFound",
                                ):
                                    raise
                                blobstore.put(
                                    version.blob_key,
                                    source,
                                    size=version.size,
                                    digest=version.sha256,
                                    mime=version.mime,
                                )
                            # Existing keys are verified, never overwritten by this command.
                            with blobstore.open_verified(version):
                                pass
                        copied += 1
            except FileNotFoundError:
                raise CommandError(
                    "A local original is missing. Copy stopped without removing any originals."
                ) from None
            total += 1
        self.stdout.write(
            f"Validated {total} local versions. Copied or verified {copied} remote versions. Local originals retained."
        )
