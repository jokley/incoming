"""Deterministic, server-owned FULL_NATION import plans, not a rule engine."""
import hashlib
import json
from datetime import date, datetime
from types import SimpleNamespace
import sqlalchemy as sa
from models import (db, Athlete, AthleteCompetition, RoomBooking, RoomBookingOccupant,
    RoomAssignment, FisRoomAssignment, ImportSession, ImportSessionVersion,
    ImportApproval, ImportSessionEvent, Event, EventCompetition, Competition, WorldChampion, WorldChampionRecognition, AuditEvent)
from .identity import _find_existing_athlete
from .event_context import ImportValidationError


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'),
        default=lambda v: v.isoformat() if isinstance(v, (date, datetime)) else str(v))


def digest(value):
    return hashlib.sha256(encoded(value).encode()).hexdigest()


def rows(model, condition):
    table = model.__table__
    return [dict(row) for row in db.session.execute(sa.select(table).where(condition)
        .order_by(*table.primary_key.columns)).mappings()]


def state(event_id, nation):
    """Bulk raw SQL avoids stale ORM snapshots and per-person evidence queries."""
    people = rows(Athlete, sa.and_(Athlete.event_id == event_id, Athlete.nation_code == nation))
    ids = [p['id'] for p in people]
    memberships = rows(RoomBookingOccupant, RoomBookingOccupant.athlete_id.in_(ids)) if ids else []
    booking_ids = {m['room_booking_id'] for m in memberships}
    occupants = rows(RoomBookingOccupant, RoomBookingOccupant.room_booking_id.in_(booking_ids)) if booking_ids else []
    partner_ids = {o['athlete_id'] for o in occupants} - set(ids)
    partners = rows(Athlete, Athlete.id.in_(partner_ids)) if partner_ids else []
    bookings = rows(RoomBooking, RoomBooking.id.in_(booking_ids)) if booking_ids else []
    if any(p['event_id'] != event_id for p in partners) or any(b['event_id'] != event_id for b in bookings):
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Gemischte Event-Buchungsbeziehungen.')
    legacy = rows(RoomAssignment, sa.or_(RoomAssignment.athlete_id.in_(ids), RoomAssignment.shared_with_athlete_id.in_(ids))) if ids else []
    fis = rows(FisRoomAssignment, sa.or_(FisRoomAssignment.person1_id.in_(ids), FisRoomAssignment.person2_id.in_(ids))) if ids else []
    linked_ids = {r[k] for r in legacy for k in ('athlete_id','shared_with_athlete_id') if r[k]}
    linked_ids |= {r[k] for r in fis for k in ('person1_id','person2_id') if r[k]}
    extra_ids = linked_ids - set(ids) - partner_ids
    if extra_ids:
        partners += rows(Athlete, Athlete.id.in_(extra_ids))
    if any(p['event_id'] != event_id for p in partners):
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Eventfremde Legacy-Referenz.')
    sessions = rows(ImportSession, sa.and_(ImportSession.event_id == event_id, ImportSession.nation == nation))
    session_ids = [s['id'] for s in sessions]
    decision_ids={p['single_room_decision_id'] for p in people if p['single_room_decision_id']}
    if decision_ids and db.session.query(ImportApproval.id).join(ImportSession).filter(ImportApproval.id.in_(decision_ids),ImportSession.event_id!=event_id).first():
        raise ImportValidationError('IMPORT_EVENT_MISMATCH','Eventfremde Genehmigungsreferenz.')
    approvals = rows(ImportApproval, sa.or_(ImportApproval.session_id.in_(session_ids),ImportApproval.id.in_(decision_ids)))
    versions = rows(ImportSessionVersion, ImportSessionVersion.session_id.in_(session_ids))
    approval_history = rows(ImportSessionEvent, sa.and_(ImportSessionEvent.session_id.in_(session_ids),
        ImportSessionEvent.event_type == 'QUOTA_DECISION_REVISED_FROM'))
    current_ids = {s['current_version_id'] for s in sessions}
    # Workflow transitions and the current plan must not invalidate themselves.
    # Prior parsed evidence stays immutable and participates in concurrency checks.
    sessions = [{k: s[k] for k in ('id','event_id','nation','current_version_id')} for s in sessions]
    versions = [{**{k:v[k] for k in ('id','session_id','version','source_hash','preview_token')},
        'historicalPreviewFingerprint':digest(json.loads(v['preview_json'] or '{}')) if v['id'] not in current_ids else None} for v in versions]
    mappings = rows(EventCompetition, EventCompetition.event_id == event_id)
    competitions = rows(Competition, Competition.id.in_([m['competition_id'] for m in mappings]))
    audits = rows(AuditEvent, sa.and_(AuditEvent.entity_id.in_([str(i) for i in ids]),
        AuditEvent.entity_type.in_(['athletes','athlete','world-champion-status']))) if ids else []
    return dict(people=people, partners=partners, memberships=rows(AthleteCompetition, AthleteCompetition.athlete_id.in_(ids)) if ids else [],
        bookings=bookings, occupants=occupants, legacy=legacy, fis=fis, sessions=sessions, versions=versions,
        approvals=approvals, approvalHistory=approval_history, mappings=mappings, competitions=competitions,
        event=rows(Event, Event.id == event_id), champions=rows(WorldChampion, sa.or_(WorldChampion.event_id == event_id,WorldChampion.id.in_(sa.select(WorldChampionRecognition.title_id).where(WorldChampionRecognition.event_id==event_id)))), recognitions=rows(WorldChampionRecognition, WorldChampionRecognition.event_id==event_id), audits=audits)


