"""Canonical membership across roles, mutable mappings and historical boundaries."""
import json
from copy import deepcopy
from datetime import datetime, date

from flask import Flask
import pytest

from competitions import COMPETITIONS, quota_disciplines, resolve_quota_memberships
from quota_catalogue import reconcile_quota_catalogue
from quota_history import historical_approval_groups
from quota_service import (evaluate_quota_usage, evaluate_athlete_quota_usage,
                           quota_keys, disposition_by_quota_group, single_room_usage_by_quota_group)
from excel_import import (PREVIEW_STORE, recalculate_fis_import_preview,
                          preserved_single_room_approvals, confirm_fis_import)
from models import (db, Athlete, Competition, Event, EventCompetition, Hotel,
                    RoomType, RoomBooking, RoomBookingOccupant, ImportApproval,
                    ImportSession, ImportSessionVersion)


@pytest.fixture
def database():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        yield
        PREVIEW_STORE.clear()
        db.session.remove()
        db.drop_all()


def comp(code='6182', group='TestGroup', import_code='EXACT'):
    return Competition(code=code, import_code=import_code, quota_discipline=group,
        name='Descriptive name', display_name='Display', sport='Unrelated sport', gender='M')


def person(key, codes=('EXACT',), role='Athlete', **extra):
    return dict(matchKey=key, fisCode=key, firstname=key, lastname='Person', nationCode='AUT',
        gender='M', function=role, industryName='Ignore', discipline='Ignore',
        competitionImportCodes=list(codes), quotaDisciplines=['STALE'],
        topLevelDisciplines=['STALE'], **extra)


def test_catalogue_reconciliation_preserves_everything_except_group(database):
    rows = []
    for definition in COMPETITIONS:
        row = Competition(**definition._asdict())
        row.quota_discipline = 'Old detail'
        rows.append(row)
    unknown = comp(code='9999', group='Untouched', import_code='UNKNOWN')
    db.session.add_all([*rows, unknown]); db.session.commit()
    before = {r.id: r.to_dict() for r in [*rows, unknown]}
    reconcile_quota_catalogue(db.session.connection(),
        [(r.import_code, r.code, r.quota_discipline) for r in COMPETITIONS])
    db.session.commit(); db.session.expire_all()
    assert len(rows) == 31
    for row in rows:
        expected = deepcopy(before[row.id])
        expected['quotaDiscipline'] = next(c.quota_discipline for c in COMPETITIONS if c.code == row.code)
        assert row.to_dict() == expected
    assert unknown.to_dict() == before[unknown.id]
    reconcile_quota_catalogue(db.session.connection(), [('WSC_BA_M_6182', '6182', 'TestGroup')])
    db.session.commit(); db.session.expire_all()
    assert Competition.query.filter_by(code='6182').one().quota_discipline == 'TestGroup'


def test_shared_role_resolver_and_no_descriptive_fallbacks():
    mapping = {'EXACT': comp(), 'SECOND': comp('6188'), 'OTHER': comp('8179', 'OtherGroup')}
    for role in ('Athlete', 'Official'):
        p = resolve_quota_memberships(person('A', ('EXACT', 'SECOND', 'OTHER'), role), mapping)
        assert p['quotaDisciplines'] == ['OtherGroup', 'TestGroup']
        assert p['topLevelDisciplines'] == p['quotaDisciplines']
        athlete = resolve_quota_memberships(person('ATHLETE', ('EXACT', 'SECOND', 'OTHER')), mapping)
        assert quota_keys(p, [athlete]) == {('AUT', 'TestGroup', 'M'), ('AUT', 'OtherGroup', 'M')}
        p = resolve_quota_memberships(person('B', (), role), mapping)
        assert not quota_keys(p)
        assert evaluate_quota_usage([p], [p]) == []
    with pytest.raises(ValueError, match='Unmapped'):
        resolve_quota_memberships(person('X', ('UNMAPPED',)), mapping)


