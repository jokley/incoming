"""Business Change 1C: exact groups and personal athlete-derived allowance contexts."""
from copy import deepcopy
from datetime import datetime
import importlib.util
import json
from pathlib import Path

from flask import Flask
import pandas as pd
import pytest

from competitions import COMPETITIONS, COMPETITION_BY_IMPORT_CODE, resolve_quota_memberships
from excel_import import (PREVIEW_STORE, create_fis_import_preview, recalculate_fis_import_preview,
                          confirm_fis_import, ROOM_REQUIRED_COLUMNS, parse_entries_list)
from models import db, Athlete, Competition, Event, EventCompetition
from quota_catalogue import reconcile_quota_catalogue
from quota_history import historical_approval_groups
from quota_service import (evaluate_quota_usage, evaluate_athlete_quota_usage, quota_keys,
    disposition_by_quota_group, single_room_usage_by_quota_group, QuotaGenderValidationError)

EXPECTED = {
    'Freeski Park & Pipe': {'8171', '8172', '8178', '8181', '8196', '8197'},
    'Freestyle': {'8179', '8183', '8186', '8187', '8188', '8193', '8194', '8195'},
    'Ski Cross': {'8180', '8184', '8185'},
    'Snowboard Park & Pipe': {'6174', '6175', '6182', '6183', '6188', '6190'},
    'Snowboard Alpine': {'6170', '6172', '6177', '6178', '6180'},
    'Snowboard Cross': {'6191', '6192', '6193'},
}


@pytest.fixture
def database():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        yield app
        PREVIEW_STORE.clear()
        db.session.remove()
        db.drop_all()


def person(key='A', codes=('8185',), gender='M', role='Athlete', **extra):
    mapping = {c.import_code: c for c in COMPETITIONS if c.code in codes}
    return resolve_quota_memberships(dict(personId=key, matchKey=key, fisCode=key,
        firstname=key, lastname='Person', nationCode='AUT', function=role,
        gender=gender, forGender='A', competitionImportCodes=list(mapping), **extra), mapping)


