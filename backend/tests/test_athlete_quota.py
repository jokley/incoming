from test_support import prepare_import_championship
"""Overall athlete limits are independent of detailed accommodation quotas."""
from copy import deepcopy
from unittest.mock import patch

import pandas as pd
from flask import Flask
import pytest

import excel_import
from competitions import COMPETITIONS, COMPETITION_BY_IMPORT_CODE, top_level_discipline
from models import Competition, db
from quota_service import evaluate_athlete_quota_usage, evaluate_quota_usage


MAPS = {'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}}


def person(identity, codes=('WSC_PGS_M_6170',), gender='M', nation='SUI', **extra):
    result = excel_import.parse_entries_list(pd.DataFrame([{
        'Function': 'Athlete', 'Lastname': 'Person', 'Firstname': identity,
        'Fiscode': identity, 'Nationcode': nation, 'Gender': gender,
        **{code: 'YES' for code in codes},
    }]), MAPS)
    assert not result['errors']
    return {**result['people'][0], **extra}


@pytest.mark.parametrize('code,expected', [('6170', 'Snowboard'), ('6193', 'Snowboard'),
    ('8171', 'Freestyle'), ('8195', 'Freestyle'), ('9999', None),
    ('WSC_HP_M_8171', None), ('817', None), ('81710', None), (None, None)])
def test_canonical_resolver_accepts_only_exact_four_digit_codes(code, expected):
    assert top_level_discipline(code) == expected


def test_catalogue_and_persisted_competition_share_derived_representation():
    for item in COMPETITIONS:
        expected = 'Snowboard' if item.code.startswith('6') else 'Freestyle'
        assert item.top_level_discipline == expected
        persisted = Competition(code=item.code, sport=item.sport,
                                quota_discipline=item.quota_discipline)
        assert persisted.top_level_discipline == expected
        assert persisted.sport == item.sport
        assert persisted.quota_discipline == item.quota_discipline


@pytest.mark.parametrize('codes,expected', [
    (('WSC_PGS_M_6170', 'WSC_PSL_M_6177', 'WSC_SBX_M_6191'), ['Snowboard']),
    (('WSC_MO_M_8179', 'WSC_DM_M_8186', 'WSC_AE_M_8193'), ['Freestyle']),
    (('WSC_HP_M_8171', 'WSC_MO_M_8179'), ['Freestyle']),
    (('WSC_PGS_M_6170', 'WSC_MO_M_8179'), ['Freestyle', 'Snowboard']),
    (('WSC_PGS_M_6170', 'WSC_PRT_A_6180'), ['Snowboard']),
])
def test_memberships_count_one_person_per_top_level_discipline(codes, expected):
    athlete = person('ONE', codes)
    before = deepcopy(athlete)
    rows = evaluate_athlete_quota_usage([athlete, deepcopy(athlete)])
    assert [row['topLevelDiscipline'] for row in rows] == expected
    assert all(row['athleteQuotaUsed'] == 1 for row in rows)
    assert all(row['athleteGenderUsed'] == {'M': 1, 'F': 0} for row in rows)
    assert athlete == before
    assert athlete['competitionImportCodes'] == list(codes)
    assert athlete['quotaDisciplines'] == sorted({
        COMPETITION_BY_IMPORT_CODE[code].quota_discipline for code in codes})


@pytest.mark.parametrize('male,female,total_exceeded,male_exceeded', [
    (20, 16, False, False), (20, 17, True, False), (21, 15, False, True)])
def test_total_and_gender_limits_are_independent(male, female, total_exceeded, male_exceeded):
    people = [person(f'M{i}') for i in range(male)]
    people += [person(f'F{i}', gender='W') for i in range(female)]
    row = evaluate_athlete_quota_usage(people)[0]
    assert row['athleteQuotaUsed'] == male + female
    assert row['athleteQuotaLimit'] == 36
    assert row['athleteGenderLimit'] == 20
    assert row['athleteGenderUsed'] == {'M': male, 'F': female}
    assert row['athleteQuotaExceeded'] is total_exceeded
    assert row['athleteGenderExceeded'] == {'M': male_exceeded, 'F': False}
    assert row['athleteQuotaStatus'] == ('EXCEEDED' if total_exceeded or male_exceeded else 'WITHIN_BASE_LIMITS')


def test_nations_and_top_level_totals_are_independent():
    people = [person(f'S{i}') for i in range(37)]
    people += [person('AUT', nation='AUT'), person('FREE', ('WSC_MO_M_8179',))]
    rows = {(r['nationCode'], r['topLevelDiscipline']): r for r in evaluate_athlete_quota_usage(people)}
    assert rows['SUI', 'Snowboard']['athleteQuotaUsed'] == 37
    assert rows['SUI', 'Freestyle']['athleteQuotaUsed'] == 1
    assert rows['AUT', 'Snowboard']['athleteQuotaUsed'] == 1
    assert not rows['SUI', 'Freestyle']['athleteQuotaExceeded']
    assert not rows['AUT', 'Snowboard']['athleteQuotaExceeded']


def test_officials_and_administrative_exemptions_do_not_change_athlete_usage():
    people = [person('A', singleRoomQuotaExemptReason='WORLD_CHAMPION'),
              person('B', singleRoomQuotaExemptReason='OTHER'),
              person('COACH', function='NSA Coach')]
    row = evaluate_athlete_quota_usage(people)[0]
    assert row['athleteQuotaUsed'] == 2
    assert row['worldChampionExceptionSupported'] is False


def test_missing_person_gender_is_reported_without_using_team_gender():
    row = evaluate_athlete_quota_usage([person('A', gender='', forGender='A')])[0]
    assert row['athleteQuotaUsed'] == 1
    assert row['athleteGenderUsed'] == {'M': 0, 'F': 0}
    assert row['athleteGenderUnknown'] == 1
    assert row['athleteQuotaStatus'] == 'INCOMPLETE'


def test_selected_mapping_is_authoritative_even_for_opaque_column_names():
    mapping = {'WSC_CUSTOM': COMPETITION_BY_IMPORT_CODE['WSC_MO_M_8179']}
    result = excel_import.parse_entries_list(pd.DataFrame([{
        'Function': 'Athlete', 'Lastname': 'One', 'Firstname': 'Ada',
        'Nationcode': 'SUI', 'Gender': 'F', 'WSC_CUSTOM': 'YES'}]), MAPS, mapping)
    assert result['people'][0]['topLevelDisciplines'] == ['Freestyle']
    assert evaluate_athlete_quota_usage(result['people'])[0]['athleteQuotaUsed'] == 1


def test_new_evaluation_does_not_modify_existing_detailed_quota_results():
    people = [person('A', ('WSC_MO_M_8179', 'WSC_AE_M_8193'))]
    existing = evaluate_quota_usage(people, people)
    evaluate_athlete_quota_usage(people)
    assert evaluate_quota_usage(people, people) == existing
    assert {r['discipline'] for r in existing} == {'Freestyle'}


def test_preview_exposes_informational_checks_without_new_warnings_or_gates():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
                      SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    entries = pd.DataFrame([{
        'Function': 'Athlete', 'Lastname': 'Person', 'Firstname': f'M{i}',
        'Fiscode': f'M{i}', 'Nationcode': 'SUI', 'Gender': 'M',
        'WSC_PGS_M_6170': 'YES',
    } for i in range(37)])
    rooms = pd.DataFrame(columns=sorted(excel_import.ROOM_REQUIRED_COLUMNS))
    with app.app_context():
        db.create_all()
        db.session.add(Competition(**COMPETITION_BY_IMPORT_CODE['WSC_PGS_M_6170']._asdict()))
        db.session.commit()
        with patch.object(excel_import, 'load_first_sheet', side_effect=[entries, rooms]):
            result = excel_import.create_fis_import_preview('entries', 'rooms', prepare_import_championship(Competition.query.all()))
        try:
            assert result['isValid'] is True
            assert result['warnings'] == []
            assert result['athleteQuotaChecks'][0]['athleteQuotaExceeded'] is True
            raw = excel_import.PREVIEW_STORE[result['previewToken']]
            assert raw['athleteQuotaChecks'] == result['athleteQuotaChecks']
            for person_record in raw['people']:
                person_record['competitionIds'] = [str(Competition.query.one().id)]
            detailed = deepcopy(raw['quotaChecks'])
            raw['singleRoomQuotaExemptOverrides'] = {'M0': 'WORLD_CHAMPION'}
            excel_import.recalculate_fis_import_preview(raw)
            assert raw['athleteQuotaChecks'] == result['athleteQuotaChecks']
            assert raw['quotaChecks'] == detailed
            assert raw['warnings'] == []
        finally:
            excel_import.PREVIEW_STORE.pop(result['previewToken'], None)
            db.session.remove()
            db.drop_all()


def test_persisted_identity_deduplicates_even_when_import_keys_differ():
    athlete = person('FIRST', personId=42)
    repeated = {**athlete, 'matchKey': 'SECOND'}
    assert evaluate_athlete_quota_usage([athlete, repeated])[0]['athleteQuotaUsed'] == 1


def test_conflicting_gender_is_incomplete_without_double_counting_person():
    athlete = person('ONE')
    row = evaluate_athlete_quota_usage([athlete, {**athlete, 'gender': 'F'}])[0]
    assert row['athleteQuotaUsed'] == 1
    assert row['athleteGenderUnknown'] == 1
    assert row['athleteQuotaStatus'] == 'INCOMPLETE'


def test_membership_requires_stable_identity():
    athlete = person('ONE')
    athlete.pop('matchKey')
    with pytest.raises(ValueError, match='stable person identity'):
        evaluate_athlete_quota_usage([athlete])
