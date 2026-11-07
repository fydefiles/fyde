"""Exercise real PostgreSQL row locks; SQLite's single-writer semantics are tested in normal journeys."""

import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest import skipUnless

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connection, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from exchange.models import Contact, Transfer, User
from exchange.policy import PolicyError, current_period
from exchange.storage import add_file, inspect_version
from exchange.transfers import create_transfer


@skipUnless(connection.vendor == "postgresql", "Real row-lock concurrency requires PostgreSQL")
class QuotaConcurrency(TransactionTestCase):
    databases = {"default", "company"}

    @override_settings(DEBUG=True, EMAIL_ADAPTER="local")
    def test_two_simultaneous_sends_cannot_take_the_last_quota_unit_twice(self):
        with tempfile.TemporaryDirectory() as directory, override_settings(MEDIA_ROOT=Path(directory)):
            owner = User.objects.create_user(
                username="race", email="race@example.test", email_verified=True, data_mode="fixture"
            )
            contact = Contact.objects.create(
                owner=owner, name="John", email="john@example.test", verified_at=timezone.now()
            )
            version = inspect_version(
                add_file(owner, SimpleUploadedFile("Resume.txt", b"Synthetic race fixture."))
            )
            period = current_period(owner)
            period.consumed = 9
            period.save(update_fields=["consumed"])
            barrier = threading.Barrier(2)

            def send():
                try:
                    barrier.wait(timeout=10)
                    create_transfer(User.objects.get(pk=owner.pk), version, contact, str(uuid.uuid4()))
                    return "reserved"
                except PolicyError as error:
                    return error.code
                finally:
                    connections.close_all()

            with ThreadPoolExecutor(max_workers=2) as pool:
                outcomes = list(pool.map(lambda _: send(), range(2)))
            self.assertCountEqual(outcomes, ["reserved", "quota_exceeded"])
            self.assertEqual(Transfer.objects.count(), 1)
            period.refresh_from_db()
            self.assertEqual(period.consumed + period.reserved, 10)
