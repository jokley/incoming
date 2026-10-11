"""Import helper contracts characterized before the structural extraction."""
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import patch

import pandas as pd
import pytest
from flask import Flask

import excel_import as legacy
from models import Athlete, Competition, Event, EventCompetition, ImportRun, db


@pytest.mark.parametrize('value', [None, float('nan'), pd.NA, pd.NaT])
def test_null_normalization(value):
    assert legacy.normalize_string(value) == ''
    assert legacy.normalize_whitespace(value) == ''
    assert not legacy.has_value(value)
    assert not legacy.parse_boolean(value)
    assert legacy.parse_date(value) is None
    assert legacy.parse_datetime(value) is None


def test_string_and_presence_quirks():
    assert legacy.normalize_string('  MÜller  Ada\n ') == 'muller  ada'
    assert legacy.normalize_whitespace(' A\u00a0 B\r\n C ') == 'A B C'
    assert not legacy.has_value(' \n\u00a0 ')
    assert legacy.has_value(False)
    assert legacy.has_value(0)


@pytest.mark.parametrize('value,expected', [('JA', True), (' x ', True), ('1', True),
    ('1.0', False), ('on', False), ('no', False), (0.9, False), (-0.9, False),
    (-1.2, True), (True, True), ('', False)])
def test_boolean_conversion(value, expected):
    assert legacy.parse_boolean(value) is expected


def test_date_and_datetime_quirks():
    stamp = datetime(2027, 3, 4, 12, 30)
    assert legacy.parse_date(stamp) == stamp.date()
    day = stamp.date()
    assert legacy.parse_date(day) is day
    assert legacy.parse_date(1) == date(1899, 12, 31)
    assert legacy.parse_date('1') == date(1899, 12, 31)
    assert legacy.parse_date('03/04/2027') == date(2027, 4, 3)
    assert legacy.parse_date(True) is None
    assert legacy.parse_date('2027-03-04T12:30:00') is None
    assert legacy.parse_datetime(stamp) is stamp
    assert legacy.parse_datetime('04.03.2027 12:30') == stamp
    assert legacy.parse_datetime(stamp.date()) is None
    assert legacy.parse_datetime(1) is None
    assert legacy.parse_datetime('2027-03-04T12:30:00') is None


def test_column_alias_copy_duplicate_and_day_prefix_contract():
    frame = pd.DataFrame([[1] * 7], columns=[' FIS Code ', 'Fiscóde', 'Discipline',
        'Shared with First meal', 'Appartment', ' Unknown\n column ', 'Mon 04.03.2027 extra'])
    result = legacy.normalize_columns(frame)
    assert result.columns.tolist() == ['Fiscode', 'Fiscode', 'Industryname',
        'Shared_with_First_meal', 'Appartment', 'Unknown column', 'Mon 04.03.2027 extra']
    assert frame.columns[0] == ' FIS Code '
    assert legacy.detect_day_columns(result) == [{'column': 'Mon 04.03.2027 extra', 'date': date(2027, 3, 4)}]
    assert legacy.validate_required_columns(result, {'Z', 'A', 'Fiscode'}) == ['A', 'Z']


def person(**overrides):
    return {'lastname': 'Müller', 'firstname': 'Ada', 'nationCode': 'SUI',
        'matchKey': 'one', **overrides}


def test_identifier_precedence_and_no_fallback_on_mismatch():
    fis, competitor, name = object(), object(), object()
    maps = {'by_fis_code': {'ABC': fis}, 'by_competitor_id': {'42': competitor},
        'by_name_key': {legacy.build_name_key('Muller', 'Ada', 'SUI'): name}}
    assert legacy._find_existing_athlete(person(fisCode=' abc ', competitorId='42'), maps) is fis
    assert legacy._find_existing_athlete(person(fisCode='unknown', competitorId='42'), maps) is None
    assert legacy._find_existing_athlete(person(competitorId=42), maps) is competitor
    assert legacy._find_existing_athlete(person(competitorId='unknown'), maps) is None
    assert legacy._find_existing_athlete(person(), maps) is name


def make_app():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    return app


def test_existing_map_first_fis_last_competitor_and_normalized_name_collision():
    app = make_app()
    with app.app_context():
        db.create_all()
        first = Athlete(lastname='Müller', firstname='Ada', nation_code='SUI', fis_code=' abc ', competitor_id='42')
        last = Athlete(lastname='Muller', firstname='ADA', nation_code='sui', fis_code='ABC', competitor_id='42')
        db.session.add_all([first, last]); db.session.commit()
        maps = legacy._build_existing_athlete_maps()
        assert maps['by_fis_code']['ABC'] is first
        assert maps['by_competitor_id']['42'] is last
        assert maps['by_name_key']['muller|ada|sui'] is last


def test_room_index_last_collision_and_nationless_matching_even_with_wrong_nation():
    first = person(competitorId='42')
    last = person(lastname='Muller', nationCode='USA', matchKey='two', competitorId='42')
    indexed = legacy._index_people([first, last])
    assert indexed['by_name_no_nation']['muller|ada|'] is last
    assert indexed['by_competitor_id']['42'] is last
    assert legacy._index_people([first, person(matchKey='three')])['by_name']['muller|ada|sui']['matchKey'] == 'three'
    frame = pd.DataFrame([{'Lastname': 'Muller', 'Firstname': 'Ada', 'Nationcode': 'CAN',
        'Arrival_date': '04.03.2027', 'Departure_date': '05.03.2027', 'Room_type': 'Single'}])
    result = legacy.parse_room_list(frame, [first, last])
    assert result['errors'] == []
    assert result['rooms'][0]['person1Key'] == 'two'


