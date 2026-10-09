"""Identity read endpoint; authentication remains app-wide."""

from flask import Blueprint, jsonify

from auth import current_user


identity = Blueprint('identity', __name__)


@identity.route('/api/auth/me', methods=['GET'])
def get_authenticated_user():
    return jsonify(current_user().to_dict())
