"""Company workers cannot open a customer database or customer storage.

Launch with DJANGO_SETTINGS_MODULE=fyde.company_settings and only the role's allowlisted environment.
This process is trusted orchestration; untrusted builder output runs in a separate remote/sandbox boundary.
"""

import os

os.environ["FYDE_LOAD_DOTENV"] = "0"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["DJANGO_DEBUG"] = "1"
os.environ["EMAIL_ADAPTER"] = "disabled"
os.environ["RESEND_API_KEY"] = ""
os.environ["STRIPE_API_KEY"] = ""
os.environ["STRIPE_WEBHOOK_SECRET"] = ""
from .settings import *  # noqa: F403

DATABASES["default"] = {"ENGINE": "django.db.backends.sqlite3", "NAME": ":memory:"}  # noqa: F405
MEDIA_ROOT = VAR_DIR / "no-customer-storage"  # noqa: F405
MEDIA_ROOT.mkdir(exist_ok=True, mode=0o700)
