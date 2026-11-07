import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class User(AbstractUser):
    email = models.EmailField(unique=True)
    email_verified = models.BooleanField(default=False)
    sharing_paused = models.BooleanField(default=False)
    data_mode = models.CharField(max_length=12, default="live")
    notifications_enabled = models.BooleanField(default=True)


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        abstract = True


class Contact(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    email = models.EmailField()
    aliases = models.CharField(max_length=250, blank=True)
    endpoint_revision = models.PositiveIntegerField(default=1)
    verified_at = models.DateTimeField(null=True, blank=True)
    paused = models.BooleanField(default=False)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "email"], name="contact_owner_email")]

    def __str__(self):
        return self.name


class Document(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=180)
    tags = models.CharField(max_length=250, blank=True)
    sensitive = models.BooleanField(default=False)
    current_version = models.ForeignKey(
        "FileVersion", null=True, blank=True, on_delete=models.SET_NULL, related_name="current_for"
    )
    deleted_at = models.DateTimeField(null=True, blank=True)


class FileVersion(Record):
    document = models.ForeignKey(Document, on_delete=models.CASCADE, related_name="versions")
    number = models.PositiveIntegerField()
    original_name = models.CharField(max_length=180)
    blob_key = models.CharField(max_length=180, unique=True)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveBigIntegerField()
    mime = models.CharField(max_length=100)
    state = models.CharField(max_length=30, default="quarantined")
    extraction_state = models.CharField(max_length=30, default="pending")
    extracted_text = models.TextField(blank=True)
    check_detail = models.CharField(max_length=250, blank=True)
    source = models.CharField(max_length=30, default="upload")

    class Meta:
        constraints = [models.UniqueConstraint(fields=["document", "number"], name="document_version")]


class Grant(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE)
    version = models.ForeignKey(FileVersion, on_delete=models.CASCADE)
    endpoint_revision = models.PositiveIntegerField()
    revision = models.PositiveIntegerField(default=1)
    kind = models.CharField(max_length=15, default="once")
    purpose = models.CharField(max_length=150, blank=True)
    sensitive_authorized = models.BooleanField(default=False)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    max_requests = models.PositiveIntegerField(default=1)
    requests_used = models.PositiveIntegerField(default=0)
    channel = models.CharField(max_length=20, default="email")


class Subscription(Record):
    owner = models.OneToOneField(User, on_delete=models.CASCADE)
    plan = models.CharField(max_length=30, default="free")
    plan_version = models.CharField(max_length=30, default="2026-11-07")
    status = models.CharField(max_length=30, default="free")
    provider_customer_id = models.CharField(max_length=100, blank=True)
    provider_subscription_id = models.CharField(max_length=100, blank=True)
    period_start = models.DateTimeField(null=True, blank=True)
    period_end = models.DateTimeField(null=True, blank=True)
    cancel_at_period_end = models.BooleanField(default=False)
    data_mode = models.CharField(max_length=12, default="sandbox")


class UsagePeriod(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    starts_at = models.DateTimeField()
    ends_at = models.DateTimeField()
    reserved = models.PositiveIntegerField(default=0)
    consumed = models.PositiveIntegerField(default=0)
    bandwidth_reserved = models.PositiveBigIntegerField(default=0)
    bandwidth_used = models.PositiveBigIntegerField(default=0)
    data_mode = models.CharField(max_length=12, default="live")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner", "starts_at", "data_mode"], name="owner_usage_period")
        ]


class Transfer(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE)
    version = models.ForeignKey(FileVersion, on_delete=models.CASCADE)
    grant = models.ForeignKey(Grant, on_delete=models.CASCADE)
    operation_id = models.CharField(max_length=100)
    recipient_email = models.EmailField(default="")
    endpoint_revision_snapshot = models.PositiveIntegerField(default=1)
    binding = models.CharField(max_length=64)
    status = models.CharField(max_length=40, default="queued")
    data_mode = models.CharField(max_length=12)
    expires_at = models.DateTimeField()
    usage_period = models.ForeignKey(UsagePeriod, on_delete=models.PROTECT)
    quota_state = models.CharField(max_length=15, default="reserved")
    provider_id = models.CharField(max_length=100, blank=True)
    accepted_at = models.DateTimeField(null=True, blank=True)
    accessed_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    failure_code = models.CharField(max_length=80, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner", "operation_id"], name="owner_transfer_operation")
        ]


