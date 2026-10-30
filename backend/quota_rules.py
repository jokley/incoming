"""Small versioned event policy: validated parameters, never executable formulas."""
import copy
import hashlib
import json

FAMILIES = ('Snowboard', 'Freestyle')  # Persisted/API names retained.


def standard_rules():
    return {'schemaVersion': 1, 'athletes': {family: {'enabled': True, 'totalLimit': 36, 'genderLimit': 20}
            for family in FAMILIES}, 'officials': {'model': 'ATHLETES_PLUS', 'allowance': 2},
            'singleRooms': [{'upTo': 3, 'rooms': 1}, {'upTo': 6, 'rooms': 2}, {'upTo': None, 'rooms': 3}]}


def fingerprint(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':'), default=str).encode()).hexdigest()


def validate_rules(value, event_id=None):
    def keys(obj, expected):
        if not isinstance(obj, dict) or set(obj) != set(expected):
            raise ValueError('Unvollständige oder unbekannte Quotenparameter.')
    def number(value):
        if type(value) is not int or not 0 <= value <= 10000:
            raise ValueError('Quotenwerte müssen ganze Zahlen von 0 bis 10000 sein.')
    keys(value, ('schemaVersion', 'athletes', 'officials', 'singleRooms',
                 *(['sportEntryRules'] if isinstance(value, dict) and 'sportEntryRules' in value else [])))
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('Unbekannte Regelversion.')
    keys(value['athletes'], FAMILIES)
    for rule in value['athletes'].values():
        keys(rule, ('enabled', 'totalLimit', 'genderLimit'))
        if type(rule['enabled']) is not bool:
            raise ValueError('Aktivierung muss boolesch sein.')
        number(rule['totalLimit']); number(rule['genderLimit'])
        if rule['genderLimit'] > rule['totalLimit']:
            raise ValueError('Geschlechterlimit darf Gesamtlimit nicht überschreiten.')
    keys(value['officials'], ('model', 'allowance'))
    if value['officials']['model'] != 'ATHLETES_PLUS':
        raise ValueError('Nicht unterstütztes Officials-Modell.')
    number(value['officials']['allowance'])
    tiers = value['singleRooms']
    if not isinstance(tiers, list) or not 1 <= len(tiers) <= 12:
        raise ValueError('Eine bis zwölf EZ-Stufen erforderlich.')
    previous, previous_rooms = 0, 0
    for index, tier in enumerate(tiers):
        keys(tier, ('upTo', 'rooms')); number(tier['rooms'])
        if tier['rooms'] < previous_rooms:
            raise ValueError('EZ-Ansprüche müssen aufsteigend sein.')
        previous_rooms = tier['rooms']
        if tier['upTo'] is None:
            if index != len(tiers)-1:
                raise ValueError('Offene EZ-Stufe muss die letzte sein.')
        else:
            number(tier['upTo'])
            if tier['upTo'] <= previous or index == len(tiers)-1:
                raise ValueError('EZ-Schwellen müssen steigen und mit einer offenen Stufe enden.')
            previous = tier['upTo']
    result = copy.deepcopy(value)
    if 'sportEntryRules' in result:
        result['sportEntryRules'] = validate_sport_entry_rules(result['sportEntryRules'], event_id)
    return result


def rule_projection(event):
    config = json.loads(event.quota_rules_json) if event.quota_rules_json else None
    return {'status': 'FIXED' if event.quota_rules_fixed_at else 'DRAFT', 'config': config,
            'digest': fingerprint({'config':config,'isWorldChampionship':event.is_world_championship}), 'revision': event.quota_rules_revision,
            'fixedAt': event.quota_rules_fixed_at.isoformat()+'Z' if event.quota_rules_fixed_at else None,
            'fixedBy': event.quota_rules_fixed_by}


