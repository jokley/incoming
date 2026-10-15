from datetime import date
from unittest.mock import patch
import pytest
from test_accommodation_segments import state, data, add, pair, snapshot
from test_real_workbook_import import database
from models import db, RoomBooking, RoomBookingOccupant, Athlete


def preview(state, booking, ids=None, cut=20):
    ids = ids if ids is not None else [state[1][0].id]
    return state[0].get(f'/api/assignments/bookings/{booking}/split-preview', query_string={
        'athleteIds': ','.join(str(i) for i in ids), 'splitDate': f'2027-03-{cut:02}'})


def confirm(state, plan):
    return state[0].post(f"/api/assignments/bookings/{plan['booking']['id']}/split",json={
        key: plan[key] for key in ('athleteIds', 'splitDate', 'previewToken')})


def test_solo_preview_no_writes_and_confirm(state):
    original=add(state,14,27);before=snapshot()
    plan=preview(state,original['booking']['id']).get_json()
    assert snapshot()==before
    assert plan['people'][0]['accommodationCoverage']['openIntervals']==[{'checkInDate':'2027-03-20','checkOutDate':'2027-03-27'}]
    result=confirm(state,plan)
    assert result.status_code==200,result.get_json()
    assert result.get_json()['people'][0]['accommodationCoverage']==plan['people'][0]['accommodationCoverage']
    assert RoomBooking.query.one().check_out_date==date(2027,3,20)


@pytest.mark.parametrize('selected',[[0,1],[0],[1]])
def test_shared_partition_preserves_room_coverage_and_metadata(state,selected):
    result=pair(state,14,27);booking=db.session.get(RoomBooking,int(result.get_json()['booking']['id']))
    booking.created_by='operator';booking.counts_as_single=False
    for o in booking.occupants:o.role='Team'
    db.session.commit()
    old_created=booking.created_at
    plan=preview(state,booking.id,[state[1][i].id for i in selected]).get_json()
    response=confirm(state,plan)
    assert response.status_code==200,response.get_json()
    for p in response.get_json()['people']:
        index=next(i for i,person in enumerate(state[1][:2]) if str(person.id)==p['personId'])
        assert p['accommodationCoverage']['coverageStatus']==('PARTIALLY_ASSIGNED' if index in selected else 'FULLY_ASSIGNED')
        assert p['accommodationCoverage']['openIntervals']==next(v['accommodationCoverage']['openIntervals'] for v in plan['people'] if v['personId']==p['personId'])
    assert RoomBooking.query.count()==(1 if len(selected)==2 else 2)
    for b in RoomBooking.query.all():
        assert b.room_number=='Zimmer 03' and b.room_type_id==state[3].id
        assert b.created_by=='operator' and b.created_at==old_created and not b.counts_as_single
        assert all(o.role=='Team' for o in b.occupants)
    assert Athlete.query.count()==3
    assert all(p.shared_with_name is None for p in state[1])


def test_rollback_after_partition_flush(state):
    result=pair(state,14,27).get_json();plan=preview(state,result['booking']['id']).get_json();before=snapshot()
    import accommodation_split
    original=accommodation_split.apply_split
    def fail(*args):
        original(*args)
        raise RuntimeError('after flush')
    with patch.object(accommodation_split,'apply_split',side_effect=fail):
        with pytest.raises(RuntimeError):confirm(state,plan)
    assert snapshot()==before


@pytest.mark.parametrize('change',['dates','occupant','new_booking','delete','stay','room_conflict'])
def test_stale_plan_rejected(state,change):
    result=add(state,14,22);identity=int(result['booking']['id']);plan=preview(state,identity).get_json()
    b=db.session.get(RoomBooking,identity)
    if change=='dates':b.check_out_date=date(2027,3,23)
    elif change=='occupant':db.session.add(RoomBookingOccupant(room_booking=b,athlete=state[1][1]))
    elif change=='new_booking':add(state,22,27,'Zimmer 02')
    elif change=='delete':db.session.delete(b)
    elif change=='stay':state[1][0].departure_date=date(2027,3,28)
    elif change=='room_conflict':
        db.session.add(RoomBooking(hotel_id=b.hotel_id,room_type_id=b.room_type_id,room_number=b.room_number,check_in_date=b.check_in_date,check_out_date=b.check_out_date))
    db.session.commit();before=snapshot()
    response=confirm(state,plan)
    assert response.status_code==409,response.get_json()
    assert snapshot()==before


@pytest.mark.parametrize('cut',[13,14,27,28])
def test_invalid_boundaries(state,cut):
    result=add(state,14,27);before=snapshot()
    response=preview(state,result['booking']['id'],cut=cut)
    assert response.status_code==400
    assert snapshot()==before