def input_fingerprint(preview):
    return digest({k:preview.get(k) for k in ('people','rooms','entriesColumns','roomColumns',
        'quotaRulesDigest','quotaRulesRevision','quotaRulesSnapshot','athleteQuotaChecks','roomListHasNoData','accommodationRateOverrides','accommodationRequirementOverrides',
        'singleRoomQuotaExemptOverrides','singleRoomQuotaExemptOverrideRevisions','carriedSingleRoomQuotaExemptKeys')})


def build_plan(preview, read_context, *, version=None):
    """The sole source of person/membership/deletion sets for review and apply."""
    from excel_import import _apply_person_record
    from quota_history import applicable_approval_groups, preview_approval_person
    event_id = read_context.event_id
    nations = {p.get('nationCode') for p in preview['people'] if p.get('nationCode')}
    nation = version.session.nation if version else next(iter(nations)) if len(nations)==1 else None
    if nation is None or nations - {nation}:
        raise ImportValidationError('IMPORT_SNAPSHOT_SCOPE_REQUIRED', 'Ein Snapshot benötigt genau eine ausdrücklich gewählte Nation.')
    snapshot = state(event_id, nation)
    old = {p['id']:p for p in snapshot['people']}
    memberships = {i:set() for i in old}
    for m in snapshot['memberships']:memberships[m['athlete_id']].add(m['competition_id'])
    people = {k:[] for k in ('create','update','unchanged','remove','conflicts')}
    member_changes = {'add':[], 'remove':[], 'unchanged':[]}
    matched = set()
    roster=[preview_approval_person(p,competitions_by_id=read_context.competitions_by_id) for p in preview['people']]
    for p in preview['people']:
        existing = _find_existing_athlete(p, read_context.athlete_maps)
        incoming = {int(i) for i in p.get('competitionIds', [])}
        identity = {'personKey':p['matchKey'], 'personId':existing.id if existing else None,
            'name':f"{p.get('firstname','')} {p.get('lastname','')}".strip(),
            'fisCode':p.get('fisCode'), 'competitorId':p.get('competitorId')}
        if existing and existing.nation_code!=nation:
            raise ImportValidationError('IMPORT_SNAPSHOT_SCOPE_CONFLICT','Nationswechsel benötigt eine gesonderte Identitätsprüfung.')
        before = memberships.get(existing.id,set()) if existing else set()
        for category, values in (('add',incoming-before),('remove',before-incoming),('unchanged',before&incoming)):
            member_changes[category] += [{**identity,'competitionId':i} for i in sorted(values)]
        if not existing:
            people['create'].append(identity)
            continue
        matched.add(existing.id)
        clone = SimpleNamespace(**old[existing.id])
        _apply_person_record(clone, p, clone.athletes_last_seen_at,
            rate_override=(preview.get('accommodationRateOverrides') or {}).get(p['matchKey']),
            preserve_missing_roomlist=bool(preview.get('roomListHasNoData')))
        clone.accommodation_requirement=p['accommodationRequirement']
        clone.accommodation_requirement_source=p['accommodationRequirementSource']
        changes = [{'field':k,'old':v,'new':getattr(clone,k)} for k,v in old[existing.id].items()
            if k not in {'athletes_last_seen_at','roomlist_last_seen_at'} and getattr(clone,k)!=v]
        identity.update(changes=changes, approvalId=existing.single_room_decision_id,
            approvalApplicability='APPLICABLE' if existing.single_room_decision_id and applicable_approval_groups(existing.single_room_decision,preview_approval_person(p,competitions_by_id=read_context.competitions_by_id),p['matchKey'],roster) else 'REVIEW_REQUIRED' if existing.single_room_decision_id else 'NONE')
        people['update' if changes or incoming!=before else 'unchanged'].append(identity)
    removed = set(old)-matched
    affected_bookings = {o['room_booking_id'] for o in snapshot['occupants'] if o['athlete_id'] in removed}
    empty_bookings = {bid for bid in affected_bookings if all(o['athlete_id'] in removed for o in snapshot['occupants'] if o['room_booking_id']==bid)}
    removed_occupants = [o for o in snapshot['occupants'] if o['athlete_id'] in removed]
    related_partner_ids = {o['athlete_id'] for o in snapshot['occupants'] if o['room_booking_id'] in affected_bookings and o['athlete_id'] not in removed}
    related_partner_ids |= {r['athlete_id'] for r in snapshot['legacy'] if r['shared_with_athlete_id'] in removed and r['athlete_id'] not in removed}
    related_partner_ids |= {i for r in snapshot['fis'] if r['person1_id'] in removed or r['person2_id'] in removed for i in (r['person1_id'],r['person2_id']) if i and i not in removed}
    all_people = {p['id']:p for p in snapshot['people']+snapshot['partners']}
    removed_names = {f"{old[i]['lastname']}, {old[i]['firstname']}".casefold() for i in removed}
    partner_fields = [i for i in sorted(related_partner_ids) if (all_people[i]['shared_with_name'] or '').strip().casefold() in removed_names]
    for i in sorted(removed):
        p=old[i]
        people['remove'].append({'personId':i,'name':f"{p['firstname']} {p['lastname']}",
            'fisCode':p['fis_code'],'competitorId':p['competitor_id'],'competitionIds':sorted(memberships[i]),
            'before':p,'bookingIds':sorted({o['room_booking_id'] for o in removed_occupants if o['athlete_id']==i}),
            'approvalId':p['single_room_decision_id'],
            'competitions':[{'id':c['id'],'name':c['name'],'importCode':c['import_code']} for c in snapshot['competitions'] if c['id'] in memberships[i]]})
        member_changes['remove'] += [{'personId':i,'competitionId':c} for c in sorted(memberships[i])]
    legacy = [{'id':r['id'],'action':'DELETE' if r['athlete_id'] in removed else 'CLEAR_PARTNER'} for r in snapshot['legacy'] if r['athlete_id'] in removed or r['shared_with_athlete_id'] in removed]
    fis = [{'id':r['id'],'action':'DELETE' if r['person1_id'] in removed and (not r['person2_id'] or r['person2_id'] in removed) else 'RETAIN_SURVIVOR',
        'survivorId':next((i for i in (r['person1_id'],r['person2_id']) if i and i not in removed),None)} for r in snapshot['fis'] if r['person1_id'] in removed or r['person2_id'] in removed]
    plan = dict(formatVersion=1,eventId=event_id,nation=nation,snapshotScope='FULL_NATION',
        sessionId=version.session_id if version else None,versionId=version.id if version else None,
        importVersion=version.version if version else None,stateFingerprint=digest(snapshot),inputFingerprint=input_fingerprint(preview),people=people,
        memberships=member_changes,operations=dict(bookingIds=sorted(affected_bookings),
            bookings=[b for b in snapshot['bookings'] if b['id'] in affected_bookings],
            removeOccupants=removed_occupants,deleteEmptyBookingIds=sorted(empty_bookings),
            partnerIds=sorted(related_partner_ids),partners=[{'id':i,'name':f"{all_people[i]['firstname']} {all_people[i]['lastname']}"} for i in sorted(related_partner_ids)],clearPartnerFields=partner_fields,legacy=legacy,fis=fis),
        approvalEvidence=snapshot['approvals'])
    plan['requiresDestructiveConfirmation']=bool(removed or member_changes['remove'])
    plan['digest']=digest(plan)
    return json.loads(encoded(plan))


