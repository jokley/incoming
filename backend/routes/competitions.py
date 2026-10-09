"""Read-only competition catalogue; authentication remains app-wide."""

from flask import Blueprint, jsonify

from models import Competition


competitions = Blueprint('competitions', __name__)


# Competition catalogue (read-only; maintained by the official import mapping)
@competitions.route('/api/competitions', methods=['GET'])
def get_competitions():
    return jsonify([
        competition.to_dict()
        for competition in Competition.query.filter_by(active=True).order_by(
            Competition.sport, Competition.name
        ).all()
    ])
