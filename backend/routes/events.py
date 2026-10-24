"""Event HTTP routes; authentication and mutation auditing remain app-wide."""
from accommodation_scope import event_query, event_get

from datetime import datetime

from flask import Blueprint, jsonify, request

from excel_import import ImportValidationError, normalize_event_id
from models import db, AccommodationEvent, Event, EventCompetition, EventRoomDemand, Competition


events = Blueprint('events', __name__)


# Events - CRUD
@events.route('/api/events', methods=['GET'])
def get_events():
    events = event_query(AccommodationEvent).options(
        db.selectinload(AccommodationEvent.room_demands).joinedload(EventRoomDemand.room_type)
    ).all()
    return jsonify([e.to_dict() for e in events])


@events.route('/api/events', methods=['POST'])
def create_event():
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    data = request.json
    event = AccommodationEvent(
        discipline=data['discipline'],
        start_date=datetime.fromisoformat(data['startDate']).date(),
        end_date=datetime.fromisoformat(data['endDate']).date(),
        person_demand=max(0, int(data['personDemand'])),
        single_room_percentage=max(0, min(100, int(data.get('singleRoomPercentage', 50))))
    )
    db.session.add(event)
    db.session.commit()
    return jsonify(event.to_dict()), 201


@events.route('/api/events/<int:event_id>', methods=['PUT'])
def update_event(event_id):
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    event = event_get(AccommodationEvent, event_id, required=True)
    data = request.json

    if 'discipline' in data:
        event.discipline = data['discipline']
    if 'startDate' in data:
        event.start_date = datetime.fromisoformat(data['startDate']).date()
    if 'endDate' in data:
        event.end_date = datetime.fromisoformat(data['endDate']).date()
    if 'personDemand' in data:
        event.person_demand = max(0, int(data['personDemand']))
    if 'singleRoomPercentage' in data:
        event.single_room_percentage = max(0, min(100, int(data['singleRoomPercentage'])))

    db.session.commit()
    return jsonify(event.to_dict())


@events.route('/api/events/<int:event_id>', methods=['DELETE'])
def delete_event(event_id):
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    event = event_get(AccommodationEvent, event_id, required=True)
    db.session.delete(event)
    db.session.commit()
    return '', 204


# Event Room Demand
@events.route('/api/events/<int:event_id>/demand', methods=['POST'])
def add_event_demand(event_id):
    return jsonify({'error': 'Zimmerbedarf wird automatisch aus Personenbedarf und Belegungsstrategie berechnet.'}), 405


@events.route('/api/events/<int:event_id>/demand/<int:demand_id>', methods=['DELETE'])
def delete_event_demand(event_id, demand_id):
    return jsonify({'error': 'Berechneter Zimmerbedarf kann nicht manuell geändert werden.'}), 405


# Championship event administration.  The existing /api/events endpoints stay
# dedicated to accommodation demand until that domain is scoped in a later sprint.
@events.route('/api/championship-events', methods=['GET'])
def list_active_championship_events():
    # Public catalogue remains global metadata, not foreign policy/auditor data.
    return jsonify([{key:value for key,value in event.to_dict().items() if key!='quotaRules'}
                    for event in Event.query.filter_by(active=True).order_by(Event.year, Event.name).all()])


@events.route('/api/admin/events', methods=['GET', 'POST'])
def administer_events():
    if request.method == 'GET':
        return jsonify([event.to_dict() for event in Event.query.order_by(Event.year, Event.name).all()])
    data = request.get_json() or {}
    if not str(data.get('name', '')).strip():
        return jsonify({'error': 'Name ist erforderlich.'}), 400
    event = Event(name=data['name'].strip(), year=data.get('year'),
                  active=bool(data.get('active', True)), fis_event_id=data.get('fisEventId'),
                  sector_code=data.get('sectorCode'))
    db.session.add(event)
    db.session.commit()
    return jsonify(event.to_dict()), 201


@events.route('/api/admin/events/<int:event_id>', methods=['GET', 'PUT'])
def administer_event(event_id):
    event_record = Event.query.get_or_404(event_id)
    if request.method == 'GET':
        return jsonify(event_record.to_dict(include_mappings=True))
    data = request.get_json() or {}
    if any(key in data for key in ('quotaRules','quotaRulesJson','quotaRulesFixedAt','quotaRulesRevision','isWorldChampionship')):
        return jsonify(error='USE_QUOTA_RULES_WORKFLOW'),400
    for source, target in (('name', 'name'), ('year', 'year'), ('active', 'active'),
                           ('fisEventId', 'fis_event_id'), ('sectorCode', 'sector_code')):
        if source in data:
            setattr(event_record, target, data[source])
    db.session.commit()
    return jsonify(event_record.to_dict(include_mappings=True))


