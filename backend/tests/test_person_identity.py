import os
import sys
import unittest

database_url = os.environ.get('TEST_DATABASE_URL')
if not database_url:
    raise unittest.SkipTest('TEST_DATABASE_URL is required for database integration tests')
os.environ['DATABASE_URL'] = database_url

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app  # noqa: E402
from excel_import import _build_existing_athlete_maps, _find_existing_athlete  # noqa: E402
from models import Athlete, db  # noqa: E402


class PersonIdentityTest(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        with app.app_context():
            db.drop_all()
            db.create_all()
            db.session.add_all([
                Athlete(firstname='Evan', lastname='Miller', nation_code='USA', fis_code=' 123 ', discipline='Big Air'),
                Athlete(firstname='Evan', lastname='Miller', nation_code='USA', fis_code='123', discipline='Slopestyle'),
            ])
            db.session.commit()

    def test_import_matching_uses_fis_identity(self):
        with app.app_context():
            match = _find_existing_athlete({'fisCode': '123', 'competitorId': 'different'}, _build_existing_athlete_maps())
            self.assertIsNotNone(match)
            self.assertEqual(match.fis_code.strip(), '123')

    def test_athlete_endpoint_aggregates_legacy_rows_by_fis_identity(self):
        response = app.test_client().get('/api/athletes')
        self.assertEqual(response.status_code, 200)
        people = response.get_json()
        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]['fisCode'].strip(), '123')
        self.assertEqual(people[0]['disciplines'], ['Big Air', 'Slopestyle'])
        self.assertEqual(len(people[0]['sourceRecordIds']), 2)


if __name__ == '__main__':
    unittest.main()
