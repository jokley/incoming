"""Read-only MIN/MAX event window; arrival inclusive, departure exclusive.

AccommodationEvent end_date is an inclusive event day. allowedEnd=end+1 is
an exclusive checkout boundary. No tariff, approval or import evidence changes.
"""
from collections import defaultdict
from datetime import date, timedelta
import re


def _date(value):
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def _label(value):
    # Same readable catalogue labels as the UI; no import-code/date inference.
    name = re.sub(r"^(men's|women's|mixed)\s+", '', value or '', flags=re.I)
    return re.sub(r'^(snowboard|freeski)\s+(?=big air$|halfpipe$|slopestyle$)', '', name, flags=re.I).strip().casefold()


def load_stay_schedule(event_id):
    """One bulk query per projection, scoped to the championship."""
    from models import AccommodationEvent
    return AccommodationEvent.query.filter_by(championship_event_id=event_id).all()


def assess_stay(arrival, departure, competitions, schedule, requirement='REQUIRED'):
    """All memberships must resolve uniquely; missing dates remain unknown."""
    start, end = _date(arrival), _date(departure)
    result = dict(eventStart=None, eventEnd=None, allowedStart=None, allowedEnd=None,
                  arrivalDate=start.isoformat() if start else None,
                  departureDate=end.isoformat() if end else None,
                  nightsBefore=None, nightsAfter=None, outsideNights=None, reason=None)
    if requirement == 'NO_ROOM':
        return {**result, 'reason': 'NO_ROOM'}
    if not start or not end or start >= end:
        return {**result, 'reason': 'STAY_DATES_UNCLEAR'}
    by_label = defaultdict(list)
    for event in schedule:
        by_label[_label(event.discipline)].append(event)
    periods = []
    if not competitions:
        return {**result, 'reason': 'EVENT_DATES_UNCLEAR'}
    for competition in {str(c.id): c for c in competitions}.values():
        exact = [event for event in schedule if event.discipline in
                 {getattr(competition, 'display_name', None), competition.name}]
        candidates = exact or by_label.get(_label(getattr(competition, 'display_name', '') or competition.name), [])
        if len(candidates) != 1:
            return {**result, 'reason': 'EVENT_DATES_UNCLEAR'}
        left, right = _date(candidates[0].start_date), _date(candidates[0].end_date)
        if not left or not right or left > right:
            return {**result, 'reason': 'EVENT_DATES_UNCLEAR'}
        periods.append((left, right))
    event_start, event_end = min(p[0] for p in periods), max(p[1] for p in periods)
    allowed_start, allowed_end = event_start-timedelta(days=2), event_end+timedelta(days=1)
    before = max(0, (min(end, allowed_start)-start).days)
    after = max(0, (end-max(start, allowed_end)).days)
    return {**result, 'eventStart': event_start.isoformat(), 'eventEnd': event_end.isoformat(),
            'allowedStart': allowed_start.isoformat(), 'allowedEnd': allowed_end.isoformat(),
            'nightsBefore': before, 'nightsAfter': after, 'outsideNights': before+after}
