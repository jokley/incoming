import pandas as pd

from competitions import COMPETITION_BY_IMPORT_CODE
from excel_import import parse_entries_list


def test_official_mapping_contains_production_columns():
    assert COMPETITION_BY_IMPORT_CODE['WSC_BA_M_6182'][2] == "Men's Big Air"
    assert COMPETITION_BY_IMPORT_CODE['WSC_DM_M_8217'][3] == 'Freestyle Ski'
    assert COMPETITION_BY_IMPORT_CODE['WSC_PRT_A_6180'][5] is True


def test_every_yes_column_creates_a_membership_without_duplicate_person():
    frame = pd.DataFrame([{
        'Function': 'Athlete', 'Lastname': 'MERIMEE MANTOVANI',
        'Firstname': 'Luca', 'Nationcode': 'BRA', 'Fiscode': '9190576',
        'WSC_BA_M_6182': 'YES', 'WSC_SS_M_6188': 'YES',
        'WSC_SBX_M_6191': 'NO',
    }])
    result = parse_entries_list(frame, {'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}})
    assert len(result['people']) == 1
    assert result['people'][0]['competitionImportCodes'] == ['WSC_BA_M_6182', 'WSC_SS_M_6188']


def test_unknown_wsc_column_is_blocking_instead_of_inferred():
    frame = pd.DataFrame([{
        'Function': 'Athlete', 'Lastname': 'Future', 'Firstname': 'Event',
        'Nationcode': 'SUI', 'WSC_UNKNOWN_9999': 'YES',
    }])
    result = parse_entries_list(frame, {'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}})
    assert result['errors'][0]['code'] == 'ENTRY_UNKNOWN_COMPETITION_COLUMNS'