def accommodation_rule_event(event):
    """Read accommodation evidence from existing revisions; never change an Event.

    Only the reserved sportEntryRules section may be irrelevant to this evidence.
    Administration validates the sport section separately; this reader never evaluates it.
    """
    if not event or not getattr(event, 'quota_rules_json', None) or not event.quota_rules_fixed_at:
        return event
    config = json.loads(event.quota_rules_json)
    if event.quota_rules_revision <= 1 and 'sportEntryRules' not in config:
        return event
    from flask import g, has_request_context
    key = (event.id, event.quota_rules_json, event.quota_rules_revision,
           event.quota_rules_fixed_at, event.quota_rules_fixed_by, event.is_world_championship)
    cache = g.setdefault('_accommodation_rule_events', {}) if has_request_context() else {}
    if key in cache:
        return cache[key] or event
    from models import Event, EventQuotaRevision
    from types import SimpleNamespace
    def accommodation(config):
        return {k: v for k, v in config.items() if k != 'sportEntryRules'}
    selected = None
    revision = event.quota_rules_revision
    history = EventQuotaRevision.query.filter(
            EventQuotaRevision.event_id == event.id,
            EventQuotaRevision.revision < revision).order_by(EventQuotaRevision.revision.desc()).all()
    from imports.event_context import ImportValidationError
    if not history and revision > 1 and 'sportEntryRules' in config:
        raise ImportValidationError('QUOTA_RULE_HISTORY_MISSING', 'Vorherige fixierte Regelhistorie fehlt.')
    for previous in history:
        if previous.revision != revision - 1:
            if 'sportEntryRules' in config:
                raise ImportValidationError('QUOTA_RULE_HISTORY_MISSING', 'Vorherige fixierte Regelhistorie fehlt.')
            break
        prior = json.loads(previous.config_json)
        if (previous.is_world_championship != event.is_world_championship
                or accommodation(prior) != accommodation(config)
                or ('sportEntryRules' not in prior and 'sportEntryRules' not in config)):
            break
        selected, config, revision = previous, prior, previous.revision
    if selected is None and 'sportEntryRules' not in config:
        cache[key] = None  # Do not retain a mutable ORM object under an old revision key.
        return event
    data = {column.name: getattr(event, column.name) for column in Event.__table__.columns}
    raw = selected.config_json if selected else event.quota_rules_json
    data.update(quota_rules_json=raw if 'sportEntryRules' not in config else json.dumps(accommodation(config), sort_keys=True),
                quota_rules_revision=revision,
                quota_rules_fixed_at=selected.activated_at if selected else event.quota_rules_fixed_at,
                quota_rules_fixed_by=selected.activated_by if selected else event.quota_rules_fixed_by)
    cache[key] = SimpleNamespace(**data)
    return cache[key]


def rules_for_event(event_id=None):
    from models import Event, db
    from imports.event_context import import_event_id, ImportValidationError
    from flask import g,has_request_context
    owner=import_event_id(event_id)
    cached=getattr(g,'_quota_event_record',None) if has_request_context() else None
    event = cached if cached is not None and cached.id==owner else db.session.get(Event,owner)
    if not event or not event.quota_rules_fixed_at or not event.quota_rules_json:
        raise ImportValidationError('EVENT_QUOTA_RULES_NOT_FIXED', 'Quotenregeln sind noch nicht verbindlich festgelegt.')
    return validate_rules(json.loads(accommodation_rule_event(event).quota_rules_json))


def evaluation_rules(rules=None):
    if rules is not None:
        return rules
    from flask import has_app_context
    # Standalone mathematical helpers retain explicit historical standards;
    # every operational Flask evaluation requires its configured event policy.
    return rules_for_event() if has_app_context() else standard_rules()


