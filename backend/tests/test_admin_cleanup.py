"""Disposable PostgreSQL: scoped admin deletion, immutable evidence and rollback."""
import json
from datetime import date
from unittest.mock import patch
import pytest
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_safe_reimport import upload,run,booking
from test_athlete_quota_tariffs import CODES,genders,decide,get_task,detail
from models import db,Athlete,ImportApproval,ImportSession,ImportRun,ImportSessionEvent,Hotel,RoomType,HotelRoomInventory,RoomBooking,RoomBookingOccupant,EventAccess,AuditEvent
from app import app

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


def reset(scope,nation=None,**extra):
    return app.test_client().post('/api/admin/test-data/reset',json={'scope':scope,'nation':nation,'confirmed':True,**extra})


def paid(event):
    payload=upload(event,codes=CODES,changed=genders)
    result=decide(payload,get_task(payload),CODES[:4]);assert result.status_code==200,result.json
    return payload


def test_activity_cleanup_keeps_revision_tariff_and_ez_evidence(events):
    a,_=events;bind(a);p=paid(a)
    old=ImportApproval.query.filter_by(decision='APPROVED').one();saved=old.quota_details_json
    revised=decide(p,old.to_dict(),CODES[4:8],{'total':4,'M':3,'F':0});assert revised.status_code==200,revised.json
    assert detail(p)['athleteQuotaChecks'][0]['approvedExtent']['total']==4
    before={i.id:i.quota_details_json for i in ImportApproval.query.all()}
    history={i.id:i.event_type for i in ImportSessionEvent.query.all()}
    result=reset('activities');assert result.status_code==200,result.json
    assert {i.id:i.quota_details_json for i in ImportApproval.query.all()}==before
    assert {i.id:i.event_type for i in ImportSessionEvent.query.all()}==history
    audited=app.test_client().get('/api/audit-events').json['items']
    assert any(row['entityType']=='admin-cleanup' and isinstance(row['details'],list) for row in audited)
    after=detail(p)
    assert after['athleteQuotaChecks'][0]['approvedExtent']['total']==4
    assert sum(p['accommodationRateCategory']=='SPECIAL' for p in after['people'])==4
    assert db.session.get(ImportApproval,old.id).quota_details_json==saved


def test_nation_cleanup_removes_tariff_refs_and_allows_same_file_fresh_import(events):
    a,_=events;bind(a);p=paid(a);run(p,a)
    assert Athlete.query.filter_by(accommodation_rate_source='APPROVAL').count()==4
    other=Athlete(event_id=a.id,nation_code='AUS',firstname='Other',lastname='Kept',accommodation_rate_category='SPECIAL',accommodation_rate_source='MANUAL')
    db.session.add(other);db.session.commit();other_id=other.id;before=other.to_dict()
    blocked=reset('imports');assert blocked.status_code==409 and blocked.json['error']=='IMPORT_DATA_IN_USE'
    result=reset('nation','JPN');assert result.status_code==200,result.json
    assert Athlete.query.count()==1 and db.session.get(Athlete,other_id).to_dict()==before
    assert ImportSession.query.count()==0 and ImportApproval.query.count()==0
    assert reset('nation','JPN').status_code==200
    old_token=app.test_client().post('/api/import/fis/confirm',json={'previewToken':p['previewToken']})
    assert old_token.status_code in {400,409}
    fresh=upload(a,codes=CODES,changed=genders)
    assert fresh['summary']['people']['wouldCreate']==40
    assert fresh['athleteQuotaChecks'][0]['decisionStatus']=='PENDING'


