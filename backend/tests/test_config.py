import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from config import RuntimeSettings


class ConfigTarget:
    def __init__(self):
        self.config = {}


class RuntimeSettingsTest(unittest.TestCase):
    def test_database_url_is_required(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(ValueError, 'DATABASE_URL is required'):
                RuntimeSettings.from_environment()

    def test_environment_is_parsed_once_and_applied_to_flask(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'DATABASE_URL': 'postgresql://incoming:secret@postgres/incoming',
            'CORS_ORIGINS': 'https://one.example, https://two.example',
            'AUTH_DEV_USER': 'developer',
            'LOG_LEVEL': 'warning',
            'FLASK_ENV': 'production',
        }, clear=True):
            settings = RuntimeSettings.from_environment(Path(directory))
            app = ConfigTarget()
            settings.apply(app)

        self.assertEqual(settings.cors_origins, ('https://one.example', 'https://two.example'))
        self.assertEqual(app.config['AUTH_DEV_USER'], 'developer')
        self.assertEqual(app.config['LOG_LEVEL'], 'WARNING')
        self.assertEqual(app.config['RUNTIME_ENV'], 'production')
        self.assertEqual(app.config['SQLALCHEMY_DATABASE_URI'],
                         'postgresql+psycopg://incoming:secret@postgres/incoming')
        self.assertNotIn('DATABASE_BACKEND', app.config)

    def test_database_url_rejects_other_schemes(self):
        with patch.dict(os.environ, {'DATABASE_URL': 'mysql://localhost/incoming'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'postgresql://'):
                RuntimeSettings.from_environment()


if __name__ == '__main__':
    unittest.main()
