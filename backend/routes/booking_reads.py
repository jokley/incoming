"""Booking read aliases; writes, planning and security retain their ownership."""

from flask import Blueprint, jsonify

from models import RoomBooking


booking_reads = Blueprint('booking_reads', __name__)


def _get_grouped_room_bookings_response():
    bookings = RoomBooking.query.order_by(RoomBooking.hotel_id, RoomBooking.room_number, RoomBooking.id).all()
    return jsonify([b.to_dict() for b in bookings])


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
