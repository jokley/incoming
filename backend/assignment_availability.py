"""Read-only, request-local accommodation eligibility; never writes allocations."""
from accommodation_scope import event_query
from datetime import date
from types import SimpleNamespace
from accommodation_coverage import booking_intervals_overlap
from accommodation_mutations import physical_room_usage
from accommodation_defaults import default_counts_as_single


def inventory_guard(inventories, bookings, start, end):
    rooms = sum(i.room_count for i in inventories if i.available_from <= start and i.available_until >= end)
    if not rooms:
        return 'NO_KONTINGENT', 'Kein Kontingent für den benötigten Zeitraum.'
    overlapping = [b for b in bookings if booking_intervals_overlap(b.check_in_date, b.check_out_date, start, end)]
    if physical_room_usage(overlapping) >= rooms:
        return 'KONTINGENT_EXCEEDED', 'Zimmer im benötigten Zeitraum nicht verfügbar.'
    return None


def load_context():
    """Bulk-load only accommodation evidence, without quota/audit projections."""
    from app import _build_virtual_slots
    from models import Athlete, Hotel, HotelRoomInventory, RoomBooking, db
    from accommodation_coverage import person_accommodation_coverage
    people = event_query(Athlete).all()
    bookings = event_query(RoomBooking).options(db.joinedload(RoomBooking.occupants),
        db.joinedload(RoomBooking.hotel), db.joinedload(RoomBooking.room_type)).all()
    hotels = event_query(Hotel).options(db.joinedload(Hotel.room_inventories).joinedload(HotelRoomInventory.room_type)).all()
    by_person = {}
    for booking in bookings:
        from accommodation_scope import validate_serialized_ownership
        validate_serialized_ownership(booking)
        for occupant in booking.occupants:
            by_person.setdefault(occupant.athlete_id, []).append(booking)
    occupants = [{'athleteId':str(person.id),
        'accommodationRequirement':person.accommodation_requirement,
        'single_room_status':person.single_room_status,
        'roomType':person.room_type,
        'accommodationCoverage':person_accommodation_coverage(person.arrival_date,
            person.departure_date,by_person.get(person.id,[]),person.accommodation_requirement)} for person in people]
    sections = []
    inventories = []
    for hotel in hotels:
        by_type = {}
        for inventory in hotel.room_inventories:
            inventories.append(inventory)
            by_type.setdefault(inventory.room_type_id, []).append(inventory)
        sections.append({'hotelId':str(hotel.id),'accommodationType':hotel.accommodation_type,
            'slots':[] if hotel.accommodation_type == 'EXTERNAL' else [slot
                for rows in by_type.values()
                for slot in _build_virtual_slots(hotel,rows[0].room_type,rows,bookings)]})
    return {'units':{'assigned':[],'unassigned':[{'occupants':occupants}]},'hotels':sections}, (inventories,bookings)


