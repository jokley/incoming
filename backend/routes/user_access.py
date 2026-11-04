"""Superadmin-only global identity references and explicit event grants."""
from flask import Blueprint, abort, jsonify, request
from auth import current_user
from models import db, Event, UserReference, AuditEvent
from user_access import known_users, valid_username, lock_grants, grant_revision, set_grant

user_access = Blueprint('user_access', __name__)


@user_access.before_request
def superadmin_only():
    if request.method == 'OPTIONS':
        return None
    # Do not accept a functional wildcard/admin group as a grant-management role.
    if not current_user() or not current_user().is_superadmin:
        abort(403)


@user_access.route('/api/admin/users', methods=['GET', 'POST'])
def users():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify(error='JSON-Objekt erforderlich.'), 400
        try:
            username = valid_username(data.get('username'))
        except ValueError as error:
            return jsonify(error=str(error)), 400
        if set(data) - {'username', 'displayName'} or not isinstance(data.get('displayName', ''), str) or len(data.get('displayName', '')) > 200:
            return jsonify(error='Nur Benutzername und Anzeigename sind erlaubt.'), 400
        lock_grants()
        if db.session.get(UserReference, username):
            return jsonify(error='Benutzerreferenz existiert bereits.'), 409
        db.session.add(UserReference(username=username, display_name=data.get('displayName') or username))
        db.session.commit()
    return jsonify({'users': known_users(), 'events': [
        {'id': str(e.id), 'name': e.name, 'active': e.active}
        for e in Event.query.order_by(Event.year, Event.id)],
        'history': [a.to_dict() for a in AuditEvent.query.filter_by(entity_type='event_access').order_by(AuditEvent.id.desc()).limit(100)]}), 201 if request.method == 'POST' else 200


@user_access.route('/api/admin/users/grants', methods=['PUT'])
def grants():
    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify(error='JSON-Objekt erforderlich.'), 400
    try:
        username = valid_username(data.get('username'))
        if set(data) != {'username', 'expectedRevision', 'grants'} or not isinstance(data['grants'], dict):
            raise ValueError('Benutzer, erwartete Revision und Eventberechtigungen erforderlich.')
        from imports.event_context import normalize_event_id
        desired = {normalize_event_id(k): v for k,v in data['grants'].items()}
        if len(desired) != len(data['grants']) or any(v not in ('NONE','READ','WRITE') for v in desired.values()):
            raise ValueError('Ungültige oder doppelte Eventberechtigungen.')
        lock_grants()
        if username not in {u['username'] for u in known_users()}:
            raise ValueError('Benutzerreferenz zuerst anlegen.')
        if data['expectedRevision'] != grant_revision(username):
            return jsonify(error='Berechtigungen wurden inzwischen geändert. Bitte neu laden.'), 409
        for event_id, level in desired.items():
            set_grant(username, event_id, level, current_user().username)
        db.session.commit()
    except (ValueError, TypeError) as error:
        db.session.rollback()
        return jsonify(error=str(error)), 400
    return jsonify({'users': known_users()})
