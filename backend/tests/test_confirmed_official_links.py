"""Once-only source-bound consent, shared accommodation and unchanged strict identity."""
import copy,json,io,os
from pathlib import Path
import pandas as pd
import pytest
from test_import_event_identity import events
from test_partial_nation_snapshots import owner,upload,rows,compose,shared_fs
from test_safe_reimport import run,review
from app import app
from models import db,Athlete,ImportSessionEvent,ImportSession,EventAccess,ImportApproval,ImportSessionVersion

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


def paired(owner,first='SB',second='FS',left=None,right=None,import_first=False,workbooks=None):
    a=upload(owner,first,data=left or staff(first),workbooks=workbooks)
    if import_first:run(a,owner)
    proposal=upload(owner,second,data=right or staff(second),expected=422,workbooks=workbooks)
    assert proposal['error']=='OFFICIAL_IDENTITY_REVIEW_REQUIRED'
    assert len(proposal['details']['candidates'])==1
    accepted=confirm(proposal);assert accepted.status_code==201,accepted.json
    return a,upload(owner,second,data=right or staff(second),workbooks=workbooks),proposal


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
    assert len(preview['people'])==1 and preview['isValid']
    assert any(e['code']=='IMPORT_SHARED_ACCOMMODATION_UNRESOLVED' for e in preview['warnings'])
    assert preview['people'][0]['accommodationRequirement'] == 'UNRESOLVED'


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


def aut_upload(owner,files,*,reuse=False):
    entries,rooms=files
    return app.test_client().post('/api/import/fis/preview',data={'eventId':str(owner.id),'createSession':'true',
        'entriesList':(io.BytesIO(entries.read_bytes()),entries.name),'roomListDetailed':(io.BytesIO(rooms.read_bytes()),rooms.name),
        **({'reuseKnownFiles':'true','snapshotScope':'AUTO'} if reuse else {})})


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


@pytest.mark.parametrize('already_booked', [False, True])
def test_italy_official_with_conflicting_room_requirements_imports_without_assignment(owner, already_booked):
    from models import ImportSessionVersion, RoomBooking, RoomBookingOccupant
    from test_safe_reimport import booking

    freestyle = staff('FS', 'Double shared')
    snowboard = staff('SB', 'No room')
    for entry in freestyle + snowboard:
        entry['Nationcode'] = 'ITA'
    _, draft, _ = paired(owner, 'FS', 'SB', left=freestyle, right=snowboard,
                         import_first=already_booked)
    existing = Athlete.query.one() if already_booked else None
    retained = booking([existing]) if existing else None
    source_ids = [int(row['versionId']) for row in draft['session']['submissions']]
    source_json = {source_id: db.session.get(ImportSessionVersion, source_id).preview_json
                   for source_id in source_ids}

    joint = compose(draft, owner)
    assert joint.status_code == 200, joint.json
    preview = joint.json['preview']
    person, = preview['people']
    assert len(person['competitionIds']) == 2
    assert {int(row['versionId']) for row in person['sourceRows']} == set(source_ids)
    if existing:
        conflict = next(e for e in preview['errors'] if e['code'] == 'IMPORT_SHARED_ACCOMMODATION_CONFLICT')
        assert set(conflict['details']['requirements']) == {'REQUIRED', 'NO_ROOM'}
        assert review({'session': joint.json}, owner).status_code == 409
        assert existing.accommodation_requirement == 'REQUIRED'
        assert RoomBooking.query.one().id == retained.id
        assert RoomBookingOccupant.query.one().athlete_id == existing.id
    else:
        conflict = next(e for e in preview['warnings'] if e['code'] == 'IMPORT_SHARED_ACCOMMODATION_UNRESOLVED')
        assert set(conflict['details']['requirements']) == {'REQUIRED', 'NO_ROOM'}
        assert person['accommodationRequirement'] == 'UNRESOLVED'
        run({'session': joint.json}, owner)
        saved = Athlete.query.one()
        assert saved.accommodation_requirement == 'UNRESOLVED'
        assert saved.accommodation_requirement_import_value is None
        assert saved.room_type is None and saved.shared_with_name is None
        assert len(saved.competitions) == 2 and RoomBooking.query.count() == 0
        client = app.test_client()
        detail = client.get(f'/api/athletes/{saved.id}').json
        assert detail['accommodationCoverage']['openIntervals'] == []
        assert detail['workflowStatus'] == 'CONFLICT'
        from app import _build_room_booking_units
        units, _ = _build_room_booking_units()
        assert str(saved.id) not in {p['athleteId'] for u in units for p in u['occupants']}
        from accommodation_requirements import require_assignable
        from accommodation_split import SplitError
        with pytest.raises(SplitError, match='Unterkunftsbedarf offen'):
            require_assignable(saved)
        rejected = client.post(f'/api/assignments/persons/{saved.id}/segments', json={
            'checkInDate': '2027-03-04', 'checkOutDate': '2027-03-22',
        })
        assert rejected.status_code == 400
        assert rejected.json['reasonCode'] == 'UNRESOLVED_ASSIGNMENT_FORBIDDEN'
        unchanged = client.patch(f'/api/athletes/{saved.id}', json={'accommodationRequirement': None})
        assert unchanged.status_code == 200 and unchanged.json['accommodationRequirement'] == 'UNRESOLVED'
        change = client.patch(f'/api/athletes/{saved.id}', json={'accommodationRequirement': 'REQUIRED'})
        assert change.status_code == 200, change.json
        assert change.json['accommodationCoverage']['openIntervals']
    assert {source_id: db.session.get(ImportSessionVersion, source_id).preview_json
            for source_id in source_ids} == source_json


