"""Future sport-only revisions simulated in disposable DB; no new config API."""
from datetime import timedelta
import json
import pytest
from sqlalchemy import update
from test_import_event_identity import events
from app import app
from models import (db, Event, EventQuotaRevision, ImportApproval, ImportSession,
                    ImportSessionVersion, Athlete, RoomBooking, RoomBookingOccupant)
from quota_rules import (accommodation_rule_event, rule_projection, revision_snapshot,
                         rules_for_event, standard_rules, validate_rules)
from imports.change_plan import digest, state, input_fingerprint
from imports.workflow import require_review
from test_event_quota_rules import bind
from test_admin_cleanup_reference_pairs import upload_pair, approve_fixture_cases, EXPECTED
from test_safe_reimport import run, booking, upload
from test_freeze_acceptance import activate

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.quota_rule_lifecycle]


def simulate_revision(event, sport, accommodation=None, world=None):
    """Test-only storage fixture: production validator still rejects sport rules."""
    if not db.session.get(EventQuotaRevision, (event.id, event.quota_rules_revision)):
        db.session.add(revision_snapshot(event, 'Original fixture evidence'))
        db.session.flush()
    config = json.loads(event.quota_rules_json)
    if sport is None:
        config.pop('sportEntryRules', None)
    else:
        config['sportEntryRules'] = sport
    if accommodation:
        accommodation(config)
    db.session.execute(update(Event).where(Event.id == event.id).values(
        quota_rules_json=json.dumps(config, sort_keys=True),
        quota_rules_revision=event.quota_rules_revision + 1,
        quota_rules_fixed_at=event.quota_rules_fixed_at + timedelta(days=1),
        quota_rules_fixed_by='Synthetic sport-only administrator',
        is_world_championship=event.is_world_championship if world is None else world))
    db.session.refresh(event)
    db.session.add(revision_snapshot(event, 'Simulated future revision; not exposed by API'))
    db.session.commit()


def records(model):
    return [{c.name: getattr(row, c.name) for c in model.__table__.columns}
            for row in model.query.order_by(*model.__table__.primary_key.columns)]


@pytest.mark.parametrize('nation,source_revision', [(n, 1) for n in EXPECTED] + [('ISR', 2), ('JPN', 2)])
def test_sport_only_revision_keeps_seven_nations_grants_fingerprints_and_reimport(events, nation, source_revision):
    owner, other = events
    owner.year = 2027
    owner.is_world_championship = True
    bind(owner)
    if source_revision == 2:
        assert activate(owner, lambda c: c['athletes']['Freestyle'].update(totalLimit=38)).status_code == 200
    payload = upload_pair(nation, owner)
    approve_fixture_cases(payload)
    run(payload, owner)
    # Include real, already assigned accommodation and its unchanged occupants.
    occupants = Athlete.query.filter_by(event_id=owner.id, accommodation_requirement='REQUIRED').order_by(Athlete.id).limit(2).all()
    if occupants and not ImportApproval.query.filter_by(decision='APPROVED').first():
        booking(occupants)
    repeated = upload_pair(nation, owner)
    sid = repeated['session']['id']
    session = db.session.get(ImportSession, int(sid))
    client = app.test_client()
    # Establish the existing explicit review BEFORE any simulated rule change.
    checked = client.post(f'/api/import/sessions/{sid}/recheck')
    assert checked.status_code == 200, checked.json
    before = client.get(f'/api/import/sessions/{sid}').json
    assert not before['preview']['planStale']
    nation_code = session.nation
    evidence = digest(state(owner.id, nation_code))
    saved = session.current_version.preview_json
    fingerprint = input_fingerprint(json.loads(saved))
    tables = {model: records(model) for model in
              (Athlete, ImportApproval, ImportSessionVersion, RoomBooking, RoomBookingOccupant)}
    operational = client.get('/api/quota-rules').json
    family = client.get('/api/fis/athlete-quotas').json
    officials = client.get('/api/fis/official-quotas').json
    untouched_event = other.quota_rules_json, other.quota_rules_revision
    original = rule_projection(owner)
    original_config = owner.quota_rules_json
    simulate_revision(owner, {'syntheticLimit': 4})
    history = records(EventQuotaRevision)
    simulate_revision(owner, {'syntheticLimit': 7})
    assert records(EventQuotaRevision)[:len(history)] == history
    assert owner.quota_rules_revision == source_revision + 2
    effective = accommodation_rule_event(owner)
    assert rule_projection(effective) == original  # digest, revision, fixedAt AND fixedBy
    assert effective.quota_rules_json == original_config
    assert rule_projection(accommodation_rule_event(effective)) == original
    assert client.get('/api/quota-rules').json == operational
    assert client.get('/api/fis/athlete-quotas').json == family
    assert client.get('/api/fis/official-quotas').json == officials
    fresh = client.get(f'/api/import/sessions/{sid}').json
    assert fresh['preview'] == before['preview']
    assert not fresh['preview']['planStale'] and not fresh['preview']['quotaRulesChanged']
    assert fresh['approvals'] == before['approvals']
    assert fresh['importControl'] == before['importControl']  # WM-2027 sport code unchanged
    assert digest(state(owner.id, nation_code)) == evidence
    assert session.current_version.preview_json == saved
    assert input_fingerprint(json.loads(saved)) == fingerprint
    require_review(session)
    for model, rows in tables.items():
        assert records(model) == rows
    assert (other.quota_rules_json, other.quota_rules_revision) == untouched_event
    # A fresh identical file upload also retains the existing grant scopes.
    again = upload_pair(nation, owner)
    assert not [row for row in again['session']['approvals'] if row['decision'] == 'PENDING']
    if nation == 'JPN':
        assert again['athleteQuotaChecks'][0]['decisionStatus'] == 'APPROVED'
    result = run(again, owner)
    assert result['summary']['peopleCreated'] == result['summary']['peopleUpdated'] == 0
    for original_person, person in zip(tables[Athlete], records(Athlete)):
        changes = {k: (original_person[k], person[k]) for k in person
                   if original_person[k] != person[k] and k not in {
                       'updated_at', 'athletes_last_seen_at', 'roomlist_last_seen_at'}}
        if 'single_room_decision_id' in changes:
            old_id, new_id = changes.pop('single_room_decision_id')
            preserved = db.session.get(ImportApproval, new_id)
            assert preserved.approval_type == 'PRESERVED_APPROVED_EXTRA'
            assert preserved.decision == db.session.get(ImportApproval, old_id).decision == 'APPROVED'
            assert old_id in {p['decisionId'] for p in json.loads(preserved.quota_details_json)['preservedApprovedPeople']}
        assert not changes, changes
    assert records(RoomBooking) == tables[RoomBooking]
    assert records(RoomBookingOccupant) == tables[RoomBookingOccupant]


