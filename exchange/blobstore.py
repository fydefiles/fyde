"""Private original bytes. Authorization stays in the customer application."""

import hashlib
import secrets
import tempfile
from contextlib import contextmanager
from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from django.conf import settings

from .policy import PolicyError


def local_path(key):
    root = settings.MEDIA_ROOT.resolve()
    path = (root / key).resolve()
    if not path.is_relative_to(root) or path == root:
        raise PolicyError("invalid_storage_path", "The private file is unavailable.")
    return path


def client():
    return boto3.client(
        "s3",
        endpoint_url=settings.AWS_ENDPOINT_URL_S3,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY,
        region_name=settings.AWS_REGION,
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
            connect_timeout=5,
            read_timeout=30,
            retries={"max_attempts": 3, "mode": "standard"},
        ),
    )


def put(key, source, *, size, digest, mime):
    source.seek(0)
    try:
        if settings.FILE_STORAGE == "neon":
            client().put_object(
                Bucket=settings.NEON_STORAGE_BUCKET,
                Key=key,
                Body=source,
                ContentLength=size,
                ContentType=mime,
                CacheControl="private, no-store",
                Metadata={"sha256": digest},
            )
        else:
            path = local_path(key)
            path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            with path.open("xb") as target:
                path.chmod(0o600)
                while chunk := source.read(65536):
                    target.write(chunk)
    except (BotoCoreError, ClientError, OSError):
        raise PolicyError(
            "storage_unavailable", "Private storage is unavailable. Retry the upload."
        ) from None


def delete(key):
    try:
        if settings.FILE_STORAGE == "neon":
            client().delete_object(Bucket=settings.NEON_STORAGE_BUCKET, Key=key)
        else:
            local_path(key).unlink(missing_ok=True)
    except (BotoCoreError, ClientError, OSError):
        raise PolicyError("storage_unavailable", "File removal is pending. Fyde will retry it.") from None


def open_verified(version):
    """Check the whole immutable version before returning any bytes to a recipient."""
    target = tempfile.SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
    source = None
    try:
        if settings.FILE_STORAGE == "neon":
            result = client().get_object(Bucket=settings.NEON_STORAGE_BUCKET, Key=version.blob_key)
            source = result["Body"]
            if result["ContentLength"] != version.size:
                raise PolicyError("hash_mismatch", "Stored content failed its integrity check.")
        else:
            source = local_path(version.blob_key).open("rb")
        digest = hashlib.sha256()
        actual = 0
        while chunk := source.read(65536):
            actual += len(chunk)
            if actual > version.size:
                raise PolicyError("hash_mismatch", "Stored content failed its integrity check.")
            digest.update(chunk)
            target.write(chunk)
        if actual != version.size or not secrets.compare_digest(digest.hexdigest(), version.sha256):
            raise PolicyError("hash_mismatch", "Stored content failed its integrity check.")
        target.seek(0)
        return target
    except (BotoCoreError, ClientError, OSError):
        target.close()
        raise PolicyError(
            "storage_unavailable", "The private file is unavailable. Try again shortly."
        ) from None
    except Exception:
        target.close()
        raise
    finally:
        if source is not None:
            source.close()


@contextmanager
def materialize(version):
    """Give bounded parsers a private temporary path, including for remote objects."""
    if settings.FILE_STORAGE == "local":
        yield local_path(version.blob_key)
        return
    with open_verified(version) as source, tempfile.TemporaryDirectory(prefix="fyde-scan-") as directory:
        path = Path(directory) / "original"
        with path.open("xb") as target:
            path.chmod(0o600)
            while chunk := source.read(65536):
                target.write(chunk)
        yield path


def purge_deleted(limit=50):
    """Durably retry deletion; hidden versions stay inaccessible while storage is down."""
    from django.utils import timezone

    from .models import FileVersion

    removed = 0
    for version in FileVersion.objects.filter(state="deleted", blob_deleted_at=None)[:limit]:
        try:
            delete(version.blob_key)
        except PolicyError:
            continue
        FileVersion.objects.filter(pk=version.pk, state="deleted").update(blob_deleted_at=timezone.now())
        removed += 1
    return removed
