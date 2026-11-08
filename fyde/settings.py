import os
from pathlib import Path

import dj_database_url
from dotenv import load_dotenv
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
if os.environ.get("FYDE_LOAD_DOTENV", "1") == "1":
    load_dotenv(Path(os.environ.get("FYDE_ENV_FILE", BASE_DIR / ".env")))
VAR_DIR = Path(os.environ.get("FYDE_VAR_DIR", BASE_DIR / "var"))
VAR_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"
SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY") or "local-only-change-before-hosting-fyde"
if not DEBUG and SECRET_KEY == "local-only-change-before-hosting-fyde":
    raise ImproperlyConfigured("Set a unique DJANGO_SECRET_KEY before deployment.")
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver").split(",")
SITE_URL = os.environ.get("SITE_URL", "http://127.0.0.1:8000").rstrip("/")
CSRF_TRUSTED_ORIGINS = [SITE_URL]
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "exchange",
    "company",
]
MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "fyde.middleware.SecurityHeaders",
]
ROOT_URLCONF = "fyde.urls"
TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "exchange.context.app_context",
            ]
        },
    }
]
WSGI_APPLICATION = "fyde.wsgi.application"
DATABASES = {
    "default": dj_database_url.parse(
        (os.environ.get("DATABASE_URL") or f"sqlite:///{VAR_DIR / 'customer.sqlite3'}")
    ),
    "company": dj_database_url.parse(
        (os.environ.get("COMPANY_DATABASE_URL") or f"sqlite:///{VAR_DIR / 'company.sqlite3'}")
    ),
}
for db in DATABASES.values():
    if db["ENGINE"].endswith("sqlite3"):
        db["OPTIONS"] = {"timeout": 30, "transaction_mode": "IMMEDIATE"}
    else:
        db["CONN_HEALTH_CHECKS"] = True
        db["DISABLE_SERVER_SIDE_CURSORS"] = True
DATABASE_ROUTERS = ["fyde.routers.CompanyRouter"]
AUTH_USER_MODEL = "exchange.User"
AUTHENTICATION_BACKENDS = ["exchange.auth.EmailBackend"]
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]
LOGIN_URL = "/login/"
LOGIN_REDIRECT_URL = "/app/"
LOGOUT_REDIRECT_URL = "/"
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_TZ = True
STATIC_URL = "/static/"
STATIC_ROOT = (
    BASE_DIR / "static-collected" if (BASE_DIR / "static-collected").exists() else VAR_DIR / "static"
)
STATICFILES_DIRS = [BASE_DIR / "static"]
MEDIA_ROOT = VAR_DIR / "private"
MEDIA_ROOT.mkdir(exist_ok=True, mode=0o700)
FILE_STORAGE = os.environ.get("FILE_STORAGE", "local")
AUTH_PROVIDER = os.environ.get("AUTH_PROVIDER", "local")
NEON_AUTH_BASE_URL = os.environ.get("NEON_AUTH_BASE_URL", "").rstrip("/")
NEON_STORAGE_BUCKET = os.environ.get("NEON_STORAGE_BUCKET", "uploads")
AWS_ENDPOINT_URL_S3 = os.environ.get("AWS_ENDPOINT_URL_S3", "")
AWS_ACCESS_KEY_ID = os.environ.get("AWS_ACCESS_KEY_ID", "")
AWS_SECRET_ACCESS_KEY = os.environ.get("AWS_SECRET_ACCESS_KEY", "")
AWS_REGION = os.environ.get("AWS_REGION", "us-east-2")
if FILE_STORAGE not in ("local", "neon") or AUTH_PROVIDER not in ("local", "neon"):
    raise ImproperlyConfigured("Choose local or neon for FILE_STORAGE and AUTH_PROVIDER.")
if AUTH_PROVIDER == "neon":
    from urllib.parse import urlsplit

    auth_url = urlsplit(NEON_AUTH_BASE_URL)
    if auth_url.scheme != "https" or not auth_url.hostname or auth_url.username or auth_url.query:
        raise ImproperlyConfigured("Set an HTTPS NEON_AUTH_BASE_URL without credentials or a query.")
    MIDDLEWARE.insert(
        MIDDLEWARE.index("django.contrib.auth.middleware.AuthenticationMiddleware") + 1,
        "exchange.neon_auth.SessionMiddleware",
    )
if FILE_STORAGE == "neon" and not all(
    (AWS_ENDPOINT_URL_S3.startswith("https://"), AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)
):
    raise ImproperlyConfigured("Set the Neon S3 endpoint and scoped storage credentials.")
