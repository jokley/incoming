import os
import unittest
from unittest.mock import patch

from test_support import LOCAL_TEST_URL, postgres_test_url, validate_test_url


class TestDatabaseSafetyTest(unittest.TestCase):
    def test_local_target_is_normalized_to_psycopg(self):
        self.assertEqual(validate_test_url(LOCAL_TEST_URL, 'test'),
                         LOCAL_TEST_URL.replace('postgresql://', 'postgresql+psycopg://'))

    def test_unsafe_targets_fail_before_connecting(self):
        targets = [
            LOCAL_TEST_URL.replace('127.0.0.1', 'db.example.invalid'),
            LOCAL_TEST_URL.replace('/incoming_test', '/incoming'),
            LOCAL_TEST_URL.replace(':55432/', ':5432/'),
            LOCAL_TEST_URL.replace('incoming_test:', 'incoming:'),
            LOCAL_TEST_URL + '?host=db.example.invalid',
            LOCAL_TEST_URL + '?options=-csearch_path=other',
            'sqlite://', '', None, 'not a URL',
        ]
        for target in targets:
            with self.subTest(target=target), self.assertRaisesRegex(ValueError, 'Unsafe test target'):
                validate_test_url(target, 'test')
        for mode in ('production', 'development', '', None):
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                validate_test_url(LOCAL_TEST_URL, mode)

    def test_libpq_redirection_is_rejected(self):
        with patch.dict(os.environ, {'TEST_DATABASE_URL': LOCAL_TEST_URL,
                                     'FLASK_ENV': 'test', 'PGHOSTADDR': '192.0.2.1'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'libpq'):
                postgres_test_url()
