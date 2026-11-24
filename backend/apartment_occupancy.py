"""Shared nightly apartment constraints for reads and transactional booking writes."""

from datetime import datetime, timezone


def valid_layout(layout, maximum):
    return (isinstance(layout, dict) and isinstance(layout.get('bedrooms'), list)
            and 0 < len(layout['bedrooms']) <= 20
            and all(type(beds) is int and beds in (1, 2) for beds in layout['bedrooms'])
            and type(layout.get('showers')) is int and 0 < layout['showers'] <= 20
            and type(maximum) is int and 0 < maximum <= sum(layout['bedrooms']))


def evaluate(layout, maximum, bedroom, count, bookings, start, end):
    """Return hard failure and the precise sets of regular rules exceeded."""
    if type(bedroom) is not int or not 1 <= bedroom <= len(layout['bedrooms']):
        return 'Bitte einen vorhandenen Schlafraum wählen.', []
    if count > layout['bedrooms'][bedroom - 1]:
        return 'Der Schlafraum hat zu wenige physische Schlafplätze.', []
    relevant = [row for row in bookings if row.check_in_date is None or row.check_out_date is None
                or row.check_in_date < end and start < row.check_out_date]
    if any(row.bedroom_index is None or row.bedroom_index == bedroom for row in relevant):
        return 'Schlafraum belegt oder bestehende Apartmentbuchung ohne eindeutigen Schlafraum.', []
    nights = sorted({start, *(row.check_in_date for row in relevant if row.check_in_date
                              and start <= row.check_in_date < end)})
    rules = set()
    for date in nights:
        active = [row for row in relevant if row.check_in_date and row.check_out_date
                  and row.check_in_date <= date < row.check_out_date]
        if any(row.check_in_date is None or row.check_out_date is None for row in relevant):
            return 'Bestehende Apartmentbuchung ohne eindeutigen Zeitraum.', []
        if len({row.bedroom_index for row in active} | {bedroom}) > layout['showers']:
            rules.add('DU')
        if count + sum(len(row.occupants) for row in active) > maximum:
            rules.add('MAX_PERSONS')
    return None, sorted(rules)


def exception_evidence(rules, reason, user, inventory_id, room_number, bedroom, start, end):
    return {
        'rules': rules, 'reason': reason, 'username': user.username,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'inventoryId': str(inventory_id), 'roomNumber': room_number, 'bedroomIndex': bedroom,
        'checkInDate': start.isoformat(), 'checkOutDate': end.isoformat(),
    }


def audit_apartment_change(booking, activity, evidence):
    from flask import g, request
    from auth import current_user
    from accommodation_scope import event_audit_refs
    from models import AuditEvent, db
    import json

    user = current_user()
    db.session.add(AuditEvent(
        username=user.username, display_name=user.display_name, email=user.email,
        groups_json=json.dumps(list(user.groups)), action='assign', entity_type='assignments',
        entity_id=str(booking.id), request_id=g.request_id, method=request.method, path=request.path,
        activity=activity, category='Disposition',
        changes_json=json.dumps(evidence, ensure_ascii=False),
        entity_refs_json=event_audit_refs({'bookingId': str(booking.id)}, booking.event_id),
    ))

def audit_exception(booking):
    if booking.apartment_exception:
        audit_apartment_change(booking, 'Apartmentausnahme bestätigt', booking.apartment_exception)
