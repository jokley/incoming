"""Source evidence from the USA export survives failed exact Event resolution."""
from datetime import datetime
from types import SimpleNamespace

import pandas as pd
import pytest
from flask import Flask

from competitions import COMPETITION_BY_IMPORT_CODE
from excel_import import (PREVIEW_STORE, parse_entries_list, recalculate_fis_import_preview,
                          confirm_fis_import, wsc_membership_errors)
from models import db

USA_COLUMNS = ['WSC_HP_W_6175', 'WSC_HP_M_6174', 'WSC_PSL_W_6178', 'WSC_PSL_M_6177',
    'WSC_PRT_A_6180', 'WSC_BA_W_6183', 'WSC_BA_M_6182', 'WSC_SS_W_6190',
    'WSC_SS_M_6188', 'WSC_SBX_W_6192', 'WSC_SBX_M_6191', 'WSC_BXT_A_6193',
    'WSC_PGS_W_6172', 'WSC_PGS_M_6170']
EXAMPLES = [('BARBIERI', 'Alessandro', ['WSC_HP_M_6174']),
    ('BAUMGARTNER', 'Nick', ['WSC_SBX_M_6191', 'WSC_BXT_A_6193']),
    ('BOTERO', 'Emilio', ['WSC_PSL_M_6177', 'WSC_PRT_A_6180', 'WSC_PGS_M_6170']),
    ('DEPRIEST', 'Brooklyn', ['WSC_BA_M_6182', 'WSC_SS_M_6188'])]
MAPS = {'by_fis_code': {}, 'by_competitor_id': {}, 'by_name_key': {}}


def frame(affirmative=True):
    return pd.DataFrame([dict(Function='Athlete', Lastname=last, Firstname=first,
        Nationcode='USA', Gender='M', **{c: 'YES' if affirmative and c in codes else 'NO'
        for c in USA_COLUMNS}) for last, first, codes in EXAMPLES])


def mapping():
    return {c: SimpleNamespace(id=i+1, quota_discipline=COMPETITION_BY_IMPORT_CODE[c].quota_discipline)
            for i, c in enumerate(USA_COLUMNS)}


def test_real_usa_codes_resolve_exact_event_mapping():
    parsed = parse_entries_list(frame(), MAPS, mapping(), 'Montafon', 7)
    assert not parsed['errors']
    for person, (_, _, codes) in zip(parsed['people'], EXAMPLES):
        assert person['affirmativeWscColumns'] == codes
        assert len(person['competitionIds']) == len(codes)
        assert person['quotaDisciplines']
    assert parsed['people'][1]['quotaDisciplines'] == ['Snowboard Cross']


def test_missing_mapping_blocks_rows_and_confirmation():
    parsed = parse_entries_list(frame(), MAPS, {}, 'Wrong event', 7)
    errors = [e for e in parsed['errors'] if e['code'].startswith('ENTRY_WSC_MEMBERSHIP')]
    assert len(errors) == 5
    assert errors[0]['details']['affirmativeMembershipCount'] == 8
    assert errors[0]['details']['mappedMembershipCount'] == 0
    detail = errors[1]['details']
    assert detail['personName'] == 'BARBIERI Alessandro'
    assert detail['personKey'] and detail['affirmativeSourceWscColumns'] == ['WSC_HP_M_6174']
    assert detail['extractedImportCodes'] == ['WSC_HP_M_6174']
    assert detail['resolvedCompetitionIds'] == detail['resolvedEventGroups'] == []
    assert detail['selectedEventId'] == 7
    token = 'unresolved-source'
    PREVIEW_STORE[token] = dict(createdAt=datetime.utcnow(), eventId=7, **parsed)
    try:
        from test_import_extraction_characterization import make_app
        with make_app().app_context():
            from models import db
            db.create_all()
            with pytest.raises(ValueError, match='blocking validation errors|blockierende Fehler'):
                confirm_fis_import(token)
    finally:
        PREVIEW_STORE.pop(token, None)


def test_only_unresolved_row_is_blocked_in_partially_mapped_file():
    selected = mapping(); selected.pop('WSC_HP_M_6174')
    parsed = parse_entries_list(frame(), MAPS, selected, 'Montafon', 7)
    errors = [e for e in parsed['errors'] if e['code'].startswith('ENTRY_WSC_MEMBERSHIP')]
    assert len(errors) == 1
    assert errors[0]['details']['personName'] == 'BARBIERI Alessandro'


def test_all_no_does_not_raise_lost_membership_error():
    parsed = parse_entries_list(frame(False), MAPS, {}, 'Montafon', 7)
    assert not any(e['code'].startswith('ENTRY_WSC_MEMBERSHIP') for e in parsed['errors'])


def test_missing_event_group_blocks_despite_resolved_competition():
    selected = mapping(); selected['WSC_HP_M_6174'].quota_discipline = None
    parsed = parse_entries_list(frame(), MAPS, selected, 'Montafon', 7)
    errors = wsc_membership_errors(parsed['people'], 7)
    assert len(errors) == 1
    assert errors[0]['details']['resolvedCompetitionIds'] == ['2']
    assert errors[0]['details']['resolvedEventGroups'] == []


