import hashlib
import json

from django.db import migrations


def snapshot_destinations(apps, schema_editor):
    Transfer = apps.get_model("exchange", "Transfer")
    Mail = apps.get_model("exchange", "Mail")
    alias = schema_editor.connection.alias
    for transfer in Transfer.objects.using(alias).filter(recipient_email="").select_related("version", "contact", "grant"):
        mail = Mail.objects.using(alias).filter(transfer_id=transfer.pk).first()
        if not mail:
            continue
        transfer.recipient_email = mail.destination
        transfer.endpoint_revision_snapshot = transfer.grant.endpoint_revision
        if transfer.contact.email.lower() == mail.destination.lower() and not transfer.revoked_at and not transfer.grant.revoked_at:
            values = [str(transfer.owner_id), str(transfer.version_id), transfer.version.sha256,
                str(transfer.contact_id), transfer.contact.email.lower(), str(transfer.contact.endpoint_revision),
                transfer.recipient_email.lower(), str(transfer.endpoint_revision_snapshot),
                str(transfer.grant_id), str(transfer.grant.revision), transfer.operation_id,
                transfer.expires_at.isoformat(), "email"]
            transfer.binding = hashlib.sha256(json.dumps(values, separators=(",", ":")).encode()).hexdigest()
        transfer.save(using=alias, update_fields=["recipient_email", "endpoint_revision_snapshot", "binding"])


class Migration(migrations.Migration):
    dependencies = [("exchange", "0002_transfer_endpoint_revision_snapshot_and_more")]
    operations = [migrations.RunPython(snapshot_destinations, migrations.RunPython.noop)]
