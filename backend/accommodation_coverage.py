"""Read-only person coverage. Booking nights use [check-in, check-out).

Inventory dates deliberately retain their existing contract. Overlapping,
otherwise valid segments contribute to diagnostic coverage, but conflicts always
override coverage status. Invalid/out-of-stay segments are never clipped.
"""
from datetime import date, datetime


def booking_intervals_overlap(start_a, end_a, start_b, end_b):
    return bool(start_a and end_a and start_b and end_b
                and start_a < end_a and start_b < end_b
                and start_a < end_b and start_b < end_a)


def _date(value):
    if isinstance(value, datetime):
        return value.date()
    return value if isinstance(value, date) else None


def _interval(start, end):
    return {'checkInDate': start.isoformat() if start else None,
            'checkOutDate': end.isoformat() if end else None}


def person_accommodation_coverage(arrival, departure, bookings, requirement='REQUIRED'):
    """Calculate one person's coverage from all their bookings, without writes."""
    start, end = _date(arrival), _date(departure)
    if requirement == 'NO_ROOM':
        records = list(bookings)
        if not records:
            return {'overallInterval': _interval(start, end), 'segments': [], 'coveredIntervals': [],
                    'openIntervals': [], 'conflicts': [], 'coverageStatus': 'NO_ROOM',
                    'accommodationRequirement': 'NO_ROOM'}
        diagnostic = person_accommodation_coverage(arrival, departure, records)
        diagnostic.update(coverageStatus='CONFLICT', openIntervals=[], accommodationRequirement='NO_ROOM')
        diagnostic['conflicts'].append({'code': 'NO_ROOM_HAS_BOOKINGS', 'bookingIds': [str(b.id) for b in records]})
        return diagnostic
    overall_valid = bool(start and end and start < end)
    conflicts, segments, candidates, dated = [], [], [], []

    def conflict(code, ids=()):
        conflicts.append({'code': code, 'bookingIds': [str(value) for value in ids]})

    if not start or not end:
        conflict('PERSON_STAY_MISSING_DATES')
    elif start >= end:
        conflict('PERSON_STAY_INVALID_RANGE')

    # A booking shared by legacy source records is still one reservation.
    unique = {booking.id: booking for booking in bookings}
    ordered = sorted(unique.values(), key=lambda b: (
        _date(b.check_in_date) or date.max, _date(b.check_out_date) or date.max, b.id))
    for booking in ordered:
        left, right = _date(booking.check_in_date), _date(booking.check_out_date)
        codes = []
        if not left or not right:
            codes.append('BOOKING_MISSING_DATES')
        elif left >= right:
            codes.append('BOOKING_INVALID_RANGE')
        elif overall_valid and (left < start or right > end):
            codes.append('BOOKING_OUTSIDE_PERSON_STAY')
        for code in codes:
            conflict(code, [booking.id])
        segments.append({
            'bookingId': str(booking.id), 'hotelId': str(booking.hotel_id),
            'hotelName': booking.hotel.name if booking.hotel else None,
            'accommodationType': getattr(booking.hotel, 'accommodation_type', 'STANDARD'),
            'roomTypeId': str(booking.room_type_id) if booking.room_type_id else None,
            'roomTypeName': booking.room_type.name if booking.room_type else None,
            'roomNumber': booking.room_number, **_interval(left, right),
            'countsAsSingle': bool(booking.counts_as_single), 'conflictCodes': codes,
        })
        if left and right and left < right:
            dated.append((left, right, booking.id, codes))
        if overall_valid and not codes:
            candidates.append((left, right, booking.id, codes))

    active = []
    for left, right, booking_id, codes in dated:
        active = [item for item in active if item[1] > left]
        for _, _, previous_id, previous_codes in active:
            conflict('BOOKING_OVERLAP', [previous_id, booking_id])
            if 'BOOKING_OVERLAP' not in previous_codes:
                previous_codes.append('BOOKING_OVERLAP')
            if 'BOOKING_OVERLAP' not in codes:
                codes.append('BOOKING_OVERLAP')
        active.append((left, right, booking_id, codes))

    covered = []
    for left, right, _, _ in candidates:
        if covered and left <= covered[-1][1]:
            covered[-1] = (covered[-1][0], max(covered[-1][1], right))
        else:
            covered.append((left, right))
    gaps = []
    if overall_valid:
        cursor = start
        for left, right in covered:
            if cursor < left:
                gaps.append((cursor, left))
            cursor = max(cursor, right)
        if cursor < end:
            gaps.append((cursor, end))
    status = ('CONFLICT' if conflicts else 'UNASSIGNED' if not covered else
              'PARTIALLY_ASSIGNED' if gaps else 'FULLY_ASSIGNED')
    return {'overallInterval': _interval(start, end), 'segments': segments,
            'coveredIntervals': [_interval(*item) for item in covered],
            'openIntervals': [_interval(*item) for item in gaps],
            'conflicts': conflicts, 'coverageStatus': status}
