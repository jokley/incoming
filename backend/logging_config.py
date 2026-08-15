"""Process-wide logging policy with request correlation metadata."""

import logging
from logging.config import dictConfig

from flask import g, has_request_context


class RequestContextFilter(logging.Filter):
    def filter(self, record):
        record.request_id = getattr(g, 'request_id', '-') if has_request_context() else '-'
        return True


def configure_logging(level: str = 'INFO'):
    """Configure a single production-friendly format for app and library logs."""
    dictConfig({
        'version': 1,
        'disable_existing_loggers': False,
        'filters': {'request_context': {'()': RequestContextFilter}},
        'formatters': {
            'standard': {
                'format': '%(asctime)s %(levelname)s %(name)s request_id=%(request_id)s %(message)s',
            },
        },
        'handlers': {
            'console': {
                'class': 'logging.StreamHandler',
                'filters': ['request_context'],
                'formatter': 'standard',
                'stream': 'ext://sys.stdout',
            },
        },
        'root': {'handlers': ['console'], 'level': level},
    })
