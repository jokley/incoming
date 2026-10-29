"""Event-owned sport configuration through existing quota-rule APIs; no evaluation."""
from copy import deepcopy
import json
import pytest
from test_import_event_identity import events
from app import app
from models import db, Event, EventCompetition, Competition, WorldChampion, WorldChampionRecognition, EventQuotaRevision, AuditEvent, ImportSession, ImportApproval, Athlete
from quota_rules import standard_rules, rule_projection, accommodation_rule_event, rules_for_event
from test_event_quota_rules import bind, draft, fix, endpoint
from test_admin_cleanup_reference_pairs import upload_pair, approve_fixture_cases, EXPECTED
from test_safe_reimport import run
from imports.change_plan import digest, state

pytestmark = [pytest.mark.explicit_event_ownership, pytest.mark.quota_rule_lifecycle]


def prepare(owner, other):
    owner.year = 2027
    owner.is_world_championship = True
    db.session.add_all([WorldChampion(event_id=other.id, fis_code='1234567', name='Synthetic Champion', nation='CAN', gender='M',
        discipline='SS', event_group='Snowboard Park & Pipe', championship='Synthetic Edition', championship_year=2025,
        title_type='INDIVIDUAL', active=True, entitlement_enabled=False, source='https://example.test/verified-result.pdf')])
    db.session.commit()
    app.config['OPERATIONAL_EVENT_ID'] = str(owner.id)
    record = app.test_client().get(endpoint(owner)).json
    options = record['sportRuleOptions']
    by_code = {row['code']: row['id'] for row in options['competitions']}
    title = options['titles'][0]
    reference = {k: v for k, v in title.items() if k != 'name'}
    reference['sourceVerified'] = True
    def rule(code, limit=4, refs=(), pool=None):
        return dict(competitionId=by_code[code], enabled=True, regularLimit=limit, titleReferences=list(refs), poolId=pool)
    sport = dict(schemaVersion=1, enabled=True, titleEdition={'championship':'Synthetic Edition','year':2025},
        competitions=[rule('6188', refs=[reference], pool='SB SS/BA M'), rule('6182', pool='SB SS/BA M'), rule('6190', limit=3)],
        pools=[dict(id='SB SS/BA M', regularLimit=4)])
    return sport, by_code


def activate_config(owner, sport):
    current = rule_projection(owner)
    config = json.loads(owner.quota_rules_json)
    config['sportEntryRules'] = sport
    payload = dict(config=config, expectedDigest=current['digest'], expectedRevision=current['revision'],
                   isWorldChampionship=owner.is_world_championship, reason='Explicit synthetic sport configuration')
    client = app.test_client()
    preview = client.post(endpoint(owner)+'/revision-preview', json=payload)
    assert preview.status_code == 200, preview.json
    response = client.post(endpoint(owner)+'/revisions', json={**payload,'confirm':True,'confirmationDigest':preview.json['confirmationDigest']})
    assert response.status_code == 200, response.json
    return response.json


def test_draft_fix_reuse_existing_lifecycle_and_title_recognition_is_untouched(events):
    owner, other = events
    sport, _ = prepare(owner, other)
    config = {**standard_rules(), 'sportEntryRules':sport}
    saved = draft(owner, config)
    assert saved['status'] == 'DRAFT' and saved['config'] == config
    assert WorldChampionRecognition.query.count() == 0
    assert owner.world_champion_list_json is None
    assert fix(owner, saved).status_code == 200
    assert EventQuotaRevision.query.count() == 1
    assert rules_for_event(owner.id) == standard_rules()
    assert rule_projection(owner)['config']['sportEntryRules'] == sport
    assert app.test_client().put(endpoint(owner), json={'config':config,'expectedDigest':rule_projection(owner)['digest']}).status_code == 409
    old = db.session.get(EventQuotaRevision, (owner.id,1)).config_json
    disabled = deepcopy(sport);disabled['enabled'] = False
    updated = activate_config(owner, disabled)
    assert updated['revision'] == 2
    assert db.session.get(EventQuotaRevision,(owner.id,1)).config_json == old
    assert accommodation_rule_event(owner).quota_rules_revision == 1
    assert WorldChampionRecognition.query.count() == 0 and owner.world_champion_list_json is None
    assert other.quota_rules_json is None
    assert AuditEvent.query.filter_by(entity_type='event-quota-rules').count() == 3


