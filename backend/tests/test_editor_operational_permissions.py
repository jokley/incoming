"""Functional roles, EventAccess and business guards remain separate."""
import pytest
from test_import_event_identity import events
from test_partial_nation_snapshots import owner, upload, snapshot
from test_safe_reimport import run, booking
from test_close_import_session import close
from app import app
from models import db, Athlete, ImportSession, ImportSessionEvent, EventAccess

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


@pytest.mark.parametrize('role,allowed',[('incoming-viewer',False),('incoming-editor',True),('incoming-admin',True)])
def test_close_roles_keep_imported_data_and_version_guards(owner,monkeypatch,role,allowed):
    payload=upload(owner,'SB');run(payload,owner)
    booking(Athlete.query.all()[:2])
    before=snapshot(Athlete.query.all())
    current=upload(owner,'SB')
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS',role)
    stale=close(current,version='not-current')
    assert stale.status_code==(409 if allowed else 403)
    result=close(current)
    assert result.status_code==(200 if allowed else 403),result.json
    assert snapshot(Athlete.query.all())==before
    session=db.session.get(ImportSession,int(current['session']['id']))
    assert (session.status=='ARCHIVED')==allowed
    assert ImportSessionEvent.query.filter_by(event_type='ARCHIVED').count()==int(allowed)
    if allowed:
        assert close(current).status_code==200
        assert app.test_client().post(f'/api/import/sessions/{session.id}/recheck',json={}).status_code==409


@pytest.mark.parametrize('role',['incoming-editor','incoming-admin'])
def test_role_never_bypasses_foreign_event_or_readonly_grant(owner,monkeypatch,role):
    from test_import_event_identity import session as make_session
    from models import Event
    current=upload(owner,'SB')
    other=Event.query.filter(Event.id!=owner.id).first();foreign=make_session(other)
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS',role)
    response=app.test_client().post(f'/api/import/sessions/{foreign.id}/archive',json={'versionId':str(foreign.current_version_id)})
    assert response.status_code in {403,404,409}
    assert foreign.status!='ARCHIVED'
    grant=EventAccess.query.filter_by(username='test-admin',event_id=owner.id).one();grant.can_write=False;db.session.commit()
    assert close(current).status_code==403
    assert db.session.get(ImportSession,int(current['session']['id'])).status!='ARCHIVED'


@pytest.mark.parametrize('role',['incoming-viewer','incoming-editor'])
@pytest.mark.parametrize('path',['/api/admin/events','/api/admin/users','/api/admin/test-data/reset','/api/admin/database/backup'])
def test_regular_roles_do_not_gain_administrative_routes(owner,monkeypatch,role,path):
    monkeypatch.setitem(app.config,'AUTH_DEV_GROUPS',role)
    assert app.test_client().post(path,json={}).status_code==403
