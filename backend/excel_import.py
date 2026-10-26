from quota_rules import rules_for_event
from accommodation_requirements import apply_preview_requirements, set_requirement, accommodation_room_requests
import json
import re
import uuid
import zipfile
from copy import deepcopy
from datetime import datetime, date, timedelta

import pandas as pd
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import func

from accommodation_rates import apply_preview_rates, resolve_rate
from quota_history import approval_event_matches, applicable_approval_groups, historical_approval_groups, preview_approval_person, quota_person
from quota_service import evaluate_athlete_quota_usage, evaluate_quota_usage, normalize_gender, quota_keys, has_quota_membership, quota_gender_errors, allocate_single_rooms, person_identity
from models import Athlete, Competition, Event, AccommodationEvent, FisRoomAssignment, ImportRun, ImportSession, ImportSessionEvent, ImportSessionVersion, ImportApproval, RoomAssignment, RoomBooking, RoomBookingOccupant, db
from competitions import COMPETITION_BY_IMPORT_CODE, quota_disciplines, resolve_quota_memberships, normalize_competition_ids, athlete_top_level_discipline

# Compatibility exports retained for existing callers and tests.
from imports.normalization import (DAY_COLUMN_PATTERN, DATETIME_FORMATS,
    normalize_string, normalize_whitespace, has_value, parse_boolean, parse_date,
    parse_datetime, _col_key, normalize_columns, detect_day_columns,
    validate_required_columns)
from imports.identity import (build_name_key, _build_existing_athlete_maps,
    _find_existing_athlete, _index_people, validate_people_identities)
from imports.read_context import ImportReadContext
from imports.event_context import import_event_id, validate_session_event
from imports.normalization import canonical_fis_code
from imports.event_context import (ImportValidationError, normalize_event_id,
    active_competition_mapping, revalidate_confirmation_event)


# Confirmation deliberately consumes the typed preview produced by parsing, not
# the JSON projection stored for review.  This process-local cache therefore
# forms a lifecycle boundary: tokens expire, do not survive a restart, and are
# not shared between workers.  Import sessions are durable workflow/audit state;
# they must not be mistaken for a durable replacement for this confirmation
# payload without an explicit serialization and multi-worker design change.
PREVIEW_STORE = {}
PREVIEW_TTL_SECONDS = 60 * 60


class InvalidExcelFileError(ValueError):
    pass


DISCIPLINE_FILENAME_ALIASES = {
    'bigair': 'Big Air',
    'big_air': 'Big Air',
    'ba': 'Big Air',
    'moguls': 'Moguls',
    'mogul': 'Moguls',
    'mo': 'Moguls',
    'slopestyle': 'Slopestyle',
    'slope': 'Slopestyle',
    'ss': 'Slopestyle',
    'parallel': 'Parallel',
    'psl': 'Parallel',
    'pgs': 'Parallel',
    'sbx': 'Snowboard Cross',
    'snowboardcross': 'Snowboard Cross',
    'skicross': 'Ski Cross',
    'sx': 'Ski Cross',
    'aerials': 'Aerials',
    'ae': 'Aerials',
}

ENTRY_REQUIRED_COLUMNS = {
    'Function',
    'Lastname',
    'Firstname',
    'Nationcode',
}

ROOM_REQUIRED_COLUMNS = {
    'Lastname',
    'Firstname',
    'Nationcode',
    'Arrival_date',
    'Departure_date',
    'Room_type',
}

ROOM_TYPE_FLAGS = ('Single', 'Double_shared', 'Double_single', 'Appartment')

DISCIPLINE_COLUMN_KEYS = {
    'industryname',
    'industry',
    'discipline',
    'disciplinename',
    'eventdiscipline',
    'sportdiscipline',
}


def extract_discipline_value(row):
    direct = normalize_whitespace(row.get('Industryname')) or None
    if direct:
        return direct

    for column_name in row.index:
        if _col_key(column_name) not in DISCIPLINE_COLUMN_KEYS:
            continue
        value = normalize_whitespace(row.get(column_name)) or None
        if value:
            return value

    return None


def infer_discipline_from_filename(path):
    filename = normalize_string(path.split('\\')[-1].split('/')[-1].replace('.xlsx', '').replace('.xls', ''))
    if not filename:
        return None

    tokens = [token for token in re.split(r'[^a-z0-9]+', filename) if token]
    joined = ''.join(tokens)

    for key, discipline in DISCIPLINE_FILENAME_ALIASES.items():
        normalized_key = normalize_string(key).replace(' ', '')
        if normalized_key and normalized_key in joined:
            return discipline

    for token in tokens:
        if token in DISCIPLINE_FILENAME_ALIASES:
            return DISCIPLINE_FILENAME_ALIASES[token]

    return None


def infer_discipline_from_events(people):
    ranges = []
    for person in people:
        start = person.get('arrivalDate')
        end = person.get('departureDate')
        if start and end and end >= start:
            ranges.append((start, end))

    if not ranges:
        return None

    events = AccommodationEvent.query.filter_by(championship_event_id=import_event_id()).all()
    if not events:
        return None

    best_match = None
    best_score = -1
    for event in events:
        score = 0
        for start, end in ranges:
            overlap_start = max(start, event.start_date)
            overlap_end = min(end, event.end_date)
            if overlap_end >= overlap_start:
                score += (overlap_end - overlap_start).days + 1
            else:
                try:
                    shifted_event_start = date(start.year, event.start_date.month, event.start_date.day)
                    shifted_event_end = date(end.year, event.end_date.month, event.end_date.day)
                    shifted_overlap_start = max(start, shifted_event_start)
                    shifted_overlap_end = min(end, shifted_event_end)
                    if shifted_overlap_end >= shifted_overlap_start:
                        score += (shifted_overlap_end - shifted_overlap_start).days + 1
                except ValueError:
                    continue
        if score > best_score:
            best_score = score
            best_match = event

    if best_match and best_score > 0:
        return best_match.discipline
    return None


def apply_import_level_discipline(people, entries_path, roomlist_path):
    if not people:
        return None
    if any(person.get('industryName') for person in people):
        return None

    inferred = (
        infer_discipline_from_filename(entries_path)
        or infer_discipline_from_filename(roomlist_path)
        or infer_discipline_from_events(people)
    )

    if not inferred:
        return None

    for person in people:
        person['industryName'] = inferred
    return inferred


def load_first_sheet(path, display_name=None):
    source_name = display_name or path.split('\\')[-1].split('/')[-1]
    try:
        # Preserve text identifiers (notably leading zeros) instead of pandas numeric inference.
        workbook = pd.read_excel(path, sheet_name=None, dtype=object)
    except (zipfile.BadZipFile, KeyError, InvalidFileException, ValueError) as exc:
        raise InvalidExcelFileError(
            f'Invalid Excel file: {source_name}. Please upload a valid .xlsx/.xls file exported by Excel.'
        ) from exc
    if not workbook:
        raise InvalidExcelFileError(f'Excel file is empty: {source_name}')
    sheet_name, df = next(iter(workbook.items()))
    df = normalize_columns(df)
    df.attrs['fisSheetName'] = sheet_name
    return df


def is_empty_fis_room_list(df):
    """Exact FIS Data-sheet sentinel, not a room request or a filename guess."""
    return (df.attrs.get('fisSheetName') == 'Data' and df.empty and len(df.columns) == 1
            and normalize_string(df.columns[0]) == 'no data available')


def detect_fis_file_type(path, display_name=None):
    filename = normalize_string(path.split('\\')[-1].split('/')[-1])
    if 'roomlistdetailed' in filename or 'roomlist' in filename:
        return 'roomlist'
    if 'entrieslist' in filename and 'room' not in filename:
        return 'entries'

    df = load_first_sheet(path, display_name=display_name)
    if is_empty_fis_room_list(df):
        return 'roomlist'
    columns = set(df.columns)
    if {'Competitorid/Staff ID', 'Accredid', 'Fiscode'}.intersection(columns):
        return 'entries'
    if {'Shared with Name', 'Room_type', 'Arrival_date', 'Departure_date'}.intersection(columns):
        return 'roomlist'
    return 'unknown'


def _coalesce_room_type(row):
    if normalize_whitespace(row.get('Room_type')):
        return normalize_whitespace(row.get('Room_type'))
    for column, label in (
        ('Single', 'Single'),
        ('Double_shared', 'Double shared'),
        ('Double_single', 'Double single'),
        ('Appartment', 'Appartment'),
    ):
        if parse_boolean(row.get(column)):
            return label
    return ''


def _split_partner_name(raw_name):
    cleaned = normalize_whitespace(raw_name)
    if not cleaned:
        return None, None
    if ',' in cleaned:
        parts = [part.strip() for part in cleaned.split(',', 1)]
        if len(parts) == 2:
            return parts[0], parts[1]
    pieces = cleaned.split()
    if len(pieces) >= 2:
        return pieces[0], ' '.join(pieces[1:])
    return cleaned, ''


def _match_room_partner(raw_name, nation, people):
    """Match complete names within the stated nation, never guess a split."""
    name = normalize_string(normalize_whitespace(raw_name))
    matches = [person for person in people if person.get('nationCode') == nation
        and name in {normalize_string(normalize_whitespace(value)) for value in (
            f"{person['lastname']} {person['firstname']}",
            f"{person['lastname']}, {person['firstname']}",
            f"{person['firstname']} {person['lastname']}")}]
    return matches[0] if len(matches) == 1 else None


def single_room_context_errors(people, rooms):
    singles = {room.get('person1Key') for room in rooms
               if normalize_string(room.get('roomType')) == 'single'}
    return [{'code': 'ENTRY_SINGLE_ROOM_CONTEXT_UNRESOLVED',
             'message': 'Einzelzimmer benötigt eine Prüfung: kein gültiger exakter Quota-Kontext vorhanden.',
             'details': {'personKey': person.get('matchKey'),
                         'personName': f"{person.get('firstname', '')} {person.get('lastname', '')}".strip(),
                         'quotaDisciplines': person.get('quotaDisciplines', [])}}
            for person in people if person.get('accommodationRequirement') != 'NO_ROOM' and person.get('matchKey') in singles
            and not person.get('singleRoomQuotaExemptReason') and not quota_keys(person, people)]


def _daterange_nights(check_in_date, check_out_date):
    if not check_in_date or not check_out_date or check_out_date <= check_in_date:
        return []
    nights = []
    current = check_in_date
    while current < check_out_date:
        nights.append(current)
        current += timedelta(days=1)
    return nights


WSC_MEMBERSHIP_ERROR_MESSAGE = (
    'Competition-Zuordnungen konnten nicht aufgelöst werden. '
    'Jede affirmative WSC-Membership benötigt eine exakte Competition-Zuordnung '
    'mit gültiger Event Group.'
)


def resolve_current_quota_memberships(person, competition_mapping):
    """Resolve extracted codes without discarding failed source evidence."""
    codes = list(person.get('competitionImportCodes') or [])
    resolved = {**person, 'competitionImportCodes': [code for code in codes
        if competition_mapping.get(code) is not None]}
    resolve_quota_memberships(resolved, competition_mapping)
    for key in ('competitionIds', 'competitionMemberships', 'quotaDisciplines', 'topLevelDisciplines', 'athleteQuotaFamilies'):
        person[key] = resolved[key]
    person['athleteTopLevelDisciplines'] = sorted(set(person.get('athleteQuotaFamilies',[])) - {None}) if normalize_string(person.get('function')) == 'athlete' else []
    return person


def wsc_membership_errors(people, event_id=None):
    """Retain source evidence independently of successful exact mapping resolution."""
    diagnostics = []
    for person in people:
        source = [code for code in person.get(
            'affirmativeWscColumns', person.get('competitionImportCodes', []))
            if str(code).upper().startswith('WSC_')]
        saved_ids = {str(value) for value in person.get('savedCompetitionIdsEvidence', [])}
        missing_ids = saved_ids - {str(value) for value in person.get('competitionIds', [])}
        if not source and not missing_ids:
            continue
        extracted = list(person.get('competitionImportCodes') or [])
        memberships = person.get('competitionMemberships') or []
        failures = [{'competitionId': value, 'reason': 'SAVED_COMPETITION_UNRESOLVED'}
                    for value in sorted(missing_ids)]
        for code in source:
            matches = [item for item in memberships if item.get('importCode') == code]
            reason = ('IMPORT_CODE_LOST' if code not in extracted else
                      'COMPETITION_UNRESOLVED' if len(matches) != 1 else
                      'EVENT_GROUP_MISSING' if not normalize_whitespace(matches[0].get('quotaDiscipline')) else
                      'EVENT_GROUP_UNRESOLVED' if matches[0].get('quotaDiscipline') not in person.get('quotaDisciplines', []) else
                      'COMPETITION_ID_MISSING' if event_id is not None and (
                          matches[0].get('competitionId') is None or
                          str(matches[0]['competitionId']) not in {str(value) for value in person.get('competitionIds', [])}) else None)
            if reason:
                failures.append({'importCode': code, 'reason': reason})
        diagnostics.append({
            'personKey': person.get('matchKey'),
            'personName': ' '.join(filter(None, [person.get('lastname'), person.get('firstname')])),
            'row': person.get('sourceRowNumber'),
            'affirmativeSourceWscColumns': list(source),
            'extractedImportCodes': extracted,
            'resolvedCompetitionIds': list(person.get('competitionIds', [])),
            'resolvedEventGroups': list(person.get('quotaDisciplines', [])),
            'mappedMembershipCount': len(person.get('competitionMemberships', [])),
            'selectedEventId': event_id,
            'unresolvedMemberships': failures,
        })
    errors = [
        {'code': 'ENTRY_WSC_MEMBERSHIP_UNRESOLVED', 'message': WSC_MEMBERSHIP_ERROR_MESSAGE,
         'details': detail}
        for detail in diagnostics
        if detail['unresolvedMemberships']
    ]
    if diagnostics and (not any(d['mappedMembershipCount'] for d in diagnostics)
                        or not any(d['resolvedEventGroups'] for d in diagnostics)):
        errors.insert(0, {
            'code': 'ENTRY_WSC_MEMBERSHIPS_UNRESOLVED',
            'message': WSC_MEMBERSHIP_ERROR_MESSAGE,
            'details': {
                'columns': sorted({code for d in diagnostics for code in d['affirmativeSourceWscColumns']}),
                'affirmativeMembershipCount': sum(len(d['affirmativeSourceWscColumns']) for d in diagnostics),
                'mappedMembershipCount': sum(d['mappedMembershipCount'] for d in diagnostics),
                'selectedEventId': event_id, 'people': diagnostics,
            },
        })
    return errors