@pytest.mark.parametrize('mutate', [
    lambda s, ids: s.update(enabled='yes'),
    lambda s, ids: s['competitions'][0].update(competitionId=ids['6180']),
    lambda s, ids: s['competitions'].append(deepcopy(s['competitions'][0])),
    lambda s, ids: s['competitions'][0].update(regularLimit=True),
    lambda s, ids: s['competitions'][0].update(regularLimit=-1),
    lambda s, ids: s['competitions'][0].update(regularLimit=4.5),
    lambda s, ids: s['competitions'][0].update(regularLimit=None),
    lambda s, ids: s['competitions'][0].update(poolId='unknown'),
    lambda s, ids: s['pools'][0].update(regularLimit=True),
    lambda s, ids: s['pools'].append(deepcopy(s['pools'][0])),
    lambda s, ids: s['competitions'][1].update(poolId=None),
    lambda s, ids: s['competitions'][1].update(competitionId=ids['8178']),
    lambda s, ids: s['competitions'][1].update(competitionId=ids['6183']),
    lambda s, ids: s['competitions'][0]['titleReferences'][0].update(sourceVerified=False),
    lambda s, ids: s['competitions'][1].update(titleReferences=deepcopy(s['competitions'][0]['titleReferences'])),
    lambda s, ids: s['competitions'][0]['titleReferences'][0].update(nation='ITA'),
    lambda s, ids: s['competitions'][0]['titleReferences'][0].update(source='https://example.test/forged.pdf'),
    lambda s, ids: s['competitions'][0].update(competitionId=ids['6182']),
    lambda s, ids: s.update(titleEdition=None),
    lambda s, ids: s.update(titleEdition={'championship':'Synthetic Edition','year':2027}),
    lambda s, ids: s.update(titleEdition={'championship':'Unknown','year':2023}),
])
def test_invalid_parameters_are_rejected_without_writes(events, mutate):
    owner, other = events
    sport, ids = prepare(owner, other)
    mutate(sport, ids)
    record = app.test_client().get(endpoint(owner)).json
    response = app.test_client().put(endpoint(owner), json={'config':{**standard_rules(),'sportEntryRules':sport}, 'expectedDigest':record['digest']})
    assert response.status_code == 400, response.json
    assert owner.quota_rules_json is None and EventQuotaRevision.query.count() == 0
    assert WorldChampionRecognition.query.count() == 0


def test_foreign_inactive_competition_and_title_snapshots_are_checked_at_activation(events):
    owner, other = events
    sport, ids = prepare(owner, other)
    mapping = EventCompetition.query.filter_by(event_id=owner.id, competition_id=int(ids['6188'])).one()
    mapping.active = False;db.session.commit()
    record = app.test_client().get(endpoint(owner)).json
    assert ids['6188'] not in {c['id'] for c in record['sportRuleOptions']['competitions']}
    r = app.test_client().put(endpoint(owner), json={'config':{**standard_rules(),'sportEntryRules':sport},'expectedDigest':record['digest']})
    assert r.status_code == 400
    mapping.active=True;db.session.commit()
    saved = draft(owner, {**standard_rules(),'sportEntryRules':sport})
    title = WorldChampion.query.one();title.source='https://example.test/changed.pdf';db.session.commit()
    assert fix(owner, saved).status_code == 400
    assert owner.quota_rules_fixed_at is None
    title.source=sport['competitions'][0]['titleReferences'][0]['source'];title.title_type='TEAM';db.session.commit()
    assert fix(owner,saved).status_code == 400
    assert other.quota_rules_json is None