def examples(config):
    from fis_rules import compute_official_quota, compute_single_room_entitlement
    basis = compute_official_quota(4, config['officials']['allowance'])
    rooms=compute_single_room_entitlement(basis, config['singleRooms'])
    lower=1;scale=[]
    for tier in config['singleRooms']:
        scale.append(f"{lower}–{tier['upTo']} Officials → {tier['rooms']} EZ" if tier['upTo'] is not None else f"ab {lower} Officials → {tier['rooms']} EZ")
        if tier['upTo'] is not None:lower=tier['upTo']+1
    return {'athletes':4,'officials':basis,'singleRooms':rooms,'scale':scale,
        'rows':[{'name':name,'used':used,'covered':used<=rooms,'progress':min(used/max(1,rooms),1)*100,
                 'label':f'{used} / {rooms} genutzt' if used<=rooms else 'Quote überschritten'}
                for name,used in [('Person A im EZ',1),('Person B im EZ',2),('Zusätzliche EZ-Nutzung',max(3,rooms+1))]]}


def initialization_preflight(event):
    from models import Athlete, RoomBooking, ImportSession, ImportApproval,ImportSessionVersion
    people = Athlete.query.filter_by(event_id=event.id).order_by(Athlete.id).all()
    sessions = ImportSession.query.filter_by(event_id=event.id).order_by(ImportSession.id).all()
    bookings = RoomBooking.query.filter_by(event_id=event.id).order_by(RoomBooking.id).all()
    approvals = ImportApproval.query.join(ImportSession).filter(ImportSession.event_id==event.id).order_by(ImportApproval.id).all()
    def raw(obj):return {column.name:getattr(obj,column.name) for column in obj.__table__.columns}
    facts = {'people':[raw(p) for p in people], 'sessions':[raw(s) for s in sessions],
             'bookings':[raw(b) for b in bookings], 'approvals':[raw(a) for a in approvals],
             'versions':[raw(v) for v in ImportSessionVersion.query.filter(ImportSessionVersion.session_id.in_([s.id for s in sessions])).order_by(ImportSessionVersion.id)]}
    from models import AthleteCompetition,EventCompetition
    memberships=[(r.athlete_id,r.competition_id) for r in AthleteCompetition.query.filter(AthleteCompetition.athlete_id.in_([p.id for p in people])).order_by(AthleteCompetition.athlete_id,AthleteCompetition.competition_id)]
    # Calendar-only links do not belong to quota evidence.
    mappings=[{k:v for k,v in raw(m).items() if k!='accommodation_event_id'} for m in EventCompetition.query.filter_by(event_id=event.id).order_by(EventCompetition.id)]
    blockers = ['Bestehende abgeschlossene Genehmigungen ohne fixierten Regelkontext müssen vor Initialisierung geprüft werden.'] if any(a.decision=='APPROVED' for a in approvals) or any(p.single_room_status=='APPROVED_EXTRA' for p in people) else []
    return {'counts': {key:len(value) for key,value in facts.items()}, 'fingerprint':fingerprint({'facts':facts,'memberships':memberships,'mappings':mappings}), 'blockers':blockers}


def audit_rules(event,activity):
    from accommodation_scope import event_audit_refs
    from flask import g,request
    from auth import current_user
    from models import db,AuditEvent
    import uuid
    user=current_user()
    db.session.add(AuditEvent(username=user.username,action='update',entity_type='event-quota-rules',entity_id=str(event.id),
        request_id=getattr(g,'request_id',str(uuid.uuid4())),method=request.method,path=request.path,
        activity=activity,category='Administration',entity_label=event.name,
        details_json=json.dumps({'rules':rule_projection(event),'isWorldChampionship':event.is_world_championship}),entity_refs_json=event_audit_refs({'eventId':str(event.id)},event.id)))
    g.atomic_import_audit=True  # Existing app-wide atomic-audit hook.


def revision_snapshot(event, reason):
    from models import EventQuotaRevision
    projection=rule_projection(event)
    return EventQuotaRevision(event_id=event.id,revision=event.quota_rules_revision,
        config_json=event.quota_rules_json,is_world_championship=event.is_world_championship,
        digest=projection['digest'],activated_at=event.quota_rules_fixed_at,
        activated_by=event.quota_rules_fixed_by,reason=reason)


