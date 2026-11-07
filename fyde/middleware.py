class SecurityHeaders:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)
        response["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; "
            "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
        )
        response["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.path.startswith(("/app", "/access", "/verify", "/request", "/company", "/outbox")):
            response["Cache-Control"] = "no-store"
        return response
