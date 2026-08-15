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
    def test_defaults_are_derived_from_backend_directory(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            settings = RuntimeSettings.from_environment(Path(directory))

        self.assertEqual(settings.data_dir, Path(directory) / 'data')
        self.assertEqual(settings.database_backend, 'sqlite')
        self.assertEqual(settings.database_path, Path(directory) / 'data' / 'freestyle_wm_new.db')
        self.assertEqual(settings.cors_origins, ())
        self.assertEqual(settings.log_level, 'INFO')

    def test_environment_is_parsed_once_and_applied_to_flask(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'APP_DATA_DIR': f'{directory}/state',
            'DATABASE_PATH': f'{directory}/database.sqlite',
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
        self.assertTrue(app.config['SQLALCHEMY_DATABASE_URI'].endswith('/database.sqlite'))
        self.assertEqual(app.config['DATABASE_BACKEND'], 'sqlite')

    def test_postgresql_database_url_is_normalized_for_psycopg(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {
            'DATABASE_BACKEND': 'postgresql',
            'DATABASE_URL': 'postgresql://incoming:secret@postgres/incoming',
        }, clear=True):
            settings = RuntimeSettings.from_environment(Path(directory))
            app = ConfigTarget()
            settings.apply(app)

        self.assertEqual(settings.database_backend, 'postgresql')
        self.assertEqual(
            app.config['SQLALCHEMY_DATABASE_URI'],
            'postgresql+psycopg://incoming:secret@postgres/incoming',
        )

    def test_postgresql_requires_database_url(self):
        with patch.dict(os.environ, {'DATABASE_BACKEND': 'postgresql'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'DATABASE_URL is required'):
                RuntimeSettings.from_environment()

    def test_unknown_database_backend_is_rejected(self):
        with patch.dict(os.environ, {'DATABASE_BACKEND': 'mysql'}, clear=True):
            with self.assertRaisesRegex(ValueError, 'DATABASE_BACKEND'):
                RuntimeSettings.from_environment()


if __name__ == '__main__':
    unittest.main()