def revision_proposal(event,data):
    if not event.quota_rules_fixed_at:
        raise ValueError('Zuerst die ursprüngliche Revision fixieren.')
    if data.get('expectedDigest')!=rule_projection(event)['digest'] or data.get('expectedRevision')!=event.quota_rules_revision:
        raise ValueError('Quotenregeln wurden inzwischen geändert – bitte erneut laden.')
    config=validate_rules(data.get('config'), event.id)
    if type(data.get('isWorldChampionship')) is not bool or not isinstance(data.get('reason'),str) or not data['reason'].strip() or len(data['reason'])>2000:
        raise ValueError('WM-Kennzeichen und Änderungsbegründung erforderlich (maximal 2000 Zeichen).')
    before={'config':json.loads(event.quota_rules_json),'isWorldChampionship':event.is_world_championship}
    after={'config':config,'isWorldChampionship':data['isWorldChampionship']}
    if before==after:raise ValueError('Keine Regeländerung vorhanden.')
    proposal={'eventId':event.id,'previousRevision':event.quota_rules_revision,'before':before,'after':after,'reason':data['reason'].strip()}
    return {**proposal,'confirmationDigest':fingerprint(proposal)}


_TITLE_FIELDS = ('id', 'fisCode', 'nation', 'gender', 'discipline', 'eventGroup',
                 'championship', 'championshipYear', 'titleType', 'source')


def sport_rule_options(event_id):
    from urllib.parse import urlparse
    from models import Competition, EventCompetition, WorldChampion
    from competitions import competition_title_discipline
    competitions = Competition.query.join(EventCompetition).filter(
        EventCompetition.event_id == event_id, EventCompetition.active.is_(True),
        Competition.active.is_(True)).order_by(Competition.id).all()
    titles = [t for t in WorldChampion.query.filter_by(active=True, title_type='INDIVIDUAL').order_by(WorldChampion.id)
              if urlparse(t.source).scheme == 'https' and urlparse(t.source).netloc]
    return dict(competitions=[{**c.to_dict(), 'titleDiscipline': competition_title_discipline(c)} for c in competitions],
                titles=[{**{key: t.to_dict()[key] for key in _TITLE_FIELDS}, 'name': t.name} for t in titles])