def test_arbitrary_configuration_propagates_preview_confirmation_live_and_exemptions(database):
    from app import _build_official_quota_usage_rows
    competition = comp()
    event = Event(name='Configured event', active=True)
    db.session.add(EventCompetition(event=event, competition=competition,
        import_code='EXACT', fis_codex='6182', official_name='Exact'))
    db.session.commit()
    people = [person('A'), person('O', role='Official'), person('P', role='Official'),
              person('E', role='Official')]
    preview = dict(createdAt=datetime.utcnow(), eventId=event.id, people=people,
        rooms=[dict(person1Key=p['matchKey'], person2Key=None, roomType='Single') for p in people],
        errors=[], warnings=[], singleRoomQuotaExemptOverrides={'E': 'OTHER'})
    recalculate_fis_import_preview(preview)
    assert {p['quotaDisciplines'][0] for p in people} == {'TestGroup'}
    assert preview['athleteQuotaChecks'] == []  # No invented 36/20 policy for arbitrary groups.
    check = preview['quotaChecks'][0]
    assert check['discipline'] == 'TestGroup' and check['singleRooms'] == 3
    warning = next(w for w in preview['warnings'] if w['code'] == 'QUOTA_SINGLE_ROOMS_EXCEEDED')
    assert {c['personKey'] for c in warning['details']['singleRoomCandidates']} == {'A', 'O', 'P'}
    original = deepcopy(preview)
    people[0]['quotaDisciplines'] = ['STALE AGAIN']
    PREVIEW_STORE['canonical'] = preview
    confirm_fis_import('canonical')
    assert {a.competitions[0].quota_discipline for a in Athlete.query.all()} == {'TestGroup'}
    hotel = Hotel(name='Hotel'); room_type = RoomType(name='Double', max_persons=2)
    db.session.add_all([hotel, room_type]); db.session.flush()
    for athlete in Athlete.query.all():
        booking = RoomBooking(hotel=hotel, room_type=room_type, room_number=athlete.fis_code,
            check_in_date=date(2027, 3, 1), check_out_date=date(2027, 3, 2),
            counts_as_single=athlete.fis_code != 'P')
        db.session.add(RoomBookingOccupant(room_booking=booking, athlete=athlete))
    db.session.commit()
    row = _build_official_quota_usage_rows()[0]
    assert row['discipline'] == 'TestGroup'
    assert row['assignedOfficials'] == 3
    assert row['singleRoomsUsed'] == 2 and row['quotaExemptSingleRooms'] == 1
    assert _build_official_quota_usage_rows(discipline='Ignore') == []
    competition.quota_discipline = 'ChangedConfiguration'; db.session.commit()
    recalculate_fis_import_preview(original)
    assert original['quotaChecks'][0]['discipline'] == 'ChangedConfiguration'
    assert _build_official_quota_usage_rows()[0]['discipline'] == 'ChangedConfiguration'


def test_historical_detail_preservation_is_read_only_and_continuity_breaks(database):
    competition = comp(import_code='WSC_BA_M_6182', group='Snowboard Park & Pipe')
    session = ImportSession(nation='AUT')
    db.session.add(session); db.session.flush()
    db.session.add(competition); db.session.flush()
    details = {'nationCode': 'AUT', 'discipline': 'Snowboard Big Air', 'gender': 'M',
        'singleRoomCandidates': [{'personKey': 'A', 'competitionIds': [str(competition.id)]}]}
    original_json = json.dumps(details)
    decision = ImportApproval(session_id=session.id, nation='AUT', approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED',
        description='Historic', decision='APPROVED', username='test', quota_details_json=original_json,
        approved_person_keys_json='["A"]')
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M',
        function='Official', competitions=[competition], single_room_status='APPROVED_EXTRA',
        single_room_entitlement='APPROVED_EXTRA', single_room_decision=decision)
    db.session.add_all([athlete, decision]); db.session.commit()
    incoming = resolve_quota_memberships(person('A', ('WSC_BA_M_6182',), 'Official'),
        {'WSC_BA_M_6182': competition})
    rooms = [{'person1Key': 'A', 'roomType': 'Single'}]
    athlete_incoming = resolve_quota_memberships(person('ATHLETE', ('WSC_BA_M_6182',)),
        {'WSC_BA_M_6182': competition})
    assert preserved_single_room_approvals([incoming, athlete_incoming], rooms)['A']['groups'] == {('AUT', 'Snowboard Park & Pipe', 'M')}
    assert decision.quota_details_json == original_json and decision.approved_person_keys_json == '["A"]'
    assert historical_approval_groups({**details, 'discipline': 'Unresolved'}, athlete) == set()
    athlete.single_room_status = 'NONE'; db.session.commit()
    assert preserved_single_room_approvals([incoming], rooms) == {}


