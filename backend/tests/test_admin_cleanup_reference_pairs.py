"""Cleanup regression: anonymized seven-pair HTTP acceptance.

Original files/mapping never enter Git. Counts were independently measured on
original uploads with the current catalogue and explicit standard WM rules.
Test approvals below are hypothetical fixture decisions, never real approvals.
"""
import io,json
from pathlib import Path
from collections import Counter
import pandas as pd
import pytest
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_safe_reimport import run, review
from app import app
from models import db,Athlete,AthleteCompetition,ImportSession,ImportApproval,RoomBooking,RoomBookingOccupant,Hotel,RoomType,HotelRoomInventory

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]
FIXTURES=Path(__file__).parent/'fixtures/go_live_reference'
# people, athletes, exact Competition memberships, parsed room requests, NO_ROOM
EXPECTED={'ITA':(24,10,86,13,2),'NZL':(26,15,71,11,15),'ISR':(2,1,4,2,0),
          'JPN':(64,40,147,61,1),'GER':(21,17,29,0,21),'KOR':(26,15,75,16,1),'USA':(45,28,131,28,0)}


def upload_pair(code,event):
    fixture=json.loads((FIXTURES/f'{code}.json').read_text());files={}
    for kind,field in [('entries','entriesList'),('rooms','roomListDetailed')]:
        data=fixture[kind];stream=io.BytesIO()
        pd.DataFrame(data['rows'],columns=data['columns']).to_excel(stream,index=False,sheet_name='Data');stream.seek(0)
        files[field]=(stream,f'ENTRIES-{kind.upper()}-{code}.xlsx')
    response=app.test_client().post('/api/import/fis/preview',data={'eventId':str(event.id),'createSession':'true',**files})
    assert response.status_code==200,response.json
    return response.json


def approve_fixture_cases(payload):
    """Explicit synthetic approval evidence, with separate EZ and athlete scopes."""
    sid=payload['session']['id'];people=payload['people']
    while True:
        session=app.test_client().get(f'/api/import/sessions/{sid}').json
        tasks=[a for a in session['approvals'] if a['decision']=='PENDING']
        if not tasks:return
        task=tasks[0];details=task['quotaDetails']
        extra={}
        if details.get('decisionKind')=='ATHLETE_QUOTA':
            extent=details['uncoveredExtent'];assert extent=={'total':4,'M':3,'F':0}
            male=[p['matchKey'] for p in people if p['function']=='Athlete' and p['gender']=='M' and p['accommodationRequirement']!='NO_ROOM']
            female=[p['matchKey'] for p in people if p['function']=='Athlete' and p['gender'] in {'W','F'} and p['accommodationRequirement']!='NO_ROOM']
            keys=male[:3]+female[:1];extra={'approvedExtent':extent,'tariffEffect':'SPECIAL_SELECTED'}
        else:keys=[p['personKey'] for p in details['singleRoomCandidates'][:details['excessCount']]]
        response=app.test_client().patch(f"/api/import/sessions/{sid}/approvals/{task['id']}",json={
            'decision':'APPROVED','approvalType':'NATION_APPROVED','approvalMethod':'EMAIL',
            'approvalBy':'Synthetic regression only','approvalDate':'2026-10-26T12:00:00Z','approvedPersonKeys':keys,**extra})
        assert response.status_code==200,response.json


