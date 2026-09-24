import pandas as pd

from competitions import COMPETITIONS, COMPETITION_BY_IMPORT_CODE
from excel_import import parse_entries_list
from quota_service import evaluate_quota_usage


EXPECTED_CODES = {
    '6170', '6172', '6174', '6175', '6177', '6178', '6180', '6182',
    '6183', '6188', '6190', '6191', '6192', '6193', '8171', '8172',
    '8178', '8179', '8180', '8181', '8183', '8184', '8185', '8186',
    '8187', '8188', '8193', '8194', '8195', '8196', '8197',
}


def test_catalogue_is_complete_and_uses_2027_codex_values():
    assert len(COMPETITIONS) == 31
    assert {competition.code for competition in COMPETITIONS} == EXPECTED_CODES
    assert len(COMPETITION_BY_IMPORT_CODE) == len(COMPETITIONS)


def test_catalogue_carries_official_and_presentation_metadata():
    parallel = COMPETITION_BY_IMPORT_CODE['WSC_PGS_M_6170']
    assert parallel.name == "Men's Parallel Giant Slalom"
    assert parallel.display_name == 'Parallel Giant Slalom'
    assert parallel.quota_discipline == 'Parallel'
    assert parallel.sport == 'Snowboard'
    assert parallel.gender == 'M'
    assert parallel.team_competition is False

    team = COMPETITION_BY_IMPORT_CODE['WSC_DMT_A_8188']
    assert team.name == 'Dual Moguls Team'
    assert team.display_name == 'Dual Moguls Team'
    assert team.quota_discipline == 'Moguls'
    assert team.sport == 'Freestyle Ski'
    assert team.gender == 'A'
    assert team.team_competition is True


def test_every_yes_column_creates_a_membership_without_duplicate_person():
    frame = pd.DataFrame([{
        'Function': 'Athlete', 'Lastname': 'MERIMEE MANTOVANI',
        'Firstname': 'Luca', 'Nationcode': 'BRA', 'Fiscode': '9190576',
        'Gender': 'M', 'WSC_BA_M_6182': 'YES', 'WSC_SS_M_6188': 'YES',
        'WSC_SBX_M_6191': 'NO',
    }])
    result = parse_entries_list(frame, {'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}})
    assert len(result['people']) == 1
    assert result['people'][0]['competitionImportCodes'] == ['WSC_BA_M_6182', 'WSC_SS_M_6188']
    assert result['people'][0]['quotaDisciplines'] == ['Snowboard Big Air', 'Snowboard Slopestyle']


def test_quota_counts_each_athlete_once_per_group_and_in_distinct_groups():
    people = [{
        'function': 'Athlete', 'nationCode': 'SUI', 'gender': 'M',
        'quotaDisciplines': ['Moguls', 'Moguls', 'Freeski Big Air'],
    }]
    rows = evaluate_quota_usage(people)
    assert {(row['discipline'], row['athletesEntered']) for row in rows} == {
        ('Moguls', 1), ('Freeski Big Air', 1),
    }


def test_unknown_wsc_column_is_blocking_instead_of_inferred():
    frame = pd.DataFrame([{
        'Function': 'Athlete', 'Lastname': 'Future', 'Firstname': 'Event',
        'Nationcode': 'SUI', 'WSC_UNKNOWN_9999': 'YES',
    }])
    result = parse_entries_list(frame, {'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}})
    assert result['errors'][0]['code'] == 'ENTRY_UNKNOWN_COMPETITION_COLUMNS'


def test_person_based_disposition_uses_real_brazil_roster_memberships():
    """Regression roster taken from the supplied FIS ENTRIES-LIST files."""
    from quota_service import disposition_by_quota_group

    people = [
        {'personId': 229814, 'function': 'Athlete', 'nationCode': 'BRA', 'gender': 'M',
         'quotaDisciplines': ['Snowboard Cross']},  # Noah BETHONICO
        {'personId': 240003, 'function': 'Athlete', 'nationCode': 'BRA', 'gender': 'M',
         'quotaDisciplines': ['Snowboard Big Air', 'Snowboard Slopestyle']},  # Luca MERIMEE MANTOVANI
        {'personId': 142877, 'function': 'Athlete', 'nationCode': 'BRA', 'gender': 'M',
         'quotaDisciplines': ['Snowboard Halfpipe']},  # Patrick BURGENER
        {'personId': 229815, 'function': 'Athlete', 'nationCode': 'BRA', 'gender': 'M',
         'quotaDisciplines': ['Snowboard Halfpipe']},  # Augustinho TEIXEIRA
    ]

    result = disposition_by_quota_group(people, {229814, 240003})

    assert result[('BRA', 'Snowboard Cross', 'M')] == {
        'peopleTotal': 1, 'peopleAssigned': 1}
    assert result[('BRA', 'Snowboard Big Air', 'M')] == {
        'peopleTotal': 1, 'peopleAssigned': 1}
    assert result[('BRA', 'Snowboard Slopestyle', 'M')] == {
        'peopleTotal': 1, 'peopleAssigned': 1}
    assert result[('BRA', 'Snowboard Halfpipe', 'M')] == {
        'peopleTotal': 2, 'peopleAssigned': 0}


def test_disposition_deduplicates_competitions_with_the_same_quota_discipline():
    from quota_service import (disposition_by_quota_group,
                               single_room_usage_by_quota_group)

    person = {'personId': 7, 'function': 'Athlete', 'nationCode': 'SUI', 'gender': 'F',
              'quotaDisciplines': ['Moguls', 'Moguls']}
    assert disposition_by_quota_group([person], {7}) == {
        ('SUI', 'Moguls', 'F'): {'peopleTotal': 1, 'peopleAssigned': 1}}
    assert single_room_usage_by_quota_group([person], {7}) == {
        ('SUI', 'Moguls', 'F'): 1}