def test_collapsed_historical_decisions_count_people_once_and_decisions_separately(database):
    from app import _build_official_quota_usage_rows
    session = ImportSession(nation='AUT')
    db.session.add(session); db.session.flush()
    version = ImportSessionVersion(session_id=session.id, version=1, uploaded_by='test')
    db.session.add(version); db.session.flush(); session.current_version = version
    decisions = [ImportApproval(session_id=session.id, version_id=version.id, nation='AUT',
        approval_type='NATION_APPROVED', description='Historical decision', decision='APPROVED',
        username='original', approved_person_keys_json='["A"]',
        quota_details_json=json.dumps({'nationCode': 'AUT', 'discipline': group, 'gender': 'M'}))
        for group in ('Snowboard Big Air', 'Snowboard Slopestyle', 'Unresolved')]
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M',
        function='Athlete', competitions=[comp('6182', 'Snowboard Park & Pipe', 'WSC_BA_M_6182'),
                                        comp('6188', 'Snowboard Park & Pipe', 'WSC_SS_M_6188')],
        single_room_entitlement='APPROVED_EXTRA', single_room_status='APPROVED_EXTRA',
        single_room_decision=decisions[0])
    db.session.add_all([athlete, *decisions]); db.session.commit()
    for decision in decisions:
        details = json.loads(decision.quota_details_json)
        details['singleRoomCandidates'] = [{'personKey': 'A', 'competitionIds': [str(c.id) for c in athlete.competitions]}]
        decision.quota_details_json = json.dumps(details)
    db.session.commit()
    original = [(d.quota_details_json, d.approved_person_keys_json) for d in decisions]
    row = _build_official_quota_usage_rows()[0]
    assert row['approvedExtraSingleRooms'] == 1
    assert row['approvedExceptions'] == 2
    assert row['unresolvedHistoricalApprovalIds'] == [decisions[2].id]
    assert original == [(d.quota_details_json, d.approved_person_keys_json) for d in decisions]


def test_distinct_people_are_not_duplicated_by_repeated_projection_rows():
    p = resolve_quota_memberships(person('A'), {'EXACT': comp()})
    p.update(personId=1, countsAsSingle=True)
    duplicated = [p, deepcopy(p)]
    assert evaluate_athlete_quota_usage(duplicated) == []
    assert evaluate_quota_usage(duplicated, duplicated)[0]['singleRoomsUsed'] == 1
    assert evaluate_quota_usage(duplicated, duplicated)[0]['athletesEntered'] == 1
    assert single_room_usage_by_quota_group(duplicated, [1]) == {('AUT', 'TestGroup', 'M'): 1}
    assert disposition_by_quota_group(duplicated, [1])[('AUT', 'TestGroup', 'M')]['peopleTotal'] == 1


def test_exact_approval_evidence_follows_mapping_without_spreading_other_memberships(database):
    a, b = comp(), comp('8179', 'OtherGroup', 'OTHER')
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M',
                      competitions=[a, b], function='Athlete')
    db.session.add(athlete); db.session.commit()
    details = {'quotaMembershipVersion': 1, 'nationCode': 'AUT', 'discipline': 'TestGroup', 'gender': 'M',
               'singleRoomCandidates': [{'personKey': 'A', 'competitionIds': [str(a.id)]}]}
    assert historical_approval_groups(details, athlete) == {('AUT', 'TestGroup', 'M')}
    a.quota_discipline = 'FutureGroup'; db.session.commit()
    assert historical_approval_groups(details, athlete) == set()


def canonical_decision(session, competition, key='A', group='TestGroup'):
    return ImportApproval(session_id=session.id, nation='AUT', approval_type='NATION_APPROVED',
        description='Reviewed exact membership', decision='APPROVED', username='test',
        approved_person_keys_json=json.dumps([key]), quota_details_json=json.dumps({
            'quotaMembershipVersion': 1, 'nationCode': 'AUT', 'gender': 'M', 'discipline': group,
            'singleRoomCandidates': [{'personKey': key, 'competitionIds': [str(competition.id)]}]}))


