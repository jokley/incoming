"""Hotel HTTP routes; authentication and mutation auditing remain app-wide."""

from datetime import datetime

from flask import Blueprint, jsonify, request
from sqlalchemy import or_

from models import (db, Athlete, Competition, Hotel, HotelRoomInventory,
                    RoomAssignment, RoomBooking, RoomBookingOccupant, RoomType)


hotels = Blueprint('hotels', __name__)


# Hotels - CRUD
@hotels.route('/api/hotels', methods=['GET'])
@hotels.route('/api/hotels/', methods=['GET'])
@hotels.route('/hotels', methods=['GET'])
@hotels.route('/hotels/', methods=['GET'])
def get_hotels():
    # This collection is a shared read model used by Dashboard, Hotels, Lists
    # and Analytics.  Load the complete projection in a fixed number of queries
    # instead of lazily issuing one inventory query per hotel (and potentially
    # one room-type query per inventory).
    hotels = Hotel.query.options(
        db.selectinload(Hotel.room_inventories).joinedload(HotelRoomInventory.room_type)
    ).all()
    return jsonify([h.to_dict() for h in hotels])


@hotels.route('/api/hotels/<int:hotel_id>', methods=['GET'])
@hotels.route('/api/hotels/<int:hotel_id>/', methods=['GET'])
@hotels.route('/hotels/<int:hotel_id>', methods=['GET'])
@hotels.route('/hotels/<int:hotel_id>/', methods=['GET'])
def get_hotel(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    return jsonify(hotel.to_dict())


@hotels.route('/api/hotels', methods=['POST'])
@hotels.route('/api/hotels/', methods=['POST'])
@hotels.route('/hotels', methods=['POST'])
@hotels.route('/hotels/', methods=['POST'])
def create_hotel():
    data = request.json
    hotel = Hotel(
        name=data['name'],
        location=data.get('location'),
        region=data.get('region'),
        contact_person=data.get('contactPerson'),
        email=data.get('email'),
        phone=data.get('phone'),
        comment=data.get('comment')
    )
    db.session.add(hotel)
    db.session.commit()
    return jsonify(hotel.to_dict()), 201


@hotels.route('/api/hotels/<int:hotel_id>', methods=['PUT'])
@hotels.route('/api/hotels/<int:hotel_id>/', methods=['PUT'])
@hotels.route('/hotels/<int:hotel_id>', methods=['PUT'])
@hotels.route('/hotels/<int:hotel_id>/', methods=['PUT'])
def update_hotel(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    data = request.json

    if 'name' in data:
        hotel.name = data['name']
    if 'location' in data:
        hotel.location = data['location']
    if 'region' in data:
        hotel.region = data['region']
    if 'contactPerson' in data:
        hotel.contact_person = data['contactPerson']
    if 'email' in data:
        hotel.email = data['email']
    if 'phone' in data:
        hotel.phone = data['phone']
    if 'comment' in data:
        hotel.comment = data['comment']

    db.session.commit()
    return jsonify(hotel.to_dict())


@hotels.route('/api/hotels/<int:hotel_id>', methods=['DELETE'])
@hotels.route('/api/hotels/<int:hotel_id>/', methods=['DELETE'])
@hotels.route('/hotels/<int:hotel_id>', methods=['DELETE'])
@hotels.route('/hotels/<int:hotel_id>/', methods=['DELETE'])
def delete_hotel(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    db.session.delete(hotel)
    db.session.commit()
    return '', 204


# Hotel Room Inventory
@hotels.route('/api/hotels/<int:hotel_id>/inventory', methods=['POST'])
@hotels.route('/api/hotels/<int:hotel_id>/inventory/', methods=['POST'])
@hotels.route('/hotels/<int:hotel_id>/inventory', methods=['POST'])
@hotels.route('/hotels/<int:hotel_id>/inventory/', methods=['POST'])
def add_hotel_inventory(hotel_id):
    hotel = Hotel.query.get_or_404(hotel_id)
    data = request.json

    inventory = HotelRoomInventory(
        hotel_id=hotel_id,
        room_type_id=int(data['roomTypeId']),
        available_from=datetime.fromisoformat(data['availableFrom']).date(),
        available_until=datetime.fromisoformat(data['availableUntil']).date(),
        room_count=int(data['roomCount']),
        has_half_board=data.get('hasHalfBoard', False),
        has_sr=data.get('hasSR', False),
        comment=data.get('comment')
    )
    db.session.add(inventory)
    db.session.commit()
    return jsonify(inventory.to_dict()), 201


@hotels.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['PUT'])
@hotels.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['PUT'])
@hotels.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['PUT'])
@hotels.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['PUT'])
def update_hotel_inventory(hotel_id, inventory_id):
    inventory = HotelRoomInventory.query.filter_by(id=inventory_id, hotel_id=hotel_id).first_or_404()
    data = request.json
    inventory.room_type_id = int(data['roomTypeId'])
    inventory.available_from = datetime.fromisoformat(data['availableFrom']).date()
    inventory.available_until = datetime.fromisoformat(data['availableUntil']).date()
    inventory.room_count = int(data['roomCount'])
    inventory.has_half_board = data.get('hasHalfBoard', False)
    inventory.has_sr = data.get('hasSR', False)
    inventory.comment = data.get('comment')
    db.session.commit()
    return jsonify(inventory.to_dict())


