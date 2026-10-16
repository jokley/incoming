"""Tariffs remain person-owned metadata through API, import and disposition."""
from datetime import date
from copy import deepcopy
import json
import pytest
from test_real_workbook_import import database, preview
from models import Athlete, RoomBooking, ImportSession, ImportSessionVersion, db
from accommodation_rates import rate_projection, apply_preview_rates, function_groups, validate_category
from quota_service import evaluate_quota_usage
import excel_import as imports


def test_default_and_model_scope(database):
    p=Athlete(firstname='One',lastname='Guest',nation_code='AUS',function='NSA Guest')
    db.session.add(p);db.session.commit()
    assert rate_projection(p)=={'accommodationRateCategory':'STANDARD','accommodationRateSource':'DEFAULT'}
    assert p.to_dict()['accommodationRateCategory']=='STANDARD'
    assert 'accommodation_rate_category' not in RoomBooking.__table__.columns
    for bad in [None, '', 'GUEST', 'special', [], {}]:
        with pytest.raises(ValueError):validate_category(bad)


def test_manual_rate_person_api_and_assignment_projections(database,monkeypatch):
    import app as routes
    from routes.athletes import athletes
    app,_=database;app.register_blueprint(athletes)
    app.add_url_rule('/api/athletes/<int:athlete_id>',view_func=routes.update_athlete,methods=['PATCH'])
    p=Athlete(firstname='One',lastname='Guest',nation_code='AUS',function='NSA Guest',arrival_date=date(2027,3,4),departure_date=date(2027,3,21),single_room_status='APPROVED_EXTRA')
    db.session.add(p);db.session.commit()
    before=p.to_dict()['single_room_status']
    response=app.test_client().patch(f'/api/athletes/{p.id}',json={'accommodationRateCategory':'SPECIAL'})
    assert response.status_code==200,response.json
    assert response.json['accommodationRateSource']=='MANUAL'
    assert response.json['single_room_status']==before
    assert app.test_client().get('/api/athletes').json[0]['accommodationRateCategory']=='SPECIAL'
    units,_=routes._build_room_booking_units()
    assert next(o for u in units for o in u['occupants'] if o['athleteId']==str(p.id))['accommodationRateCategory']=='SPECIAL'
    assert app.test_client().patch(f'/api/athletes/{p.id}',json={'accommodationRateCategory':'GUEST'}).status_code==400


def test_snapshot_preserves_manual_and_no_guest_rule(database,monkeypatch):
    _,event=database
    first=preview('AUS_FREESTYLE',event,monkeypatch)
    assert all(p['accommodationRateCategory']=='STANDARD' for p in first['people'])
    imports.confirm_fis_import(first['previewToken'])
    guest=Athlete.query.filter_by(function='NSA Guest').first()
    guest.accommodation_rate_category='SPECIAL';guest.accommodation_rate_source='MANUAL';db.session.commit()
    again=preview('AUS_FREESTYLE',event,monkeypatch)
    target=next(p for p in again['people'] if p['existingAthleteId']==guest.id)
    assert target['accommodationRateCategory']=='SPECIAL'
    assert sum(p['accommodationRateCategory']=='SPECIAL' for p in again['people'])==1
    imports.confirm_fis_import(again['previewToken'])
    assert rate_projection(guest)=={'accommodationRateCategory':'SPECIAL','accommodationRateSource':'MANUAL'}


def test_staged_override_and_concurrent_manual_protection(database,monkeypatch):
    _,event=database
    result=preview('AUS_FREESTYLE',event,monkeypatch)
    raw=imports.PREVIEW_STORE[result['previewToken']]
    p=next(p for p in raw['people'] if p['function']=='NSA Guest')
    raw['accommodationRateOverrides']={p['matchKey']:{'category':'SPECIAL','base':rate_projection(None)}}
    imports.recalculate_fis_import_preview(raw)
    assert p['accommodationRateCategory']=='SPECIAL'
    imports.confirm_fis_import(result['previewToken'])
    live=Athlete.query.filter_by(competitor_id=p['competitorId']).one()
    assert live.accommodation_rate_source=='MANUAL'
    # A stale default snapshot must pick up the latest live decision.
    again=preview('AUS_FREESTYLE',event,monkeypatch)
    live.accommodation_rate_category='STANDARD';db.session.commit()
    imports.confirm_fis_import(again['previewToken'])
    assert live.accommodation_rate_category=='STANDARD'
    overrides={p['matchKey']:{'category':'SPECIAL','base':{'accommodationRateCategory':'SPECIAL','accommodationRateSource':'MANUAL'}}}
    with pytest.raises(imports.ImportValidationError,match='zwischenzeitlich'):
        apply_preview_rates([p],overrides)


