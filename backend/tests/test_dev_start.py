"""The LOCAL launcher rejects PROD and libpq routing overrides before connecting."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('dev_start', Path(__file__).resolve().parents[2] / 'scripts/dev-start.py')
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class DevTargetTest(unittest.TestCase):
    def test_only_explicit_shared_test_targets_are_allowed(self):
        env = dict(DATABASE_URL='postgresql://incoming_test:dummy@incoming-test-postgres:5432/incoming_test',
                   POSTGRES_USER='incoming_test', POSTGRES_HOST='incoming-test-postgres',
                   POSTGRES_PORT='5432', POSTGRES_DB='incoming_test', BACKUP_DIR='/backups',
                   BACKUP_SERVICE_URL='http://incoming-test-backup:8080')
        dev.validate_targets(env)
        for change in [
            {'DATABASE_URL': 'postgresql://incoming_test:dummy@postgres:5432/incoming_test'},
            {'DATABASE_URL': env['DATABASE_URL'].replace('/incoming_test', '/incoming')},
            {'DATABASE_URL': env['DATABASE_URL'] + '?host=prod'},
            {'DATABASE_URL': env['DATABASE_URL'].replace(':5432/', ':5433/')},
            {'POSTGRES_HOST': 'incoming-prod-postgres'},
            {'POSTGRES_DB': 'incoming'}, {'PGHOSTADDR': '127.0.0.1'},
            {'PGSERVICE': 'prod'}, {'BACKUP_SERVICE_URL': 'http://backup:8080'},
            {'BACKUP_DIR': '/tmp/backups'},
        ]:
            with self.subTest(keys=list(change)):
                with self.assertRaises(ValueError):
                    dev.validate_targets({**env, **change})


    def test_frontend_start_keeps_listener_and_only_suppresses_info_output(self):
        with patch.object(dev, 'environment', return_value={'PATH': '/bin'}), \
                patch.object(dev, 'preflight'), patch.object(dev.os, 'chdir'), \
                patch.dict(dev.os.environ, {}, clear=True), \
                patch.object(dev.sys, 'argv', ['dev-start.py', 'frontend']), \
                patch.object(dev.os, 'execvpe') as execute:
            dev.main()
        command = execute.call_args.args[1]
        self.assertEqual(command, ['pnpm', 'dev', '--host', '127.0.0.1', '--port', '5173',
                                   '--strictPort', '--logLevel', 'warn', '--clearScreen', 'false'])