@pytest.mark.parametrize('nation', list(EXPECTED))
def test_real_sport_revision_preserves_seven_nations_underlying_grants_and_fingerprints(events, nation):
    owner, other = events
    sport, _ = prepare(owner, other)
    bind(owner)
    payload = upload_pair(nation, owner);approve_fixture_cases(payload);run(payload,owner)
    again = upload_pair(nation,owner)
    sid=again['session']['id'];client=app.test_client()
    assert client.post(f'/api/import/sessions/{sid}/recheck').status_code == 200
    baseline=client.get(f'/api/import/sessions/{sid}').json
    session=db.session.get(ImportSession,int(sid));saved=session.current_version.preview_json
    original_rule=rule_projection(owner)
    original_state=digest(state(owner.id,session.nation))
    approvals={a.id:(a.quota_details_json,a.decision,a.approved_person_keys_json) for a in ImportApproval.query.all()}
    people={p.id:(p.accommodation_rate_category,p.accommodation_rate_source,p.single_room_status,p.single_room_decision_id) for p in Athlete.query.all()}
    first=activate_config(owner,sport)
    assert first['revision'] == 2
    changed=deepcopy(sport);changed['competitions'][0]['regularLimit']=5
    assert activate_config(owner,changed)['revision'] == 3
    assert rule_projection(accommodation_rule_event(owner)) == original_rule
    fresh=client.get(f'/api/import/sessions/{sid}').json
    assert fresh['preview'] == baseline['preview']
    assert fresh['importControl'] == baseline['importControl']
    assert digest(state(owner.id,session.nation)) == original_state
    assert session.current_version.preview_json == saved
    assert {a.id:(a.quota_details_json,a.decision,a.approved_person_keys_json) for a in ImportApproval.query.all()} == approvals
    assert {p.id:(p.accommodation_rate_category,p.accommodation_rate_source,p.single_room_status,p.single_room_decision_id) for p in Athlete.query.all()} == people
    assert WorldChampionRecognition.query.count() == 0 and owner.world_champion_list_json is None
    repeated=upload_pair(nation,owner)
    assert not [a for a in repeated['session']['approvals'] if a['decision']=='PENDING']
    run(repeated,owner)
    assert Athlete.query.count() == EXPECTED[nation][0]


def test_events_keep_independent_configs_and_foreign_rule_ids_are_rejected(events):
    owner, other = events
    sport, ids = prepare(owner, other)
    first = draft(owner, {**standard_rules(), 'sportEntryRules':sport})
    assert fix(owner,first).status_code == 200
    other.year = 2031;db.session.commit()
    different = deepcopy(sport);different['enabled'] = False
    different['competitions'][0]['regularLimit'] = 7
    different['competitions'][2]['regularLimit'] = 2
    second = draft(other, {**standard_rules(), 'sportEntryRules':different})
    assert fix(other,second).status_code == 200
    assert json.loads(owner.quota_rules_json)['sportEntryRules']['enabled'] is True
    assert json.loads(other.quota_rules_json)['sportEntryRules']['competitions'][0]['regularLimit'] == 7
    assert owner.quota_rules_revision == other.quota_rules_revision == 1
    # Remove the target event mapping; the same global competition still belongs to the other event.
    EventCompetition.query.filter_by(event_id=owner.id,competition_id=int(ids['6188'])).delete();db.session.commit()
    app.config['OPERATIONAL_EVENT_ID'] = str(owner.id)
    current = rule_projection(owner)
    r = app.test_client().post(endpoint(owner)+'/revision-preview',json={
        'config':{**standard_rules(),'sportEntryRules':sport},'expectedRevision':1,'expectedDigest':current['digest'],
        'isWorldChampionship':True,'reason':'Must not accept a foreign-only mapping'})
    assert r.status_code == 409
    assert owner.quota_rules_revision == 1


def test_title_identity_uses_exact_catalogue_not_display_names(events):
    owner, other = events
    sport, ids = prepare(owner, other)
    competition = db.session.get(Competition, int(ids['6188']))
    competition.display_name = 'Renamed competition';competition.name = 'Renamed official label';db.session.commit()
    saved = draft(owner, {**standard_rules(),'sportEntryRules':sport})
    assert saved['config']['sportEntryRules'] == sport
    competition.sport = 'Freeski';db.session.commit()
    response = app.test_client().put(endpoint(owner), json={
        'config':saved['config'],'expectedDigest':saved['digest']})
    assert response.status_code == 400
    assert json.loads(owner.quota_rules_json)['sportEntryRules'] == sport


def test_reading_options_does_not_adopt_or_enable_sport_rules(events):
    owner, other = events
    prepare(owner,other);bind(owner)
    original = owner.quota_rules_json
    data = app.test_client().get(endpoint(owner)).json
    assert len(data['sportRuleOptions']['competitions']) == 31
    assert sum(bool(c['titleDiscipline']) for c in data['sportRuleOptions']['competitions']) == 26
    assert 'sportEntryRules' not in data['config']
    assert 'sportEntryRules' not in data['standardProposal']
    assert owner.quota_rules_json == original
    assert EventQuotaRevision.query.count() == 0
    assert WorldChampionRecognition.query.count() == 0
