"""NO_ROOM is person metadata and suppresses demand, never participation."""
from copy import deepcopy
from datetime import date
import json
from types import SimpleNamespace
import pandas as pd
import pytest
from test_real_workbook_import import database, preview
from test_accommodation_segments import state, add, snapshot
from models import db, Athlete, Hotel, RoomBooking, RoomBookingOccupant, AuditEvent, ImportSession, ImportSessionVersion
from accommodation_requirements import requirement_projection, resolve_requirement, source_requirement, set_requirement, RequirementConflict, legacy_candidates
from accommodation_coverage import person_accommodation_coverage
import excel_import as imports


def test_model_defaults_and_clean_coverage(database):
    p=Athlete(firstname='One',lastname='Person',nation_code='AUS',room_type='No room');db.session.add(p);db.session.commit()
    assert requirement_projection(p)=={'accommodationRequirement':'REQUIRED','accommodationRequirementSource':'DEFAULT'}
    assert 'accommodation_requirement' not in RoomBooking.__table__.columns
    coverage=person_accommodation_coverage(None,None,[],'NO_ROOM')
    assert coverage['coverageStatus']=='NO_ROOM'
    assert all(coverage[k]==[] for k in ['segments','coveredIntervals','openIntervals','conflicts'])


@pytest.mark.parametrize('label,expected',[('No room','NO_ROOM'),(' no ROOM ','NO_ROOM'),('Single','REQUIRED'),('Double','REQUIRED'),('Double shared','REQUIRED'),('Double single','REQUIRED'),('Appartment','REQUIRED'),('no data available',None),('',None),('unknown',None),(None,None)])
def test_source_mapping_is_explicit(label,expected):
    assert source_requirement([label])==(expected,False)


def test_real_no_room_import_keeps_people_quota_and_removes_queue_demand(database,monkeypatch):
    import app as routes
    _,event=database
    result=preview('AUS',event,monkeypatch)
    assert not result['errors'],result['errors']
    assert len(result['people'])==58
    assert sum(p['accommodationRequirement']=='NO_ROOM' for p in result['people'])==24
    assert sum(p['function']=='Athlete' for p in result['people'])==19
    imports.confirm_fis_import(result['previewToken'])
    assert Athlete.query.count()==58
    units,_=routes._build_room_booking_units()
    assert len({p['athleteId'] for u in units for p in u['occupants']})==34
    rows=routes._build_official_quota_usage_rows('AUS')
    assert {(r['discipline'],r['gender'],r['athletesEntered']) for r in rows} >= {('Snowboard Alpine','M',1),('Snowboard Cross','M',4)}
    for row in rows:
        assert row['peopleTotal']==sum(g['count'] for g in row['functionGroups'])
        assert row['accommodationPeopleRequired']+row['noRoomPeople']==row['peopleTotal']
        assert row['noRoomPeople']>0


def test_reimport_transitions_and_manual_precedence(database,monkeypatch):
    _,event=database
    fixture=json.load(open('tests/fixtures/real_entries/AUS.json'))
    monkeypatch.setattr(imports,'load_first_sheet',lambda path:pd.DataFrame(fixture[path]))
    result=imports.create_fis_import_preview('entries','rooms',event);imports.confirm_fis_import(result['previewToken'])
    row=next(r for r in fixture['entries'] if r['Room_type']=='No room')
    p=Athlete.query.filter_by(competitor_id=str(row['Competitorid/Staff ID'])).one()
    assert p.accommodation_requirement=='NO_ROOM'
    row['Room_type']='Double shared'
    result=imports.create_fis_import_preview('entries','rooms',event);imports.confirm_fis_import(result['previewToken'])
    assert p.accommodation_requirement=='REQUIRED'
    set_requirement(p,'NO_ROOM','MANUAL');db.session.commit()
    result=imports.create_fis_import_preview('entries','rooms',event);imports.confirm_fis_import(result['previewToken'])
    assert (p.accommodation_requirement,p.accommodation_requirement_source)==('NO_ROOM','MANUAL')
    set_requirement(p,'REQUIRED','MANUAL');db.session.commit();row['Room_type']='No room'
    result=imports.create_fis_import_preview('entries','rooms',event);imports.confirm_fis_import(result['previewToken'])
    assert (p.accommodation_requirement,p.accommodation_requirement_source)==('REQUIRED','MANUAL')
    set_requirement(p,'REQUIRED','IMPORT');db.session.commit()
    result=imports.create_fis_import_preview('entries','rooms',event);imports.confirm_fis_import(result['previewToken'])
    assert p.accommodation_requirement=='NO_ROOM'


