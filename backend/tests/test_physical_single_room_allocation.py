"""Physical person consumption is independent of overlapping entitlement eligibility."""
from copy import deepcopy
from itertools import permutations
import json
from pathlib import Path
import subprocess

import pytest

from quota_service import allocate_single_rooms, evaluate_quota_usage


X = ('AUT', 'Ski Cross', 'M')
Y = ('AUT', 'Ski Cross', 'W')
Z = ('AUT', 'Freestyle', 'M')


def athletes():
    return [dict(personId='athlete-'+g, function='Athlete', nationCode='AUT', gender=g,
                 quotaDisciplines=['Ski Cross', 'Freestyle']) for g in ('M', 'W')]


def official(identity, groups=('Ski Cross',), **extra):
    return dict(personId=identity, matchKey=identity, function='Official', nationCode='AUT', gender='A',
                forGender='A', quotaDisciplines=list(groups), countsAsSingle=True, **extra)


def result(people, capacities):
    return allocate_single_rooms(people, capacities, [*athletes(), *people])


def test_two_shared_officials_consume_two_slots_once_each():
    people = [official('A'), official('B')]
    records = result(people, {X: 1, Y: 1})
    assert len(records) == 2 and all(r['status'] == 'COVERED' for r in records)
    assert {tuple(r['context']) for r in records} == {X, Y}
    rows = evaluate_quota_usage([*athletes(), *people], people)
    assert sum(r['singleRoomsUsed'] for r in rows) == 2
    assert sum(r['singleRoomsPending'] for r in rows) == 0
    assert all(r['gender'] != 'A' for r in rows)


def test_one_shared_official_consumes_one_slot_not_two():
    records = result([official('A')], {X: 1, Y: 1})
    assert len(records) == 1 and records[0]['status'] == 'COVERED'


def test_cross_event_groups_and_repeated_memberships_are_one_physical_person():
    p = official('A', ('Ski Cross', 'Ski Cross', 'Freestyle'))
    records = result([p, deepcopy(p)], {X: 1, Z: 1})
    assert len(records) == 1 and records[0]['status'] == 'COVERED'
    assert records[0]['eligibleContexts'] == [list(Z), list(X)]


def test_unused_ineligible_capacity_cannot_cover_restricted_people():
    people = [dict(personId=name, matchKey=name, function='Athlete', nationCode='AUT', gender='M',
                   quotaDisciplines=['Ski Cross'], countsAsSingle=True) for name in ('A', 'B')]
    records = result(people, {X: 1, Y: 1})
    assert [r['status'] for r in records] == ['COVERED', 'PENDING']
    assert all(r['context'] == list(X) for r in records)


def test_augmenting_paths_find_capacity_that_greedy_assignment_misses():
    # Three equal-degree people: A->{X,Y}, B->{X,Z}, C->{X,Z}.
    # Naive first-fit A->X, B->Z leaves C pending despite a complete matching.
    a = official('A', ('Ski Cross', 'Freestyle'))
    b = dict(official('B', ('Ski Cross', 'Freestyle')), function='Athlete', gender='M')
    c = {**b, 'personId': 'C', 'matchKey': 'C'}
    # A's eligibility under the three capacities includes X/Y/Z. Restrict it
    # to X/Y by using only Ski Cross; B and C have X/Z.
    a['quotaDisciplines'] = ['Ski Cross']
    expected = result([a, b, c], {X: 1, Y: 1, Z: 1})
    assert all(r['status'] == 'COVERED' for r in expected)
    for order in permutations([a, b, c]):
        assert result(list(order), {Z: 1, Y: 1, X: 1}) == expected


def test_exemption_approved_extra_and_false_single_flag_consume_no_normal_slot():
    p = official('A', singleRoomQuotaExemptReason='OTHER')
    approved = official('B', singleRoomStatus='APPROVED_EXTRA',
        approvedQuotaContexts=[dict(nationCode='AUT', discipline='Ski Cross', gender='W')])
    ordinary = official('C')
    inactive = {**official('D'), 'countsAsSingle': False}
    records = result([p, approved, ordinary, inactive], {X: 0, Y: 1})
    assert {r['identity']: r['status'] for r in records} == {'A': 'EXEMPT', 'B': 'APPROVED_EXTRA', 'C': 'COVERED'}
    assert next(r for r in records if r['identity'] == 'B')['context'] == list(Y)
    assert sum(r['status'] == 'COVERED' for r in records) == 1


