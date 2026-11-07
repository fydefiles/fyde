import uuid
from django.db import models
from django.utils import timezone


class Record(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        abstract = True


class Control(models.Model):
    key = models.CharField(max_length=60, primary_key=True)
    value = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)


class Feedback(Record):
    title = models.CharField(max_length=140)
    body = models.TextField()
    visibility = models.CharField(max_length=15, default="private")
    source = models.CharField(max_length=30, default="in_app")
    source_id = models.CharField(max_length=200, unique=True)
    data_mode = models.CharField(max_length=12, default="live")
    consent_at = models.DateTimeField(default=timezone.now)
    category = models.CharField(max_length=30, default="untriaged")
    cluster_key = models.CharField(max_length=64, blank=True)
    status = models.CharField(max_length=30, default="received")
    work_item = models.ForeignKey("WorkItem", null=True, blank=True, on_delete=models.SET_NULL)


class WorkItem(Record):
    title = models.CharField(max_length=180)
    specification = models.JSONField(default=dict)
    acceptance = models.JSONField(default=list)
    priority = models.IntegerField(default=0)
    rationale = models.TextField()
    risk = models.CharField(max_length=30, default="review_required")
    status = models.CharField(max_length=40, default="prioritized")
    data_mode = models.CharField(max_length=12, default="live")
    attempts = models.PositiveIntegerField(default=0)
    session_id = models.CharField(max_length=150, blank=True)
    branch = models.CharField(max_length=180, blank=True)
    commit_sha = models.CharField(max_length=64, blank=True)
    pull_request_url = models.URLField(blank=True)
    evidence = models.JSONField(default=dict)
    blocker = models.TextField(blank=True)


class Job(Record):
    kind = models.CharField(max_length=60)
    dedupe_key = models.CharField(max_length=200, unique=True)
    payload = models.JSONField(default=dict)
    status = models.CharField(max_length=30, default="queued")
    available_at = models.DateTimeField(default=timezone.now)
    lease_until = models.DateTimeField(null=True, blank=True)
    attempts = models.PositiveIntegerField(default=0)
    max_attempts = models.PositiveIntegerField(default=3)
    trace_id = models.UUIDField(default=uuid.uuid4)
    failure_code = models.CharField(max_length=100, blank=True)
    data_mode = models.CharField(max_length=12, default="live")
    finished_at = models.DateTimeField(null=True, blank=True)
    human_interventions = models.PositiveIntegerField(default=0)


class Event(Record):
    event_type = models.CharField(max_length=80)
    schema_version = models.PositiveSmallIntegerField(default=1)
    trace_id = models.UUIDField(default=uuid.uuid4)
    causation_id = models.CharField(max_length=100, blank=True)
    idempotency_key = models.CharField(max_length=200, unique=True)
    data_mode = models.CharField(max_length=12)
    actor = models.CharField(max_length=60)
    payload = models.JSONField(default=dict)


class Release(Record):
    work_item = models.ForeignKey(WorkItem, on_delete=models.CASCADE)
    status = models.CharField(max_length=40, default="prepared")
    previous_sha = models.CharField(max_length=64)
    artifact_sha = models.CharField(max_length=64)
    verification = models.JSONField(default=dict)
    deployment_id = models.CharField(max_length=200, blank=True)
    deployed_url = models.URLField(blank=True)
    deployed_at = models.DateTimeField(null=True, blank=True)
    rollback_at = models.DateTimeField(null=True, blank=True)
    data_mode = models.CharField(max_length=12, default="live")


class SourceClaim(Record):
    key = models.CharField(max_length=100, unique=True)
    topic = models.CharField(max_length=150)
    claim = models.CharField(max_length=500)
    qualification = models.CharField(max_length=500, blank=True)
    source_url = models.URLField(max_length=600)
    publisher = models.CharField(max_length=150)
    title = models.CharField(max_length=250)
    source_date = models.CharField(max_length=100, blank=True)
    retrieved_at = models.DateTimeField(null=True, blank=True)
    evidence_excerpt = models.CharField(max_length=1000, blank=True)
    source_sha256 = models.CharField(max_length=64, blank=True)
    verified_at = models.DateTimeField(null=True, blank=True)
    verification_method = models.CharField(max_length=40, blank=True)
    status = models.CharField(max_length=30, default="unverified")


class Carousel(Record):
    topic = models.CharField(max_length=200)
    status = models.CharField(max_length=30, default="draft")
    claim_ids = models.JSONField(default=list)
    slides = models.JSONField(default=list)
    caption = models.TextField(blank=True)
    asset_dir = models.CharField(max_length=250, blank=True)
    quality = models.JSONField(default=dict)
    campaign_id = models.CharField(max_length=100)
    destination = models.URLField(max_length=500)
    data_mode = models.CharField(max_length=12, default="manual")
    blocker = models.TextField(blank=True)


class Publication(Record):
    carousel = models.OneToOneField(Carousel, on_delete=models.CASCADE)
    status = models.CharField(max_length=30, default="blocked")
    container_ids = models.JSONField(default=list)
    parent_container_id = models.CharField(max_length=100, blank=True)
    provider_post_id = models.CharField(max_length=100, blank=True)
    permalink = models.URLField(blank=True)
    published_at = models.DateTimeField(null=True, blank=True)
    metrics = models.JSONField(default=dict)
    metrics_observed_at = models.DateTimeField(null=True, blank=True)
    failure_code = models.CharField(max_length=100, blank=True)
    data_mode = models.CharField(max_length=12, default="live")
    last_side_effect_at = models.DateTimeField(null=True, blank=True)


class CostEntry(Record):
    category = models.CharField(max_length=40)
    provider = models.CharField(max_length=60)
    external_id = models.CharField(max_length=180, unique=True)
    amount_usd = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    estimated_usd = models.DecimalField(max_digits=12, decimal_places=6, null=True, blank=True)
    data_mode = models.CharField(max_length=12)
    work_item_id = models.UUIDField(null=True, blank=True)


class BudgetDay(models.Model):
    date = models.DateField(primary_key=True)
    reserved_usd = models.DecimalField(max_digits=12, decimal_places=6, default=0)


class FounderAction(Record):
    key = models.CharField(max_length=30, unique=True)
    title = models.CharField(max_length=200)
    exact_action = models.TextField()
    status = models.CharField(max_length=30, default="blocked")
    evidence = models.TextField(blank=True)


class Incident(Record):
    kind = models.CharField(max_length=60)
    status = models.CharField(max_length=30, default="open")
    summary = models.CharField(max_length=500)
    runbook_version = models.CharField(max_length=30, default="2026-11-07")
    evidence = models.JSONField(default=dict)


class Heartbeat(models.Model):
    role = models.CharField(max_length=60, primary_key=True)
    last_seen = models.DateTimeField(default=timezone.now)
    detail = models.JSONField(default=dict)
