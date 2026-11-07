import time
from django.core.management.base import BaseCommand
from exchange.bridge import tick


class Command(BaseCommand):
    help = "Trusted customer/company bridge: opted-in feedback, aggregates, and scoped notifications only."

    def add_arguments(self, parser):
        parser.add_argument("--once", action="store_true")

    def handle(self, *args, **options):
        while True:
            count = tick()
            if options["once"]:
                self.stdout.write(f"Exported {count} feedback records.")
                return
            time.sleep(5)