def test_approval_cannot_cover_someone_else_or_an_ineligible_context():
    approved = official('A', singleRoomStatus='APPROVED_EXTRA',
        approvedQuotaContexts=[dict(nationCode='AUT', discipline='Freestyle', gender='M')])
    records = result([approved, official('B')], {X: 1})
    assert [r['status'] for r in records] == ['COVERED', 'PENDING']


def test_frontend_backend_maximum_allocation_agrees():
    definitions = [dict(nationCode=n, discipline=d, gender=g, singleRoomsAllowed=1) for n,d,g in (X,Y,Z)]
    people = [official('A'), dict(official('B', ('Ski Cross', 'Freestyle')), function='Athlete', gender='M'),
              dict(official('C', ('Ski Cross', 'Freestyle')), function='Athlete', gender='M'),
              official('D', singleRoomQuotaExemptReason='OTHER')]
    expected = result(people, {X:1,Y:1,Z:1})
    module = Path(__file__).parents[2] / 'frontend/src/app/services/quotaEvaluation.ts'
    script = '''
const {allocateSingleRoomPeople} = await import(process.argv[1]);
const data = JSON.parse(process.argv[2]);
const assignments=data.people.flatMap(p=>p.quotaDisciplines.map(discipline=>({...p,discipline,bookingId:p.personId,singleRoomStatus:p.singleRoomStatus})));
console.log(JSON.stringify(allocateSingleRoomPeople(data.definitions,assignments).map(p=>({identity:p.personId,status:p.allocationStatus,context:[p.nationCode,p.discipline,p.gender]}))));
'''
    output = subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',script,module.as_uri(),
        json.dumps(dict(definitions=definitions,people=people))],capture_output=True,text=True,check=True)
    assert json.loads(output.stdout) == [dict(identity=r['identity'],status=r['status'],context=r['context']) for r in expected]


@pytest.fixture
def database():
    from flask import Flask
    from models import db
    from excel_import import PREVIEW_STORE
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI='sqlite://', SQLALCHEMY_TRACK_MODIFICATIONS=False)
    db.init_app(app)
    with app.app_context():
        db.create_all()
        yield
        PREVIEW_STORE.clear()
        db.session.remove()
        db.drop_all()


def event_roster(codes=('8185',), genders=('M','W'), officials=('A','B')):
    from datetime import datetime
    from competitions import COMPETITIONS, resolve_quota_memberships
    from models import Competition, Event, EventCompetition, db
    mapping = {}
    event = Event(name='Physical allocation')
    for definition in COMPETITIONS:
        if definition.code in codes:
            c = Competition(**definition._asdict()); mapping[c.import_code] = c
            db.session.add(EventCompetition(event=event, competition=c, import_code=c.import_code,
                fis_codex=c.code, official_name=c.name))
    db.session.commit()
    people = []
    for key, role, gender in [*((g,'Athlete',g) for g in genders), *((o,'Official','W') for o in officials)]:
        people.append(resolve_quota_memberships(dict(matchKey=key,fisCode=key,firstname=key,lastname='Person',
            nationCode='AUT',gender=gender,forGender='A',function=role,competitionImportCodes=list(mapping)),mapping))
    return dict(createdAt=datetime.utcnow(),eventId=event.id,people=people,
        rooms=[dict(person1Key=key,person2Key=None,roomType='Single') for key in officials],errors=[],warnings=[])


def book_officials():
    from models import Athlete, Hotel, RoomType, RoomBooking, RoomBookingOccupant, db
    hotel = Hotel(name='Physical Hotel'); room = RoomType(name='Double',max_persons=2)
    db.session.add_all([hotel,room])
    for person in Athlete.query.filter_by(function='Official').all():
        db.session.add(RoomBookingOccupant(athlete=person,room_booking=RoomBooking(
            hotel=hotel,room_type=room,counts_as_single=True)))
    db.session.commit()


