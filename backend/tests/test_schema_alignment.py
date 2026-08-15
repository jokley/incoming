import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


BACKEND_DIR = Path(__file__).resolve().parents[1]
LEGACY_DATABASE = BACKEND_DIR / 'data' / 'freestyle_wm_new.db'


class SchemaAlignmentTest(unittest.TestCase):
    def _run_alignment_probe(self, database_path: Path):
        environment = os.environ.copy()
        environment.update({
            'DATABASE_BACKEND': 'sqlite',
            'DATABASE_PATH': str(database_path),
        })
        script = r'''
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import inspect, text

from app import app
from models import db

with app.app_context():
    inspector = inspect(db.engine)
    assert set(inspector.get_table_names()) == set(db.metadata.tables)
    for table_name in ('audit_event', 'athlete', 'event', 'room_booking'):
        assert all(column.get('default') is None for column in inspector.get_columns(table_name))
    assert 'ck_athlete_single_room_status' in {
        item.get('name') for item in inspector.get_check_constraints('athlete')
    }
    assert any(
        item.get('constrained_columns') == ['single_room_decision_id']
        and item.get('referred_table') == 'import_approval'
        for item in inspector.get_foreign_keys('athlete')
    )
    assert not db.session.execute(text('PRAGMA foreign_key_check')).fetchall()
    context = MigrationContext.configure(db.engine.connect(), opts={
        'compare_type': True,
        'compare_server_default': True,
        'render_as_batch': True,
    })
    differences = compare_metadata(context, db.metadata)
    assert differences == [], differences
'''
        return subprocess.run(
            [sys.executable, '-c', script], cwd=BACKEND_DIR, env=environment,
            capture_output=True, text=True, check=False,
        )

    def test_checked_in_legacy_database_aligns_to_metadata_with_null_diff(self):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / 'legacy.sqlite'
            shutil.copy2(LEGACY_DATABASE, database_path)
            result = self._run_alignment_probe(database_path)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_alignment_is_idempotent(self):
        with tempfile.TemporaryDirectory() as directory:
            database_path = Path(directory) / 'legacy.sqlite'
            shutil.copy2(LEGACY_DATABASE, database_path)
            first = self._run_alignment_probe(database_path)
            self.assertEqual(first.returncode, 0, first.stderr)
            second = self._run_alignment_probe(database_path)
            self.assertEqual(second.returncode, 0, second.stderr)


if __name__ == '__main__':
    unittest.main()
