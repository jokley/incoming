"""HTTP contracts for mock file discovery and downloads."""
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
from generate_test_files import generate_mock_files


class ImportMockFileRoutesTest(unittest.TestCase):
    base = '/api/import/fis/mock-files'

    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.viewer = {'X-Authenticated-User': 'viewer',
                       'X-Authenticated-Groups': 'incoming-viewer'}
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        app.config['MOCK_FILES_DIR'] = str(self.root)

    def tearDown(self):
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)
            db.session.remove()

    def test_listing_pairs_sorting_labels_nulls_and_urls_on_both_slash_variants(self):
        names = ['ENTRIES-LIST_2027_WM_ZULU.xlsx', 'ENTRIES-LIST_2027_WM_BIG_AIR.xls',
                 'ENTRIES-ROOM-LIST-DETAILED_2027_WM_BIG_AIR.xlsx',
                 'ENTRIES-ROOM-LIST-DETAILED_2027_WM_MOGULS.XLSX', 'ignore.txt', 'other.xlsx']
        for name in names:
            (self.root / name).write_bytes(b'fixture')
        expected = []
        for key, label, entries, room in [('BIG_AIR', 'Big Air', names[1], names[2]),
                ('MOGULS', 'Moguls', None, names[3]), ('ZULU', 'Zulu', names[0], None)]:
            expected.append({'discipline': label, 'disciplineKey': '2027_WM_' + key,
                'entriesFile': entries, 'roomFile': room,
                'entriesDownloadUrl': self.base + '/' + entries if entries else None,
                'roomDownloadUrl': self.base + '/' + room if room else None})
        for slash in ('', '/'):
            response = self.client.get(self.base + slash, headers=self.viewer)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, 'application/json')
            self.assertEqual(response.get_json(), expected)

    def test_empty_and_absent_directory_listing(self):
        for exists in (True, False):
            if not exists:
                self.root.rmdir()
            for slash in ('', '/'):
                response = self.client.get(self.base + slash, headers=self.viewer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), [])

    def test_individual_download_headers_bytes_and_nested_paths(self):
        (self.root / 'nested').mkdir()
        for name in ('sample.xlsx', 'nested/readme.txt'):
            (self.root / name).write_bytes(b'exact download bytes')
            for slash in ('', '/'):
                response = self.client.get(self.base + '/' + name + slash, headers=self.viewer)
                if not slash:
                    self.assertEqual(response.status_code, 308)
                    self.assertEqual(response.headers['Location'],
                                     'http://localhost' + self.base + '/' + name + '/')
                    response = self.client.get(response.headers['Location'], headers=self.viewer)
                try:
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.data, b'exact download bytes')
                    self.assertEqual(response.headers['Content-Disposition'],
                                     'attachment; filename=' + Path(name).name)
                    self.assertEqual(response.mimetype, 'text/plain' if name.endswith('.txt') else
                                     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
                finally:
                    response.close()

    def test_missing_and_parent_paths_return_html_404(self):
        for name in ('missing.xlsx', '../outside.xlsx'):
            for slash in ('', '/'):
                response = self.client.get(self.base + '/' + name + slash, headers=self.viewer)
                if not slash:
                    self.assertEqual(response.status_code, 308)
                    self.assertEqual(response.headers['Location'],
                                     'http://localhost' + self.base + '/' + name + '/')
                    response = self.client.get(response.headers['Location'], headers=self.viewer)
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.mimetype, 'text/html')
                self.assertIsNone(response.get_json(silent=True))

    def test_download_all_generates_fresh_archive_on_both_slash_variants(self):
        (self.root / 'local-only.xlsx').write_bytes(b'not in generated archive')
        with tempfile.TemporaryDirectory() as directory:
            generated = generate_mock_files(Path(directory))
            expected = {Path(row[key]).name: Path(row[key]).read_bytes()
                        for row in generated for key in ('entries_path', 'room_path')}
        for slash in ('', '/'):
            response = self.client.get(self.base + '/download-all' + slash, headers=self.viewer)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.mimetype, 'application/zip')
            self.assertEqual(response.headers['Content-Disposition'], 'attachment; filename=fis-mock-files.zip')
            self.assertEqual(int(response.headers['Content-Length']), len(response.data))
            with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
                self.assertEqual(archive.namelist(), list(expected))
                self.assertEqual({name: archive.read(name) for name in archive.namelist()}, expected)
                self.assertTrue(all(item.compress_type == zipfile.ZIP_DEFLATED for item in archive.infolist()))

    def test_lowercase_prefix_retains_unhandled_500(self):
        (self.root / 'entries-list_2027_WM_TEST.xlsx').write_bytes(b'fixture')
        with patch.dict(app.config, PROPAGATE_EXCEPTIONS=False):
            response = self.client.get(self.base, headers=self.viewer)
            self.assertEqual(response.status_code, 500)
            self.assertEqual(response.mimetype, 'text/html')

    def test_authentication_data_read_and_no_non_api_alias(self):
        (self.root / 'sample.xlsx').write_bytes(b'fixture')
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='mock-secret'):
            for suffix in ('', '/sample.xlsx', '/download-all'):
                for slash in ('', '/'):
                    path = self.base + suffix + slash
                    self.assertEqual(self.client.get(path).status_code, 401)
                    headers = {'X-Auth-Proxy-Secret': 'mock-secret',
                               'X-Authenticated-User': 'mock-reader', 'X-Authenticated-Groups': 'unknown'}
                    self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
                    response = self.client.get(path, headers={
                        **headers, 'X-Authenticated-Groups': 'incoming-viewer'})
                    self.assertEqual(response.status_code, 308 if suffix == '/sample.xlsx' and not slash else 200)
                    response.close()
                    self.assertEqual(self.client.get(path.removeprefix('/api')).status_code, 404)