@hotels.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['DELETE'])
@hotels.route('/api/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['DELETE'])
@hotels.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>', methods=['DELETE'])
@hotels.route('/hotels/<int:hotel_id>/inventory/<int:inventory_id>/', methods=['DELETE'])
def delete_hotel_inventory(hotel_id, inventory_id):
    inventory = HotelRoomInventory.query.filter_by(
        id=inventory_id,
        hotel_id=hotel_id
    ).first_or_404()
    db.session.delete(inventory)
    db.session.commit()
    return '', 204


@hotels.route('/api/hotels/capacity-overview', methods=['GET'])
def get_hotels_capacity_overview():
    hotel_id = request.args.get('hotel_id', type=int)
    room_type_id = request.args.get('room_type_id', type=int)
    nation = request.args.get('nation')
    discipline = request.args.get('discipline')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    start_date = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else None
    end_date = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else None

    inventory_query = HotelRoomInventory.query.join(RoomType)
    if hotel_id:
        inventory_query = inventory_query.filter(HotelRoomInventory.hotel_id == hotel_id)
    if room_type_id:
        inventory_query = inventory_query.filter(HotelRoomInventory.room_type_id == room_type_id)
    if start_date and end_date:
        inventory_query = inventory_query.filter(
            HotelRoomInventory.available_from <= end_date,
            HotelRoomInventory.available_until >= start_date
        )

    booking_query = RoomBookingOccupant.query.join(RoomBooking).join(Athlete).join(RoomType, RoomBooking.room_type_id == RoomType.id)
    if hotel_id:
        booking_query = booking_query.filter(RoomBooking.hotel_id == hotel_id)
    if room_type_id:
        booking_query = booking_query.filter(RoomBooking.room_type_id == room_type_id)
    if nation:
        booking_query = booking_query.filter(Athlete.nation_code == nation)
    if discipline:
        booking_query = booking_query.filter(
            or_(Athlete.competitions.any(Competition.name == discipline), Athlete.discipline == discipline)
        )
    if start_date and end_date:
        booking_query = booking_query.filter(
            RoomBooking.check_in_date.isnot(None),
            RoomBooking.check_out_date.isnot(None),
            RoomBooking.check_in_date <= end_date,
            RoomBooking.check_out_date >= start_date
        )

    hotel_map = {}

    for inv in inventory_query.all():
        hid = inv.hotel_id
        if hid not in hotel_map:
            hotel_map[hid] = {
                'hotel': {'id': str(inv.hotel.id), 'name': inv.hotel.name, 'location': inv.hotel.location, 'region': inv.hotel.region},
                'roomTypes': {},
                'totals': {'inventoryRooms': 0, 'inventoryBeds': 0, 'occupiedRooms': 0, 'occupiedBeds': 0}
            }

        rt_id = str(inv.room_type.id)
        rt_entry = hotel_map[hid]['roomTypes'].setdefault(rt_id, {
            'roomType': inv.room_type.to_dict(),
            'inventoryRooms': 0,
            'inventoryBeds': 0,
            'occupiedBeds': 0
        })
        rt_entry['inventoryRooms'] += inv.room_count
        rt_entry['inventoryBeds'] += inv.room_count * inv.room_type.max_persons

    for occ in booking_query.all():
        booking = occ.room_booking
        if not booking:
            continue
        hid = booking.hotel_id
        if hid not in hotel_map:
            hotel_map[hid] = {
                'hotel': {'id': str(booking.hotel.id), 'name': booking.hotel.name, 'location': booking.hotel.location, 'region': booking.hotel.region},
                'roomTypes': {},
                'totals': {'inventoryRooms': 0, 'inventoryBeds': 0, 'occupiedRooms': 0, 'occupiedBeds': 0}
            }

        rt_id = str(booking.room_type.id)
        rt_entry = hotel_map[hid]['roomTypes'].setdefault(rt_id, {
            'roomType': booking.room_type.to_dict(),
            'inventoryRooms': 0,
            'inventoryBeds': 0,
            'occupiedBeds': 0
        })
        rt_entry['occupiedBeds'] += 1

    result = []
    for hdata in hotel_map.values():
        room_types = []
        for rt in hdata['roomTypes'].values():
            occ_rooms = (rt['occupiedBeds'] + rt['roomType']['maxPersons'] - 1) // rt['roomType']['maxPersons'] if rt['roomType']['maxPersons'] > 0 else 0
            rt['occupiedRooms'] = occ_rooms
            rt['remainingRooms'] = max(0, rt['inventoryRooms'] - occ_rooms)
            rt['remainingBeds'] = max(0, rt['inventoryBeds'] - rt['occupiedBeds'])
            room_types.append(rt)

            hdata['totals']['inventoryRooms'] += rt['inventoryRooms']
            hdata['totals']['inventoryBeds'] += rt['inventoryBeds']
            hdata['totals']['occupiedRooms'] += occ_rooms
            hdata['totals']['occupiedBeds'] += rt['occupiedBeds']

        hdata['totals']['remainingRooms'] = max(0, hdata['totals']['inventoryRooms'] - hdata['totals']['occupiedRooms'])
        hdata['totals']['remainingBeds'] = max(0, hdata['totals']['inventoryBeds'] - hdata['totals']['occupiedBeds'])
        hdata['roomTypes'] = room_types
        result.append(hdata)

    return jsonify(result)


@hotels.route('/api/hotels/<int:hotel_id>/reservations', methods=['GET'])
def get_hotel_reservations(hotel_id):
    room_type_id = request.args.get('room_type_id', type=int)
    nation = request.args.get('nation')
    discipline = request.args.get('discipline')
    start_date = request.args.get('start_date')
    end_date = request.args.get('end_date')

    start_date = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else None
    end_date = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else None

    q = RoomAssignment.query.join(RoomAssignment.athlete).join(RoomType).filter(RoomAssignment.hotel_id == hotel_id)
    if room_type_id:
        q = q.filter(RoomAssignment.room_type_id == room_type_id)
    if nation:
        q = q.filter(Athlete.nation_code == nation)
    if discipline:
        q = q.filter(
            or_(Athlete.competitions.any(Competition.name == discipline), Athlete.discipline == discipline)
        )
    if start_date and end_date:
        q = q.filter(RoomAssignment.check_in_date <= end_date, RoomAssignment.check_out_date >= start_date)

    assignments = q.order_by(RoomAssignment.check_in_date.asc().nullslast()).all()
    rows = []
    for a in assignments:
        rows.append({
            'assignmentId': str(a.id),
            'roomNumber': a.room_number,
            'roomType': a.room_type.to_dict(),
            'occupancy': 2 if a.shared_with else 1,
            'guestName': f"{a.athlete.firstname} {a.athlete.lastname}",
            'sharedWithName': f"{a.shared_with.firstname} {a.shared_with.lastname}" if a.shared_with else None,
            'nationCode': a.athlete.nation_code,
            'discipline': a.athlete.discipline,
            'checkInDate': a.check_in_date.isoformat() if a.check_in_date else None,
            'checkOutDate': a.check_out_date.isoformat() if a.check_out_date else None,
            'specialNotes': a.athlete.special_meal
        })
    return jsonify(rows)
