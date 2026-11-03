"""Whole-session archive is distinct from cancelling one review (isolated PostgreSQL)."""
import json
import pytest
from test_import_event_identity import events
from test_partial_nation_snapshots import owner, upload, compose, snapshot
from test_safe_reimport import run, review, booking
from test_nation_clarifications import question, detail
from app import app
from models import db, ImportSession, ImportSessionEvent, ImportApproval, Athlete, ImportRun
from imports.workflow import submission_heads

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.quota_rule_lifecycle]


def close(payload, version=None):
    session = payload.get('session', payload)
    return app.test_client().post(f"/api/import/sessions/{session['id']}/archive",
        json={'versionId': session['currentVersionId'] if version is None else version})


@pytest.mark.parametrize('parts', [('SB',), ('SB','FS')])
def test_close_ends_all_sources_without_rewriting_saved_evidence(owner,parts):
    for part in parts: current=upload(owner,part)
    session=db.session.get(ImportSession,int(current['session']['id']))
    saved={v.id:v.preview_json for v in session.versions}
    history=[h.to_dict() for h in session.history]
    response=close(current)
    assert response.status_code==200,response.json
    assert response.json['status']=='ARCHIVED' and response.json['submissions']==[]
    assert response.json['currentVersionId']==current['session']['currentVersionId']
    assert session.approved_at is None and session.approved_by is None
    assert {v.id:v.preview_json for v in session.versions}==saved
    assert [h.to_dict() for h in session.history if h.event_type!='ARCHIVED']==history
    repeated=close(current);assert repeated.status_code==200
    assert ImportSessionEvent.query.filter_by(event_type='ARCHIVED').count()==1
    assert submission_heads(session)=={}
    listed=app.test_client().get('/api/import/sessions').json
    assert len(listed)==1 and listed[0]['status']=='ARCHIVED' and not listed[0]['submissions']
    for path,data in [('recheck',{}),('approve',{}),('import',{'versionId':current['session']['currentVersionId']})]:
        rejected=app.test_client().post(f"/api/import/sessions/{session.id}/{path}",json=data)
        assert rejected.status_code==409,rejected.json
    assert Athlete.query.count()==0


def test_cancel_remains_a_single_review_action(owner):
    sb=upload(owner,'SB');fs=upload(owner,'FS')
    cancelled=app.test_client().post(f"/api/import/sessions/{fs['session']['id']}/cancel",json={'versionId':fs['session']['currentVersionId']})
    assert cancelled.status_code==200 and cancelled.json['status']!='ARCHIVED'
    assert [p['family'] for p in cancelled.json['submissions']]==['Snowboard']
    assert cancelled.json['currentVersionId']==sb['session']['currentVersionId']


def test_new_upload_reuses_session_without_old_sources_or_release(owner):
    sb=upload(owner,'SB');upload(owner,'FS');joint=compose(sb,owner).json
    assert review({'session':joint},owner).status_code==200
    assert close(joint).status_code==200
    new=upload(owner,'SB')
    assert new['session']['id']==sb['session']['id']
    assert new['session']['status']!='APPROVED'
    assert [s['family'] for s in new['session']['submissions']]==['Snowboard']
    session=db.session.get(ImportSession,int(sb['session']['id']))
    assert session.archived_at is None and session.approved_at is None
    assert app.test_client().post(f'/api/import/sessions/{session.id}/import',json={'versionId':new['session']['currentVersionId']}).status_code==409
    # Cancelling the new review cannot restore an old imported or pending source.
    cancelled=app.test_client().post(f'/api/import/sessions/{session.id}/cancel',json={'versionId':new['session']['currentVersionId']})
    assert cancelled.status_code==200 and cancelled.json['status']=='CANCELLED'
    assert cancelled.json['submissions']==[]


def test_imported_people_rooms_approvals_and_runs_survive_reimport_close(owner):
    initial=upload(owner,'SB');run(initial,owner)
    room=booking(Athlete.query.all()[:2]);room_type=type(room);room_id=room.id
    approval=ImportApproval(session_id=int(initial['session']['id']),version_id=int(initial['session']['currentVersionId']),
        nation='ARG',username='test-admin',approval_type='NATION_APPROVED',description='Historical decision',decision='APPROVED',comment='Preserve')
    db.session.add(approval);db.session.commit()
    before=snapshot(Athlete.query.all());decisions=[a.to_dict() for a in ImportApproval.query.all()]
    runs=[r.id for r in ImportRun.query.all()]
    upload(owner,'FS');draft=upload(owner,'SB')
    assert close(draft).status_code==200
    assert snapshot(Athlete.query.all())==before
    assert db.session.get(room_type,room_id) is not None
    assert [a.to_dict() for a in ImportApproval.query.all()]==decisions
    assert [r.id for r in ImportRun.query.all()]==runs
    # Reopening FS does not resurrect the unimported SB draft or old approval.
    new=upload(owner,'FS');assert len(new['session']['submissions'])==1
    assert new['session']['submissions'][0]['family']=='Freestyle'
    run(new,owner);assert Athlete.query.count()==11
    assert snapshot(Athlete.query.filter(Athlete.id.in_(before)).all())==before


