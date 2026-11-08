import logging
import re


class RedactPrivateRoutes(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        message = re.sub(r"/verify/[^\s/]+/[^\s/]+/?", "/verify/[redacted]/", message)
        message = re.sub(r"(?i)(authorization:|bearer )[^\s]+", "[credential redacted]", message)
        message = re.sub(r"(/auth/google/[^\s?]*)\?[^\s\"]+", r"\1?[redacted]", message)
        record.msg, record.args = message, ()
        return True