@pytest.mark.parametrize('code',list(EXPECTED))
def test_reference_pair_preview_confirm_and_identical_reimport(events,code):
    a,_=events;bind(a);payload=upload_pair(code,a)
    people=payload['people'];expected=EXPECTED[code]
    actual=(len(people),sum(p['function']=='Athlete' for p in people),sum(len(p['competitionIds']) for p in people),len(payload['rooms']),sum(p['accommodationRequirement']=='NO_ROOM' for p in people))
    assert payload['isValid'] and payload['errors']==[]
    assert actual==expected
    family=payload['athleteQuotaChecks'][0]
    assert family['athleteQuotaUsed']==expected[1]  # NO_ROOM is not quota exemption.
    assert family['athleteGenderUsed']=={'ITA':{'M':6,'F':4},'NZL':{'M':10,'F':5},'ISR':{'M':0,'F':1},'JPN':{'M':23,'F':17},'GER':{'M':10,'F':7},'KOR':{'M':10,'F':5},'USA':{'M':14,'F':14}}[code]
    if code=='ITA':
        overview=payload['quotaOverview']['nations'][0]
        assert overview['officials']==14 and overview['officialsInMultipleGroups']==5
        assert {g['name']:g['officials'] for g in overview['groups']}=={'Freeski Park & Pipe':9,'Ski Cross':10}
    assert len({p['matchKey'] for p in people})==expected[0]
    assert all(p['accommodationRateCategory']=='STANDARD' for p in people)
    for room in payload['rooms']:
        assert room['person1Key'] in {p['matchKey'] for p in people}
        if room.get('person2Key'):assert room['person2Key'] in {p['matchKey'] for p in people}
    assert not any(w['code'] in {'ROOM_PARTNER_NOT_FOUND','ROOM_PERSON_NOT_FOUND'} for w in payload['warnings'])
    if code=='GER':
        assert any(w['code']=='ROOM_LIST_NO_DATA' for w in payload['warnings'])
        # These actual Entries explicitly say No room. The empty Room List
        # alone does not manufacture it; existing empty-Room-List tests cover that.
        assert all(p['roomType']=='No room' for p in people)
    expected_decisions={'ISR':Counter({'SINGLE_ROOM':1}),'JPN':Counter({'SINGLE_ROOM':1,'ATHLETE_QUOTA':1})}.get(code,Counter())
    assert Counter(t['quotaDetails'].get('decisionKind') for t in payload['session']['approvals'])==expected_decisions
    if expected_decisions:assert review(payload,a).status_code==409
    approve_fixture_cases(payload);result=run(payload,a)
    assert result['summary']['peopleCreated']==expected[0]
    assert Athlete.query.count()==expected[0] and AthleteCompetition.query.count()==expected[2]
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    maps=_build_existing_athlete_maps(event_id=a.id)
    for person in people:
        persisted=_find_existing_athlete(person,maps)
        assert persisted is not None
        assert {str(c.id) for c in persisted.competitions}==set(person['competitionIds'])
    assert RoomBooking.query.count()==0  # Room request is not a hotel assignment.
    assert Athlete.query.filter_by(accommodation_rate_category='SPECIAL').count()==(4 if code=='JPN' else 0)
    assert Athlete.query.filter_by(single_room_status='APPROVED_EXTRA').count()==({'ISR':1,'JPN':2}.get(code,0))
    assert len(app.test_client().get('/api/athletes').json)==expected[0]
    planning=app.test_client().get('/api/assignments/planning-view?includeValidations=false').json
    queued={p['athleteId'] for unit in planning['units']['unassigned'] for p in unit['occupants']}
    demand={str(p.id) for p in Athlete.query.all() if p.accommodation_requirement!='NO_ROOM'}
    assert queued==demand
    repeated=upload_pair(code,a)
    assert all(p['operation']=='update' for p in repeated['people'])
    assert not [t for t in repeated['session']['approvals'] if t['decision']=='PENDING']
    run(repeated,a)
    assert Athlete.query.count()==expected[0] and AthleteCompetition.query.count()==expected[2]



@pytest.mark.parametrize('code',list(EXPECTED))
def test_nation_cleanup_then_same_anonymized_fis_pair_imports_fresh(events,code):
    a,_=events;bind(a);payload=upload_pair(code,a);approve_fixture_cases(payload);run(payload,a)
    removed=app.test_client().post('/api/admin/test-data/reset',json={'scope':'nation','nation':json.loads((FIXTURES/f'{code}.json').read_text())['nation'],'confirmed':True})
    assert removed.status_code==200,removed.json
    assert Athlete.query.count()==0 and ImportSession.query.count()==0
    fresh=upload_pair(code,a)
    assert fresh['summary']['people']['wouldCreate']==EXPECTED[code][0]
    approve_fixture_cases(fresh);run(fresh,a)
    assert Athlete.query.count()==EXPECTED[code][0] and AthleteCompetition.query.count()==EXPECTED[code][2]
