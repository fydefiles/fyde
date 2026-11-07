from django.conf import settings
from django.db import transaction
from django.utils import timezone

from company.feedback import ingest
from company.models import Event, Feedback

from .identity import queue_mail
from .models import FeedbackBridge, Notification, ProductMetric, Transfer


def sync_feedback():
    count = 0
    for bridge in FeedbackBridge.objects.filter(exported_at=None).select_related("owner")[:25]:
        ingest(bridge.pk, bridge.title, bridge.body, bridge.visibility, mode=bridge.owner.data_mode)
        if bridge.visibility == "private":
            # Routine guidance stays in trusted customer code. No private support body enters a business model.
            text = (
                "Your private support request is recorded for operator review. "
                "The help page explains verification, sharing permissions, receipts, and plan limits. "
                "You can manage an existing subscription through Settings. No permission or refund has been changed."
            )
            Notification.objects.get_or_create(
                external_id=f"support/{bridge.pk}",
                defaults={"owner": bridge.owner, "body": text, "link": "/help/"},
            )
        FeedbackBridge.objects.filter(pk=bridge.pk).update(exported_at=timezone.now())
        count += 1
    return count


def sync_notifications():
    for item in Feedback.objects.filter(work_item__isnull=False).select_related("work_item")[:100]:
        work = item.work_item
        bridge = FeedbackBridge.objects.filter(pk=item.pk).select_related("owner").first()
        if not bridge or bridge.last_notified_state == work.status:
            continue
        if work.status == "deployed":
            # Only a trusted verified release can generate a shipped notification.
            release = work.release_set.filter(status="deployed", deployed_at__isnull=False).first()
            if not release or not release.deployment_id or not release.deployed_url:
                continue
            text = "Your feedback led to an improvement in the help page. The release passed verification and is available. Thank you for trying Fyde."
            link = "/help/"
        elif work.status in ("review_required", "blocked", "already_supported"):
            text = {
                "review_required": "We recorded your feedback. It needs operator review before implementation.",
                "blocked": "We recorded your feedback. Work is blocked on an integration or operator action; no release is claimed.",
                "already_supported": "The requested capability is available. The help page explains the existing controls.",
            }[work.status]
            link = "/help/"
        else:
            continue
        with transaction.atomic():
            notification, created = Notification.objects.get_or_create(
                external_id=f"feedback/{item.pk}/{work.status}",
                defaults={"owner": bridge.owner, "body": text, "link": link},
            )
            if created and bridge.owner.notifications_enabled and bridge.owner.email_verified:
                queue_mail(
                    bridge.owner,
                    bridge.owner.email,
                    "An update on your Fyde feedback",
                    text + f"\n\n{settings.SITE_URL}{link}",
                    f"notification/{notification.pk}",
                )
            bridge.last_notified_state = work.status
            bridge.save(update_fields=["last_notified_state"])


def sync_metrics():
    # Only aggregates leave the customer plane. No filenames, addresses, document text or owner IDs.
    date = timezone.now().date()
    for mode in ("live", "fixture", "manual", "sandbox"):
        accepted = Transfer.objects.filter(data_mode=mode, accepted_at__isnull=False)
        activated = accepted.values("owner_id").distinct().count()
        from django.db.models import Count

        repeat = accepted.values("owner_id").annotate(n=Count("pk")).filter(n__gte=2).count()
        counts = {
            "activated": activated,
            "accepted_sends": accepted.count(),
            "repeat_senders": repeat,
            "recipient_downloads_started": accepted.filter(accessed_at__isnull=False).count(),
            "landing_visits": ProductMetric.objects.filter(kind="landing", data_mode=mode).count(),
            "help_views": ProductMetric.objects.filter(kind="help_view", data_mode=mode).count(),
            "window": "all observed time",
            "observed_at": timezone.now().isoformat(),
        }
        campaigns = []
        campaign_ids = (
            ProductMetric.objects.filter(data_mode=mode)
            .exclude(campaign="")
            .values_list("campaign", flat=True)
            .distinct()
        )
        for campaign in campaign_ids[:30]:
            signups = ProductMetric.objects.filter(kind="signup", data_mode=mode, campaign=campaign)
            campaigns.append(
                {
                    "id": campaign,
                    "landing_visits": ProductMetric.objects.filter(
                        kind="landing", data_mode=mode, campaign=campaign
                    ).count(),
                    "signups": signups.count(),
                    "activated_senders": accepted.filter(owner_id__in=signups.values("owner_id"))
                    .values("owner_id")
                    .distinct()
                    .count(),
                    "paid_conversion": None,
                    "attribution": "24-hour first-party session; shared links and cross-device attribution remain uncertain",
                }
            )
        counts["campaigns"] = campaigns
        Event.objects.update_or_create(
            idempotency_key=f"aggregate/{date}/{mode}",
            defaults={
                "event_type": "product.aggregate",
                "data_mode": mode,
                "actor": "customer_bridge",
                "payload": counts,
            },
        )


def tick():
    count = sync_feedback()
    sync_notifications()
    sync_metrics()
    return count
