"""Selected Event mapping context, separate from legacy discipline inference."""
from models import Event


class ImportValidationError(ValueError):
    """Expected event/mapping validation failure suitable for a 4xx response."""
    def __init__(self, code, message, *, event_id=None, import_code=None, details=None):
        super().__init__(message)
        self.code = code
        self.event_id = event_id
        self.import_code = import_code
        self.details = details

    def to_dict(self):
        return {key: value for key, value in {
            'error': self.code, 'event_id': str(self.event_id) if self.event_id is not None else None,
            'import_code': self.import_code, 'message': str(self), 'details': self.details,
        }.items() if value is not None}


def normalize_event_id(value):
    """Return the integer PK representation used by PostgreSQL event queries."""
    try:
        if isinstance(value, bool) or not str(value).isascii() or not str(value).isdigit() or int(value) <= 0:
            raise ValueError()
        return int(value)
    except (TypeError, ValueError):
        raise ImportValidationError(
            'INVALID_EVENT_ID', 'Die Event-ID muss eine ganze Zahl sein.'
        ) from None


def active_competition_mapping(event):
    return {
        mapping.import_code: mapping.competition
        for mapping in event.competition_mappings
        if mapping.active and mapping.competition is not None
    }


def revalidate_confirmation_event(event_id, people, *, validate_codes=True):
    event_id = normalize_event_id(event_id)
    event = Event.query.get(event_id)
    if not event:
        raise ImportValidationError('EVENT_NOT_FOUND', 'Das ausgewählte Import-Event existiert nicht mehr.', event_id=event_id)
    if not event.active:
        raise ImportValidationError('EVENT_INACTIVE', f'Event {event.name} ist inaktiv.', event_id=event.id)
    competitions_by_import_code = active_competition_mapping(event)
    for person in people if validate_codes else []:
        for import_code in person.get('competitionImportCodes', []):
            if import_code not in competitions_by_import_code:
                raise ImportValidationError(
                    'UNKNOWN_COMPETITION_CODE',
                    f'Unbekannter Competition-Code {import_code} für Event {event.name}',
                    event_id=event.id, import_code=import_code,
                )

    return event, competitions_by_import_code


def import_event_id(value=None):
    """Explicit selection wins. Compatibility is allowed only when absent."""
    from flask import g, has_request_context
    if value is None and has_request_context():
        value = getattr(g, 'import_event_id', None)
    if value is None:
        from event_ownership_runtime import configured_event_id
        value = configured_event_id()
    return normalize_event_id(value)


def validate_session_event(session, preview=None, event_id=None):
    if session.current_version is not None and session.current_version.session_id != session.id:
        raise ImportValidationError('IMPORT_SESSION_VERSION_MISMATCH', 'Aktuelle Version gehört zu einer anderen Importsession.')
    expected = import_event_id(event_id if event_id is not None else session.event_id)
    if session.event_id != expected or (preview is not None and preview.get('eventId') is not None
            and normalize_event_id(preview['eventId']) != expected):
        raise ImportValidationError('IMPORT_EVENT_MISMATCH',
            'ImportSession, Preview und ausgewähltes Event müssen übereinstimmen.', event_id=expected)
    if preview is not None:
        # Eventless historic snapshots inherit their validated owning session.
        preview['eventId'] = expected
    return expected