def parse_entries_list(df, athlete_maps, competition_mapping=None, event_name=None, event_id=None):
    competition_mapping = COMPETITION_BY_IMPORT_CODE if competition_mapping is None else competition_mapping
    errors = []
    warnings = []
    people = []
    seen_keys = {}

    competition_columns = [column for column in df.columns if str(column).upper().startswith('WSC_')]
    unknown_columns = sorted(set(competition_columns) - set(competition_mapping))
    if unknown_columns:
        errors.append({
            'code': 'ENTRY_UNKNOWN_COMPETITION_COLUMNS',
            'message': (f'Unbekannter Competition-Code {unknown_columns[0]} für Event {event_name}'
                        if event_name and len(unknown_columns) == 1 else
                        'ENTRIES-LIST contains competition columns absent from the selected event mapping'),
            'details': {'columns': unknown_columns},
        })

    missing_columns = validate_required_columns(df, ENTRY_REQUIRED_COLUMNS)
    if missing_columns:
        errors.append({
            'code': 'ENTRY_MISSING_COLUMNS',
            'message': 'ENTRIES-LIST is missing required columns',
            'details': {'columns': missing_columns},
        })
        return {'people': [], 'errors': errors, 'warnings': warnings}

    for index, row in df.iterrows():
        row_number = index + 2
        lastname = normalize_whitespace(row.get('Lastname'))
        firstname = normalize_whitespace(row.get('Firstname'))
        nation_code = normalize_whitespace(row.get('Nationcode')).upper()
        discipline = extract_discipline_value(row)

        if not lastname and not firstname and not nation_code:
            continue

        competitor_id = normalize_whitespace(row.get('Competitorid/Staff ID')) or None
        try:
            fis_code = canonical_fis_code(row.get('Fiscode')) or None
        except ValueError as exc:
            errors.append({'code': 'ENTRY_INVALID_FIS_CODE', 'message': str(exc),
                'details': {'row': row_number, 'value': normalize_whitespace(row.get('Fiscode'))}})
            continue
        unique_key = fis_code or competitor_id or build_name_key(lastname, firstname, nation_code)
        if unique_key in seen_keys:
            errors.append({
                'code': 'ENTRY_DUPLICATE_PERSON',
                'message': f'Duplicate person found in ENTRIES-LIST at row {row_number}',
                'details': {'row': row_number, 'previousRow': seen_keys[unique_key]},
            })
            continue
        seen_keys[unique_key] = row_number

        arrival_date = parse_date(row.get('Arrival_date'))
        departure_date = parse_date(row.get('Departure_date'))
        if has_value(row.get('Arrival_date')) and not arrival_date:
            errors.append({
                'code': 'ENTRY_INVALID_ARRIVAL_DATE',
                'message': f'Invalid arrival date at row {row_number}',
                'details': {'row': row_number, 'value': str(row.get('Arrival_date'))},
            })
        if has_value(row.get('Departure_date')) and not departure_date:
            errors.append({
                'code': 'ENTRY_INVALID_DEPARTURE_DATE',
                'message': f'Invalid departure date at row {row_number}',
                'details': {'row': row_number, 'value': str(row.get('Departure_date'))},
            })
        if arrival_date and departure_date and departure_date < arrival_date:
            errors.append({
                'code': 'ENTRY_INVALID_STAY_RANGE',
                'message': f'Arrival date is after departure date at row {row_number}',
                'details': {'row': row_number},
            })

        person = {
            'rowNumber': row_number,
            'function': normalize_whitespace(row.get('Function')) or None,
            'competitorId': competitor_id,
            'accredId': normalize_whitespace(row.get('Accredid')) or None,
            'fisCode': fis_code,
            'sourceFisCode': normalize_whitespace(row.get('Fiscode')) or None,
            'lastname': lastname,
            'firstname': firstname,
            'nationCode': nation_code,
            'industryName': discipline,
            'sourceRowNumber': row_number,
            'affirmativeWscColumns': [column for column in competition_columns if parse_boolean(row.get(column))],
            'competitionImportCodes': [
                column for column in competition_columns
                if parse_boolean(row.get(column))
            ],
            'forGender': normalize_whitespace(row.get('For_gender')) or None,
            'gender': normalize_whitespace(row.get('Gender')) or None,
            'phone': normalize_whitespace(row.get('Phone')) or None,
            'email': normalize_whitespace(row.get('Email')) or None,
            'present': parse_boolean(row.get('Present')),
            'wcSbxW': parse_boolean(row.get('WC_SBX_W_6061')),
            'wcSbxM': parse_boolean(row.get('WC_SBX_M_6060')),
            'arrivalDate': arrival_date,
            'arrivalTime': normalize_whitespace(row.get('Arrival_time')) or None,
            'arrivalBy': normalize_whitespace(row.get('Arrival_by')) or None,
            'arrivalAirport': normalize_whitespace(row.get('Arrival_airport')) or None,
            'arrivalAirportName': normalize_whitespace(row.get('Arrival_airport_name')) or None,
            'arrivalFlightno': normalize_whitespace(row.get('Arrival_flightno')) or None,
            'arrivalNeedTransportation': parse_boolean(row.get('Arrival_need_transportation')),
            'departureDate': departure_date,
            'departureTime': normalize_whitespace(row.get('Departure_time')) or None,
            'departureBy': normalize_whitespace(row.get('Departure_by')) or None,
            'departureAirport': normalize_whitespace(row.get('Departure_airport')) or None,
            'departureAirportName': normalize_whitespace(row.get('Departure_airport_name')) or None,
            'departureFlightno': normalize_whitespace(row.get('Departure_flightno')) or None,
            'departureNeedTransportation': parse_boolean(row.get('Departure_need_transportation')),
            'roomType': normalize_whitespace(row.get('Room_type')) or None,
            'sharedWithName': normalize_whitespace(row.get('Shared with Name') or row.get('Shared_with_name')) or None,
            'lateCheckout': parse_boolean(row.get('Late_checkout')),
            'firstMeal': normalize_whitespace(row.get('First_meal')) or None,
            'lastMeal': normalize_whitespace(row.get('Last_meal')) or None,
            'specialMeal': normalize_whitespace(row.get('Special_meal')) or None,
            'additionalItems': normalize_whitespace(row.get('Additional_items')) or None,
            'entryDate': parse_datetime(row.get('Entry_date')),
            'lastUpdate': parse_datetime(row.get('Lastupdate')),
            'entriesSentDate': parse_datetime(row.get('Entries_Sent_date')),
            'tvPictureStatus': normalize_whitespace(row.get('tv_picture_status')) or None,
            'tvPictureDate': parse_date(row.get('tv_picture_date')),
            'stance': normalize_whitespace(row.get('Stance')) or None,
        }
        existing = _find_existing_athlete(person, athlete_maps)
        if existing and any(p.get('existingAthleteId') == existing.id for p in people):
            raise ImportValidationError('IMPORT_IDENTITY_CONFLICT', 'Mehrere Importzeilen passen zur selben Person.', event_id=event_id)
        person['eventId'] = event_id if event_id is not None else athlete_maps.get('event_id')
        person['existingAthleteId'] = existing.id if existing else None
        person['operation'] = 'update' if existing else 'create'
        person['matchKey'] = unique_key
        resolve_current_quota_memberships(person, competition_mapping)
        if not person['quotaDisciplines']:
            warnings.append({'code': 'ENTRY_QUOTA_MEMBERSHIP_UNRESOLVED',
                'message': 'Keine exakte Competition-Membership für die Quotenprüfung vorhanden',
                'details': {'personKey': unique_key, 'row': row_number}})
        people.append(person)

    validate_people_identities(people, athlete_maps)
    errors.extend(wsc_membership_errors(people, event_id))
    return {'people': people, 'errors': errors, 'warnings': warnings}


def parse_room_list(df, imported_people):
    if is_empty_fis_room_list(df):
        return {'rooms': [], 'errors': [], 'dayColumns': [], 'warnings': [{
            'code': 'ROOM_LIST_NO_DATA', 'severity': 'info',
            'message': 'Room List enthält keine Unterkunftsdaten.',
            'details': {'source': 'no data available'}}]}
    errors = []
    warnings = []
    missing_columns = validate_required_columns(df, ROOM_REQUIRED_COLUMNS)
    if missing_columns:
        errors.append({
            'code': 'ROOM_MISSING_COLUMNS',
            'message': 'ENTRIES-ROOM-LIST-DETAILED is missing required columns',
            'details': {'columns': missing_columns},
        })
        return {'rooms': [], 'errors': errors, 'warnings': warnings, 'dayColumns': []}

    indexed_people = _index_people(imported_people)
    day_columns = detect_day_columns(df)
    rooms = []
    seen_room_keys = set()
    consumed_people = set()

    for index, row in df.iterrows():
        row_number = index + 2
        lastname = normalize_whitespace(row.get('Lastname'))
        firstname = normalize_whitespace(row.get('Firstname'))
        nation_code = normalize_whitespace(row.get('Nationcode')).upper()
        if not lastname and not firstname and not nation_code:
            continue

        person1 = indexed_people['by_name'].get(build_name_key(lastname, firstname, nation_code))
        if not person1 and not nation_code:
            person1 = indexed_people['by_name_no_nation'].get(build_name_key(lastname, firstname, ''))
        if not person1:
            warnings.append({
                'code': 'ROOM_PERSON_NOT_FOUND',
                'message': f'New person detected in room row {row_number}',
                'details': {'row': row_number, 'lastname': lastname, 'firstname': firstname, 'nationCode': nation_code},
            })
            continue

        arrival_date = parse_date(row.get('Arrival_date'))
        departure_date = parse_date(row.get('Departure_date'))
        if has_value(row.get('Arrival_date')) and not arrival_date:
            errors.append({
                'code': 'ROOM_INVALID_ARRIVAL_DATE',
                'message': f'Invalid room arrival date at row {row_number}',
                'details': {'row': row_number, 'value': str(row.get('Arrival_date'))},
            })
        if has_value(row.get('Departure_date')) and not departure_date:
            errors.append({
                'code': 'ROOM_INVALID_DEPARTURE_DATE',
                'message': f'Invalid room departure date at row {row_number}',
                'details': {'row': row_number, 'value': str(row.get('Departure_date'))},
            })
        if arrival_date and departure_date and departure_date < arrival_date:
            errors.append({
                'code': 'ROOM_INVALID_STAY_RANGE',
                'message': f'Room row {row_number} has arrival after departure',
                'details': {'row': row_number},
            })

        room_type = _coalesce_room_type(row)
        shared_with_raw_name = normalize_whitespace(row.get('Shared with Name'))
        shared_with_nation_code = normalize_whitespace(row.get('Shared with Nationcode')).upper() or nation_code
        person2 = None
        if shared_with_raw_name:
            person2 = _match_room_partner(shared_with_raw_name, shared_with_nation_code, imported_people)
            if not person2:
                warnings.append({
                    'code': 'ROOM_PARTNER_NOT_FOUND',
                    'message': f'Room partner could not be uniquely resolved in room row {row_number}',
                    'details': {'row': row_number, 'sharedWithName': shared_with_raw_name, 'sharedWithNationcode': shared_with_nation_code},
                })

        day_snapshot = {}
        for day_column in day_columns:
            raw_value = row.get(day_column['column'])
            if raw_value is None or pd.isna(raw_value) or raw_value == '':
                continue
            try:
                day_snapshot[day_column['date'].isoformat()] = int(raw_value)
            except (TypeError, ValueError):
                warnings.append({
                    'code': 'ROOM_DAY_VALUE_NOT_NUMERIC',
                    'message': f'Could not parse day occupancy value at row {row_number}',
                    'details': {'row': row_number, 'column': day_column['column'], 'value': str(raw_value)},
                })

        active_nights = _daterange_nights(arrival_date, departure_date)
        if active_nights and day_columns:
            overlap = [night for night in active_nights if night.isoformat() in day_snapshot or any(dc['date'] == night for dc in day_columns)]
            if not overlap:
                warnings.append({
                    'code': 'ROOM_NO_DAY_OVERLAP',
                    'message': f'Room row {row_number} has no overlap with available day columns',
                    'details': {'row': row_number},
                })

        person1_key = person1['matchKey']
        person2_key = person2['matchKey'] if person2 else None
        if person2_key:
            room_identity = '|'.join(sorted([person1_key, person2_key]) + [room_type, (arrival_date.isoformat() if arrival_date else ''), (departure_date.isoformat() if departure_date else '')])
            if room_identity in seen_room_keys:
                consumed_people.add(person1_key)
                continue
        else:
            room_identity = '|'.join([person1_key, room_type, (arrival_date.isoformat() if arrival_date else ''), (departure_date.isoformat() if departure_date else '')])

        if room_identity in seen_room_keys:
            continue
        seen_room_keys.add(room_identity)

        if person1_key in consumed_people and not person2_key:
            warnings.append({
                'code': 'ROOM_DUPLICATE_SINGLE',
                'message': f'Person appears in multiple single-room rows at row {row_number}',
                'details': {'row': row_number, 'person': f'{firstname} {lastname}'},
            })
        consumed_people.add(person1_key)
        if person2_key:
            consumed_people.add(person2_key)

        rooms.append({
            'rowNumber': row_number,
            'sourceRowKey': room_identity,
            'roomType': room_type,
            'person1Key': person1_key,
            'person2Key': person2_key,
            'person1Name': f"{person1['firstname']} {person1['lastname']}".strip(),
            'person2Name': f"{person2['firstname']} {person2['lastname']}".strip() if person2 else None,
            'sharedWithRawName': shared_with_raw_name or None,
            'sharedWithNationCode': shared_with_nation_code or None,
            'checkInDate': arrival_date,
            'checkOutDate': departure_date,
            'daySnapshot': day_snapshot,
            'lateCheckout': parse_boolean(row.get('Late_checkout')),
            'firstMeal': normalize_whitespace(row.get('First_meal')) or None,
            'lastMeal': normalize_whitespace(row.get('Last_meal')) or None,
            'specialMeal': normalize_whitespace(row.get('Special_meal')) or None,
            'person1Match': person1,
            'person2Match': person2,
        })

    return {
        'rooms': rooms,
        'errors': errors,
        'warnings': warnings,
        'dayColumns': [item['date'].isoformat() for item in day_columns],
    }


