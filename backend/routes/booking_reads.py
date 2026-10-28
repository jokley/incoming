"""Booking read aliases; writes, planning and security retain their ownership."""
from accommodation_scope import event_query, accommodation_event_id
from stay_window import assess_stay, load_stay_schedule

from flask import Blueprint, jsonify

from models import RoomBooking, RoomBookingOccupant, Athlete
from sqlalchemy.orm import selectinload, joinedload


booking_reads = Blueprint('booking_reads', __name__)


def _get_grouped_room_bookings_response():
    bookings = event_query(RoomBooking).options(
        joinedload(RoomBooking.hotel), joinedload(RoomBooking.room_type),
        selectinload(RoomBooking.occupants).joinedload(RoomBookingOccupant.athlete)
            .selectinload(Athlete.competitions),
    ).order_by(RoomBooking.hotel_id, RoomBooking.room_number, RoomBooking.id).all()
    schedule = load_stay_schedule(accommodation_event_id())
    rows = []
    for booking in bookings:
        row = booking.to_dict()
        occupants = {str(o.athlete.id): o.athlete for o in booking.occupants if o.athlete}
        for occupant in row['occupants']:
            person = occupants[occupant['athlete']['id']]
            occupant['athlete']['stayWindow'] = assess_stay(booking.check_in_date,booking.check_out_date,
                person.competitions,schedule,person.accommodation_requirement)
        rows.append(row)
    return jsonify(rows)


@booking_reads.route('/api/room-bookings/grouped', methods=['GET'])
@booking_reads.route('/api/room-bookings/grouped/', methods=['GET'])
@booking_reads.route('/room-bookings/grouped', methods=['GET'])
@booking_reads.route('/room-bookings/grouped/', methods=['GET'])
@booking_reads.route('/api/room-assignments/grouped', methods=['GET'])
@booking_reads.route('/api/room-assignments/grouped/', methods=['GET'])
def get_grouped_room_bookings():
    return _get_grouped_room_bookings_response()


@booking_reads.route('/api/room-assignments', methods=['GET'])
@booking_reads.route('/api/room-assignments/', methods=['GET'])
@booking_reads.route('/room-assignments', methods=['GET'])
@booking_reads.route('/room-assignments/', methods=['GET'])
def get_room_assignments():
    # Backward-compatible alias. Canonical read endpoint is /api/room-bookings/grouped.
    return _get_grouped_room_bookings_response()
