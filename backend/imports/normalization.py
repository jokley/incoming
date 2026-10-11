"""Spreadsheet normalization preserving the legacy import contracts."""
import re
import unicodedata
from datetime import date, datetime

import pandas as pd


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
