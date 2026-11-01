"""Existing history only: concrete facts, controlled release, no approval effects."""
import json
import pytest
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_safe_reimport import upload, review, run
from app import app
from models import db, ImportSession, ImportSessionEvent, ImportApproval
from imports.change_plan import digest, state
from import_control import clarification_subjects

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.quota_rule_lifecycle]


@pytest.fixture
def prepared(events, monkeypatch):
    owner, other = events
    bind(owner)
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(owner.id))
    payload = upload(owner)
    return owner, other, payload


def detail(payload):
    response = app.test_client().get(f"/api/import/sessions/{payload['session']['id']}")
    assert response.status_code == 200, response.json
    return response.json


def post(payload, data):
    return app.test_client().post(f"/api/import/sessions/{payload['session']['id']}/history", json=data)


def question(payload, required=True):
    current = detail(payload)
    subject = next(s for s in current['nationClarifications']['subjects'] if s['code'].startswith('SHARED_'))
    response = post(payload, dict(clarificationAction='OPEN',versionId=current['currentVersionId'],
        subjectKey=subject['key'],subjectDigest=subject['digest'],required=required,
        comment='Nation um Bestätigung der Partnerinformation gebeten.',contactMethod='EMAIL',contactDate='2026-11-01'))
    assert response.status_code == 201, response.json
    return response.json


def resolve(payload, current, action='RESOLVE', result='CLARIFIED'):
    item = current['nationClarifications']['items'][0]
    return post(payload, dict(clarificationAction=action,versionId=current['currentVersionId'],
        questionId=item['id'],subjectDigest=item['subject']['digest'],result=result,comment='Nation hat die Angabe bestätigt.'))


def test_contact_reply_resolution_are_append_only_and_preserve_evidence(prepared):
    owner, _, payload = prepared
    session = db.session.get(ImportSession, int(payload['session']['id']))
    before = session.current_version.preview_json
    fingerprint = digest(state(owner.id, session.nation))
    approvals = [a.to_dict() for a in ImportApproval.query.all()]
    opened = question(payload)
    item = opened['nationClarifications']['items'][0]
    assert item['required'] and item['state'] == 'OPEN'
    assert session.status != 'WAITING_FOR_NATION'  # Waiting is a history-derived display.
    assert item['subject']['personKeys']
    reply = resolve(payload, opened, action='REPLY')
    assert reply.status_code == 201
    assert reply.json['nationClarifications']['items'][0]['state'] == 'OPEN'
    assert reply.json['nationClarifications']['items'][0]['replies'][0]['comment']
    denied = review(payload, owner)
    assert denied.status_code == 409 and denied.json['error'] == 'NATION_CLARIFICATION_REQUIRED'
    closed = resolve(payload, reply.json)
    assert closed.status_code == 201 and closed.json['nationClarifications']['items'][0]['state'] == 'RESOLVED'
    assert any(e['type'] == 'NATION_RESOLVED' and 'Nation hat die Angabe bestätigt.' in e['description'] for e in closed.json['history'])
    assert session.current_version.preview_json == before
    assert digest(state(owner.id, session.nation)) == fingerprint
    assert [a.to_dict() for a in ImportApproval.query.all()] == approvals
    assert run(payload, owner)['summary']['peopleCreated'] == 2
    assert session.status == 'IMPORTED'
    denied = question_after_terminal(payload)
    assert denied.status_code == 409


def question_after_terminal(payload):
    current = detail(payload)
    subject = current['nationClarifications']['subjects'][0]
    return post(payload, dict(clarificationAction='OPEN',versionId=current['currentVersionId'],
        subjectKey=subject['key'],subjectDigest=subject['digest'],required=True,comment='Nicht zulässig',contactMethod='EMAIL',contactDate='2026-11-01'))


def test_optional_question_and_legacy_waiting_note_do_not_become_new_blockers(prepared):
    owner, _, payload = prepared
    current = question(payload, required=False)
    response = post(payload, {'description':'Historischer Freitext bleibt lesbar.', 'waitingForNation':True})
    assert response.status_code == 201
    assert any(h['description']=='Historischer Freitext bleibt lesbar.' for h in response.json['history'])
    assert review(payload, owner).status_code == 200
    assert question_after_terminal(payload).status_code == 409
    assert post(payload, {'description':'Nur Notiz', 'waitingForNation':True}).status_code == 409
    assert db.session.get(ImportSession,int(payload['session']['id'])).status == 'APPROVED'


def test_identical_followup_keeps_resolution_changed_facts_reopen_and_correction_closes(prepared):
    owner, _, payload = prepared
    opened = question(payload)
    assert resolve(payload, opened).status_code == 201
    original_history = {e.id:e.description for e in ImportSessionEvent.query.all()}
    identical = upload(owner, session_id=payload['session']['id'])
    assert identical['session']['nationClarifications']['items'][0]['state'] == 'RESOLVED'
    changed = upload(owner, session_id=payload['session']['id'], changed=lambda rows:rows[0].update(Arrival_date='02.03.2027'))
    item = changed['session']['nationClarifications']['items'][0]
    assert item['state'] == 'OPEN' and item['changed']
    assert review(changed,owner).status_code == 409
    assert resolve(changed, changed['session']).status_code == 201
    corrected = upload(owner, session_id=payload['session']['id'], changed=lambda rows:rows[0].update(Room_type='No room'))
    assert corrected['session']['nationClarifications']['items'][0]['state'] == 'CORRECTED'
    assert any(h['title']=='Durch korrigierte Liste erledigt' for h in corrected['session']['history'])
    assert all(db.session.get(ImportSessionEvent,i).description==text for i,text in original_history.items())
    assert review(corrected,owner).status_code == 200


