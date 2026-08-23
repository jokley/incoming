from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from pathlib import Path
from xml.sax.saxutils import escape
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

OUTPUT_DIR = Path(__file__).resolve().parent / 'mock_fis_files'

DISCIPLINES = [
    {
        'name': 'Big Air',
        'code': 'BIG_AIR',
        'start': '2027-03-07',
        'end': '2027-03-14',
    },
    {
        'name': 'Aerials',
        'code': 'AERIALS',
        'start': '2027-03-15',
        'end': '2027-03-21',
    },
    {
        'name': 'Moguls',
        'code': 'MOGULS',
        'start': '2027-03-12',
        'end': '2027-03-20',
    },
    {
        'name': 'Parallel',
        'code': 'PARALLEL',
        'start': '2027-03-04',
        'end': '2027-03-11',
    },
    {
        'name': 'Slopestyle',
        'code': 'SLOPESTYLE',
        'start': '2027-03-12',
        'end': '2027-03-21',
    },
    {
        'name': 'Snowboard Cross',
        'code': 'SNOWBOARD_CROSS',
        'start': '2027-03-16',
        'end': '2027-03-22',
    },
    {
        'name': 'Ski Cross',
        'code': 'SKI_CROSS',
        'start': '2027-03-09',
        'end': '2027-03-15',
    },
]

NATIONS = [
    {
        'code': 'AUT',
        'athletes': [
            ('MUELLER', 'Stefan', 'M'),
            ('SCHMID', 'Anna', 'F'),
            ('GRUBER', 'Lukas', 'M'),
            ('STEINER', 'Julia', 'F'),
        ],
        'officials': [
            ('HUBER', 'Markus', 'M', 'Coach'),
            ('HOFER', 'Thomas', 'M', 'Team Captain'),
            ('WEISS', 'Michaela', 'F', 'Physio'),
        ],
    },
    {
        'code': 'CAN',
        'athletes': [
            ('SMITH', 'John', 'M'),
            ('MILLER', 'Evan', 'M'),
            ('BROWN', 'Sarah', 'F'),
            ('WILSON', 'Amy', 'F'),
        ],
        'officials': [
            ('TAYLOR', 'David', 'M', 'Coach'),
            ('ANDERSON', 'Robert', 'M', 'Doctor'),
            ('THOMAS', 'Jessica', 'F', 'Physio'),
        ],
    },
    {
        'code': 'SUI',
        'athletes': [
            ('ODERMATT', 'Marco', 'M'),
            ('MEILLARD', 'Loic', 'M'),
            ('HOLDENER', 'Wendy', 'F'),
            ('GUT', 'Lara', 'F'),
        ],
        'officials': [
            ('KUELLY', 'Beat', 'M', 'Coach'),
            ('ZUERCHER', 'Hans', 'M', 'Team Captain'),
        ],
    },
    {
        'code': 'GER',
        'athletes': [
            ('FISCHER', 'Felix', 'M'),
            ('NEUMANN', 'Laura', 'F'),
            ('SCHNEIDER', 'Maximilian', 'M'),
            ('WEBER', 'Lena', 'F'),
        ],
        'officials': [
            ('KRAUSE', 'Peter', 'M', 'Coach'),
            ('BECKER', 'Stefanie', 'F', 'Physio'),
        ],
    },
]


def daterange_strings(start: str, end: str) -> list[str]:
    start_dt = datetime.strptime(start, '%Y-%m-%d').date()
    end_dt = datetime.strptime(end, '%Y-%m-%d').date()
    values = []
    current = start_dt
    while current <= end_dt:
        values.append(current.strftime('%a %d.%m.%Y'))
        current += timedelta(days=1)
    return values


