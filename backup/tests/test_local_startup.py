"""Local-only routing must not inherit production connection settings."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import dev_local
import backup_service


class LocalStartupTest(unittest.TestCase):
    def test_rejects_nonlocal_targets_and_connection_options(self):
        unsafe = [
            dev_local.LOCAL_TEST_URL.replace('127.0.0.1', 'production.example'),
            dev_local.LOCAL_TEST_URL.replace('55432', '5432'),
            dev_local.LOCAL_TEST_URL.replace('/incoming_test', '/incoming'),
            dev_local.LOCAL_TEST_URL.replace('incoming_test:', 'incoming:'),
            dev_local.LOCAL_TEST_URL + '?host=production.example',
            dev_local.LOCAL_TEST_URL + '?service=production',
            'sqlite:///local.db',
        ]
        for url in unsafe:
            with self.subTest(url=url), self.assertRaises(ValueError):
                dev_local.local_environment({'DATABASE_URL': url}, {})

    def test_scrubs_inherited_routes_secrets_and_proxies(self):
        inherited = dict(PGHOSTADDR='203.0.113.1', PGSERVICE='production',
                         PGOPTIONS='unsafe', POSTGRES_HOST='production',
                         POSTGRES_PASSWORD='secret', DATABASE_URL='production',
                         AUTH_PROXY_SECRET='secret', BACKUP_DIR='/production',
                         BACKUP_SERVICE_URL='https://production', BACKUP_ENABLED='true',
                         HTTP_PROXY='https://production', PYTHONPATH='/other/code')
        env = dev_local.local_environment({}, inherited)
        for key in ('PGHOSTADDR', 'PGSERVICE', 'PGOPTIONS', 'HTTP_PROXY', 'PYTHONPATH'):
            self.assertNotIn(key, env)
        self.assertEqual(env['POSTGRES_HOST'], '127.0.0.1')
        self.assertEqual(env['POSTGRES_PORT'], '55432')
        self.assertEqual(env['POSTGRES_DB'], 'incoming_test')
        self.assertEqual(env['POSTGRES_PASSWORD'], 'incoming_test')
        self.assertEqual(env['BACKUP_SERVICE_URL'], 'http://127.0.0.1:58080')
        self.assertEqual(env['AUTH_PROXY_SECRET'], '')
        self.assertEqual(env['BACKUP_ENABLED'], 'false')
        self.assertEqual(env['FLASK_ENV'], 'development')
        self.assertTrue(Path(env['BACKUP_DIR']).is_relative_to(dev_local.ROOT))

    def test_local_file_cannot_override_service_routing(self):
        for values in ({'POSTGRES_HOST': 'production'}, {'BACKUP_SERVICE_URL': 'https://production'},
                       {'VITE_API_URL': 'https://production/api'}):
            with self.subTest(values=values), self.assertRaises(ValueError):
                dev_local.local_environment(values, {})

    def test_loopback_alias_uses_same_listener_for_backend_and_service(self):
        env = dev_local.local_environment(
            {'DATABASE_URL': dev_local.LOCAL_TEST_URL.replace('127.0.0.1', 'localhost')}, {})
        self.assertIn('@127.0.0.1:55432/incoming_test', env['DATABASE_URL'])
        self.assertEqual(env['POSTGRES_HOST'], '127.0.0.1')

    def test_listener_is_loopback_locally_and_preserves_production_default(self):
        with patch.object(backup_service, 'config'), \
                patch.dict(os.environ, {'BACKUP_ENABLED': 'false'}, clear=True), \
                patch.object(backup_service, 'ThreadingHTTPServer') as server:
            backup_service.serve(host='127.0.0.1', port=58080)
            self.assertEqual(server.call_args.args[0], ('127.0.0.1', 58080))
            backup_service.serve()
            self.assertEqual(server.call_args.args[0], ('0.0.0.0', 8080))