def quota_context_competition_evidence(people, context):
    """Freeze exact person/Competition membership evidence for a reviewed context."""
    evidence = set()
    for person in people:
        if context not in quota_keys(person, people):
            continue
        for membership in person.get('competitionMemberships', []):
            if membership.get('quotaDiscipline') == context[1] and membership.get('competitionId') is not None:
                evidence.add((person_identity(person), normalize_string(person.get('function')),
                              str(membership['competitionId']), membership.get('importCode')))
    return [{'personKey': key, 'function': role, 'competitionId': competition_id, 'importCode': code}
            for key, role, competition_id, code in sorted(evidence, key=lambda item: tuple(str(v) for v in item))]


def quota_requirement_errors(preview, approvals, *, require_approved=True, read_context=None):
    """Reconcile current violations with immutable, exactly scoped decision evidence.

    During sequential decision processing, matching pending review tasks count
    as coverage. Release and confirmation require completed applicable decisions.
    """
    approvals = list(approvals)
    people = preview.get('people', [])
    roster = None
    from athlete_quota import requirement_errors
    errors = requirement_errors(preview,approvals,require_approved)
    for requirement in preview.get('warnings', []):
        kind = requirement.get('code')
        if kind != 'QUOTA_SINGLE_ROOMS_EXCEEDED':
            continue
        details = requirement.get('details') or {}
        needed = details.get('openExcessCount', details.get('excessCount', 0))
        if kind == 'QUOTA_SINGLE_ROOMS_EXCEEDED' and needed <= 0:
            continue
        context = (details.get('nationCode'), details.get('discipline'), normalize_gender(details.get('gender')))
        covered = False
        covered_people = set()
        for approval in sorted(approvals, key=lambda item: item.decision != 'APPROVED'):
            if require_approved and approval.decision != 'APPROVED':
                continue
            reviewed = json.loads(approval.quota_details_json or '{}')
            if not approval_event_matches(approval, preview.get('eventId')):
                continue
            if approval.nation != context[0] or (reviewed.get('nationCode'), reviewed.get('discipline'),
                    normalize_gender(reviewed.get('gender'))) != context:
                continue
            if roster is None:
                roster = [preview_approval_person(person, competitions_by_id=read_context.competitions_by_id if read_context is not None else None) for person in people]
            preserved_people = {str(person['personKey']) for person in details.get('preservedApprovedPeople', [])}
            candidates = {str(candidate['personKey']) for candidate in details.get('singleRoomCandidates', [])} - preserved_people
            if approval.decision == 'APPROVED':
                selected = {str(key) for key in json.loads(approval.approved_person_keys_json or '[]')}
                eligible = {str(person.get('matchKey')) for person, current in zip(people, roster)
                    if str(person.get('matchKey')) in candidates & selected
                    and context in applicable_approval_groups(approval, current, person.get('matchKey'), roster)}
                covered_people.update(eligible)
                covered = len(covered_people) >= needed
            else:
                eligible = {str(person.get('matchKey')) for person, current in zip(people, roster)
                    if str(person.get('matchKey')) in candidates
                    and context in historical_approval_groups(reviewed, current, person.get('matchKey'), roster)}
                remaining = max(0, needed - len(covered_people))
                covered = len(eligible - covered_people) >= remaining and reviewed.get('excessCount', 0) >= remaining
            if covered:
                break
        if not covered:
            errors.append({'code': 'QUOTA_REQUIREMENT_UNREVIEWED',
                'message': 'Aktuelle Quotenverletzung benötigt eine anwendbare Entscheidung mit exakter Competition-Evidence.',
                'details': {'nationCode': context[0], 'discipline': context[1], 'gender': context[2],
                            'requirementType': kind, 'eventId': preview.get('eventId')}})
    return errors


def build_quota_warnings(people, rooms, quota_checks=None, *, read_context=None):
    """Derive review tasks without treating the spreadsheet as live disposition.

    The incoming room request and the retained operational booking are separate
    views of the same quota group.  A warning uses the more restrictive visible
    usage so a new snapshot cannot hide an already consumed quota, while still
    emitting only one task per nation/discipline/gender group.  Exempt requests
    remain visible for review but do not consume the normal single-room quota.
    """
    room_by_person = {}
    for room in rooms:
        room_by_person[room['person1Key']] = room
        if room.get('person2Key'):
            room_by_person[room['person2Key']] = room

    roster = [{**person, 'discipline': person.get('industryName')} for person in people
              if not quota_gender_errors([person])]
    requested = []
    projected = []
    imported_by_existing_id = {}
    from quota_rules import rules_for_event
    athlete_maps = read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps()
    for person in roster:
        room = room_by_person.get(person.get('matchKey'))
        requested.append({**person, 'countsAsSingle': bool(
            person.get('accommodationRequirement') != 'NO_ROOM' and room and normalize_string(room.get('roomType')) == 'single')})
        existing = _find_existing_athlete(person, athlete_maps)
        if existing:
            imported_by_existing_id[existing.id] = person

    # Project persisted bookings through the incoming authoritative roster.
    # Removed people disappear; retained people use their incoming quota group.
    for membership in RoomBookingOccupant.query.join(RoomBooking).filter(
            RoomBooking.event_id == (read_context.event_id if read_context else import_event_id()),
            RoomBookingOccupant.athlete_id.in_(imported_by_existing_id)).options(
            db.joinedload(RoomBookingOccupant.room_booking).joinedload(RoomBooking.room_type)).all():
        person = imported_by_existing_id.get(membership.athlete_id)
        if not person or normalize_string(person.get('function')) == 'athlete':
            continue
        booking = membership.room_booking
        projected.append({**person, 'countsAsSingle': bool(booking and booking.counts_as_single)})

    preserved = preserved_single_room_approvals(people, rooms, read_context=read_context)
    for records in (requested, projected):
        for person in records:
            evidence = preserved.get(person.get('matchKey'))
            person['singleRoomStatus'] = 'APPROVED_EXTRA' if evidence else None
            person['approvedQuotaContexts'] = [
                {'nationCode': nation, 'discipline': group, 'gender': gender}
                for nation, group, gender in sorted(evidence['groups'])] if evidence else []
    # Requests and retained bookings may overlap; form one distinct physical
    # demand set rather than taking maxima of differently routed context rows.
    combined = {}
    for index, person in enumerate([*requested, *projected]):
        identity = person_identity(person, index)
        previous = combined.get(identity)
        combined[identity] = {**person, 'countsAsSingle': bool(person.get('countsAsSingle')
            or (previous and previous.get('countsAsSingle')))}
    from quota_rules import rules_for_event
    rules=rules_for_event(read_context.event_id if read_context else None)
    physical_rows = evaluate_quota_usage(roster, list(combined.values()),rules)
    requested_rows = evaluate_quota_usage(roster, requested,rules)
    projected_rows = evaluate_quota_usage(roster, projected,rules)
    rows_by_key = {}
    for source, rows in (('existing', projected_rows), ('requested', requested_rows)):
        for row in rows:
            key = (row['nationCode'], row['discipline'], row['gender'])
            current = rows_by_key.setdefault(key, {**row, 'sources': set()})
            current['sources'].add(source)
            # Report the more restrictive visible usage while retaining one task
            # per rule and quota group.
            if row['assignedOfficials'] > current['assignedOfficials']:
                current['assignedOfficials'] = row['assignedOfficials']
            if row['singleRoomsUsed'] > current['singleRoomsUsed']:
                current['singleRoomsUsed'] = row['singleRoomsUsed']
            # Both sources describe the same people; preserve visible exemptions
            # using the same maximum rule, without counting them twice.
            if row['quotaExemptSingleRooms'] > current['quotaExemptSingleRooms']:
                current['quotaExemptSingleRooms'] = row['quotaExemptSingleRooms']

    for row in physical_rows:
        key = (row['nationCode'], row['discipline'], row['gender'])
        for field in ('singleRoomsUsed', 'quotaExemptSingleRooms', 'singleRoomAllocations',
                      'singleRoomsCovered', 'singleRoomsPending'):
            rows_by_key[key][field] = row[field]
    warnings = []
    for (nation_code, discipline, gender), row in sorted(rows_by_key.items()):
        athletes_entered = row['athletesEntered']
        official_quota = row['officialQuota']
        imported_officials = row['assignedOfficials']
        imported_single_rooms = row['singleRoomsUsed']
        single_room_entitlement = row['singleRoomsAllowed']
        if quota_checks is not None:
            quota_checks.append({
                'nationCode': nation_code, 'discipline': discipline, 'gender': gender,
                'athletes': athletes_entered,
                'officials': imported_officials, 'officialQuota': official_quota,
                'singleRoomsRequested': len(row['singleRoomAllocations']),
                'singleRoomsPending': row['singleRoomsPending'],
                'singleRoomsApproved': sum(p['status'] == 'APPROVED_EXTRA' for p in row['singleRoomAllocations']),
                'singleRooms': imported_single_rooms, 'singleRoomsAllowed': single_room_entitlement,
                'quotaExemptSingleRooms': row.get('quotaExemptSingleRooms', 0),
                'officialsExceeded': imported_officials > official_quota,
                'singleRoomsExceeded': imported_single_rooms > single_room_entitlement,
                'singleRoomAllocations': row['singleRoomAllocations'],
            })
        if imported_officials > official_quota:
            warnings.append({
                'code': 'INFO_OFFICIALS_OVER_BASIS',
                'message': f'Officials gemeldet: {imported_officials} (Basis {official_quota})',
                'details': {
                    'quotaMembershipVersion': 2,
                    'nationCode': nation_code,
                    'discipline': discipline,
                    'gender': gender,
                    'athletesEntered': athletes_entered,
                    'officialQuota': official_quota,
                    'importedOfficials': imported_officials,
                    'competitionEvidence': quota_context_competition_evidence(roster, (nation_code, discipline, gender)),
                    'existingAssignedOfficials': next((r['assignedOfficials'] for r in projected_rows if (r['nationCode'], r['discipline'], r['gender']) == (nation_code, discipline, gender)), 0),
                    'violationSources': sorted(row['sources']),
                },
            })
        if imported_single_rooms > single_room_entitlement:
            group = (nation_code, discipline, gender)
            routed = {p['identity'] for p in row['singleRoomAllocations']}
            single_room_review_people = [person for person in combined.values()
                if person.get('countsAsSingle') and person_identity(person) in routed]
            single_room_people = [person for person in single_room_review_people
                if not person.get('singleRoomQuotaExemptReason')]
            excess_count = imported_single_rooms - single_room_entitlement
            candidates = [{
                'personKey': person.get('matchKey'),
                'name': f"{person.get('firstname', '')} {person.get('lastname', '')}".strip(),
                'function': person.get('function'),
                'competitionIds': [c['competitionId'] for c in person.get('competitionMemberships', [])
                    if c['quotaDiscipline'] == discipline and c['competitionId'] is not None],
                'competitionImportCodes': [c['importCode'] for c in person.get('competitionMemberships', [])
                    if c['quotaDiscipline'] == discipline],
                'singleRoomQuotaExemptReason': person.get('singleRoomQuotaExemptReason'),
            } for person in single_room_people]
            warnings.append({
                'code': 'QUOTA_SINGLE_ROOMS_EXCEEDED',
                'message': f'Single Rooms überschritten ({imported_single_rooms} / {single_room_entitlement})',
                'details': {
                    'quotaMembershipVersion': 2,
                    'nationCode': nation_code,
                    'discipline': discipline,
                    'gender': gender,
                    'athletesEntered': athletes_entered,
                    'officialQuota': official_quota,
                    'importedOfficials': imported_officials,
                    'singleRoomsAllowed': single_room_entitlement,
                    'importedSingleRooms': imported_single_rooms,
                    'singleRoomsRequested': len(row['singleRoomAllocations']),
                    'quotaExemptSingleRooms': row.get('quotaExemptSingleRooms', 0),
                    'existingSingleRoomsUsed': next((r['singleRoomsUsed'] for r in projected_rows if (r['nationCode'], r['discipline'], r['gender']) == (nation_code, discipline, gender)), 0),
                    'violationSources': sorted(row['sources']),
                    'excessCount': excess_count,
                    'singleRoomCandidates': candidates,
                    'singleRoomReviewPeople': [{
                        'personKey': person.get('matchKey'),
                        'name': f"{person.get('firstname', '')} {person.get('lastname', '')}".strip(),
                        'function': person.get('function'),
                        'singleRoomQuotaExemptReason': person.get('singleRoomQuotaExemptReason'),
                    } for person in single_room_review_people],
                },
            })
    warnings.extend({'code': 'ENTRY_QUOTA_ALLOWANCE_UNRESOLVED',
        'message': 'No athlete-derived M/W allowance context for this Official',
        'details': {'personKey': person.get('matchKey'), 'quotaDisciplines': person.get('quotaDisciplines')}}
        for person in people if normalize_string(person.get('function')) != 'athlete'
        and person.get('quotaDisciplines') and not quota_keys(person, roster))
    from quota_rules import fingerprint
    owner=import_event_id(read_context.event_id if read_context else None)
    event_record=db.session.get(Event,owner)
    for warning in warnings:
        if warning.get('code') in {'QUOTA_SINGLE_ROOMS_EXCEEDED','INFO_OFFICIALS_OVER_BASIS'}:
            warning['details'].update(eventId=owner,rulesSnapshot=rules,rulesDigest=fingerprint(rules),rulesRevision=event_record.quota_rules_revision)
    return warnings


def apply_single_room_quota_exemptions(people, overrides=None, event_id=None, carried_keys=(), override_revisions=None, *, read_context=None):
    from world_champions import recognize
    athlete_maps = read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps(event_id=event_id)
    for person in people:
        recognize(person, _find_existing_athlete(person, athlete_maps), overrides or {}, event_id, carried_keys, override_revisions)
    return people


