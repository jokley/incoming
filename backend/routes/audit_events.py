"""Audit listing; security and mutation audit hooks remain app-wide."""

from flask import Blueprint, jsonify, request

from models import AuditEvent


audit_events = Blueprint('audit_events', __name__)


@audit_events.route('/api/audit-events', methods=['GET'])
def get_audit_events():
    page = max(request.args.get('page', 1, type=int), 1)
    per_page = min(max(request.args.get('perPage', 50, type=int), 1), 200)
    query = AuditEvent.query
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
