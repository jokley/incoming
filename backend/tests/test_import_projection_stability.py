"""Stable saved/transient review evidence through real preview/approve/confirm routes."""
import pytest
from app import app
from models import db, ImportSession
from imports.change_plan import input_fingerprint, encoded, digest, state
from imports.workflow import load_version_preview
from test_import_event_identity import events
from test_safe_reimport import upload, run


@pytest.mark.parametrize('revision,legacy_revision', [(1, False), (1, True), (2, False)])
def test_four_lat_people_stay_current_through_refresh_approval_confirm(events, monkeypatch, revision, legacy_revision):
    event, _ = events
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(event.id))
    if revision == 2:
        from test_freeze_acceptance import activate
        assert activate(event, lambda c: c['officials'].update(allowance=3)).status_code == 200
    pending = upload(event, codes=('9300001', '9300002', '9300003', '9300004'),
                     changed=lambda rows: [r.update(Nationcode='LAT') for r in rows])
    session = db.session.get(ImportSession, int(pending['session']['id']))
    saved = load_version_preview(session.current_version)
    assert saved['quotaRulesRevision'] == event.quota_rules_revision == revision
    if legacy_revision:
        # Exact pre-fix persisted representation; do not migrate its approval evidence.
        saved.pop('quotaRulesRevision')
        plan = saved['_workflow']['plan']
        plan['inputFingerprint'] = input_fingerprint(saved)
        plan['digest'] = digest({k: v for k, v in plan.items() if k != 'digest'})
        session.current_version.preview_json = encoded(saved)
        db.session.commit()
    original_json = session.current_version.preview_json
    original_state = digest(state(event.id, 'LAT'))
    client = app.test_client()
    for _ in range(3):
        assert client.get('/api/import/sessions').status_code == 200
        result = client.get(f'/api/import/sessions/{session.id}')
        assert result.status_code == 200
        assert result.json['preview']['planStale'] is False
        assert result.json['preview']['quotaRulesChanged'] is False
    assert session.current_version.preview_json == original_json
    assert digest(state(event.id, 'LAT')) == original_state
    approved = client.post(f'/api/import/sessions/{session.id}/approve', json={
        'planDigest': saved['_workflow']['plan']['digest']})
    assert approved.status_code == 200, approved.json
    assert approved.json['preview']['planStale'] is False
    assert digest(state(event.id, 'LAT')) == original_state
    confirmed = client.post(f'/api/import/sessions/{session.id}/import',
                            json={'versionId': session.current_version_id})
    assert confirmed.status_code == 200, confirmed.json
    assert confirmed.json['summary']['peopleCreated'] == 4


def test_other_nation_upload_does_not_invalidate_lat(events, monkeypatch):
    event, _ = events
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(event.id))
    lat = upload(event, changed=lambda rows: [r.update(Nationcode='LAT') for r in rows])
    run(upload(event, codes=('9400001', '9400002')), event)
    result = app.test_client().get(f"/api/import/sessions/{lat['session']['id']}")
    assert result.status_code == 200
    assert result.json['preview']['planStale'] is False


def test_legacy_compatibility_does_not_mask_real_rule_revision(events, monkeypatch):
    from test_freeze_acceptance import activate
    event, _ = events
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', str(event.id))
    pending = upload(event)
    session = db.session.get(ImportSession, int(pending['session']['id']))
    saved = load_version_preview(session.current_version)
    saved.pop('quotaRulesRevision')
    plan = saved['_workflow']['plan']
    plan['inputFingerprint'] = input_fingerprint(saved)
    plan['digest'] = digest({k: v for k, v in plan.items() if k != 'digest'})
    session.current_version.preview_json = encoded(saved)
    db.session.commit()
    client = app.test_client()
    approved = client.post(f'/api/import/sessions/{session.id}/approve', json={'planDigest': plan['digest']})
    assert approved.status_code == 200, approved.json
    assert activate(event, lambda c: c['officials'].update(allowance=3)).status_code == 200
    result = client.get(f'/api/import/sessions/{session.id}')
    assert result.json['preview']['planStale'] is True
    assert result.json['preview']['quotaRulesChanged'] is True
    rejected = client.post(f'/api/import/sessions/{session.id}/import', json={'versionId': session.current_version_id})
    assert rejected.status_code == 409
    assert rejected.json['error'] == 'QUOTA_RULES_CHANGED'