def test_shared_official_preview_confirmation_live_and_filtered_frontend_parity(database):
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete
    preview = event_roster()
    recalculate_fis_import_preview(preview)
    assert not any(w['code']=='QUOTA_SINGLE_ROOMS_EXCEEDED' for w in preview['warnings'])
    expected = {p['matchKey']:p['singleRoomAllocation']['context'] for p in preview['people'] if p['function']=='Official'}
    assert all(p['singleRoomEntitlement']=='IN_QUOTA' for p in preview['people'] if p['function']=='Official')
    PREVIEW_STORE['physical-shared'] = preview; confirm_fis_import('physical-shared')
    assert {a.single_room_status for a in Athlete.query.filter_by(function='Official')} == {'IN_QUOTA'}
    book_officials()
    rows = _build_official_quota_usage_rows()
    actual = {p['personKey']:p['context'] for r in rows for p in r['singleRoomAllocations']}
    assert actual == expected
    assert sum(r['singleRoomsUsed'] for r in rows)==2
    assert sum(r['singleRoomsPending'] for r in rows)==0
    assert _build_official_quota_usage_rows(gender='W') == [r for r in rows if r['gender']=='W']


def test_cross_group_live_display_filter_cannot_reallocate_a_person(database):
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete
    preview = event_roster(('8185','8179'),('M',),('A',))
    recalculate_fis_import_preview(preview)
    assert sum(c['singleRooms'] for c in preview['quotaChecks'])==1
    PREVIEW_STORE['physical-cross'] = preview; confirm_fis_import('physical-cross');book_officials()
    rows = _build_official_quota_usage_rows()
    assert sum(r['singleRoomsUsed'] for r in rows)==1
    selected = _build_official_quota_usage_rows(discipline='Ski Cross')
    assert selected == [r for r in rows if r['discipline']=='Ski Cross']
    assert sum(r['singleRoomsUsed'] for r in selected)==0
    a = Athlete.query.filter_by(fis_code='A').one()
    module = Path(__file__).parents[2] / 'frontend/src/app/services/quotaEvaluation.ts'
    script = '''
const {evaluateAllQuotaGroups} = await import(process.argv[1]);
const data=JSON.parse(process.argv[2]);
console.log(JSON.stringify(evaluateAllQuotaGroups(data.rows,data.assignments).map(g=>g.usedSingleRooms)));
'''
    assignments=[dict(personId=str(a.id),bookingId='1',nationCode='AUT',function='Official',gender='W',
        discipline=g,countsAsSingle=True) for g in ('Freestyle','Ski Cross')]
    output=subprocess.run(['node','--experimental-strip-types','--input-type=module','-e',script,module.as_uri(),
        json.dumps(dict(rows=selected,assignments=assignments))],capture_output=True,text=True,check=True)
    assert json.loads(output.stdout)==[0]


def test_approved_extra_frees_normal_slot_for_another_person_and_preserves_history(database):
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete, Competition, ImportSession, ImportApproval, db
    preview = event_roster(genders=('M',))
    recalculate_fis_import_preview(preview)
    session=ImportSession(nation='AUT');db.session.add(session);db.session.flush()
    c=Competition.query.one()
    details=dict(quotaMembershipVersion=2,nationCode='AUT',discipline='Ski Cross',gender='M',
        singleRoomCandidates=[dict(personKey='A',competitionIds=[str(c.id)])])
    immutable=json.dumps(details)
    decision=ImportApproval(session_id=session.id,nation='AUT',approval_type='NATION_APPROVED',description='Physical A',
        decision='APPROVED',username='original',quota_details_json=immutable,approved_person_keys_json='["A"]')
    db.session.add(decision);db.session.commit()
    PREVIEW_STORE['physical-approved']=preview;confirm_fis_import('physical-approved',{'A':decision.id})
    assert Athlete.query.filter_by(fis_code='A').one().single_room_status=='APPROVED_EXTRA'
    assert Athlete.query.filter_by(fis_code='B').one().single_room_status=='IN_QUOTA'
    book_officials()
    row=_build_official_quota_usage_rows()[0]
    assert {p['personKey']:p['status'] for p in row['singleRoomAllocations']} == {'A':'APPROVED_EXTRA','B':'COVERED'}
    assert row['singleRoomsCovered']==1 and row['singleRoomsPending']==0
    assert decision.quota_details_json==immutable and decision.approved_person_keys_json=='["A"]'
    recalculate_fis_import_preview(preview)
    assert next(p for p in preview['people'] if p['matchKey']=='B')['singleRoomEntitlement']=='IN_QUOTA'
    assert decision.quota_details_json==immutable