class UsageEntry(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    transfer = models.ForeignKey(Transfer, on_delete=models.CASCADE)
    kind = models.CharField(max_length=20)
    units = models.IntegerField()
    data_mode = models.CharField(max_length=12)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["transfer", "kind"], name="transfer_ledger_event")]


class Mail(Record):
    owner = models.ForeignKey(User, null=True, on_delete=models.CASCADE)
    transfer = models.OneToOneField(Transfer, null=True, blank=True, on_delete=models.CASCADE)
    destination = models.EmailField()
    subject = models.CharField(max_length=200)
    body = models.TextField()
    idempotency_key = models.CharField(max_length=150, unique=True)
    status = models.CharField(max_length=30, default="queued")
    data_mode = models.CharField(max_length=12)
    provider_id = models.CharField(max_length=100, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    first_attempt_at = models.DateTimeField(null=True, blank=True)
    next_attempt_at = models.DateTimeField(default=timezone.now)
    lease_until = models.DateTimeField(null=True, blank=True)
    failure_code = models.CharField(max_length=80, blank=True)
    cost_usd = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    budget_reserved = models.BooleanField(default=False)


class EmailBudget(Record):
    date = models.DateField(unique=True)
    reserved_count = models.PositiveIntegerField(default=0)
    reserved_usd = models.DecimalField(max_digits=12, decimal_places=6, default=0)


class Challenge(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    contact = models.ForeignKey(Contact, null=True, blank=True, on_delete=models.CASCADE)
    transfer = models.ForeignKey(Transfer, null=True, blank=True, on_delete=models.CASCADE)
    scope = models.CharField(max_length=20)
    token_hash = models.CharField(max_length=64)
    code_hash = models.CharField(max_length=128)
    endpoint_revision = models.PositiveIntegerField(default=0)
    attempts = models.PositiveIntegerField(default=0)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)


class AuditEvent(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    event_type = models.CharField(max_length=80)
    trace_id = models.UUIDField(default=uuid.uuid4)
    object_id = models.CharField(max_length=100, blank=True)
    decision = models.CharField(max_length=40, blank=True)
    data_mode = models.CharField(max_length=12, default="live")
    # Deliberately exclude filenames, email addresses, URLs, commands and document text.
    detail = models.JSONField(default=dict)
    schema_version = models.PositiveSmallIntegerField(default=1)


class IncomingRequest(Record):
    contact = models.ForeignKey(Contact, on_delete=models.CASCADE)
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    operation_id = models.CharField(max_length=100)
    purpose = models.CharField(max_length=150)
    outcomes = models.JSONField(default=list)
    status = models.CharField(max_length=30, default="received")

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["contact", "operation_id"], name="contact_request_operation")
        ]


class BillingEvent(Record):
    provider_event_id = models.CharField(max_length=100, unique=True)
    kind = models.CharField(max_length=100)
    status = models.CharField(max_length=20, default="received")
    data_mode = models.CharField(max_length=12)
    object_id = models.CharField(max_length=100)
    occurred_at = models.DateTimeField()


class RateLimit(models.Model):
    key = models.CharField(max_length=150, primary_key=True)
    window = models.DateTimeField()
    count = models.PositiveIntegerField(default=0)


class Notification(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    external_id = models.CharField(max_length=100, unique=True)
    body = models.CharField(max_length=500)
    link = models.CharField(max_length=250, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)


class FeedbackBridge(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=140)
    body = models.TextField()
    visibility = models.CharField(max_length=15)
    exported_at = models.DateTimeField(null=True, blank=True)
    last_notified_state = models.CharField(max_length=40, blank=True)


class ProductMetric(Record):
    owner = models.ForeignKey(User, null=True, on_delete=models.SET_NULL)
    kind = models.CharField(max_length=60)
    campaign = models.CharField(max_length=100, blank=True)
    feature = models.CharField(max_length=80, blank=True)
    data_mode = models.CharField(max_length=12)


class CheckoutAttempt(Record):
    owner = models.OneToOneField(User, on_delete=models.CASCADE)
    plan = models.CharField(max_length=30)
    provider_id = models.CharField(max_length=100, blank=True)
    url = models.URLField(max_length=1500, blank=True)
    status = models.CharField(max_length=30, default="preparing")
    data_mode = models.CharField(max_length=12)