def test_unresolved_athlete_remains_reported_without_operational_demand(owner):
    snowboard = rows('SB')[:1]
    freestyle = shared_fs()[:1]
    snowboard[0]['Room_type'] = 'No room'
    upload(owner, 'FS', freestyle)
    draft = upload(owner, 'SB', snowboard)
    joint = compose(draft, owner)
    assert joint.status_code == 200, joint.json
    preview = joint.json['preview']
    assert preview['people'][0]['accommodationRequirement'] == 'UNRESOLVED'
    assert {r['topLevelDiscipline']: r['athleteQuotaUsed'] for r in preview['athleteQuotaChecks']} == {
        'Freestyle': 1, 'Snowboard': 1,
    }
    run({'session': joint.json}, owner)
    athlete = Athlete.query.one()
    client = app.test_client()
    planning = client.get('/api/athletes/arrival-planning').json
    assert planning['reportedCount'] == 1
    area, = planning['rows']
    assert [p['personId'] for p in area['people']] == [str(athlete.id)]
    assert area['selectedPersonIds'] == []
    quotas = client.get('/api/official-quotas?nationCode=ARG&includeOperational=true').json
    assert quotas['rows'] and all(r['athletesEntered'] == 1 for r in quotas['rows'])
    assert quotas['operationalQuota']['rows']
    for row in quotas['operationalQuota']['rows']:
        assert row['expectedAthletes'] == 0
        assert row['singleRoomsRequested'] == row['singleRoomsUsed'] == 0
    assert client.get(f'/api/athletes/{athlete.id}').json['accommodationCoverage']['openIntervals'] == []


@pytest.mark.parametrize('manual_requirement', ['REQUIRED', 'NO_ROOM', 'NO_DISPO', None])
def test_identical_shared_reimport_preserves_explicit_accommodation_decision(owner, manual_requirement):
    from models import ImportSessionVersion

    freestyle = staff('FS', 'Double shared')
    snowboard = staff('SB', 'No room')
    workbooks = {}
    _, draft, _ = paired(owner, 'FS', 'SB', left=freestyle, right=snowboard, workbooks=workbooks)
    source_ids = [int(row['versionId']) for row in draft['session']['submissions']]
    source_json = {source_id: db.session.get(ImportSessionVersion, source_id).preview_json
                   for source_id in source_ids}
    joint = compose(draft, owner)
    run({'session': joint.json}, owner)
    athlete = Athlete.query.one()
    assert athlete.accommodation_requirement == 'UNRESOLVED'
    original_id = athlete.id
    memberships = {comp.id for comp in athlete.competitions}
    if manual_requirement is not None:
        changed = app.test_client().patch(
            f'/api/athletes/{original_id}', json={'accommodationRequirement': manual_requirement})
        assert changed.status_code == 200, changed.json
        assert changed.json['accommodationRequirement'] == manual_requirement
        assert changed.json['accommodationRequirementSource'] == 'MANUAL'

    same = upload(owner, 'SB', snowboard, workbooks=workbooks)
    assert same['knownFiles']
    joint = compose(same, owner)
    assert joint.status_code == 200, joint.json
    person, = joint.json['preview']['people']
    assert person['accommodationRequirement'] == (manual_requirement or 'UNRESOLVED')
    if manual_requirement is None:
        assert person['accommodationRequirementReviewRequired']
        assert person['roomType'] is None
    run({'session': joint.json}, owner)
    retained = Athlete.query.one()
    assert retained.id == original_id
    assert retained.accommodation_requirement == (manual_requirement or 'UNRESOLVED')
    assert retained.accommodation_requirement_source == ('MANUAL' if manual_requirement else 'IMPORT')
    assert {comp.id for comp in retained.competitions} == memberships
    assert {source_id: db.session.get(ImportSessionVersion, source_id).preview_json
            for source_id in source_ids} == source_json

    if manual_requirement != 'REQUIRED':
        return
    # Another export, and a person with an intervening booking, still go
    # through the original conflict safeguards.
    changed_source = upload(owner, 'SB', [{**snowboard[0], 'Lastupdate': '02.11.2026 12:00'}])
    changed_joint = compose(changed_source, owner)
    assert review({'session': changed_joint.json}, owner).status_code == 409

    from models import RoomBooking, RoomBookingOccupant
    from test_safe_reimport import booking
    booking_id = booking([retained]).id
    same_again = upload(owner, 'SB', snowboard, workbooks=workbooks)
    booked_joint = compose(same_again, owner)
    assert review({'session': booked_joint.json}, owner).status_code == 409
    assert RoomBooking.query.one().id == booking_id
    assert RoomBookingOccupant.query.one().athlete_id == original_id
    assert Athlete.query.one().accommodation_requirement == 'REQUIRED'