def write_excel(rows: list[dict], path: Path, document_tag: str | None = None) -> None:
    """Write a deterministic workbook, optionally tagged as a distinct document.

    ``document_tag`` is stored in a harmless workbook XML comment.  It does not
    alter the spreadsheet data, but it lets fixtures that are fachlich equal
    represent distinct files (and therefore distinct upload versions).
    """
    columns: list[str] = []
    seen = set()
    for row in rows:
        for key in row.keys():
            if key not in seen:
                seen.add(key)
                columns.append(key)

    all_rows = [columns] + [[row.get(column, '') for column in columns] for row in rows]

    def excel_column_name(index: int) -> str:
        result = ''
        value = index
        while value >= 0:
            value, remainder = divmod(value, 26)
            result = chr(65 + remainder) + result
            value -= 1
        return result

    def cell_xml(row_index: int, col_index: int, value: object) -> str:
        reference = f'{excel_column_name(col_index)}{row_index}'
        if value is None:
            text = ''
        else:
            text = str(value)
        return f'<c r="{reference}" t="inlineStr"><is><t>{escape(text)}</t></is></c>'

    rows_xml = []
    for row_index, row_values in enumerate(all_rows, start=1):
        cells = ''.join(cell_xml(row_index, col_index, row_values[col_index]) for col_index in range(len(columns)))
        rows_xml.append(f'<row r="{row_index}">{cells}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(rows_xml)}</sheetData>'
        '</worksheet>'
    )

    tag_xml = f'<!-- document-tag:{escape(document_tag)} -->' if document_tag else ''
    workbook_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'{tag_xml}'
        '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>'
        '</workbook>'
    )

    workbook_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
        'Target="worksheets/sheet1.xml"/>'
        '</Relationships>'
    )

    root_rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
        'Target="xl/workbook.xml"/>'
        '</Relationships>'
    )

    content_types_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '</Types>'
    )

    # A fixed ZIP timestamp makes the generated workbook byte-for-byte reproducible.
    with ZipFile(path, 'w', compression=ZIP_DEFLATED) as archive:
        for name, content in (
            ('[Content_Types].xml', content_types_xml),
            ('_rels/.rels', root_rels_xml),
            ('xl/workbook.xml', workbook_xml),
            ('xl/_rels/workbook.xml.rels', workbook_rels_xml),
            ('xl/worksheets/sheet1.xml', sheet_xml),
        ):
            info = ZipInfo(name, date_time=(2027, 1, 1, 0, 0, 0))
            info.compress_type = ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, content)


def build_entries_rows(discipline: dict, starting_id: int) -> tuple[list[dict], int]:
    rows: list[dict] = []
    current_id = starting_id

    for nation in NATIONS:
        athletes = nation['athletes']
        officials = nation['officials']

        for index, (lastname, firstname, gender) in enumerate(athletes):
            current_id += 1
            partner_last, partner_first, _ = athletes[index + 1] if index % 2 == 0 else athletes[index - 1]
            rows.append({
                'Function': 'Athlete',
                'Competitorid/Staff ID': str(current_id),
                'Accredid': str(current_id),
                'Fiscode': str(100000 + current_id),
                'Lastname': lastname,
                'Firstname': firstname,
                'Nationcode': nation['code'],
                'Industryname': discipline['name'],
                'Gender': gender,
                'Arrival_date': discipline['start'],
                'Departure_date': discipline['end'],
                'Arrival_time': '12:30',
                'Departure_time': '09:00',
                'Arrival_by': 'Flight',
                'Departure_by': 'Flight',
                'Arrival_flightno': f'OS{current_id % 1000:03d}',
                'Departure_flightno': f'LX{current_id % 1000:03d}',
                'Arrival_need_transportation': 'Yes',
                'Departure_need_transportation': 'Yes',
                'Room_type': 'Double shared',
                'Shared with Name': f'{partner_last}, {partner_first}',
                'First_meal': discipline['start'],
                'Last_meal': discipline['end'],
                'Special_meal': 'Vegetarian' if gender == 'F' and index == 1 else '',
                'Stance': 'R' if gender == 'M' else 'L',
            })

        for index, (lastname, firstname, gender, function_name) in enumerate(officials):
            current_id += 1
            room_type = 'Single' if index == 0 else 'Double shared'
            shared_with = ''
            if room_type != 'Single' and len(officials) > 1:
                partner_index = 2 if index == 1 and len(officials) > 2 else 1
                partner_last, partner_first, _, _ = officials[partner_index]
                shared_with = f'{partner_last}, {partner_first}'

            rows.append({
                'Function': function_name,
                'Competitorid/Staff ID': str(current_id),
                'Accredid': str(current_id),
                'Fiscode': '',
                'Lastname': lastname,
                'Firstname': firstname,
                'Nationcode': nation['code'],
                'Industryname': discipline['name'],
                'Gender': gender,
                'Arrival_date': discipline['start'],
                'Departure_date': discipline['end'],
                'Arrival_time': '15:00',
                'Departure_time': '08:00',
                'Arrival_by': 'Car',
                'Departure_by': 'Car',
                'Arrival_need_transportation': 'No',
                'Departure_need_transportation': 'No',
                'Room_type': room_type,
                'Shared with Name': shared_with,
                'First_meal': discipline['start'],
                'Last_meal': discipline['end'],
                'Special_meal': 'Gluten free' if function_name == 'Physio' else '',
            })

    return rows, current_id