def test_missing_data_preserves_explicit_requirement_and_manual_release(database):
    p=Athlete(firstname='One',lastname='Person',nation_code='AUS',accommodation_requirement='NO_ROOM',accommodation_requirement_source='IMPORT');db.session.add(p);db.session.commit()
    value,proposed,review=resolve_requirement(p,['no data available'])
    assert value['accommodationRequirement']=='NO_ROOM' and proposed is None and review
    set_requirement(p,'REQUIRED','MANUAL');db.session.commit()
    value,_,_=resolve_requirement(p,['No room'],{'base':requirement_projection(p),'requirement':None})
    assert value=={'accommodationRequirement':'NO_ROOM','accommodationRequirementSource':'IMPORT'}


@pytest.mark.parametrize('external',[False,True])
def test_booking_conflict_blocks_switch_without_modifying_any_booking(state,external):
    client,people,_,_=state;add(state,14,27)
    if external:
        booking=RoomBooking.query.one();booking.hotel.accommodation_type='EXTERNAL';db.session.commit()
    before=snapshot()
    with pytest.raises(RequirementConflict,match='Bitte diese zuerst ausdrücklich entfernen'):
        set_requirement(people[0],'NO_ROOM','MANUAL')
    assert snapshot()==before and people[0].accommodation_requirement=='REQUIRED'
    people[0].accommodation_requirement='NO_ROOM';db.session.commit()
    from routes.accommodation_segments import coverage_for
    coverage=coverage_for(people[0]);assert coverage['coverageStatus']=='CONFLICT'
    assert coverage['segments'] and coverage['openIntervals']==[]
    assert any(c['code']=='NO_ROOM_HAS_BOOKINGS' for c in coverage['conflicts'])


