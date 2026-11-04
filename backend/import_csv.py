"""
CSV Import Script for Freestyle WM Data
Parses the multi-section CSV file and imports all data
"""
from models import db, RoomType, Hotel, HotelRoomInventory, Event, EventRoomDemand, Athlete
from datetime import datetime
import re


def parse_csv_file(file_path):
    """Parse the CSV file with multiple sections"""
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Split into sections
    sections = {
        'room_types': [],
        'hotels': [],
        'events': [],
        'athletes': [],
        'roomlist': []
    }

    lines = content.split('\n')
    current_section = None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Detect section headers
        if line.startswith('Zimmertyp'):
            current_section = 'room_types'
            continue
        elif line.startswith('Hotel'):
            current_section = 'hotels'
            continue
        elif line.startswith('Disziplin'):
            current_section = 'events'
            continue
        elif line.startswith('athlets'):
            current_section = 'athletes'
            continue
        elif line.startswith('roomlist'):
            current_section = 'roomlist'
            continue

        # Add line to current section
        if current_section:
            sections[current_section].append(line)

    return sections


def import_room_types(lines, app):
    """Import room types from CSV lines"""
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
    with app.app_context():
        # Clear existing
        RoomType.query.delete()

        # Parse format: ID Name MaxPersons
        # Example: 1 DZ / DU 2
        for line in lines:
            parts = line.split(maxsplit=1)
            if len(parts) < 2:
                continue

            try:
                # First part is ID, rest is name + max persons
                rest = parts[1].rsplit(maxsplit=1)
                if len(rest) < 2:
                    continue

                name = rest[0].strip()
                max_persons = int(rest[1])

                room_type = RoomType(name=name, max_persons=max_persons)
                db.session.add(room_type)
                print(f"✓ Room Type: {name} (max {max_persons} persons)")

            except (ValueError, IndexError) as e:
                print(f"✗ Error parsing room type: {line} - {e}")
                continue

        db.session.commit()
        print(f"Imported {RoomType.query.count()} room types")


def import_hotels(lines, app):
    """Import hotels and inventories from CSV lines"""
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
    with app.app_context():
        hotels_dict = {}

        for line in lines:
            parts = line.split()
            if len(parts) < 8:
                continue

            try:
                hotel_name = parts[0]
                room_type_name = parts[1] + ' ' + parts[2] + ' ' + parts[3] if '/' in parts[2] else parts[1]

                # Find indices for dates
                date_pattern = r'\d{2}\.\d{2}\.\d{4}'
                dates = re.findall(date_pattern, line)
                if len(dates) < 2:
                    continue

                von = datetime.strptime(dates[0], '%d.%m.%Y').date()
                bis = datetime.strptime(dates[1], '%d.%m.%Y').date()

                # Extract remaining parts
                remaining = line.split(dates[1])[1].strip().split()
                if len(remaining) < 4:
                    continue

                zimmer_count = int(remaining[0])
                ort = remaining[1]
                region = remaining[2]
                hp = remaining[3].lower() == 'ja'
                sr = remaining[4].lower() == 'ja' if len(remaining) > 4 else False

                # Get or create hotel
                if hotel_name not in hotels_dict:
                    hotel = Hotel.query.filter_by(name=hotel_name).first()
                    if not hotel:
                        hotel = Hotel(name=hotel_name, location=ort, region=region)
                        db.session.add(hotel)
                        db.session.flush()
                        print(f"✓ Hotel: {hotel_name} ({ort}, {region})")
                    hotels_dict[hotel_name] = hotel
                else:
                    hotel = hotels_dict[hotel_name]

                # Find room type
                room_type = RoomType.query.filter_by(name=room_type_name).first()
                if not room_type:
                    # Create default
                    max_pers = 2 if 'DZ' in room_type_name or 'APP' in room_type_name else 1
                    room_type = RoomType(name=room_type_name, max_persons=max_pers)
                    db.session.add(room_type)
                    db.session.flush()

                # Create inventory
                inventory = HotelRoomInventory(
                    hotel_id=hotel.id,
                    room_type_id=room_type.id,
                    available_from=von,
                    available_until=bis,
                    room_count=zimmer_count,
                    has_half_board=hp,
                    has_sr=sr
                )
                db.session.add(inventory)

            except Exception as e:
                print(f"✗ Error parsing hotel: {line[:50]}... - {e}")
                continue

        db.session.commit()
        print(f"Imported {Hotel.query.count()} hotels with {HotelRoomInventory.query.count()} room inventories")


