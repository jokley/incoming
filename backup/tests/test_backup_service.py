import gzip
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import sys
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


if __name__ == '__main__':
    unittest.main()