def test_ita_originals_import_shared_requests_as_source_evidence(owner):
    from app import _build_room_booking_units
    from models import ImportSessionVersion, RoomBooking

    files = {}
    for part in ('FS', 'SB'):
        pair = [os.environ.get(f'ITA_{part}_{suffix}') for suffix in ('ENTRIES', 'ROOMS')]
        if not all(path and Path(path).is_file() for path in pair):
            pytest.skip('ITA originals supplied via ITA_SB/FS_ENTRIES/ROOMS')
        files[part] = tuple(map(Path, pair))

    first = aut_upload(owner, files['FS'])
    assert first.status_code == 200, first.json
    proposal = aut_upload(owner, files['SB'])
    assert proposal.status_code == 422, proposal.json
    assert len(proposal.json['details']['candidates']) == 5
    assert confirm(proposal.json).status_code == 201
    second = aut_upload(owner, files['SB'])
    assert second.status_code == 200, second.json
    assert review(second.json, owner).status_code == 409
    source_ids = [int(row['versionId']) for row in second.json['session']['submissions']]
    sources_before = {i: db.session.get(ImportSessionVersion, i).preview_json for i in source_ids}
    joint = compose(second.json, owner)
    assert joint.status_code == 200, joint.json
    preview = joint.json['preview']
    assert preview['errors'] == []
    quotas = lambda data: {row['topLevelDiscipline']: row['athleteQuotaUsed'] for row in data['athleteQuotaChecks']}
    assert quotas(preview) == {**quotas(first.json), **quotas(second.json)}
    assert len(preview['people']) == 69
    assert sum(p['function'].lower() == 'athlete' for p in preview['people']) == 35
    assert sum(p['accommodationRequirement'] == 'UNRESOLVED' for p in preview['people']) == 5
    assert len([r for r in preview['rooms'] if r.get('sourceOnlyPartner')]) == 3
    client = app.test_client()
    target = next(p for p in preview['people'] if p['lastname'] == 'PALA')
    url = f"/api/import/sessions/{joint.json['id']}/accommodation-requirements/{target['matchKey']}"
    excluded = client.patch(url, json={'accommodationRequirement': 'NO_DISPO'})
    assert excluded.status_code == 200, excluded.json
    staged = next(p for p in excluded.json['preview']['people'] if p['matchKey'] == target['matchKey'])
    assert staged['accommodationRequirement'] == 'NO_DISPO'
    assert staged['fisAccommodationDeviationReasons'] == ['No Dispo']
    # The PATCH response uses its prepared plan. Independent readers still
    # resolve the current state, and must get the same reviewed values.
    independent = client.get(f"/api/import/sessions/{joint.json['id']}?eventId={owner.id}")
    assert independent.status_code == 200, independent.json
    for field in ('people', 'rooms', 'changePlan', 'planStale'):
        assert excluded.json['preview'][field] == independent.json['preview'][field]
    assert excluded.json['preview']['planStale'] is False
    rechecked = compose(second.json, owner)
    assert rechecked.status_code == 200, rechecked.json
    assert next(p for p in rechecked.json['preview']['people'] if p['matchKey'] == target['matchKey'])['accommodationRequirement'] == 'NO_DISPO'
    restored = client.patch(url, json={'accommodationRequirement': None})
    assert restored.status_code == 200, restored.json
    assert next(p for p in restored.json['preview']['people'] if p['matchKey'] == target['matchKey'])['accommodationRequirement'] == 'UNRESOLVED'
    athlete_to_exclude = next(p for p in restored.json['preview']['people'] if p['function'].lower() == 'athlete')
    athlete_path = f"/api/import/sessions/{joint.json['id']}/accommodation-requirements/{athlete_to_exclude['matchKey']}"
    joint = client.patch(athlete_path, json={'accommodationRequirement': 'NO_DISPO'})
    assert joint.status_code == 200, joint.json
    assert quotas(joint.json['preview']) == quotas(preview)
    memberships = {p['matchKey']: set(map(str, p['competitionIds'])) for p in preview['people']}
    run({'session': joint.json}, owner)

    people = Athlete.query.all()
    assert len(people) == 69
    assert {p.fis_code or p.competitor_id: {str(c.id) for c in p.competitions} for p in people} == memberships
    unresolved = {str(p.id) for p in people if p.accommodation_requirement == 'UNRESOLVED'}
    excluded_athlete = Athlete.query.filter_by(fis_code=athlete_to_exclude['fisCode']).one()
    assert excluded_athlete.accommodation_requirement == 'NO_DISPO'
    assert excluded_athlete.accommodation_requirement_source == 'MANUAL'
    assert len(unresolved) == 5
    klotz = Athlete.query.filter_by(lastname='KLOTZ', firstname='Siegmar').one()
    pala = Athlete.query.filter_by(lastname='PALA', firstname='Bartolomeo').one()
    assert klotz.accommodation_requirement == 'REQUIRED'
    assert klotz.shared_with_name is None
    client = app.test_client()
    detail = client.get(f'/api/athletes/{pala.id}').json
    assert len(detail['reportedAccommodationRequests']) == 2
    assert {r['partner'] for r in detail['reportedAccommodationRequests'] if r['partner']} == {'KLOTZ, Siegmar'}
    assert not detail['accommodationCoverage']['openIntervals']
    units, _ = _build_room_booking_units()
    occupants = [{p['athleteId'] for p in u['occupants']} for u in units]
    assert {str(klotz.id)} in occupants
    assert not any(group & unresolved for group in occupants)
    assert RoomBooking.query.count() == 0

    def repeat_original():
        again = aut_upload(owner, files['SB'])
        assert again.status_code == 200, again.json
        recomposed = compose(again.json, owner)
        assert recomposed.status_code == 200, recomposed.json
        assert recomposed.json['preview']['errors'] == []
        assert len([r for r in recomposed.json['preview']['rooms'] if r.get('sourceOnlyPartner')]) == 3
        run({'session': recomposed.json}, owner)

    repeat_original()
    assert excluded_athlete.accommodation_requirement == 'NO_DISPO'
    assert excluded_athlete.accommodation_requirement_source == 'MANUAL'
    assert pala.accommodation_requirement == 'UNRESOLVED'
    for value in ('REQUIRED', 'NO_ROOM', 'NO_DISPO'):
        edited = client.patch(f'/api/athletes/{pala.id}', json={'accommodationRequirement': value})
        assert edited.status_code == 200, edited.json
        repeat_original()
        assert pala.accommodation_requirement == value
        assert pala.accommodation_requirement_source == 'MANUAL'
        units, _ = _build_room_booking_units()
        assert not any({str(pala.id), str(klotz.id)} <= {p['athleteId'] for p in u['occupants']} for u in units)

    patch_url = f'/api/athletes/{pala.id}'
    departure = pala.departure_date
    selected = client.patch(patch_url, json={
        'accommodationRequirement': 'REQUIRED', 'roomType': 'Double shared', 'sharedWithName': 'KLOTZ, Siegmar',
    })
    assert selected.status_code == 200, selected.json
    assert selected.json['accommodationDecisionLabel'] == 'Abweichung FIS'
    assert pala.departure_date == departure
    assert client.patch(patch_url, json={'returnToFis': True}).status_code == 409
    repeat_original()
    assert (pala.accommodation_requirement, pala.room_type, pala.shared_with_name) == ('REQUIRED', 'Double shared', 'KLOTZ, Siegmar')
    assert next(row for row in client.get('/api/athletes').json if row['id'] == str(pala.id))['accommodationDecisionLabel'] == 'Abweichung FIS'
    no_dispo = client.patch(patch_url, json={'accommodationRequirement': 'NO_DISPO'})
    assert no_dispo.status_code == 200
    assert no_dispo.json['accommodationDecisionLabel'] == 'Nicht disponieren'
    assert no_dispo.json['hasFisAccommodationDeviation'] is True
    listed = next(row for row in client.get('/api/athletes').json if row['id'] == str(pala.id))
    assert listed['accommodationDecisionLabel'] == 'Nicht disponieren'
    assert listed['hasFisAccommodationDeviation'] is True
    assert client.patch(patch_url, json={'accommodationRequirement': 'REQUIRED'}).status_code == 200
    assert pala.shared_with_name == 'KLOTZ, Siegmar'

    regular_url = f'/api/athletes/{klotz.id}'
    confirmed_wish = client.patch(regular_url, json={
        'accommodationRequirement': 'REQUIRED', 'roomType': 'Double shared', 'sharedWithName': 'PALA, Bartolomeo',
    })
    assert confirmed_wish.status_code == 200, confirmed_wish.json
    assert confirmed_wish.json['accommodationDecisionLabel'] == 'FIS-Meldung bestätigt'
    assert confirmed_wish.json['hasFisAccommodationDeviation'] is False
    assert client.patch(regular_url, json={'returnToFis': True}).json['accommodationDecisionLabel'] == 'FIS-Meldung'

    # A changed partner date in the Room List cannot inherit clearance from the prior snapshot.
    changed_rooms = io.BytesIO()
    source = pd.read_excel(files['SB'][1])
    source.loc[source['Lastname'] == 'THIEBAT', 'Shared with\nDeparture_date'] = '14.03.2027'
    source.to_excel(changed_rooms, index=False, sheet_name='Data')
    changed_rooms.seek(0)
    changed = client.post('/api/import/fis/preview', data={
        'eventId': str(owner.id), 'createSession': 'true',
        'entriesList': (io.BytesIO(files['SB'][0].read_bytes()), files['SB'][0].name),
        'roomListDetailed': (changed_rooms, files['SB'][1].name),
        'reuseKnownFiles': 'true', 'snapshotScope': 'AUTO',
    })
    assert changed.status_code == 200, changed.json
    assert not changed.json.get('reusedKnownFiles')
    changed_joint = compose(changed.json, owner)
    assert changed_joint.status_code == 200, changed_joint.json
    assert review({'session': changed_joint.json}, owner).status_code == 409

    from test_safe_reimport import booking
    booking_id = booking([klotz]).id
    assert client.patch(regular_url, json={'roomType': 'Single'}).status_code == 409
    assert klotz.room_type == 'Double shared'
    same = aut_upload(owner, files['SB'])
    restored = compose(same.json, owner)
    assert review({'session': restored.json}, owner).status_code == 409
    assert RoomBooking.query.one().id == booking_id
    booked_no_dispo = client.patch(regular_url, json={'accommodationRequirement': 'NO_DISPO'})
    assert booked_no_dispo.status_code == 200
    assert booked_no_dispo.json['accommodationCoverage']['segments']
    grouped = client.get('/api/room-bookings/grouped')
    assert grouped.status_code == 200
    occupant, = grouped.json[0]['occupants']
    assert occupant['athlete']['fisAccommodationDeviationReasons'] == ['No Dispo']
    from test_import_performance import sql_count
    from routes.athletes import fis_accommodation_decisions
    # Measure the projection with loaded people, as on the production read paths.
    loaded = Athlete.query.filter(Athlete.id.in_([klotz.id, pala.id, excluded_athlete.id])).all()
    with sql_count() as queries:
        single = fis_accommodation_decisions([klotz])
    with sql_count() as many_queries:
        multiple = fis_accommodation_decisions(loaded)
    assert single[klotz.id] == multiple[klotz.id]
    assert len(queries) == len(many_queries) <= 2

    assert RoomBooking.query.one().id == booking_id

    assert {i: db.session.get(ImportSessionVersion, i).preview_json for i in source_ids} == sources_before

