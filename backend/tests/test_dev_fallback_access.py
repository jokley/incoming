"""Local identity provenance, grant-free access and deployment pin isolation."""
import pytest
from app import app
from auth import load_user_from_request
from models import db, EventAccess
from test_import_event_identity import events
from test_event_accommodation_isolation import inventory

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.explicit_event_access]
HEADER = 'X-Championship-Event-ID'


@pytest.fixture
def local(inventory, monkeypatch):
    monkeypatch.setitem(app.config, 'RUNTIME_ENV', 'development')
    monkeypatch.setitem(app.config, 'AUTH_DEV_USER', 'local-admin')
    monkeypatch.setitem(app.config, 'AUTH_DEV_GROUPS', 'incoming-admin')
    monkeypatch.setitem(app.config, 'AUTH_PROXY_SECRET', '')
    monkeypatch.setitem(app.config, 'SUPERADMIN_USERNAME', '')
    return inventory


def assert_local_access(state):
    a, b, _, _, people, *_ = state
    client = app.test_client()
    for owner, persons in zip((a, b, a), (people[0], people[1], people[0])):
        headers = {HEADER: str(owner.id)}
        response = client.get('/api/active-event-context', headers=headers)
        assert response.status_code == 200, response.json
        assert {e['id'] for e in response.json['events']} == {str(a.id), str(b.id)}
        assert all(e['canRead'] and e['canWrite'] for e in response.json['events'])
        assert response.json['selectedEventId'] == str(owner.id)
        assert response.json['switchingAllowed'] is True
        response = client.get('/api/athletes', headers=headers)
        assert response.status_code == 200, response.json
        assert {p['id'] for p in response.json} == {str(p.id) for p in persons}
        response = client.put(f'/api/athletes/{persons[0].id}', headers=headers,
                              json={'internalNote': f'Local edit {owner.id}'})
        assert response.status_code == 200, response.json
    assert client.get('/api/admin/events').status_code == 200
    assert client.get('/api/admin/database/backups').status_code == 200
    assert db.session.query(EventAccess).count() == 0


def test_local_admin_without_grants_ignores_pin_and_switches(local):
    assert_local_access(local)
    assert app.config['OPERATIONAL_EVENT_ID'] == str(local[0].id)


def test_local_admin_after_restore_removes_grants(local):
    a, b, *_ = local
    db.session.add_all([EventAccess(username='local-admin', event_id=e.id, can_write=True)
                        for e in (a, b)])
    db.session.commit()
    # Simulate the relevant restore effect: grants disappear and sessions reconnect.
    db.session.query(EventAccess).delete()
    db.session.commit()
    # Keep fixture objects attached, but reload their state over fresh sockets.
    db.session.expire_all()
    db.engine.dispose()
    assert_local_access(local)


@pytest.mark.parametrize('runtime', ['development', 'test', 'production'])
@pytest.mark.parametrize('identity', ['proxy', 'header', 'secret-only', 'fallback'])
def test_only_actual_local_fallback_bypasses_grants(local, monkeypatch, runtime, identity):
    monkeypatch.setitem(app.config, 'RUNTIME_ENV', runtime)
    headers = {}
    if identity == 'proxy':
        monkeypatch.setitem(app.config, 'AUTH_PROXY_SECRET', 'verified-proxy')
        headers = {'X-Auth-Proxy-Secret': 'verified-proxy',
                   'X-Authenticated-User': 'local-admin',
                   'X-Authenticated-Groups': 'incoming-admin'}
    elif identity == 'header':
        headers = {'X-Authenticated-User': 'local-admin',
                   'X-Authenticated-Groups': 'incoming-admin'}
    elif identity == 'secret-only':
        headers = {'X-Auth-Proxy-Secret': 'unexpected-secret'}
    privileged = runtime == 'development' and identity == 'fallback'
    with app.test_request_context(headers=headers):
        user = load_user_from_request()
        assert user.username == 'local-admin'
        assert user.is_dev_admin is privileged
    client = app.test_client()
    # Pinned deployments continue to reject missing grants.
    assert client.get('/api/active-event-context', headers=headers).status_code == (200 if privileged else 403)
    assert client.get('/api/athletes', headers=headers).status_code == (200 if privileged else 403)
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', None)
    response = client.get('/api/active-event-context', headers=headers)
    assert response.status_code == 200
    assert len(response.json['events']) == (2 if privileged else 0)
    assert db.session.query(EventAccess).count() == 0


def test_fallback_viewer_still_requires_grants(local, monkeypatch):
    monkeypatch.setitem(app.config, 'AUTH_DEV_GROUPS', 'incoming-viewer')
    assert app.test_client().get('/api/active-event-context').status_code == 403