def build_room_rows(discipline: dict) -> list[dict]:
    rows: list[dict] = []
    day_columns = {
        f'{day} (Persons by room)': 1
        for day in daterange_strings(discipline['start'], discipline['end'])
    }

    for nation in NATIONS:
        athletes = nation['athletes']
        officials = nation['officials']

        for pair in ((0, 1), (2, 3)):
            athlete1 = athletes[pair[0]]
            athlete2 = athletes[pair[1]]
            row = {
                'Lastname': athlete1[0],
                'Firstname': athlete1[1],
                'Nationcode': nation['code'],
                'Function': 'Athlete',
                'Arrival_date': discipline['start'],
                'Departure_date': discipline['end'],
                'Shared with Name': f'{athlete2[0]}, {athlete2[1]}',
                'Shared with Nationcode': nation['code'],
                'Room_type': 'Double shared',
                'Single': 0,
                'Double_shared': 1,
                'Double_single': 0,
                'Appartment': 0,
                'First_meal': discipline['start'],
                'Last_meal': discipline['end'],
                'Special_meal': '',
            }
            row.update(day_columns)
            rows.append(row)

        official_single = officials[0]
        row = {
            'Lastname': official_single[0],
            'Firstname': official_single[1],
            'Nationcode': nation['code'],
            'Function': official_single[3],
            'Arrival_date': discipline['start'],
            'Departure_date': discipline['end'],
            'Shared with Name': '',
            'Shared with Nationcode': '',
            'Room_type': 'Single',
            'Single': 1,
            'Double_shared': 0,
            'Double_single': 0,
            'Appartment': 0,
            'First_meal': discipline['start'],
            'Last_meal': discipline['end'],
            'Special_meal': 'Gluten free' if official_single[3] == 'Physio' else '',
        }
        row.update(day_columns)
        rows.append(row)

        if len(officials) > 2:
            official1 = officials[1]
            official2 = officials[2]
            row = {
                'Lastname': official1[0],
                'Firstname': official1[1],
                'Nationcode': nation['code'],
                'Function': official1[3],
                'Arrival_date': discipline['start'],
                'Departure_date': discipline['end'],
                'Shared with Name': f'{official2[0]} {official2[1]}',
                'Shared with Nationcode': nation['code'],
                'Room_type': 'Double shared',
                'Single': 0,
                'Double_shared': 1,
                'Double_single': 0,
                'Appartment': 0,
                'First_meal': discipline['start'],
                'Last_meal': discipline['end'],
                'Special_meal': '',
            }
            row.update(day_columns)
            rows.append(row)

    return rows


