"""Small HTTP contracts complementing planning/quota/person workflow tests."""
import io
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url

os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from competitions import COMPETITIONS
from excel_import import PREVIEW_STORE, PREVIEW_TTL_SECONDS, confirm_fis_import
from models import (db, Athlete, AuditEvent, Competition, Event, EventCompetition, Hotel, ImportApproval,
                    ImportRun, ImportSession, ImportSessionEvent, ImportSessionVersion,
                    RoomBooking, RoomType)
from scenario_generator import generate_scenario


class ApiCharacterizationTest(unittest.TestCase):
    def setUp(self):
        saved_config = patch.dict(app.config)
        saved_config.start()
        self.addCleanup(saved_config.stop)
        configure_test_app(app)
        PREVIEW_STORE.clear()
        self.addCleanup(PREVIEW_STORE.clear)
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.editor = {'X-Authenticated-User': 'editor',
                       'X-Authenticated-Groups': 'incoming-editor'}
        self.viewer = {'X-Authenticated-User': 'viewer',
                       'X-Authenticated-Groups': 'incoming-viewer'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    def assert_json(self, response, status, payload):
        self.assertEqual(response.status_code, status, response.get_data(as_text=True))
        self.assertEqual(response.mimetype, 'application/json')
        self.assertEqual(response.get_json(), payload)

    def test_hotel_inventory_contract_and_delete(self):
        created = self.client.post('/api/hotels', json={'name': 'Baseline Hotel',
            'contactPerson': 'Desk', 'comment': 'Accessible'}, headers=self.editor)
        self.assertEqual(created.status_code, 201)
        hotel_id = created.get_json()['id']
        self.assertIsInstance(hotel_id, str)
        expected = {'id': hotel_id, 'name': 'Baseline Hotel', 'location': None,
            'region': None, 'contactPerson': 'Desk', 'email': None, 'phone': None,
            'comment': 'Accessible', 'roomInventories': []}
        self.assert_json(created, 201, expected)
        with app.app_context():
            room_type = RoomType(name='Double', max_persons=2)
            db.session.add(room_type)
            db.session.commit()
            type_id = str(room_type.id)
        inventory = self.client.post(f'/api/hotels/{hotel_id}/inventory', json={
            'roomTypeId': type_id, 'availableFrom': '2027-03-01',
            'availableUntil': '2027-03-15', 'roomCount': '4', 'hasHalfBoard': True})
        self.assertEqual(inventory.status_code, 201)
        inventory_id = inventory.get_json()['id']
        expected['roomInventories'] = [{'id': inventory_id, 'hotelId': hotel_id,
            'roomType': {'id': type_id, 'name': 'Double', 'maxPersons': 2},
            'availableFrom': '2027-03-01', 'availableUntil': '2027-03-15',
            'roomCount': 4, 'hasHalfBoard': True, 'hasSR': False, 'comment': None}]
        self.assert_json(inventory, 201, expected['roomInventories'][0])
        for path in ['/api/hotels', '/api/hotels/', '/hotels', '/hotels/']:
            self.assert_json(self.client.get(path, headers=self.viewer), 200, [expected])
        for prefix in ['/api/hotels', '/hotels']:
            for suffix in ['', '/']:
                self.assert_json(self.client.get(f'{prefix}/{hotel_id}{suffix}'), 200, expected)
        expected['name'] = 'Updated Hotel'
        self.assert_json(self.client.put(f'/api/hotels/{hotel_id}',
            json={'name': 'Updated Hotel'}, headers=self.editor), 200, expected)
        deleted = self.client.delete(f'/api/hotels/{hotel_id}', headers=self.editor)
        self.assertEqual((deleted.status_code, deleted.data), (204, b''))
        missing = self.client.get(f'/api/hotels/{hotel_id}')
        self.assertEqual((missing.status_code, missing.mimetype), (404, 'text/html'))

    def test_unauthenticated_hotel_mutations_are_rejected_without_writes(self):
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET=''):
            for path in ['/api/hotels', '/api/hotels/', '/hotels', '/hotels/']:
                self.assert_json(self.client.post(path, json={'name': 'Denied'}), 401,
                    {'error': 'UNAUTHENTICATED', 'message': 'Authentication required'})
        with app.app_context():
            self.assertEqual(Hotel.query.count(), 0)
            self.assertEqual(AuditEvent.query.count(), 0)
        canonical = self.client.post('/api/hotels', json={'name': 'Audited Hotel'},
            headers={**self.editor, 'X-Request-ID': 'baseline-request'})
        self.assertEqual(canonical.status_code, 201)
        self.assertEqual(canonical.headers['X-Request-ID'], 'baseline-request')
        with app.app_context():
            audit = AuditEvent.query.one()
            self.assertEqual((audit.username, audit.path, audit.request_id),
                             ('editor', '/api/hotels', 'baseline-request'))

    def test_all_mutating_aliases_match_canonical_responses_and_audits(self):
        baseline = None
        # Recreate the guarded test schema so response/entity IDs are identical
        # across transports. Every real mutating legacy handler is exercised.
        for prefix, suffix in [('/api', ''), ('', ''), ('', '/'), ('/api', '/')]:
            with self.subTest(prefix=prefix, suffix=suffix), patch.dict(
                    app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='baseline-secret'):
                with app.app_context():
                    db.session.remove()
                    db.drop_all()
                    db.create_all()
                observations = []

                def mutate(method, path, body=None, status=200):
                    url = prefix + path + suffix
                    for headers, denied in [({}, 401),
                            ({**self.viewer, 'X-Auth-Proxy-Secret': 'baseline-secret'}, 403)]:
                        response = self.client.open(url, method=method, json=body, headers=headers)
                        self.assertEqual(response.status_code, denied)
                    with app.app_context():
                        self.assertEqual(AuditEvent.query.count(), len(observations))
                    response = self.client.open(url, method=method, json=body, headers={
                        **self.editor, 'X-Auth-Proxy-Secret': 'baseline-secret',
                        'X-Request-ID': 'alias-audit-test'})
                    self.assertEqual(response.status_code, status, response.get_data(as_text=True))
                    self.assertEqual(response.headers['X-Request-ID'], 'alias-audit-test')
                    with app.app_context():
                        self.assertEqual(AuditEvent.query.count(), len(observations) + 1)
                        audit = AuditEvent.query.order_by(AuditEvent.id.desc()).first().to_dict()
                    self.assertEqual(audit['path'], url)
                    self.assertEqual(audit['method'], method)
                    self.assertEqual(audit['username'], 'editor')
                    self.assertEqual(audit['requestId'], 'alias-audit-test')
                    self.assertTrue(audit['entityRefs'])
                    self.assertTrue(audit['entityLabel'])
                    for key in ['id', 'createdAt', 'path']:
                        audit.pop(key)
                    result = response.get_json(silent=True)
                    observations.append((status, result, audit))
                    return result

                room_type = mutate('POST', '/room-types', {'name': 'Double', 'maxPersons': 2}, 201)
                type_id = room_type['id']
                hotel = mutate('POST', '/hotels', {'name': 'Audit Hotel'}, 201)
                hotel_id = hotel['id']
                inventory_payload = {'roomTypeId': type_id, 'availableFrom': '2027-03-01',
                    'availableUntil': '2027-03-20', 'roomCount': 3}
                inventory = mutate('POST', f'/hotels/{hotel_id}/inventory', inventory_payload, 201)
                inventory_id = inventory['id']
                athlete = mutate('POST', '/athletes', {'firstname': 'Lina', 'lastname': 'Frei',
                    'nationCode': 'AUT', 'function': 'Athlete'}, 201)
                booking_payload = {'athleteIds': [athlete['id']], 'hotelId': hotel_id,
                    'roomTypeId': type_id, 'roomNumber': '01',
                    'checkInDate': '2027-03-10', 'checkOutDate': '2027-03-14'}
                booking = mutate('POST', '/room-assignments', booking_payload, 201)
                booking_id = booking['id']
                mutate('PUT', f'/room-assignments/{booking_id}', {**booking_payload, 'roomNumber': '02'})
                mutate('DELETE', f'/room-assignments/{booking_id}', status=204)
                # The delete audit must retain the deleted booking's person and hotel.
                self.assertEqual(observations[-1][2]['entityLabel'], 'Lina Frei')
                self.assertEqual(observations[-1][2]['entityRefs']['hotelId'], hotel_id)
                mutate('PUT', f'/hotels/{hotel_id}/inventory/{inventory_id}',
                    {**inventory_payload, 'roomCount': 4})
                mutate('DELETE', f'/hotels/{hotel_id}/inventory/{inventory_id}', status=204)
                mutate('PUT', f'/hotels/{hotel_id}', {'name': 'Renamed Hotel'})
                mutate('DELETE', f'/hotels/{hotel_id}', status=204)
                self.assertEqual(observations[-1][2]['entityLabel'], 'Renamed Hotel')
                mutate('PUT', f'/room-types/{type_id}', {'name': 'Renamed Double'})
                mutate('DELETE', f'/room-types/{type_id}', status=204)
                self.assertEqual(observations[-1][2]['entityLabel'], 'Renamed Double')
                with app.app_context():
                    self.assertEqual(Hotel.query.count(), 0)
                    self.assertEqual(RoomBooking.query.count(), 0)
                    self.assertEqual(RoomType.query.count(), 0)
                    self.assertEqual(Athlete.query.count(), 1)
                if baseline is None:
                    baseline = observations
                else:
                    self.assertEqual(observations, baseline)

    def test_accommodation_event_contract_clamping_and_retired_demand_commands(self):
        payload = {'discipline': 'Big Air', 'startDate': '2027-03-10',
                   'endDate': '2027-03-14', 'personDemand': -2, 'singleRoomPercentage': 120}
        response = self.client.post('/api/events', json=payload, headers=self.editor)
        self.assertEqual(response.status_code, 201)
        event_id = response.get_json()['id']
        self.assertIsInstance(event_id, str)
        expected = {**payload, 'id': event_id, 'personDemand': 0,
                    'singleRoomPercentage': 100, 'roomDemands': []}
        self.assert_json(response, 201, expected)
        self.assert_json(self.client.get('/api/events', headers=self.viewer), 200, [expected])
        expected.update(personDemand=11, singleRoomPercentage=0)
        self.assert_json(self.client.put(f'/api/events/{event_id}',
            json={'personDemand': '11', 'singleRoomPercentage': -3}), 200, expected)
        self.assert_json(self.client.post(f'/api/events/{event_id}/demand', json={}), 405,
            {'error': 'Zimmerbedarf wird automatisch aus Personenbedarf und Belegungsstrategie berechnet.'})
        self.assert_json(self.client.delete(f'/api/events/{event_id}/demand/1'), 405,
            {'error': 'Berechneter Zimmerbedarf kann nicht manuell geändert werden.'})
        deleted = self.client.delete(f'/api/events/{event_id}')
        self.assertEqual((deleted.status_code, deleted.data), (204, b''))
        self.assert_json(self.client.get('/api/events'), 200, [])

    def test_person_and_quota_aliases_keep_read_projection(self):
        with app.app_context():
            person = Athlete(firstname='Lina', lastname='Frei', fis_code='123',
                nation_code='AUT', discipline='Big Air', gender='F', function='Athlete')
            db.session.add(person)
            db.session.commit()
            person_id = str(person.id)
        people = self.client.get('/api/athletes', headers=self.viewer).get_json()
        self.assertEqual(len(people), 1)
        for field, expected in {'id': person_id, 'fisCode': '123', 'firstname': 'Lina',
                'single_room_status': 'NONE', 'single_room_decision_id': None,
                'workflowStatus': 'OPEN_ASSIGNMENT', 'hasPendingRoomlistReview': False}.items():
            self.assertEqual(people[0][field], expected)
        self.assertEqual(people[0]['assignment'], {'hasAssignment': False,
            'hotelName': None, 'hotelId': None, 'roomNumber': None, 'roomTypeName': None,
            'checkInDate': None, 'checkOutDate': None, 'bookingId': None, 'countsAsSingle': False})
        for path in ['/api/athletes/', '/athletes', '/athletes/']:
            self.assert_json(self.client.get(path), 200, people)
        detail = self.client.get(f'/api/athletes/{person_id}').get_json()
        self.assertEqual(detail['id'], person_id)
        self.assertNotIn('workflowStatus', detail)  # Detail is not the collection projection.
        self.assert_json(self.client.get(f'/api/athletes/{person_id}/'), 200, detail)
        quota = self.client.get('/api/fis/official-quotas?nationCode=AUT&gender=F').get_json()
        self.assertTrue(quota)
        for path in ['/api/fis/official-quotas/', '/api/official-quotas',
                     '/api/official-quotas/', '/fis/official-quotas', '/fis/official-quotas/']:
            self.assert_json(self.client.get(path + '?nationCode=AUT&gender=F'), 200, quota)
        self.assert_json(self.client.get('/api/fis/official-quotas?nationCode=XXX'), 200, [])

    def test_confirm_missing_unknown_and_blocked_tokens_do_not_write(self):
        PREVIEW_STORE['blocked'] = {'createdAt': datetime.utcnow(),
                                    'errors': [{'code': 'BAD_INPUT'}]}
        for path in ['/api/import/fis/confirm', '/api/import/fis/confirm/']:
            PREVIEW_STORE['expired'] = {
                'createdAt': datetime.utcnow() - timedelta(seconds=PREVIEW_TTL_SECONDS + 1), 'errors': []}
            for body, expected in [({}, {'error': 'previewToken is required'}),
                ({'previewToken': 'unknown'}, {'error': 'INVALID_IMPORT', 'message': 'Preview token not found or expired'}),
                ({'previewToken': 'expired'}, {'error': 'INVALID_IMPORT', 'message': 'Preview token not found or expired'}),
                ({'previewToken': 'blocked'}, {'error': 'INVALID_IMPORT', 'message': 'Preview contains blocking validation errors'})]:
                with self.subTest(path=path, body=body):
                    self.assert_json(self.client.post(path, json=body, headers=self.editor), 400, expected)
        with app.app_context():
            for model in [Athlete, ImportRun, ImportSession, RoomBooking, AuditEvent]:
                self.assertEqual(model.query.count(), 0)
        self.assertIn('blocked', PREVIEW_STORE)

    def _real_session_preview(self):
        with app.app_context():
            event = Event(name='Characterization Championship', year=2027, active=True)
            db.session.add(event)
            for definition in COMPETITIONS:
                competition = Competition(**definition._asdict())
                db.session.add(EventCompetition(event=event, competition=competition,
                    fis_codex=definition.code, import_code=definition.import_code,
                    official_name=definition.name))
            db.session.commit()
            event_id = str(event.id)
        with tempfile.TemporaryDirectory() as directory:
            root = generate_scenario('001', Path(directory))['root']
            entries = next(root.glob('*_entries.xlsx')).read_bytes()
            rooms = next(root.glob('*_room_list.xlsx')).read_bytes()
        preview = self.client.post('/api/import/fis/preview/', headers=self.editor, data={
            'eventId': event_id, 'createSession': 'true',
            'entriesList': (io.BytesIO(entries), 'entries.xlsx'),
            'roomListDetailed': (io.BytesIO(rooms), 'rooms.xlsx')})
        self.assertEqual(preview.status_code, 200, preview.get_data(as_text=True))
        payload = preview.get_json()
        self.assertEqual(payload['errors'], [])
        self.assertTrue(payload['people'])
        return payload

    def _assert_approved_confirmation(self, direct):
        payload = self._real_session_preview()
        token = payload['previewToken']
        session_id = payload['session']['id']
        with app.app_context():
            for model in [Athlete, ImportRun, RoomBooking]:
                self.assertEqual(model.query.count(), 0)
            session = db.session.get(ImportSession, int(session_id))
            person_key = PREVIEW_STORE[token]['people'][0]['matchKey']
            decision = ImportApproval(session_id=session.id, version_id=session.current_version_id,
                nation=session.nation, approval_type='NATION_APPROVED', description='Single Rooms',
                decision='APPROVED', approved_person_keys_json=json.dumps([person_key]), username='fixture')
            db.session.add(decision)
            db.session.commit()
            decision_id = decision.id
        approved = self.client.post(f'/api/import/sessions/{session_id}/approve', headers=self.editor)
        self.assertEqual(approved.status_code, 200, approved.get_data(as_text=True))
        self.assertEqual(approved.get_json()['status'], 'APPROVED')
        path = '/api/import/fis/confirm/' if direct else f'/api/import/sessions/{session_id}/import'
        with patch('app.confirm_fis_import', wraps=confirm_fis_import) as confirm:
            confirmed = self.client.post(path,
                json={'previewToken': token}, headers=self.editor)
            confirm.assert_called_once_with(token, {person_key: decision_id})
        self.assertEqual(confirmed.status_code, 200, confirmed.get_data(as_text=True))
        expected_keys = {'success', 'summary', 'run'} | (set() if direct else {'session'})
        self.assertEqual(set(confirmed.get_json()), expected_keys)
        self.assertIs(confirmed.get_json()['success'], True)
        self.assertEqual(confirmed.get_json()['summary'], {
            'peopleCreated': len(payload['people']), 'peopleUpdated': 0,
            'peopleRemoved': 0, 'duplicatesRemoved': 0, 'fisRoomsImported': 0,
            'fisRoomsReplaced': 0, 'dispositionsChanged': 0})
        self.assertEqual(confirmed.get_json()['run']['importType'], 'fis_confirm')
        with app.app_context():
            count = Athlete.query.count()
            self.assertEqual(count, len(payload['people']))
            session = db.session.get(ImportSession, int(session_id))
            self.assertEqual(session.status, 'IMPORTED')
            self.assertIsNotNone(session.imported_at)
            history = ImportSessionEvent.query.filter_by(session_id=session.id, event_type='IMPORTED').one()
            self.assertEqual(history.version_id, session.current_version_id)
            self.assertEqual(history.username, 'editor')
            self.assertEqual(AuditEvent.query.filter_by(path=path).count(), 1)
            self.assertEqual(RoomBooking.query.count(), 0)
        self.assertNotIn(token, PREVIEW_STORE)
        self.assert_json(self.client.post('/api/import/fis/confirm', json={'previewToken': token}),
            400, {'error': 'INVALID_IMPORT', 'message': 'Preview token not found or expired'})
        with app.app_context():
            self.assertEqual(Athlete.query.count(), count)

    def test_approved_session_direct_confirm_consumes_token_and_completes_workflow(self):
        self._assert_approved_confirmation(direct=True)

    def test_normal_approved_session_import_remains_unchanged(self):
        self._assert_approved_confirmation(direct=False)

    def _session_with_token(self):
        PREVIEW_STORE['session-token'] = {'createdAt': datetime.utcnow(), 'errors': []}
        with app.app_context():
            session = ImportSession(nation='AUT', status='PROFESSIONALLY_REVIEWED')
            db.session.add(session)
            db.session.flush()
            version = ImportSessionVersion(session_id=session.id, version=1,
                preview_token='session-token', preview_json='{"errors": []}', uploaded_by='fixture')
            db.session.add(version)
            db.session.flush()
            session.current_version = version
            db.session.commit()
            return session.id

    def test_direct_and_normal_confirmation_share_approval_gate_without_writes(self):
        session_id = self._session_with_token()
        cases = [(status, datetime.utcnow()) for status in [
            'DRAFT', 'PROFESSIONALLY_REVIEWED', 'WAITING_FOR_NATION',
            'EXCEPTION_APPROVED', 'IMPORTED', 'ARCHIVED', 'REPLACED', 'CANCELLED', 'ERROR']]
        cases.append(('APPROVED', None))
        for status, approved_at in cases:
            with self.subTest(status=status):
                with app.app_context():
                    session = db.session.get(ImportSession, session_id)
                    session.status, session.approved_at = status, approved_at
                    db.session.commit()
                for path in ['/api/import/fis/confirm', '/api/import/fis/confirm/',
                             f'/api/import/sessions/{session_id}/import']:
                    self.assert_json(self.client.post(path, headers=self.editor,
                        json={'previewToken': 'session-token'}), 409,
                        {'error': 'Die Session muss vor dem Import explizit freigegeben werden.'})
                with app.app_context():
                    self.assertEqual(db.session.get(ImportSession, session_id).status, status)
                    for model in [Athlete, ImportRun, RoomBooking, ImportSessionEvent, AuditEvent]:
                        self.assertEqual(model.query.count(), 0)
                self.assertIn('session-token', PREVIEW_STORE)

    def test_direct_confirmation_rejects_standalone_and_superseded_tokens(self):
        session_id = self._session_with_token()
        PREVIEW_STORE['standalone'] = {'createdAt': datetime.utcnow(), 'errors': []}
        with app.app_context():
            session = db.session.get(ImportSession, session_id)
            replacement = ImportSessionVersion(session_id=session_id, version=2,
                preview_token='replacement', preview_json='{"errors": []}', uploaded_by='fixture')
            db.session.add(replacement)
            session.current_version = replacement
            session.status, session.approved_at = 'APPROVED', datetime.utcnow()
            db.session.commit()
        for token in ['standalone', 'session-token']:
            for path in ['/api/import/fis/confirm', '/api/import/fis/confirm/']:
                self.assert_json(self.client.post(path, json={'previewToken': token}), 409,
                    {'error': 'Preview token is not linked to a current import session version'})
            self.assertIn(token, PREVIEW_STORE)
        with app.app_context():
            self.assertEqual(db.session.get(ImportSession, session_id).status, 'APPROVED')
            for model in [Athlete, ImportRun, RoomBooking, ImportSessionEvent, AuditEvent]:
                self.assertEqual(model.query.count(), 0)

    def test_expired_linked_token_retains_direct_error_without_changing_session(self):
        session_id = self._session_with_token()
        with app.app_context():
            session = db.session.get(ImportSession, session_id)
            session.status, session.approved_at = 'APPROVED', datetime.utcnow()
            db.session.commit()
        PREVIEW_STORE['session-token']['createdAt'] -= timedelta(seconds=PREVIEW_TTL_SECONDS + 1)
        self.assert_json(self.client.post('/api/import/fis/confirm', json={'previewToken': 'session-token'}),
            400, {'error': 'INVALID_IMPORT', 'message': 'Preview token not found or expired'})
        with app.app_context():
            self.assertEqual(db.session.get(ImportSession, session_id).status, 'APPROVED')
            self.assertEqual(ImportRun.query.count(), 0)
            self.assertEqual(ImportSessionEvent.query.count(), 0)

        # The existing normal-route expiry contract remains distinct: it records
        # a failed import attempt on the session and returns its established body.
        self.assert_json(self.client.post(f'/api/import/sessions/{session_id}/import'), 400,
            {'error': 'Preview token not found or expired'})
        with app.app_context():
            self.assertEqual(db.session.get(ImportSession, session_id).status, 'ERROR')
            self.assertEqual(ImportRun.query.count(), 0)

    def test_single_room_approval_validation_and_session_import_gate(self):
        with app.app_context():
            session = ImportSession(nation='AUT', status='WAITING_FOR_NATION')
            db.session.add(session)
            db.session.flush()
            version = ImportSessionVersion(session_id=session.id, version=1,
                preview_json='{"errors": [], "people": []}', uploaded_by='fixture')
            db.session.add(version)
            db.session.flush()
            session.current_version = version
            approval = ImportApproval(session_id=session.id, version_id=version.id,
                nation='AUT', approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED',
                description='Single Rooms', decision='PENDING', username='fixture',
                quota_details_json=json.dumps({'excessCount': 1, 'gender': 'F',
                    'singleRoomCandidates': [{'personKey': 'A', 'name': 'Lina Frei'}]}))
            db.session.add(approval)
            db.session.commit()
            session_id, approval_id = session.id, approval.id
        path = f'/api/import/sessions/{session_id}/approvals/{approval_id}'
        valid = {'decision': 'APPROVED', 'approvalType': 'NATION_APPROVED',
                 'approvalBy': 'Team AUT', 'approvalDate': '2026-10-01T10:00:00Z',
                 'approvedPersonKeys': ['A']}
        self.assertEqual(self.client.patch(path, json=valid, headers=self.viewer).status_code, 403)
        cases = [({'decision': 'INVALID'}, 'decision must be APPROVED or NEW_LIST_ANNOUNCED'),
            ({'approvalType': 'INVALID'}, 'approvalType must identify the approving party'),
            ({'approvalMethod': 'INVALID'}, 'approvalMethod must be EMAIL or PHONE'),
            ({'approvalBy': ''}, 'approvalBy is required'),
            ({'approvalDate': 'invalid'}, 'approvalDate or deadlineAt is invalid'),
            ({'approvalType': 'ORGANIZER_APPROVED'}, 'deadlineAt is required for organizer approval'),
            ({'approvedPersonKeys': []}, 'Exactly the affected extra single-room persons must be selected'),
            ({'approvedPersonKeys': ['OTHER']}, 'Exactly the affected extra single-room persons must be selected')]
        for change, error in cases:
            with self.subTest(change=change):
                self.assert_json(self.client.patch(path, json={**valid, **change},
                    headers=self.editor), 400, {'error': error})
        self.assert_json(self.client.post(f'/api/import/sessions/{session_id}/import'), 409,
            {'error': 'Die Session muss vor dem Import explizit freigegeben werden.'})
        self.assert_json(self.client.post(f'/api/import/sessions/{session_id}/approve'), 409,
            {'error': 'Alle erforderlichen Entscheidungen müssen getroffen werden.'})
        with app.app_context():
            self.assertEqual(db.session.get(ImportApproval, approval_id).decision, 'PENDING')
            self.assertEqual(db.session.get(ImportSession, session_id).status, 'WAITING_FOR_NATION')
            self.assertEqual(ImportSessionEvent.query.count(), 0)
            self.assertEqual(AuditEvent.query.count(), 0)
        approved = self.client.patch(path, json=valid, headers=self.editor)
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.get_json()['status'], 'EXCEPTION_APPROVED')
        detail = self.client.get(f'/api/import/approvals/{approval_id}', headers=self.viewer)
        self.assertEqual(detail.status_code, 200)
        self.assertEqual(detail.get_json()['decision'], 'APPROVED')
        self.assertEqual(detail.get_json()['people'], [{'id': 'A', 'name': 'Lina Frei',
            'nation': 'AUT', 'singleRoomStatus': 'APPROVED_EXTRA'}])

    def test_retired_excel_entry_point_returns_410_on_all_aliases(self):
        expected = {'error': 'Legacy single-file import has been replaced. Use /api/import/fis/preview and /api/import/fis/confirm with both FIS files.'}
        for path in ['/api/import/excel', '/api/import/excel/', '/import/excel', '/import/excel/']:
            self.assert_json(self.client.post(path), 410, expected)
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)