DATA_UPLOAD_MAX_MEMORY_SIZE = 30 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
SECURE_SSL_REDIRECT = not DEBUG
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = False
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
# Configure SECURE_PROXY_SSL_HEADER only for a trusted proxy that strips client-supplied headers.
if os.environ.get("TRUST_PROXY", "0") == "1":
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
EMAIL_ADAPTER = os.environ.get("EMAIL_ADAPTER", "local" if DEBUG else "disabled")
EMAIL_FROM = os.environ.get("EMAIL_FROM", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
EXTERNAL_EMAIL_DAILY_LIMIT = int(os.environ.get("EXTERNAL_EMAIL_DAILY_LIMIT", "0"))
EMAIL_UNIT_COST_USD = os.environ.get("EMAIL_UNIT_COST_USD", "")
EMAIL_DAILY_BUDGET_USD = os.environ.get("EMAIL_DAILY_BUDGET_USD", "0")
SMS_ADAPTER = os.environ.get("SMS_ADAPTER", "disabled")
TWILIO_ACCOUNT_SID = os.environ.get("TWILIO_ACCOUNT_SID", "")
TWILIO_AUTH_TOKEN = os.environ.get("TWILIO_AUTH_TOKEN", "")
SMS_FROM = os.environ.get("SMS_FROM", "")
SMS_UNIT_COST_USD = os.environ.get("SMS_UNIT_COST_USD", "")
SMS_DAILY_BUDGET_USD = os.environ.get("SMS_DAILY_BUDGET_USD", "0")
SMS_DAILY_LIMIT = int(os.environ.get("SMS_DAILY_LIMIT", "0"))
SCAN_ADAPTER = os.environ.get("SCAN_ADAPTER", "text_only")
CLAMAV_HOST = os.environ.get("CLAMAV_HOST", "")
CLAMAV_PORT = int(os.environ.get("CLAMAV_PORT", "3310"))
STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")
STRIPE_LIVE_ENABLED = os.environ.get("STRIPE_LIVE_ENABLED", "0") == "1"
SUBREDDIT_URL = os.environ.get("SUBREDDIT_URL", "")
OPERATOR_EMAIL = os.environ.get("OPERATOR_EMAIL", "")
COMPANY_PAUSED = os.environ.get("COMPANY_PAUSED", "0") == "1"
COMPANY_RELEASE_ENABLED = os.environ.get("COMPANY_RELEASE_ENABLED", "0") == "1"
COMPANY_SOURCE_ROOT = os.environ.get("COMPANY_SOURCE_ROOT") or str(BASE_DIR)
COMPANY_WORK_ROOT = Path(os.environ.get("COMPANY_WORK_ROOT", VAR_DIR / "company-work"))
NAIVE_API_KEY = os.environ.get("NAIVE_API_KEY", "")
NAIVE_AGENT_ID = os.environ.get("NAIVE_AGENT_ID", "")
NAIVE_TASK_BUDGET_USD = os.environ.get("NAIVE_TASK_BUDGET_USD", "0")
INSTAGRAM_ACCESS_TOKEN = os.environ.get("INSTAGRAM_ACCESS_TOKEN", "")
INSTAGRAM_ACCOUNT_ID = os.environ.get("INSTAGRAM_ACCOUNT_ID", "")
INSTAGRAM_API_VERSION = os.environ.get("INSTAGRAM_API_VERSION", "")
INSTAGRAM_ENABLED = os.environ.get("INSTAGRAM_ENABLED", "0") == "1"
INSTAGRAM_MAX_PER_DAY = int(os.environ.get("INSTAGRAM_MAX_PER_DAY", "1"))
CONTENT_PUBLIC_ORIGIN = os.environ.get("CONTENT_PUBLIC_ORIGIN", "")
MARKETING_DESTINATION = os.environ.get("MARKETING_DESTINATION", SITE_URL)
COMPANY_DAILY_BUDGET_USD = os.environ.get("COMPANY_DAILY_BUDGET_USD", "0")
MODEL_VERSION = "none"
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "filters": {"private_routes": {"()": "fyde.logging.RedactPrivateRoutes"}},
    "handlers": {"safe_console": {"class": "logging.StreamHandler", "filters": ["private_routes"]}},
    "loggers": {
        "django.request": {"handlers": ["safe_console"], "propagate": False},
        "django.server": {"handlers": ["safe_console"], "propagate": False},
    },
}

# Bearer-only native API; browser previews require an explicit allowed origin.
CUSTOMER_API_ORIGINS = [
    o
    for o in os.environ.get(
        "CUSTOMER_API_ORIGINS",
        "http://localhost:8081,http://127.0.0.1:8081,http://localhost:8082,http://127.0.0.1:8082"
        if DEBUG
        else "",
    ).split(",")
    if o
]
