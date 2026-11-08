import time
from django.core.management.base import BaseCommand
from exchange.delivery import deliver_pending
from exchange.models import FileVersion
from exchange.storage import inspect_version
from exchange.blobstore import purge_deleted


class Command(BaseCommand):
    help = "Process customer file checks and transactional email/SMS. Run separately from company agents."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        while True:
            for version in FileVersion.objects.filter(state="quarantined", extraction_state="pending")[:10]:
                inspect_version(version)
            count = deliver_pending()
            purge_deleted()
            if options["once"]:
                self.stdout.write(f"Processed {count} delivery jobs.")
                return
            time.sleep(2)