def verify_plan(preview, plan):
    if not plan or plan.get('formatVersion')!=1:
        raise ImportValidationError('IMPORT_REVIEW_REQUIRED', 'Änderungsplan fehlt. Bitte erneut prüfen.')
    if input_fingerprint(preview)!=plan.get('inputFingerprint'):
        raise ImportValidationError('STALE_PREVIEW','Die geparsten Fakten oder Review-Entscheidungen wurden geändert. Erneut prüfen.')
    if digest(state(plan['eventId'],plan['nation'])) != plan['stateFingerprint']:
        raise ImportValidationError('STALE_PREVIEW', 'Der Datenstand hat sich geändert. Bitte erneut prüfen und freigeben.')


def apply_removals(plan):
    """Apply only reviewed stable IDs; preserve surviving booking fields/evidence."""
    removed={p['personId'] for p in plan['people']['remove']}
    if not removed:return
    event_id=plan['eventId']
    if db.session.query(Athlete.id).filter(Athlete.id.in_(removed),Athlete.event_id!=event_id).first():
        raise ImportValidationError('IMPORT_EVENT_MISMATCH','Eventfremde Löschung abgewiesen.')
    ops=plan['operations']
    db.session.execute(sa.delete(RoomBookingOccupant).where(RoomBookingOccupant.id.in_([o['id'] for o in ops['removeOccupants']])))
    for item in ops['legacy']:
        if item['action']=='DELETE':db.session.execute(sa.delete(RoomAssignment).where(RoomAssignment.id==item['id']))
        else:db.session.execute(sa.update(RoomAssignment).where(RoomAssignment.id==item['id']).values(shared_with_athlete_id=None))
    for item in ops['fis']:
        if item['action']=='DELETE':db.session.execute(sa.delete(FisRoomAssignment).where(FisRoomAssignment.id==item['id']))
        else:db.session.execute(sa.update(FisRoomAssignment).where(FisRoomAssignment.id==item['id']).values(person1_id=item['survivorId'],person2_id=None))
    db.session.execute(sa.update(Athlete).where(Athlete.event_id==event_id,Athlete.id.in_(ops['clearPartnerFields'])).values(shared_with_name=None))
    db.session.execute(sa.delete(AthleteCompetition).where(AthleteCompetition.athlete_id.in_(removed)))
    db.session.execute(sa.delete(Athlete).where(Athlete.event_id==event_id,Athlete.id.in_(removed)))
    for bid in ops['deleteEmptyBookingIds']:
        if db.session.query(RoomBookingOccupant.id).filter_by(room_booking_id=bid).first():
            raise ImportValidationError('STALE_PREVIEW','Zu löschende Buchung ist nicht mehr leer.')
    db.session.execute(sa.delete(RoomBooking).where(RoomBooking.event_id==event_id,RoomBooking.id.in_(ops['deleteEmptyBookingIds'])))
