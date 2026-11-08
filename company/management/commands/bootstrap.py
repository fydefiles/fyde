import secrets

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from company.models import FounderAction

ACTIONS = {
    "F01": (
        "Public domain and hosting",
        "Choose a Fyde domain and HTTPS hosting for the Django web service, private storage, two PostgreSQL databases, and supervised workers. Set SITE_URL and DJANGO_ALLOWED_HOSTS. No hosted deployment exists yet.",
    ),
    "F02": (
        "Naïve authorization and budgets",
        "Configure NAIVE_API_KEY scoped to agents:read and sessions:read/write, NAIVE_AGENT_ID with every tool denied and no connected identity/team, NAIVE_TASK_BUDGET_USD, and COMPANY_DAILY_BUDGET_USD. The app pins the inspected agent version and records real session IDs.",
    ),
    "F03": (
        "Verified email sender",
        "Verify a sending domain in Resend. Set EMAIL_ADAPTER=resend, EMAIL_FROM, RESEND_API_KEY, positive EMAIL_UNIT_COST_USD and EMAIL_DAILY_BUDGET_USD, and EXTERNAL_EMAIL_DAILY_LIMIT. Use a public HTTPS SITE_URL. Complete a real sender/contact verification and send/download test.",
    ),
    "F04": (
        "Subreddit and Reddit API approval",
        "Create or identify the product subreddit and set SUBREDDIT_URL. Obtain explicit Reddit commercial API approval before enabling automated ingestion. This build deliberately uses in-app feedback while that authorization is missing.",
    ),
    "F05": (
        "Instagram professional account",
        "Authorize the Facebook Login path with a linked professional Instagram account and Page access token. Configure INSTAGRAM_ACCOUNT_ID, INSTAGRAM_ACCESS_TOKEN, INSTAGRAM_API_VERSION, INSTAGRAM_PERMISSIONS_APPROVED=1, CONTENT_PUBLIC_ORIGIN and MARKETING_DESTINATION. After approval set INSTAGRAM_ENABLED=1. Verify a single publication and real insights.",
    ),
    "F06": (
        "Stripe sandbox and live activation",
        "Configure a restricted Stripe key, STRIPE_PRICE_PLUS and STRIPE_PRICE_UNLIMITED for separate monthly products, STRIPE_WEBHOOK_SECRET, and a customer portal. Register /webhooks/stripe/. Test subscriptions first. STRIPE_LIVE_ENABLED remains off until you approve live billing and pricing/resource policies.",
    ),
    "F07": (
        "Pricing and resource terms",
        "Review content/plans.json: $0/10 sends, $5/500 sends, $20/no file-count cap. Separately approve per-file, storage and bandwidth limits, and provider cost estimates. No external model budget is included by default. Economics remain unvalidated.",
    ),
    "F08": (
        "Privacy, retention, refunds and backups",
        "Review /privacy/ and docs/operations.md. Approve retention and refund rules. Complete account deletion and backup erasure remain launch blockers. Configure encrypted backups and prove a restore before public launch.",
    ),
    "F09": (
        "Genuine attendee feedback",
        "Invite hackathon attendees to try the real product and voluntarily submit feedback. A genuine feedback-to-release milestone requires their actual record, independent checks, protected dev deployment, requester notification and observed use. Fixtures cannot satisfy it.",
    ),
    "F10": (
        "Release boundary and deployment controls",
        "Approve content/help.json-only automatic development releases. Protect dev with integration and release-boundary checks and required review for protected code. Configure a separate release GitHub App token, immutable verifier image, deployment environment and hosted smoke identity. Keep main promotion operator-requested. Activate COMPANY_RELEASE_ENABLED only after these controls exist.",
    ),
    "F15": (
        "Mobile runtime and distribution",
        "The Expo client and unsigned iOS simulator build are available locally. Install a usable iOS simulator runtime or supply a test device; this host currently has none. Android native packaging needs an Android SDK/emulator or authorized build environment. For store distribution confirm owned bundle/package identifiers, Apple/Google developer accounts and signing, and set EXPO_PUBLIC_API_URL to the actual HTTPS customer backend. Do not put customer or provider secrets in public Expo configuration. No app-store release or device test is claimed.",
    ),
    "F14": (
        "Optional SMS delivery activation",
        "Authorize a Twilio sender and destination-specific registrations. In the customer worker secret store configure SMS_ADAPTER=twilio, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, E.164 SMS_FROM, HTTPS SITE_URL, positive SMS_UNIT_COST_USD per segment including carrier charges, SMS_DAILY_BUDGET_USD and SMS_DAILY_LIMIT. Verify one consent-safe phone verification, send and download. Native delivery between verified accounts is independent of SMS activation. Never give these keys to company agents.",
    ),
    "F11": (
        "Optional device and wearable access",
        "Local folders, personal messaging, voice, and Vexo require their own documented permissioned adapters. They are not implemented or claimed.",
    ),
}


class Command(BaseCommand):
    help = "Initialize founder actions; optionally create an explicitly local fixture workspace."

    def add_arguments(self, parser):
        parser.add_argument("--demo", action="store_true")

    def handle(self, *args, **options):
        for key, (title, action) in ACTIONS.items():
            FounderAction.objects.get_or_create(
                key=key,
                defaults={
                    "title": title,
                    "exact_action": action,
                    "status": "deferred" if key == "F11" else "blocked",
                },
            )
        if options["demo"]:
            if not settings.DEBUG or settings.EMAIL_ADAPTER != "local":
                raise CommandError("Demo accounts are restricted to the local fixture adapter.")
            from exchange.models import User

            user, created = User.objects.get_or_create(
                username="demo@fyde.test",
                defaults={
                    "email": "demo@fyde.test",
                    "first_name": "Demo",
                    "is_staff": True,
                    "data_mode": "fixture",
                },
            )
            if created:
                password = secrets.token_urlsafe(18)
                user.set_password(password)
                user.save()
                login_file = settings.VAR_DIR / "demo-login.txt"
                login_file.write_text(
                    f"Local fixture account only\nEmail: demo@fyde.test\nPassword: {password}\n"
                )
                login_file.chmod(0o600)
                from exchange.identity import issue_challenge

                issue_challenge(user, "owner")
                self.stdout.write(
                    "Created fixture operator. Local credentials: var/demo-login.txt (ignored by Git)."
                )
            else:
                self.stdout.write("Fixture operator already exists; its password was preserved.")
        self.stdout.write("Founder-action register initialized.")