def test_rate_changes_no_quota_or_coverage(state):
    from test_accommodation_segments import add
    from routes.accommodation_segments import coverage_for
    _,people,_,_=state
    person=people[0];add(state,14,27)
    before=coverage_for(person)
    person.single_room_status='APPROVED_EXTRA'
    roster=[{'personId':p.id,'nationCode':'AUT','function':p.function,'gender':'M','quotaDisciplines':['Test']} for p in people]
    quotas=evaluate_quota_usage(roster,roster)
    person.accommodation_rate_category='SPECIAL';person.accommodation_rate_source='MANUAL';db.session.commit()
    assert coverage_for(person)==before
    assert person.single_room_status=='APPROVED_EXTRA'
    assert evaluate_quota_usage([{**p,**rate_projection(person)} for p in roster],roster)==quotas


from test_accommodation_segments import state


def test_raw_function_groups_are_distinct_and_do_not_classify():
    p={'personId':1,'function':'NSA Guest','name':'One','accommodationRateCategory':'SPECIAL'}
    groups=function_groups([p,deepcopy(p),{**p,'personId':2,'accommodationRateCategory':'STANDARD'}],{1})
    assert len(groups)==1 and groups[0]['function']=='NSA Guest' and groups[0]['count']==2
    assert sum(p['accommodationRateCategory']=='SPECIAL' for g in groups for p in g['people'])==1
    assert [p['isAssigned'] for p in groups[0]['people']]==[True,False]


def test_staging_api_updates_review_not_live_and_audits(database,monkeypatch):
    from types import SimpleNamespace
    import app as routes
    from models import ImportSessionEvent
    app,event=database
    monkeypatch.setattr(routes,'current_user',lambda:SimpleNamespace(username='reviewer'))
    app.add_url_rule('/api/import/sessions/<int:session_id>/accommodation-rates/<path:person_key>',view_func=routes.stage_accommodation_rate,methods=['PATCH'])
    result=preview('AUS_FREESTYLE',event,monkeypatch)
    session=ImportSession(nation='AUS',status='DRAFT');db.session.add(session);db.session.flush()
    version=ImportSessionVersion(session_id=session.id,version=1,preview_json=json.dumps(result),preview_token=result['previewToken'],uploaded_by='test')
    db.session.add(version);db.session.flush();session.current_version=version;db.session.commit()
    target=next(p for p in result['people'] if p['function']=='NSA Guest')
    path=f"/api/import/sessions/{session.id}/accommodation-rates/{target['matchKey']}"
    response=app.test_client().patch(path,json={'accommodationRateCategory':'SPECIAL'})
    assert response.status_code==200,response.json
    person=next(p for p in response.json['preview']['people'] if p['matchKey']==target['matchKey'])
    assert person['accommodationRateCategory']=='SPECIAL' and person['accommodationRateSource']=='MANUAL'
    assert Athlete.query.count()==0
    assert response.json['preview']['quotaChecks']==result['quotaChecks']
    assert 'STANDARD → SPECIAL' in ImportSessionEvent.query.filter_by(event_type='ACCOMMODATION_RATE_MANUAL').one().description
    imports.confirm_fis_import(result['previewToken'])
    session.status='IMPORTED';db.session.commit()
    assert not routes._current_session_payload(session,True)['preview']['errors']
    assert app.test_client().patch(path,json={'accommodationRateCategory':'STANDARD'}).status_code==409


