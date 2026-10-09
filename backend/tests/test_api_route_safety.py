"""HTTP surface baseline, including protected compatibility aliases.

No endpoint names or module locations are frozen, so blueprint extraction can
retain these checks.
"""
import json
import os
from pathlib import Path
import re
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault('DATABASE_URL', 'postgresql://incoming_test:incoming_test@127.0.0.1:55432/incoming_test')
from app import app
from auth import ROLE_PERMISSIONS
from models import db

ROUTES = json.loads((Path(__file__).parent / 'fixtures/api_routes.json').read_text())


def concrete(path):
    return re.sub(r'<[^>]+>', lambda m: '2147483647' if m[0].startswith('<int:') else 'baseline', path)


class ApiRouteSafetyTest(unittest.TestCase):
    def setUp(self):
        self.config = patch.dict(app.config, TESTING=True, AUTH_DEV_USER='',
                                 AUTH_PROXY_SECRET='baseline-secret')
        self.config.start()
        self.addCleanup(self.config.stop)
        self.client = app.test_client()

    @staticmethod
    def headers(role):
        return {'X-Auth-Proxy-Secret': 'baseline-secret',
                'X-Authenticated-User': 'baseline-user',
                'X-Authenticated-Groups': role}

    def test_registered_paths_and_methods_match_reviewed_manifest(self):
        actual = {}
        for rule in app.url_map.iter_rules():
            if rule.endpoint == 'static':
                continue
            actual.setdefault(rule.rule, set()).update(rule.methods - {'HEAD', 'OPTIONS'})
        self.assertEqual({p: sorted(m) for p, m in actual.items()}, ROUTES)

    def test_every_api_route_and_alias_requires_authentication(self):
        for path, methods in ROUTES.items():
            if path == '/health':
                continue
            for method in methods + (['HEAD'] if 'GET' in methods else []):
                with self.subTest(path=path, method=method):
                    response = self.client.open(concrete(path), method=method)
                    self.assertEqual(response.status_code, 401)
                    if method != 'HEAD':
                        self.assertEqual(response.get_json(), {
                            'error': 'UNAUTHENTICATED', 'message': 'Authentication required'})

    def test_authenticated_unknown_role_has_no_data_permissions(self):
        for path, methods in ROUTES.items():
            if path in {'/health', '/api/auth/me'}:
                continue
            for method in methods:
                with self.subTest(path=path, method=method):
                    response = self.client.open(concrete(path), method=method,
                                                headers=self.headers('unknown'))
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.get_json(), {
                        'error': 'FORBIDDEN', 'message': 'Insufficient permissions'})

    def test_viewer_cannot_mutate_or_read_admin_and_audit_routes(self):
        for path, methods in ROUTES.items():
            if path == '/health':
                continue
            for method in methods:
                restricted_read = path.startswith(('/api/admin/', '/api/audit-events'))
                if method == 'GET' and not restricted_read:
                    continue
                with self.subTest(path=path, method=method):
                    self.assertEqual(self.client.open(concrete(path), method=method,
                        headers=self.headers('incoming-viewer')).status_code, 403)

    def test_editor_cannot_access_administration(self):
        for path, methods in ROUTES.items():
            if path.startswith('/api/admin/'):
                for method in methods:
                    with self.subTest(path=path, method=method):
                        self.assertEqual(self.client.open(concrete(path), method=method,
                            headers=self.headers('incoming-editor')).status_code, 403)

    def test_proxy_secret_is_required_even_with_identity_headers(self):
        headers = self.headers('incoming-admin')
        headers['X-Auth-Proxy-Secret'] = 'wrong'
        self.assertEqual(self.client.get('/api/auth/me', headers=headers).status_code, 401)
        response = self.client.get('/api/auth/me', headers=self.headers('unknown'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['permissions'], [])

    def test_permission_families_allow_only_the_required_capability(self):
        # A single-capability identity detects permission drift hidden by the
        # editor role (which normally has all three write capabilities).
        cases = [
            ('GET', '/api/assignments/planning-view', 'data.read'),
            ('GET', '/api/fis/official-quotas', 'data.read'),
            ('GET', '/api/athletes', 'data.read'),
            ('GET', '/api/import/approvals/1', 'data.read'),
            ('GET', '/api/debug/routes', 'data.read'),
            ('GET', '/api/audit-events', 'audit.read'),
            ('GET', '/api/admin/events', 'admin.reset'),
            ('POST', '/api/admin/events', 'admin.reset'),
            ('POST', '/api/hotels', 'data.write'),
            ('PATCH', '/api/athletes/1', 'data.write'),
            ('POST', '/api/events', 'data.write'),
            ('POST', '/api/assignments/bookings', 'assignments.write'),
            ('DELETE', '/api/room-assignments/1', 'assignments.write'),
            ('POST', '/api/import/fis/preview', 'imports.write'),
            ('POST', '/api/import/fis/confirm', 'imports.write'),
            ('PATCH', '/api/import/sessions/1/approvals/1', 'imports.write'),
            ('PATCH', '/api/import/sessions/1/single-room-exemptions/person', 'imports.write'),
        ]
        permissions = {'data.read', 'data.write', 'assignments.write',
                       'imports.write', 'admin.reset', 'audit.read'}
        adapter = app.url_map.bind('localhost')
        for method, path, required in cases:
            endpoint, _ = adapter.match(path, method=method)
            # Sentinel response avoids writes/auditing; snapshot lookups are
            # neutralized because this test exercises only the request guard.
            with patch.dict(app.view_functions, {endpoint: lambda **kwargs: ('reached', 418)}), \
                    patch.object(db.session, 'get', return_value=None):
                for permission in permissions:
                    with self.subTest(method=method, path=path, permission=permission), \
                            patch.dict(ROLE_PERMISSIONS, {'baseline-role': {permission}}):
                        response = self.client.open(path, method=method,
                            headers=self.headers('baseline-role'))
                        self.assertEqual(response.status_code, 418 if permission == required else 403)

    def test_options_remains_unauthenticated(self):
        for path in ROUTES:
            with self.subTest(path=path):
                response = self.client.options(concrete(path))
                if path == '/api/import/fis/mock-files/<path:filename>':
                    # Flask redirects this overlapping path-converter route
                    # despite the explicit no-slash registration.
                    self.assertEqual(response.status_code, 308)
                    self.assertEqual(response.headers['Location'],
                        'http://localhost/api/import/fis/mock-files/baseline/')
                    response = self.client.options(concrete(path) + '/')
                self.assertEqual(response.status_code, 200)
                self.assertTrue(set(ROUTES[path]) <= set(response.headers['Allow'].split(', ')))

    def test_aliases_share_canonical_handler_and_permission_requirements(self):
        # Test each individual capability: editor/admin identities alone would
        # not detect an assignment accidentally falling back to data.write.
        adapter = app.url_map.bind('localhost')
        for path, methods in ROUTES.items():
            if path.startswith('/api/') or path == '/health':
                continue
            for method in methods:
                with self.subTest(path=path, method=method):
                    endpoint, _ = adapter.match(concrete(path), method=method)
                    canonical, _ = adapter.match('/api' + concrete(path), method=method)
                    self.assertIs(app.view_functions[endpoint], app.view_functions[canonical])
                    required = ('data.read' if method == 'GET' else
                                'assignments.write' if path.startswith('/room-assignments') else
                                'imports.write' if path.startswith('/import/') else 'data.write')
                    with patch.dict(app.view_functions, {endpoint: lambda **kwargs: ('reached', 418)}), \
                            patch.object(db.session, 'get', return_value=None):
                        for permission in ['data.read', 'data.write', 'assignments.write', 'imports.write']:
                            with self.subTest(permission=permission), \
                                    patch.dict(ROLE_PERMISSIONS, {'baseline-role': {permission}}):
                                for url in [concrete(path), '/api' + concrete(path)]:
                                    response = self.client.open(url, method=method,
                                        headers=self.headers('baseline-role'))
                                    self.assertEqual(response.status_code, 418 if permission == required else 403)

    def test_health_remains_public_and_unknown_non_api_paths_stay_404(self):
        with patch.object(db.session, 'execute'):
            self.assertEqual(self.client.get('/health').status_code, 200)
        self.assertEqual(self.client.get('/hotels/not-an-integer').status_code, 404)
        self.assertEqual(self.client.get('/unregistered').status_code, 404)
