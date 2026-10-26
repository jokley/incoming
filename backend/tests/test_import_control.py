"""Presentation projections cannot alter canonical import evidence or workflow."""
import json
from copy import deepcopy
from types import SimpleNamespace
import pytest
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_admin_cleanup_reference_pairs import upload_pair,approve_fixture_cases,EXPECTED
from test_safe_reimport import run,review
from app import app
from models import db,ImportSession,ImportApproval,Athlete,AthleteCompetition
from import_control import build_import_control
from imports.change_plan import input_fingerprint

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


@pytest.mark.parametrize('code',list(EXPECTED))
def test_display_and_note_preserve_original_results_confirm_and_reimport(events,code):
    a,_=events;bind(a);p=upload_pair(code,a);sid=int(p['session']['id'])
    original=db.session.get(ImportSession,sid).current_version.preview_json
    assert 'importControl' not in json.loads(original)
    assert 'importControl' not in p and 'importControl' in p['session']
    saved_approvals={row.id:row.quota_details_json for row in ImportApproval.query.all()}
    response=app.test_client().get(f'/api/import/sessions/{sid}')
    assert response.status_code==200,response.json
    assert response.json['preview']['planStale'] is False
    control=response.json['importControl'];assert len(control['people'])==EXPECTED[code][0]
    assert db.session.get(ImportSession,sid).current_version.preview_json==original
    assert {row.id:row.quota_details_json for row in ImportApproval.query.all()}==saved_approvals
    assert input_fingerprint(json.loads(original))==input_fingerprint(response.json['preview'])
    state=response.json['status']
    note=app.test_client().post(f'/api/import/sessions/{sid}/history',json={'description':'Rückfrage erfolgt · synthetischer Kontrollfall','waitingForNation':False})
    assert note.status_code==201 and note.json['status']==state
    assert db.session.get(ImportSession,sid).current_version.preview_json==original
    assert app.test_client().get(f'/api/import/sessions/{sid}').json['preview']['planStale'] is False
    approve_fixture_cases(p)
    # Even after professional approval, a non-workflow NOTE must not stale it.
    ready=review(p,a);assert ready.status_code==200,ready.json
    plan=app.test_client().get(f'/api/import/sessions/{sid}').json['preview']['changePlan']['digest']
    noted=app.test_client().post(f'/api/import/sessions/{sid}/history',json={'description':'Sachverhalt geklärt · keine Statusänderung','waitingForNation':False})
    assert noted.status_code==201 and noted.json['status']=='APPROVED'
    assert app.test_client().get(f'/api/import/sessions/{sid}').json['preview']['changePlan']['digest']==plan
    confirmed=app.test_client().post(f'/api/import/sessions/{sid}/import',json={'versionId':noted.json['currentVersionId']})
    assert confirmed.status_code==200,confirmed.json
    assert Athlete.query.count()==EXPECTED[code][0] and AthleteCompetition.query.count()==EXPECTED[code][2]
    assert Athlete.query.filter_by(accommodation_rate_category='SPECIAL').count()==(4 if code=='JPN' else 0)
    assert Athlete.query.filter_by(single_room_status='APPROVED_EXTRA').count()==({'ISR':1,'JPN':2}.get(code,0))
    repeated=upload_pair(code,a);assert repeated['session']['history']
    assert any(h['description']=='Rückfrage erfolgt · synthetischer Kontrollfall' for h in repeated['session']['history'])
    run(repeated,a)
    assert Athlete.query.count()==EXPECTED[code][0] and AthleteCompetition.query.count()==EXPECTED[code][2]


def test_fact_based_partner_hints_sources_and_title_limits_are_read_only():
    people=[dict(matchKey='a',rowNumber=2,firstname='One',lastname='Fixture',nationCode='X',function='Athlete',gender='M',roomType='Double shared',accommodationRequirement='REQUIRED',competitionMemberships=[dict(competitionId='1',quotaDiscipline='Snowboard Park & Pipe')],quotaDisciplines=['Snowboard Park & Pipe'],singleRoomQuotaExemptReason='WORLD_CHAMPION',singleRoomExemptionSource='MANUAL_SET'),
            dict(matchKey='b',rowNumber=3,firstname='Two',lastname='Fixture',nationCode='X',function='NSA Coach',gender=None,forGender='W',roomType='No room',accommodationRequirement='NO_ROOM',competitionMemberships=[],quotaDisciplines=['Snowboard Park & Pipe'])]
    data={'people':people,'rooms':[dict(rowNumber=2,roomType='Double shared',person1Key='a',person2Key='b')],'errors':[],'warnings':[]}
    context=SimpleNamespace(athletes=[],competitions_by_id={1:SimpleNamespace(name="Men's Halfpipe",gender='M')})
    before=deepcopy(data);view=build_import_control(data,context)
    assert data==before
    assert not any(i['code'].startswith('SHARED_PARTNER') for i in view['issues'])
    assert any(i['code']=='EXPLICIT_ENTRY_NO_ROOM' and i['kind']=='info' for i in view['issues'])
    assert any(i['code']=='TITLE_REFERENCE_UNCLEAR' and i['kind']=='clarification' for i in view['issues'])
    assert view['people'][1]['quotaContexts']==[{'nation':'X','group':'Snowboard Park & Pipe','gender':'M'}]  # Not raw For_gender W.
    data['rooms'][0]['person2Key']=None
    assert any(i['code']=='SHARED_PARTNER_NOT_LINKED' for i in build_import_control(data,context)['issues'])
    data['warnings']=[{'code':'ROOM_PARTNER_NOT_FOUND','message':'Raw source warning','details':{'row':2}}]
    view=build_import_control(data,context)
    assert sum(i['code'] in {'SHARED_PARTNER_NOT_LINKED','ROOM_PARTNER_NOT_FOUND'} for i in view['issues'])==1
    assert not data['errors']


def test_unmatched_room_row_is_not_attached_to_a_guessed_person():
    p={'matchKey':'a','rowNumber':2,'function':'Athlete','nationCode':'X','gender':'M','quotaDisciplines':[]}
    data={'people':[p],'rooms':[],'errors':[{'code':'ENTRY_QUOTA_GENDER_UNRESOLVED','message':'Existing error','details':{'personKey':'a'}}],
        'warnings':[{'code':'ROOM_PERSON_NOT_FOUND','message':'Unmatched row','details':{'row':2}}]}
    view=build_import_control(data,SimpleNamespace(athletes=[],competitions_by_id={}))
    assert view['issues'][0]['kind']=='error' and view['issues'][0]['personKeys']==['a']
    assert view['issues'][1]['kind']=='clarification' and view['issues'][1]['personKeys']==[]
