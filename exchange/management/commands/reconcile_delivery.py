from django.core.management.base import BaseCommand
from exchange.delivery import reconcile_transfer
from exchange.models import Transfer


class Command(BaseCommand):
    help = "Reconcile provider-accepted transfer delivery without resending or double-counting."

    def add_arguments(self, parser):
        parser.add_argument("transfer_id", nargs="?")

    def handle(self, *args, **options):
        query = Transfer.objects.filter(data_mode="live", status="provider_accepted")
        if options["transfer_id"]:
            query = query.filter(pk=options["transfer_id"])
        for transfer in query.order_by("accepted_at")[:10]:
            try:
                observed = reconcile_transfer(transfer)
                self.stdout.write(f"{transfer.pk}: {observed}")
            except Exception as error:
                self.stderr.write(f"{transfer.pk}: reconciliation blocked ({type(error).__name__})")
