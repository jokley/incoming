"""Identity read endpoint; authentication remains app-wide."""

from flask import Blueprint, jsonify, current_app, request

from auth import current_user


identity = Blueprint('identity', __name__)


@identity.route('/api/auth/me', methods=['GET'])
def get_authenticated_user():
    from user_access import remember_authenticated_user
    remember_authenticated_user(current_user())
    return jsonify(current_user().to_dict())


@identity.route('/api/active-event-context', methods=['GET'])
def get_active_event_context():
    """Only explicit operational capability, never the championship catalogue."""
    from event_ownership_runtime import authorize_event, deployment_event_id
    from models import Event, EventAccess, db
    user = current_user()
    if user.is_superadmin:
        from sqlalchemy import literal
        query = db.session.query(Event, literal(True)).filter(Event.active.is_(True))
    else:
        query = db.session.query(Event, EventAccess.can_write).join(EventAccess).filter(
            EventAccess.username == user.username, Event.active.is_(True))
    pinned = deployment_event_id() if current_app.config.get('OPERATIONAL_EVENT_ID') else None
    if pinned is not None:
        authorize_event(pinned)
        query = query.filter(Event.id == pinned)
    rows = query.order_by(Event.year, Event.id).all()
    requested = request.headers.get('X-Championship-Event-ID')
    if requested is not None:
        selected = authorize_event(requested)
    else:
        selected = pinned or (rows[0][0].id if rows else None)
    return jsonify({
        'events': [{**event.to_dict(), 'canRead': user.has_permission('data.read'),
                    'canWrite': writable and any(user.has_permission(p) for p in
                        ('data.write', 'assignments.write', 'imports.write'))} for event, writable in rows],
        'selectedEventId': str(selected) if selected is not None else None,
        'switchingAllowed': pinned is None and len(rows) > 1,
    })
