"""Once-only source-bound consent, shared accommodation and unchanged strict identity."""
import copy,json,io,os
from pathlib import Path
import pandas as pd
import pytest
from test_import_event_identity import events
from test_partial_nation_snapshots import owner,upload,rows,compose
from test_safe_reimport import run,review
from app import app
from models import db,Athlete,ImportSessionEvent,ImportSession,EventAccess,ImportApproval

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


def staff(part,room='Double shared',arrival='04.03.2027',departure='22.03.2027'):
    p=rows(part)[0]
    p.update(Firstname='Same',Lastname='Official',Fiscode=None,Function='NSA Coach',Room_type=room,Arrival_date=arrival,Departure_date=departure)
    p['Competitorid/Staff ID']='staff-'+part
    return [p]


def confirm(proposal,keys=None):
    details=proposal['details']
    return app.test_client().post(f"/api/import/sessions/{details['sessionId']}/history",json={
        'officialLinkAction':'CONFIRM','token':details['token'],'candidateKeys':keys if keys is not None else [p['key'] for p in details['candidates']],'confirmed':True})


def paired(owner,first='SB',second='FS',left=None,right=None,import_first=False):
    a=upload(owner,first,data=left or staff(first))
    if import_first:run(a,owner)
    proposal=upload(owner,second,data=right or staff(second),expected=422)
    assert proposal['error']=='OFFICIAL_IDENTITY_REVIEW_REQUIRED'
    assert len(proposal['details']['candidates'])==1
    accepted=confirm(proposal);assert accepted.status_code==201,accepted.json
    return a,upload(owner,second,data=right or staff(second)),proposal


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
@pytest.mark.parametrize('import_first',[False,True])
def test_confirmed_official_is_one_person_with_two_memberships_and_reimport_aliases(owner,first,second,import_first):
    a,b,proposal=paired(owner,first,second,import_first=import_first)
    assert confirm(proposal).status_code==409
    combined=compose(b,owner);assert combined.status_code==200,combined.json
    payload={'session':combined.json}
    people=combined.json['preview']['people']
    assert len(people)==1 and len(people[0]['competitionIds'])==2
    assert {i['staffId'] for i in people[0]['sourceIdentities']}=={'staff-SB','staff-FS'}
    result=run(payload,owner)
    assert Athlete.query.count()==1
    p=Athlete.query.one();before=(p.id,p.competitor_id)
    again=upload(owner,first,data=staff(first));joint=compose(again,owner);assert joint.status_code==200
    run({'session':joint.json},owner)
    assert (Athlete.query.one().id,Athlete.query.one().competitor_id)==before
    assert ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()==1
    assert all('incoming.official-source-link' not in e['description'] for e in joint.json['history'])


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
def test_missing_accommodation_retains_concrete_other_source_without_no_room(owner,first,second):
    data={part:staff(part) for part in ('SB','FS')};data['FS']=staff('FS',room=None,arrival=None,departure=None)
    a,b,_=paired(owner,first,second,left=data[first],right=data[second])
    combined=compose(b,owner);assert combined.status_code==200
    p=combined.json['preview']['people'][0]
    assert not combined.json['preview']['errors']
    assert p['roomType']=='Double shared' and p['accommodationRequirement']=='REQUIRED'
    assert str(p['arrivalDate'])[:10]=='2027-03-04' and str(p['departureDate'])[:10]=='2027-03-22'
    run({'session':combined.json},owner)
    saved=Athlete.query.one();assert saved.room_type=='Double shared' and saved.accommodation_requirement=='REQUIRED'


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
def test_explicit_no_room_conflict_is_not_treated_as_missing(owner,first,second):
    data={'SB':staff('SB','No room'),'FS':staff('FS')}
    _,b,_=paired(owner,first,second,left=data[first],right=data[second])
    combined=compose(b,owner);assert combined.status_code==200
    preview=combined.json['preview']
    assert len(preview['people'])==1 and not preview['isValid']
    assert any(e['code']=='IMPORT_SHARED_ACCOMMODATION_CONFLICT' for e in preview['errors'])
    assert review({'session':combined.json},owner).status_code==409
    assert Athlete.query.count()==0


def test_disjoint_stays_are_flagged_not_stretched_into_a_contiguous_need(owner):
    _,b,_=paired(owner,left=staff('SB',arrival='16.03.2027',departure='21.03.2027'),right=staff('FS',arrival='09.03.2027',departure='15.03.2027'))
    joint=compose(b,owner);assert joint.status_code==200
    preview=joint.json['preview']
    issue=next(e for e in preview['errors'] if e['code']=='IMPORT_SHARED_STAY_SECTIONS')
    assert len(issue['details']['periods'])==2 and not preview['isValid']
    assert not (str(preview['people'][0]['arrivalDate'])[:10]=='2027-03-09' and str(preview['people'][0]['departureDate'])[:10]=='2027-03-21')
    assert review({'session':joint.json},owner).status_code==409