@pytest.mark.parametrize('remap', ['group', 'identity'])
def test_confirmation_rejects_approval_after_remapping_without_rewriting_history(database, remap):
    from quota_history import applicable_approval_groups
    c = comp(); event = Event(name='Review boundary', active=True)
    mapping = EventCompetition(event=event, competition=c, import_code='EXACT', fis_codex='6182', official_name='Exact')
    session = ImportSession(nation='AUT')
    db.session.add_all([mapping, session]); db.session.flush()
    decision = canonical_decision(session, c)
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M',
        function='Official', competitions=[c], single_room_status='APPROVED_EXTRA',
        single_room_entitlement='APPROVED_EXTRA', single_room_decision=decision)
    db.session.add_all([decision, athlete]); db.session.commit()
    immutable = (decision.quota_details_json, decision.approved_person_keys_json)
    if remap == 'group':
        c.quota_discipline = 'NewGroup'
    else:
        replacement = comp('8179', 'TestGroup', 'OTHER')
        mapping.competition = replacement
    db.session.commit()
    incoming = person('A', role='Official')
    # Keep a valid athlete-derived allowance so this isolates historical
    # approval applicability rather than the missing-context validation gate.
    preview = dict(createdAt=datetime.utcnow(), eventId=event.id, people=[incoming, person('SUPPORT')],
        rooms=[{'person1Key': 'A', 'person2Key': None, 'roomType': 'Single'}], errors=[], warnings=[])
    recalculate_fis_import_preview(preview)
    assert incoming['singleRoomEntitlement'] == 'IN_QUOTA'
    assert preview['preservedSingleRoomApprovals'] == {}
    PREVIEW_STORE['remap'] = preview
    from excel_import import ImportValidationError
    with pytest.raises(ImportValidationError, match='nicht nachgewiesen'):
        confirm_fis_import('remap', {'A': decision.id})
    db.session.rollback()
    assert immutable == (decision.quota_details_json, decision.approved_person_keys_json)


def test_eventless_preview_resolves_saved_ids_from_database_and_flags_missing_evidence(database):
    c = comp(import_code='WSC_BA_M_6182'); db.session.add(c); db.session.commit()
    p = person('A', ('WSC_BA_M_6182',)); p['competitionIds'] = [str(c.id)]
    p['competitionMemberships'] = [{'competitionId': str(c.id), 'importCode': c.import_code, 'quotaDiscipline': 'STALE'}]
    preview = {'people': [p], 'rooms': [], 'warnings': [], 'errors': []}
    recalculate_fis_import_preview(preview)
    assert p['quotaDisciplines'] == ['TestGroup']
    assert p['competitionIds'] == [str(c.id)]
    assert p['competitionMemberships'][0]['quotaDiscipline'] == 'TestGroup'
    unknown = person('B', ('WSC_BA_M_6182',))
    recalculate_fis_import_preview({'people': [unknown], 'rooms': [], 'warnings': [], 'errors': []})
    assert unknown['quotaDisciplines'] == []
    no_evidence = {'people': [unknown], 'rooms': [], 'warnings': [], 'errors': []}
    recalculate_fis_import_preview(no_evidence)
    assert no_evidence['warnings'][0]['code'] == 'ENTRY_QUOTA_MEMBERSHIP_UNRESOLVED'


def test_legacy_label_collision_uses_historical_exact_catalogue_identity(database):
    mo = comp('8179', 'Freestyle', 'WSC_MO_M_8179')
    collision = comp('6182', 'Moguls', 'WSC_BA_M_6182')
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M', function='Athlete',
        competitions=[mo, collision])
    db.session.add(athlete); db.session.commit()
    details = {'nationCode': 'AUT', 'gender': 'M', 'discipline': 'Moguls',
        'singleRoomCandidates': [{'personKey': 'A', 'competitionIds': [str(mo.id)]}]}
    assert historical_approval_groups(details, athlete) == {('AUT', 'Freestyle', 'M')}
    mo.quota_discipline = 'FutureConfig'; db.session.commit()
    assert historical_approval_groups(details, athlete) == set()


