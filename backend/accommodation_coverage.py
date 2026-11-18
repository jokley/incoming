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


def person_disposition_status(person, coverage, bookings, allocation, *, room_request_kind=None,
                              quota_contexts=(), approved_contexts=()):
    """Explain existing persisted evidence; never allocate slots or change decisions.

    Room preference compares the imported wish to physical occupancy. A sole DZ
    with single valuation is explicit single use; without it the desired shared
    use is not established. Unknown inventory/occupants/dates never imply MATCH.
    """
    # A source label such as "Double single" does not establish a shared-DZ wish.
    # Keep the original label and leave this ambiguous preference unevaluated.
    if room_request_kind == 'double' and 'single' in str(person.get('roomRequest') or '').casefold():
        room_request_kind = None
    unique = {str(b.id): b for b in bookings}
    segments = []
    for source in coverage['segments']:
        booking = unique[source['bookingId']]
        capacity = getattr(booking.room_type, 'max_persons', None) if booking.room_type else None
        occupants = {item.athlete_id for item in getattr(booking, 'occupants', [])}
        count = len(occupants)
        physical = ('SINGLE_ROOM' if capacity == 1 and count == 1 else
                    'SHARED_DOUBLE' if capacity == 2 and count == 2 else
                    'SOLE_DOUBLE' if capacity == 2 and count == 1 else 'UNKNOWN')
        actual_single = physical == 'SINGLE_ROOM' or (physical == 'SOLE_DOUBLE' and source['countsAsSingle'])
        shared_double = physical == 'SHARED_DOUBLE' and not source['countsAsSingle']
        comparison = 'UNKNOWN'
        if not source['conflictCodes'] and room_request_kind in {'single', 'double'}:
            if actual_single:
                comparison = 'MATCH' if room_request_kind == 'single' else 'MISMATCH'
            elif shared_double:
                comparison = 'MATCH' if room_request_kind == 'double' else 'MISMATCH'
        segments.append({**source, 'capacity': capacity, 'occupantCount': count,
                         'physicalUsage': physical, 'comparison': comparison})
    mismatch = any(s['comparison'] == 'MISMATCH' for s in segments)
    preference = ('NOT_APPLICABLE' if person.get('accommodationRequirement') == 'NO_ROOM' else
                  'UNASSIGNED' if not segments else 'MISMATCH' if mismatch else
                  'MATCH' if coverage['coverageStatus'] == 'FULLY_ASSIGNED' and
                  all(s['comparison'] == 'MATCH' for s in segments) else 'UNKNOWN')
    single = any(b.counts_as_single for b in unique.values())
    status = allocation['status'] if single and allocation else 'UNKNOWN' if single else 'NO_SINGLE_USE'
    context = allocation['context'] if single and allocation else None
    reason = ('Kein gültiger Quotenkontext zuordenbar' if status == 'PENDING' and context is None else
              'Keine reguläre EZ-Deckung oder anwendbare Zusatzgenehmigung' if status == 'PENDING' else
              'EZ-Bewertung nicht verfügbar' if status == 'UNKNOWN' else None)
    approval_applicable = bool(person.get('singleRoomStatus') == 'APPROVED_EXTRA'
                              and not person.get('singleRoomQuotaExemptReason') and approved_contexts)
    return {k: person.get(k) for k in ('personId', 'eventId', 'name', 'nationCode', 'personalGender',
                                      'personType', 'function', 'sportFamilies', 'quotaDisciplines')} | {
        'personId': str(person['personId']),
        'accommodationRequirement': person.get('accommodationRequirement') or 'REQUIRED',
        'quotaContexts': [list(c) for c in sorted(quota_contexts)],
        'accommodation': coverage,
        'roomPreference': {'reportedValue': person.get('roomRequest'),
                           'reportedKind': room_request_kind.upper() if room_request_kind in {'single', 'double'} else 'UNKNOWN',
                           'status': preference, 'hasMismatch': mismatch and preference != 'NOT_APPLICABLE',
                           'segments': segments},
        'singleRoom': {'hasSingleUse': single, 'status': status, 'context': context,
                       'eligibleContexts': allocation['eligibleContexts'] if single and allocation else [],
                       'bookingIds': sorted(key for key,b in unique.items() if b.counts_as_single),
                       'storedApprovalId': person.get('singleRoomDecisionId'),
                       'approvalApplicable': approval_applicable,
                       'applicableApprovalId': person.get('singleRoomDecisionId') if approval_applicable else None,
                       'approvedContexts': [list(c) for c in sorted(approved_contexts)] if approval_applicable else [],
                       'exemptionReason': person.get('singleRoomQuotaExemptReason'), 'reason': reason}}


def summarize_person_disposition(people,excluded_accommodation_ids=()):
    """Each counter is a predicate over the same unique, displayed people list.

    Accommodation, room preference and single-use categories can overlap; their
    sum is not a distinct total, nor is it a count of open quota contexts.
    """
    people = list({p['personId']: p for p in people}.values())
    excluded=set(excluded_accommodation_ids)
    accommodation_people=[p for p in people if p['personId'] not in excluded]
    statuses = [p['accommodation']['coverageStatus'] for p in accommodation_people]
    pending = [p for p in people if p['singleRoom']['status'] == 'PENDING']
    return {'peopleTotal': len(people),
            'accommodationPeopleRequired': sum(p['accommodationRequirement'] != 'NO_ROOM' for p in accommodation_people),
            'fullyAssigned': statuses.count('FULLY_ASSIGNED'), 'unassigned': statuses.count('UNASSIGNED'),
            'partiallyAssigned': statuses.count('PARTIALLY_ASSIGNED'), 'accommodationConflicts': statuses.count('CONFLICT'),
            'roomPreferenceMismatches': sum(p['roomPreference']['hasMismatch'] for p in people),
            'pendingSingleRoomPeople': len(pending),
            'contextlessPendingSingleRoomPeople': sum(p['singleRoom']['context'] is None for p in pending)}