def generate_mock_files(output_dir: Path) -> list[dict]:
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = []
    next_competitor_id = 200000

    for discipline in DISCIPLINES:
        entries_rows, next_competitor_id = build_entries_rows(discipline, next_competitor_id)
        room_rows = build_room_rows(discipline)

        entries_path = output_dir / f"ENTRIES-LIST_2027_WM_{discipline['code']}.xlsx"
        room_path = output_dir / f"ENTRIES-ROOM-LIST-DETAILED_2027_WM_{discipline['code']}.xlsx"

        write_excel(entries_rows, entries_path)
        write_excel(room_rows, room_path)

        manifest.append({
            'discipline': discipline['name'],
            'entries_path': entries_path,
            'room_path': room_path,
            'people': len(entries_rows),
            'rooms': len(room_rows),
        })

    return manifest


def reset_athlete_related_data() -> dict:
    from app import app
    from models import (Athlete, FisRoomAssignment, ImportRun, RoomAssignment,
                        RoomBooking, RoomBookingOccupant, db)

    with app.app_context():
        stats = {
            'athletesDeleted': Athlete.query.count(),
            'fisAssignmentsDeleted': FisRoomAssignment.query.count(),
            'legacyAssignmentsDeleted': RoomAssignment.query.count(),
            'roomBookingsDeleted': RoomBooking.query.count(),
            'importRunsDeleted': ImportRun.query.count(),
        }
        for model in (RoomBookingOccupant, RoomBooking, FisRoomAssignment,
                      RoomAssignment, Athlete, ImportRun):
            model.query.delete(synchronize_session=False)
        db.session.commit()
        return stats


def import_mock_pair(entries_path: Path, room_path: Path) -> dict:
    from app import app
    from excel_import import confirm_fis_import, create_fis_import_preview

    with app.app_context():
        preview = create_fis_import_preview(str(entries_path), str(room_path))
        if not preview['isValid']:
            error_messages = [f"{item['code']}: {item['message']}" for item in preview['errors']]
            raise ValueError('Mock import preview failed:\n' + '\n'.join(error_messages))
        return confirm_fis_import(preview['previewToken'])


def find_manifest_entry(manifest: list[dict], discipline_name: str) -> dict:
    normalized = discipline_name.strip().lower()
    for entry in manifest:
        if entry['discipline'].lower() == normalized:
            return entry
    raise ValueError(f"Discipline '{discipline_name}' not found in generated mock files")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description='Generate FIS mock Excel files and optionally reset/import mock athlete data.'
    )
    parser.add_argument(
        '--output-dir',
        default=str(OUTPUT_DIR),
        help='Target directory for generated mock Excel files',
    )
    parser.add_argument(
        '--reset-athletes',
        action='store_true',
        help='Delete all athlete-related data before continuing',
    )
    parser.add_argument(
        '--import-discipline',
        metavar='NAME',
        help='After generation/reset, import one generated discipline into the DB, e.g. "Snowboard Cross"',
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()

    if args.reset_athletes:
        stats = reset_athlete_related_data()
        print('Athlete-related data reset:')
        for key, value in stats.items():
            print(f'  - {key}: {value}')

    manifest = generate_mock_files(output_dir)
    print(f'Generated {len(manifest) * 2} mock Excel files in {output_dir}')
    for item in manifest:
        print(f"  - {item['discipline']}: {item['entries_path'].name} + {item['room_path'].name}")

    if args.import_discipline:
        selected = find_manifest_entry(manifest, args.import_discipline)
        result = import_mock_pair(selected['entries_path'], selected['room_path'])
        summary = result['summary']
        print(f"Imported mock discipline '{selected['discipline']}':")
        print(f"  - peopleCreated: {summary['peopleCreated']}")
        print(f"  - peopleUpdated: {summary['peopleUpdated']}")
        print(f"  - fisRoomsImported: {summary['fisRoomsImported']}")


if __name__ == '__main__':
    main()
