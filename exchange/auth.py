from django.contrib.auth.backends import ModelBackend
from django.contrib.auth import get_user_model


class EmailBackend(ModelBackend):
    def authenticate(self, request, username=None, password=None, **kwargs):
        if username is None or password is None:
            return None
        users = get_user_model().objects.filter(email__iexact=username)
        user = users.first()
        if user is None:
            get_user_model()().set_password(password)
            return None
        return user if user.check_password(password) and self.user_can_authenticate(user) else None