def test_all_31_exact_catalogue_and_frozen_migration_mappings_agree():
    actual = {group: {c.code for c in COMPETITIONS if c.quota_discipline == group} for group in EXPECTED}
    assert actual == EXPECTED
    assert sum(map(len, actual.values())) == len(COMPETITIONS) == 31
    path = Path(__file__).parents[1] / 'migrations/versions/20261012_01_fis_event_groups.py'
    spec = importlib.util.spec_from_file_location('fis_event_groups_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    assert set(migration.MAPPING) == {(c.import_code, c.code, c.quota_discipline) for c in COMPETITIONS}


@pytest.mark.parametrize('group,codes', EXPECTED.items())
def test_all_events_in_one_group_deduplicate_one_person(group, codes):
    p = person(codes=codes, countsAsSingle=True)
    assert quota_keys(p) == {('AUT', group, 'M')}
    rows = evaluate_quota_usage([p, deepcopy(p)], [p, deepcopy(p)])
    assert len(rows) == 1
    assert (rows[0]['athletesEntered'], rows[0]['singleRoomsUsed']) == (1, 1)
    assert (rows[0]['officialQuota'], rows[0]['singleRoomsAllowed']) == (3, 1)


@pytest.mark.parametrize('codes,gender,group', [
    (('8185',), 'M', 'Ski Cross'), (('8185',), 'W', 'Ski Cross'),
    (('8180', '8185'), 'M', 'Ski Cross'),
    (('6192', '6193'), 'W', 'Snowboard Cross'),
    (('6180',), 'W', 'Snowboard Alpine'),
    (('8188',), 'M', 'Freestyle'), (('8195',), 'W', 'Freestyle'),
])
def test_mixed_team_membership_uses_personal_gender(codes, gender, group):
    p = person(codes=codes, gender=gender)
    rows = evaluate_quota_usage([p])
    assert {(r['discipline'], r['gender'], r['athletesEntered']) for r in rows} == {(group, gender, 1)}
    assert any(c.team_competition and c.gender == 'A' for c in COMPETITIONS if c.code in codes)


@pytest.mark.parametrize('official_gender', ['M', 'W', 'A', '', None])
@pytest.mark.parametrize('for_gender', ['M', 'W', 'A', None])
def test_official_gender_never_allocates_usage(official_gender, for_gender):
    athletes = [person('M', gender='M'), person('W', gender='W')]
    official = person('O', gender=official_gender, role='Official', countsAsSingle=True)
    official['forGender'] = for_gender
    roster = [*athletes, official, deepcopy(official)]
    rows = evaluate_quota_usage(roster, [official, deepcopy(official)])
    assert {(r['gender'], r['athletesEntered'], r['assignedOfficials'], r['singleRoomsUsed'])
            for r in rows} == {('M', 1, 1, 1), ('W', 1, 1, 0)}
    assert all((r['officialQuota'], r['singleRoomsAllowed']) == (3, 1) for r in rows)
    assert disposition_by_quota_group(roster, {'O'}) == {
        ('AUT', 'Ski Cross', g): {'peopleTotal': 2, 'peopleAssigned': 1} for g in ('M', 'W')}
    assert single_room_usage_by_quota_group(roster, {'O'}) == {
        ('AUT', 'Ski Cross', 'M'): 1}
    assert single_room_usage_by_quota_group(roster, {'O'}, {'O'}) == {}


def test_official_only_uses_active_gender_and_nation_group_contexts():
    official = person('O', codes=('8185', '6193'), gender='M', role='Official', countsAsSingle=True)
    athlete = person('W', gender='W')
    other_nation = {**person('OTHER', gender='M'), 'nationCode': 'SUI'}
    rows = evaluate_quota_usage([official, athlete, other_nation], [official])
    assert quota_keys(official, [athlete, other_nation]) == {('AUT', 'Ski Cross', 'W')}
    assert [(r['nationCode'], r['gender'], r['assignedOfficials']) for r in rows] == [
        ('AUT', 'W', 1), ('SUI', 'M', 0)]
    assert evaluate_quota_usage([official], [official]) == []


@pytest.mark.parametrize('gender', [None, '', 'A', 'Mixed', 'W_invalid', 'M_invalid', 12])
def test_invalid_athlete_gender_is_validation_failure_without_fallback(gender):
    p = person(gender=gender)
    assert quota_keys(p) == set()
    with pytest.raises(QuotaGenderValidationError) as error:
        evaluate_quota_usage([p], [p])
    assert error.value.errors[0]['code'] == 'ENTRY_QUOTA_GENDER_INVALID'
    with pytest.raises(QuotaGenderValidationError):
        disposition_by_quota_group([p])
    assert evaluate_athlete_quota_usage([p])[0]['athleteQuotaStatus'] == 'INCOMPLETE'


def test_conflicting_gender_cannot_generate_two_allowances_for_one_person():
    p = person()
    with pytest.raises(QuotaGenderValidationError) as error:
        evaluate_quota_usage([p, {**p, 'gender': 'W'}])
    assert error.value.errors[0]['code'] == 'ENTRY_QUOTA_GENDER_CONFLICT'


def test_top_level_36_20_deduplicates_across_all_child_groups():
    p = person(codes=('8171', '8179', '8185', '6170', '6174', '6193'))
    rows = evaluate_athlete_quota_usage([p, deepcopy(p)])
    assert [(r['topLevelDiscipline'], r['athleteQuotaUsed']) for r in rows] == [('Freestyle', 1), ('Snowboard', 1)]
    people = [person(str(i), codes=('8171', '8179', '8185'), gender='M' if i < 21 else 'W') for i in range(37)]
    row = evaluate_athlete_quota_usage(people)[0]
    assert row['athleteQuotaUsed'] == 37 and row['athleteGenderUsed'] == {'M': 21, 'F': 16}
    assert row['athleteQuotaExceeded'] and row['athleteGenderExceeded']['M']


@pytest.mark.parametrize('version,label,code,target', [
    (None, 'Freeski Halfpipe', '8171', 'Freeski Park & Pipe'),
    (None, 'Parallel', '6170', 'Snowboard Alpine'),
    (1, 'Freestyle', '8171', 'Freeski Park & Pipe'),
    (1, 'Freestyle', '8179', 'Freestyle'),
    (1, 'Freestyle', '8185', 'Ski Cross'),
    (1, 'Snowboard', '6170', 'Snowboard Alpine'),
    (1, 'Snowboard', '6174', 'Snowboard Park & Pipe'),
    (1, 'Snowboard', '6193', 'Snowboard Cross'),
])
def test_historical_transition_uses_exact_competition_without_broadening(database, version, label, code, target):
    rows = [Competition(**c._asdict()) for c in COMPETITIONS if c.code in {code, '8171', '8185', '6174', '6193'}]
    a = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='M',
                function='Athlete', competitions=rows)
    db.session.add(a); db.session.commit()
    selected = next(c for c in rows if c.code == code)
    details = {'quotaMembershipVersion': version, 'nationCode': 'AUT', 'discipline': label, 'gender': 'M',
        'singleRoomCandidates': [{'personKey': 'A', 'competitionIds': [str(selected.id)]}]}
    immutable = deepcopy(details)
    assert historical_approval_groups(details, a) == {('AUT', target, 'M')}
    assert details == immutable
    details['singleRoomCandidates'][0].pop('competitionIds')
    assert historical_approval_groups(details, a) == set()