@events.route('/api/admin/events/<int:event_id>/competitions', methods=['POST'])
def add_event_competition(event_id):
    Event.query.get_or_404(event_id)
    data = request.get_json() or {}
    Competition.query.get_or_404(data.get('competitionId'))
    mapping = EventCompetition(event_id=event_id, competition_id=data['competitionId'],
        fis_codex=str(data.get('fisCodex', '')).strip(), import_code=str(data.get('importCode', '')).strip(),
        official_name=str(data.get('officialName', '')).strip(), active=bool(data.get('active', True)))
    if not all((mapping.fis_codex, mapping.import_code, mapping.official_name)):
        return jsonify({'error': 'Official Name, Codex und Import Code sind erforderlich.'}), 400
    db.session.add(mapping)
    db.session.commit()
    return jsonify(mapping.to_dict()), 201


@events.route('/api/admin/events/<int:event_id>/competitions/<int:mapping_id>', methods=['PUT'])
def update_event_competition(event_id, mapping_id):
    mapping = EventCompetition.query.filter_by(id=mapping_id, event_id=event_id).first_or_404()
    data = request.get_json() or {}
    if any(key in data for key in ('quotaRules','quotaRulesJson','quotaRulesFixedAt','quotaRulesRevision','isWorldChampionship')):
        return jsonify(error='USE_QUOTA_RULES_WORKFLOW'),400
    for source, target in (('officialName', 'official_name'), ('fisCodex', 'fis_codex'),
                           ('importCode', 'import_code'), ('active', 'active')):
        if source in data:
            setattr(mapping, target, data[source])
    db.session.commit()
    return jsonify(mapping.to_dict())


@events.route('/api/admin/events/<int:event_id>/copy-mappings', methods=['POST'])
def copy_event_competitions(event_id):
    target = Event.query.get_or_404(event_id)
    try:
        source_event_id = normalize_event_id((request.get_json() or {}).get('sourceEventId'))
    except ImportValidationError as exc:
        return jsonify(exc.to_dict()), 400
    source = Event.query.get_or_404(source_event_id)
    existing = {row.competition_id for row in target.competition_mappings}
    copies = [EventCompetition(event_id=target.id, competition_id=row.competition_id,
        fis_codex=row.fis_codex, import_code=row.import_code,
        official_name=row.official_name, active=row.active)
        for row in source.competition_mappings if row.competition_id not in existing]
    db.session.add_all(copies)
    db.session.commit()
    return jsonify({'created': len(copies), 'event': target.to_dict(include_mappings=True)})


@events.route('/api/quota-rules', methods=['GET'])
def active_quota_rules():
    from accommodation_scope import accommodation_event_id
    from quota_rules import rule_projection, examples
    event = db.session.get(Event, accommodation_event_id())
    result = rule_projection(event)
    result.update(eventId=str(event.id), eventName=event.name, isWorldChampionship=event.is_world_championship)
    if result['status']=='FIXED':
        result['examples']=examples(result['config'])
    return jsonify(result)


@events.route('/api/admin/events/<int:event_id>/quota-rules', methods=['GET', 'PUT'])
def event_quota_rules(event_id):
    import json
    from quota_rules import rule_projection, validate_rules, initialization_preflight, examples, standard_rules
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    event = Event.query.filter_by(id=event_id).populate_existing().with_for_update().first_or_404()
    if request.method=='PUT':
        if event.quota_rules_fixed_at:
            return jsonify(error='QUOTA_RULES_FIXED',message='Fixierte Quotenregeln sind unveränderlich.'),409
        data=request.get_json() or {}
        if not isinstance(data,dict):return jsonify(error='INVALID_QUOTA_RULES'),400
        if data.get('expectedDigest') != rule_projection(event)['digest']:
            return jsonify(error='STALE_QUOTA_RULES'),409
        try:
            rules=validate_rules(data.get('config'))
        except ValueError as exc:
            return jsonify(error='INVALID_QUOTA_RULES',message=str(exc)),400
        event.quota_rules_json=json.dumps(rules,sort_keys=True)
        if 'isWorldChampionship' in data:
            if type(data['isWorldChampionship']) is not bool:
                return jsonify(error='INVALID_WORLD_CHAMPIONSHIP'),400
            event.is_world_championship=data['isWorldChampionship']
        from quota_rules import audit_rules
        audit_rules(event,'Quotenregelentwurf gespeichert')
        db.session.commit()
    result=rule_projection(event)
    result.update(isWorldChampionship=event.is_world_championship,preflight=initialization_preflight(event), standardProposal=standard_rules())
    if result['config']:result['examples']=examples(result['config'])
    return jsonify(result)


