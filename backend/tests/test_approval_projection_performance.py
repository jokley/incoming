"""Read projection budgets and exact equivalence to uncached canonical checks."""
import json
from datetime import date
from time import perf_counter
from contextlib import contextmanager
import pytest
from sqlalchemy import event as sql_event
from app import app
from models import (db, Event, Athlete, Competition, ImportApproval, RoomBooking,
                    RoomBookingOccupant, Hotel, RoomType)
from test_import_event_identity import events, session
from quota_history import applicable_approval_groups
from approval_projection import ApprovalReadProjection

pytestmark = pytest.mark.explicit_event_ownership


@pytest.fixture
def population(events, monkeypatch):
    a,b=events
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',a.id)
    competition=Competition.query.filter_by(quota_discipline='Snowboard Alpine',gender='M').first()
    people=[]
    for owner,nation,count in ((a,'JPN',300),(a,'FIN',24),(b,'JPN',24)):
        rows=[Athlete(event_id=owner.id,firstname=f'Person{i}',lastname=nation,
            fis_code=str(1000000+i),nation_code=nation,gender='M',
            function='Athlete' if i%2==0 else 'NSA Coach',room_type='Double shared',
            arrival_date=date(2027,3,3),departure_date=date(2027,3,9),
            competitions=[competition]) for i in range(count)]
        db.session.add_all(rows);people.append(rows)
    db.session.flush()
    decisions=[]
    for owner,rows in ((a,people[0]),(b,people[2])):
        upload=session(owner)
        upload.status='IMPORTED'
        keys=[p.fis_code for p in rows[:20]]
        decision=ImportApproval(session_id=upload.id,version_id=upload.current_version_id,
            nation='JPN',approval_type='QUOTA_SINGLE_ROOMS_EXCEEDED',description='Test evidence',
            decision='APPROVED',username='test',approved_person_keys_json=json.dumps(keys),
            quota_details_json=json.dumps(dict(eventId=owner.id,rulesRevision=1,
                nationCode='JPN',discipline=competition.quota_discipline,gender='M',quotaMembershipVersion=2,
                singleRoomCandidates=[{'personKey':k,'competitionIds':[str(competition.id)]} for k in keys])))
        db.session.add(decision);db.session.flush();decisions.append(decision)
        for p in rows[:20]:
            p.single_room_status='APPROVED_EXTRA';p.single_room_decision_id=decision.id
    hotel=Hotel(name='Fixture');rt=RoomType(name='DZ',max_persons=2)
    db.session.add_all([hotel,rt]);db.session.flush()
    for i,p in enumerate(people[0][:4]):
        booking=RoomBooking(event_id=a.id,hotel_id=hotel.id,room_type_id=rt.id,
            room_number=str(i),check_in_date=date(2027,3,3),check_out_date=date(2027,3,9),counts_as_single=False)
        booking.occupants=[RoomBookingOccupant(athlete=p)];db.session.add(booking)
    db.session.commit()
    return a,b,people,decisions


@contextmanager
def measured():
    count=[]
    def record(*args):count.append(args[2])
    sql_event.listen(db.engine,'before_cursor_execute',record)
    start=perf_counter()
    try:yield count
    finally:
        sql_event.remove(db.engine,'before_cursor_execute',record)
        print(f'queries={len(count)} elapsed_ms={(perf_counter()-start)*1000:.2f}')


@pytest.mark.parametrize('path,budget',[
    ('/api/athletes',30),('/api/room-bookings/grouped',30),
    ('/api/assignments/planning-view?includeValidations=false',35),
    ('/api/fis/official-quotas',35)])
def test_300_people_20_selected_exact_json_and_query_budget(population,monkeypatch,path,budget):
    client=app.test_client()
    import approval_projection
    with monkeypatch.context() as reference:
        reference.setattr(approval_projection,'projected_approval_groups',applicable_approval_groups)
        baseline=client.get(path)
    db.session.remove()
    with measured() as count:
        optimized=client.get(path)
    assert baseline.status_code==optimized.status_code==200
    assert baseline.json==optimized.json
    assert len(count)<=budget
    assert not any(sql.lstrip().upper().startswith(('INSERT ', 'UPDATE ', 'DELETE ')) for sql in count)


def test_multiple_events_nations_and_changed_evidence_match_canonical(population):
    a,b,people,decisions=population
    for case in ('valid','stale_revision','changed_membership','foreign_event','foreign_nation'):
        if case=='stale_revision':
            db.session.execute(db.update(Event).where(Event.id==a.id).values(quota_rules_revision=2));db.session.commit()
        elif case=='changed_membership':
            db.session.execute(db.update(Event).where(Event.id==a.id).values(quota_rules_revision=1))
            people[0][0].competitions=[];db.session.commit()
        context=ApprovalReadProjection()
        for decision,rows in ((decisions[0],people[0][:20]),(decisions[1],people[2][:20])):
            if case=='foreign_event':rows=people[2][:20] if decision==decisions[0] else people[0][:20]
            if case=='foreign_nation':rows=people[1][:20]
            for person in rows:
                assert context.groups(decision,person)==applicable_approval_groups(decision,person)
    # Invalidating one member rejects the entire selected cohort, not only that person.
    assert not ApprovalReadProjection().groups(decisions[0],people[0][1])


def test_unapproved_decisions_keep_the_canonical_short_circuit():
    from types import SimpleNamespace
    decision=SimpleNamespace(decision='PENDING',quota_details_json='not JSON')
    person=SimpleNamespace()
    assert applicable_approval_groups(decision,person)==set()
    assert ApprovalReadProjection().groups(decision,person)==set()
