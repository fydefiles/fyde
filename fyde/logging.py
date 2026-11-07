import logging
import re


class RedactPrivateRoutes(logging.Filter):
    def filter(self, record):
        message = record.getMessage()
        message = re.sub(r"/verify/[^\s/]+/[^\s/]+/?", "/verify/[redacted]/", message)
        message = re.sub(r"(?i)(authorization:|bearer )[^\s]+", "[credential redacted]", message)
        record.msg, record.args = message, ()
        return True