def preserved_single_room_approvals(people, rooms, *, read_context=None):
    """Return continuously active approved requests in the incoming snapshot.

    The live athlete row represents the immediately preceding confirmed full
    snapshot.  Consequently an intervening non-single snapshot (which stores
    ``NONE``) forms the required continuity boundary; historical decisions are
    deliberately not consulted here.
    """
    room_by_person = {}
    for room in rooms:
        room_by_person[room.get('person1Key')] = room
        if room.get('person2Key'):
            room_by_person[room.get('person2Key')] = room
    athlete_maps = read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps()
    preserved = {}
    retained_ids = {row[0] for row in db.session.query(RoomBookingOccupant.athlete_id).join(
        RoomBooking, RoomBooking.id == RoomBookingOccupant.room_booking_id).filter(
        RoomBooking.counts_as_single.is_(True),
        RoomBooking.event_id == (read_context.event_id if read_context else import_event_id())).distinct()}
    current_roster = [preview_approval_person(p, competitions_by_id=read_context.competitions_by_id if read_context is not None else None) for p in people]
    for person in people:
        person['unresolvedHistoricalApprovalIds'] = []
        if person.get('singleRoomQuotaExemptReason'):
            continue
        room = room_by_person.get(person.get('matchKey'))
        existing = _find_existing_athlete(person, athlete_maps)
        incoming_single = bool(person.get('accommodationRequirement') != 'NO_ROOM' and room and normalize_string(room.get('roomType')) == 'single')
        retained_single = bool(existing and existing.id in retained_ids
            and normalize_string(person.get('function')) != 'athlete')
        if not incoming_single and not retained_single:
            continue
        staged = person.get('_reviewApproval')
        if staged:
            preserved[person.get('matchKey')] = {
                'decisionId': staged['decisionId'], 'groups': {tuple(group) for group in staged['groups']},
                'name': f"{person.get('firstname', '')} {person.get('lastname', '')}".strip()}
            continue
        if not existing or existing.single_room_status != 'APPROVED_EXTRA':
            continue
        if existing.nation_code != person.get('nationCode'):
            continue
        incoming_groups = quota_keys(person, people)
        matching_groups = incoming_groups & applicable_approval_groups(
            existing.single_room_decision, preview_approval_person(person, competitions_by_id=read_context.competitions_by_id if read_context is not None else None), person.get('matchKey'), current_roster)
        if not matching_groups and existing.single_room_decision_id:
            person['unresolvedHistoricalApprovalIds'] = [existing.single_room_decision_id]
        if matching_groups:
            preserved[person.get('matchKey')] = {
                'decisionId': existing.single_room_decision_id,
                'groups': matching_groups,
                'name': f"{person.get('firstname', '')} {person.get('lastname', '')}".strip(),
            }
    return preserved


def apply_preserved_single_room_approvals(quota_warnings, preserved):
    """Annotate technical warnings with the already-covered current excess."""
    for warning in quota_warnings:
        if warning.get('code') != 'QUOTA_SINGLE_ROOMS_EXCEEDED':
            continue
        details = warning.get('details') or {}
        group = (details.get('nationCode'), details.get('discipline'), details.get('gender'))
        candidate_keys = {item.get('personKey') for item in details.get('singleRoomCandidates', [])}
        covered = [
            {'personKey': key, 'name': value['name'], 'decisionId': value['decisionId']}
            for key, value in preserved.items()
            if key in candidate_keys and group in value['groups']
        ]
        # One person contributes at most once to a quota-discipline group even
        # when several competition memberships map to that discipline.
        covered = list({item['personKey']: item for item in covered}.values())
        details['preservedApprovedPeople'] = covered
        details['approvedExtraCount'] = min(len(covered), details.get('excessCount', 0))
        details['openExcessCount'] = max(
            0, details.get('excessCount', 0) - details['approvedExtraCount'])


def apply_active_single_room_decision(details, approved_person_keys, decision_id, people=(), superseded_decision_id=None):
    """Move the active surcharge marker without changing room disposition.

    Candidate keys were produced for one quota group by ``build_quota_warnings``.
    Only the three person-level decision fields are changed here; bookings,
    physical room types and ``counts_as_single`` remain independent.
    """
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    selected = set(approved_person_keys)
    decision = db.session.get(ImportApproval, decision_id)
    if not decision:
        raise ImportValidationError('APPROVAL_NOT_FOUND', 'Genehmigung nicht gefunden.')
    athlete_maps = _build_existing_athlete_maps(event_id=decision.session.event_id)
    changed = []
    for candidate in details.get('singleRoomCandidates', []):
        person_key = candidate.get('personKey')
        incoming = next((person for person in people
                         if person.get('matchKey') == person_key), None)
        athlete = (_find_existing_athlete(incoming, athlete_maps) if incoming else
                   _find_existing_athlete({'fisCode': person_key}, athlete_maps))
        if not athlete:
            continue
        if athlete.accommodation_requirement == 'NO_ROOM' or (incoming and incoming.get('accommodationRequirement') == 'NO_ROOM'):
            if person_key in selected:
                raise ImportValidationError('NO_ROOM_SINGLE_ROOM_APPROVAL_FORBIDDEN', 'Kein Zimmer benötigt. Keine aktive EZ-Genehmigung möglich.')
            continue  # Keep historical approval evidence unchanged.
        if person_key in selected:
            if not applicable_approval_groups(decision, athlete, person_key):
                raise ImportValidationError('APPROVAL_MEMBERSHIP_UNRESOLVED',
                    'Die Genehmigung ist für die aktuelle Competition-Membership nicht nachgewiesen.')
            athlete.single_room_status = 'APPROVED_EXTRA'
            athlete.single_room_entitlement = 'APPROVED_EXTRA'
            athlete.single_room_decision_id = decision_id
        elif athlete.single_room_status == 'APPROVED_EXTRA' and athlete.single_room_decision_id == superseded_decision_id:
            resolved = has_quota_membership(quota_person(athlete),
                [quota_person(p) for p in Athlete.query.filter_by(event_id=athlete.event_id, nation_code=athlete.nation_code).all()])
            athlete.single_room_status = 'IN_QUOTA' if resolved else 'PENDING_APPROVAL'
            athlete.single_room_entitlement = 'IN_QUOTA' if resolved else None
            athlete.single_room_decision_id = None
        changed.append(athlete)
    return changed


def apply_single_room_entitlement_preview(people, rooms, quota_checks, preserved=None):
    """Annotate requested single rooms with their provisional import status.

    The preview is the professional source of truth: room assignment data must
    never be used later to recreate these entitlements.  Excess requests stay
    explicitly pending until the decision record identifies their recipients.
    """
    room_by_person = {}
    for room in rooms:
        room_by_person[room.get('person1Key')] = room
        if room.get('person2Key'):
            room_by_person[room.get('person2Key')] = room
    allowances = {
        (check.get('nationCode'), check.get('discipline'), check.get('gender')):
            int(check.get('singleRoomsAllowed') or 0)
        for check in quota_checks
    }
    preserved = preserved or {}
    requested = []
    for person in people:
        person['singleRoomEntitlement'] = None
        person['singleRoomAllocation'] = None
        room = room_by_person.get(person.get('matchKey'))
        evidence = preserved.get(person.get('matchKey'))
        requested.append({**person, 'countsAsSingle': bool(person.get('accommodationRequirement') != 'NO_ROOM' and room and normalize_string(room.get('roomType')) == 'single'),
            'singleRoomStatus': 'APPROVED_EXTRA' if evidence else None,
            'approvedQuotaContexts': [{'nationCode': n, 'discipline': d, 'gender': g}
                for n, d, g in sorted(evidence['groups'])] if evidence else []})
    if all('singleRoomAllocations' in check for check in quota_checks):
        allocation = [item for check in quota_checks for item in check['singleRoomAllocations']]
    else:
        valid = [p for p in people if not quota_gender_errors([p])]
        allocation = allocate_single_rooms(requested, allowances, valid)
    by_identity = {p['identity']: p for p in allocation}
    for index, person in enumerate(people):
        if person.get('accommodationRequirement') == 'NO_ROOM':
            person['singleRoomAllocation'] = None
            person['singleRoomEntitlement'] = None
            continue
        room = room_by_person.get(person.get('matchKey'))
        record = by_identity.get(person_identity(person, index))
        if record is None and (not room or normalize_string(room.get('roomType')) != 'single'):
            continue
        # An unresolved person without any eligible context is still explicit
        # pending work; no fabricated quota bucket is required.
        status = record['status'] if record else 'EXEMPT' if person.get('singleRoomQuotaExemptReason') else 'PENDING'
        person['singleRoomAllocation'] = record or {'identity': person_identity(person, index),
            'personId': person.get('personId'), 'personKey': person.get('matchKey'), 'status': status,
            'context': None, 'eligibleContexts': []}
        person['singleRoomEntitlement'] = {'EXEMPT': 'QUOTA_EXEMPT', 'APPROVED_EXTRA': 'APPROVED_EXTRA',
            'COVERED': 'IN_QUOTA', 'PENDING': 'APPROVAL_REQUIRED'}[status]