def test_v2_freestyle_approval_cannot_follow_a_freeski_or_ski_cross_remap(database):
    row = Competition(**COMPETITION_BY_IMPORT_CODE['WSC_MO_M_8179']._asdict())
    a = Athlete(fis_code='A', firstname='A', lastname='Person', nation_code='AUT', gender='W',
                function='Athlete', competitions=[row])
    db.session.add(a); db.session.commit()
    details = {'quotaMembershipVersion': 2, 'nationCode': 'AUT', 'discipline': 'Freestyle', 'gender': 'W',
        'singleRoomCandidates': [{'personKey': 'A', 'competitionIds': [str(row.id)]}]}
    assert historical_approval_groups(details, a) == {('AUT', 'Freestyle', 'W')}
    row.quota_discipline = 'Ski Cross'; db.session.commit()
    assert historical_approval_groups(details, a) == set()


def test_official_approval_retains_reviewed_athlete_context_without_own_gender(database):
    c = Competition(**COMPETITION_BY_IMPORT_CODE['WSC_SXT_A_8185']._asdict())
    a = Athlete(fis_code='A', firstname='A', lastname='Athlete', nation_code='AUT', gender='W',
                function='Athlete', competitions=[c])
    o = Athlete(fis_code='O', firstname='O', lastname='Official', nation_code='AUT', gender='M',
                function='Official', competitions=[c])
    db.session.add_all([a, o]); db.session.commit()
    details = {'quotaMembershipVersion': 2, 'nationCode': 'AUT', 'discipline': 'Ski Cross', 'gender': 'W',
        'singleRoomCandidates': [{'personKey': 'O', 'competitionIds': [str(c.id)]}]}
    assert historical_approval_groups(details, o) == {('AUT', 'Ski Cross', 'W')}
    o.gender = 'A'; db.session.commit()
    assert historical_approval_groups(details, o) == {('AUT', 'Ski Cross', 'W')}
    assert historical_approval_groups({**details, 'gender': 'M'}, o) == set()


def test_saved_preview_refresh_and_invalid_gender_confirmation_gate(database):
    c = Competition(**COMPETITION_BY_IMPORT_CODE['WSC_SXT_A_8185']._asdict())
    event = Event(name='Mixed Team event')
    db.session.add(EventCompetition(event=event, competition=c, import_code=c.import_code,
        fis_codex=c.code, official_name=c.name))
    db.session.commit()
    p = person(gender='W'); p['competitionIds'] = [str(c.id)]; p['quotaDisciplines'] = ['Freestyle']
    preview = {'createdAt': datetime.utcnow(), 'eventId': event.id, 'people': [p], 'rooms': [],
               'errors': [], 'warnings': []}
    recalculate_fis_import_preview(preview)
    assert p['quotaDisciplines'] == ['Ski Cross']
    assert preview['quotaChecks'][0]['gender'] == 'W'
    assert preview['athleteQuotaChecks'][0]['topLevelDiscipline'] == 'Freestyle'
    p['gender'] = ''; PREVIEW_STORE['invalid-mixed'] = preview
    with pytest.raises(ValueError, match='blocking validation errors'):
        confirm_fis_import('invalid-mixed')
    db.session.rollback()
    assert Athlete.query.count() == 0
    assert preview['errors'][0]['code'] == 'ENTRY_QUOTA_GENDER_INVALID'
    assert preview['quotaChecks'] == []
    p['gender'] = 'W'; recalculate_fis_import_preview(preview)
    assert preview['errors'] == []


def test_initial_import_exposes_invalid_personal_gender_as_blocking_validation(database, monkeypatch):
    c = Competition(**COMPETITION_BY_IMPORT_CODE['WSC_SXT_A_8185']._asdict())
    db.session.add(c); db.session.commit()
    entries = pd.DataFrame([dict(Function='Athlete', Lastname='Person', Firstname='A',
        Nationcode='AUT', Fiscode='A', Gender='', For_gender='M', WSC_SXT_A_8185='YES')])
    rooms = pd.DataFrame(columns=sorted(ROOM_REQUIRED_COLUMNS))
    frames = iter([entries, rooms])
    monkeypatch.setattr('excel_import.load_first_sheet', lambda path: next(frames))
    preview = create_fis_import_preview('entries', 'rooms')
    assert not preview['isValid']
    assert any(e['code'] == 'ENTRY_QUOTA_GENDER_INVALID' for e in preview['errors'])
    assert PREVIEW_STORE[preview['previewToken']]['quotaChecks'] == []


