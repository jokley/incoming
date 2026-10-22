"""Recognition uses only exact FIS identity; provenance is not person status."""
import json
import uuid
import re
from flask import has_request_context, request
from models import AuditEvent, WorldChampion, db


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
        if (person.get('function') or '').strip().lower() == 'athlete' and person.get('fisCode') and event_id:
            references = WorldChampion.query.filter_by(event_id=int(event_id),
                fis_code=canonical_fis_code(person['fisCode']), active=True, entitlement_enabled=True).order_by(WorldChampion.id).all()
        reason = 'WORLD_CHAMPION' if references else None
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
        entity_refs_json=json.dumps({**({'personId': str(person_id)} if person_id is not None else {}),
                                    **({'importSessionId': str(session_id)} if session_id is not None else {})})))


def reconcile_verified_titles(event_id, records):
    """Insert verified titles only; never overwrite maintained reference rows."""
    created = 0
    for record in records:
        if not record.get('fisCode') or not record.get('sourceVerified') or not record.get('source'):
            raise ValueError('Verified FIS identity and title source evidence required')
        identity = dict(event_id=event_id, fis_code=str(record['fisCode']),
            championship=record['championship'], championship_year=record['championshipYear'],
            discipline=record['discipline'], title_type=record['titleType'])
        if WorldChampion.query.filter_by(**identity).first():
            continue
        db.session.add(WorldChampion(**identity, name=record['name'], nation=record['nation'],
            gender=record['gender'], event_group=record['eventGroup'], source=record['source'],
            entitlement_enabled=record['titleType'] == 'INDIVIDUAL', active=True))
        db.session.flush()
        created += 1
    return created
