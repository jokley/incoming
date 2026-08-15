import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from models import db  # noqa: E402


class AlembicConfigurationTest(unittest.TestCase):
    def test_model_metadata_is_exposed(self):
        self.assertIn('audit_event', db.metadata.tables)
        self.assertIn('import_session', db.metadata.tables)

    def test_offline_sql_uses_runtime_sqlite_configuration(self):
        with tempfile.TemporaryDirectory() as directory:
            environment = os.environ.copy()
            environment.update({
                'DATABASE_BACKEND': 'sqlite',
                'DATABASE_PATH': str(Path(directory) / 'migration-test.sqlite'),
            })
            result = subprocess.run(
                [sys.executable, '-m', 'alembic', '-c', 'alembic.ini', 'upgrade', 'head', '--sql'],
                cwd=BACKEND_DIR,
                env=environment,
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((Path(directory) / 'migration-test.sqlite').exists())


if __name__ == '__main__':
    unittest.main()
