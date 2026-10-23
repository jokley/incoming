"""Room type HTTP routes; authentication and mutation auditing remain app-wide."""

from flask import Blueprint, jsonify, request

from models import db, HotelRoomInventory, RoomType, RoomBooking, RoomAssignment, EventRoomDemand
from accommodation_scope import accommodation_event_id


room_types = Blueprint('room_types', __name__)


# Room Types - CRUD
@room_types.route('/api/room-types', methods=['GET'])
@room_types.route('/api/room-types/', methods=['GET'])
@room_types.route('/room-types', methods=['GET'])
@room_types.route('/room-types/', methods=['GET'])
def get_room_types():
    room_types = RoomType.query.all()
    return jsonify([rt.to_dict() for rt in room_types])


@room_types.route('/api/room-types', methods=['POST'])
@room_types.route('/api/room-types/', methods=['POST'])
@room_types.route('/room-types', methods=['POST'])
@room_types.route('/room-types/', methods=['POST'])
def create_room_type():
    data = request.json
    room_type = RoomType(
        name=data['name'],
        max_persons=data['maxPersons']
    )
    db.session.add(room_type)
    db.session.commit()
    return jsonify(room_type.to_dict()), 201


@room_types.route('/api/room-types/<int:room_type_id>', methods=['PUT'])
@room_types.route('/api/room-types/<int:room_type_id>/', methods=['PUT'])
@room_types.route('/room-types/<int:room_type_id>', methods=['PUT'])
@room_types.route('/room-types/<int:room_type_id>/', methods=['PUT'])
def update_room_type(room_type_id):
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    room_type = RoomType.query.get_or_404(room_type_id)
    data = request.json

    if 'name' in data:
        room_type.name = data['name']
    if 'maxPersons' in data and data['maxPersons'] != room_type.max_persons:
        owner = accommodation_event_id()
        if (HotelRoomInventory.query.filter(HotelRoomInventory.room_type_id == room_type_id, HotelRoomInventory.event_id != owner).first()
                or RoomBooking.query.filter(RoomBooking.room_type_id == room_type_id, RoomBooking.event_id != owner).first()):
            return jsonify(error='GLOBAL_MASTER_IN_USE', message='Zimmerkapazität wird von einem anderen Event verwendet.'), 409
    if 'maxPersons' in data:
        room_type.max_persons = data['maxPersons']

    db.session.commit()
    return jsonify(room_type.to_dict())


@room_types.route('/api/room-types/<int:room_type_id>', methods=['DELETE'])
@room_types.route('/api/room-types/<int:room_type_id>/', methods=['DELETE'])
@room_types.route('/room-types/<int:room_type_id>', methods=['DELETE'])
@room_types.route('/room-types/<int:room_type_id>/', methods=['DELETE'])
def delete_room_type(room_type_id):
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    room_type = RoomType.query.get_or_404(room_type_id)
    if any(model.query.filter_by(room_type_id=room_type_id).first() for model in (RoomBooking, RoomAssignment, EventRoomDemand)):
        return jsonify(error='ROOM_TYPE_IN_USE', message='Zimmertyp wird von Buchungen oder Bedarfsplanung verwendet.'), 409
    owner = accommodation_event_id()
    if HotelRoomInventory.query.filter(HotelRoomInventory.room_type_id == room_type_id, HotelRoomInventory.event_id != owner).first():
        return jsonify(error='ROOM_TYPE_IN_USE', message='Zimmertyp wird von einem anderen Event verwendet.'), 409
    usage_count = HotelRoomInventory.query.filter_by(room_type_id=room_type_id, event_id=owner).count()
    if usage_count:
        return jsonify({
            'error': 'ROOM_TYPE_IN_USE',
            'message': f'Dieser Zimmertyp wird aktuell in {usage_count} Zimmerkontingenten verwendet.',
            'usageCount': usage_count,
        }), 409
    db.session.delete(room_type)
    db.session.commit()
    return '', 204