def test_maximum_coverage_matches_independent_exhaustive_search():
    from random import Random
    random = Random(27)
    contexts = [('AUT',group,'M') for group in ('X','Y','Z')]
    for _ in range(50):
        capacities = {c:random.randrange(3) for c in contexts}
        edges = [set(c for c in contexts if random.randrange(2)) for _ in range(4)]
        people = [dict(personId=str(i),function='Athlete',nationCode='AUT',gender='M',
                       quotaDisciplines=[c[1] for c in eligible],countsAsSingle=True)
                  for i,eligible in enumerate(edges)]
        def exhaustive(index, available):
            if index == len(people):return 0
            best = exhaustive(index+1, available)
            for context in edges[index]:
                if available[context]:
                    remaining={**available,context:available[context]-1}
                    best=max(best,1+exhaustive(index+1,remaining))
            return best
        allocation=allocate_single_rooms(people,capacities,people)
        assert sum(p['status']=='COVERED' for p in allocation)==exhaustive(0,capacities)
        assert len({p['identity'] for p in allocation})==len(people)
        for context,capacity in capacities.items():
            assert sum(p['status']=='COVERED' and p['context']==list(context) for p in allocation)<=capacity


def test_repeated_bookings_with_a_single_flag_count_one_person(database):
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete, Hotel, RoomType, RoomBooking, RoomBookingOccupant, db
    preview=event_roster(officials=('A',))
    recalculate_fis_import_preview(preview);PREVIEW_STORE['repeated-booking']=preview
    confirm_fis_import('repeated-booking')
    a=Athlete.query.filter_by(fis_code='A').one()
    hotel=Hotel(name='Repeated');room=RoomType(name='Double',max_persons=2)
    for single in (False,True,True):
        db.session.add(RoomBookingOccupant(athlete=a,room_booking=RoomBooking(hotel=hotel,room_type=room,counts_as_single=single)))
    db.session.commit()
    rows=_build_official_quota_usage_rows()
    assert sum(r['singleRoomsUsed'] for r in rows)==1
    assert len([p for r in rows for p in r['singleRoomAllocations']])==1
    recalculate_fis_import_preview(preview)
    assert sum(c['singleRooms'] for c in preview['quotaChecks'])==1
    assert [booking.counts_as_single for booking in RoomBooking.query.order_by(RoomBooking.id)]==[False,True,True]


@pytest.mark.parametrize('request_type', ['Double shared', None, 'Single'])
@pytest.mark.parametrize('flags', [(True,), (False, True, True)])
def test_retained_athlete_single_matches_live_without_duplicate_requests(database, request_type, flags):
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete, Hotel, RoomType, RoomBooking, RoomBookingOccupant, db
    preview = event_roster(genders=('M',), officials=('A',))
    preview['rooms'] = []
    recalculate_fis_import_preview(preview)
    PREVIEW_STORE['retained-athlete'] = preview
    confirm_fis_import('retained-athlete')
    athlete = Athlete.query.filter_by(fis_code='M').one()
    hotel = Hotel(name='Retained athlete'); room = RoomType(name='Double', max_persons=2)
    for flag in flags:
        db.session.add(RoomBookingOccupant(athlete=athlete, room_booking=RoomBooking(
            hotel=hotel, room_type=room, counts_as_single=flag)))
    db.session.commit()
    bookings = [(b.id, b.counts_as_single) for b in RoomBooking.query.all()]
    preview['rooms'] = [] if request_type is None else [dict(person1Key='M', person2Key=None, roomType=request_type)]
    recalculate_fis_import_preview(preview)
    checks = preview['quotaChecks']; live = _build_official_quota_usage_rows()
    assert sum(c['singleRoomsRequested'] for c in checks) == 1
    assert sum(c['singleRooms'] for c in checks) == sum(r['singleRoomsUsed'] for r in live) == 1
    assert next(p for p in preview['people'] if p['matchKey']=='M')['singleRoomAllocation']['status']=='COVERED'
    confirm_fis_import('retained-athlete')
    assert [(b.id, b.counts_as_single) for b in RoomBooking.query.all()] == bookings