def test_question_is_not_resolved_by_close_and_returns_on_identical_upload(owner):
    sb=upload(owner,'SB');opened=question(sb)
    original=[h.description for h in ImportSessionEvent.query.filter(ImportSessionEvent.event_type.like('NATION_%')).all()]
    assert close(sb).status_code==200
    assert not ImportSessionEvent.query.filter_by(event_type='NATION_RESOLVED').count()
    new=upload(owner,'SB');item=new['session']['nationClarifications']['items'][0]
    assert item['id']==opened['nationClarifications']['items'][0]['id'] and item['state']=='OPEN'
    assert item['required'] and item['relevant']
    assert review(new,owner).json['error']=='NATION_CLARIFICATION_REQUIRED'
    assert [h.description for h in ImportSessionEvent.query.filter(ImportSessionEvent.event_type.like('NATION_%')).all()]==original


def test_stale_close_cannot_discard_newer_upload(owner):
    sb=upload(owner,'SB');fs=upload(owner,'FS')
    denied=close(sb);assert denied.status_code==409 and denied.json['error']=='STALE_PREVIEW'
    session=db.session.get(ImportSession,int(sb['session']['id']))
    assert session.status!='ARCHIVED' and len(submission_heads(session))==2
    assert close(fs).status_code==200
    fresh=upload(owner,'SB')
    assert close(fs).status_code==409
    assert detail(fresh)['status']!='ARCHIVED'


def test_legacy_archive_without_event_has_safe_reopening_boundary(owner):
    previous=upload(owner,'FS');sb=upload(owner,'SB')
    session=db.session.get(ImportSession,int(sb['session']['id']));session.status='ARCHIVED';db.session.commit()
    new=upload(owner,'FS')
    assert [s['family'] for s in new['session']['submissions']]==['Freestyle']
    assert new['session']['submissions'][0]['versionId']!=previous['session']['currentVersionId']
    assert ImportSessionEvent.query.filter_by(event_type='ARCHIVED').count()==1


def test_close_enforces_event_and_write_access(owner,monkeypatch):
    from models import EventAccess, Event
    from test_import_event_identity import session as make_session
    current=upload(owner,'SB')
    other=Event.query.filter(Event.id!=owner.id).first();foreign=make_session(other)
    denied=app.test_client().post(f'/api/import/sessions/{foreign.id}/archive',json={'versionId':str(foreign.current_version_id)})
    assert denied.status_code in {403,404,409}
    assert foreign.status!='ARCHIVED'
    db.session.add(EventAccess(username='archive-reader',event_id=owner.id,can_write=False));db.session.commit()
    monkeypatch.setitem(app.config,'AUTH_DEV_USER','archive-reader')
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS','incoming-admin')
    assert close(current).status_code==403
    assert detail(current)['status']!='ARCHIVED'


def test_close_waits_for_atomic_confirm_instead_of_interrupting_it(owner,monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Event as Signal
    from importlib import import_module
    from flask import request
    module=import_module('app')
    payload=upload(owner,'SB');assert review(payload,owner).status_code==200
    sid=payload['session']['id'];vid=payload['session']['currentVersionId']
    inside_confirm,close_started,release=Signal(),Signal(),Signal()
    original_confirm=module.confirm_fis_import;original_lock=module.lock_accommodation_writes
    def paused_confirm(*args,**kwargs):
        inside_confirm.set()
        assert release.wait(15),'Local test did not release confirm'
        return original_confirm(*args,**kwargs)
    def observed_lock():
        if request.path.endswith('/archive'):close_started.set()
        return original_lock()
    monkeypatch.setattr(module,'confirm_fis_import',paused_confirm)
    monkeypatch.setattr(module,'lock_accommodation_writes',observed_lock)
    db.session.remove()
    def post(path):
        with app.test_client() as client:
            response=client.post(f'/api/import/sessions/{sid}/{path}',json={'versionId':vid})
            return response.status_code,response.json
    with ThreadPoolExecutor(max_workers=2) as pool:
        importing=pool.submit(post,'import')
        try:
            assert inside_confirm.wait(10)
            closing=pool.submit(post,'archive')
            assert close_started.wait(10)
            assert not closing.done()  # The existing transactional write lock is held by confirm.
        finally:release.set()
        status,result=importing.result(timeout=20);assert status==200,result
        status,result=closing.result(timeout=20);assert status==200,result
    assert Athlete.query.count()==4
    session=db.session.get(ImportSession,int(sid))
    assert session.status=='ARCHIVED' and not session.approved_at
    assert [h.event_type for h in sorted(session.history,key=lambda h:h.id)][-2:]==['IMPORTED','ARCHIVED']
