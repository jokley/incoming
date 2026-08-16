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
    def environment(self, directory):
        return patch.dict(os.environ, {'POSTGRES_DB': 'incoming', 'POSTGRES_USER': 'incoming',
            'POSTGRES_PASSWORD': 'secret', 'BACKUP_DIR': directory}, clear=True)

    def fake_run(self, command, **kwargs):
        if command[0] == 'pg_dump':
            kwargs['stdout'].write(b'PGDMP-dump-content')
            return Result()
        return Result()

    def test_creates_postgresql_custom_dump_without_additional_compression(self):
        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.subprocess.run', side_effect=self.fake_run):
            payload = backup_service.create_backup('manual')
            dump = Path(directory, 'manual', payload['filename'])
            self.assertEqual(dump.read_bytes(), b'PGDMP-dump-content')
            self.assertEqual(json.loads(Path(directory, 'last-backup.json').read_text())['status'], 'success')

    def test_each_category_keeps_only_its_two_newest_dumps(self):
        with tempfile.TemporaryDirectory() as directory, self.environment(directory):
            category = Path(directory, 'automatic')
            category.mkdir()
            for number in range(4):
                path = category / f'incoming-{number}.dump.gz'
                path.write_bytes(b'x')
                os.utime(path, (number, number))
            backup_service.keep_latest_backups(category)
            self.assertEqual(sorted(path.name for path in category.glob('*.dump.gz')),
                             ['incoming-2.dump.gz', 'incoming-3.dump.gz'])

    def test_failure_writes_error_status(self):
        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.subprocess.run', side_effect=OSError('unavailable')):
            with self.assertRaises(OSError):
                backup_service.create_backup('automatic')
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

    def test_limited_reader_stops_at_http_content_length(self):
        source = io.BytesIO(b'PGDMP-next-request')
        body = backup_service.LimitedReader(source, 5)
        self.assertEqual(body.read(1024), b'PGDMP')
        self.assertEqual(body.read(1024), b'')
        self.assertEqual(source.read(), b'-next-request')

    def test_restore_creates_safety_backup_first_and_deletes_successful_import(self):
        events = []
        integrity = Result()
        integrity.stdout = '20260815_01\n'
        def run(command, **kwargs):
            events.append(command[0])
            return integrity
        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.create_backup', side_effect=lambda category: events.append(f'backup:{category}') or {'filename': 'safety.dump.gz'}), \
                patch('backup_service.validate_dump', side_effect=lambda *_: events.append('validation')), \
                patch('backup_service.subprocess.run', side_effect=run):
            imported = Path(directory, '.imports', 'a' * 32 + '.dump')
            imported.parent.mkdir()
            imported.write_bytes(b'PGDMP-valid')
            result = backup_service.restore_backup({'token': 'a' * 32})
            self.assertEqual(events, ['validation', 'backup:pre-restore', 'psql', 'pg_restore', 'psql'])
            self.assertEqual(result['safetyBackup'], 'safety.dump.gz')
            self.assertFalse(imported.exists())

    def test_server_restore_uses_custom_dump_directly_without_decompression(self):
        commands = []
        integrity = Result()
        integrity.stdout = '20260815_01\n'

        def run(command, **kwargs):
            commands.append(command)
            return integrity

        with tempfile.TemporaryDirectory() as directory, self.environment(directory), \
                patch('backup_service.create_backup', return_value={'filename': 'safety.dump.gz'}), \
                patch('backup_service.subprocess.run', side_effect=run):
            dump = Path(directory, 'manual', 'incoming-2026-08-16_152043.dump.gz')
            dump.parent.mkdir()
            dump.write_bytes(b'PGDMP-valid')

            backup_service.restore_backup({'category': 'manual', 'filename': dump.name, 'token': None})

            restore = next(command for command in commands if command[0] == 'pg_restore'
                           and '--list' not in command)
            self.assertEqual(restore[-1], str(dump))


if __name__ == '__main__':
    unittest.main()
