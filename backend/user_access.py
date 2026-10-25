"""Small administration service over PR8 grants; identities still belong to Authelia."""
import hashlib
import json
import uuid
from datetime import datetime, timedelta
from flask import g, has_request_context
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert
from auth import superadmin_username
from models import db, Event, EventAccess, UserReference, AuditEvent


def valid_username(value):
    if not isinstance(value, str) or not value or value != value.strip() or len(value) > 100 or any(ord(c) < 32 for c in value):
        raise ValueError('Exakten authentifizierten Benutzernamen mit 1–100 Zeichen angeben.')
    return value


def remember_authenticated_user(user):
    """Only verified identity hints, at most hourly; never create grants."""
    now = datetime.utcnow()
    statement = insert(UserReference).values(username=valid_username(user.username),
        display_name=user.display_name[:200], groups_json=json.dumps(list(user.groups)), last_seen_at=now)
    statement = statement.on_conflict_do_update(index_elements=['username'],
        set_={'display_name': statement.excluded.display_name, 'groups_json': statement.excluded.groups_json,
              'last_seen_at': now},
        where=(UserReference.last_seen_at.is_(None) | (UserReference.last_seen_at < now - timedelta(hours=1)) |
               (UserReference.groups_json != statement.excluded.groups_json)))
    db.session.execute(statement)
    db.session.commit()


def lock_grants():
    # All CLI/API grant writers share this small administrative transaction lock.
    db.session.execute(text('LOCK TABLE event_access IN SHARE ROW EXCLUSIVE MODE'))


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def grant_state(username):
    return {str(e): 'WRITE' if w else 'READ' for e,w in db.session.query(
        EventAccess.event_id, EventAccess.can_write).filter_by(username=username).order_by(EventAccess.event_id)}


def grant_revision(username):
    return digest(grant_state(username))


def audit_access(username, event_id, old, new, actor):
    from accommodation_scope import event_audit_refs
    refs = event_audit_refs({'username': username}, owner=event_id)
    db.session.add(AuditEvent(username=actor, action='update', entity_type='event_access',
        entity_id=str(event_id), request_id=str(uuid.uuid4()), method='PUT' if has_request_context() else 'CLI',
        path='/api/admin/users/grants' if has_request_context() else 'event-access',
        activity='Eventberechtigung geändert', category='Administration', entity_label=username,
        changes_json=json.dumps({'username': username, 'old': old, 'new': new}),
        details_json=json.dumps([f'{old} → {new}']), entity_refs_json=refs))
    if has_request_context():
        g.atomic_import_audit = True  # Existing hook: this transaction owns its audit.


def set_grant(username, event_id, level, actor, *, operator_maintenance=False):
    valid_username(username)
    if username == superadmin_username() and not operator_maintenance:
        raise ValueError('Superadminrechte werden ausschließlich über Serverkonfiguration verwaltet.')
    if level not in {'NONE', 'READ', 'WRITE'}:
        raise ValueError('Berechtigung muss NONE, READ oder WRITE sein.')
    if db.session.get(Event, event_id) is None:
        raise ValueError('Championship existiert nicht.')
    row = db.session.get(EventAccess, (username, event_id), populate_existing=True)
    old = 'NONE' if row is None else 'WRITE' if row.can_write else 'READ'
    if old == level:
        return
    if level == 'NONE':
        db.session.delete(row)
    elif row is None:
        db.session.add(EventAccess(username=username, event_id=event_id, can_write=level == 'WRITE'))
    else:
        row.can_write = level == 'WRITE'
    audit_access(username, event_id, old, level, actor)


def known_users():
    references = {r.username:r for r in db.session.query(UserReference).all()}
    grants = {}
    for row in db.session.query(EventAccess).order_by(EventAccess.username, EventAccess.event_id):
        grants.setdefault(row.username, {})[str(row.event_id)] = 'WRITE' if row.can_write else 'READ'
    names = set(references) | set(grants)
    if superadmin_username():
        names.add(superadmin_username())
    result = []
    for name in sorted(names):
        ref = references.get(name)
        result.append({'username': name, 'displayName': ref.display_name if ref else name,
            'groups': json.loads(ref.groups_json) if ref and ref.groups_json else None,
            'lastSeenAt': ref.last_seen_at.isoformat() + 'Z' if ref and ref.last_seen_at else None,
            'isSuperadmin': name == superadmin_username(), 'grants': grants.get(name, {}),
            'revision': digest(grants.get(name, {}))})
    return result


def bootstrap_plan(usernames, level):
    if level not in {'READ', 'WRITE'}:
        raise ValueError('READ oder WRITE erforderlich.')
    known = {u['username'] for u in known_users()}
    names = sorted(set(valid_username(u) for u in usernames))
    if not names or set(names) - known:
        raise ValueError('Nur ausdrücklich angegebene bekannte Benutzer freigeben; unbekannte Referenzen zuerst anlegen.')
    events = [(e.id, e.name) for e in Event.query.filter_by(active=True).order_by(Event.id)]
    changes = []; existing = []
    for name in names:
        state = grant_state(name)
        for event_id, label in events:
            item = {'username': name, 'eventId': event_id, 'eventName': label}
            if name == superadmin_username() or str(event_id) in state:
                existing.append({**item, 'level': 'SUPERADMIN' if name == superadmin_username() else state[str(event_id)]})
            else:
                changes.append({**item, 'level': level})
    plan = {'users': names, 'events': events, 'changes': changes, 'unchanged': existing}
    return {**plan, 'digest': digest(plan)}
