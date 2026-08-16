import gzip
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
import io
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import backup_service


class Result:
    returncode = 0
    stderr = b''
    stdout = '17.5\n'


class BackupServiceTest(unittest.TestCase):
    def environment(self, directory, retention='30'):
        return patch.dict(os.environ, {'POSTGRES_DB': 'incoming', 'POSTGRES_USER': 'incoming',
            'POSTGRES_PASSWORD': 'secret', 'BACKUP_DIR': directory,
            'BACKUP_RETENTION': retention}, clear=True)

    def fake_run(self, command, **kwargs):
        if command[0] == 'pg_dump':
            kwargs['stdout'].write(b'dump-content')
            return Result()
        return Result()

    def test_creates_compressed_dump_and_success_status(self):
        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.subprocess.run', side_effect=self.fake_run):
            payload = backup_service.create_backup()
            dump = Path(directory, payload['filename'])
            self.assertEqual(gzip.decompress(dump.read_bytes()), b'dump-content')
            self.assertEqual(json.loads(Path(directory, 'last-backup.json').read_text())['status'], 'success')

    def test_retention_keeps_configured_number_of_dumps(self):
        with tempfile.TemporaryDirectory() as directory, self.environment(directory, '2'):
            for number in range(4):
                path = Path(directory, f'incoming-{number}.dump.gz')
                path.write_bytes(b'x')
                os.utime(path, (number, number))
            backup_service.apply_retention(Path(directory), 2)
            self.assertEqual(len(list(Path(directory).glob('*.dump.gz'))), 2)

    def test_failure_writes_error_status(self):
        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.subprocess.run', side_effect=OSError('unavailable')):
            with self.assertRaises(OSError):
                backup_service.create_backup()
            status = json.loads(Path(directory, 'last-backup.json').read_text())
            self.assertEqual(status['status'], 'error')
            self.assertIn('unavailable', status['error'])

    def test_cron_schedule_calculates_next_utc_run(self):
        schedule = backup_service.CronSchedule('0 3 * * *')
        self.assertEqual(schedule.next(datetime(2026, 8, 16, 2, 59, tzinfo=timezone.utc)),
                         datetime(2026, 8, 16, 3, 0, tzinfo=timezone.utc))

    def test_import_accepts_only_custom_dump_and_removes_invalid_upload(self):
        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.subprocess.run', return_value=Result()):
            imported = backup_service.import_dump(io.BytesIO(b'PGDMP-valid'), 'extern.dump')
            self.assertTrue(Path(directory, '.imports', imported['token'] + '.dump').is_file())
            with self.assertRaisesRegex(ValueError, 'PostgreSQL-Custom-Backup'):
                backup_service.import_dump(io.BytesIO(b'plain sql'), 'invalid.sql')
            self.assertEqual(len(list(Path(directory, '.imports').glob('*.dump'))), 1)

    def test_restore_creates_safety_backup_first_and_deletes_successful_import(self):
        events = []
        integrity = Result()
        integrity.stdout = '20260815_01\n'
        def run(command, **kwargs):
            events.append(command[0])
            return integrity
        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.create_backup', side_effect=lambda: events.append('backup') or {'filename': 'safety.dump.gz'}), \
                patch('backup_service.validate_dump', side_effect=lambda *_: events.append('validation')), \
                patch('backup_service.subprocess.run', side_effect=run):
            imported = Path(directory, '.imports', 'a' * 32 + '.dump')
            imported.parent.mkdir()
            imported.write_bytes(b'PGDMP-valid')
            result = backup_service.restore_backup({'token': 'a' * 32})
            self.assertEqual(events, ['validation', 'backup', 'pg_restore', 'psql'])
            self.assertEqual(result['safetyBackup'], 'safety.dump.gz')
            self.assertFalse(imported.exists())


if __name__ == '__main__':
    unittest.main()