def test_one_lost_yes_membership_blocks_person_with_another_valid_membership():
    selected = mapping(); selected.pop('WSC_BXT_A_6193')
    parsed = parse_entries_list(frame(), MAPS, selected, 'Montafon', 7)
    person = parsed['people'][1]
    assert person['quotaDisciplines'] == ['Snowboard Cross']
    assert len(person['affirmativeWscColumns']) == 2
    assert len(person['competitionMemberships']) == 1
    errors = wsc_membership_errors([person], 7)
    assert errors[0]['details']['unresolvedMemberships'] == [
        {'importCode': 'WSC_BXT_A_6193', 'reason': 'COMPETITION_UNRESOLVED'}]


@pytest.mark.parametrize('empty_group', [None, '', '  '])
def test_one_missing_event_group_blocks_even_if_another_group_resolves(empty_group):
    selected = mapping(); selected['WSC_BXT_A_6193'].quota_discipline = empty_group
    parsed = parse_entries_list(frame(), MAPS, selected, 'Montafon', 7)
    person = parsed['people'][1]
    assert 'Snowboard Cross' in person['quotaDisciplines']
    assert len(person['competitionMemberships']) == 2
    assert wsc_membership_errors([person], 7)[0]['details']['unresolvedMemberships'] == [
        {'importCode': 'WSC_BXT_A_6193', 'reason': 'EVENT_GROUP_MISSING'}]


def test_lost_extracted_code_is_not_hidden_by_other_resolved_memberships():
    person = parse_entries_list(frame(), MAPS, mapping(), 'Montafon', 7)['people'][1]
    person['competitionImportCodes'].remove('WSC_BXT_A_6193')
    assert wsc_membership_errors([person], 7)[0]['details']['unresolvedMemberships'] == [
        {'importCode': 'WSC_BXT_A_6193', 'reason': 'IMPORT_CODE_LOST'}]


def test_saved_preview_losing_exact_evidence_is_blocked():
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        parsed = parse_entries_list(frame(), MAPS)
        from test_support import prepare_import_championship
        preview = dict(eventId=prepare_import_championship().id, rooms=[], **parsed)
        recalculate_fis_import_preview(preview)
        assert len([e for e in preview['errors'] if e['code']=='ENTRY_WSC_MEMBERSHIP_UNRESOLVED']) == 4
        assert all(not p['quotaDisciplines'] for p in preview['people'])
        recalculate_fis_import_preview(preview)
        assert len([e for e in preview['errors'] if e['code']=='ENTRY_WSC_MEMBERSHIP_UNRESOLVED']) == 4


def test_preview_rejects_missing_event_mapping_with_source_diagnostics(monkeypatch):
    import excel_import as imports
    from models import Event
    monkeypatch.setattr(imports, 'PREVIEW_STORE', {})
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        event = Event(name='Empty exact mapping')
        db.session.add(event); db.session.commit()
        monkeypatch.setattr(imports, 'load_first_sheet', lambda p: frame() if p == 'entries'
                            else pd.DataFrame(columns=list(imports.ROOM_REQUIRED_COLUMNS)))
        with pytest.raises(imports.ImportValidationError) as caught:
            imports.create_fis_import_preview('entries', 'rooms', event)
        diagnostic = caught.value.to_dict()
        assert diagnostic['event_id'] == str(event.id)
        assert diagnostic['details']['membershipErrors'][0]['details']['affirmativeMembershipCount'] == 8
        assert diagnostic['details']['membershipErrors'][0]['details']['mappedMembershipCount'] == 0
        assert not imports.PREVIEW_STORE


def test_preview_valid_event_mapping_recognizes_usa_groups(monkeypatch):
    import excel_import as imports
    from models import Competition, Event, EventCompetition
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        event = Event(name='USA exact mapping'); db.session.add(event)
        for code in USA_COLUMNS:
            definition = COMPETITION_BY_IMPORT_CODE[code]
            comp = Competition(**definition._asdict(), active=True)
            db.session.add(EventCompetition(event=event, competition=comp, import_code=code,
                                           fis_codex=definition.code, official_name=definition.name))
        db.session.commit()
        monkeypatch.setattr(imports, 'load_first_sheet', lambda p: frame() if p == 'entries'
                            else pd.DataFrame(columns=list(imports.ROOM_REQUIRED_COLUMNS)))
        result = imports.create_fis_import_preview('entries', 'rooms', event)
        try:
            assert result['isValid']
            assert all(p['competitionIds'] and p['quotaDisciplines'] for p in result['people'])
            assert result['eventId'] == str(event.id)
            # Mapping identities remain valid, but catalogue grouping is lost
            # after preview. Confirmation must revalidate the derived groups.
            for comp in Competition.query.all():
                comp.quota_discipline = ''
            db.session.commit()
            with pytest.raises(ValueError, match='blocking validation errors|blockierende Fehler'):
                imports.confirm_fis_import(result['previewToken'])
            assert imports.Athlete.query.count() == 0
            db.session.rollback()
        finally:
            PREVIEW_STORE.pop(result['previewToken'], None)
