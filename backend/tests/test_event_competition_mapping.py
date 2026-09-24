import pandas as pd
from flask import Flask

from competitions import COMPETITIONS
from excel_import import (ImportValidationError, PREVIEW_STORE, confirm_fis_import,
                          normalize_event_id, parse_entries_list)
from models import Athlete, Competition, Event, EventCompetition, db


def make_app():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    return app


def competition():
    return Competition(import_code='legacy', code='legacy', name='Big Air M',
        display_name='Snowboard Big Air', sport='Snowboard', gender='M',
        team_competition=False, quota_discipline='Snowboard Big Air', active=True)


def test_competition_has_independent_mappings_in_multiple_events():
    app = make_app()
    with app.app_context():
        db.create_all()
        comp = competition()
        first = Event(name='WSC Montafon 2027', year=2027)
        second = Event(name='Test Event', active=True)
        db.session.add_all([comp, first, second]); db.session.flush()
        first.competition_mappings.append(EventCompetition(competition=comp, fis_codex='6182',
            import_code='WSC_BA_M_6182', official_name="Men's Big Air"))
        second.competition_mappings.append(EventCompetition(competition=comp, fis_codex='9999',
            import_code='TEST_BA_M', official_name='Test Big Air'))
        db.session.commit()
        assert len(first.competition_mappings) == 1
        assert first.competition_mappings[0].fis_codex == '6182'
        assert second.competition_mappings[0].fis_codex == '9999'
        first.competition_mappings[0].official_name = 'Changed'
        db.session.commit()
        assert second.competition_mappings[0].official_name == 'Test Big Air'


def test_selected_event_mapping_blocks_unknown_and_inactive_codes():
    frame = pd.DataFrame([{'Function':'Athlete','Lastname':'Test','Firstname':'Person',
        'Nationcode':'SUI','WSC_BA_M_6182':'YES'}])
    comp = type('MappedCompetition', (), {'quota_discipline':'Snowboard Big Air'})()
    accepted = parse_entries_list(frame, {}, {'WSC_BA_M_6182': comp}, 'WSC Montafon 2027')
    blocked = parse_entries_list(frame, {}, {}, 'Test Event')
    assert not accepted['errors']
    assert accepted['people'][0]['quotaDisciplines'] == ['Snowboard Big Air']
    assert blocked['errors'][0]['code'] == 'ENTRY_UNKNOWN_COMPETITION_COLUMNS'
    assert blocked['errors'][0]['message'] == 'Unbekannter Competition-Code WSC_BA_M_6182 für Event Test Event'


def test_mapping_copy_creates_independent_rows():
    app = make_app()
    with app.app_context():
        db.create_all(); comp=competition(); source=Event(name='Source'); target=Event(name='Target')
        db.session.add_all([comp,source,target]); db.session.flush()
        original=EventCompetition(event=source,competition=comp,fis_codex='6182',import_code='WSC_BA_M_6182',official_name="Men's Big Air")
        copied=EventCompetition(event=target,competition=comp,fis_codex=original.fis_codex,import_code=original.import_code,official_name=original.official_name)
        db.session.add_all([original,copied]);db.session.commit()
        assert original.id != copied.id
        copied.fis_codex='9999';db.session.commit()
        assert original.fis_codex == '6182'


def test_athlete_membership_remains_global_and_distinct():
    app=make_app()
    with app.app_context():
        db.create_all(); comp=competition(); athlete=Athlete(lastname='One',firstname='Person',nation_code='SUI')
        athlete.competitions=[comp];db.session.add(athlete);db.session.commit()
        event=Event(name='Later Event');db.session.add(event);db.session.commit()
        assert [item.id for item in athlete.competitions] == [comp.id]
        assert db.session.query(Athlete.id).distinct().count() == 1


def test_current_2027_catalogue_has_all_expected_mappings_and_no_legacy_codices():
    assert len(COMPETITIONS) == 31
    codices = {row.code for row in COMPETITIONS}
    assert {'8179', '8183', '8186', '8187', '8193', '8194', '8195'} <= codices
    assert codices.isdisjoint({'8212', '8213', '8217', '8218', '8226', '8233', '8234'})


def test_final_import_resolves_membership_through_selected_event_mapping():
    app = make_app()
    with app.app_context():
        db.create_all(); comp = competition(); event = Event(name='WSC Montafon 2027')
        mapping = EventCompetition(event=event, competition=comp, fis_codex='6182',
            import_code='WSC_BA_M_6182', official_name="Men's Big Air")
        db.session.add_all([comp, event, mapping]); db.session.commit()
        token = 'event-import-test'
        PREVIEW_STORE[token] = {
            'createdAt': __import__('datetime').datetime.utcnow(), 'eventId': str(event.id),
            'errors': [], 'warnings': [], 'quotaChecks': [], 'rooms': [],
            'dispositionAnalysis': {'changes': []},
            'people': [{'matchKey':'123', 'fisCode':'123', 'firstname':'Ada', 'lastname':'Test',
                'nationCode':'SUI', 'function':'Athlete', 'gender':'M', 'industryName':'Big Air',
                'competitionImportCodes':['WSC_BA_M_6182'], 'quotaDisciplines':['Snowboard Big Air']}],
        }
        result = confirm_fis_import(token)
        athlete = Athlete.query.one()
        assert result['summary']['peopleCreated'] == 1
        assert athlete.competitions == [comp]
        assert db.session.query(Athlete.id).distinct().count() == 1


def test_event_id_normalization_accepts_multipart_string_and_rejects_invalid_values():
    assert normalize_event_id('1') == 1
    for value in (None, '', 'abc'):
        try:
            normalize_event_id(value)
            assert False, f'{value!r} must not be accepted as an event id'
        except ImportValidationError as exc:
            assert exc.code == 'INVALID_EVENT_ID'


def test_final_import_rejects_mapping_deactivated_after_preview():
    app = make_app()
    with app.app_context():
        db.create_all(); comp = competition(); event = Event(name='Test Event')
        db.session.add_all([comp, event]); db.session.flush()
        db.session.add(EventCompetition(event=event, competition=comp, fis_codex='6182',
            import_code='WSC_BA_M_6182', official_name="Men's Big Air", active=False))
        db.session.commit(); token = 'inactive-mapping-test'
        PREVIEW_STORE[token] = {'createdAt': __import__('datetime').datetime.utcnow(),
            'eventId': event.id, 'errors': [], 'people': [{
                'competitionImportCodes': ['WSC_BA_M_6182']}], 'rooms': []}
        try:
            confirm_fis_import(token)
            assert False, 'inactive mapping must block final import'
        except ImportValidationError as exc:
            assert exc.code == 'UNKNOWN_COMPETITION_CODE'
            assert exc.event_id == event.id
