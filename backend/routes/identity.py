"""Identity read endpoint; authentication remains app-wide."""

from flask import Blueprint, jsonify

from auth import current_user


identity = Blueprint('identity', __name__)


@identity.route('/api/auth/me', methods=['GET'])
def get_authenticated_user():
    return jsonify(current_user().to_dict())


@identity.route('/api/active-event-context', methods=['GET'])
def get_active_event_context():
    """Only explicit operational capability, never the championship catalogue."""
    from accommodation_scope import accommodation_event_id
    from models import Event, db
    owner = accommodation_event_id()
    event = db.session.get(Event, owner)
    user = current_user()
    return jsonify({
        'events': [{**event.to_dict(), 'canRead': user.has_permission('data.read'),
                    'canWrite': any(user.has_permission(p) for p in
                        ('data.write', 'assignments.write', 'imports.write'))}],
        'selectedEventId': str(owner),
        'switchingAllowed': False,
    })
