"""Offline checks: automated tests never consume the shared TEST/LOCAL env."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import test_backend
import dev_local


class TestEnvironmentIsolation(unittest.TestCase):
    def test_shared_environment_cannot_redirect_destructive_tests(self):
        shared = dict(DATABASE_URL='postgresql://shared:secret@incoming-test-postgres/shared',
                      POSTGRES_HOST='incoming-test-postgres', POSTGRES_PASSWORD='secret',
                      BACKUP_SERVICE_URL='http://incoming-test-backup:8080',
                      BACKUP_DIR='/backups', AUTH_PROXY_SECRET='secret',
                      OPERATIONAL_EVENT_ID='99', EVENT_OWNERSHIP_PLAN='/shared/plan.json')
        with patch.dict(os.environ, shared, clear=True), \
                patch.object(Path, 'read_text', side_effect=AssertionError('No env file reads')), \
                patch.object(Path, 'write_text', side_effect=AssertionError('No env file creation')):
            env = test_backend.environment(True)
        self.assertIn('@127.0.0.1:55432/incoming_test', env['DATABASE_URL'])
        self.assertEqual(env['TEST_DATABASE_URL'], env['DATABASE_URL'])
        self.assertEqual(env['FLASK_ENV'], 'test')
        self.assertEqual(env['AUTH_PROXY_SECRET'], '')
        self.assertNotIn('POSTGRES_HOST', env)
        self.assertNotIn('POSTGRES_PASSWORD', env)
        self.assertNotIn('OPERATIONAL_EVENT_ID', env)
        self.assertNotIn('EVENT_OWNERSHIP_PLAN', env)

    def test_legacy_launcher_never_creates_another_local_env(self):
        with patch.object(Path, 'read_text', side_effect=AssertionError('No env reads')), \
                self.assertRaisesRegex(ValueError, 'incoming.test.env'):
            dev_local.configure()
