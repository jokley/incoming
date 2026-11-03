"""Schema 2 contacts use the existing endpoints, guards and isolated PostgreSQL."""
import copy
import json
import pytest
from test_import_event_identity import events
from test_event_quota_rules import bind
from test_partial_nation_snapshots import upload, rows, compose, select_submission
from test_nation_clarifications import detail, post
from test_safe_reimport import review
from app import app
from models import db, ImportSession, ImportSessionEvent, ImportApproval
from imports.change_plan import digest, state

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.quota_rule_lifecycle]


@pytest.fixture
def owner(events, monkeypatch):
    event, _ = events
    bind(event)
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(event.id))
    return event


def twelve():
    seed = rows('SB')[0]
    return [{**seed, 'Firstname': f'Synthetic{i}', 'Fiscode': str(9800100+i),
             'Competitorid/Staff ID': f'group{i}'} for i in range(12)]


def open_question(payload, target='PEOPLE', group=True, keys=None, **extra):
    current = detail(payload)
    projection = current['nationClarifications']
    selected = keys if keys is not None else [p['personKey'] for p in projection['people']]
    match = next((g for g in projection['groups'] if g['label']=='Zimmerpartner ungeklärt'), None)
    data = dict(clarificationAction='OPEN', versionId=current['currentVersionId'], targetType=target,
        selectionDigest=projection['selectionDigest'], personKeys=selected,
        groupKey=match['key'] if group and match else '', required=True, comment='Bitte Zimmerbedarf gemeinsam klären.',
        contactMethod='EMAIL', contactDate='2026-11-03')
    data.update(extra)
    return post(payload, data)


def respond(payload, current, action='RESOLVE'):
    item = current['nationClarifications']['items'][0]
    return post(payload, dict(clarificationAction=action, versionId=current['currentVersionId'],
        questionId=item['id'], subjectDigest=item['subject']['digest'], result='CLARIFIED',
        comment='12 Personen benötigen laut Nation kein Zimmer.'))


def test_twelve_people_one_question_partial_then_complete_correction(owner):
    data = twelve()
    payload = upload(owner, 'SB', data=data)
    opened = open_question(payload)
    assert opened.status_code == 201, opened.json
    item = opened.json['nationClarifications']['items'][0]
    assert len(item['subject']['personKeys']) == 12 and item['totalParts'] == 12
    assert item['subject']['automatic'] and item['state'] == 'OPEN'
    assert ImportSessionEvent.query.filter_by(event_type='NATION_QUESTION').count() == 1
    assert review(payload, owner).json['error'] == 'NATION_CLARIFICATION_REQUIRED'
    reply = respond(payload, opened.json, 'REPLY')
    assert reply.status_code == 201 and reply.json['nationClarifications']['items'][0]['state'] == 'OPEN'
    for p in data[:8]:
        p['Room_type'] = 'No room'
    partial = upload(owner, 'SB', data=data)
    item = partial['session']['nationClarifications']['items'][0]
    assert item['state'] == 'OPEN' and item['correctedParts'] == 8
    assert not ImportSessionEvent.query.filter_by(event_type='NATION_RESOLVED').count()
    # A new affected person is never appended to the fixed selection.
    data.append({**twelve()[0], 'Firstname': 'New person', 'Fiscode': '9800999', 'Competitorid/Staff ID': 'new'})
    for p in data[:12]:
        p['Room_type'] = 'No room'
    fixed = upload(owner, 'SB', data=data)
    item = fixed['session']['nationClarifications']['items'][0]
    assert item['state'] == 'CORRECTED' and item['correctedParts'] == 12
    assert len(item['subject']['personKeys']) == 12
    assert ImportSessionEvent.query.filter_by(event_type='NATION_RESOLVED').count() == 1
    again = upload(owner, 'SB', data=data)
    assert again['session']['nationClarifications']['items'][0]['state'] == 'CORRECTED'
    assert ImportSessionEvent.query.filter_by(event_type='NATION_RESOLVED').count() == 1