def test_retained_athlete_single_reveals_pending_case_in_mixed_population(database):
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete, Hotel, RoomType, RoomBooking, RoomBookingOccupant, db
    preview = event_roster(genders=('M',), officials=('A',))
    preview['rooms'] = []
    recalculate_fis_import_preview(preview); PREVIEW_STORE['mixed-retained']=preview
    confirm_fis_import('mixed-retained')
    hotel=Hotel(name='Mixed retained'); room=RoomType(name='Double',max_persons=2)
    for person in Athlete.query.all():
        db.session.add(RoomBookingOccupant(athlete=person,room_booking=RoomBooking(hotel=hotel,room_type=room,counts_as_single=True)))
    db.session.commit()
    preview['rooms']=[dict(person1Key='M',person2Key=None,roomType='Double shared')]
    recalculate_fis_import_preview(preview)
    row=preview['quotaChecks'][0]; live=_build_official_quota_usage_rows()[0]
    assert row['singleRoomsRequested']==row['singleRooms']==live['singleRoomsUsed']==2
    assert row['singleRoomsPending']==live['singleRoomsPending']==1
    warning=next(w for w in preview['warnings'] if w['code']=='QUOTA_SINGLE_ROOMS_EXCEEDED')
    assert warning['details']['excessCount']==1
    assert {p['personKey'] for p in warning['details']['singleRoomCandidates']}=={'M','A'}


def test_retained_athlete_approval_and_official_exemption_survive_double_request(database):
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete, Competition, ImportSession, ImportApproval, Hotel, RoomType, RoomBooking, RoomBookingOccupant, db
    preview=event_roster(genders=('M',),officials=('A',))
    preview['rooms'].append(dict(person1Key='M',person2Key=None,roomType='Single'))
    recalculate_fis_import_preview(preview)
    session=ImportSession(nation='AUT');db.session.add(session);db.session.flush()
    c=Competition.query.one()
    details=dict(quotaMembershipVersion=2,nationCode='AUT',discipline='Ski Cross',gender='M',singleRoomCandidates=[dict(personKey='M',competitionIds=[str(c.id)])])
    immutable=json.dumps(details)
    decision=ImportApproval(session_id=session.id,nation='AUT',approval_type='NATION_APPROVED',description='Athlete extra',decision='APPROVED',username='original',quota_details_json=immutable,approved_person_keys_json='["M"]')
    db.session.add(decision);db.session.commit()
    PREVIEW_STORE['athlete-approved']=preview;confirm_fis_import('athlete-approved',{'M':decision.id})
    hotel=Hotel(name='Approved retained');room=RoomType(name='Double',max_persons=2)
    for person in Athlete.query.all():
        if person.fis_code=='A': person.single_room_quota_exempt_reason='OTHER'
        db.session.add(RoomBookingOccupant(athlete=person,room_booking=RoomBooking(hotel=hotel,room_type=room,counts_as_single=True)))
    db.session.commit()
    preview['rooms']=[dict(person1Key='M',person2Key=None,roomType='Double shared')]
    recalculate_fis_import_preview(preview)
    assert preview['preservedSingleRoomApprovals']['M']['decisionId']==decision.id
    statuses={p['matchKey']:p['singleRoomAllocation']['status'] for p in preview['people']}
    assert statuses=={'M':'APPROVED_EXTRA','A':'EXEMPT'}
    assert {p['personKey']:p['status'] for r in _build_official_quota_usage_rows() for p in r['singleRoomAllocations']}==statuses
    confirm_fis_import('athlete-approved')
    assert Athlete.query.filter_by(fis_code='M').one().single_room_decision_id==decision.id
    assert decision.quota_details_json==immutable and decision.approved_person_keys_json=='["M"]'