def _iso_date(value):
    """Return a validated ISO date for parsed and persisted preview values."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            try:
                return datetime.fromisoformat(value).date().isoformat()
            except ValueError as exc:
                raise ValueError(f'Invalid ISO date: {value!r}') from exc
    raise TypeError(f'Unsupported date value: {type(value).__name__}')


def _serialize_person_preview(person):
    result = deepcopy(person)
    result['discipline'] = result.get('industryName')
    for key in ('arrivalDate', 'departureDate', 'tvPictureDate'):
        if result.get(key):
            result[key] = _iso_date(result[key])
    for key in ('entryDate', 'lastUpdate', 'entriesSentDate'):
        if result.get(key):
            result[key] = result[key].isoformat()
    return result


def _serialize_room_preview(room):
    return {
        'rowNumber': room['rowNumber'],
        'sourceRowKey': room['sourceRowKey'],
        'roomType': room['roomType'],
        'person1Key': room['person1Key'],
        'person2Key': room['person2Key'],
        'person1Name': room['person1Name'],
        'person2Name': room['person2Name'],
        'sharedWithRawName': room['sharedWithRawName'],
        'sharedWithNationCode': room['sharedWithNationCode'],
        'checkInDate': _iso_date(room['checkInDate']),
        'checkOutDate': _iso_date(room['checkOutDate']),
        'daySnapshot': room['daySnapshot'],
        'lateCheckout': room['lateCheckout'],
        'firstMeal': room['firstMeal'],
        'lastMeal': room['lastMeal'],
        'specialMeal': room['specialMeal'],
    }


def _display_room_type(value):
    value = normalize_string(value)
    if 'single' in value or value in {'ez', '1'}:
        return 'EZ'
    if 'double' in value or 'shared' in value or value in {'dz', '2'}:
        return 'DZ'
    return value.upper() if value else '—'


def _person_name(person):
    return f"{person.firstname} {person.lastname}".strip()


def _assignment_context(athlete, read_context=None):
    """Return the existing disposition without changing it."""
    # Follow the domain identity, not the particular legacy import row. This
    # makes an assignment attached to any historical duplicate visible to the
    # current productive person.
    identity_rows = [athlete]
    if read_context is not None:
        identity_rows = read_context.identity_rows(athlete)
    # Do not follow global FIS aliases across Events or legacy duplicates.
    elif athlete.event_id is None:
        raise ImportValidationError('IMPORT_EVENT_REQUIRED', 'Buchungsbezug ohne Event.')
    membership = next((membership for row in identity_rows for membership in row.room_booking_memberships), None)
    if membership and membership.room_booking.event_id != athlete.event_id:
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Eventfremder Buchungsbezug.')
    if membership:
        booking = membership.room_booking
        identity_ids = {row.id for row in identity_rows}
        partners = [item.athlete for item in booking.occupants if item.athlete_id not in identity_ids]
        return {
            'hotel': booking.hotel.name if booking.hotel else None,
            'hotelId': str(booking.hotel_id) if booking.hotel_id else None, 'assignmentId': str(booking.id),
            'roomTypeId': str(booking.room_type_id) if booking.room_type_id else None,
            'roomType': _display_room_type(booking.room_type.name if booking.room_type else None),
            'partners': partners,
            'checkInDate': booking.check_in_date,
            'checkOutDate': booking.check_out_date,
        }
    fis_assignment = next((assignment for row in identity_rows for assignment in row.fis_room_assignments_as_person1), None)
    if not fis_assignment:
        fis_assignment = next((assignment for row in identity_rows for assignment in row.fis_room_assignments_as_person2), None)
    if fis_assignment:
        partner = fis_assignment.person2 if fis_assignment.person1_id == athlete.id else fis_assignment.person1
        if partner and partner.event_id != athlete.event_id:
            raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Eventfremder Legacy-Zimmerpartner.')
        return {
            'hotel': fis_assignment.hotel.name if fis_assignment.hotel else None,
            'hotelId': str(fis_assignment.hotel_id) if fis_assignment.hotel_id else None,
            'assignmentId': str(fis_assignment.id),
            'sourceRowKey': fis_assignment.source_row_key,
            'roomType': _display_room_type(fis_assignment.room_type),
            'partners': [partner] if partner else [],
            'checkInDate': fis_assignment.check_in_date,
            'checkOutDate': fis_assignment.check_out_date,
        }
    return None


def build_disposition_analysis(people, rooms, quota_warnings, *, read_context=None, room_list_has_no_data=False):
    """Compare staged import data to live planning; this function is read-only."""
    categories = {
        key: {'count': 0, 'records': []}
        for key in (
            'newAthletes', 'updatedAthletes', 'removedAthletes', 'dispositionAffected',
            'hotelAssignmentAffected', 'roommateAffected', 'stayChanged',
            'roomRequirementChanged', 'quotaAffected', 'approvalRequired',
            'additionalCostsPossible',
        )
    }
    imported_by_id = {}
    room_by_key = {}
    for room in rooms:
        room_by_key[room.get('person1Key')] = room
        if room.get('person2Key'):
            room_by_key[room.get('person2Key')] = room

    changed_by_id = {}
    athlete_maps = read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps()
    for person in people:
        existing = _find_existing_athlete(person, athlete_maps)
        name = f"{person.get('firstname', '')} {person.get('lastname', '')}".strip()
        base = {'athlete': name, 'entityId': person.get('matchKey'), 'nation': person.get('nationCode'), 'discipline': person.get('industryName')}
        if existing is None:
            categories['newAthletes']['records'].append(base)
            continue
        imported_by_id[existing.id] = person
        base['personId'] = str(existing.id)
        changes = []
        for field, label, imported_field in (
            ('firstname', 'Vorname', 'firstname'), ('lastname', 'Nachname', 'lastname'),
            ('discipline', 'Disziplin', 'industryName'), ('gender', 'Gender', 'gender'),
            ('function', 'Funktion', 'function'), ('nation_code', 'Nation', 'nationCode'),
        ):
            new_value = person.get(imported_field)
            if (getattr(existing, field, None) or '') != (new_value or ''):
                changes.append({'field': label, 'old': getattr(existing, field, None), 'new': new_value})
        old_arrival, old_departure = _iso_date(existing.arrival_date), _iso_date(existing.departure_date)
        new_arrival, new_departure = _iso_date(person.get('arrivalDate')), _iso_date(person.get('departureDate'))
        if old_arrival != new_arrival or old_departure != new_departure:
            stay = {**base, 'old': {'arrival': old_arrival, 'departure': old_departure},
                    'new': {'arrival': new_arrival, 'departure': new_departure},
                    'impact': 'Bestehende Disposition betroffen'}
            categories['stayChanged']['records'].append(stay)
            changes.append({'field': 'Aufenthalt', 'old': stay['old'], 'new': stay['new']})
        room = room_by_key.get(person.get('matchKey'))
        new_room_type = _display_room_type(room.get('roomType') if room else person.get('roomType'))
        old_room_type = _display_room_type(existing.room_type)
        if room_list_has_no_data and not person.get('roomType'):
            new_room_type = old_room_type
        if old_room_type != new_room_type:
            categories['roomRequirementChanged']['records'].append({**base, 'old': old_room_type, 'new': new_room_type,
                                                                      'impact': 'Bestehende Disposition betroffen'})
            changes.append({'field': 'Zimmerbedarf', 'old': old_room_type, 'new': new_room_type})
        if changes:
            categories['updatedAthletes']['records'].append({**base, 'changes': changes})
            changed_by_id[existing.id] = changes

    nations = {person.get('nationCode') for person in people if person.get('nationCode')}
    disciplines = {person.get('industryName') for person in people if person.get('industryName')}
    scoped_existing = [a for a in read_context.athletes if a.nation_code in nations] if read_context else Athlete.query.filter(Athlete.event_id == import_event_id(), Athlete.nation_code.in_(nations)).all()
    if disciplines:
        scoped_existing = [person for person in scoped_existing if person.discipline in disciplines]
    for existing in scoped_existing:
        if existing.id not in imported_by_id:
            record = {'personId': str(existing.id), 'athlete': _person_name(existing), 'nation': existing.nation_code, 'discipline': existing.discipline,
                      'reason': 'Person ist im neuen Import nicht mehr vorhanden'}
            categories['removedAthletes']['records'].append(record)
            changed_by_id[existing.id] = [{'field': 'Person', 'old': 'vorhanden', 'new': 'entfernt'}]

    # A changed pairing is itself a disposition impact, even if the person's
    # master data and travel dates are unchanged.
    for athlete_id, person in imported_by_id.items():
        if room_list_has_no_data:
            continue
        athlete = db.session.get(Athlete, athlete_id)
        context = _assignment_context(athlete, read_context)
        if not context or not context.get('partners'):
            continue
        room = room_by_key.get(person.get('matchKey'))
        desired_key = None
        if room:
            desired_key = room.get('person2Key') if room.get('person1Key') == person.get('matchKey') else room.get('person1Key')
        desired = next((candidate for candidate in people if candidate.get('matchKey') == desired_key), None)
        desired_name = f"{desired.get('firstname', '')} {desired.get('lastname', '')}".strip() if desired else None
        current_names = [_person_name(partner) for partner in context['partners']]
        if not desired_name or desired_name not in current_names:
            changed_by_id.setdefault(athlete_id, []).append(
                {'field': 'Zimmerpartner', 'old': current_names, 'new': [desired_name] if desired_name else []}
            )

    affected_ids = set(changed_by_id)
    for athlete_id in affected_ids:
        athlete = db.session.get(Athlete, athlete_id)
        context = _assignment_context(athlete, read_context)
        if not context:
            continue
        reasons = [change['field'] for change in changed_by_id[athlete_id]]
        disposition = {
            'personId': str(athlete.id),
            'athlete': _person_name(athlete),
            **{key: context[key] for key in ('assignmentId', 'hotelId', 'roomTypeId') if context.get(key)},
            'nation': athlete.nation_code,
            'hotel': context.get('hotel'),
            'roomType': context.get('roomType'),
            'roommates': [_person_name(partner) for partner in context.get('partners', [])],
            'reason': ', '.join(reasons),
            'status': 'Bestehende Disposition betroffen',
        }
        categories['dispositionAffected']['records'].append(disposition)
        if context.get('hotel'):
            categories['hotelAssignmentAffected']['records'].append({**disposition, 'hotel': context['hotel']})

        new_person = imported_by_id.get(athlete_id)
        room = room_by_key.get(new_person.get('matchKey')) if new_person else None
        old_partners = context.get('partners', [])
        desired_partner_key = None
        if room:
            desired_partner_key = room.get('person2Key') if room.get('person1Key') == new_person.get('matchKey') else room.get('person1Key')
        desired_partner = next((candidate for candidate in people if candidate.get('matchKey') == desired_partner_key), None)
        old_partner_names = [_person_name(partner) for partner in old_partners]
        desired_name = f"{desired_partner.get('firstname', '')} {desired_partner.get('lastname', '')}".strip() if desired_partner else None
        if not room_list_has_no_data and old_partners and (not desired_name or desired_name not in old_partner_names):
            categories['roommateAffected']['records'].append({
                'entityId': room.get('sourceRowKey') if room else context.get('assignmentId'),
                'assignmentId': context.get('assignmentId'),
                'athlete': _person_name(athlete), 'oldPartners': old_partner_names,
                'newPartners': [desired_name] if desired_name else [],
                'reason': 'Partner entfernt, Reisezeitraum oder Zimmerbedarf geändert',
            })

        new_room = next((row for row in categories['roomRequirementChanged']['records'] if row['athlete'] == _person_name(athlete)), None)
        stay = next((row for row in categories['stayChanged']['records'] if row['athlete'] == _person_name(athlete)), None)
        extended = bool(stay and ((stay['new']['arrival'] and (not stay['old']['arrival'] or stay['new']['arrival'] < stay['old']['arrival'])) or
                                  (stay['new']['departure'] and (not stay['old']['departure'] or stay['new']['departure'] > stay['old']['departure']))))
        if extended or (new_room and new_room['new'] == 'EZ'):
            categories['additionalCostsPossible']['records'].append({
                'athlete': _person_name(athlete), 'nation': athlete.nation_code,
                'reason': 'Zusätzliche Nächte' if extended else 'Wechsel auf Einzelzimmer',
                'additionalCostPerNight': None, 'approvalRequired': True,
            })

    for warning in quota_warnings:
        details = warning.get('details', {})
        if warning.get('code') != 'QUOTA_SINGLE_ROOMS_EXCEEDED' or details.get('openExcessCount', details.get('excessCount', 0)) <= 0:
            continue
        record = {
            'nation': details.get('nationCode'), 'discipline': details.get('discipline'), 'gender': details.get('gender'),
            'currentQuota': details.get('importedSingleRooms'),
            'allowedQuota': details.get('singleRoomsAllowed'),
            'status': 'Genehmigung erforderlich', 'reason': warning.get('message'),
            'quotaKey': f"{details.get('nationCode')}::{details.get('discipline') or '—'}::{details.get('gender')}",
        }
        categories['quotaAffected']['records'].append(record)
        categories['approvalRequired']['records'].append(record)
    # A shared room is one business change, not one change per occupant.
    roommate_records = {}
    for record in categories['roommateAffected']['records']:
        key = record.get('assignmentId') or record.get('entityId') or record.get('athlete')
        roommate_records.setdefault(key, record)
    categories['roommateAffected']['records'] = list(roommate_records.values())
    for category in categories.values():
        category['count'] = len(category['records'])
    return {'categories': categories}


def _room_comparison_changes(people, rooms, removed_records, include_matches=False, *, read_context=None):
    """Compare room assignments by identities, never by spreadsheet position."""
    athlete_maps = read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps()

    def athlete_token(athlete):
        return f'id:{athlete.id}'

    existing_by_key = {}
    existing_by_id = {}
    for person in people:
        athlete = _find_existing_athlete(person, athlete_maps)
        if athlete:
            existing_by_key[person.get('matchKey')] = athlete
            existing_by_id[athlete.id] = athlete
    for record in removed_records:
        athlete_id = record.get('personId')
        if athlete_id:
            athlete = db.session.get(Athlete, int(athlete_id))
            if athlete and athlete.event_id == athlete_maps['event_id']:
                existing_by_id[athlete.id] = athlete

    staged_by_identity = {}
    for room in rooms:
        primary = existing_by_key.get(room.get('person1Key'))
        primary_context = _assignment_context(primary, read_context) if primary else None
        occupants = frozenset(
            athlete_token(existing_by_key[key]) if key in existing_by_key else f"new:{key}"
            for key in (room.get('person1Key'), room.get('person2Key')) if key
        )
        stable_key = (str(room.get('assignmentId') or ''), str(room.get('roomId') or ''), occupants)
        staged = staged_by_identity.setdefault(stable_key, {
            'entityId': room.get('sourceRowKey'), 'assignmentId': room.get('assignmentId'),
            'anchorAssignmentId': str(primary_context['assignmentId'])
            if primary_context and primary_context.get('assignmentId') else None,
            'roomId': room.get('roomId'), 'occupants': occupants, 'rooms': [],
        })
        staged['rooms'].append(room)
        # Mirrored FIS rows can contain occupant-specific travel dates.  They
        # are still one business assignment and must enter matching only once.
        if not staged.get('anchorAssignmentId') and primary_context and primary_context.get('assignmentId'):
            staged['anchorAssignmentId'] = str(primary_context['assignmentId'])
    staged = list(staged_by_identity.values())
    for item in staged:
        item['rooms'].sort(key=lambda room: str(room.get('sourceRowKey') or ''))
        item['entityId'] = item['rooms'][0].get('sourceRowKey')

    current_by_assignment = {}
    for athlete in existing_by_id.values():
        context = _assignment_context(athlete, read_context)
        if not context or not context.get('assignmentId'):
            continue
        assignment_id = str(context['assignmentId'])
        occupants = {athlete_token(athlete)}
        occupants.update(athlete_token(partner) for partner in context.get('partners', []))
        snapshot = current_by_assignment.setdefault(assignment_id, {
            'entityId': context.get('sourceRowKey') or assignment_id,
            'assignmentId': assignment_id, 'roomId': context.get('roomId'), 'occupants': set(),
        })
        snapshot['occupants'].update(occupants)
    current = [{**item, 'occupants': frozenset(item['occupants'])} for item in current_by_assignment.values()]

    # Work in a canonical order.  The room list is a set of assignments from a
    # business perspective; its Excel row order must not influence which live
    # assignment is considered the predecessor of a staged assignment.
    staged.sort(key=lambda item: (tuple(sorted(item['occupants'])), str(item.get('entityId') or '')))
    current.sort(key=lambda item: str(item['assignmentId']))

    matches = []
    matched_rooms_by_assignment = {}
    unused_current = set(range(len(current)))
    # Match strongest stable keys first, then the unordered person identity set.
    for staged_index, new_room in enumerate(staged):
        match = next((index for index in unused_current
                      if new_room.get('assignmentId') and new_room['assignmentId'] == current[index]['assignmentId']), None)
        if match is None:
            # The primary occupant identifies the business assignment.  Match
            # that assignment before considering the incoming partner, whose
            # own old assignment must never steal this row during a swap.
            match = next((index for index in unused_current
                          if new_room.get('anchorAssignmentId') == current[index]['assignmentId']), None)
        if match is None:
            match = next((index for index in unused_current
                          if new_room['occupants'] == current[index]['occupants']), None)
        if match is None and new_room.get('roomId'):
            match = next((index for index in unused_current
                          if new_room['roomId'] == current[index].get('roomId')), None)
        if match is None:
            overlap = sorted(
                ((len(new_room['occupants'] & current[index]['occupants']),
                  current[index]['assignmentId'], index) for index in unused_current),
                key=lambda item: (-item[0], item[1]),
            )
            match = overlap[0][2] if overlap and overlap[0][0] else None
        if match is not None:
            unused_current.remove(match)
            matched_rooms_by_assignment[current[match]['assignmentId']] = new_room['rooms']
        matches.append((staged_index, match))

    changes = []
    for staged_index, current_index in matches:
        new_room = staged[staged_index]
        if current_index is None:
            changes.append(('ROOM_CREATED', new_room['entityId'], 'Zimmerzuordnung erstellt'))
        elif new_room['occupants'] != current[current_index]['occupants']:
            changes.append(('ROOMMATE_CHANGED', new_room['entityId'], 'Zimmerpartner geändert'))
    for current_index in unused_current:
        # Removed assignments have no staged row key.  Use the stable live
        # assignment id so the preview can join the summary to its detail row.
        changes.append(('ROOM_REMOVED', current[current_index]['assignmentId'], 'Zimmerzuordnung entfernt'))
    return (changes, matched_rooms_by_assignment) if include_matches else changes


def build_import_changes(disposition_analysis, people, rooms, errors, *, read_context=None, room_list_has_no_data=False):
    """Normalize comparison results into the UI's sole semantic change model."""
    categories = disposition_analysis['categories']
    room_by_person = {
        key: room for room in rooms for key in (room.get('person1Key'), room.get('person2Key')) if key
    }
    changes = []

    # Resolve the stable live assignment first.  Stay and partner statuses must
    # then use this same comparison result instead of independently selecting a
    # room by whichever spreadsheet row happened to be processed last.
    room_comparison_changes, matched_rooms_by_assignment = ([], {}) if room_list_has_no_data else _room_comparison_changes(
        people, rooms, categories['removedAthletes']['records'], include_matches=True, read_context=read_context)

    change_index = {}

    def add(change_type, preview, entity_id, description, severity='warning', **extra):
        """Add one business change per preview row and semantic status.

        Several people can explain the same room impact (for example when both
        occupants change their travel dates).  The room card and room row still
        describe one changed assignment, so keep a single status for it.
        """
        entity_id = str(entity_id or '')
        key = (change_type, preview, entity_id)
        if key in change_index:
            existing = change_index[key]
            affected = set(existing.get('affectedPersonIds', []))
            affected.update(filter(None, [existing.pop('affectedPersonId', None), extra.pop('affectedPersonId', None)]))
            if affected:
                existing['affectedPersonIds'] = sorted(affected)
            return
        change = {'type': change_type, 'preview': preview, 'severity': severity,
                  'entityId': entity_id, 'description': description, **extra}
        changes.append(change)
        change_index[key] = change

    for record in categories['newAthletes']['records']:
        add('NEW_PERSON', 'persons', record.get('entityId'), 'Neue Person')
    for record in categories['removedAthletes']['records']:
        add('PERSON_REMOVED', 'persons', record.get('personId'), 'Person entfernt')
    for record in categories['updatedAthletes']['records']:
        fields = {item['field'] for item in record.get('changes', [])}
        semantic_fields = (
            ('Funktion', 'FUNCTION_CHANGED', 'Funktion geändert'),
            ('Nation', 'COUNTRY_CHANGED', 'Nation geändert'),
        )
        for field, change_type, description in semantic_fields:
            if field in fields:
                add(change_type, 'persons', record.get('entityId'), description)
    for record in categories['roomRequirementChanged']['records']:
        old_single, new_single = record.get('old') == 'EZ', record.get('new') == 'EZ'
        change_type = 'SINGLE_ROOM_CHANGED' if old_single != new_single else 'ROOMTYPE_CHANGED'
        add(change_type, 'persons' if change_type == 'SINGLE_ROOM_CHANGED' else 'rooms',
            record.get('entityId'), 'Einzelzimmer geändert' if old_single != new_single else 'Zimmerart geändert')
    for record in categories['stayChanged']['records']:
        entity_id = record.get('entityId')
        add('STAY_CHANGED', 'persons', entity_id, 'Aufenthalt geändert')
        existing = _find_existing_athlete(
            next((person for person in people if person.get('matchKey') == entity_id), {}),
            read_context.athlete_maps if read_context is not None else _build_existing_athlete_maps(),
        )
        context = _assignment_context(existing, read_context) if existing else None
        assignment_id = str(context['assignmentId']) if context and context.get('assignmentId') else None
        matched_rooms = matched_rooms_by_assignment.get(assignment_id, [])
        room = next((candidate for candidate in matched_rooms
                     if candidate.get('person1Key') == entity_id), None)
        if room is None and matched_rooms:
            room = matched_rooms[0]
        if room is None:
            room = room_by_person.get(entity_id)
        if room:
            add('STAY_CHANGED', 'rooms', room.get('sourceRowKey'), 'Aufenthalt geändert',
                affectedPersonId=str(entity_id or ''))
    for change_type, entity_id, description in room_comparison_changes:
        add(change_type, 'rooms', entity_id, description)
    for issue in errors:
        preview = 'rooms' if issue.get('code', '').startswith('ROOM_') else 'persons'
        add('VALIDATION_ERROR', preview, issue.get('details', {}).get('row'), 'Validierungsfehler', 'error')
    return changes


