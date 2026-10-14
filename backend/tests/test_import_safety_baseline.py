"""PostgreSQL characterization of import boundaries; questionable behavior is intentional."""
import json
import os
import sys
import unittest
from copy import deepcopy
from datetime import date, datetime
from itertools import product
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url

os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from excel_import import (PREVIEW_STORE, build_disposition_analysis, confirm_fis_import,
                          recalculate_fis_import_preview, preserved_single_room_approvals,
                          _serialize_person_preview, _serialize_room_preview)
from models import (db, Athlete, Competition, Event, EventCompetition, Hotel,
                    ImportApproval, ImportRun, ImportSession, ImportSessionEvent,
                    ImportSessionVersion, RoomBooking, RoomBookingOccupant, RoomType)


class ImportSafetyBaselineTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        PREVIEW_STORE.clear()
        self.addCleanup(PREVIEW_STORE.clear)
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.editor = {'X-Authenticated-User': 'editor',
                       'X-Authenticated-Groups': 'incoming-editor'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    @staticmethod
    def person(key, nation='AUT', discipline='Moguls', codes=()):
        return dict(matchKey=key, fisCode=key, firstname=key, lastname='Person',
                    nationCode=nation, industryName=discipline, gender='F',
                    function='Athlete', competitionImportCodes=list(codes))

    @staticmethod
    def athlete(key, nation='AUT', discipline='Moguls'):
        return Athlete(fis_code=key, firstname=key, lastname='Person',
                       nation_code=nation, discipline=discipline, gender='F', function='Athlete')

    def event(self):
        event = Event(name='Safety championship', active=True)
        for code, name, group in [('MO', 'Moguls', 'Moguls'),
                                  ('DM', 'Dual Moguls', 'Moguls'),
                                  ('AE', 'Aerials', 'Aerials')]:
            competition = Competition(import_code=code, code=code, name=name,
                display_name=name, sport='Freestyle', gender='F', quota_discipline=group)
            db.session.add(EventCompetition(event=event, competition=competition,
                import_code=code, fis_codex=code, official_name=name))
        db.session.add(event)
        db.session.commit()
        return event

    def preview(self, token, event, people, rooms=(), checks=()):
        preview = dict(createdAt=datetime.utcnow(), eventId=event.id,
                       people=people, rooms=list(rooms), quotaChecks=list(checks),
                       errors=[], warnings=[], singleRoomQuotaExemptOverrides={})
        PREVIEW_STORE[token] = preview
        return preview

    @staticmethod
    def single(key):
        return dict(person1Key=key, person2Key=None, roomType='Single',
                    sourceRowKey=f'room:{key}', checkInDate=date(2027, 3, 10),
                    checkOutDate=date(2027, 3, 15), rowNumber=2,
                    person1Name=f'{key} Person', person2Name=None,
                    sharedWithRawName=None, sharedWithNationCode=None,
                    daySnapshot={}, lateCheckout=False, firstMeal=None,
                    lastMeal=None, specialMeal=None)

    def booking(self, people, counts=False):
        hotel = Hotel(name='Retained hotel')
        room_type = RoomType(name='Double', max_persons=2)
        booking = RoomBooking(hotel=hotel, room_type=room_type, room_number='101',
                              check_in_date=date(2027, 3, 9),
                              check_out_date=date(2027, 3, 17), counts_as_single=counts)
        db.session.add(booking)
        db.session.flush()
        for person in people:
            db.session.add(RoomBookingOccupant(room_booking=booking, athlete=person))
        db.session.commit()
        return booking

    def test_long_competition_memberships_keep_legacy_source_label_and_one_person(self):
        from competitions import COMPETITIONS
        with app.app_context():
            event = self.event()
            codes = ['WSC_PSL_W_6178', 'WSC_PSL_M_6177', 'WSC_PRT_A_6180',
                     'WSC_PGS_W_6172', 'WSC_PGS_M_6170']
            for definition in COMPETITIONS:
                if definition.import_code in codes:
                    competition = Competition(**definition._asdict())
                    db.session.add(EventCompetition(event=event, competition=competition,
                        import_code=definition.import_code, fis_codex=definition.code, official_name=definition.name))
            db.session.commit()
            names = [Competition.query.filter_by(import_code=code).one().name for code in codes]
            self.assertGreater(len(' • '.join(names)), 100)
            person = self.person('MULTI', discipline='Snowboard', codes=codes)
            self.preview('multi-long', event, [person], [self.single('MULTI')])
            session = ImportSession(nation='AUT', status='APPROVED', approved_at=datetime.utcnow())
            db.session.add(session); db.session.flush()
            version = ImportSessionVersion(session_id=session.id, version=1,
                preview_token='multi-long', preview_json=json.dumps(PREVIEW_STORE['multi-long'], default=str), uploaded_by='fixture')
            db.session.add(version); db.session.flush()
            session.current_version = version
            db.session.commit()
            response = self.client.post(f'/api/import/sessions/{session.id}/import', headers=self.editor)
            self.assertEqual(response.status_code, 200, response.get_json())
            result = response.get_json()
            athlete = Athlete.query.one()
            self.assertEqual(athlete.discipline, 'Snowboard')
            self.assertEqual({c.import_code for c in athlete.competitions}, set(codes))
            self.assertEqual(len(athlete.to_dict()['competitions']), 5)
            self.assertEqual(result['summary']['peopleCreated'], 1)
            self.assertEqual(result['summary']['fisRoomsImported'], 0)
            # Membership count must not multiply the accommodation person.
            from app import _build_room_booking_units
            units, _ = _build_room_booking_units()
            self.assertEqual(sum(unit['occupantCount'] for unit in units), 1)
            # Re-import with no source label preserves the existing legacy value.
            person['industryName'] = None
            self.preview('multi-again', event, [person], [self.single('MULTI')])
            self.assertEqual(confirm_fis_import('multi-again')['summary']['peopleUpdated'], 1)
            self.assertEqual(Athlete.query.one().discipline, 'Snowboard')
            self.assertEqual(len(Athlete.query.one().competitions), 5)

    def test_single_competition_retains_source_legacy_label(self):
        with app.app_context():
            event = self.event()
            self.preview('single-legacy', event, [self.person('SINGLE', codes=['DM'])])
            confirm_fis_import('single-legacy')
            athlete = Athlete.query.one()
            self.assertEqual(athlete.discipline, 'Moguls')
            self.assertEqual([c.import_code for c in athlete.competitions], ['DM'])

    def test_nation_snapshot_replaces_memberships_and_removes_absent_people_across_disciplines(self):
        with app.app_context():
            event = self.event()
            keep, absent, other_group, untouched = [self.athlete(*args) for args in
                [('KEEP',), ('ABSENT',), ('OTHER_GROUP', 'AUT', 'Aerials'), ('SWISS', 'SUI')]]
            old = Competition.query.filter_by(import_code='AE').one()
            keep.competitions = [old]
            untouched.competitions = [old]
            db.session.add_all([keep, absent, other_group, untouched])
            db.session.commit()
            untouched_id = untouched.id
            booking = self.booking([untouched])
            untouched_booking = booking.to_dict()
            person = self.person('KEEP', codes=['MO', 'DM'])
            self.preview('nation', event, [person])
            result = confirm_fis_import('nation')
            db.session.expire_all()
            self.assertEqual(result['summary']['peopleRemoved'], 2)
            self.assertEqual({a.fis_code for a in Athlete.query.all()}, {'KEEP', 'SWISS'})
            self.assertEqual({c.import_code for c in Athlete.query.filter_by(fis_code='KEEP').one().competitions}, {'MO', 'DM'})
            swiss = db.session.get(Athlete, untouched_id)
            self.assertEqual((swiss.nation_code, swiss.discipline, swiss.athletes_last_seen_at), ('SUI', 'Moguls', None))
            self.assertEqual([c.import_code for c in swiss.competitions], ['AE'])
            self.assertEqual(db.session.get(RoomBooking, booking.id).to_dict(), untouched_booking)

    def test_disposition_removed_reporting_is_discipline_narrowed_but_confirmation_is_nation_wide(self):
        with app.app_context():
            event = self.event()
            db.session.add_all([self.athlete('KEEP'), self.athlete('SAME'),
                                self.athlete('DIFFERENT', discipline='Aerials')])
            db.session.commit()
            person = self.person('KEEP')
            analysis = build_disposition_analysis([person], [], [])
            removed = analysis['categories']['removedAthletes']['records']
            self.assertEqual([r['athlete'] for r in removed], ['SAME Person'])
            self.preview('scope', event, [person])
            self.assertEqual(confirm_fis_import('scope')['summary']['peopleRemoved'], 2)
            self.assertEqual([a.fis_code for a in Athlete.query.all()], ['KEEP'])

    def test_reimport_preserves_booking_identity_dates_occupants_type_and_explicit_false(self):
        with app.app_context():
            event = self.event()
            first, partner = self.athlete('KEEP'), self.athlete('PARTNER')
            db.session.add_all([first, partner])
            db.session.commit()
            booking = self.booking([first, partner], counts=False)
            expected = (booking.id, booking.check_in_date, booking.check_out_date,
                        booking.room_type_id, booking.hotel_id, booking.room_number,
                        [(o.id, o.athlete_id) for o in booking.occupants])
            session = ImportSession(nation='AUT'); db.session.add(session); db.session.flush()
            competition = Competition.query.filter_by(import_code='MO').one()
            decision = ImportApproval(session_id=session.id, nation='AUT', approval_type='NATION_APPROVED',
                description='Reviewed booking snapshot', decision='APPROVED', username='fixture', approved_person_keys_json='["KEEP"]',
                quota_details_json=json.dumps(dict(quotaMembershipVersion=1, nationCode='AUT', discipline='Moguls', gender='F',
                    singleRoomCandidates=[dict(personKey='KEEP', competitionIds=[str(competition.id)])])))
            db.session.add(decision); db.session.commit()
            for version in (1, 2):
                people = [self.person('KEEP', codes=['MO']), self.person('PARTNER', codes=['AE'])]
                people[0].update(arrivalDate=date(2027, 3, 11), departureDate=date(2027, 3, 14), roomType='Single')
                self.preview(f'booking-{version}', event, people, [self.single('KEEP')],
                             [dict(nationCode='AUT', discipline='Moguls', gender='F', singleRoomsAllowed=0)])
                confirm_fis_import(f'booking-{version}', {'KEEP': decision.id})
                db.session.expire_all()
                retained = db.session.get(RoomBooking, expected[0])
                self.assertEqual((retained.id, retained.check_in_date, retained.check_out_date,
                    retained.room_type_id, retained.hotel_id, retained.room_number,
                    [(o.id, o.athlete_id) for o in retained.occupants]), expected)
                self.assertIs(retained.counts_as_single, False)
                self.assertEqual(Athlete.query.filter_by(fis_code='KEEP').one().single_room_status, 'APPROVED_EXTRA')

    def test_snapshot_removal_detaches_absent_occupants_and_deletes_only_empty_bookings(self):
        with app.app_context():
            event = self.event()
            keep, partner, solo = [self.athlete(key) for key in ('KEEP', 'PARTNER', 'SOLO')]
            keep.shared_with_name = 'Person, PARTNER'
            db.session.add_all([keep, partner, solo])
            db.session.commit()
            shared = self.booking([keep, partner])
            # Reuse reference data rather than creating another unique room type.
            empty = RoomBooking(hotel_id=shared.hotel_id, room_type_id=shared.room_type_id,
                                counts_as_single=True)
            db.session.add(empty)
            db.session.flush()
            db.session.add(RoomBookingOccupant(room_booking=empty, athlete=solo))
            db.session.commit()
            shared_id, empty_id, keep_id = shared.id, empty.id, keep.id
            person = {**self.person('KEEP'), 'sharedWithName': 'Person, PARTNER'}
            self.preview('remove-bookings', event, [person])
            self.assertEqual(confirm_fis_import('remove-bookings')['summary']['peopleRemoved'], 2)
            db.session.remove()
            retained = db.session.get(RoomBooking, shared_id)
            self.assertEqual([o.athlete_id for o in retained.occupants], [keep_id])
            self.assertIs(retained.counts_as_single, False)
            self.assertIsNone(db.session.get(RoomBooking, empty_id))
            self.assertEqual(RoomBookingOccupant.query.count(), 1)
            self.assertIsNone(db.session.get(Athlete, keep_id).shared_with_name)

    def test_consecutive_snapshots_preserve_only_decision_group_then_break_continuity(self):
        with app.app_context():
            event = self.event()
            session = ImportSession(nation='AUT')
            db.session.add(session)
            db.session.flush()
            decision = ImportApproval(session_id=session.id, nation='AUT',
                approval_type='NATION_APPROVED', decision='APPROVED', description='Single Rooms',
                username='fixture', quota_details_json=json.dumps(dict(nationCode='AUT', discipline='Moguls', gender='F')))
            db.session.add(decision)
            db.session.commit()
            decision.approved_person_keys_json = '["KEEP"]'
            decision.quota_details_json = json.dumps(dict(quotaMembershipVersion=1, nationCode='AUT', discipline='Moguls', gender='F',
                singleRoomCandidates=[dict(personKey='KEEP', competitionIds=[str(c.id) for c in Competition.query.filter(Competition.import_code.in_(['MO','DM'])).all()])]))
            db.session.commit()
            decision_id = decision.id
            checks = [dict(nationCode='AUT', discipline=g, gender='F', singleRoomsAllowed=0)
                      for g in ('Moguls', 'Aerials')]
            def incoming(codes, groups):
                return {**self.person('KEEP', codes=codes), 'function': 'Official', 'quotaDisciplines': groups,
                        'competitionIds': [str(c.id) for c in Competition.query.filter(Competition.import_code.in_(codes)).all()]}
            support = self.person('SUPPORT', codes=['MO', 'DM', 'AE'])
            support['quotaDisciplines'] = ['Moguls', 'Aerials']
            people = [support, incoming(['MO', 'DM', 'AE'], ['Moguls', 'Moguls', 'Aerials'])]
            self.preview('approved-first', event, people, [self.single('SUPPORT'), self.single('KEEP')], checks)
            confirm_fis_import('approved-first', {'KEEP': decision_id})
            for token in ('approved-second', 'approved-third'):
                people = [support, incoming(['MO', 'DM', 'AE'], ['Moguls', 'Moguls', 'Aerials'])]
                preserved = preserved_single_room_approvals(people, [self.single('SUPPORT'), self.single('KEEP')])
                self.assertEqual(preserved['KEEP']['groups'], {('AUT', 'Moguls', 'W')})
                self.assertEqual(preserved['KEEP']['decisionId'], decision_id)
                self.preview(token, event, people, [self.single('SUPPORT'), self.single('KEEP')], checks)
                confirm_fis_import(token)
                athlete = Athlete.query.filter_by(fis_code='KEEP').one()
                self.assertEqual((athlete.single_room_status, athlete.single_room_decision_id), ('APPROVED_EXTRA', decision_id))
            # Moving entirely outside the recorded decision group ends preservation.
            people = [support, incoming(['AE'], ['Aerials'])]
            self.assertEqual(preserved_single_room_approvals(people, [self.single('SUPPORT'), self.single('KEEP')]), {})
            self.preview('changed-group', event, people, [self.single('SUPPORT'), self.single('KEEP')], checks)
            confirm_fis_import('changed-group')
            # The maximum matcher can cover this person using a different free
            # context. Ending approval continuity must still clear its decision.
            self.assertEqual(Athlete.query.filter_by(fis_code='KEEP').one().single_room_status, 'IN_QUOTA')
            self.assertIsNone(Athlete.query.filter_by(fis_code='KEEP').one().single_room_decision_id)
            # Historical evidence does not revive after an intervening non-single snapshot.
            people = [support, incoming(['MO'], ['Moguls'])]
            self.preview('non-single', event, people)
            confirm_fis_import('non-single')
            self.assertEqual(Athlete.query.filter_by(fis_code='KEEP').one().single_room_status, 'NONE')
            self.assertEqual(preserved_single_room_approvals(people, [self.single('SUPPORT'), self.single('KEEP')]), {})
            self.preview('single-again', event, people, [self.single('SUPPORT'), self.single('KEEP')], checks)
            confirm_fis_import('single-again')
            # The maximum matcher can cover this person using a different free
            # context. Ending approval continuity must still clear its decision.
            self.assertEqual(Athlete.query.filter_by(fis_code='KEEP').one().single_room_status, 'IN_QUOTA')
            self.assertIsNone(Athlete.query.filter_by(fis_code='KEEP').one().single_room_decision_id)
            self.assertIsNotNone(db.session.get(ImportApproval, decision_id))

    def test_staged_exemption_recalculates_typed_and_persisted_json_with_equal_derived_state(self):
        for reason, roster_size in product(('WORLD_CHAMPION', 'OTHER'), (3, 4)):
            with self.subTest(reason=reason, roster_size=roster_size), app.app_context():
                db.drop_all()
                db.create_all()
                event = self.event()
                existing = self.athlete('P0')
                existing.arrival_date = date(2027, 3, 9)
                db.session.add(existing)
                db.session.commit()
                self.booking([existing], counts=True)
                people = [self.person(f'P{i}', codes=['MO']) for i in range(roster_size)]
                for p in people:
                    p.update(arrivalDate=date(2027, 3, 11), departureDate=date(2027, 3, 15))
                raw = self.preview('parity', event, people, [self.single(p['matchKey']) for p in people])
                recalculate_fis_import_preview(raw)
                self.assertTrue(any(w['code'] == 'QUOTA_SINGLE_ROOMS_EXCEEDED' for w in raw['warnings']))
                stored = dict(eventId=event.id, people=[_serialize_person_preview(p) for p in raw['people']],
                    rooms=[_serialize_room_preview(r) for r in raw['rooms']], errors=[],
                    warnings=deepcopy(raw['warnings']), singleRoomQuotaExemptOverrides={})
                session = ImportSession(nation='AUT', status='WAITING_FOR_NATION')
                db.session.add(session)
                db.session.flush()
                version = ImportSessionVersion(session_id=session.id, version=1, preview_token='parity',
                    preview_json=json.dumps(stored), uploaded_by='fixture')
                db.session.add(version)
                db.session.flush()
                session.current_version = version
                db.session.commit()
                response = self.client.patch(f'/api/import/sessions/{session.id}/single-room-exemptions/P1',
                                             json={'reason': reason}, headers=self.editor)
                if reason == 'OTHER':
                    self.assertEqual(response.status_code, 400)
                    self.assertEqual(raw.get('singleRoomQuotaExemptOverrides', {}), {})
                    continue
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
                db.session.expire_all()
                persisted = json.loads(db.session.get(ImportSessionVersion, version.id).preview_json)
                typed = PREVIEW_STORE['parity']
                for field in ('warnings', 'quotaChecks', 'dispositionAnalysis', 'singleRoomQuotaExemptOverrides'):
                    self.assertEqual(typed[field], persisted[field], field)
                fields = ('matchKey', 'singleRoomEntitlement', 'singleRoomQuotaExemptReason')
                self.assertEqual([{k: p.get(k) for k in fields} for p in typed['people']],
                                 [{k: p.get(k) for k in fields} for p in persisted['people']])
                expected = ['IN_QUOTA', 'QUOTA_EXEMPT', 'IN_QUOTA']
                if roster_size == 4:
                    expected.append('APPROVAL_REQUIRED')
                self.assertEqual([p['singleRoomEntitlement'] for p in typed['people']], expected)
                quota_warnings = [w for w in typed['warnings'] if w['code'].startswith('QUOTA_')]
                self.assertEqual(len(quota_warnings), roster_size - 3)
                if quota_warnings:
                    details = quota_warnings[0]['details']
                    self.assertEqual(details['excessCount'], 1)
                    self.assertEqual({p['personKey'] for p in details['singleRoomCandidates']}, {'P0', 'P2', 'P3'})
                self.assertEqual(len(db.session.get(ImportSession, session.id).current_approvals), roster_size - 3)
                self.assertEqual(typed['quotaChecks'][0]['quotaExemptSingleRooms'], 1)
                self.assertTrue(typed['dispositionAnalysis']['categories']['dispositionAffected']['records'])
                self.assertTrue(any(c['type'] == 'STAY_CHANGED' for c in typed['dispositionAnalysis']['changes']))
                self.assertIsNone(Athlete.query.filter_by(fis_code='P0').one().single_room_quota_exempt_reason)
                self.assertIsNone(Athlete.query.filter_by(fis_code='P1').first())

    def test_split_commit_failures_preserve_current_database_and_token_boundaries(self):
        for failure_at in (1, 2):
            with self.subTest(failure_at=failure_at), app.app_context():
                db.drop_all()
                db.create_all()
                event = self.event()
                self.preview('commit-boundary', event, [self.person('NEW', codes=['MO'])])
                session = ImportSession(nation='AUT', status='APPROVED', approved_at=datetime.utcnow(), approved_by='fixture')
                db.session.add(session)
                db.session.flush()
                version = ImportSessionVersion(session_id=session.id, version=1,
                    preview_token='commit-boundary', preview_json='{"errors": []}', uploaded_by='fixture')
                db.session.add(version)
                db.session.flush()
                session.current_version = version
                db.session.commit()
                session_id = session.id
                real_commit = db.session.commit
                calls = []
                def injected_commit():
                    calls.append(('NEW' in {a.fis_code for a in Athlete.query.all()},
                                  'commit-boundary' in PREVIEW_STORE))
                    if len(calls) == failure_at:
                        raise RuntimeError('injected commit boundary')
                    return real_commit()
                with patch.object(db.session, 'commit', side_effect=injected_commit):
                    response = self.client.post(f'/api/import/sessions/{session_id}/import', headers=self.editor)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {'error': 'injected commit boundary'})
                db.session.remove()  # Assertions read committed state through a fresh session.
                saved = db.session.get(ImportSession, session_id)
                self.assertEqual((saved.status, saved.error_message), ('ERROR', 'injected commit boundary'))
                self.assertIsNotNone(saved.approved_at)
                self.assertIsNone(saved.imported_at)
                self.assertEqual(ImportSessionEvent.query.filter_by(event_type='IMPORTED').count(), 0)
                self.assertEqual(Athlete.query.count(), 0 if failure_at == 1 else 1)
                self.assertEqual(ImportRun.query.count(), 0 if failure_at == 1 else 1)
                self.assertEqual('commit-boundary' in PREVIEW_STORE, failure_at == 1)
                self.assertEqual(calls[0], (True, True))
                if failure_at == 2:
                    self.assertEqual(calls[1], (True, False))
                    self.assertIsNotNone(ImportRun.query.one().finished_at)
                # A retry is blocked by ERROR, including when the data already committed.
                retry = self.client.post(f'/api/import/sessions/{session_id}/import', headers=self.editor)
                self.assertEqual(retry.status_code, 409)
                self.assertEqual(ImportRun.query.count(), 0 if failure_at == 1 else 1)