def test_stale_version_subject_duplicate_and_false_correction_are_rejected(prepared):
    _, _, payload = prepared
    opened = question(payload)
    item = opened['nationClarifications']['items'][0]
    base=dict(clarificationAction='OPEN',versionId=opened['currentVersionId'],subjectKey=item['subject']['key'],subjectDigest=item['subject']['digest'],required=True,comment='Rückfrage',contactMethod='EMAIL',contactDate='2026-11-01')
    for change in ({}, {'subjectDigest':'wrong'}, {'versionId':'wrong'}, {'comment':''}, {'contactDate':'invalid'}):
        assert post(payload,{**base,**change}).status_code == 409
    assert resolve(payload,opened,result='CORRECTED').status_code == 409
    assert ImportSessionEvent.query.filter_by(event_type='NATION_QUESTION').count() == 1


def test_clarification_never_removes_technical_errors_or_formal_approvals(prepared):
    owner, _, payload = prepared
    opened = question(payload)
    assert resolve(payload,opened).status_code == 201
    session = db.session.get(ImportSession,int(payload['session']['id']))
    db.session.add(ImportApproval(session_id=session.id,version_id=session.current_version_id,nation=session.nation,
        approval_type='TEST_REQUIRED',description='Existing formal decision',decision='PENDING',username='test-admin'))
    db.session.commit()
    assert review(payload,owner).status_code == 409
    from unittest.mock import patch
    with patch('app._current_session_preview', return_value={'errors':[{'code':'TECHNICAL_ERROR','message':'Technical error remains'}]}):
        assert app.test_client().post(f'/api/import/sessions/{session.id}/approve',json={}).status_code == 409
    preview={'people':[{'matchKey':'p'}], 'warnings':[], 'rooms':[]}
    control={'people':[], 'competitions':[], 'issues':[dict(code='QUOTA_SINGLE_ROOMS_EXCEEDED',kind='clarification',personKeys=['p'],message='Approval') ]}
    assert clarification_subjects(preview,control) == []


def test_subject_identity_ignores_rows_but_changes_with_relevant_stay_and_shared_pool_roster():
    people=[dict(matchKey='p',nationCode='CAN',function='Athlete',gender='M',competitionMemberships=[{'competitionId':'1'}])]
    preview=dict(people=people,rooms=[],warnings=[])
    control=dict(people=[dict(personKey='p',stayWindow=dict(arrivalDate='2027-03-01',departureDate='2027-03-23',outsideNights=3))],issues=[],competitions=[])
    first=clarification_subjects(preview,control)[0]
    people[0]['rowNumber']=99
    assert clarification_subjects(preview,control)[0] == first
    control['people'][0]['stayWindow']['arrivalDate']='2027-03-02'
    second=clarification_subjects(preview,control)[0]
    assert second['key']==first['key'] and second['digest']!=first['digest']
    control['competitions']=[dict(id='1',name='Slopestyle',sportEntries=[dict(nation='CAN',unverifiedAdditional=1,personKeys=['p'])])]
    before=clarification_subjects(preview,control)[1]
    preview['people'].append({**people[0],'matchKey':'q'})
    control['competitions'][0]['sportEntries'][0]['personKeys'].append('q')
    after=clarification_subjects(preview,control)[1]
    assert before['key']==after['key'] and before['digest']!=after['digest']


def test_both_confirm_paths_check_mandatory_questions(prepared):
    from datetime import datetime
    from models import Athlete
    owner, _, payload = prepared
    question(payload)
    session=db.session.get(ImportSession,int(payload['session']['id']))
    stored=json.loads(session.current_version.preview_json)
    stored['_workflow'].update(state='APPROVED',approvedDigest=stored['_workflow']['plan']['digest'],confirmedScope='FULL_NATION',destructiveConfirmed=True)
    session.current_version.preview_json=json.dumps(stored)
    session.status='APPROVED';session.approved_at=datetime.utcnow();db.session.commit()
    for path in [f'/api/import/sessions/{session.id}/import','/api/import/fis/confirm']:
        response=app.test_client().post(path,json={'previewToken':session.current_version.preview_token,'versionId':str(session.current_version_id)})
        assert response.status_code==409, response.json
        assert response.json['error']=='NATION_CLARIFICATION_REQUIRED'
    assert Athlete.query.count()==0


def test_history_actions_remain_event_scoped_and_readonly_users_cannot_write(prepared,monkeypatch):
    from models import EventAccess
    from test_import_event_identity import session as make_session
    owner, other, payload=prepared
    current=detail(payload);subject=current['nationClarifications']['subjects'][0]
    data=dict(clarificationAction='OPEN',versionId=current['currentVersionId'],subjectKey=subject['key'],subjectDigest=subject['digest'],required=True,comment='Scoped question',contactMethod='EMAIL',contactDate='2026-11-01')
    foreign=make_session(other)
    before=ImportSessionEvent.query.count()
    assert app.test_client().post(f'/api/import/sessions/{foreign.id}/history',json=data).status_code in {403,404,409}
    db.session.add(EventAccess(username='question-reader',event_id=owner.id,can_write=False));db.session.commit()
    monkeypatch.setitem(app.config,'AUTH_DEV_USER','question-reader')
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS','incoming-admin')
    assert post(payload,data).status_code==403
    assert ImportSessionEvent.query.count()==before