def test_reconciliation_is_idempotent_and_preserves_unknown_exact_identity(database):
    c = Competition(**COMPETITION_BY_IMPORT_CODE['WSC_PRT_A_6180']._asdict())
    custom = Competition(import_code='CUSTOM', code='6170', name='Custom team', display_name='Custom',
        sport='Custom', gender='A', team_competition=True, quota_discipline='CustomGroup')
    db.session.add_all([c, custom]); db.session.commit()
    before = custom.to_dict()
    c.quota_discipline = 'Snowboard'; db.session.commit()
    mapping = [(d.import_code, d.code, d.quota_discipline) for d in COMPETITIONS]
    for _ in range(2):
        reconcile_quota_catalogue(db.session.connection(), mapping)
        db.session.commit(); db.session.expire_all()
        assert c.quota_discipline == 'Snowboard Alpine'
        assert custom.to_dict() == before


def test_frontend_backend_projections_share_business_contexts_and_arbitrary_groups():
    import subprocess
    fixture = Path(__file__).parent / 'fixtures/fis_quota_contexts.json'
    data = json.loads(fixture.read_text())
    assigned = [{**p, 'countsAsSingle': True} for p in data['people'] if p['personId'] in data['assignedPersonIds']]
    rows = evaluate_quota_usage(data['people'], assigned)
    assert [{k: r[k] for k in expected} for r, expected in zip(rows, data['expected'])] == data['expected']
    module = Path(__file__).parents[2] / 'frontend/src/app/services/quotaEvaluation.ts'
    # Test cross-language agreement from the same business fixture, including
    # partial room projections that contain no athletes but retain API contexts.
    script = '''
import {readFileSync} from 'node:fs';
const {evaluateAllQuotaGroups} = await import(process.argv[1]);
const data = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const assignments = data.people.filter(p => data.assignedPersonIds.includes(p.personId))
  .flatMap(p => p.quotaDisciplines.map(discipline => ({...p, discipline, bookingId:p.personId, countsAsSingle:true})));
const groups = evaluateAllQuotaGroups(data.expected, [...assignments, ...assignments]);
console.log(JSON.stringify(groups.map(g => ({key:g.key, usedSingleRooms:g.usedSingleRooms,
  quotaExemptSingleRooms:g.people.filter(p => p.singleRoomQuotaExemptReason).length}))));
'''
    result = subprocess.run(['node', '--experimental-strip-types', '--input-type=module', '-e', script,
                             module.as_uri(), str(fixture)], capture_output=True, text=True, check=True)
    assert json.loads(result.stdout) == [dict(key='|'.join([r['nationCode'], r['discipline'], r['gender']]),
        usedSingleRooms=r['singleRoomsUsed'],
        quotaExemptSingleRooms=r['quotaExemptSingleRooms']) for r in data['expected']]
    for p in data['people']:
        p['quotaDisciplines'] = ['TestGroup' if g == 'Ski Cross' else g for g in p['quotaDisciplines']]
    assigned = [{**p, 'countsAsSingle': True} for p in data['people'] if p['personId'] in data['assignedPersonIds']]
    rows = evaluate_quota_usage(data['people'], assigned)
    assert {r['discipline'] for r in rows} == {'TestGroup', 'Snowboard Cross'}
    assert all(r['assignedOfficials'] == 3 for r in rows if r['discipline'] == 'TestGroup')


def test_live_quota_endpoint_reports_invalid_gender_without_a_bucket(database):
    from app import get_official_quotas
    c = Competition(**COMPETITION_BY_IMPORT_CODE['WSC_SXT_A_8185']._asdict())
    a = Athlete(firstname='Invalid', lastname='Athlete', nation_code='AUT', gender='', for_gender='A',
                function='Athlete', competitions=[c])
    db.session.add(a); db.session.commit()
    with database.test_request_context('/api/fis/official-quotas'):
        response, status = get_official_quotas()
    assert status == 409
    assert response.get_json()['code'] == 'QUOTA_GENDER_REVIEW_REQUIRED'
    assert response.get_json()['validationErrors'][0]['code'] == 'ENTRY_QUOTA_GENDER_INVALID'


def test_mapped_official_without_athletes_is_explicit_preview_review(database):
    c = Competition(**COMPETITION_BY_IMPORT_CODE['WSC_SXT_A_8185']._asdict())
    db.session.add(c); db.session.commit()
    p = person(role='Official', gender='M'); p['competitionIds'] = [str(c.id)]
    preview = {'people': [p], 'rooms': [], 'errors': [], 'warnings': []}
    recalculate_fis_import_preview(preview)
    assert preview['quotaChecks'] == []
    assert any(w['code'] == 'ENTRY_QUOTA_ALLOWANCE_UNRESOLVED' for w in preview['warnings'])
