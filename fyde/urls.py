from django.contrib.auth.views import LogoutView
from django.urls import path

from company import views as company
from exchange import billing, views

urlpatterns = [
    path("", views.landing, name="landing"),
    path("health/", views.health, name="health"),
    path("signup/", views.signup, name="signup"),
    path("login/", views.EmailLogin.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("pricing/", views.pricing, name="pricing"),
    path("privacy/", views.privacy, name="privacy"),
    path("help/", company.help_page, name="help"),
    path("feedback/", company.feedback, name="feedback"),
    path("feedback/<uuid:feedback_id>/withdraw/", company.withdraw_feedback, name="withdraw_feedback"),
    path("app/", views.dashboard, name="dashboard"),
    path("app/received/", views.received, name="received"),
    path("app/received/<uuid:item_id>/download/", views.received_download, name="received_download"),
    path("app/upload/", views.upload, name="upload"),
    path("app/contacts/", views.add_contact, name="add_contact"),
    path("app/contacts/<uuid:contact_id>/", views.contact_action, name="contact_action"),
    path("app/command/", views.command, name="command"),
    path("app/transfers/<uuid:transfer_id>/", views.receipt, name="receipt"),
    path("app/documents/<uuid:document_id>/", views.document, name="document"),
    path("app/versions/<uuid:version_id>/download/", views.owner_download, name="owner_download"),
    path("app/grants/", views.create_grant, name="create_grant"),
    path("app/grants/<uuid:grant_id>/revoke/", views.revoke_grant, name="revoke_grant"),
    path("app/settings/", views.settings_action, name="settings_action"),
    path("app/export/", views.export_metadata, name="export_metadata"),
    path("verify/<uuid:challenge_id>/<str:token>/", views.verify, name="verify"),
    path("access/<uuid:transfer_id>/", views.access, name="access"),
    path("request/<uuid:contact_id>/", views.incoming, name="incoming"),
    path("outbox/", views.outbox, name="outbox"),
    path("billing/checkout/<str:plan>/", billing.checkout, name="checkout"),
    path("billing/portal/", billing.portal, name="billing_portal"),
    path("webhooks/stripe/", billing.webhook, name="stripe_webhook"),
    path("company/", company.dashboard, name="company_dashboard"),
    path("company/control/", company.control, name="company_control"),
    path("company/work/<uuid:work_id>/", company.work_detail, name="work_detail"),
    path("company/carousels/<uuid:carousel_id>/", company.carousel_detail, name="carousel_detail"),
    path("marketing-assets/<uuid:carousel_id>/<str:filename>", company.asset, name="marketing_asset"),
]
