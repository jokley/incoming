"""HTTP and generated archive contracts for admin scenarios."""
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url
os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from models import db, AuditEvent
from scenario_generator import SCENARIOS, generate_scenario, generate_complete_suite


class AdminScenarioRoutesTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.admin = {'X-Authenticated-User': 'admin',
                      'X-Authenticated-Groups': 'incoming-admin'}

    def tearDown(self):
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)
            db.session.remove()

    def test_list_metadata_order_and_schema(self):
        response = self.client.get('/api/admin/scenarios', headers=self.admin)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/json')
        self.assertEqual(response.get_json(), [item.public_dict() for item in SCENARIOS])
        self.assertEqual([row['number'] for row in response.get_json()],
                         [f'{number:03d}' for number in range(1, 10)])
        self.assertEqual(response.get_json()[0], {'number': '001', 'title': 'Erstimport',
            'description': 'Eine neue Nation wird erstmals importiert.', 'versions': 1})

    def assert_archive(self, response, filename, root):
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/zip')
        self.assertEqual(response.headers['Content-Disposition'], 'attachment; filename=' + filename)
        self.assertEqual(int(response.headers['Content-Length']), len(response.data))
        expected = {str(path.relative_to(root.parent)).replace('\\', '/'): path.read_bytes()
                    for path in sorted(root.rglob('*')) if path.is_file()}
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            self.assertEqual(archive.namelist(), list(expected))
            self.assertEqual({name: archive.read(name) for name in archive.namelist()}, expected)
            self.assertTrue(all(item.compress_type == zipfile.ZIP_DEFLATED for item in archive.infolist()))

    def test_single_scenario_archive_headers_contents_and_reproducibility(self):
        path = '/api/admin/scenarios/001/generate'
        response = self.client.post(path, headers=self.admin)
        with tempfile.TemporaryDirectory() as directory:
            root = generate_scenario('001', Path(directory))['root']
            self.assert_archive(response, 'wm-scenario-001.zip', root)
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            self.assertTrue(all(item.date_time == (2027, 1, 1, 0, 0, 0) for item in archive.infolist()))
            self.assertTrue(all(item.external_attr == 0o600 << 16 for item in archive.infolist()))
        self.assertEqual(self.client.post(path, headers=self.admin).data, response.data)

    def test_invalid_scenario_returns_exact_404(self):
        for number in ('999', 'unknown'):
            response = self.client.post(f'/api/admin/scenarios/{number}/generate', headers=self.admin)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(response.mimetype, 'application/json')
            self.assertEqual(response.get_json(), {
                'error': 'SCENARIO_NOT_FOUND', 'message': 'Unbekanntes Szenario'})

    def test_complete_suite_archive_headers_and_contents(self):
        response = self.client.post('/api/admin/scenarios/complete/generate', headers=self.admin)
        with tempfile.TemporaryDirectory() as directory:
            root = generate_complete_suite(Path(directory))
            self.assert_archive(response, 'Kompletter_Testordner.zip', root)

    def test_all_routes_require_admin_reset_including_list(self):
        from auth import ROLE_PERMISSIONS
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='scenario-secret'):
            routes = [('GET', '/api/admin/scenarios'),
                      ('POST', '/api/admin/scenarios/001/generate'),
                      ('POST', '/api/admin/scenarios/complete/generate')]
            for method, path in routes:
                with self.subTest(method=method, path=path):
                    self.assertEqual(self.client.open(path, method=method).status_code, 401)
                    headers = {'X-Auth-Proxy-Secret': 'scenario-secret',
                               'X-Authenticated-User': 'admin-test'}
                    for role in ('incoming-viewer', 'incoming-editor', 'unknown'):
                        self.assertEqual(self.client.open(path, method=method, headers={
                            **headers, 'X-Authenticated-Groups': role}).status_code, 403)
                    with patch.dict(ROLE_PERMISSIONS, {'incoming-admin': {'admin.reset'}}):
                        self.assertEqual(self.client.open(path, method=method, headers={
                            **headers, 'X-Authenticated-Groups': 'incoming-admin'}).status_code, 200)
