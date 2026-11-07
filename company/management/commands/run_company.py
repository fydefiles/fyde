import time
from django.core.management.base import BaseCommand
from company.worker import tick


class Command(BaseCommand):
    help = "Run durable company jobs. Supply only company-plane and scoped provider credentials."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")
        parser.add_argument("--release-worker", action="store_true")

    def handle(self, *args, **options):
        while True:
            count = tick(release_worker=options["release_worker"])
            if options["once"]:
                self.stdout.write(f"Processed {count} company jobs.")
                return
            time.sleep(5)
