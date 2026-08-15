import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


BACKEND_DIR = Path(__file__).resolve().parents[1]


class ProductionBaselineTest(unittest.TestCase):
    def _alembic(self, database: Path, *arguments: str):
        environment = os.environ.copy()
        environment.update({
            'DATABASE_BACKEND': 'sqlite',
            'DATABASE_PATH': str(database),
        })
        return subprocess.run(
            [sys.executable, '-m', 'alembic', '-c', 'alembic.ini', *arguments],
            cwd=BACKEND_DIR,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_upgrade_downgrade_reupgrade_and_metadata_null_diff(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'baseline.sqlite'
            for arguments in (('upgrade', 'head'), ('downgrade', 'base'), ('upgrade', 'head')):
                result = self._alembic(database, *arguments)
                self.assertEqual(result.returncode, 0, result.stderr)

            environment = os.environ.copy()
            environment.update({
                'DATABASE_BACKEND': 'sqlite',
                'DATABASE_PATH': str(database),
            })
            probe = subprocess.run(
                [sys.executable, '-c', r'''
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine
from models import db

engine = create_engine('sqlite:///' + __import__('os').environ['DATABASE_PATH'])
with engine.connect() as connection:
    context = MigrationContext.configure(connection, opts={
        'compare_type': True,
        'compare_server_default': True,
        'render_as_batch': True,
    })
    assert compare_metadata(context, db.metadata) == []
'''], cwd=BACKEND_DIR, env=environment, capture_output=True, text=True, check=False,
            )
            self.assertEqual(probe.returncode, 0, probe.stderr)

    def test_offline_sql_contains_the_baseline_without_connecting(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / 'must-not-exist.sqlite'
            result = self._alembic(database, 'upgrade', 'head', '--sql')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('CREATE TABLE', result.stdout)
            self.assertFalse(database.exists())


if __name__ == '__main__':
    unittest.main()
