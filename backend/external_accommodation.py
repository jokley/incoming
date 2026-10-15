"""Plan external ADDs using the same canonical coverage service as persisted stays."""
import hashlib
import json
from datetime import date
from types import SimpleNamespace
from models import db, Athlete, Hotel
from accommodation_coverage import person_accommodation_coverage
from accommodation_split import SplitError, require, person_bookings


def external_plan(data):
    try:
        if not isinstance(data['athleteIds'], list):
            raise ValueError('Invalid person selection')
        ids = sorted(int(value) for value in data['athleteIds'])
        start, end = date.fromisoformat(data['checkInDate']), date.fromisoformat(data['checkOutDate'])
        hotel = db.session.get(Hotel, int(data['hotelId']))
    except (KeyError, ValueError, TypeError):
        raise SplitError('INVALID_EXTERNAL_STAY', 'Personen, Unterkunft und gültige Daten auswählen.')
    require(1 <= len(ids) <= 2 and len(set(ids)) == len(ids), 'INVALID_PEOPLE', 'Eine Person oder zwei Zimmerpartner auswählen.')
    require(hotel and hotel.accommodation_type == 'EXTERNAL', 'EXTERNAL_REQUIRED', 'Eine externe Unterkunft auswählen.')
    require(start < end, 'INVALID_DATES', 'Von muss vor Bis liegen.')
    frozen = data.get('openInterval')
    require(isinstance(frozen, dict) and all(isinstance(frozen.get(key), str) for key in ('checkInDate', 'checkOutDate')), 'OPEN_INTERVAL_REQUIRED', 'Offenen Zeitraum auswählen.')
    from app import _initialize_new_booking_counts_as_single
    flag = _initialize_new_booking_counts_as_single({'athleteIds': ids})['countsAsSingle']
    people, state = [], [hotel.id, hotel.name, hotel.accommodation_type, ids, frozen, start, end]
    for identity in ids:
        person = db.session.get(Athlete, identity)
        require(person is not None, 'PERSON_NOT_FOUND', 'Person wurde entfernt. Bitte Ansicht aktualisieren.', 409)
        bookings = person_bookings(identity)
        before = person_accommodation_coverage(person.arrival_date, person.departure_date, bookings)
        require(before['coverageStatus'] != 'CONFLICT' and frozen in before['openIntervals'],
                'STALE_EXTERNAL_STAY', 'Offener Aufenthalt hat sich geändert. Bitte Ansicht aktualisieren.', 409)
        require(frozen['checkInDate'] <= start.isoformat() < end.isoformat() <= frozen['checkOutDate'],
                'OUTSIDE_OPEN_INTERVAL', 'Daten müssen innerhalb des gewählten offenen Zeitraums liegen.')
        projected = SimpleNamespace(id=-1, hotel_id=hotel.id, hotel=hotel, room_type_id=None, room_type=None,
            room_number=None, check_in_date=start, check_out_date=end, counts_as_single=flag)
        coverage = person_accommodation_coverage(person.arrival_date, person.departure_date, [*bookings, projected])
        require(coverage['coverageStatus'] != 'CONFLICT', 'ACCOMMODATION_CONFLICT', 'Aufenthalt prüfen.')
        people.append({'personId': str(person.id), 'name': f'{person.firstname} {person.lastname}'.strip(),
                       'accommodationCoverage': coverage})
        state.append([person.id, person.arrival_date, person.departure_date, person.updated_at,
                      person.single_room_status, person.single_room_decision_id,
                      [b.to_dict() for b in sorted(bookings, key=lambda b:b.id)]])
    token = hashlib.sha256(json.dumps(state, default=str, sort_keys=True).encode()).hexdigest()
    return {'previewToken': token, 'hotelId': str(hotel.id), 'hotelName': hotel.name,
            'athleteIds': [str(i) for i in ids], 'checkInDate': start.isoformat(), 'checkOutDate': end.isoformat(),
            'openInterval': frozen, 'people': people}
