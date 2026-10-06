import os
from pathlib import Path
import subprocess
import sys
import unittest

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from alembic.config import Config
from alembic.script import ScriptDirectory

from models import Athlete, db  # noqa: E402


class AlembicConfigurationTest(unittest.TestCase):
    def test_model_metadata_is_exposed(self):
        self.assertIn('audit_event', db.metadata.tables)
        self.assertIn('import_session', db.metadata.tables)

    def test_athlete_model_matches_baseline_without_comment_column(self):
        athlete_columns = db.metadata.tables['athlete'].columns
        self.assertNotIn('comment', athlete_columns)

        # Exercise the ORM projection used by Athlete.query.all(), rather than
        # only checking migration text. A mapped comment attribute would show
        # up here as ``athlete.comment`` and break /api/athletes in production.
        athlete_select = str(db.select(Athlete).compile())
        self.assertNotIn('athlete.comment', athlete_select)
        self.assertIn('athlete.additional_items', athlete_select)

    def test_athlete_serialization_does_not_access_removed_comment(self):
        athlete = Athlete(
            id=1,
            lastname='Muster',
            firstname='Mia',
            nation_code='SUI',
            additional_items='Bestehende Athletenbemerkung',
        )

        payload = athlete.to_dict()

        self.assertNotIn('comment', payload)
        self.assertEqual(payload['additionalItems'], 'Bestehende Athletenbemerkung')

    def test_offline_sql_uses_postgresql_configuration(self):
        environment = os.environ.copy()
        environment['DATABASE_URL'] = 'postgresql://incoming_test:incoming_test@127.0.0.1:55432/incoming_test'
        result = subprocess.run(
            [sys.executable, '-m', 'alembic', '-c', 'alembic.ini', 'upgrade', 'head', '--sql'],
            cwd=BACKEND_DIR,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('CREATE TABLE', result.stdout)
        self.assertIn('ALTER TABLE hotel ADD COLUMN contact_person', result.stdout)
        self.assertIn('ALTER TABLE hotel ADD COLUMN email', result.stdout)
        self.assertIn('ALTER TABLE hotel ADD COLUMN phone', result.stdout)
        self.assertIn('ALTER TABLE hotel_room_inventory ADD COLUMN comment', result.stdout)
        self.assertIn('ALTER TABLE athlete ADD COLUMN import_change_details_json', result.stdout)

    def test_single_head_retains_import_change_details_revision(self):
        environment = os.environ.copy()
        environment['DATABASE_URL'] = 'postgresql://incoming_test:incoming_test@127.0.0.1:55432/incoming_test'
        result = subprocess.run(
            [sys.executable, '-m', 'alembic', '-c', 'alembic.ini', 'heads'],
            cwd=BACKEND_DIR,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        scripts = ScriptDirectory.from_config(Config(str(BACKEND_DIR / 'alembic.ini')))
        self.assertEqual(len(scripts.get_heads()), 1)
        self.assertEqual(result.stdout.strip(), f'{scripts.get_current_head()} (head)')
        self.assertIn('20260818_02', {revision.revision for revision in scripts.walk_revisions()})


if __name__ == '__main__':
    unittest.main()