def test_all_assignment_boundaries_reject_no_room_and_pair_rolls_back(state):
    import app as routes
    client,people,hotel,rt=state
    people[1].accommodation_requirement='NO_ROOM';db.session.commit()
    payload={'athleteIds':[str(p.id) for p in people[:2]],'hotelId':str(hotel.id),'roomTypeId':str(rt.id),'checkInDate':'2027-03-14','checkOutDate':'2027-03-27'}
    blocked=client.post('/api/assignments/segments',json=payload)
    assert blocked.status_code==400 and RoomBooking.query.count()==0
    blocked=client.post(f'/api/assignments/persons/{people[1].id}/segments',json=payload)
    assert blocked.status_code==400 and blocked.json['reasonCode']=='NO_ROOM_ASSIGNMENT_FORBIDDEN'
    _,_,error=routes._validate_booking_payload(payload)
    assert error and error[1]==400
    ext=Hotel(name='External',accommodation_type='EXTERNAL');db.session.add(ext);db.session.commit()
    from external_accommodation import external_plan
    from accommodation_split import SplitError
    with pytest.raises(SplitError,match='Unterkunftsbedarf'):
        external_plan({**payload,'hotelId':str(ext.id),'openInterval':{'checkInDate':payload['checkInDate'],'checkOutDate':payload['checkOutDate']}})
    result=add(state,14,27)
    assert result['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'
    assert len(RoomBooking.query.one().occupants)==1


def test_pair_projection_omits_no_room_but_preserves_other_person(state):
    import app as routes
    _,people,_,_=state
    people[0].shared_with_name=f'{people[1].firstname} {people[1].lastname}'
    people[1].accommodation_requirement='NO_ROOM';db.session.commit()
    units,_=routes._build_room_booking_units()
    assert all(str(people[1].id) not in [p['athleteId'] for p in u['occupants']] for u in units)
    assert any([p['athleteId'] for p in u['occupants']]==[str(people[0].id)] for u in units)


def test_manual_api_audit_and_lock(state,monkeypatch):
    import app as routes
    from flask import g
    app=state[0].application;p=state[1][0]
    app.config.update(AUTH_DEV_USER='tester',AUTH_DEV_GROUPS='incoming-admin',AUTH_PROXY_SECRET='')
    app.before_request(routes.authenticate_api_request);app.after_request(routes.audit_successful_mutation)
    app.register_error_handler(RequirementConflict,routes.requirement_conflict_response)
    app.add_url_rule('/api/athletes/<int:athlete_id>',endpoint='update_athlete',view_func=routes.update_athlete,methods=['PATCH'])
    locks=[];monkeypatch.setattr(routes,'lock_accommodation_writes',lambda:locks.append(True))
    p.single_room_status='APPROVED_EXTRA';p.accommodation_rate_category='SPECIAL';p.accommodation_rate_source='MANUAL';db.session.commit()
    result=state[0].patch(f'/api/athletes/{p.id}',json={'accommodationRequirement':'NO_ROOM'})
    assert result.status_code==200,result.json
    assert locks and result.json['single_room_status']=='APPROVED_EXTRA' and result.json['accommodationRateCategory']=='SPECIAL'
    audit=AuditEvent.query.order_by(AuditEvent.id.desc()).first()
    assert json.loads(audit.changes_json)['accommodation_requirement']=={'old':'REQUIRED','new':'NO_ROOM'}
    assert json.loads(audit.changes_json)['accommodation_requirement_source']=={'old':'DEFAULT','new':'MANUAL'}
    released=state[0].patch(f'/api/athletes/{p.id}',json={'accommodationRequirement':None})
    assert released.status_code==200 and released.json['accommodationRequirement']=='REQUIRED'


def test_import_booking_conflict_and_stale_override(database,monkeypatch):
    from accommodation_requirements import apply_preview_requirements
    from models import RoomType
    _,event=database
    result=preview('AUS',event,monkeypatch);imports.confirm_fis_import(result['previewToken'])
    p=Athlete.query.filter_by(accommodation_requirement='NO_ROOM').first()
    set_requirement(p,'REQUIRED','MANUAL');db.session.commit()
    person={'matchKey':p.competitor_id,'competitorId':p.competitor_id,'firstname':p.firstname,'lastname':p.lastname,'nationCode':p.nation_code,'roomType':'No room'}
    base=requirement_projection(p)
    set_requirement(p,'NO_ROOM','MANUAL');db.session.commit()
    with pytest.raises(imports.ImportValidationError,match='zwischenzeitlich'):
        apply_preview_requirements([person],[],{p.competitor_id:{'base':base,'requirement':'REQUIRED'}})
    set_requirement(p,'REQUIRED','IMPORT');h=Hotel(name='Hotel');rt=RoomType(name='Double',max_persons=2);db.session.add_all([h,rt]);db.session.flush()
    b=RoomBooking(hotel=h,room_type=rt,check_in_date=p.arrival_date,check_out_date=p.departure_date,room_number='Zimmer 01',counts_as_single=True);db.session.add(b);db.session.flush();db.session.add(RoomBookingOccupant(athlete=p,room_booking=b));db.session.commit()
    again=preview('AUS',event,monkeypatch)
    assert any(e['code']=='ACCOMMODATION_REQUIREMENT_BOOKINGS' for e in again['errors'])
    with pytest.raises(ValueError,match='blocking'):
        imports.confirm_fis_import(again['previewToken'])
    assert p.accommodation_requirement=='REQUIRED' and RoomBooking.query.count()==1


def test_legacy_reconciliation_is_reviewable_and_explicit(state):
    from pathlib import Path
    import sys
    sys.path.insert(0,str(Path(__file__).parents[2]))
    from scripts.reconcile_accommodation_requirements import reconcile
    _,people,_,_=state
    people[0].room_type='No room';people[1].room_type='no data available';db.session.commit()
    candidates=reconcile();assert [p['personId'] for p in candidates]==[people[0].id]
    assert people[0].accommodation_requirement=='REQUIRED'
    reconcile([people[0].id]);assert requirement_projection(people[0])=={'accommodationRequirement':'NO_ROOM','accommodationRequirementSource':'IMPORT'}
    assert AuditEvent.query.count()==1


def test_no_room_preserves_historical_single_approval_and_special_on_reimport(database,monkeypatch):
    _,event=database
    result=preview('AUS',event,monkeypatch);imports.confirm_fis_import(result['previewToken'])
    person=Athlete.query.filter_by(accommodation_requirement='NO_ROOM').first()
    person.single_room_status='APPROVED_EXTRA';person.single_room_entitlement='APPROVED_EXTRA'
    person.accommodation_rate_category='SPECIAL';person.accommodation_rate_source='MANUAL';db.session.commit()
    again=preview('AUS',event,monkeypatch)
    row=next(p for p in again['people'] if p['existingAthleteId']==person.id)
    assert row['singleRoomAllocation'] is None and row['singleRoomEntitlement'] is None
    imports.confirm_fis_import(again['previewToken'])
    assert person.single_room_status=='APPROVED_EXTRA' and person.single_room_entitlement=='APPROVED_EXTRA'
    assert person.accommodation_rate_category=='SPECIAL'


def test_review_staging_confirmation_release_and_stale_protection(database,monkeypatch):
    import app as routes
    from models import ImportSessionEvent
    app,event=database
    monkeypatch.setattr(routes,'current_user',lambda:SimpleNamespace(username='reviewer'))
    app.add_url_rule('/requirements/<int:session_id>/<path:person_key>',view_func=routes.stage_accommodation_requirement,methods=['PATCH'])
    app.register_error_handler(RequirementConflict,routes.requirement_conflict_response)
    result=preview('AUS',event,monkeypatch)
    session=ImportSession(nation='AUS',status='DRAFT');db.session.add(session);db.session.flush()
    version=ImportSessionVersion(session_id=session.id,version=1,preview_json=json.dumps(result),preview_token=result['previewToken'],uploaded_by='test');db.session.add(version);db.session.flush();session.current_version=version;db.session.commit()
    target=next(p for p in result['people'] if p['accommodationRequirement']=='NO_ROOM');key=target['matchKey']
    client=app.test_client();path=f'/requirements/{session.id}/{key}'
    staged=client.patch(path,json={'accommodationRequirement':'REQUIRED'})
    assert staged.status_code==200,staged.json
    assert Athlete.query.count()==0
    row=next(p for p in staged.json['preview']['people'] if p['matchKey']==key)
    assert (row['accommodationRequirement'],row['accommodationRequirementSource'])==('REQUIRED','MANUAL')
    event=ImportSessionEvent.query.filter_by(event_type='ACCOMMODATION_REQUIREMENT_MANUAL').one()
    assert json.loads(event.description)['new']['accommodationRequirementSource']=='MANUAL'
    # Avoid unrelated existing quota approval gates in this focused confirmation test.
    version.preview_token='not-linked';db.session.commit()
    imports.confirm_fis_import(result['previewToken'])
    person=Athlete.query.filter_by(competitor_id=target['competitorId']).one()
    assert requirement_projection(person)=={'accommodationRequirement':'REQUIRED','accommodationRequirementSource':'MANUAL'}
    new=preview('AUS',db.session.get(__import__('models').Event,int(result['eventId'])),monkeypatch)
    raw=imports.PREVIEW_STORE[new['previewToken']]
    raw['accommodationRequirementOverrides']={key:{'base':requirement_projection(person),'requirement':None}}
    imports.recalculate_fis_import_preview(raw)
    assert next(p for p in raw['people'] if p['matchKey']==key)['accommodationRequirement']=='NO_ROOM'
    set_requirement(person,'NO_ROOM','MANUAL');db.session.commit()
    before=Athlete.query.count()
    with pytest.raises(imports.ImportValidationError,match='zwischenzeitlich'):
        imports.confirm_fis_import(new['previewToken'])
    db.session.rollback();assert Athlete.query.count()==before


def test_migration_preserves_all_existing_requests_as_required_default():
    import importlib.util
    from pathlib import Path
    from sqlalchemy import create_engine,text
    from sqlalchemy.exc import IntegrityError
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    spec=importlib.util.spec_from_file_location('requirement_migration',Path(__file__).parents[1]/'migrations/versions/20261016_02_accommodation_requirements.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    with create_engine('sqlite://').begin() as connection:
        connection.execute(text('CREATE TABLE athlete(id INTEGER PRIMARY KEY, room_type VARCHAR(50))'))
        connection.execute(text("INSERT INTO athlete VALUES (1,'No room'),(2,'no data available')"))
        with Operations.context(MigrationContext.configure(connection)):
            module.upgrade()
            assert connection.execute(text('SELECT accommodation_requirement,accommodation_requirement_source FROM athlete')).all()==[('REQUIRED','DEFAULT'),('REQUIRED','DEFAULT')]
            with pytest.raises(IntegrityError):connection.execute(text("UPDATE athlete SET accommodation_requirement='EXTERNAL'"))
            module.downgrade()
            assert connection.execute(text('SELECT room_type FROM athlete ORDER BY id')).scalars().all()==['No room','no data available']


def test_manual_release_uses_last_explicit_room_list_source_even_if_entries_were_blank(database):
    p=Athlete(firstname='One',lastname='Person',nation_code='AUS',accommodation_requirement='REQUIRED',accommodation_requirement_source='MANUAL',accommodation_requirement_import_value='NO_ROOM',room_type=None)
    db.session.add(p);db.session.commit()
    effective,_,_=resolve_requirement(p,[None],{'base':requirement_projection(p),'requirement':None})
    assert effective=={'accommodationRequirement':'NO_ROOM','accommodationRequirementSource':'IMPORT'}


def test_staged_no_room_single_request_produces_no_ez_or_room_demand(database,monkeypatch):
    _,event=database
    result=preview('AUS_FREESTYLE',event,monkeypatch)
    raw=imports.PREVIEW_STORE[result['previewToken']]
    target=next(p for p in raw['people'] if p['singleRoomAllocation'])
    raw['accommodationRequirementOverrides']={target['matchKey']:{'base':{'accommodationRequirement':'REQUIRED','accommodationRequirementSource':'DEFAULT'},'requirement':'NO_ROOM'}}
    imports.recalculate_fis_import_preview(raw)
    assert target['singleRoomAllocation'] is None and target['singleRoomEntitlement'] is None
    assert not any(target['matchKey']==c['personKey'] for w in raw['warnings'] for c in w.get('details',{}).get('singleRoomCandidates',[]))
    imports.confirm_fis_import(result['previewToken'])
    person=Athlete.query.filter_by(competitor_id=target['competitorId']).one()
    assert person.accommodation_requirement=='NO_ROOM' and person.single_room_status=='NONE'


def test_no_room_cannot_receive_new_active_single_room_approval(database):
    p=Athlete(firstname='One',lastname='Person',nation_code='AUS',fis_code='123',function='Athlete',accommodation_requirement='NO_ROOM',single_room_status='APPROVED_EXTRA')
    db.session.add(p);db.session.commit()
    with pytest.raises(imports.ImportValidationError,match='Keine aktive EZ'):
        imports.apply_active_single_room_decision({'singleRoomCandidates':[{'personKey':'123'}]},['123'],None)
    assert p.single_room_status=='APPROVED_EXTRA'  # old history is retained, no new decision applied


def test_zero_required_metrics_retain_roster_and_partial_stays_remain_open():
    from accommodation_requirements import accommodation_metrics
    people=[{'personId':1,'accommodationRequirement':'NO_ROOM'},{'personId':2,'accommodationRequirement':'NO_ROOM'}]
    metrics=accommodation_metrics(people,{})
    assert metrics=={'accommodationPeopleRequired':0,'accommodationPeopleFullyAssigned':0,'accommodationPeoplePartiallyAssigned':0,'accommodationPeopleOpen':0,'noRoomPeople':2}
    people.append({'personId':3,'accommodationRequirement':'REQUIRED'})
    metrics=accommodation_metrics(people,{'3':{'coverageStatus':'PARTIALLY_ASSIGNED'}})
    assert metrics['accommodationPeopleOpen']==1 and metrics['accommodationPeopleFullyAssigned']==0 and metrics['accommodationPeoplePartiallyAssigned']==1