def test_repeated_split_unrelated_preserved_and_gap_merges(state):
    first=add(state,14,22);tail=add(state,24,27,'Zimmer 02');unchanged=snapshot()[1]
    plan=preview(state,first['booking']['id']).get_json()
    assert plan['people'][0]['accommodationCoverage']['openIntervals']==[{'checkInDate':'2027-03-20','checkOutDate':'2027-03-24'}]
    assert confirm(state,plan).status_code==200
    assert snapshot()[1]==unchanged
    for cut in [19,18,17,16,15]:
        plan=preview(state,first['booking']['id'],cut=cut).get_json()
        assert confirm(state,plan).status_code==200
    assert RoomBooking.query.count()==2


def test_capacity_partition_counts_one_physical_room_over_spanning_request(state):
    # Two inventory rooms; one is continuously in use through adjacent rows.
    from models import HotelRoomInventory
    HotelRoomInventory.query.one().room_count=2;db.session.commit()
    booking=pair(state,14,27).get_json()['booking']['id']
    plan=preview(state,booking).get_json();assert confirm(state,plan).status_code==200
    response=add(state,14,27,'Zimmer 02',person=2)
    assert response['accommodationCoverage']['coverageStatus']=='FULLY_ASSIGNED'
    from app import _validate_booking_payload
    payload,_,error=_validate_booking_payload(data(state,14,27,'Zimmer 04',athleteIds=[str(state[1][0].id)]))
    assert error is not None  # person overlap is still rejected
    from accommodation_mutations import physical_room_usage
    assert physical_room_usage(RoomBooking.query.filter_by(room_number='Zimmer 03').all())==1


def test_preview_token_bound_to_selection_and_date_and_conflict_blocked(state):
    identity=pair(state,14,27).get_json()['booking']['id'];plan=preview(state,identity).get_json()
    plan['splitDate']='2027-03-21'
    assert confirm(state,plan).status_code==409
    b=db.session.get(RoomBooking,int(identity))
    bad=RoomBooking(hotel_id=b.hotel_id,room_type_id=b.room_type_id,room_number='Zimmer 04',check_in_date=b.check_in_date,check_out_date=b.check_out_date)
    db.session.add(bad);db.session.flush();db.session.add(RoomBookingOccupant(room_booking=bad,athlete=state[1][0]));db.session.commit()
    assert preview(state,identity).status_code==400


def test_capacity_coalesces_adjacent_but_does_not_hide_overlapping_room_rows():
    from types import SimpleNamespace
    from accommodation_mutations import physical_room_usage
    def row(identity,start,end,room='Zimmer 01'):
        return SimpleNamespace(id=identity,check_in_date=date(2027,3,start),check_out_date=date(2027,3,end),room_number=room)
    assert physical_room_usage([row(1,4,14),row(2,14,21)])==1
    assert physical_room_usage([row(1,4,15),row(2,14,21)])==2
    assert physical_room_usage([row(1,4,14,None),row(2,14,21,None)])==2


def test_split_preserves_single_flag_approval_reference_and_unrelated_gap_not_previewed(state):
    first=add(state,14,22)
    b=db.session.get(RoomBooking,int(first['booking']['id']));b.counts_as_single=True
    from models import ImportSession, ImportApproval
    session=ImportSession(nation='AUT');db.session.add(session);db.session.flush()
    decision=ImportApproval(session_id=session.id,nation='AUT',approval_type='NATION_APPROVED',description='Frozen EZ approval',decision='APPROVED',username='approver',approved_person_keys_json='["unchanged"]',quota_details_json='{"immutable":true}')
    db.session.add(decision);db.session.flush()
    person=state[1][0];person.single_room_status='APPROVED_EXTRA';person.single_room_decision_id=decision.id
    db.session.commit()
    frozen={column.name:getattr(decision,column.name) for column in decision.__table__.columns}
    plan=preview(state,b.id).get_json()
    assert plan['people'][0]['affectedOpenIntervals']==[{'checkInDate':'2027-03-20','checkOutDate':'2027-03-27'}]
    assert confirm(state,plan).status_code==200
    assert b.counts_as_single is True and person.single_room_status=='APPROVED_EXTRA'
    assert person.single_room_decision_id==decision.id
    assert {column.name:getattr(decision,column.name) for column in decision.__table__.columns}==frozen


def test_commit_failure_after_split_rolls_back(state):
    identity=pair(state,14,27).get_json()['booking']['id'];plan=preview(state,identity).get_json();before=snapshot()
    with patch.object(db.session,'commit',side_effect=RuntimeError('commit failed')):
        with pytest.raises(RuntimeError):confirm(state,plan)
    assert snapshot()==before
