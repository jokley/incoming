"""Small, fail-closed guard for the dedicated local PostgreSQL test database."""
import os
import unittest

from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError


LOCAL_TEST_URL = 'postgresql://incoming_test:incoming_test@127.0.0.1:55432/incoming_test'


def validate_test_url(value, environment):
    """Validate before opening a connection; never include credentials in errors."""
    try:
        url = make_url(value)
        safe = (
            environment == 'test'
            and url.drivername in {'postgresql', 'postgresql+psycopg'}
            and url.host in {'127.0.0.1', 'localhost', '::1'}
            and url.port == 55432
            and url.database == 'incoming_test'
            and url.username == 'incoming_test'
            and url.password == 'incoming_test'
            and not url.query
        )
    except (ValueError, TypeError, ArgumentError):
        safe = False
    if not safe:
        raise ValueError('Unsafe test target: require FLASK_ENV=test and the dedicated '
                         'loopback:55432 incoming_test database/user with local test credentials '
                         'and no URL query options. Never use a production URL.')
    return url.set(drivername='postgresql+psycopg').render_as_string(hide_password=False)


def postgres_test_url():
    value = os.environ.get('TEST_DATABASE_URL')
    if not value:
        raise unittest.SkipTest('TEST_DATABASE_URL is required for PostgreSQL integration tests')
    if any(os.environ.get(key) for key in ('PGHOST', 'PGHOSTADDR', 'PGSERVICE',
                                          'PGSERVICEFILE', 'PGOPTIONS')):
        raise ValueError('Remove libpq host/service/options overrides before integration tests')
    return validate_test_url(value, os.environ.get('FLASK_ENV'))


def configure_test_app(app):
    """Check the actual engine as well as ENV, including when app is cached."""
    from models import db
    expected = postgres_test_url()
    with app.app_context():
        actual = validate_test_url(db.engine.url.render_as_string(hide_password=False),
                                   app.config.get('RUNTIME_ENV'))
        if actual != expected:
            raise ValueError('Test app engine differs from TEST_DATABASE_URL')
    app.config.update(TESTING=True, AUTH_DEV_USER='test-admin',
                      AUTH_DEV_GROUPS='incoming-admin', AUTH_PROXY_SECRET='')