def test_confirmation_needs_current_scope_and_explicit_person_selection(owner):
    first=upload(owner,'SB',data=staff('SB'))
    proposal=upload(owner,'FS',data=staff('FS'),expected=422)
    assert confirm(proposal,[]).status_code==409
    assert confirm(proposal,['unknown']).status_code==409
    upload(owner,'SB',data=staff('SB'))
    assert confirm(proposal).status_code==409
    assert not ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()


def test_a_changed_or_reused_strong_id_is_not_unconditionally_accepted(owner):
    a,b,_=paired(owner)
    joint=compose(b,owner);run({'session':joint.json},owner)
    person=Athlete.query.one();person.fis_code='9999001';db.session.commit()
    result=upload(owner,'FS',data=staff('FS'),expected=422)
    assert result['error']=='OFFICIAL_LINK_STALE'
    assert Athlete.query.count()==1


def test_manual_requirement_and_tariff_stay_protected_with_missing_other_source(owner):
    a=upload(owner,'SB',data=staff('SB'));run(a,owner)
    p=Athlete.query.one();p.accommodation_requirement='REQUIRED';p.accommodation_requirement_source='MANUAL'
    p.accommodation_rate_category='SPECIAL';p.accommodation_rate_source='MANUAL';db.session.commit()
    proposal=upload(owner,'FS',data=staff('FS',room=None),expected=422);assert confirm(proposal).status_code==201
    b=upload(owner,'FS',data=staff('FS',room=None));joint=compose(b,owner);assert joint.status_code==200
    run({'session':joint.json},owner)
    p=Athlete.query.one();assert p.accommodation_requirement_source=='MANUAL' and p.accommodation_rate_source=='MANUAL' and p.accommodation_rate_category=='SPECIAL'


def test_confirmation_cannot_be_used_by_a_viewer(owner,monkeypatch):
    upload(owner,'SB',data=staff('SB'))
    proposal=upload(owner,'FS',data=staff('FS'),expected=422)
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS','incoming-viewer')
    assert confirm(proposal).status_code==403
    assert not ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()


def test_staff_id_owned_by_a_different_person_is_not_a_link_candidate(owner):
    a=upload(owner,'SB',data=staff('SB'));run(a,owner)
    other=Athlete(event_id=owner.id,firstname='Other',lastname='Official',nation_code='ARG',function='NSA Coach',competitor_id='staff-FS')
    db.session.add(other);db.session.commit()
    result=upload(owner,'FS',data=staff('FS'),expected=422)
    assert result['error']=='OFFICIAL_LINK_CONFLICT'
    assert other.firstname=='Other' and Athlete.query.count()==2
    assert not ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()


def test_fis_conflicts_and_same_family_staff_changes_do_not_get_alias_confirmation(owner):
    a=upload(owner,'SB',data=staff('SB'));run(a,owner)
    changed=staff('SB');changed[0]['Competitorid/Staff ID']='new-staff'
    result=upload(owner,'SB',data=changed,expected=422)
    assert result['error']=='IMPORT_IDENTITY_CONFLICT'
    p=Athlete.query.one();p.fis_code='9999001';db.session.commit()
    changed=staff('FS');changed[0]['Fiscode']='9999002'
    result=upload(owner,'FS',data=changed,expected=422)
    assert result['error']=='IMPORT_IDENTITY_CONFLICT'
    assert not ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()


def test_identical_room_rows_are_not_counted_twice_for_a_confirmed_person(owner):
    # Single room avoids a synthetic missing-partner finding; formal quota checks stay separate.
    room=[dict(Firstname='Same',Lastname='Official',Nationcode='ARG',Room_type='Single',Arrival_date='04.03.2027',Departure_date='22.03.2027')]
    upload(owner,'SB',data=staff('SB','Single'),room_data=room)
    proposal=upload(owner,'FS',data=staff('FS','Single'),room_data=room,expected=422)
    assert confirm(proposal).status_code==201
    b=upload(owner,'FS',data=staff('FS','Single'),room_data=room)
    joint=compose(b,owner);assert joint.status_code==200
    preview=joint.json['preview'];assert len(preview['people'])==1 and len(preview['rooms'])==1
    assert len(preview['rooms'][0]['sourceRows'])==2


@pytest.fixture
def aut_files():
    keys=('AUT_SB_ENTRIES','AUT_SB_ROOMS','AUT_FS_ENTRIES','AUT_FS_ROOMS')
    values=[Path(os.environ.get(key,'')) for key in keys]
    if not all(p.is_file() for p in values):pytest.skip('AUT originals supplied via AUT_SB/FS_ENTRIES/ROOMS')
    return {'SB':values[:2],'FS':values[2:]}


