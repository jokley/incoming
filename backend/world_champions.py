"""Recognition uses only exact FIS identity; provenance is not person status."""
import json
import uuid
import re
from flask import has_request_context, request
from models import AuditEvent, WorldChampion, db
from accommodation_scope import event_audit_refs


from imports.normalization import canonical_fis_code


def persisted_manual_revision(existing):
    """Revision of the last explicit operational edit, not staged review history."""
    if not existing:
        return None
    row = AuditEvent.query.filter(
        AuditEvent.entity_type == 'world-champion-status', AuditEvent.entity_id == str(existing.id),
        ~AuditEvent.path.like('%/single-room-exemptions/%'),
        (AuditEvent.changes_json.contains('"source": "MANUAL_SET"')
         | AuditEvent.changes_json.contains('"source": "MANUAL_REMOVE"')),
    ).order_by(AuditEvent.id.desc()).first()
    return row.id if row else None


def recognize(person, existing, overrides, event_id, carried_keys=(), override_revisions=None):
    key = person.get('matchKey')
    reason = existing.single_room_quota_exempt_reason if existing else None
    source = existing.single_room_exemption_source if existing else None
    references = []
    if reason == 'OTHER':
        pass  # Never replace a historical non-crown exemption.
    elif (key in overrides and source in {'MANUAL_SET', 'MANUAL_REMOVE'}
          and ((key in (override_revisions or {})
                and override_revisions[key] != persisted_manual_revision(existing))
               or (key in carried_keys and key not in (override_revisions or {})))):
        pass  # A newer persisted decision wins; unchanged earlier state may be staged over.
    elif key in overrides:
        reason = overrides[key]
        source = 'MANUAL_SET' if reason == 'WORLD_CHAMPION' else 'MANUAL_REMOVE'
    elif source in {'MANUAL_SET', 'MANUAL_REMOVE'} or (reason == 'WORLD_CHAMPION' and not source):
        source = source or 'MANUAL_SET'
    else:
        from models import Event
        championship = db.session.get(Event, int(event_id)) if event_id else None
        if championship and championship.is_world_championship and (person.get('function') or '').strip().lower() == 'athlete' and person.get('fisCode'):
            from models import WorldChampionRecognition
            from sqlalchemy import or_,and_,exists
            links=WorldChampionRecognition
            selected_ids = json.loads(championship.world_champion_list_json)['titleIds'] if championship.world_champion_list_json else None
            references = WorldChampion.query.filter(
                *([WorldChampion.id.in_(selected_ids)] if selected_ids is not None else []),
                WorldChampion.fis_code==canonical_fis_code(person['fisCode']),WorldChampion.active.is_(True),WorldChampion.entitlement_enabled.is_(True),WorldChampion.title_type=='INDIVIDUAL',
                or_(exists().where(links.title_id==WorldChampion.id,links.event_id==int(event_id),links.active.is_(True)),
                    and_(WorldChampion.event_id==int(event_id),~exists().where(links.title_id==WorldChampion.id,links.event_id==WorldChampion.event_id)))).order_by(WorldChampion.id).all()
        historical = existing and reason == 'WORLD_CHAMPION' and not (championship and championship.is_world_championship)
        reason = 'WORLD_CHAMPION' if references or historical else None
        source = 'AUTO_REFERENCE' if references or source == 'AUTO_REFERENCE' else None
    person.update(singleRoomQuotaExemptReason=reason, singleRoomExemptionSource=source,
                  worldChampionReferences=[row.to_dict() for row in references])


def audit_status(person_key, source, reason, username, references=None, event_id=None, fis_code=None, person_id=None, session_id=None):
    evidence = {'personKey': str(person_key), 'source': source, 'reason': reason,
                'eventId': event_id, 'fisCode': fis_code, 'references': references or []}
    details = [source or 'Import', f'FIS-Code: {fis_code or "—"}', reason or 'Status entfernt']
    details.extend(f"{row['championship']} {row['championshipYear']} · {row['source']}" for row in references or [])
    automatic_title = 'Weltmeisterstatus automatisch angewendet' if reason else 'Weltmeisterstatus automatisch entfernt'
    db.session.add(AuditEvent(username=username, action='update', entity_type='world-champion-status',
        entity_id=str(person_key), request_id=str(uuid.uuid4()),
        method=request.method if has_request_context() else 'IMPORT',
        path=request.path if has_request_context() else '/import', category='Athleten',
        activity=automatic_title if source == 'AUTO_REFERENCE' else 'Weltmeisterstatus manuell geändert',
        entity_label=str(person_key), changes_json=json.dumps(evidence, ensure_ascii=False),
        details_json=json.dumps(details, ensure_ascii=False),
        entity_refs_json=event_audit_refs({**({'personId': str(person_id)} if person_id is not None else {}),
                                    **({'importSessionId': str(session_id)} if session_id is not None else {})}, event_id)))


def reconcile_verified_titles(event_id, records):
    """Insert verified titles only; never overwrite maintained reference rows."""
    created = 0
    for record in records:
        if not record.get('fisCode') or not record.get('sourceVerified') or not record.get('source'):
            raise ValueError('Verified FIS identity and title source evidence required')
        identity = dict(event_id=event_id, fis_code=str(record['fisCode']),
            championship=record['championship'], championship_year=record['championshipYear'],
            discipline=record['discipline'], title_type=record['titleType'])
        from models import WorldChampionRecognition
        source_identity={k:v for k,v in identity.items() if k!='event_id'}
        known=WorldChampion.query.filter_by(**source_identity).first()
        if known:
            if not db.session.get(WorldChampionRecognition,(event_id,known.id)):
                db.session.add(WorldChampionRecognition(event_id=event_id,title_id=known.id,active=known.active))
            continue
        db.session.add(WorldChampion(**identity, name=record['name'], nation=record['nation'],
            gender=record['gender'], event_group=record['eventGroup'], source=record['source'],
            entitlement_enabled=record['titleType'] == 'INDIVIDUAL', active=True))
        db.session.flush()
        created += 1
    return created


def recognition_protected(event_id,title):
    from models import Athlete,ImportSession
    # Conservative: any historical import session may contain this title's
    # evidence. No automatic revalidation or rewrite of those snapshots.
    return bool(ImportSession.query.filter_by(event_id=event_id).first() or
        Athlete.query.filter_by(event_id=event_id,fis_code=title.fis_code,single_room_quota_exempt_reason='WORLD_CHAMPION').first())


def audit_recognition(event_id,title_id,old,new):
    from auth import current_user
    from flask import g
    db.session.add(AuditEvent(username=current_user().username,action='update',entity_type='world-champion-recognition',
        entity_id=str(title_id),request_id=str(uuid.uuid4()),method=request.method,path=request.path,
        activity='Eventbezogene Weltmeisteranerkennung geändert',category='Administration',
        changes_json=json.dumps({'titleId':str(title_id),'old':old,'new':new}),
        entity_refs_json=event_audit_refs({'titleId':str(title_id)},event_id)))
    g.atomic_import_audit=True