@pytest.mark.parametrize('target,sport', [('PEOPLE',None),('SPORT','Snowboard'),('SPORT','DISCIPLINE'),('NATION',None)])
def test_manual_questions_are_never_auto_corrected_and_replies_do_not_close(owner,target,sport):
    data = rows('SB')
    payload = upload(owner,'SB',data=data)
    if sport == 'DISCIPLINE':
        sport = detail(payload)['nationClarifications']['people'][0]['disciplines'][0]
    opened = open_question(payload,target=target,group=False,**({'sport':sport} if sport else {}))
    assert opened.status_code == 201, opened.json
    assert not opened.json['nationClarifications']['items'][0]['subject']['automatic']
    assert not opened.json['nationClarifications']['items'][0]['changed']
    replied = respond(payload,opened.json,'REPLY')
    assert replied.status_code == 201 and replied.json['nationClarifications']['items'][0]['state'] == 'OPEN'
    for p in data:
        p['Room_type']='No room'
    fixed = upload(owner,'SB',data=data)
    assert fixed['session']['nationClarifications']['items'][0]['state']=='OPEN'
    closed = respond(fixed,fixed['session'])
    assert closed.status_code==201,closed.json
    assert closed.json['nationClarifications']['items'][0]['state']=='RESOLVED'
    same=upload(owner,'SB',data=data)
    assert same['session']['nationClarifications']['items'][0]['state']=='RESOLVED'


def test_documentation_never_mutates_preview_import_state_or_approvals(owner):
    payload = upload(owner,'SB')
    session = db.session.get(ImportSession,int(payload['session']['id']))
    before = session.current_version.preview_json
    status = session.status
    fingerprint = digest(state(owner.id,'ARG'))
    approvals = [a.to_dict() for a in ImportApproval.query.all()]
    opened = open_question(payload)
    assert opened.status_code==201,opened.json
    reply=respond(payload,opened.json,'REPLY')
    assert reply.status_code==201
    closed=respond(payload,reply.json)
    assert closed.status_code==201
    current=detail(payload)
    note=post(payload,dict(clarificationAction='NOTE',versionId=current['currentVersionId'],comment='Freies Gespräch ohne Sachverhaltsbezug.',required=False))
    assert note.status_code==201,note.json
    assert session.status==status and session.current_version.preview_json==before
    assert digest(state(owner.id,'ARG'))==fingerprint
    assert [a.to_dict() for a in ImportApproval.query.all()]==approvals
    assert len(note.json['nationClarifications']['items'])==1
    assert note.json['history'][-1]['description']=='Freies Gespräch ohne Sachverhaltsbezug.'
    assert note.json['history'][-1]['type']=='NOTE'


def test_added_manual_person_disables_automatic_closure(owner):
    data=rows('SB');data[-1]['Room_type']='No room'
    payload=upload(owner,'SB',data=data)
    opened=open_question(payload)
    assert opened.status_code==201,opened.json
    assert not opened.json['nationClarifications']['items'][0]['subject']['automatic']
    for p in data:p['Room_type']='No room'
    fixed=upload(owner,'SB',data=data)
    assert fixed['session']['nationClarifications']['items'][0]['state']=='OPEN'


def test_missing_person_invalid_latest_and_source_change_are_not_corrections(owner):
    data=rows('SB');payload=upload(owner,'SB',data=data);opened=open_question(payload)
    assert opened.status_code==201
    reduced=upload(owner,'SB',data=[{**p,'Room_type':'No room'} for p in data[1:]])
    assert reduced['session']['nationClarifications']['items'][0]['state']=='OPEN'
    assert not reduced['session']['nationClarifications']['items'][0]['covered']
    broken=copy.deepcopy(data);broken[0]['Arrival_date']='invalid'
    latest=upload(owner,'SB',data=broken)
    assert latest['session']['nationClarifications']['items'][0]['state']=='OPEN'
    assert not latest['session']['nationClarifications']['items'][0]['covered']
    assert not ImportSessionEvent.query.filter_by(event_type='NATION_RESOLVED').count()


def test_scope_sb_fs_nation_and_stale_selection(owner):
    sb=upload(owner,'SB');opened=open_question(sb)
    assert opened.status_code==201
    before=detail(sb)
    fs=upload(owner,'FS')
    item=fs['session']['nationClarifications']['items'][0]
    assert item['state']=='OPEN' and not item['relevant']
    assert review(fs,owner).status_code==200
    joint=compose(fs,owner)
    assert joint.status_code==200
    assert joint.json['nationClarifications']['items'][0]['relevant']
    assert review({'session':joint.json},owner).json['error']=='NATION_CLARIFICATION_REQUIRED'
    stale=post(fs,dict(clarificationAction='OPEN',versionId=detail(fs)['currentVersionId'],targetType='NATION',
        selectionDigest=before['nationClarifications']['selectionDigest'],personKeys=[],required=True,
        comment='Stale',contactMethod='EMAIL',contactDate='2026-11-03'))
    assert stale.status_code==409


