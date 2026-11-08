"""Customer-only indexing; never delays transactional delivery."""

import time

from django.core.management.base import BaseCommand
from django.db import close_old_connections

from exchange.search import backfill, process_index


class Command(BaseCommand):
    help = "Index imported documents with the configured private EmbeddingGemma 2 service."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")
        parser.add_argument("--retry-blocked", action="store_true")

    def handle(self, *args, **options):
        last_backfill = 0
        processed = 0
        retry_requested = options["retry_blocked"]
        while True:
            close_old_connections()
            if time.monotonic() - last_backfill > 60:
                backfill(retry=retry_requested)
                retry_requested = False
                last_backfill = time.monotonic()
            if process_index():
                processed += 1
            elif options["once"]:
                self.stdout.write(f"Processed {processed} search index jobs.")
                return
            else:
                time.sleep(2)