@pytest.mark.parametrize('partial', [False, True])
def test_live_unresolved_selection_cannot_borrow_another_roster_membership(database, partial):
    from app import _build_official_quota_usage_rows
    c = comp(); session = ImportSession(nation='AUT'); db.session.add_all([c, session]); db.session.flush()
    version = ImportSessionVersion(session_id=session.id, version=1, uploaded_by='test')
    db.session.add(version); db.session.flush(); session.current_version = version
    decision = canonical_decision(session, c, key='MISSING'); decision.version_id = version.id
    if partial:
        decision.approved_person_keys_json = '["OTHER", "MISSING"]'
        details = json.loads(decision.quota_details_json)
        details['singleRoomCandidates'].append({'personKey': 'OTHER', 'competitionIds': [str(c.id)]})
        decision.quota_details_json = json.dumps(details)
    athlete = Athlete(fis_code='OTHER', firstname='Other', lastname='Person', nation_code='AUT', gender='M', function='Athlete',
        competitions=[c], single_room_status='APPROVED_EXTRA', single_room_entitlement='APPROVED_EXTRA',
        single_room_decision=decision)
    db.session.add_all([decision, athlete]); db.session.commit()
    row = _build_official_quota_usage_rows()[0]
    assert row['approvedExceptions'] == 0 and row['approvedExtraSingleRooms'] == 0
    assert row['unresolvedHistoricalApprovalIds'] == [decision.id]
    assert athlete.to_dict()['approvedQuotaDisciplines'] == []


def test_exemption_removal_without_membership_requires_review(database):
    from app import _update_athlete_operations
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M',
        single_room_quota_exempt_reason='OTHER', function='Athlete')
    hotel = Hotel(name='Hotel'); room = RoomType(name='Double', max_persons=2)
    booking = RoomBooking(hotel=hotel, room_type=room, counts_as_single=True)
    db.session.add(RoomBookingOccupant(room_booking=booking, athlete=athlete)); db.session.commit()
    _update_athlete_operations(athlete, {'singleRoomQuotaExemptReason': None})
    assert athlete.single_room_status == 'PENDING_APPROVAL'
    assert athlete.single_room_entitlement is None


def test_api_projects_only_the_resolved_approval_membership(database):
    from quota_history import approved_quota_disciplines
    a, b = comp('6182', 'Snowboard Park & Pipe', 'WSC_BA_M_6182'), comp('8179', 'Freestyle', 'WSC_MO_M_8179')
    session = ImportSession(nation='AUT'); db.session.add_all([a, b, session]); db.session.flush()
    decision = canonical_decision(session, a, group='Snowboard Park & Pipe')
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M', function='Athlete',
        competitions=[a,b], single_room_status='APPROVED_EXTRA', single_room_decision=decision)
    db.session.add(athlete); db.session.commit()
    from quota_history import applicable_approval_groups
    assert applicable_approval_groups(decision, athlete, 'UNRELATED') == set()
    assert approved_quota_disciplines(athlete) == ['Snowboard Park & Pipe']
    assert athlete.to_dict()['approvedQuotaDisciplines'] == ['Snowboard Park & Pipe']


def test_legacy_approval_requires_immutable_person_competition_evidence(database):
    from quota_history import applicable_approval_groups
    c = comp('8179', 'Freestyle', 'WSC_MO_M_8179')
    session = ImportSession(nation='AUT'); db.session.add_all([c, session]); db.session.flush()
    version = ImportSessionVersion(session_id=session.id, version=1, uploaded_by='test',
        preview_json=json.dumps({'people': [{'matchKey': 'A', 'competitionImportCodes': ['WSC_MO_M_8179']}]}))
    db.session.add(version); db.session.flush()
    decision = ImportApproval(session_id=session.id, nation='AUT', description='Legacy approval', username='test',
        approval_type='NATION_APPROVED', decision='APPROVED', approved_person_keys_json='["A"]',
        quota_details_json=json.dumps({'nationCode': 'AUT', 'gender': 'M', 'discipline': 'Moguls'}))
    athlete = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M', function='Athlete', competitions=[c])
    db.session.add_all([decision, athlete]); db.session.commit()
    assert applicable_approval_groups(decision, athlete) == set()
    decision.version_id = version.id; session.current_version = version; db.session.commit()
    assert applicable_approval_groups(decision, athlete) == set()
    session.status = 'IMPORTED'; db.session.commit()
    original = (decision.quota_details_json, decision.approved_person_keys_json, version.preview_json)
    assert applicable_approval_groups(decision, athlete) == {('AUT', 'Freestyle', 'M')}
    assert original == (decision.quota_details_json, decision.approved_person_keys_json, version.preview_json)