def test_validation_and_immutable_history(owner):
    payload=upload(owner,'SB');current=detail(payload)
    invalid=open_question(payload,keys=['foreign-person'])
    assert invalid.status_code==409
    assert open_question(payload,keys=[]).status_code==409
    assert open_question(payload,target='SPORT',sport='unknown').status_code==409
    assert post(payload,dict(clarificationAction='NOTE',versionId=current['currentVersionId'],comment='No blocker',required=True)).status_code==409
    opened=open_question(payload,keys=[current['nationClarifications']['people'][0]['personKey']])
    assert opened.status_code==201
    text={e.id:e.description for e in ImportSessionEvent.query.all()}
    assert respond(payload,opened.json).status_code==201
    assert all(db.session.get(ImportSessionEvent,i).description==value for i,value in text.items())
    assert all('incoming.nation-clarification' not in h['description'] for h in detail(payload)['history'])


def test_no_room_is_a_group_suggestion_not_an_open_task(owner):
    data=[{**p,'Room_type':'No room'} for p in twelve()]
    payload=upload(owner,'SB',data=data)
    projection=detail(payload)['nationClarifications']
    group=next(g for g in projection['groups'] if g['label']=='Kein Zimmer laut Entry List')
    assert len(group['personKeys'])==12 and not projection['items']
    opened=open_question(payload,groupKey=group['key'])
    assert opened.status_code==201
    assert not opened.json['nationClarifications']['items'][0]['subject']['automatic']
    again=upload(owner,'SB',data=data)
    assert again['session']['nationClarifications']['items'][0]['state']=='OPEN'


def test_grouped_questions_guard_both_confirm_routes(owner):
    from datetime import datetime
    from models import Athlete
    payload=upload(owner,'SB');opened=open_question(payload)
    assert opened.status_code==201
    session=db.session.get(ImportSession,int(opened.json['id']))
    stored=json.loads(session.current_version.preview_json)
    workflow=stored['_workflow'];workflow.update(state='APPROVED',approvedDigest=workflow['plan']['digest'],
        confirmedScope=workflow['plan']['snapshotScope'],destructiveConfirmed=True)
    session.current_version.preview_json=json.dumps(stored);session.status='APPROVED';session.approved_at=datetime.utcnow();db.session.commit()
    for path in (f'/api/import/sessions/{session.id}/import','/api/import/fis/confirm'):
        result=app.test_client().post(path,json={'previewToken':session.current_version.preview_token,'versionId':str(session.current_version_id)})
        assert result.status_code==409 and result.json['error']=='NATION_CLARIFICATION_REQUIRED',result.json
    assert Athlete.query.count()==0


def test_shared_group_requires_both_sources_and_changed_facts_reopen(owner):
    sb=upload(owner,'SB');data=rows('FS')
    for field in ('Firstname','Lastname','Fiscode','Competitorid/Staff ID'):
        data[0][field]=rows('SB')[0][field]
    fs=upload(owner,'FS',data=data)
    joint=compose(fs,owner);assert joint.status_code==200
    payload={'session':joint.json}
    key=next(p['personKey'] for p in joint.json['nationClarifications']['people'] if p['name'].startswith('SyntheticSB0'))
    opened=open_question(payload,keys=[key]);assert opened.status_code==201,opened.json
    assert set(opened.json['nationClarifications']['items'][0]['subject']['coverage']['families'])=={'Snowboard','Freestyle'}
    resolved=respond(payload,opened.json);assert resolved.status_code==201
    same=compose(fs,owner);assert same.json['nationClarifications']['items'][0]['state']=='RESOLVED'
    changed=rows('SB');changed[0]['Arrival_date']='05.03.2027'
    broken=upload(owner,'SB',data=changed)
    assert broken['session']['nationClarifications']['items'][0]['state']=='OPEN'
    assert not broken['session']['nationClarifications']['items'][0]['covered']


def test_legacy_missing_person_is_not_a_proven_correction(owner):
    from test_nation_clarifications import question
    payload=upload(owner,'SB');opened=question(payload)
    person_key=opened['nationClarifications']['items'][0]['subject']['personKeys'][0]
    name=next(p['name'] for p in opened['nationClarifications']['people'] if p['personKey']==person_key)
    reduced=upload(owner,'SB',data=[p for p in rows('SB') if f"{p['Firstname']} {p['Lastname']}" != name])
    item=reduced['session']['nationClarifications']['items'][0]
    assert item['state']=='OPEN' and not item['covered']
