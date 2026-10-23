"""Audit listing; security and mutation audit hooks remain app-wide."""

from flask import Blueprint, jsonify, request
from sqlalchemy import and_, or_

import json
from accommodation_scope import accommodation_event_id
from models import AuditEvent


audit_events = Blueprint('audit_events', __name__)


@audit_events.route('/api/audit-events', methods=['GET'])
def get_audit_events():
    page = max(request.args.get('page', 1, type=int), 1)
    per_page = min(max(request.args.get('perPage', 50, type=int), 1), 200)
    # Only canonical, server-stamped ownership evidence is trusted. Legacy
    # entries and global technical records remain untouched and excluded.
    owner = accommodation_event_id()
    prefix = json.dumps({'championshipEventId': str(owner), '_scope': 'OPERATIONAL_EVENT'})[:-1]
    # PR3/4 atomic confirms already persisted an explicit championship owner in
    # this exact canonical envelope. Do not confuse planning-event IDs with it.
    legacy_import_prefix = json.dumps({'eventId': str(owner)}, separators=(',', ':'))[:-1] + ','
    query = AuditEvent.query.filter(or_(
        AuditEvent.entity_refs_json.startswith(prefix, autoescape=True),
        and_(AuditEvent.entity_type == 'import', AuditEvent.action == 'import',
            AuditEvent.method == 'POST', AuditEvent.path.like('/api/import/sessions/%/import'),
            AuditEvent.entity_refs_json.startswith(legacy_import_prefix, autoescape=True))))
    if request.args.get('username'):
        query = query.filter(AuditEvent.username == request.args['username'])
    if request.args.get('action'):
        query = query.filter(AuditEvent.action == request.args['action'])
    if request.args.get('entityType'):
        query = query.filter(AuditEvent.entity_type == request.args['entityType'])
    result = query.order_by(AuditEvent.created_at.desc()).paginate(page=page, per_page=per_page, error_out=False)
    return jsonify({
        'items': [event.to_dict() for event in result.items],
        'page': result.page,
        'perPage': result.per_page,
        'total': result.total,
        'pages': result.pages,
    })