def test_live_function_groups_and_quota_counts_unchanged(database,monkeypatch):
    import app as routes
    _,event=database
    result=preview('AUS_FREESTYLE',event,monkeypatch);imports.confirm_fis_import(result['previewToken'])
    before=routes._build_official_quota_usage_rows(nation_code='AUS')
    guest=Athlete.query.filter_by(function='NSA Guest').first()
    guest.accommodation_rate_category='SPECIAL';guest.accommodation_rate_source='MANUAL';db.session.commit()
    after=routes._build_official_quota_usage_rows(nation_code='AUS')
    clean=lambda rows:[{k:v for k,v in r.items() if k not in {'functionGroups','specialRateCount'}} for r in rows]
    assert clean(before)==clean(after)
    for row in after:
        assert row['specialRateCount']==1
        assert next(g for g in row['functionGroups'] if g['function']=='NSA Guest')['count']==10
        assert sum(g['count'] for g in row['functionGroups'])==row['peopleTotal']
    freestyle=next(r for r in after if r['discipline']=='Freestyle' and r['gender']=='M')
    assert {g['function']:g['count'] for g in freestyle['functionGroups']}=={'Athlete':5,'NSA Coach':8,'NSA Medical':6,'NSA Professional':6,'NSA Guest':10,'NSA Media':2,'NSA President':1}


def test_migration_defaults_existing_people_and_checks():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine,text
    from sqlalchemy.exc import IntegrityError
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    spec=importlib.util.spec_from_file_location('rate_migration',Path(__file__).parents[1]/'migrations/versions/20261016_01_accommodation_rates.py')
    migration=importlib.util.module_from_spec(spec);spec.loader.exec_module(migration)
    engine=create_engine('sqlite://')
    with engine.begin() as connection:
        connection.execute(text('CREATE TABLE athlete (id INTEGER PRIMARY KEY)'))
        connection.execute(text('INSERT INTO athlete(id) VALUES (1)'))
        with Operations.context(MigrationContext.configure(connection)):
            migration.upgrade()
            assert tuple(connection.execute(text('SELECT accommodation_rate_category,accommodation_rate_source FROM athlete')).one())==('STANDARD','DEFAULT')
            with pytest.raises(IntegrityError):
                connection.execute(text("UPDATE athlete SET accommodation_rate_category='GUEST'"))
            migration.downgrade()
            assert connection.execute(text('SELECT id FROM athlete')).scalar()==1


def test_person_rate_audit_and_permissions(database):
    import app as routes
    from models import AuditEvent
    app,_=database
    app.config.update(AUTH_DEV_USER='test-admin',AUTH_DEV_GROUPS='incoming-admin',AUTH_PROXY_SECRET='')
    app.before_request(routes.authenticate_api_request);app.after_request(routes.audit_successful_mutation)
    app.add_url_rule('/api/athletes/<int:athlete_id>',endpoint='update_athlete',view_func=routes.update_athlete,methods=['PATCH'])
    p=Athlete(firstname='One',lastname='Guest',nation_code='AUS',function='NSA Guest')
    db.session.add(p);db.session.commit()
    client=app.test_client();path=f'/api/athletes/{p.id}'
    denied=client.patch(path,json={'accommodationRateCategory':'SPECIAL'},headers={'X-Authenticated-User':'viewer','X-Authenticated-Groups':'incoming-viewer'})
    assert denied.status_code==403 and p.accommodation_rate_category=='STANDARD'
    saved=client.patch(path,json={'accommodationRateCategory':'SPECIAL'})
    assert saved.status_code==200,saved.json
    audit=AuditEvent.query.order_by(AuditEvent.id.desc()).first()
    assert json.loads(audit.changes_json)['accommodation_rate_category']=={'old':'STANDARD','new':'SPECIAL'}
    invalid=client.patch(path,json={'accommodationRateCategory':'STANDARD','additionalItems':'not allowed'})
    assert invalid.status_code==400
    db.session.expire_all()
    assert p.accommodation_rate_category=='SPECIAL'
