import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone

DOCUMENT_TYPES = [
    ("general", "General"),
    ("passport", "Passport"),
    ("visa", "Visa / immigration"),
    ("identity", "Identity"),
    ("financial", "Financial"),
    ("legal", "Legal"),
    ("correspondence", "Correspondence"),
    ("other", "Other"),
]

DELIVERY_CHANNELS = [("in_app", "Fyde"), ("email", "Email"), ("phone", "Phone (SMS)")]


class User(AbstractUser):
    email = models.EmailField(unique=True)
    email_verified = models.BooleanField(default=False)
    sharing_paused = models.BooleanField(default=False)
    data_mode = models.CharField(max_length=12, default="live")
    notifications_enabled = models.BooleanField(default=True)
    onboarding_completed_at = models.DateTimeField(null=True, blank=True)
    chat_context_enabled = models.BooleanField(default=True)
    default_delivery_channel = models.CharField(max_length=20, choices=DELIVERY_CHANNELS, default="in_app")
    phone = models.CharField(max_length=16, blank=True)
    phone_verified_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        verbose_name = "user"
        verbose_name_plural = "users"
        abstract = False
        constraints = [
            models.UniqueConstraint(
                fields=["phone"], condition=~models.Q(phone=""), name="unique_account_phone"
            )
        ]


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        abstract = True


class Contact(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=16, blank=True)
    phone_verified_at = models.DateTimeField(null=True, blank=True)
    relationship = models.CharField(max_length=80, blank=True)
    aliases = models.CharField(max_length=250, blank=True)
    endpoint_revision = models.PositiveIntegerField(default=1)
    verified_at = models.DateTimeField(null=True, blank=True)
    paused = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["owner", "email"], condition=~models.Q(email=""), name="contact_owner_email"
            ),
            models.UniqueConstraint(
                fields=["owner", "phone"], condition=~models.Q(phone=""), name="contact_owner_phone"
            ),
        ]

    def __str__(self):
        return self.name


class Document(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    title = models.CharField(max_length=180)
    tags = models.CharField(max_length=250, blank=True)
    sensitive = models.BooleanField(default=False)
    matter = models.ForeignKey(
        "Matter", null=True, blank=True, on_delete=models.PROTECT, related_name="documents"
    )
    document_type = models.CharField(max_length=30, choices=DOCUMENT_TYPES, default="general")
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
    standing_policy = models.ForeignKey(
        "StandingPolicy", null=True, blank=True, on_delete=models.PROTECT, related_name="grants"
    )
    policy_revision = models.PositiveIntegerField(default=0)
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
    channel = models.CharField(max_length=20, choices=DELIVERY_CHANNELS, default="in_app")
    identity_kind = models.CharField(max_length=10, default="email")


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
    recipient_phone = models.CharField(max_length=16, blank=True)
    channel = models.CharField(max_length=20, choices=DELIVERY_CHANNELS, default="in_app")
    binding_version = models.PositiveSmallIntegerField(default=3)
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
    destination = models.CharField(max_length=254)
    channel = models.CharField(max_length=10, default="email", choices=[("email", "Email"), ("phone", "SMS")])
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


class PhoneBudget(Record):
    date = models.DateField(unique=True)
    reserved_count = models.PositiveIntegerField(default=0)
    reserved_usd = models.DecimalField(max_digits=12, decimal_places=6, default=0)


class Challenge(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    contact = models.ForeignKey(Contact, null=True, blank=True, on_delete=models.CASCADE)
    transfer = models.ForeignKey(Transfer, null=True, blank=True, on_delete=models.CASCADE)
    scope = models.CharField(max_length=20)
    channel = models.CharField(max_length=10, default="email")
    destination = models.CharField(max_length=254, blank=True)
    data_mode = models.CharField(max_length=12, default="live")
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


class InboxItem(Record):
    recipient = models.ForeignKey(User, on_delete=models.PROTECT, related_name="received_files")
    transfer = models.OneToOneField(Transfer, on_delete=models.CASCADE, related_name="inbox_item")


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


class Matter(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=120)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "name"], name="owner_matter_name")]


class StandingPolicy(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE, related_name="case_permissions")
    contact = models.ForeignKey(Contact, on_delete=models.PROTECT)
    recipient = models.ForeignKey(User, on_delete=models.PROTECT, related_name="received_case_permissions")
    matter = models.ForeignKey(Matter, on_delete=models.PROTECT)
    operation_id = models.CharField(max_length=100)
    endpoint_revision = models.PositiveIntegerField()
    identity_kind = models.CharField(max_length=10)
    channel = models.CharField(max_length=20, choices=DELIVERY_CHANNELS, default="in_app")
    data_mode = models.CharField(max_length=12)
    document_types = models.JSONField(default=list)
    # Explicit owner-selected snapshots; later classifications never expand a snapshot permission.
    initial_versions = models.JSONField(default=dict)
    include_future_files = models.BooleanField(default=False)
    include_future_versions = models.BooleanField(default=False)
    include_sensitive = models.BooleanField(default=False)
    expires_at = models.DateTimeField()
    max_requests = models.PositiveIntegerField(default=100)
    requests_used = models.PositiveIntegerField(default=0)
    revision = models.PositiveIntegerField(default=1)
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["owner", "operation_id"], name="owner_case_permission_operation")
        ]


class CustomerToken(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    kind = models.CharField(
        max_length=10, choices=[("device", "Mobile device"), ("agent", "Recipient agent")]
    )
    name = models.CharField(max_length=80)
    token_hash = models.CharField(max_length=64, unique=True)
    policy = models.ForeignKey(StandingPolicy, null=True, blank=True, on_delete=models.PROTECT)
    policy_revision = models.PositiveIntegerField(default=0)
    data_mode = models.CharField(max_length=12)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(kind="device", policy__isnull=True)
                    | models.Q(kind="agent", policy__isnull=False)
                ),
                name="customer_token_scope",
            )
        ]


class CaseRequest(Record):
    requester = models.ForeignKey(User, on_delete=models.PROTECT)
    policy = models.ForeignKey(StandingPolicy, on_delete=models.PROTECT)
    operation_id = models.CharField(max_length=100)
    input_hash = models.CharField(max_length=64)
    result = models.JSONField(default=dict)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["requester", "operation_id"], name="requester_case_operation")
        ]


class ChatExchange(Record):
    owner = models.ForeignKey(User, on_delete=models.CASCADE)
    operation_id = models.CharField(max_length=100)
    input_hash = models.CharField(max_length=64)
    message = models.CharField(max_length=2000)
    reply = models.TextField()
    result = models.JSONField(default=dict)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["owner", "operation_id"], name="owner_chat_operation")]