def test_structured_error_and_event_id_legacy_coercion():
    assert legacy.normalize_event_id(True) == 1
    assert legacy.normalize_event_id(1.9) == 1
    error = legacy.ImportValidationError('CODE', 'message', event_id=7, import_code='WSC_TEST')
    assert error.to_dict() == {'error': 'CODE', 'message': 'message', 'event_id': '7', 'import_code': 'WSC_TEST'}
    assert legacy.ImportValidationError('CODE', 'message').to_dict() == {'error': 'CODE', 'message': 'message'}


@pytest.mark.parametrize('change,code', [('missing', 'EVENT_NOT_FOUND'), ('inactive', 'EVENT_INACTIVE'),
    ('mapping_inactive', 'UNKNOWN_COMPETITION_CODE'), ('mapping_changed', 'UNKNOWN_COMPETITION_CODE')])
def test_confirmation_revalidates_after_run_flush_and_keeps_token(change, code):
    app = make_app()
    with app.app_context():
        db.create_all()
        comp = Competition(import_code='legacy', code='legacy', name='Test', display_name='Test', sport='Snowboard', gender='M', quota_discipline='Big Air')
        event = Event(name='Selected')
        mapping = EventCompetition(event=event, competition=comp, import_code='WSC_TEST', fis_codex='123', official_name='Test')
        db.session.add_all([event, comp, mapping]); db.session.commit()
        event_id = event.id
        token = 'characterization'
        legacy.PREVIEW_STORE[token] = {'createdAt': datetime.utcnow(), 'eventId': event_id,
            'errors': [], 'people': [{'competitionImportCodes': ['WSC_TEST']}], 'rooms': []}
        if change == 'missing':
            db.session.delete(event)
        elif change == 'inactive':
            event.active = False
        elif change == 'mapping_inactive':
            mapping.active = False
        else:
            mapping.import_code = 'WSC_CHANGED'
        db.session.commit()
        try:
            with pytest.raises(legacy.ImportValidationError) as caught:
                legacy.confirm_fis_import(token)
            assert caught.value.code == code
            assert caught.value.to_dict()['event_id'] == str(event_id)
            assert ImportRun.query.count() == 1
            assert Athlete.query.count() == 0
            assert token in legacy.PREVIEW_STORE
            if code == 'UNKNOWN_COMPETITION_CODE':
                assert caught.value.to_dict()['import_code'] == 'WSC_TEST'
        finally:
            db.session.rollback()
            legacy.PREVIEW_STORE.pop(token, None)


def test_preview_selects_only_active_mapping_and_preserves_unknown_error_structure():
    event = SimpleNamespace(id=7, name='Selected', competition_mappings=[
        SimpleNamespace(active=True, import_code='WSC_OK', competition=SimpleNamespace(quota_discipline='Big Air')),
        SimpleNamespace(active=False, import_code='WSC_BAD', competition=object())])
    entries = pd.DataFrame([{'Lastname': 'One', 'Firstname': 'Ada', 'Nationcode': 'SUI',
        'Function': 'Athlete', 'WSC_BAD': 'NO'}])
    rooms = pd.DataFrame(columns=list(legacy.ROOM_REQUIRED_COLUMNS))
    with patch.object(legacy, 'load_first_sheet', side_effect=[entries, rooms]), \
         patch.object(legacy, '_build_existing_athlete_maps', return_value={'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}}), \
         patch.object(legacy, 'build_quota_warnings', return_value=[]), \
         patch.object(legacy, 'preserved_single_room_approvals', return_value={}), \
         patch.object(legacy, 'build_disposition_analysis', return_value={}):
        with pytest.raises(legacy.ImportValidationError) as caught:
            legacy.create_fis_import_preview('entries', 'rooms', event)
    assert caught.value.to_dict() == {'error': 'UNKNOWN_COMPETITION_CODE', 'event_id': '7',
        'import_code': 'WSC_BAD', 'message': 'Unbekannter Competition-Code WSC_BAD für Event Selected'}


def test_compatibility_exports_are_the_extracted_objects():
    from imports import event_context, identity, normalization
    for module, names in (
        (normalization, ('normalize_string', 'normalize_whitespace', 'has_value', 'parse_boolean',
            'parse_date', 'parse_datetime', '_col_key', 'normalize_columns', 'detect_day_columns',
            'validate_required_columns', 'DAY_COLUMN_PATTERN', 'DATETIME_FORMATS')),
        (identity, ('build_name_key', '_build_existing_athlete_maps', '_find_existing_athlete', '_index_people')),
        (event_context, ('ImportValidationError', 'normalize_event_id')),
    ):
        for name in names:
            assert getattr(legacy, name) is getattr(module, name)


def test_active_mapping_uses_mapping_flag_and_last_duplicate_without_filtering_competition():
    from imports.event_context import active_competition_mapping
    first, last = object(), SimpleNamespace(active=False)
    event = SimpleNamespace(competition_mappings=[
        SimpleNamespace(active=True, import_code='WSC_TEST', competition=first),
        SimpleNamespace(active=True, import_code='WSC_TEST', competition=last),
        SimpleNamespace(active=False, import_code='WSC_OTHER', competition=object()),
    ])
    assert active_competition_mapping(event) == {'WSC_TEST': last}
