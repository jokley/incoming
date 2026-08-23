import json
import re
import uuid
import unicodedata
import zipfile
from copy import deepcopy
from datetime import datetime, date, timedelta

import pandas as pd
from openpyxl.utils.exceptions import InvalidFileException
from sqlalchemy import func

from quota_service import evaluate_quota_usage, quota_key
from models import Athlete, Event, FisRoomAssignment, ImportRun, RoomAssignment, RoomBooking, RoomBookingOccupant, db


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
DAY_COLUMN_PATTERN = re.compile(r'^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+\d{2}\.\d{2}\.\d{4}')
DATETIME_FORMATS = (
    '%Y-%m-%d %H:%M:%S',
    '%Y-%m-%d %H:%M',
    '%d.%m.%Y %H:%M:%S',
    '%d.%m.%Y %H:%M',
)


def normalize_string(value):
    if value is None or pd.isna(value):
        return ''
    return ''.join(
        char for char in unicodedata.normalize('NFKD', str(value).strip().lower())
        if not unicodedata.combining(char)
    )


def normalize_whitespace(value):
    if value is None or pd.isna(value):
        return ''
    return ' '.join(str(value).replace('\u00a0', ' ').replace('\n', ' ').replace('\r', ' ').split())


def has_value(value):
    if value is None or pd.isna(value):
        return False
    if isinstance(value, str):
        return normalize_whitespace(value) != ''
    return True


def parse_boolean(value):
    if pd.isna(value) or value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(int(value))
    return normalize_string(value) in {'yes', 'ja', 'true', '1', 'x'}