@events.route('/api/admin/events/<int:event_id>/quota-rules/fix', methods=['POST'])
def fix_event_quota_rules(event_id):
    import json
    from auth import current_user
    from quota_rules import rule_projection, validate_rules, initialization_preflight, standard_rules
    from imports.workflow import lock_import_snapshot
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    lock_import_snapshot()
    event=Event.query.filter_by(id=event_id).populate_existing().with_for_update().first_or_404()
    if event.quota_rules_fixed_at:return jsonify(error='QUOTA_RULES_FIXED'),409
    data=request.get_json() or {}
    if not event.quota_rules_json:return jsonify(error='INVALID_QUOTA_RULES'),400
    try:config=validate_rules(json.loads(event.quota_rules_json))
    except (ValueError,TypeError):return jsonify(error='INVALID_QUOTA_RULES'),400
    preflight=initialization_preflight(event)
    if (data.get('confirm') is not True or data.get('expectedDigest')!=rule_projection(event)['digest']
            or data.get('preflightFingerprint')!=preflight['fingerprint']):
        return jsonify(error='QUOTA_FIX_CONFIRMATION_REQUIRED',preflight=preflight),409
    if preflight['blockers'] or (any(preflight['counts'].values()) and config!=standard_rules()):
        return jsonify(error='QUOTA_INITIALIZATION_BLOCKED',preflight=preflight,
                       message='Bestand erfordert eine geprüfte Initialisierung; keine Daten wurden bereinigt.'),409
    event.quota_rules_fixed_at=datetime.utcnow()
    event.quota_rules_fixed_by=current_user().username
    event.quota_rules_revision=1
    from quota_rules import audit_rules
    audit_rules(event,'Quotenregeln verbindlich fixiert')
    db.session.commit()
    return jsonify(rule_projection(event))


@events.route('/api/fis/athlete-quotas', methods=['GET'])
@events.route('/api/athlete-quotas', methods=['GET'])
def live_athlete_quotas():
    from accommodation_scope import accommodation_event_id
    from models import Athlete, ImportApproval, ImportSession, ImportSessionVersion, ImportSessionEvent
    from quota_rules import rules_for_event
    from athlete_quota import quota_rows
    from competitions import quota_disciplines, competition_athlete_family
    from imports.identity import build_name_key
    owner=accommodation_event_id()
    rules=rules_for_event(owner)
    people=event_query(Athlete).all()
    roster=[{'personId':p.id,'matchKey':p.fis_code or p.competitor_id or build_name_key(p.lastname,p.firstname,p.nation_code),
        'nationCode':p.nation_code,'gender':p.gender,'function':p.function,'firstname':p.firstname,'lastname':p.lastname,
        'quotaDisciplines':quota_disciplines(p.competitions),'athleteQuotaFamilies':list({competition_athlete_family(c) for c in p.competitions}),'competitionIds':[str(c.id) for c in p.competitions]} for p in people]
    if any((p['function'] or '').strip().lower()=='athlete' and (not p['athleteQuotaFamilies'] or None in p['athleteQuotaFamilies']) for p in roster):
        return jsonify(error='ATHLETE_QUOTA_FAMILY_UNKNOWN'),409
    from quota_service import quota_gender_errors
    if quota_gender_errors(roster):return jsonify(error='QUOTA_GENDER_REVIEW_REQUIRED'),409
    superseded=db.select(ImportSessionEvent.approval_id).where(ImportSessionEvent.event_type=='QUOTA_DECISION_REVISED_FROM',ImportSessionEvent.approval_id.isnot(None),ImportSessionEvent.session_id.in_(db.select(ImportSession.id).where(ImportSession.event_id==owner)))
    approvals=ImportApproval.query.join(ImportSession).join(ImportSessionVersion,(ImportSessionVersion.id==ImportApproval.version_id)&(ImportSessionVersion.session_id==ImportApproval.session_id)).filter(ImportSession.event_id==owner,ImportApproval.decision=='APPROVED',~ImportApproval.id.in_(superseded)).order_by(ImportApproval.id).all()
    return jsonify(quota_rows(roster,rules,owner,approvals,db.session.get(Event,owner).quota_rules_revision))
