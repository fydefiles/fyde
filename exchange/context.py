import json
from django.conf import settings


def app_context(request):
    return {
        "local_adapter": settings.EMAIL_ADAPTER == "local",
        "app_name": "Fyde",
        "subreddit_url": settings.SUBREDDIT_URL,
        "plan_policy": json.loads((settings.BASE_DIR / "content/plans.json").read_text()),
    }