def cleanup_preview_store():
    now = datetime.utcnow()
    expired = [
        token for token, value in PREVIEW_STORE.items()
        if (now - value['createdAt']).total_seconds() > PREVIEW_TTL_SECONDS
    ]
    for token in expired:
        PREVIEW_STORE.pop(token, None)


def create_fis_import_preview(entries_path, roomlist_path, event=None, *, read_context=None):
    cleanup_preview_store()
    entries_df = load_first_sheet(entries_path)
    room_df = load_first_sheet(roomlist_path)
    event, _ = revalidate_confirmation_event(import_event_id(event.id if event else None), [], validate_codes=False)
    read_context = read_context or ImportReadContext(event.id)
    rules_for_event(event.id)
    athlete_maps = read_context.athlete_maps

    mapping = None
    if event is not None:
        mapping = active_competition_mapping(event)
    people_result = parse_entries_list(entries_df, athlete_maps, mapping, event.name if event else None, event.id if event else None)
    room_result = parse_room_list(room_df, people_result['people'])
    requirement_issues = apply_preview_requirements(people_result['people'], room_result['rooms'], read_context=read_context)
    apply_preview_rates(people_result['people'], read_context=read_context)
    apply_single_room_quota_exemptions(people_result['people'], event_id=event.id if event else None, read_context=read_context)
    quota_checks = []
    quota_warnings = build_quota_warnings(people_result['people'], room_result['rooms'], quota_checks, read_context=read_context)
    for warning in quota_warnings:
        if warning.get('code') in {'INFO_OFFICIALS_OVER_BASIS', 'QUOTA_SINGLE_ROOMS_EXCEEDED'}:
            warning['details']['eventId'] = event.id if event else None
    preserved = preserved_single_room_approvals(people_result['people'], room_result['rooms'], read_context=read_context)
    apply_preserved_single_room_approvals(quota_warnings, preserved)
    apply_single_room_entitlement_preview(
        people_result['people'], room_result['rooms'], quota_checks, preserved)
    disposition_analysis = build_disposition_analysis(
        people_result['people'], room_result['rooms'], quota_warnings, read_context=read_context,
        room_list_has_no_data=is_empty_fis_room_list(room_df)
    )

    blocking_errors = (requirement_issues + people_result['errors'] + room_result['errors']
        + quota_gender_errors(people_result['people'])
        + single_room_context_errors(people_result['people'], room_result['rooms']))
    unknown = next((issue for issue in blocking_errors
                    if issue.get('code') == 'ENTRY_UNKNOWN_COMPETITION_COLUMNS'), None)
    if event is not None and unknown:
        import_codes = unknown.get('details', {}).get('columns', [])
        import_code = import_codes[0] if len(import_codes) == 1 else None
        raise ImportValidationError(
            'UNKNOWN_COMPETITION_CODE', unknown['message'],
            event_id=event.id, import_code=import_code,
            details={'membershipErrors': wsc_membership_errors(people_result['people'], event.id)}
                if any(p.get('affirmativeWscColumns') for p in people_result['people']) else None,
        )
    disposition_analysis['changes'] = build_import_changes(
        disposition_analysis, people_result['people'], room_result['rooms'], blocking_errors, read_context=read_context,
        room_list_has_no_data=is_empty_fis_room_list(room_df)
    )
    preview = {
        'createdAt': datetime.utcnow(),
        'eventId': event.id if event else None,
        'people': people_result['people'],
        'rooms': room_result['rooms'],
        'roomListHasNoData': is_empty_fis_room_list(room_df),
        'entriesColumns': list(entries_df.columns),
        'roomColumns': list(room_df.columns),
        'dayColumns': room_result['dayColumns'],
        'detectedDiscipline': None,
        'errors': blocking_errors,
        'warnings': people_result['warnings'] + room_result['warnings'] + quota_warnings,
        'quotaChecks': quota_checks,
        'athleteQuotaChecks': evaluate_athlete_quota_usage(people_result['people'],rules_for_event(event.id)),
        'preservedSingleRoomApprovals': {
            key: {'decisionId': value['decisionId'], 'groups': [list(group) for group in value['groups']]}
            for key, value in preserved.items()
        },
        'singleRoomQuotaExemptOverrides': {},
        'dispositionAnalysis': disposition_analysis,
    }

    from athlete_quota import project_preview
    project_preview(preview,read_context)
    preview_token = uuid.uuid4().hex
    PREVIEW_STORE[preview_token] = preview

    return {
        'previewToken': preview_token,
        'roomListHasNoData': preview['roomListHasNoData'],
        'eventId': str(event.id) if event else None,
        'isValid': preview['isValid'],
        'summary': {
            'people': {
                'total': len(people_result['people']),
                'wouldCreate': sum(1 for person in people_result['people'] if person['operation'] == 'create'),
                'wouldUpdate': sum(1 for person in people_result['people'] if person['operation'] == 'update'),
            },
            'rooms': {
                'total': len(accommodation_room_requests(people_result['people'], room_result['rooms'])),
                'wouldReplaceFisRooms': FisRoomAssignment.query.join(Athlete, FisRoomAssignment.person1_id == Athlete.id).filter(Athlete.event_id == event.id).count(),
                'singles': sum(normalize_string(room.get('roomType')) == 'single' for room in accommodation_room_requests(people_result['people'], room_result['rooms'])),
                'shared': sum(normalize_string(room.get('roomType')) == 'double shared' for room in accommodation_room_requests(people_result['people'], room_result['rooms'])),
            },
            'validation': {
                'errorCount': len(preview['errors']),
                'warningCount': len(preview['warnings']),
            },
        },
        'entriesColumns': preview['entriesColumns'],
        'roomColumns': preview['roomColumns'],
        'dayColumns': preview['dayColumns'],
        'detectedDiscipline': preview.get('detectedDiscipline'),
        'people': [_serialize_person_preview(person) for person in people_result['people']],
        'rooms': [_serialize_room_preview(room) for room in room_result['rooms']],
        'errors': preview['errors'],
        'warnings': preview['warnings'],
        'athleteQuotaChecks': preview['athleteQuotaChecks'],
        'quotaRulesSnapshot': preview['quotaRulesSnapshot'],
        'quotaRulesDigest': preview['quotaRulesDigest'],
        'quotaRulesRevision': preview['quotaRulesRevision'],
        'quotaOverview': preview['quotaOverview'],
        'quotaChecks': preview['quotaChecks'],
        'singleRoomQuotaExemptOverrides': preview['singleRoomQuotaExemptOverrides'],
        'dispositionAnalysis': disposition_analysis,
    }


def resolve_saved_quota_memberships(person, event_mapping=None, *, read_context=None):
    """Prefer exact saved IDs for eventless previews; never infer from labels."""
    if event_mapping is not None:
        if 'savedCompetitionIdsEvidence' in person or (not person.get('competitionImportCodes') and 'affirmativeWscColumns' not in person):
            if 'savedCompetitionIdsEvidence' not in person:
                ids = {str(value) for value in person.get('competitionIds', [])}
                ids.update(str(item['competitionId']) for item in person.get('competitionMemberships', [])
                           if item.get('competitionId') is not None)
                person['savedCompetitionIdsEvidence'] = sorted(ids)
            ids = set(person['savedCompetitionIdsEvidence'])
            # Legacy previews can be read through exact IDs within the active
            # event mapping. No label or source-column inference is permitted.
            person['competitionImportCodes'] = [code for code, item in event_mapping.items()
                if str(item.id) in ids]
        return resolve_current_quota_memberships(person, event_mapping)
    ids = person.get('competitionIds') or [c.get('competitionId')
        for c in person.get('competitionMemberships', []) if c.get('competitionId') is not None]
    if ids:
        rows = ([read_context.competitions_by_id[key] for key in normalize_competition_ids(ids)
                 if key in read_context.competitions_by_id] if read_context is not None else
                Competition.query.filter(Competition.id.in_(normalize_competition_ids(ids))).all())
        if {str(c.id) for c in rows} == {str(value) for value in ids}:
            # Keep the saved exact IDs, including if no event-specific import
            # codes can be reconstructed. Current grouping comes from DB rows.
            person['competitionIds'] = sorted({str(c.id) for c in rows})
            person['competitionMemberships'] = [
                {'competitionId': str(c.id), 'importCode': c.import_code, 'quotaDiscipline': c.quota_discipline}
                for c in sorted(rows, key=lambda row: row.id)]
            from competitions import competition_athlete_family
            person['athleteQuotaFamilies']=sorted({competition_athlete_family(c) for c in rows},key=lambda value:value or '')
            person['quotaDisciplines'] = quota_disciplines(rows)
            person['topLevelDisciplines'] = list(person['quotaDisciplines'])
            person['athleteTopLevelDisciplines'] = sorted(set(person.get('athleteQuotaFamilies',[])) - {None}) if normalize_string(person.get('function')) == 'athlete' else []
            return person
    person['competitionIds'] = []
    person['competitionMemberships'] = []
    person['quotaDisciplines'] = []
    person['topLevelDisciplines'] = []
    person['athleteTopLevelDisciplines'] = []
    person['athleteQuotaFamilies'] = []
    return person