def project(planning, needs, population_ids, loaded=None):
    from app import _room_type_label, _planned_room_key
    from models import HotelRoomInventory, RoomBooking, db
    inventories, bookings = loaded if loaded is not None else (
        event_query(HotelRoomInventory).all(),
        event_query(RoomBooking).options(db.joinedload(RoomBooking.occupants)).all())
    inv_index, booking_index = {}, {}
    for inv in inventories:
        inv_index.setdefault((str(inv.hotel_id), str(inv.room_type_id)), []).append(inv)
    for b in bookings:
        booking_index.setdefault((str(b.hotel_id), str(b.room_type_id)), []).append(b)
    people = {p['athleteId']: p for u in planning['units']['assigned'] + planning['units']['unassigned'] for p in u['occupants']}
    validated = []
    seen = set()
    for need in needs:
        ids = list(dict.fromkeys(str(i) for i in need['athleteIds']))
        interval = {k: need[k] for k in ('checkInDate', 'checkOutDate')}
        start, end = (date.fromisoformat(interval[k]) for k in ('checkInDate', 'checkOutDate'))
        valid = bool(ids and len(ids) <= 2 and start < end)
        for identity in ids:
            person = people.get(identity)
            coverage = (person or {}).get('accommodationCoverage', {})
            valid = valid and bool(person and person.get('accommodationRequirement') != 'NO_ROOM' and coverage.get('coverageStatus') != 'CONFLICT' and interval in coverage.get('openIntervals', []))
            marker = (identity, start, end)
            if marker in seen:
                raise ValueError('Doppelter offener Zeitraum')
            seen.add(marker)
        validated.append((need['key'], ids, start, end, valid))

    guard_cache={}

    def cached_guard(key, rows, start, end, excluded=None, extra=()):
        cache_key=(key,start,end,excluded,tuple((b.id,b.room_number,b.check_in_date,b.check_out_date) for b in extra))
        if cache_key not in guard_cache:
            guard_cache[cache_key]=inventory_guard(inv_index.get(key,[]),rows,start,end)
        return guard_cache[cache_key]

    def eligibility(hotel, slot, ids, start, end, valid, extra):
        if not valid:
            return 'Offenen Unterkunftsbedarf prüfen.'
        if hotel.get('accommodationType') == 'EXTERNAL':
            return 'Externes Hotel separat zuweisen.'
        if slot['capacity'] < len(ids):
            return f"Nur {slot['capacity']} Platz verfügbar."
        allowed = ['single', 'double'] if len(ids) == 1 else ['double']
        if _room_type_label(slot['roomTypeName']) not in allowed:
            return 'Zimmer passt nicht zum Zimmerwunsch.'
        key = (hotel['hotelId'], slot['roomTypeId'])
        rows = booking_index.get(key, []) + extra
        failure = cached_guard(key, rows, start, end, extra=extra)
        if failure:
            return failure[1]
        if any((_planned_room_key(b.room_number) or b.room_number) == slot['roomNumber'] and booking_intervals_overlap(b.check_in_date, b.check_out_date, start, end) for b in rows):
            return 'Zimmer im benötigten Zeitraum nicht verfügbar.'
        return None

    def join_reason(hotel, slot, booking, ids, start, end, valid, extra):
        if not valid:
            return 'Offenen Unterkunftsbedarf prüfen.'
        if booking.counts_as_single:
            return 'Zimmer durch EZ-Nutzung gesperrt.'
        if booking.check_in_date != start or booking.check_out_date != end:
            return 'Aufenthaltsdaten stimmen nicht überein.'
        if len(booking.occupants) + len(ids) > slot['capacity']:
            return f"Nur {max(0,slot['capacity']-len(booking.occupants))} Platz verfügbar."
        rows = [b for b in booking_index.get((hotel['hotelId'],slot['roomTypeId']),[]) if b.id != booking.id] + extra
        failure = cached_guard((hotel['hotelId'],slot['roomTypeId']),rows,start,end,excluded=booking.id,extra=extra)
        if failure:
            return failure[1]
        if any((_planned_room_key(b.room_number) or b.room_number)==slot['roomNumber'] and booking_intervals_overlap(b.check_in_date,b.check_out_date,start,end) for b in rows):
            return 'Zimmer im benötigten Zeitraum nicht verfügbar.'
        return None

    targets, fits = {}, {}
    for hotel in planning['hotels']:
        if hotel.get('accommodationType') == 'EXTERNAL':
            continue
        candidates = []
        for key, ids, start, end, valid in validated:
            options = []
            results = targets.setdefault(key, [])
            for slot in hotel['slots']:
                reason = eligibility(hotel, slot, ids, start, end, valid, [])
                results.append({'slotId': slot['slotId'], 'status': 'blocked' if reason else 'valid', 'messages': [reason] if reason else []})
                if not reason:
                    options.append(slot)
            join_options=[]
            for slot in hotel['slots']:
                for booking in booking_index.get((hotel['hotelId'],slot['roomTypeId']),[]):
                    if (_planned_room_key(booking.room_number) or booking.room_number) != slot['roomNumber']:
                        continue
                    reason=join_reason(hotel,slot,booking,ids,start,end,valid,[])
                    results.append({'slotId':f'booking:{booking.id}','status':'blocked' if reason else 'valid','messages':[reason] if reason else []})
                    if not reason:
                        join_options.append((slot,booking))
            candidates.append((len(options)+len(join_options), key, ids, start, end, valid, options,join_options))
        # Individual buttons share this snapshot; no per-person HTTP requests.
        for key, ids, start, end, valid in validated:
            for identity in ids:
                results=targets.setdefault(f'{key}:athlete:{identity}', [])
                for slot in hotel['slots']:
                    reason=eligibility(hotel,slot,[identity],start,end,valid,[])
                    results.append({'slotId':slot['slotId'],'status':'blocked' if reason else 'valid','messages':[reason] if reason else []})
                    for booking in booking_index.get((hotel['hotelId'],slot['roomTypeId']),[]):
                        if (_planned_room_key(booking.room_number) or booking.room_number) == slot['roomNumber']:
                            reason=join_reason(hotel,slot,booking,[identity],start,end,valid,[])
                            results.append({'slotId':f'booking:{booking.id}','status':'blocked' if reason else 'valid','messages':[reason] if reason else []})
        # A constructive feasibility witness, not an allocation or optimizer.
        # Constrained needs first. A partial result is explicitly a lower bound.
        extra_by_type, accommodated = {}, set()
        joined_counts={}
        for _, key, ids, start, end, valid, options, join_options in sorted(candidates, key=lambda c: (c[0], c[3], c[1])):
            if not valid:
                continue
            joined=False
            for slot,booking in join_options:
                if (len(booking.occupants)+joined_counts.get(booking.id,0)+len(ids) <= slot['capacity']
                        and join_reason(hotel,slot,booking,ids,start,end,valid,extra_by_type.get(slot['roomTypeId'],[])) is None):
                    joined_counts[booking.id]=joined_counts.get(booking.id,0)+len(ids)
                    accommodated.update((identity,key) for identity in ids)
                    joined=True
                    break
            if joined:
                continue
            # Reuse a provisional shared room for an identical interval where the
            # existing join workflow would accept another occupant.
            shared=False
            for room_type_id, extra in extra_by_type.items():
                for reservation in extra:
                    if (reservation.check_in_date==start and reservation.check_out_date==end
                            and not reservation.counts_as_single
                            and reservation.occupant_count+len(ids)<=reservation.capacity):
                        reservation.occupant_count+=len(ids)
                        accommodated.update((identity,key) for identity in ids)
                        shared=True
                        break
                if shared:
                    break
            if shared:
                continue
            for slot in sorted(options, key=lambda s: (s['capacity'], s['slotId'])):
                extra = extra_by_type.setdefault(slot['roomTypeId'], [])
                if eligibility(hotel, slot, ids, start, end, valid, extra) is None:
                    single_use = default_counts_as_single(slot['capacity'], len(ids),
                        single_request=any(_room_type_label(people[i].get('roomType')) == 'single' for i in ids),
                        approved_extra=any(people[i].get('single_room_status') == 'APPROVED_EXTRA' for i in ids))
                    extra.append(SimpleNamespace(id=-len(extra)-1, room_number=slot['roomNumber'],
                        check_in_date=start, check_out_date=end, capacity=slot['capacity'],
                        occupant_count=len(ids), counts_as_single=single_use))
                    accommodated.update((identity, key) for identity in ids)
                    break
        required = {(identity, key) for key, ids, *_ in validated for identity in ids
                    if identity in people and people[identity].get('accommodationRequirement') != 'NO_ROOM'}
        total_people = {identity for identity, _ in required}
        complete_people = {identity for identity in total_people if all(pair in accommodated for pair in required if pair[0] == identity)}
        count = len(complete_people)
        used = any(str(o.athlete_id) in population_ids for b in bookings if str(b.hotel_id) == hotel['hotelId'] for o in b.occupants)
        state = 'FIT_ALL' if required and accommodated == required else 'FIT_PARTIAL' if accommodated else 'NO_FIT'
        fits[hotel['hotelId']] = {'state': state, 'count': count, 'total': len(total_people), 'alreadyUsed': used, 'conservative': state == 'FIT_PARTIAL'}
    return {'targets': targets, 'hotels': fits}
