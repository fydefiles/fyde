from django import forms
from django.contrib.auth.forms import UserCreationForm

from .models import Contact, Document, User


class SignupForm(UserCreationForm):
    email = forms.EmailField()
    first_name = forms.CharField(max_length=80, label="Your name")

    class Meta:
        model = User
        fields = ("first_name", "email", "password1", "password2")

    def clean_email(self):
        email = self.cleaned_data["email"].lower()
        if User.objects.filter(email__iexact=email).exists():
            raise forms.ValidationError("An account with this email already exists.")
        return email


class ContactForm(forms.ModelForm):
    class Meta:
        model = Contact
        fields = ("name", "email", "phone", "relationship", "aliases")
        labels = {
            "phone": "Phone with country code (optional)",
            "relationship": "Relationship (for example, lawyer)",
            "aliases": "Other names (comma separated, optional)",
        }

    def clean_email(self):
        return self.cleaned_data["email"].lower()

    def clean_phone(self):
        from .recipients import phone_number
        from .policy import PolicyError

        try:
            return phone_number(self.cleaned_data.get("phone", ""))
        except PolicyError as error:
            raise forms.ValidationError(str(error)) from None

    def clean(self):
        cleaned = super().clean()
        if not cleaned.get("email") and not cleaned.get("phone"):
            raise forms.ValidationError(
                "Add an email address or a phone number so Fyde can identify the recipient."
            )
        return cleaned


class UploadForm(forms.Form):
    file = forms.FileField(label="Choose a file")
    title = forms.CharField(max_length=180, required=False, label="Document title (optional)")
    tags = forms.CharField(max_length=250, required=False, label="Tags (optional)")
    sensitive = forms.BooleanField(required=False, label="Sensitive: require an explicit sharing permission")
    document = forms.ModelChoiceField(
        queryset=Document.objects.none(),
        required=False,
        label="Add a version to an existing document (optional)",
    )

    def __init__(self, owner, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["document"].queryset = Document.objects.filter(owner=owner, deleted_at=None)
        self.fields["document"].label_from_instance = lambda obj: obj.title


class FeedbackForm(forms.Form):
    title = forms.CharField(max_length=140, label="What would make Fyde more useful?")
    body = forms.CharField(
        max_length=4000,
        widget=forms.Textarea(attrs={"rows": 5}),
        label="What happened, or what did you need?",
    )
    visibility = forms.ChoiceField(
        choices=[("private", "Private support"), ("public", "Public feature request")]
    )
    allow_company_processing = forms.BooleanField(
        label="Let the company use this feedback to improve the product. I have excluded private file contents."
    )