def recalculate_fis_import_preview(preview, *, read_context=None):
    """Replace all quota-derived preview state after a staged override.

    Overrides are review-time commands, not immediate writes to live Athlete
    state.  Recalculation must update warnings, provisional entitlements,
    disposition analysis, and change summaries together; updating only the
    visible warning would let confirmation consume a preview whose derived
    sections disagree.  The function accepts both typed parser output and the
    JSON-compatible preview persisted on an ImportSessionVersion.
    """
    if read_context is None:
        read_context = ImportReadContext(import_event_id(preview.get('eventId')))
    if read_context.event_id != import_event_id(preview.get('eventId')):
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'ReadContext und Preview gehören zu verschiedenen Events.')
    preview['eventId'] = read_context.event_id
    for person in preview.get('people', []):
        if person.get('eventId') is not None and import_event_id(person['eventId']) != read_context.event_id:
            raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Person und Preview gehören zu verschiedenen Events.')
        person['eventId'] = read_context.event_id
        person['fisCode'] = canonical_fis_code(person.get('fisCode')) or None
    people, rooms = preview.get('people', []), preview.get('rooms', [])
    validate_people_identities(people, read_context.athlete_maps)
    missing_evidence = []
    if any(str(column).upper().startswith('WSC_') for column in preview.get('entriesColumns', [])):
        missing_evidence = [{'code': 'ENTRY_WSC_SOURCE_EVIDENCE_MISSING',
            'message': 'Gespeicherte WSC-Quellzuordnungen fehlen; Meldelisten erneut prüfen.',
            'details': {'personKey': person.get('matchKey')}} for person in people
            if 'affirmativeWscColumns' not in person and not person.get('competitionImportCodes')
            and not person.get('competitionIds') and not person.get('competitionMemberships')]
    mapping = None
    if preview.get('eventId') is not None:
        _, mapping = revalidate_confirmation_event(preview.get('eventId'), people, validate_codes=False)
    for person in people:
        resolve_saved_quota_memberships(person, mapping, read_context=read_context)
    requirement_issues = apply_preview_requirements(people, rooms, preview.get('accommodationRequirementOverrides'), read_context=read_context)
    apply_preview_rates(people, preview.get('accommodationRateOverrides'), read_context=read_context)
    apply_single_room_quota_exemptions(
        people, preview.get('singleRoomQuotaExemptOverrides', {}), preview.get('eventId'),
        preview.get('carriedSingleRoomQuotaExemptKeys', []),
        preview.get('singleRoomQuotaExemptOverrideRevisions', {}), read_context=read_context)
    roster = [preview_approval_person(p, competitions_by_id=read_context.competitions_by_id if read_context is not None else None) for p in people]
    decision_ids = set(preview.get('_currentApprovalIds', []))
    decisions = ImportApproval.query.join(ImportSession).filter(
        ImportSession.event_id == read_context.event_id, ImportApproval.id.in_(decision_ids)).options(
            db.joinedload(ImportApproval.session).selectinload(ImportSession.versions)).all() if decision_ids else []
    if {d.id for d in decisions} != decision_ids:
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Genehmigungen fehlen oder gehören zu einem anderen Event.')
    for person, current in zip(people, roster):
        person.pop('_reviewApproval', None)
        for decision in decisions:
            if not decision or decision.decision != 'APPROVED':
                continue
            details = json.loads(decision.quota_details_json or '{}')
            if not approval_event_matches(decision, preview.get('eventId')):
                continue
            groups = applicable_approval_groups(decision, current, person.get('matchKey'), roster)
            if groups:
                person['_reviewApproval'] = {'decisionId': decision.id, 'groups': [list(g) for g in groups]}
    quota_checks = []
    quota_warnings = build_quota_warnings(people, rooms, quota_checks, read_context=read_context)
    for warning in quota_warnings:
        if warning.get('code') in {'INFO_OFFICIALS_OVER_BASIS', 'QUOTA_SINGLE_ROOMS_EXCEEDED'}:
            warning['details']['eventId'] = preview.get('eventId')
    preserved = preserved_single_room_approvals(people, rooms, read_context=read_context)
    apply_preserved_single_room_approvals(quota_warnings, preserved)
    apply_single_room_entitlement_preview(people, rooms, quota_checks, preserved)
    preview['preservedSingleRoomApprovals'] = {
        key: {'decisionId': value['decisionId'], 'groups': [list(group) for group in sorted(value['groups'])]}
        for key, value in preserved.items()}
    preview['quotaChecks'] = quota_checks
    preview['athleteQuotaChecks'] = evaluate_athlete_quota_usage(people,rules_for_event(read_context.event_id))
    preview['errors'] = ([e for e in preview.get('errors', [])
        if not e.get('code', '').startswith(('ENTRY_QUOTA_GENDER_', 'ENTRY_WSC_MEMBERSHIP', 'ENTRY_WSC_SOURCE_', 'ENTRY_SINGLE_ROOM_CONTEXT_', 'ACCOMMODATION_REQUIREMENT_'))]
        + quota_gender_errors(people) + wsc_membership_errors(people, preview.get('eventId'))
        + missing_evidence + requirement_issues + single_room_context_errors(people, rooms))
    membership_warnings = [
        {'code': 'ENTRY_QUOTA_MEMBERSHIP_UNRESOLVED',
         'message': 'Keine exakte Competition-Membership für die Quotenprüfung vorhanden',
         'details': {'personKey': person.get('matchKey')}}
        for person in people if not person.get('quotaDisciplines')]
    preview['warnings'] = [warning for warning in preview.get('warnings', [])
        if not warning.get('code', '').startswith('QUOTA_')
        and warning.get('code') not in {'INFO_OFFICIALS_OVER_BASIS', 'ENTRY_QUOTA_MEMBERSHIP_UNRESOLVED', 'ENTRY_QUOTA_ALLOWANCE_UNRESOLVED'}] + membership_warnings + quota_warnings
    from athlete_quota import project_preview
    project_preview(preview,read_context)
    preview['dispositionAnalysis'] = build_disposition_analysis(people, rooms, quota_warnings, read_context=read_context,
        room_list_has_no_data=preview.get('roomListHasNoData', False))
    preview['dispositionAnalysis']['changes'] = build_import_changes(
        preview['dispositionAnalysis'], people, rooms, preview.get('errors', []), read_context=read_context,
        room_list_has_no_data=preview.get('roomListHasNoData', False))
    preview['isValid'] = not preview['errors']
    if 'summary' in preview:
        preview['summary']['validation'] = {'errorCount': len(preview['errors']), 'warningCount': len(preview['warnings'])}
        demand_rooms = accommodation_room_requests(people, rooms)
        preview['summary']['rooms']['total'] = len(demand_rooms)
        preview['summary']['rooms']['singles'] = sum(normalize_string(room.get('roomType')) == 'single' for room in demand_rooms)
        preview['summary']['rooms']['shared'] = sum(normalize_string(room.get('roomType')) == 'double shared' for room in demand_rooms)
    return preview


def _apply_person_record(athlete, person, now, *, rate_override=None, preserve_missing_roomlist=False):
    # Snapshot-derived values never overwrite live operational decisions.
    # Only an explicit reviewed override writes tariff metadata.
    if rate_override:
        rate = resolve_rate(athlete, rate_override)
        athlete.accommodation_rate_category = rate['accommodationRateCategory']
        athlete.accommodation_rate_source = rate['accommodationRateSource']
        athlete.accommodation_rate_approval_id = None
    elif person.get('accommodationRateSource') == 'APPROVAL' and person.get('accommodationRateApprovalId') and athlete.accommodation_rate_source != 'MANUAL':
        athlete.accommodation_rate_category = 'SPECIAL'
        athlete.accommodation_rate_source = 'APPROVAL'
        athlete.accommodation_rate_approval_id = person['accommodationRateApprovalId']
    athlete.function = person.get('function')
    athlete.competitor_id = person.get('competitorId') or athlete.competitor_id
    athlete.accred_id = person.get('accredId')
    athlete.fis_code = person.get('fisCode') or athlete.fis_code
    athlete.lastname = person.get('lastname')
    athlete.firstname = person.get('firstname')
    athlete.nation_code = person.get('nationCode')
    athlete.discipline = person.get('industryName') or athlete.discipline
    athlete.gender = person.get('gender')
    athlete.for_gender = person.get('forGender')
    athlete.phone = person.get('phone')
    athlete.email = person.get('email')
    athlete.present = person.get('present', False)
    athlete.wc_sbx_w = person.get('wcSbxW', False)
    athlete.wc_sbx_m = person.get('wcSbxM', False)
    athlete.arrival_date = person.get('arrivalDate')
    athlete.arrival_time = person.get('arrivalTime')
    athlete.arrival_by = person.get('arrivalBy')
    athlete.arrival_airport = person.get('arrivalAirport')
    athlete.arrival_airport_name = person.get('arrivalAirportName')
    athlete.arrival_flight_no = person.get('arrivalFlightno')
    athlete.arrival_need_transportation = person.get('arrivalNeedTransportation', False)
    athlete.departure_date = person.get('departureDate')
    athlete.departure_time = person.get('departureTime')
    athlete.departure_by = person.get('departureBy')
    athlete.departure_airport = person.get('departureAirport')
    athlete.departure_airport_name = person.get('departureAirportName')
    athlete.departure_flight_no = person.get('departureFlightno')
    athlete.departure_need_transportation = person.get('departureNeedTransportation', False)
    if not preserve_missing_roomlist or person.get('roomType'):
        athlete.room_type = person.get('roomType')
    if not preserve_missing_roomlist or person.get('sharedWithName'):
        athlete.shared_with_name = person.get('sharedWithName')
    athlete.late_checkout = person.get('lateCheckout', False)
    athlete.first_meal = person.get('firstMeal')
    athlete.last_meal = person.get('lastMeal')
    athlete.special_meal = person.get('specialMeal')
    athlete.additional_items = person.get('additionalItems')
    athlete.entry_date = person.get('entryDate')
    athlete.last_update = person.get('lastUpdate')
    athlete.entries_sent_date = person.get('entriesSentDate')
    athlete.tv_picture_status = person.get('tvPictureStatus')
    athlete.tv_picture_date = person.get('tvPictureDate')
    athlete.stance = person.get('stance')
    athlete.athletes_last_seen_at = now
    athlete.roomlist_last_seen_at = now


def _snapshot_roomlist_fields(athlete):
    return {
        'nationCode': athlete.nation_code or None,
        'event': athlete.discipline or None,
        'arrivalDate': athlete.arrival_date.isoformat() if athlete.arrival_date else None,
        'departureDate': athlete.departure_date.isoformat() if athlete.departure_date else None,
        'roomType': athlete.room_type or None,
        'sharedWithName': athlete.shared_with_name or None,
        'firstMeal': athlete.first_meal or None,
        'lastMeal': athlete.last_meal or None,
        'specialMeal': athlete.special_meal or None,
    }


IMPORT_CHANGE_FIELDS = {
    'nationCode': 'NATION_CHANGED',
    'event': 'EVENT_CHANGED',
    'arrivalDate': 'DATE_CHANGED',
    'departureDate': 'DATE_CHANGED',
    'firstMeal': 'DATE_CHANGED',
    'lastMeal': 'DATE_CHANGED',
    'sharedWithName': 'ROOMMATE_CHANGED',
    'roomType': 'ROOM_DEMAND_CHANGED',
    'specialMeal': 'ROOM_DEMAND_CHANGED',
}


def _typed_import_changes(changed_keys):
    """Return stable, de-duplicated operational change reasons."""
    return list(dict.fromkeys(
        IMPORT_CHANGE_FIELDS[key] for key in changed_keys if key in IMPORT_CHANGE_FIELDS
    ))


def _remove_athletes(athletes):
    raise ImportValidationError('IMPORT_DESTRUCTIVE_CHANGE_REVIEW_REQUIRED',
        'Personenlöschung erfordert den abgesicherten Snapshot-Änderungsplan (PR 3).')


def _remove_duplicates():
    raise ImportValidationError('IMPORT_IDENTITY_CONFLICT',
        'Automatische Dublettenlöschung ist deaktiviert; Identitäten ausdrücklich prüfen.')


def validate_fis_import_token(preview_token):
    """Return the existing typed preview without applying any import writes."""
    cleanup_preview_store()
    version=ImportSessionVersion.query.join(ImportSession, ImportSession.current_version_id==ImportSessionVersion.id).filter(
        ImportSessionVersion.preview_token==preview_token).first()
    if version:
        from imports.workflow import load_version_preview
        preview=load_version_preview(version)
    else:
        preview=PREVIEW_STORE.get(preview_token)
    if not preview:
        raise ValueError('Preview token not found or expired')
    if preview['errors']:
        raise ValueError('Preview contains blocking validation errors')
    return preview


