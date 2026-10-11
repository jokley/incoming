"""Selected Event mapping context, separate from legacy discipline inference."""
from models import Event


class ImportValidationError(ValueError):
    """Expected event/mapping validation failure suitable for a 4xx response."""
    def __init__(self, code, message, *, event_id=None, import_code=None):
        super().__init__(message)
        self.code = code
        self.event_id = event_id
        self.import_code = import_code

    def to_dict(self):
        return {key: value for key, value in {
            'error': self.code, 'event_id': str(self.event_id) if self.event_id is not None else None,
            'import_code': self.import_code, 'message': str(self),
        }.items() if value is not None}


def normalize_event_id(value):
    """Return the integer PK representation used by PostgreSQL event queries."""
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ImportValidationError(
            'INVALID_EVENT_ID', 'Die Event-ID muss eine ganze Zahl sein.'
        ) from None


def active_competition_mapping(event):
    return {
        mapping.import_code: mapping.competition
        for mapping in event.competition_mappings if mapping.active
    }


def revalidate_confirmation_event(event_id, people):
    event_id = normalize_event_id(event_id)
    event = Event.query.get(event_id)
    if not event:
        raise ImportValidationError('EVENT_NOT_FOUND', 'Das ausgewählte Import-Event existiert nicht mehr.', event_id=event_id)
    if not event.active:
        raise ImportValidationError('EVENT_INACTIVE', f'Event {event.name} ist inaktiv.', event_id=event.id)
    competitions_by_import_code = active_competition_mapping(event)
    for person in people:
        for import_code in person.get('competitionImportCodes', []):
            if import_code not in competitions_by_import_code:
                raise ImportValidationError(
                    'UNKNOWN_COMPETITION_CODE',
                    f'Unbekannter Competition-Code {import_code} für Event {event.name}',
                    event_id=event.id, import_code=import_code,
                )

    return event, competitions_by_import_code
