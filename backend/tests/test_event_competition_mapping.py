import pandas as pd
from flask import Flask

from excel_import import parse_entries_list
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