def parse_date(value):
    if value is None or pd.isna(value) or value == '':
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return pd.to_datetime(value, unit='D', origin='1899-12-30').date()
        except (ValueError, OverflowError, TypeError):
            pass
    raw = str(value).strip()
    if raw.isdigit():
        try:
            return pd.to_datetime(int(raw), unit='D', origin='1899-12-30').date()
        except (ValueError, OverflowError, TypeError):
            pass
    for fmt in ('%d.%m.%Y', '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    return None


def parse_datetime(value):
    if value is None or pd.isna(value) or value == '':
        return None
    if isinstance(value, datetime):
        return value
    for fmt in DATETIME_FORMATS:
        try:
            return datetime.strptime(str(value).strip(), fmt)
        except ValueError:
            continue
    return None


def build_name_key(lastname, firstname, nationcode=''):
    return '|'.join([
        normalize_string(lastname),
        normalize_string(firstname),
        normalize_string(nationcode),
    ])


def _col_key(name):
    normalized = normalize_string(normalize_whitespace(name))
    return ''.join(char for char in normalized if char.isalnum())


def normalize_columns(df):
    aliases = {
        'competitoridstaffid': 'Competitorid/Staff ID',
        'accredid': 'Accredid',
        'fiscode': 'Fiscode',
        'lastname': 'Lastname',
        'firstname': 'Firstname',
        'nationcode': 'Nationcode',
        'industryname': 'Industryname',
        'industry': 'Industryname',
        'discipline': 'Industryname',
        'disciplinename': 'Industryname',
        'eventdiscipline': 'Industryname',
        'sportdiscipline': 'Industryname',
        'function': 'Function',
        'forgender': 'For_gender',
        'gender': 'Gender',
        'phone': 'Phone',
        'email': 'Email',
        'present': 'Present',
        'wcsbxw6061': 'WC_SBX_W_6061',
        'wcsbxm6060': 'WC_SBX_M_6060',
        'arrivaldate': 'Arrival_date',
        'arrivaltime': 'Arrival_time',
        'arrivalby': 'Arrival_by',
        'arrivalairport': 'Arrival_airport',
        'arrivalairportname': 'Arrival_airport_name',
        'arrivalflightno': 'Arrival_flightno',
        'arrivalneedtransportation': 'Arrival_need_transportation',
        'departuredate': 'Departure_date',
        'departuretime': 'Departure_time',
        'departureby': 'Departure_by',
        'departureairport': 'Departure_airport',
        'departureairportname': 'Departure_airport_name',
        'departureflightno': 'Departure_flightno',
        'departureneedtransportation': 'Departure_need_transportation',
        'roomtype': 'Room_type',
        'sharedwithname': 'Shared with Name',
        'sharedwithnationcode': 'Shared with Nationcode',
        'sharedwithindustryname': 'Shared with Industryname',
        'sharedwithfunction': 'Shared with Function',
        'sharedwithforgender': 'Shared with For_gender',
        'sharedwitharrivaldate': 'Shared with Arrival_date',
        'sharedwithdeparturedate': 'Shared with Departure_date',
        'sharedwithlatecheckout': 'Shared with Late_checkout',
        'sharedwithfirstmeal': 'Shared_with_First_meal',
        'sharedwithlastmeal': 'Shared_with_Last_meal',
        'sharedwithspecialmeal': 'Shared_with_Special_meal',
        'latecheckout': 'Late_checkout',
        'firstmeal': 'First_meal',
        'lastmeal': 'Last_meal',
        'specialmeal': 'Special_meal',
        'additionalitems': 'Additional_items',
        'entrydate': 'Entry_date',
        'lastupdate': 'Lastupdate',
        'entriessentdate': 'Entries_Sent_date',
        'tvpicturestatus': 'tv_picture_status',
        'tvpicturedate': 'tv_picture_date',
        'stance': 'Stance',
        'single': 'Single',
        'doubleshared': 'Double_shared',
        'doublesingle': 'Double_single',
        'appartment': 'Appartment',
    }

    normalized_columns = []
    for column in df.columns:
        clean = normalize_whitespace(column)
        normalized_columns.append(aliases.get(_col_key(clean), clean))
    df = df.copy()
    df.columns = normalized_columns
    return df


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

    events = Event.query.all()
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
        workbook = pd.read_excel(path, sheet_name=None)
    except (zipfile.BadZipFile, KeyError, InvalidFileException, ValueError) as exc:
        raise InvalidExcelFileError(
            f'Invalid Excel file: {source_name}. Please upload a valid .xlsx/.xls file exported by Excel.'
        ) from exc
    if not workbook:
        raise InvalidExcelFileError(f'Excel file is empty: {source_name}')
    _, df = next(iter(workbook.items()))
    return normalize_columns(df)


def detect_fis_file_type(path, display_name=None):
    filename = normalize_string(path.split('\\')[-1].split('/')[-1])
    if 'roomlistdetailed' in filename or 'roomlist' in filename:
        return 'roomlist'
    if 'entrieslist' in filename and 'room' not in filename:
        return 'entries'

    df = load_first_sheet(path, display_name=display_name)
    columns = set(df.columns)
    if {'Competitorid/Staff ID', 'Accredid', 'Fiscode'}.intersection(columns):
        return 'entries'
    if {'Shared with Name', 'Room_type', 'Arrival_date', 'Departure_date'}.intersection(columns):
        return 'roomlist'
    return 'unknown'


def detect_day_columns(df):
    result = []
    for column in df.columns:
        collapsed = normalize_whitespace(column)
        match = DAY_COLUMN_PATTERN.match(collapsed)
        if not match:
            continue
        day_value = parse_date(match.group(0).split(' ')[1])
        if day_value:
            result.append({'column': column, 'date': day_value})
    return result


def validate_required_columns(df, required_columns):
    present = set(df.columns)
    return sorted(required_columns - present)


def _build_existing_athlete_maps():
    athletes = Athlete.query.all()
    maps = {
        'by_fis_code': {},
        'by_competitor_id': {},
        'by_name_key': {},
    }
    for athlete in athletes:
        if athlete.fis_code:
            # FIS code is the domain identity.  Keep the oldest productive row as
            # the canonical target when legacy imports left duplicates behind.
            maps['by_fis_code'].setdefault(str(athlete.fis_code).strip().upper(), athlete)
        if athlete.competitor_id:
            maps['by_competitor_id'][str(athlete.competitor_id)] = athlete
        maps['by_name_key'][build_name_key(athlete.lastname, athlete.firstname, athlete.nation_code)] = athlete
    return maps


def _find_existing_athlete(person_record, athlete_maps):
    fis_code = person_record.get('fisCode')
    if fis_code:
        return athlete_maps['by_fis_code'].get(str(fis_code).strip().upper())
    competitor_id = person_record.get('competitorId')
    if competitor_id:
        existing = athlete_maps['by_competitor_id'].get(str(competitor_id))
        return existing
    return athlete_maps['by_name_key'].get(build_name_key(
        person_record.get('lastname'),
        person_record.get('firstname'),
        person_record.get('nationCode'),
    ))


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


def _daterange_nights(check_in_date, check_out_date):
    if not check_in_date or not check_out_date or check_out_date <= check_in_date:
        return []
    nights = []
    current = check_in_date
    while current < check_out_date:
        nights.append(current)
        current += timedelta(days=1)
    return nights


def parse_entries_list(df, athlete_maps):
    errors = []
    warnings = []
    people = []
    seen_keys = {}

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
        fis_code = normalize_whitespace(row.get('Fiscode')) or None
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
            'lastname': lastname,
            'firstname': firstname,
            'nationCode': nation_code,
            'industryName': discipline,
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
        person['existingAthleteId'] = existing.id if existing else None
        person['operation'] = 'update' if existing else 'create'
        person['matchKey'] = unique_key
        people.append(person)

    return {'people': people, 'errors': errors, 'warnings': warnings}


def _index_people(people):
    by_name = {}
    by_name_no_nation = {}
    by_competitor_id = {}
    for person in people:
        key = build_name_key(person['lastname'], person['firstname'], person['nationCode'])
        by_name[key] = person
        by_name_no_nation[build_name_key(person['lastname'], person['firstname'], '')] = person
        if person.get('competitorId'):
            by_competitor_id[str(person['competitorId'])] = person
    return {'by_name': by_name, 'by_name_no_nation': by_name_no_nation, 'by_competitor_id': by_competitor_id}


def parse_room_list(df, imported_people):
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
        if not person1:
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
        partner_lastname, partner_firstname = _split_partner_name(shared_with_raw_name)
        person2 = None
        if shared_with_raw_name:
            person2 = indexed_people['by_name'].get(build_name_key(partner_lastname, partner_firstname, shared_with_nation_code))
            if not person2 and shared_with_nation_code != nation_code:
                person2 = indexed_people['by_name'].get(build_name_key(partner_lastname, partner_firstname, nation_code))
            if not person2:
                person2 = indexed_people['by_name_no_nation'].get(build_name_key(partner_lastname, partner_firstname, ''))
            if not person2:
                warnings.append({
                    'code': 'ROOM_PARTNER_NOT_FOUND',
                    'message': f'New room partner detected in room row {row_number}',
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


def build_quota_warnings(people, rooms, quota_checks=None):
    room_by_person = {}
    for room in rooms:
        room_by_person[room['person1Key']] = room
        if room.get('person2Key'):
            room_by_person[room['person2Key']] = room

    roster = [{**person, 'discipline': person.get('industryName')} for person in people]
    requested = []
    projected = []
    imported_by_existing_id = {}
    athlete_maps = _build_existing_athlete_maps()
    for person in roster:
        room = room_by_person.get(person.get('matchKey'))
        requested.append({**person, 'countsAsSingle': bool(
            room and normalize_string(room.get('roomType')) == 'single')})
        existing = _find_existing_athlete(person, athlete_maps)
        if existing:
            imported_by_existing_id[existing.id] = person

    # Project persisted bookings through the incoming authoritative roster.
    # Removed people disappear; retained people use their incoming quota group.
    for membership in RoomBookingOccupant.query.options(
            db.joinedload(RoomBookingOccupant.room_booking).joinedload(RoomBooking.room_type)).all():
        person = imported_by_existing_id.get(membership.athlete_id)
        if not person or normalize_string(person.get('function')) == 'athlete':
            continue
        booking = membership.room_booking
        projected.append({**person, 'countsAsSingle': bool(booking and booking.counts_as_single)})

    requested_rows = evaluate_quota_usage(roster, requested)
    projected_rows = evaluate_quota_usage(roster, projected)
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
                'officials': imported_officials, 'officialQuota': official_quota,
                'singleRooms': imported_single_rooms, 'singleRoomsAllowed': single_room_entitlement,
                'officialsExceeded': imported_officials > official_quota,
                'singleRoomsExceeded': imported_single_rooms > single_room_entitlement,
            })
        if imported_officials > official_quota:
            warnings.append({
                'code': 'QUOTA_OFFICIALS_EXCEEDED',
                'message': f'Officials überschritten ({imported_officials} / {official_quota})',
                'details': {
                    'nationCode': nation_code,
                    'discipline': discipline,
                    'gender': gender,
                    'athletesEntered': athletes_entered,
                    'officialQuota': official_quota,
                    'importedOfficials': imported_officials,
                    'existingAssignedOfficials': next((r['assignedOfficials'] for r in projected_rows if (r['nationCode'], r['discipline'], r['gender']) == (nation_code, discipline, gender)), 0),
                    'violationSources': sorted(row['sources']),
                },
            })
        if imported_single_rooms > single_room_entitlement:
            single_room_people = [person for person in requested
                if person.get('countsAsSingle')
                and (person.get('function') or '').strip().lower() != 'athlete'
                and quota_key(person) == (nation_code, discipline, gender)]
            excess_count = imported_single_rooms - single_room_entitlement
            candidates = [{
                'personKey': person.get('matchKey'),
                'name': f"{person.get('firstname', '')} {person.get('lastname', '')}".strip(),
                'function': person.get('function'),
            } for person in single_room_people]
            warnings.append({
                'code': 'QUOTA_SINGLE_ROOMS_EXCEEDED',
                'message': f'Single Rooms überschritten ({imported_single_rooms} / {single_room_entitlement})',
                'details': {
                    'nationCode': nation_code,
                    'discipline': discipline,
                    'gender': gender,
                    'importedOfficials': imported_officials,
                    'singleRoomsAllowed': single_room_entitlement,
                    'importedSingleRooms': imported_single_rooms,
                    'existingSingleRoomsUsed': next((r['singleRoomsUsed'] for r in projected_rows if (r['nationCode'], r['discipline'], r['gender']) == (nation_code, discipline, gender)), 0),
                    'violationSources': sorted(row['sources']),
                    'excessCount': excess_count,
                    'singleRoomCandidates': candidates,
                },
            })
    return warnings


def apply_single_room_entitlement_preview(people, rooms, quota_checks):
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
    allocated = {}
    for person in people:
        person['singleRoomEntitlement'] = None
        room = room_by_person.get(person.get('matchKey'))
        if ((person.get('function') or '').strip().lower() == 'athlete'
                or not room or normalize_string(room.get('roomType')) != 'single'):
            continue
        key = quota_key({**person, 'discipline': person.get('industryName')})
        used = allocated.get(key, 0)
        if used < allowances.get(key, 0):
            person['singleRoomEntitlement'] = 'IN_QUOTA'
            allocated[key] = used + 1
        else:
            person['singleRoomEntitlement'] = 'APPROVAL_REQUIRED'


def _serialize_person_preview(person):
    result = deepcopy(person)
    result['discipline'] = result.get('industryName')
    for key in ('arrivalDate', 'departureDate', 'tvPictureDate'):
        if result.get(key):
            result[key] = result[key].isoformat()
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
        'checkInDate': room['checkInDate'].isoformat() if room['checkInDate'] else None,
        'checkOutDate': room['checkOutDate'].isoformat() if room['checkOutDate'] else None,
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


def _assignment_context(athlete):
    """Return the existing disposition without changing it."""
    # Follow the domain identity, not the particular legacy import row. This
    # makes an assignment attached to any historical duplicate visible to the
    # current productive person.
    identity_rows = [athlete]
    if athlete.fis_code:
        identity_rows = Athlete.query.filter(
            func.upper(func.trim(Athlete.fis_code)) == athlete.fis_code.strip().upper()
        ).all()
    membership = next((membership for row in identity_rows for membership in row.room_booking_memberships), None)
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


def build_disposition_analysis(people, rooms, quota_warnings):
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
    for person in people:
        existing = _find_existing_athlete(person, _build_existing_athlete_maps())
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
        old_arrival, old_departure = existing.arrival_date, existing.departure_date
        new_arrival, new_departure = person.get('arrivalDate'), person.get('departureDate')
        if old_arrival != new_arrival or old_departure != new_departure:
            stay = {**base, 'old': {'arrival': old_arrival.isoformat() if old_arrival else None, 'departure': old_departure.isoformat() if old_departure else None},
                    'new': {'arrival': new_arrival.isoformat() if new_arrival else None, 'departure': new_departure.isoformat() if new_departure else None},
                    'impact': 'Bestehende Disposition betroffen'}
            categories['stayChanged']['records'].append(stay)
            changes.append({'field': 'Aufenthalt', 'old': stay['old'], 'new': stay['new']})
        room = room_by_key.get(person.get('matchKey'))
        new_room_type = _display_room_type(room.get('roomType') if room else person.get('roomType'))
        old_room_type = _display_room_type(existing.room_type)
        if old_room_type != new_room_type:
            categories['roomRequirementChanged']['records'].append({**base, 'old': old_room_type, 'new': new_room_type,
                                                                      'impact': 'Bestehende Disposition betroffen'})
            changes.append({'field': 'Zimmerbedarf', 'old': old_room_type, 'new': new_room_type})
        if changes:
            categories['updatedAthletes']['records'].append({**base, 'changes': changes})
            changed_by_id[existing.id] = changes

    nations = {person.get('nationCode') for person in people if person.get('nationCode')}
    disciplines = {person.get('industryName') for person in people if person.get('industryName')}
    scoped_existing = Athlete.query.filter(Athlete.nation_code.in_(nations)).all() if nations else []
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
        athlete = db.session.get(Athlete, athlete_id)
        context = _assignment_context(athlete)
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
        context = _assignment_context(athlete)
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
        if old_partners and (not desired_name or desired_name not in old_partner_names):
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
        record = {
            'nation': details.get('nationCode'), 'discipline': details.get('discipline'), 'gender': details.get('gender'),
            'currentQuota': details.get('importedOfficials', details.get('importedSingleRooms')),
            'allowedQuota': details.get('officialQuota', details.get('singleRoomsAllowed')),
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


def _room_comparison_changes(people, rooms, removed_records):
    """Compare room assignments by identities, never by spreadsheet position."""
    athlete_maps = _build_existing_athlete_maps()

    def athlete_token(athlete):
        canonical = (athlete_maps['by_fis_code'].get(athlete.fis_code.strip().upper(), athlete)
                     if athlete.fis_code else athlete)
        return f'id:{canonical.id}'

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
            if athlete:
                existing_by_id[athlete.id] = athlete

    staged = []
    for room in rooms:
        occupants = frozenset(
            athlete_token(existing_by_key[key]) if key in existing_by_key else f"new:{key}"
            for key in (room.get('person1Key'), room.get('person2Key')) if key
        )
        staged.append({'entityId': room.get('sourceRowKey'), 'assignmentId': room.get('assignmentId'),
                       'roomId': room.get('roomId'), 'occupants': occupants})

    current_by_assignment = {}
    for athlete in existing_by_id.values():
        context = _assignment_context(athlete)
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

    matches = []
    unused_current = set(range(len(current)))
    # Match strongest stable keys first, then the unordered person identity set.
    for staged_index, new_room in enumerate(staged):
        match = next((index for index in unused_current
                      if new_room.get('assignmentId') and new_room['assignmentId'] == current[index]['assignmentId']), None)
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
        matches.append((staged_index, match))

    changes = []
    for staged_index, current_index in matches:
        new_room = staged[staged_index]
        if current_index is None:
            changes.append(('ROOM_CREATED', new_room['entityId'], 'Zimmerzuordnung erstellt'))
        elif new_room['occupants'] != current[current_index]['occupants']:
            changes.append(('ROOMMATE_CHANGED', new_room['entityId'], 'Zimmerpartner geändert'))
    for current_index in unused_current:
        changes.append(('ROOM_REMOVED', current[current_index]['entityId'], 'Zimmerzuordnung entfernt'))
    return changes


def build_import_changes(disposition_analysis, people, rooms, errors):
    """Normalize comparison results into the UI's sole semantic change model."""
    categories = disposition_analysis['categories']
    room_by_person = {
        key: room for room in rooms for key in (room.get('person1Key'), room.get('person2Key')) if key
    }
    changes = []

    def add(change_type, preview, entity_id, description, severity='warning', **extra):
        changes.append({'type': change_type, 'preview': preview, 'severity': severity,
                        'entityId': str(entity_id or ''), 'description': description, **extra})

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
        room = room_by_person.get(entity_id)
        if room:
            add('STAY_CHANGED', 'rooms', room.get('sourceRowKey'), 'Aufenthalt geändert',
                affectedPersonId=str(entity_id or ''))
    for change_type, entity_id, description in _room_comparison_changes(
            people, rooms, categories['removedAthletes']['records']):
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


def create_fis_import_preview(entries_path, roomlist_path):
    cleanup_preview_store()
    entries_df = load_first_sheet(entries_path)
    room_df = load_first_sheet(roomlist_path)
    athlete_maps = _build_existing_athlete_maps()

    people_result = parse_entries_list(entries_df, athlete_maps)
    inferred_discipline = apply_import_level_discipline(people_result['people'], entries_path, roomlist_path)
    if inferred_discipline:
        people_result['warnings'].append({
            'code': 'ENTRY_DISCIPLINE_INFERRED',
            'message': f'Discipline inferred as {inferred_discipline}',
            'details': {
                'discipline': inferred_discipline,
                'source': 'filename_or_event_range',
            },
        })
    room_result = parse_room_list(room_df, people_result['people'])
    quota_checks = []
    quota_warnings = build_quota_warnings(people_result['people'], room_result['rooms'], quota_checks)
    apply_single_room_entitlement_preview(people_result['people'], room_result['rooms'], quota_checks)
    disposition_analysis = build_disposition_analysis(
        people_result['people'], room_result['rooms'], quota_warnings
    )

    blocking_errors = people_result['errors'] + room_result['errors']
    disposition_analysis['changes'] = build_import_changes(
        disposition_analysis, people_result['people'], room_result['rooms'], blocking_errors
    )
    preview = {
        'createdAt': datetime.utcnow(),
        'people': people_result['people'],
        'rooms': room_result['rooms'],
        'entriesColumns': list(entries_df.columns),
        'roomColumns': list(room_df.columns),
        'dayColumns': room_result['dayColumns'],
        'detectedDiscipline': next((person.get('industryName') for person in people_result['people'] if person.get('industryName')), None),
        'errors': blocking_errors,
        'warnings': people_result['warnings'] + room_result['warnings'] + quota_warnings,
        'quotaChecks': quota_checks,
        'dispositionAnalysis': disposition_analysis,
    }

    preview_token = uuid.uuid4().hex
    PREVIEW_STORE[preview_token] = preview

    return {
        'previewToken': preview_token,
        'isValid': len(blocking_errors) == 0,
        'summary': {
            'people': {
                'total': len(people_result['people']),
                'wouldCreate': sum(1 for person in people_result['people'] if person['operation'] == 'create'),
                'wouldUpdate': sum(1 for person in people_result['people'] if person['operation'] == 'update'),
            },
            'rooms': {
                'total': len(room_result['rooms']),
                'wouldReplaceFisRooms': FisRoomAssignment.query.count(),
                'singles': sum(1 for room in room_result['rooms'] if not room.get('person2Key')),
                'shared': sum(1 for room in room_result['rooms'] if room.get('person2Key')),
            },
            'validation': {
                'errorCount': len(blocking_errors),
                'warningCount': len(preview['warnings']),
            },
        },
        'entriesColumns': preview['entriesColumns'],
        'roomColumns': preview['roomColumns'],
        'dayColumns': preview['dayColumns'],
        'detectedDiscipline': preview.get('detectedDiscipline'),
        'people': [_serialize_person_preview(person) for person in people_result['people']],
        'rooms': [_serialize_room_preview(room) for room in room_result['rooms']],
        'errors': blocking_errors,
        'warnings': preview['warnings'],
        'dispositionAnalysis': disposition_analysis,
    }


def _apply_person_record(athlete, person, now):
    athlete.function = person.get('function')
    athlete.competitor_id = person.get('competitorId')
    athlete.accred_id = person.get('accredId')
    athlete.fis_code = person.get('fisCode')
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
    athlete.room_type = person.get('roomType')
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
    """Delete people and every operational reference without orphaning bookings."""
    removed_names = {f'{athlete.lastname}, {athlete.firstname}'.strip().casefold() for athlete in athletes}
    ids = [athlete.id for athlete in athletes]
    if not ids:
        return 0
    booking_ids = {row.room_booking_id for row in RoomBookingOccupant.query.filter(RoomBookingOccupant.athlete_id.in_(ids)).all()}
    RoomBookingOccupant.query.filter(RoomBookingOccupant.athlete_id.in_(ids)).delete(synchronize_session=False)
    RoomAssignment.query.filter((RoomAssignment.athlete_id.in_(ids)) | (RoomAssignment.shared_with_athlete_id.in_(ids))).delete(synchronize_session=False)
    FisRoomAssignment.query.filter((FisRoomAssignment.person1_id.in_(ids)) | (FisRoomAssignment.person2_id.in_(ids))).delete(synchronize_session=False)
    for booking_id in booking_ids:
        if not RoomBookingOccupant.query.filter_by(room_booking_id=booking_id).first():
            RoomBooking.query.filter_by(id=booking_id).delete(synchronize_session=False)
    for partner in Athlete.query.filter(~Athlete.id.in_(ids)).all():
        if (partner.shared_with_name or '').strip().casefold() in removed_names:
            partner.shared_with_name = None
    Athlete.query.filter(Athlete.id.in_(ids)).delete(synchronize_session=False)
    return len(ids)


def _remove_duplicates():
    """Collapse legacy duplicate identities after each authoritative import."""
    groups = {}
    for athlete in Athlete.query.order_by(Athlete.id).all():
        identifiers = [('fis', athlete.fis_code), ('accred', athlete.accred_id), ('competitor', athlete.competitor_id)]
        key = next(((kind, value.strip().casefold()) for kind, value in identifiers if value and value.strip()), None)
        if key:
            groups.setdefault(key, []).append(athlete)
    duplicates = [duplicate for records in groups.values() for duplicate in records[1:]]
    return _remove_athletes(duplicates)


def confirm_fis_import(preview_token, approved_extra_single_room_decisions=None):
    cleanup_preview_store()
    preview = PREVIEW_STORE.get(preview_token)
    if not preview:
        raise ValueError('Preview token not found or expired')
    if preview['errors']:
        raise ValueError('Preview contains blocking validation errors')

    now = datetime.utcnow()
    run = ImportRun(import_type='fis_confirm', started_at=now)
    db.session.add(run)
    db.session.flush()

    athlete_maps = _build_existing_athlete_maps()
    persisted_people = {}
    created = 0
    updated = 0

    # Mapping person key -> ImportApproval id. Iterables remain accepted for
    # backwards compatibility with internal callers from earlier releases.
    if approved_extra_single_room_decisions is None:
        approved_extra_single_room_decisions = {}
    elif not hasattr(approved_extra_single_room_decisions, 'get'):
        approved_extra_single_room_decisions = {
            key: None for key in approved_extra_single_room_decisions
        }
    room_by_person = {}
    for room in preview.get('rooms', []):
        room_by_person[room.get('person1Key')] = room
        if room.get('person2Key'):
            room_by_person[room.get('person2Key')] = room
    single_room_allowances = {}
    for check in preview.get('quotaChecks', []):
        key = (check.get('nationCode'), check.get('discipline'), check.get('gender'))
        single_room_allowances[key] = check.get('singleRoomsAllowed', 0)
    allocated_in_quota = {}

    for person in preview['people']:
        athlete = _find_existing_athlete(person, athlete_maps)
        existing_before = _snapshot_roomlist_fields(athlete) if athlete else None
        if athlete is None:
            athlete = Athlete(
                lastname=person['lastname'],
                firstname=person['firstname'],
                nation_code=person['nationCode'],
            )
            db.session.add(athlete)
            db.session.flush()
            created += 1
        else:
            updated += 1

        _apply_person_record(athlete, person, now)
        room = room_by_person.get(person.get('matchKey'))
        requests_single = bool(room and normalize_string(room.get('roomType')) == 'single')
        group = quota_key({**person, 'discipline': person.get('industryName')})
        used = allocated_in_quota.get(group, 0)
        if requests_single and (person.get('function') or '').strip().lower() != 'athlete':
            if person.get('matchKey') in approved_extra_single_room_decisions:
                athlete.single_room_entitlement = 'APPROVED_EXTRA'
                athlete.single_room_status = 'APPROVED_EXTRA'
                athlete.single_room_decision_id = approved_extra_single_room_decisions.get(person.get('matchKey'))
            elif used < single_room_allowances.get(group, 0):
                athlete.single_room_entitlement = 'IN_QUOTA'
                athlete.single_room_status = 'IN_QUOTA'
                athlete.single_room_decision_id = None
                allocated_in_quota[group] = used + 1
            else:
                athlete.single_room_entitlement = None
                athlete.single_room_status = 'PENDING_APPROVAL'
                athlete.single_room_decision_id = None
        else:
            athlete.single_room_entitlement = None
            athlete.single_room_status = 'NONE'
            athlete.single_room_decision_id = None
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
            has_assignment = RoomBookingOccupant.query.filter_by(athlete_id=athlete.id).first() is not None
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
        db.session.flush()
        persisted_people[person['matchKey']] = athlete
        athlete_maps = _build_existing_athlete_maps()

    # A nation list is authoritative: people no longer present disappear from
    # operations together with their assignments and partner references.
    imported_nations = {person['nationCode'] for person in preview['people'] if person.get('nationCode')}
    imported_ids = {athlete.id for athlete in persisted_people.values()}
    missing = Athlete.query.filter(Athlete.nation_code.in_(imported_nations), ~Athlete.id.in_(imported_ids)).all()
    removed = _remove_athletes(missing)
    deduplicated = _remove_duplicates()

    run.finished_at = datetime.utcnow()
    db.session.commit()
    PREVIEW_STORE.pop(preview_token, None)

    return {
        'success': True,
        'summary': {
            'peopleCreated': created,
            'peopleUpdated': updated,
            'peopleRemoved': removed,
            'duplicatesRemoved': deduplicated,
            'fisRoomsImported': 0,
            'fisRoomsReplaced': 0,
            'dispositionsChanged': 0,
        },
        'run': run.to_dict(),
    }


def import_excel_file(file_path, app):
    with app.app_context():
        result = create_fis_import_preview(file_path, file_path)
        if not result['isValid']:
            return result
        return confirm_fis_import(result['previewToken'])
