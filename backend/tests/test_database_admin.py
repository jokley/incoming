import json
from pathlib import Path
import tempfile
import io
import unittest
from unittest.mock import MagicMock, patch

from flask import Flask

from database_admin import database_admin


class DatabaseAdminTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(BACKUP_DIR=self.temporary.name,
                               BACKUP_SERVICE_URL='http://backup:8080',
                               DATABASE_BACKEND='postgresql')
        self.app.register_blueprint(database_admin)
        self.client = self.app.test_client()

    def tearDown(self):
        self.temporary.cleanup()

    def test_lists_and_downloads_only_dump_files(self):
        Path(self.temporary.name, 'incoming-1.dump.gz').write_bytes(b'dump')
        Path(self.temporary.name, 'ignore.txt').write_text('no')
        response = self.client.get('/api/admin/database/backups')
        self.assertEqual([item['filename'] for item in response.get_json()], ['incoming-1.dump.gz'])
        self.assertEqual(self.client.get('/api/admin/database/backups/incoming-1.dump.gz').data, b'dump')
        self.assertEqual(self.client.get('/api/admin/database/backups/ignore.txt').status_code, 404)

    @patch('database_admin.urllib.request.urlopen')
    def test_trigger_delegates_to_backup_service(self, urlopen):
        response = MagicMock(status=202)
        response.read.return_value = json.dumps({'status': 'accepted'}).encode()
        urlopen.return_value.__enter__.return_value = response
        result = self.client.post('/api/admin/database/backup')
        self.assertEqual(result.status_code, 202)
        self.assertEqual(result.get_json(), {'status': 'accepted'})
        self.assertEqual(urlopen.call_args.args[0].full_url, 'http://backup:8080/backup')

    @patch('database_admin.db.session.execute')
    def test_status_combines_database_and_backup_metadata(self, execute):
        values = []
        for value in ('17.5', 42000000, '20260815_01'):
            result = MagicMock()
            result.scalar_one.return_value = value
            result.scalar_one_or_none.return_value = value
            values.append(result)
        execute.side_effect = values
        Path(self.temporary.name, 'incoming-1.dump.gz').write_bytes(b'dump')
        Path(self.temporary.name, 'last-backup.json').write_text(json.dumps({
            'status': 'success', 'filename': 'incoming-1.dump.gz', 'size': 4}))
        payload = self.client.get('/api/admin/database/status').get_json()
        self.assertEqual(payload['postgresVersion'], '17.5')
        self.assertEqual(payload['databaseSize'], 42000000)
        self.assertEqual(payload['alembicVersion'], '20260815_01')
        self.assertEqual(payload['backupCount'], 1)
        self.assertEqual(payload['backupStatus'], 'success')

    @patch('database_admin.urllib.request.urlopen')
    def test_import_and_restore_delegate_without_backend_restore_logic(self, urlopen):
        imported = MagicMock(status=201)
        imported.read.return_value = json.dumps({'token': 'abc', 'local': True}).encode()
        restored = MagicMock(status=200)
        restored.read.return_value = json.dumps({'status': 'success'}).encode()
        urlopen.return_value.__enter__.side_effect = [imported, restored]
        response = self.client.post('/api/admin/database/import',
                                    data={'file': (io.BytesIO(b'PGDMP'), 'lokal.dump')})
        self.assertEqual(response.status_code, 201)
        request = urlopen.call_args_list[0].args[0]
        self.assertEqual(request.full_url, 'http://backup:8080/import')
        self.assertEqual(request.data, b'PGDMP')
        response = self.client.post('/api/admin/database/restore', json={'token': 'abc'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(urlopen.call_args_list[1].args[0].full_url, 'http://backup:8080/restore')


if __name__ == '__main__':
    unittest.main()