def test_shared_room_other_nation_and_legacy_partner_survive(events):
    from models import RoomAssignment,FisRoomAssignment
    a,_=events;bind(a)
    p=Athlete(event_id=a.id,nation_code='JPN',firstname='Delete',lastname='Person')
    q=Athlete(event_id=a.id,nation_code='AUS',firstname='Retain',lastname='Person',shared_with_name='Person, Delete')
    db.session.add_all([p,q]);db.session.commit();b=booking([p,q],False)
    db.session.add_all([RoomAssignment(athlete_id=p.id,shared_with_athlete_id=q.id,hotel_id=b.hotel_id,room_type_id=b.room_type_id,check_in_date=b.check_in_date,check_out_date=b.check_out_date),FisRoomAssignment(source_row_key='test-source',room_type='Double shared',person1_id=p.id,person2_id=q.id,hotel_id=b.hotel_id)])
    db.session.commit();bid=b.id;qid=q.id
    response=reset('nation','JPN');assert response.status_code==200,response.json
    retained=db.session.get(RoomBooking,bid);assert retained and retained.counts_as_single is False
    assert [o.athlete_id for o in retained.occupants]==[qid]
    assert RoomAssignment.query.one().athlete_id==qid and RoomAssignment.query.one().shared_with_athlete_id is None
    assert FisRoomAssignment.query.one().person1_id==qid and FisRoomAssignment.query.one().person2_id is None
    assert db.session.get(Athlete,qid).shared_with_name is None


def test_event_cleanup_requires_backup_preserves_stock_other_event_and_unknown_runs(events):
    a,b=events;bind(a);p=upload(a);run(p,a)
    other=Athlete(event_id=b.id,firstname='Other',lastname='Event',nation_code='JPN',fis_code='9300953')
    hotel=Hotel(name='Retained');room=RoomType(name='DZ',max_persons=2)
    db.session.add_all([other,hotel,room]);db.session.flush()
    stock=HotelRoomInventory(event_id=a.id,hotel_id=hotel.id,room_type_id=room.id,available_from=date(2027,3,1),available_until=date(2027,3,31),room_count=109)
    db.session.add(stock);db.session.commit();oid=other.id
    import sqlalchemy as sa
    db.session.execute(sa.insert(ImportRun.__table__).values(event_id=None,import_type='unknown'));db.session.commit()
    foreign=RoomBooking(event_id=b.id,hotel_id=hotel.id,room_type_id=room.id,room_number='Foreign 04',check_in_date=date(2027,3,3),check_out_date=date(2027,3,9),counts_as_single=True)
    db.session.add(foreign);db.session.flush();db.session.add(RoomBookingOccupant(room_booking_id=foreign.id,athlete_id=other.id));db.session.commit();foreign_id=foreign.id
    before=stock.to_dict()
    with patch('admin_cleanup.safety_backup',side_effect=RuntimeError('backup unavailable')):
        failed=reset('all');assert failed.status_code==409
    assert Athlete.query.filter_by(event_id=a.id).count()==2
    with patch('admin_cleanup.safety_backup',return_value={'filename':'safety.dump.gz','category':'manual','size':123}) as backup:
        result=reset('all');assert result.status_code==200,result.json;backup.assert_called_once()
        assert reset('all').status_code==200;backup.assert_called_once()
    assert db.session.get(Athlete,oid) is not None
    assert db.session.get(RoomBooking,foreign_id).counts_as_single is True
    assert RoomBookingOccupant.query.filter_by(room_booking_id=foreign_id,athlete_id=oid).count()==1
    assert Hotel.query.count()==1 and HotelRoomInventory.query.one().to_dict()==before
    assert ImportRun.query.filter(ImportRun.event_id.is_(None)).count()==1
    assert len(a.competition_mappings)>0 and a.quota_rules_fixed_at is not None
    fresh=upload(a);run(fresh,a)
    assert Athlete.query.filter_by(event_id=a.id).count()==2 and db.session.get(Athlete,oid).fis_code=='9300953'


def test_failed_delete_rolls_back_all_changes(events):
    a,_=events;bind(a);p=paid(a);run(p,a)
    before=(Athlete.query.count(),ImportSession.query.count(),ImportApproval.query.count())
    with patch.object(db.session,'commit',side_effect=RuntimeError('injected commit failure')):
        result=reset('nation','JPN');assert result.status_code==409
    assert (Athlete.query.count(),ImportSession.query.count(),ImportApproval.query.count())==before
    assert Athlete.query.filter_by(accommodation_rate_source='APPROVAL').count()==4