def import_events(lines, app):
    """Import events and demands from CSV lines"""
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
    with app.app_context():
        Event.query.delete()
        events_dict = {}

        for line in lines:
            parts = line.split()
            if len(parts) < 5:
                continue

            try:
                discipline = parts[0]
                room_type_name = parts[1] + ' ' + parts[2] + ' ' + parts[3] if '/' in parts[2] else parts[1]

                # Find dates
                date_pattern = r'\d{2}\.\d{2}\.\d{4}'
                dates = re.findall(date_pattern, line)
                if len(dates) < 2:
                    continue

                von = datetime.strptime(dates[0], '%d.%m.%Y').date()
                bis = datetime.strptime(dates[1], '%d.%m.%Y').date()

                # Get room count
                remaining = line.split(dates[1])[1].strip().split()
                zimmer_count = int(remaining[0])

                # Get or create event
                event_key = f"{discipline}_{von}_{bis}"
                if event_key not in events_dict:
                    event = Event(discipline=discipline, start_date=von, end_date=bis)
                    db.session.add(event)
                    db.session.flush()
                    events_dict[event_key] = event
                    print(f"✓ Event: {discipline} ({von} - {bis})")
                else:
                    event = events_dict[event_key]

                # Find room type
                room_type = RoomType.query.filter_by(name=room_type_name).first()
                if room_type:
                    demand = EventRoomDemand(
                        event_id=event.id,
                        room_type_id=room_type.id,
                        room_count=zimmer_count
                    )
                    db.session.add(demand)

            except Exception as e:
                print(f"✗ Error parsing event: {line[:50]}... - {e}")
                continue

        db.session.commit()
        print(f"Imported {Event.query.count()} events with {EventRoomDemand.query.count()} room demands")


def import_athletes_from_csv(lines, app):
    """Import athletes from CSV - requires proper CSV parsing"""
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
    import csv
    import io

    with app.app_context():
        Athlete.query.delete()

        # Join lines back and parse as CSV
        csv_content = '\n'.join(lines)
        reader = csv.DictReader(io.StringIO(csv_content))

        count = 0
        for row in reader:
            try:
                athlete = Athlete(
                    function=row.get('Function'),
                    competitor_id=row.get('Competitorid/Staff ID'),
                    accred_id=row.get('Accredid'),
                    fis_code=row.get('Fiscode'),
                    lastname=row.get('Lastname', ''),
                    firstname=row.get('Firstname', ''),
                    nation_code=row.get('Nationcode', ''),
                    for_gender=row.get('For_gender'),
                    gender=row.get('Gender'),
                    phone=row.get('Phone'),
                    email=row.get('Email')
                )

                # Parse dates
                if row.get('Arrival_date'):
                    try:
                        athlete.arrival_date = datetime.strptime(row['Arrival_date'], '%d.%m.%Y').date()
                    except:
                        pass

                if row.get('Departure_date'):
                    try:
                        athlete.departure_date = datetime.strptime(row['Departure_date'], '%d.%m.%Y').date()
                    except:
                        pass

                athlete.room_type = row.get('Room_type')
                athlete.shared_with_name = row.get('Shared_with_name')
                athlete.first_meal = row.get('First_meal')
                athlete.last_meal = row.get('Last_meal')
                athlete.special_meal = row.get('Special_meal')

                db.session.add(athlete)
                count += 1

            except Exception as e:
                print(f"✗ Error importing athlete: {e}")
                continue

        db.session.commit()
        print(f"✓ Imported {count} athletes")


def run_import(app, csv_file_path):
    """Main import function"""
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
    print("Starting CSV import...")

    sections = parse_csv_file(csv_file_path)

    print(f"\nFound sections:")
    print(f"  - Room Types: {len(sections['room_types'])} lines")
    print(f"  - Hotels: {len(sections['hotels'])} lines")
    print(f"  - Events: {len(sections['events'])} lines")
    print(f"  - Athletes: {len(sections['athletes'])} lines")
    print(f"  - Room List: {len(sections['roomlist'])} lines")

    print("\n--- Importing Room Types ---")
    import_room_types(sections['room_types'], app)

    print("\n--- Importing Hotels ---")
    import_hotels(sections['hotels'], app)

    print("\n--- Importing Events ---")
    import_events(sections['events'], app)

    print("\n--- Importing Athletes ---")
    if sections['athletes']:
        import_athletes_from_csv(sections['athletes'], app)

    print("\n✅ Import complete!")


if __name__ == '__main__':
    from app_new import app

    # Run import
    csv_file = 'hotel-zimmer-preise.csv'
    run_import(app, csv_file)