@pytest.mark.parametrize('change', [
    lambda c: c['officials'].update(allowance=3),
    lambda c: c['athletes']['Snowboard'].update(totalLimit=35),
    lambda c: c['singleRooms'][-1].update(rooms=4),
])
def test_real_accommodation_revision_after_sport_still_invalidates_review(events, change):
    owner, _ = events
    bind(owner)
    payload = upload(owner)
    session = db.session.get(ImportSession, int(payload['session']['id']))
    saved = session.current_version.preview_json
    before = digest(state(owner.id, 'JPN'))
    simulate_revision(owner, {'syntheticLimit': 4})
    simulate_revision(owner, {'syntheticLimit': 8}, change)
    assert accommodation_rule_event(owner).quota_rules_revision == 3
    with pytest.raises(Exception, match='Quotenregeln wurden geändert'):
        require_review(session)
    assert digest(state(owner.id, 'JPN')) != before
    current = app.test_client().get(f'/api/import/sessions/{session.id}').json
    assert current['preview']['planStale'] and current['preview']['quotaRulesChanged']
    assert session.current_version.preview_json == saved
    # Following sport-only edit retains the REAL accommodation revision 3, not 1.
    simulate_revision(owner, {'syntheticLimit': 9})
    assert accommodation_rule_event(owner).quota_rules_revision == 3
    with pytest.raises(Exception, match='Quotenregeln wurden geändert'):
        require_review(session)
    # Returning to old numeric parameters is still a NEW accommodation decision.
    simulate_revision(owner, {'syntheticLimit': 10}, lambda c: c.update(standard_rules()))
    assert accommodation_rule_event(owner).quota_rules_revision == 5
    with pytest.raises(Exception, match='Quotenregeln wurden geändert'):
        require_review(session)


def test_sport_section_removal_and_world_flag_are_not_confused(events):
    owner, _ = events
    bind(owner)
    original = rule_projection(owner)
    simulate_revision(owner, {'syntheticLimit': 4})
    simulate_revision(owner, None)
    assert rule_projection(accommodation_rule_event(owner)) == original
    simulate_revision(owner, {'syntheticLimit': 4}, world=True)
    assert accommodation_rule_event(owner).quota_rules_revision == 4
    assert accommodation_rule_event(owner).is_world_championship is True


def test_no_sport_configuration_api_or_weakening_of_unknown_parameter_validation(events):
    owner, _ = events
    config = standard_rules()
    config['sportEntryRules'] = {'syntheticLimit': 4}
    with pytest.raises(ValueError, match='Quotenparameter'):
        validate_rules(config)
    app.config['OPERATIONAL_EVENT_ID'] = str(owner.id)
    url = f'/api/admin/events/{owner.id}/quota-rules'
    record = app.test_client().get(url).json
    response = app.test_client().put(url, json={
        'config': config, 'expectedDigest': record['digest'], 'isWorldChampionship': False})
    assert response.status_code == 400
    assert owner.quota_rules_json is None


def test_legacy_and_real_revision_keep_their_original_metadata(events):
    owner, _ = events
    bind(owner)
    assert accommodation_rule_event(owner) is owner
    assert activate(owner, lambda c: c['officials'].update(allowance=3)).status_code == 200
    assert accommodation_rule_event(owner) is owner
    assert rules_for_event(owner.id)['officials']['allowance'] == 3
    original = rule_projection(owner)
    simulate_revision(owner, {'syntheticLimit': 4})
    assert rule_projection(accommodation_rule_event(owner)) == original


def test_fingerprint_uses_fresh_sql_event_even_when_orm_row_is_cached(events):
    owner, _ = events
    bind(owner)
    before = digest(state(owner.id, 'JPN'))
    config = standard_rules()
    config['officials']['allowance'] = 3
    db.session.execute(update(Event).where(Event.id == owner.id).values(
        quota_rules_json=json.dumps(config)).execution_options(synchronize_session=False))
    assert json.loads(owner.quota_rules_json)['officials']['allowance'] == 2
    assert digest(state(owner.id, 'JPN')) != before
    db.session.rollback()


def test_missing_history_never_silently_reuses_an_older_accommodation_scope(events):
    owner, _ = events
    bind(owner)
    # Deliberately incomplete synthetic future storage, never an allowed API write.
    config = standard_rules()
    config['sportEntryRules'] = {'syntheticLimit': 4}
    db.session.execute(update(Event).where(Event.id == owner.id).values(
        quota_rules_json=json.dumps(config), quota_rules_revision=3))
    db.session.refresh(owner)
    with pytest.raises(Exception, match='Regelhistorie fehlt'):
        accommodation_rule_event(owner)
    db.session.rollback()
