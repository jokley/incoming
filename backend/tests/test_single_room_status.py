import os
import sys
import tempfile
import unittest


DB_FILE = tempfile.NamedTemporaryFile(suffix='.db', delete=False).name
os.environ['DATABASE_PATH'] = DB_FILE
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app  # noqa: E402
from excel_import import PREVIEW_STORE, confirm_fis_import  # noqa: E402
from models import ImportApproval, ImportSession, Athlete, db  # noqa: E402


class SingleRoomStatusTest(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        with app.app_context():
            db.drop_all()
            db.create_all()

    @staticmethod
    def person(key, function='Official'):
        return {
            'matchKey': key, 'fisCode': key, 'firstname': key, 'lastname': 'Person',
            'nationCode': 'AUT', 'industryName': 'Big Air', 'gender': 'F',
            'function': function,
        }

    def test_import_persists_all_business_statuses_and_decision_reference(self):
        with app.app_context():
            session = ImportSession(nation='AUT')
            db.session.add(session)
            db.session.flush()
            decision = ImportApproval(
                session_id=session.id, nation='AUT', approval_type='NATION_APPROVED',
                description='Single Rooms', decision='APPROVED', username='test',
            )
            db.session.add(decision)
            db.session.commit()

            people = [self.person('NONE', 'Athlete'), self.person('QUOTA'),
                      self.person('APPROVED'), self.person('PENDING')]
            PREVIEW_STORE['status-test'] = {
                'errors': [], 'people': people,
                'rooms': [
                    {'person1Key': key, 'person2Key': None, 'roomType': 'Single'}
                    for key in ('QUOTA', 'APPROVED', 'PENDING')
                ],
                'quotaChecks': [{
                    'nationCode': 'AUT', 'discipline': 'Big Air', 'gender': 'F',
                    'singleRoomsAllowed': 1,
                }],
            }
            confirm_fis_import('status-test', {'APPROVED': decision.id})

            rows = {row.fis_code: row for row in Athlete.query.all()}
            self.assertEqual(rows['NONE'].single_room_status, 'NONE')
            self.assertEqual(rows['QUOTA'].single_room_status, 'IN_QUOTA')
            self.assertEqual(rows['APPROVED'].single_room_status, 'APPROVED_EXTRA')
            self.assertEqual(rows['APPROVED'].single_room_decision_id, decision.id)
            self.assertEqual(rows['PENDING'].single_room_status, 'PENDING_APPROVAL')
            self.assertIsNone(rows['PENDING'].single_room_decision_id)

    def test_person_api_exposes_snake_case_fields(self):
        with app.app_context():
            db.session.add(Athlete(firstname='Test', lastname='Person', nation_code='AUT'))
            db.session.commit()
            payload = app.test_client().get('/api/athletes').get_json()[0]
            self.assertEqual(payload['single_room_status'], 'NONE')
            self.assertIsNone(payload['single_room_decision_id'])


if __name__ == '__main__':
    unittest.main()
