"""Structural regression budgets, never timing assertions or shared caches."""
import json
from contextlib import contextmanager
from sqlalchemy import event
from models import db, Athlete, ImportSession, ImportSessionVersion
from test_real_workbook_import import database, preview
import excel_import as imports


@contextmanager
def sql_count():
    statements = []
    def record(conn, cursor, statement, parameters, context, executemany):
        statements.append(statement)
    event.listen(db.engine, 'before_cursor_execute', record)
    try:
        yield statements
    finally:
        event.remove(db.engine, 'before_cursor_execute', record)


def test_reimport_has_bounded_queries_and_flushes(database, monkeypatch):
    _, championship = database
    first = preview('AUS', championship, monkeypatch)
    imports.confirm_fis_import(first['previewToken'])
    with sql_count() as queries:
        current = preview('AUS', championship, monkeypatch)
    # The original code used >500 queries for the same 58 people.
    assert len(queries) < 80
    flushes = []
    def flushed(session, context, instances):
        flushes.append(1)
    event.listen(db.session, 'before_flush', flushed)
    try:
        with sql_count() as queries:
            imports.confirm_fis_import(current['previewToken'])
    finally:
        event.remove(db.session, 'before_flush', flushed)
    assert len(queries) < 160
    assert len(flushes) <= 6
    assert Athlete.query.count() == 58


def test_recalculation_retains_live_competition_and_person_state(database, monkeypatch):
    _, championship = database
    first = preview('AUS', championship, monkeypatch)
    imports.confirm_fis_import(first['previewToken'])
    saved = json.loads(json.dumps(preview('AUS', championship, monkeypatch)))
    with sql_count() as queries:
        imports.recalculate_fis_import_preview(saved)
    assert len(queries) < 80
    person = Athlete.query.filter_by(accommodation_requirement='REQUIRED').first()
    person.accommodation_rate_category = 'SPECIAL'
    person.accommodation_rate_source = 'MANUAL'
    db.session.commit()
    imports.recalculate_fis_import_preview(saved)
    found = next(p for p in saved['people'] if p.get('competitorId') == person.competitor_id)
    assert found['accommodationRateCategory'] == 'SPECIAL'
    assert found['accommodationRateSource'] == 'MANUAL'
    competition = person.competitions[0]
    competition.quota_discipline = ''
    db.session.commit()
    imports.recalculate_fis_import_preview(saved)
    assert saved['errors']  # No request-external cache can hide changed catalogue data.


def test_session_list_shares_only_read_data_and_preserves_each_preview(database, monkeypatch):
    import app as routes
    flask, championship = database
    result = preview('AUS', championship, monkeypatch)
    imports.confirm_fis_import(result['previewToken'])
    result = preview('AUS', championship, monkeypatch)
    for nation in ('AUS', 'GER', 'USA'):
        session = ImportSession(nation=nation, status='DRAFT')
        db.session.add(session); db.session.flush()
        version = ImportSessionVersion(session_id=session.id, version=1,
            preview_json=json.dumps(result), preview_token=result['previewToken'], uploaded_by='test')
        db.session.add(version); db.session.flush(); session.current_version = version
    db.session.commit(); db.session.remove()
    with flask.test_request_context():
        with sql_count() as queries:
            rows = routes.list_import_sessions().get_json()
    assert len(rows) == 3
    assert len(queries) < 125
    assert all(row['errors'] == 0 and row['status'] == 'DRAFT' for row in rows)