def test_no_dispo_without_comparable_fis_source_is_not_a_deviation():
    from types import SimpleNamespace
    from routes.athletes import add_accommodation_decision

    athlete = SimpleNamespace(accommodation_requirement='NO_DISPO', accommodation_requirement_source='MANUAL',
                              room_type=None, shared_with_name=None)
    for requests in ([], [{'roomType': 'keine Angabe', 'partner': None}]):
        result = {}
        add_accommodation_decision(result, athlete, requests)
        assert result == {'accommodationDecisionLabel': 'Nicht disponieren', 'hasFisAccommodationDeviation': False}

    athlete.accommodation_requirement = 'REQUIRED'
    athlete.room_type = 'Double shared'
    athlete.shared_with_name = 'Current Partner'
    request = {'roomType': 'Double shared', 'partner': None}
    result = {}
    add_accommodation_decision(result, athlete, [request])
    assert result['hasFisAccommodationDeviation'] is False
    assert 'matchesDecision' not in request

    add_accommodation_decision(result, athlete, [{'roomType': 'Single', 'partner': 'Reported Partner'}])
    assert result['fisAccommodationDeviationReasons'] == ['Zimmerpartner', 'Zimmertyp']


@pytest.mark.parametrize('first,second', [('SB', 'FS'), ('FS', 'SB')])
def test_ita_originals_after_one_sport_was_imported(owner, first, second):
    files = {}
    for part in ('FS', 'SB'):
        pair = [os.environ.get(f'ITA_{part}_{suffix}') for suffix in ('ENTRIES', 'ROOMS')]
        if not all(path and Path(path).is_file() for path in pair):
            pytest.skip('ITA originals supplied via ITA_SB/FS_ENTRIES/ROOMS')
        files[part] = tuple(map(Path, pair))

    initial = aut_upload(owner, files[first])
    assert initial.status_code == 200, initial.json
    run(initial.json, owner)
    original_ids = {p.id for p in Athlete.query.all()}
    upload_second = aut_upload(owner, files[second])
    assert upload_second.status_code == 422, upload_second.json
    assert len(upload_second.json['details']['candidates']) == 5
    assert confirm(upload_second.json).status_code == 201
    next_source = aut_upload(owner, files[second])
    assert next_source.status_code == 200, next_source.json
    duplicate = aut_upload(owner, files[second], reuse=True)
    assert duplicate.status_code == 200 and duplicate.json["reusedKnownFiles"]
    assert not duplicate.json["alreadyImported"]
    assert duplicate.json["session"]["currentVersionId"] == next_source.json["session"]["currentVersionId"]
    joint = compose(next_source.json, owner)
    assert joint.status_code == 200, joint.json
    preview = joint.json['preview']
    assert not preview['errors'], [e['code'] for e in preview['errors']]
    assert len(preview['people']) == 69
    assert sum(p['accommodationRequirement'] == 'UNRESOLVED' for p in preview['people']) == 5
    run({'session': joint.json}, owner)
    people = Athlete.query.all()
    assert len(people) == 69 and original_ids <= {p.id for p in people}
    assert sum(p.accommodation_requirement == 'UNRESOLVED' for p in people) == 5
    version_count = ImportSessionVersion.query.count()
    for part in (first, second):
        duplicate = aut_upload(owner, files[part], reuse=True)
        assert duplicate.status_code == 200, duplicate.json
        assert duplicate.json["reusedKnownFiles"] and duplicate.json["alreadyImported"]
        assert not duplicate.json["knownFilesRequiresReview"]
        assert ImportSessionVersion.query.count() == version_count
    # Same bytes after a change to the existing review context still require review.
    owner.name = 'Isolation fixture with updated event context'
    db.session.commit()
    duplicate = aut_upload(owner, files[first], reuse=True)
    assert duplicate.status_code == 200, duplicate.json
    assert duplicate.json["reusedKnownFiles"] and duplicate.json["knownFilesRequiresReview"]
    assert not duplicate.json["alreadyImported"]
    assert ImportSessionVersion.query.count() == version_count

def test_partial_import_protects_manual_requirement(owner):
    _, draft, _ = paired(owner, 'FS', 'SB', left=staff('FS', 'Double shared'),
                         right=staff('SB', 'No room'), import_first=True)
    person_id = Athlete.query.one().id
    manual = app.test_client().patch(f'/api/athletes/{person_id}', json={'accommodationRequirement': 'NO_DISPO'})
    assert manual.status_code == 200, manual.json
    joint = compose(draft, owner)
    assert joint.status_code == 200, joint.json
    assert review({'session': joint.json}, owner).status_code == 409
    assert Athlete.query.one().accommodation_requirement == 'NO_DISPO'