def aut_upload(owner,files):
    entries,rooms=files
    return app.test_client().post('/api/import/fis/preview',data={'eventId':str(owner.id),'createSession':'true',
        'entriesList':(io.BytesIO(entries.read_bytes()),entries.name),'roomListDetailed':(io.BytesIO(rooms.read_bytes()),rooms.name)})


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
def test_aut_originals_have_six_candidates_and_95_people_but_explicit_housing_conflicts(owner,aut_files,first,second):
    initial=aut_upload(owner,aut_files[first]);assert initial.status_code==200
    proposal=aut_upload(owner,aut_files[second]);assert proposal.status_code==422
    assert proposal.json['error']=='OFFICIAL_IDENTITY_REVIEW_REQUIRED'
    assert len(proposal.json['details']['candidates'])==6
    assert Athlete.query.count()==0
    accepted=confirm(proposal.json);assert accepted.status_code==201
    following=aut_upload(owner,aut_files[second]);assert following.status_code==200,following.json.get('error')
    joint=compose(following.json,owner);assert joint.status_code==200,joint.json.get('error')
    preview=joint.json['preview']
    assert len(preview['people'])==95
    assert len([p for p in preview['people'] if p.get('confirmedOfficialLinkId')])==6
    assert all(len(p['sourceIdentities'])==2 for p in preview['people'] if p.get('confirmedOfficialLinkId'))
    issues=preview['errors'];assert not preview['isValid']
    assert any(e['code']=='IMPORT_SHARED_STAY_SECTIONS' for e in issues)
    person_conflicts=[e for e in issues if 'requirements' in (e.get('details') or {})]
    assert len(person_conflicts)==5
    assert sum(set(e['details']['requirements'])=={'NO_ROOM','REQUIRED'} for e in person_conflicts)==4
    assert review({'session':joint.json},owner).status_code==409
    assert Athlete.query.count()==0
    assert ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()==6
    # Re-upload reuses consent even when the original byte hash is already known.
    again=aut_upload(owner,aut_files[second]);assert again.status_code==200
    assert ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()==6


@pytest.mark.parametrize('first,second',[('SB','FS'),('FS','SB')])
def test_aut_originals_keep_first_imported_people_and_decisions_while_housing_is_open(owner,aut_files,first,second):
    initial=aut_upload(owner,aut_files[first]);assert initial.status_code==200
    # Model an already lawfully approved first import. The original SB source
    # needs a separate male-quota decision; identity consent must never grant it.
    current=app.test_client().get(f"/api/import/sessions/{initial.json['session']['id']}").json
    from test_event_quota_rules import decision
    pending=[a for a in current['approvals'] if a['decision']=='PENDING']
    if pending:
        assert review(initial.json,owner).status_code==409
    for approval in pending:
        assert approval['quotaDetails'].get('decisionKind')=='ATHLETE_QUOTA'
        accepted=decision(current['id'],approval['id'],approval['quotaDetails']['uncoveredExtent'])
        assert accepted.status_code==200,accepted.json
    run(initial.json,owner)
    frozen={a.id:a.to_dict() for a in ImportApproval.query.filter_by(decision='APPROVED')}
    before={p.id:(p.competitor_id,p.accommodation_requirement,p.accommodation_rate_category,tuple(sorted(c.id for c in p.competitions))) for p in Athlete.query.all()}
    proposal=aut_upload(owner,aut_files[second]);assert proposal.status_code==422
    assert len(proposal.json['details']['candidates'])==6
    assert confirm(proposal.json).status_code==201
    following=aut_upload(owner,aut_files[second]);assert following.status_code==200,following.json.get('error')
    joint=compose(following.json,owner);assert joint.status_code==200
    assert len(joint.json['preview']['people'])==95 and not joint.json['preview']['isValid']
    assert review({'session':joint.json},owner).status_code==409
    assert {p.id:(p.competitor_id,p.accommodation_requirement,p.accommodation_rate_category,tuple(sorted(c.id for c in p.competitions))) for p in Athlete.query.all()}==before
    assert all(db.session.get(ImportApproval,key).to_dict()==value for key,value in frozen.items())


def test_confirmation_does_not_accept_another_event_session(owner):
    from test_import_event_identity import session as make_session
    from models import Event
    upload(owner,'SB',data=staff('SB'))
    proposal=upload(owner,'FS',data=staff('FS'),expected=422)
    other=Event.query.filter(Event.id!=owner.id).first();foreign=make_session(other)
    proposal['details']['sessionId']=str(foreign.id)
    assert confirm(proposal).status_code in {403,404,409}
    assert not ImportSessionEvent.query.filter_by(event_type='OFFICIAL_SOURCE_LINK').count()


def test_unknown_explicit_room_value_is_not_absence(owner):
    _,b,_=paired(owner,left=staff('SB','Unknown room request'))
    joint=compose(b,owner);assert joint.status_code==200
    assert not joint.json['preview']['isValid']
    assert any(e['code']=='IMPORT_SHARED_ACCOMMODATION_CONFLICT' for e in joint.json['preview']['errors'])


def test_missing_room_information_does_not_hide_known_disjoint_source_periods(owner):
    _,b,_=paired(owner,left=staff('SB',arrival='16.03.2027',departure='21.03.2027'),right=staff('FS',room=None,arrival='09.03.2027',departure='15.03.2027'))
    joint=compose(b,owner);assert joint.status_code==200
    assert any(e['code']=='IMPORT_SHARED_STAY_SECTIONS' for e in joint.json['preview']['errors'])
    assert review({'session':joint.json},owner).status_code==409
