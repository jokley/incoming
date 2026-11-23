"""Identity origin is decided by authentication, never by the user name."""
import pytest
from flask import Flask
from auth import load_user_from_request


@pytest.mark.parametrize('runtime', ['development', 'test', 'production', ''])
@pytest.mark.parametrize('mode', ['fallback', 'proxy', 'proxy-without-user', 'header', 'supplied-secret'])
def test_dev_identity_provenance(runtime, mode):
    app = Flask(__name__)
    app.config.update(RUNTIME_ENV=runtime, AUTH_DEV_USER='local-admin',
                      AUTH_DEV_GROUPS='incoming-admin', AUTH_PROXY_SECRET='')
    headers = {}
    if mode.startswith('proxy'):
        app.config['AUTH_PROXY_SECRET'] = 'trusted-secret'
        headers['X-Auth-Proxy-Secret'] = 'trusted-secret'
    if mode in {'proxy', 'header'}:
        headers.update({'X-Authenticated-User': 'local-admin',
                        'X-Authenticated-Groups': 'incoming-admin'})
    if mode == 'supplied-secret':
        headers['X-Auth-Proxy-Secret'] = 'unexpected-secret'
    with app.test_request_context(headers=headers):
        user = load_user_from_request()
        assert user.username == 'local-admin'
        assert user.is_dev_fallback is (runtime == 'development' and mode == 'fallback')
        assert user.is_dev_admin is user.is_dev_fallback


def test_fallback_origin_does_not_replace_functional_permissions():
    app = Flask(__name__)
    app.config.update(RUNTIME_ENV='development', AUTH_DEV_USER='local-reader',
                      AUTH_DEV_GROUPS='incoming-viewer', AUTH_PROXY_SECRET='')
    with app.test_request_context():
        user = load_user_from_request()
        assert user.is_dev_fallback
        assert not user.is_dev_admin
        assert not user.has_permission('data.write')