def confirm_fis_import(preview_token, approved_extra_single_room_decisions=None, *, confirmer=None, persisted_preview=None, change_plan=None):
    """Apply event-scoped parsed facts without committing.

    HTTP callers supply the exact durable, explicitly approved change plan under
    the snapshot lock. Legacy internal callers may update/create only; removals
    require a reviewed plan. Retained bookings keep their physical room type and
    counts_as_single. The endpoint owns data, workflow, audit and final commit.
    """
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    db.session.expire_all()
    preview = persisted_preview if persisted_preview is not None else validate_fis_import_token(preview_token)

    now = datetime.utcnow()
    run = ImportRun(event_id=preview.get('eventId'), import_type='fis_confirm', started_at=now)
    db.session.add(run)
    db.session.flush()

    read_context = ImportReadContext(import_event_id(preview.get('eventId')))
    athlete_maps = read_context.athlete_maps
    event, competitions_by_import_code = revalidate_confirmation_event(
        preview.get('eventId'), preview.get('people', []))

    version = ImportSessionVersion.query.join(ImportSession,
        ImportSession.current_version_id == ImportSessionVersion.id).filter(
            ImportSessionVersion.preview_token == preview_token).first()
    if version:
        validate_session_event(version.session, preview, read_context.event_id)
    preview['_currentApprovalIds'] = [a.id for a in version.session.current_approvals] if version else []
    recalculate_fis_import_preview(preview, read_context=read_context)
    if preview.get('errors'):
        raise ImportValidationError('IMPORT_VALIDATION_FAILED', 'Preview enthält blockierende Fehler.')
    if version:
        validate_session_event(version.session, preview, read_context.event_id)
        requirements = quota_requirement_errors(preview, version.session.current_approvals, read_context=read_context)
        if requirements:
            raise ImportValidationError('QUOTA_REQUIREMENTS_UNREVIEWED',
                'Aktuelle Quotenverletzungen sind nicht durch anwendbare Entscheidungen abgedeckt.',
                details={'requirements': requirements})

    from athlete_quota import requirement_errors as athlete_requirement_errors
    athlete_errors=athlete_requirement_errors(preview,[],True)
    if athlete_errors:
        raise ImportValidationError('ATHLETE_QUOTA_UNREVIEWED', 'Athletenquote benötigt eine anwendbare Genehmigung vor Confirm.',details={'requirements':athlete_errors})

    # Legacy internal callers cannot bypass explicit destructive review.
    imported_nations = {p.get('nationCode') for p in preview['people'] if p.get('nationCode')}
    matched_ids = {a.id for p in preview['people'] if (a := _find_existing_athlete(p, athlete_maps))}
    missing = [a for a in read_context.athletes if a.nation_code in imported_nations and a.id not in matched_ids]
    if missing and change_plan is None:
        raise ImportValidationError('IMPORT_DESTRUCTIVE_CHANGE_REVIEW_REQUIRED',
            'Fehlende Personen benötigen einen ausdrücklich geprüften Snapshot-Scope (PR 3).',
            event_id=read_context.event_id, details={'personIds': [a.id for a in missing]})

    persisted_people = {}
    created = 0
    updated = 0

    # Mapping person key -> ImportApproval id. Iterables remain accepted for
    # backwards compatibility with internal callers from earlier releases.
    preserved = preserved_single_room_approvals(
        preview.get('people', []), preview.get('rooms', []), read_context=read_context)
    if approved_extra_single_room_decisions is None:
        approved_extra_single_room_decisions = {}
    elif not hasattr(approved_extra_single_room_decisions, 'get'):
        approved_extra_single_room_decisions = {
            key: None for key in approved_extra_single_room_decisions
        }
    approved_extra_single_room_decisions = {
        **{key: value['decisionId'] for key, value in preserved.items()},
        **approved_extra_single_room_decisions,
    }
    requested_ids = {value for value in approved_extra_single_room_decisions.values() if value is not None}
    scoped_decisions = {d.id: d for d in ImportApproval.query.join(ImportSession).filter(
        ImportSession.event_id == read_context.event_id, ImportApproval.id.in_(requested_ids)).options(
            db.joinedload(ImportApproval.session).selectinload(ImportSession.versions)).all()} if requested_ids else {}
    if set(scoped_decisions) != requested_ids:
        raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Genehmigung fehlt oder gehört zu einem anderen Event.')
    resolved_decisions = {}
    current_roster = [preview_approval_person(p, competitions_by_id=read_context.competitions_by_id if read_context is not None else None) for p in preview.get('people', [])]
    unresolved_decisions = []
    for person in preview.get('people', []):
        key = person.get('matchKey')
        if key not in approved_extra_single_room_decisions:
            continue
        decision_id = approved_extra_single_room_decisions[key]
        decision = scoped_decisions.get(decision_id)
        if decision_id is not None and (not decision or not approval_event_matches(decision, read_context.event_id)):
            raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Genehmigung gehört zu einem anderen Event.')
        applicable = quota_keys(person, preview.get('people', [])) & applicable_approval_groups(decision, preview_approval_person(person, competitions_by_id=read_context.competitions_by_id if read_context is not None else None), key, current_roster)
        if applicable:
            resolved_decisions[key] = decision_id
        else:
            unresolved_decisions.append(decision_id)
    if unresolved_decisions:
        raise ImportValidationError('APPROVAL_MEMBERSHIP_UNRESOLVED',
            'Die Genehmigung ist für die aktuelle Competition-Membership nicht nachgewiesen.')
    approved_extra_single_room_decisions = resolved_decisions
    exemption_overrides = preview.get('singleRoomQuotaExemptOverrides', {})
    room_by_person = {}
    for room in preview.get('rooms', []):
        room_by_person[room.get('person1Key')] = room
        if room.get('person2Key'):
            room_by_person[room.get('person2Key')] = room
    confirmed_preserved = {}
    for person in preview['people']:
        key = person.get('matchKey')
        if key in approved_extra_single_room_decisions:
            decision = db.session.get(ImportApproval, approved_extra_single_room_decisions[key])
            groups = applicable_approval_groups(decision, preview_approval_person(person, competitions_by_id=read_context.competitions_by_id if read_context is not None else None), key, current_roster)
            confirmed_preserved[key] = {'groups': groups}
    # New approvals can free normal slots for other people. Re-run the same
    # matcher over the distinct request/retained demand, with validated evidence.
    request_records = []
    for person in preview['people']:
        room = room_by_person.get(person.get('matchKey'))
        evidence = confirmed_preserved.get(person.get('matchKey'))
        request_records.append({**person, 'countsAsSingle': bool(person.get('accommodationRequirement') != 'NO_ROOM' and room and normalize_string(room.get('roomType')) == 'single'),
            'approvedQuotaContexts': [{'nationCode': n, 'discipline': d, 'gender': g}
                for n, d, g in sorted(evidence['groups'])] if evidence else [],
            'singleRoomStatus': 'APPROVED_EXTRA' if evidence else None})
    # Retained booked singles are represented in the freshly recalculated checks.
    booked_keys = {item['personKey'] for check in preview.get('quotaChecks', [])
        for item in check.get('singleRoomAllocations', [])}
    for person in request_records:
        person['countsAsSingle'] = person['countsAsSingle'] or person.get('matchKey') in booked_keys
    capacities = {(c['nationCode'], c['discipline'], c['gender']): c['singleRoomsAllowed']
                  for c in preview.get('quotaChecks', [])}
    allocation = allocate_single_rooms(request_records, capacities, preview['people'])
    by_identity = {item['identity']: item for item in allocation}
    for person in preview['people']:
        item = by_identity.get(person_identity(person))
        person['singleRoomAllocation'] = item
        if item:
            person['singleRoomEntitlement'] = {'EXEMPT': 'QUOTA_EXEMPT', 'APPROVED_EXTRA': 'APPROVED_EXTRA',
                'COVERED': 'IN_QUOTA', 'PENDING': 'APPROVAL_REQUIRED'}[item['status']]

    with db.session.no_autoflush:
        for person in preview['people']:
            athlete = _find_existing_athlete(person, athlete_maps)
            operational_decision=None
            if athlete and athlete.single_room_decision_id and applicable_approval_groups(athlete.single_room_decision,
                    preview_approval_person(person,competitions_by_id=read_context.competitions_by_id),person.get('matchKey'),current_roster,preserve_historical_rule=True):
                operational_decision=(athlete.single_room_status,athlete.single_room_entitlement,athlete.single_room_decision_id)
            existing_before = _snapshot_roomlist_fields(athlete) if athlete else None
            identity_before = (athlete.fis_code, athlete.competitor_id, athlete.lastname,
                               athlete.firstname, athlete.nation_code) if athlete else None
            if athlete is None:
                athlete = Athlete(
                    event_id=preview['eventId'],
                    lastname=person['lastname'],
                    firstname=person['firstname'],
                    nation_code=person['nationCode'],
                )
                db.session.add(athlete)
                db.session.flush()
                read_context.athletes.append(athlete)
                created += 1
            else:
                updated += 1

            rate_override = (preview.get('accommodationRateOverrides') or {}).get(person.get('matchKey'))
            if rate_override and athlete.id is not None:
                # Persist earlier records before populate_existing can refresh an identity
                # repeated in this snapshot. Keep the existing row-lock/base check.
                db.session.flush()
                athlete = Athlete.query.filter_by(id=athlete.id, event_id=read_context.event_id).with_for_update().populate_existing().one()
            old_rate = (athlete.accommodation_rate_category, athlete.accommodation_rate_source, athlete.accommodation_rate_approval_id)
            missing_roomlist = bool(preview.get('roomListHasNoData') and existing_before is not None)
            _apply_person_record(athlete, person, now, rate_override=rate_override,
                                 preserve_missing_roomlist=missing_roomlist)
            new_rate = (athlete.accommodation_rate_category, athlete.accommodation_rate_source, athlete.accommodation_rate_approval_id)
            if version and old_rate != new_rate and athlete.accommodation_rate_source == 'APPROVAL':
                db.session.add(ImportSessionEvent(session_id=version.session_id, version_id=version.id,
                    approval_id=athlete.accommodation_rate_approval_id, event_type='ACCOMMODATION_RATE_APPROVAL',
                    title='Sondertarif aus Athletenquoten-Genehmigung übernommen',
                    description=f"{person['matchKey']}: {old_rate} → {new_rate}", username=confirmer or 'FIS Import'))
            old_requirement = (athlete.accommodation_requirement, athlete.accommodation_requirement_source)
            set_requirement(athlete, person['accommodationRequirement'], person['accommodationRequirementSource'])
            if person.get('importAccommodationRequirement'):
                athlete.accommodation_requirement_import_value = person['importAccommodationRequirement']
            if version and old_requirement != (athlete.accommodation_requirement, athlete.accommodation_requirement_source):
                db.session.add(ImportSessionEvent(session_id=version.session_id, version_id=version.id,
                    event_type='ACCOMMODATION_REQUIREMENT_IMPORT', title='Unterkunftsbedarf übernommen',
                    description=f"{person['matchKey']}: {old_requirement} → {(athlete.accommodation_requirement, athlete.accommodation_requirement_source)}", username=confirmer or 'FIS Import'))
            from world_champions import audit_status
            new_reason = person.get('singleRoomQuotaExemptReason')
            new_source = person.get('singleRoomExemptionSource')
            if (athlete.single_room_quota_exempt_reason, athlete.single_room_exemption_source) != (new_reason, new_source):
                audit_status(athlete.id, new_source, new_reason,
                    confirmer or 'import', person.get('worldChampionReferences'), preview.get('eventId'), person.get('fisCode'), athlete.id,
                    version.session_id if version else None)
            athlete.single_room_quota_exempt_reason = new_reason
            athlete.single_room_exemption_source = new_source
            if athlete.single_room_quota_exempt_reason and athlete.accommodation_requirement != 'NO_ROOM':
                if athlete.single_room_decision:
                    decision = athlete.single_room_decision
                    db.session.add(ImportSessionEvent(
                        session_id=decision.session_id, version_id=decision.version_id,
                        approval_id=decision.id, event_type='QUOTA_DECISION_REVISED_FROM',
                        title='Quotenentscheidung durch EZ-Sonderstatus abgelöst',
                        description=f'{athlete.firstname} {athlete.lastname}'.strip(),
                        username=confirmer or 'FIS Import'))
                athlete.single_room_status = 'NONE'
                athlete.single_room_entitlement = None
                athlete.single_room_decision_id = None
            athlete.competitions = list({competitions_by_import_code[code].id: competitions_by_import_code[code]
                for code in person.get('competitionImportCodes', [])}.values())
            # _apply_person_record retains the source's legacy discipline label.
            # Exact memberships live only in AthleteCompetition, never in this label.
            room = room_by_person.get(person.get('matchKey'))
            requests_single = bool((room and normalize_string(room.get('roomType')) == 'single')
                or person.get('singleRoomAllocation') is not None)
            if missing_roomlist or athlete.accommodation_requirement == 'NO_ROOM':
                pass  # Missing request evidence and NO_ROOM must not revoke historical decisions.
            elif requests_single and athlete.single_room_quota_exempt_reason:
                athlete.single_room_entitlement = None
                athlete.single_room_status = 'NONE'
                athlete.single_room_decision_id = None
            elif requests_single:
                if person.get('matchKey') in approved_extra_single_room_decisions:
                    athlete.single_room_entitlement = 'APPROVED_EXTRA'
                    athlete.single_room_status = 'APPROVED_EXTRA'
                    athlete.single_room_decision_id = approved_extra_single_room_decisions.get(person.get('matchKey'))
                else:
                    within_quota = person.get('singleRoomEntitlement') == 'IN_QUOTA'
                    athlete.single_room_entitlement = 'IN_QUOTA' if within_quota else None
                    athlete.single_room_status = 'IN_QUOTA' if within_quota else 'PENDING_APPROVAL'
                    athlete.single_room_decision_id = None
            else:
                athlete.single_room_entitlement = None
                athlete.single_room_status = 'NONE'
                athlete.single_room_decision_id = None
            if operational_decision and person.get('matchKey') not in approved_extra_single_room_decisions and not athlete.single_room_quota_exempt_reason:
                # Retain the same historical person/price decision, not coverage of a new quota violation.
                athlete.single_room_status,athlete.single_room_entitlement,athlete.single_room_decision_id=operational_decision
            if existing_before is None:
                # A newly created person is new assignment work, not a change to an
                # existing disposition.  Keep the import reason, but deliberately do
                # not open a room-list review.
                athlete.roomlist_changed_at = None
                athlete.roomlist_change_summary = 'Neu importiert'
                athlete.import_change_types_json = json.dumps(['NEW_ATHLETE'])
                athlete.import_change_details_json = json.dumps([], ensure_ascii=False)
            else:
                existing_after = _snapshot_roomlist_fields(athlete)
                changed_keys = [key for key, value in existing_after.items() if existing_before.get(key) != value]
                change_types = _typed_import_changes(changed_keys)
                has_assignment = bool(athlete.room_booking_memberships)
                if change_types and has_assignment:
                    athlete.roomlist_changed_at = now
                    athlete.roomlist_change_summary = 'changed: ' + ', '.join(changed_keys)
                    athlete.import_change_types_json = json.dumps(change_types)
                    athlete.import_change_details_json = json.dumps([
                        {
                            'type': IMPORT_CHANGE_FIELDS[key],
                            'field': key,
                            'old': existing_before.get(key),
                            'new': existing_after.get(key),
                        }
                        for key in changed_keys if key in IMPORT_CHANGE_FIELDS
                    ], ensure_ascii=False)
                    athlete.roomlist_change_acknowledged_at = None
                    athlete.roomlist_change_acknowledged_summary = None
            persisted_people[person['matchKey']] = athlete
            identity_after = (athlete.fis_code, athlete.competitor_id, athlete.lastname,
                              athlete.firstname, athlete.nation_code)
            if identity_before != identity_after:
                # Rebuild only for changed identities, without rereading other events.
                athlete_maps = _build_existing_athlete_maps(read_context.athletes, event_id=read_context.event_id)

    db.session.flush()

    from imports.change_plan import apply_removals
    removed=0
    if change_plan:
        # The endpoint verified this exact server-owned plan under the transaction lock.
        apply_removals(change_plan)
        removed=len(change_plan['people']['remove'])
    deduplicated=0
    run.finished_at = datetime.utcnow()
    # The caller owns commit, workflow history and cache invalidation atomically.
    operations=change_plan['operations'] if change_plan else {}

    return {
        'success': True,
        'summary': {
            'peopleCreated': created,
            'peopleUpdated': len(change_plan['people']['update']) if change_plan else updated,
            'peopleUnchanged': len(change_plan['people']['unchanged']) if change_plan else 0,
            'peopleRemoved': removed,
            'duplicatesRemoved': deduplicated,
            'fisRoomsImported': 0,
            'fisRoomsReplaced': 0,
            'dispositionsChanged': len(operations.get('bookingIds',[]))+len(operations.get('legacy',[]))+len(operations.get('fis',[])),
            'bookingsAffected': len(operations.get('bookingIds',[])),
            'bookingsRemoved': len(operations.get('deleteEmptyBookingIds',[])),
            'occupantsRemoved': len(operations.get('removeOccupants',[])),
            'membershipsRemoved': len(change_plan['memberships']['remove']) if change_plan else 0,
            'approvalsPreserved': len(change_plan.get('approvalEvidence',[])) if change_plan else 0,
        },
        'run': run.to_dict(),
    }


def import_excel_file(file_path, app):
    with app.app_context():
        result = create_fis_import_preview(file_path, file_path)
        if not result['isValid']:
            return result
        return confirm_fis_import(result['previewToken'])
