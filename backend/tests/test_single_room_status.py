import os
import sys
import unittest


database_url = os.environ.get('TEST_DATABASE_URL')
if not database_url:
    raise unittest.SkipTest('TEST_DATABASE_URL is required for database integration tests')
os.environ['DATABASE_URL'] = database_url

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app  # noqa: E402
from excel_import import (PREVIEW_STORE, apply_preserved_single_room_approvals,
                          apply_single_room_entitlement_preview, confirm_fis_import,
                          preserved_single_room_approvals)  # noqa: E402
from models import ImportApproval, ImportSession, Athlete, Competition, Event, db  # noqa: E402


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
            event = Event(name='Status Test', active=True)
            db.session.add(event)
            db.session.commit()

            people = [self.person('NONE', 'Athlete'), self.person('QUOTA'),
                      self.person('APPROVED'), self.person('PENDING')]
            PREVIEW_STORE['status-test'] = {
                'errors': [], 'eventId': event.id, 'people': people,
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

    def test_continuous_approved_request_covers_preview_excess(self):
        with app.app_context():
            patrick = Athlete(
                fis_code='P1', firstname='Patrick', lastname='Burgener', nation_code='BRA',
                discipline='Snowboard Halfpipe', gender='M', function='Official',
                single_room_status='APPROVED_EXTRA', single_room_entitlement='APPROVED_EXTRA')
            db.session.add(patrick)
            db.session.commit()
            people = [{**self.person('P1'), 'firstname': 'Patrick', 'lastname': 'Burgener',
                       'nationCode': 'BRA', 'industryName': 'Snowboard Halfpipe', 'gender': 'M'}]
            rooms = [{'person1Key': 'P1', 'person2Key': None, 'roomType': 'Single'}]
            warnings = [{'code': 'QUOTA_SINGLE_ROOMS_EXCEEDED', 'details': {
                'nationCode': 'BRA', 'discipline': 'Snowboard Halfpipe', 'gender': 'M',
                'importedSingleRooms': 3, 'singleRoomsAllowed': 2, 'excessCount': 1,
                'singleRoomCandidates': [{'personKey': 'P1', 'name': 'Patrick Burgener'}],
            }}]

            preserved = preserved_single_room_approvals(people, rooms)
            apply_preserved_single_room_approvals(warnings, preserved)
            apply_single_room_entitlement_preview(people, rooms, [{
                'nationCode': 'BRA', 'discipline': 'Snowboard Halfpipe', 'gender': 'M',
                'singleRoomsAllowed': 2,
            }], preserved)

            self.assertEqual(set(preserved), {'P1'})
            self.assertEqual(people[0]['singleRoomEntitlement'], 'APPROVED_EXTRA')
            self.assertEqual(warnings[0]['details']['approvedExtraCount'], 1)
            self.assertEqual(warnings[0]['details']['openExcessCount'], 0)

            event = Event(name='Preservation Test', active=True)
            db.session.add(event)
            db.session.commit()
            PREVIEW_STORE['preservation-test'] = {
                'errors': [], 'eventId': event.id, 'people': people, 'rooms': rooms,
                'quotaChecks': [{'nationCode': 'BRA', 'discipline': 'Snowboard Halfpipe',
                                 'gender': 'M', 'singleRoomsAllowed': 2}],
            }
            confirm_fis_import('preservation-test')
            refreshed = Athlete.query.filter_by(fis_code='P1').one()
            self.assertEqual(refreshed.single_room_status, 'APPROVED_EXTRA')

    def test_removed_or_non_single_request_is_not_preserved_and_cannot_revive(self):
        with app.app_context():
            patrick = Athlete(
                fis_code='P1', firstname='Patrick', lastname='Burgener', nation_code='BRA',
                discipline='Snowboard Halfpipe', gender='M', function='Official',
                single_room_status='APPROVED_EXTRA')
            db.session.add(patrick)
            db.session.commit()
            person = {**self.person('P1'), 'nationCode': 'BRA',
                      'industryName': 'Snowboard Halfpipe', 'gender': 'M'}
            self.assertEqual(preserved_single_room_approvals([], []), {})
            self.assertEqual(preserved_single_room_approvals(
                [person], [{'person1Key': 'P1', 'person2Key': 'OTHER', 'roomType': 'Double'}]), {})

            # This is the active state written by the intervening full snapshot.
            patrick.single_room_status = 'NONE'
            db.session.commit()
            self.assertEqual(preserved_single_room_approvals(
                [person], [{'person1Key': 'P1', 'person2Key': None, 'roomType': 'Single'}]), {})

    def test_multi_competition_preservation_deduplicates_quota_discipline(self):
        with app.app_context():
            moguls = Competition(import_code='MO', code='MO', name='Moguls', display_name='Moguls',
                                 sport='Freestyle', gender='M', quota_discipline='Moguls')
            dual = Competition(import_code='DM', code='DM', name='Dual Moguls', display_name='Dual Moguls',
                               sport='Freestyle', gender='M', quota_discipline='Moguls')
            aerials = Competition(import_code='AE', code='AE', name='Aerials', display_name='Aerials',
                                  sport='Freestyle', gender='M', quota_discipline='Aerials')
            session = ImportSession(nation='BRA')
            db.session.add(session)
            db.session.flush()
            decision = ImportApproval(
                session_id=session.id, nation='BRA', approval_type='NATION_APPROVED',
                description='Single Rooms', decision='APPROVED', username='test',
                quota_details_json='{"nationCode":"BRA","discipline":"Moguls","gender":"M"}')
            db.session.add(decision)
            db.session.flush()
            athlete = Athlete(fis_code='P1', firstname='Pat', lastname='One', nation_code='BRA',
                              discipline='Moguls', gender='M', function='Athlete',
                              single_room_status='APPROVED_EXTRA', single_room_decision_id=decision.id,
                              competitions=[moguls, dual, aerials])
            db.session.add(athlete)
            db.session.commit()
            person = {**self.person('P1', 'Athlete'), 'nationCode': 'BRA', 'gender': 'M',
                      'industryName': 'Moguls', 'quotaDisciplines': ['Moguls', 'Moguls', 'Aerials']}
            preserved = preserved_single_room_approvals(
                [person], [{'person1Key': 'P1', 'person2Key': None, 'roomType': 'Single'}])

            self.assertEqual(preserved['P1']['groups'], {('BRA', 'Moguls', 'M')})
            self.assertNotIn(('BRA', 'Aerials', 'M'), preserved['P1']['groups'])


if __name__ == '__main__':
    unittest.main()