def test_admin_requires_event_write_and_editor_cannot_reset(events,monkeypatch):
    a,b=events;bind(a);p=upload(a);run(p,a)
    monkeypatch.setitem(app.config,'AUTH_DEV_USER','no-grant-admin')
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS','incoming-admin')
    assert reset('nation','JPN').status_code==403
    db.session.add(EventAccess(username='no-grant-admin',event_id=a.id,can_write=False));db.session.commit()
    assert reset('nation','JPN').status_code==403
    grant=EventAccess.query.filter_by(username='no-grant-admin').one();grant.can_write=True;db.session.commit()
    assert reset('nation','JPN').status_code==200
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS','incoming-editor')
    assert reset('nation','JPN').status_code==403


def test_only_unused_import_data_can_be_deleted_without_people(events):
    a,_=events;bind(a);p=upload(a)
    assert reset('imports').status_code==200
    assert ImportSession.query.count()==0 and Athlete.query.count()==0
    assert reset('imports').status_code==200


def test_foreign_price_reference_blocks_cleanup_without_rewriting_any_tariff(events):
    a,_=events;bind(a);p=paid(a);run(p,a)
    approval=ImportApproval.query.filter_by(decision='APPROVED').one()
    other=Athlete(event_id=a.id,nation_code='AUS',firstname='Shared',lastname='Evidence',accommodation_rate_category='SPECIAL',accommodation_rate_source='APPROVAL',accommodation_rate_approval_id=approval.id)
    db.session.add(other);db.session.commit();before=other.to_dict()
    result=reset('nation','JPN')
    assert result.status_code==409 and result.json['error']=='CLEANUP_REFERENCE_CONFLICT'
    assert Athlete.query.count()==41 and other.to_dict()==before


def test_backup_receipt_must_be_completed_not_accepted(events):
    from admin_cleanup import safety_backup
    from imports.event_context import ImportValidationError
    from unittest.mock import MagicMock
    a,_=events;bind(a)
    response=MagicMock(status=202);response.read.return_value=b'{"status":"accepted"}'
    with patch('admin_cleanup.urllib.request.urlopen') as upstream:
        upstream.return_value.__enter__.return_value=response
        with pytest.raises(ImportValidationError,match='Sicherheitsbackup'):safety_backup()
        sent=json.loads(upstream.call_args.args[0].data)
        assert set(sent)=={'databaseTarget'} and 'password' not in sent['databaseTarget']


def test_assignment_only_cleanup_preserves_import_requests_prices_and_approvals(events):
    from models import FisRoomAssignment
    a,_=events;bind(a);p=paid(a);run(p,a)
    person=Athlete.query.filter_by(accommodation_rate_source='APPROVAL').first();before=person.to_dict()
    placed=booking([person],False)
    imported=FisRoomAssignment(source_row_key='preserved-import-request',room_type='Double shared',person1_id=person.id,hotel_id=placed.hotel_id,room_number='04',check_in_date=placed.check_in_date,check_out_date=placed.check_out_date)
    db.session.add(imported);db.session.commit();decision=ImportApproval.query.one().quota_details_json
    result=reset('assignments');assert result.status_code==200,result.json
    assert RoomBooking.query.count()==0
    request=FisRoomAssignment.query.one()
    assert request.source_row_key=='preserved-import-request' and request.hotel_id is None
    assert request.room_type=='Double shared' and request.check_in_date==date(2027,3,3)
    assert person.accommodation_rate_category=='SPECIAL' and person.accommodation_rate_source=='APPROVAL'
    assert person.single_room_status==before['single_room_status']
    assert ImportApproval.query.one().quota_details_json==decision


def test_safety_backup_fence_allows_reads_but_blocks_concurrent_writes(events):
    import sqlalchemy as sa
    a,_=events;bind(a);p=upload(a);run(p,a)
    def completed_backup():
        with db.engine.connect() as concurrent:
            assert concurrent.exec_driver_sql('SELECT count(*) FROM athlete').scalar()==2
            concurrent.exec_driver_sql("SET LOCAL lock_timeout='100ms'")
            with pytest.raises(sa.exc.OperationalError):
                concurrent.exec_driver_sql("UPDATE athlete SET internal_note='must not race cleanup'")
        return {'filename':'verified.dump.gz','category':'manual','size':123}
    with patch('admin_cleanup.safety_backup',side_effect=completed_backup):
        result=reset('all')
        assert result.status_code==200,result.json
    assert Athlete.query.count()==0