def validate_sport_entry_rules(value, event_id):
    """Small event-owned configuration validator, not a sporting evaluation."""
    from urllib.parse import urlparse
    from models import db, Event
    def keys(obj, expected):
        if not isinstance(obj, dict) or set(obj) != set(expected):
            raise ValueError('Unvollständige oder unbekannte Quotenparameter (Sport).')
    def flag(value):
        if type(value) is not bool:
            raise ValueError('Sport-Aktivierung muss boolesch sein.')
    def limit(value):
        if type(value) is not int or not 0 <= value <= 10000:
            raise ValueError('Starterlimit muss eine ganze Zahl von 0 bis 10000 sein.')
    keys(value, ('schemaVersion', 'enabled', 'titleEdition', 'competitions', 'pools'))
    if type(value['schemaVersion']) is not int or value['schemaVersion'] != 1:
        raise ValueError('Unbekannte Sportregelversion.')
    flag(value['enabled'])
    if not event_id or not db.session.get(Event, event_id):
        raise ValueError('Sportregeln benötigen ein zugehöriges Event.')
    options = sport_rule_options(event_id)
    competitions = {c['id']: c for c in options['competitions']}
    titles = {t['id']: t for t in options['titles']}
    edition = value['titleEdition']
    if edition is not None:
        keys(edition, ('championship', 'year'))
        if not isinstance(edition['championship'], str) or not edition['championship'].strip():
            raise ValueError('Titel-WM fehlt.')
        if type(edition['year']) is not int or not 1900 <= edition['year'] <= 2200:
            raise ValueError('Ungültiges Titeljahr.')
        year = db.session.get(Event, event_id).year
        if not year or edition['year'] >= year:
            raise ValueError('Titelgrundlage muss vor dem datierten Ziel-Event liegen.')
        if not any(t['championship'] == edition['championship'] and t['championshipYear'] == edition['year'] for t in titles.values()):
            raise ValueError('Titel-WM ist nicht im vorhandenen Referenzkatalog enthalten.')
    if not isinstance(value['competitions'], list) or len(value['competitions']) > len(competitions):
        raise ValueError('Ungültige Competition-Regeln.')
    if not isinstance(value['pools'], list) or len(value['pools']) > len(competitions):
        raise ValueError('Ungültige Zuteilungspools.')
    pools = {}
    for pool in value['pools']:
        keys(pool, ('id', 'regularLimit'))
        key = pool['id']
        if not isinstance(key, str) or not key.strip() or key != key.strip() or len(key) > 80 or key in pools:
            raise ValueError('Poolbezeichnung fehlt oder ist doppelt.')
        limit(pool['regularLimit'])
        pools[key] = []
    seen = set()
    for rule in value['competitions']:
        keys(rule, ('competitionId', 'enabled', 'regularLimit', 'titleReferences', 'poolId'))
        key = rule['competitionId']
        if not isinstance(key, str) or key not in competitions or key in seen:
            raise ValueError('Competition fehlt, ist doppelt oder gehört nicht zu diesem Event.')
        seen.add(key)
        comp = competitions[key]
        if comp['teamCompetition'] or comp['gender'] not in {'M', 'W', 'F'}:
            raise ValueError('Keine automatische Einzelstarterregel für Teamwettbewerbe.')
        flag(rule['enabled'])
        if rule['regularLimit'] is not None or rule['enabled']:
            limit(rule['regularLimit'])
        pool = rule['poolId']
        if pool is not None:
            if not isinstance(pool, str) or pool not in pools:
                raise ValueError('Unbekannter Zuteilungspool.')
            if not rule['enabled']:
                raise ValueError('Deaktivierte Wettbewerbsregeln dürfen keinem Pool angehören; Poolzuordnung entfernen.')
            pools[pool].append(comp)
        refs = rule['titleReferences']
        if not isinstance(refs, list) or len(refs) > len(titles):
            raise ValueError('Ungültige Titelreferenzen.')
        used_titles = set()
        for ref in refs:
            keys(ref, (*_TITLE_FIELDS, 'sourceVerified'))
            title = titles.get(ref['id']) if isinstance(ref['id'], str) else None
            if not title or ref['id'] in used_titles or ref['sourceVerified'] is not True:
                raise ValueError('Verifizierte individuelle Titelquelle erforderlich.')
            used_titles.add(ref['id'])
            if any(ref[field] != title[field] or type(ref[field]) is not type(title[field]) for field in _TITLE_FIELDS):
                raise ValueError('Titelreferenz wurde geändert; Grundlage erneut auswählen.')
            if (not edition or title['championship'] != edition['championship'] or title['championshipYear'] != edition['year']
                    or not comp['titleDiscipline'] or title['discipline'] != comp['titleDiscipline']
                    or title['eventGroup'] != comp['quotaDiscipline'] or title['gender'] != comp['gender']
                    or not title['fisCode'] or not title['nation']
                    or urlparse(title['source']).scheme != 'https' or not urlparse(title['source']).netloc):
                raise ValueError('Titel passt nicht exakt zu Wettbewerb, Geschlecht oder WM-Ausgabe.')
    for members in pools.values():
        if len(members) < 2 or len({(c['sport'], c['gender']) for c in members}) != 1:
            raise ValueError('Pool benötigt mindestens zwei Wettbewerbe derselben Sportart und desselben Geschlechts.')
    return copy.deepcopy(value)