def test_partial_reimport_retains_athlete_singles_and_foreign_family_memberships(database):
    from competitions import resolve_quota_memberships
    from excel_import import PREVIEW_STORE, recalculate_fis_import_preview, confirm_fis_import
    from app import _build_official_quota_usage_rows
    from models import Athlete, Competition, Hotel, RoomType, RoomBooking, RoomBookingOccupant, db
    preview=event_roster(codes=('8185','6193'),genders=('M',),officials=())
    mapping={c.import_code:c for c in Competition.query.all()}
    ski={code:c for code,c in mapping.items() if c.quota_discipline=='Ski Cross'}
    snow={code:c for code,c in mapping.items() if c.quota_discipline=='Snowboard Cross'}
    other=deepcopy(preview['people'][0]);other.update(matchKey='F',fisCode='F',firstname='Other family',competitionImportCodes=list(ski))
    preview['people'].append(resolve_quota_memberships(other,ski))
    recalculate_fis_import_preview(preview);PREVIEW_STORE['partial-athletes']=preview
    confirm_fis_import('partial-athletes')
    people_before={p.fis_code:(p.id,{c.id for c in p.competitions}) for p in Athlete.query.all()}
    hotel=Hotel(name='Partial retained');room=RoomType(name='Double',max_persons=2)
    for person in Athlete.query.all():
        db.session.add(RoomBookingOccupant(athlete=person,room_booking=RoomBooking(hotel=hotel,room_type=room,counts_as_single=True)))
    db.session.commit()
    shared=deepcopy(preview['people'][0]);shared['competitionImportCodes']=list(snow)
    resolve_quota_memberships(shared,snow)
    preview.update(people=[shared],rooms=[],replacementScope={'kind':'SPORT_FAMILY','family':'Snowboard'})
    recalculate_fis_import_preview(preview)
    assert len(preview['people'])==1 and len(preview['evaluationPeople'])==2
    assert set(next(p for p in preview['evaluationPeople'] if p['matchKey']=='M')['quotaDisciplines'])=={'Ski Cross','Snowboard Cross'}
    checks=preview['quotaChecks'];live=_build_official_quota_usage_rows()
    assert sum(c['singleRoomsRequested'] for c in checks)==sum(r['singleRoomsUsed'] for r in live)==2
    assert {p['personKey']:p['status'] for c in checks for p in c['singleRoomAllocations']}=={p['personKey']:p['status'] for r in live for p in r['singleRoomAllocations']}
    from imports.change_plan import build_plan
    from imports.read_context import ImportReadContext
    plan=build_plan(preview,ImportReadContext(preview['eventId']))
    assert not plan['people']['remove'] and not plan['memberships']['remove']
    confirm_fis_import('partial-athletes',change_plan=plan)
    assert {p.fis_code:(p.id,{c.id for c in p.competitions}) for p in Athlete.query.all()}==people_before
    assert RoomBooking.query.count()==2 and all(b.counts_as_single for b in RoomBooking.query.all())


@pytest.mark.parametrize('extra', [{}, {'singleRoomStatus':'APPROVED_EXTRA','approvedQuotaContexts':[dict(nationCode='AUT',discipline='Ski Cross',gender='M')]}])
def test_contextless_pending_allocations_survive_optional_projection(extra):
    p=official('orphan',('Ski Cross','Freestyle'),**extra)
    view=evaluate_quota_usage([p],[p,deepcopy(p)],include_unallocated=True)
    assert view['rows']==evaluate_quota_usage([p],[p,deepcopy(p)])==[]
    assert len(view['unallocatedSingleRooms'])==1
    assert view['unallocatedSingleRooms'][0]['status']=='PENDING'
    assert view['unallocatedSingleRooms'][0]['context'] is None
    assert view['unallocatedSingleRooms'][0]['personId']=='orphan'


def test_optional_projection_preserves_covered_approved_and_exempt_rows():
    people=[official('normal'),official('paid',singleRoomStatus='APPROVED_EXTRA',approvedQuotaContexts=[dict(nationCode='AUT',discipline='Ski Cross',gender='W')]),official('free',singleRoomQuotaExemptReason='OTHER')]
    roster=[*athletes(),*people]
    view=evaluate_quota_usage(roster,people,include_unallocated=True)
    assert view['rows']==evaluate_quota_usage(roster,people)
    assert view['unallocatedSingleRooms']==[]
    assert {p['status'] for r in view['rows'] for p in r['singleRoomAllocations']}=={'COVERED','APPROVED_EXTRA','EXEMPT'}
    exempt=official('unmapped-free',(),singleRoomQuotaExemptReason='OTHER')
    assert evaluate_quota_usage([exempt],[exempt],include_unallocated=True)['unallocatedSingleRooms']==[]
