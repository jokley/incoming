from flask_sqlalchemy import SQLAlchemy
from datetime import datetime
import json

db = SQLAlchemy()


class AuditEvent(db.Model):
    """Append-only record of successful state-changing API requests."""
    __tablename__ = 'audit_event'

    id = db.Column(db.Integer, primary_key=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False, index=True)
    username = db.Column(db.String(100), nullable=False, index=True)
    display_name = db.Column(db.String(200))
    email = db.Column(db.String(200))
    groups_json = db.Column(db.Text, nullable=False, default='[]')
    action = db.Column(db.String(20), nullable=False, index=True)
    entity_type = db.Column(db.String(100), nullable=False, index=True)
    entity_id = db.Column(db.String(100), index=True)
    request_id = db.Column(db.String(36), nullable=False, index=True)
    method = db.Column(db.String(10), nullable=False)
    path = db.Column(db.String(500), nullable=False)
    changes_json = db.Column(db.Text)

    def to_dict(self):
        return {
            'id': str(self.id),
            'createdAt': self.created_at.isoformat() + 'Z' if self.created_at else None,
            'username': self.username,
            'displayName': self.display_name,
            'email': self.email,
            'groups': json.loads(self.groups_json or '[]'),
            'action': self.action,
            'entityType': self.entity_type,
            'entityId': self.entity_id,
            'requestId': self.request_id,
            'method': self.method,
            'path': self.path,
            'changes': json.loads(self.changes_json) if self.changes_json else None,
        }

class ImportRun(db.Model):
    """Tracks the latest import timestamps for change detection"""
    __tablename__ = 'import_run'

    id = db.Column(db.Integer, primary_key=True)
    import_type = db.Column(db.String(50), nullable=False)  # athletes | roomlist
    started_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    finished_at = db.Column(db.DateTime)

    def to_dict(self):
        return {
            'id': str(self.id),
            'importType': self.import_type,
            'startedAt': self.started_at.isoformat() if self.started_at else None,
            'finishedAt': self.finished_at.isoformat() if self.finished_at else None,
        }

class RoomType(db.Model):
    """Zimmertyp - definiert MaxPersonen pro Zimmertyp"""
    __tablename__ = 'room_type'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False, unique=True)  # z.B. "DZ / DU"
    max_persons = db.Column(db.Integer, nullable=False)  # z.B. 2
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'maxPersons': self.max_persons
        }


class Hotel(db.Model):
    """Hotel mit Zimmerkontingenten für bestimmte Zeiträume"""
    __tablename__ = 'hotel'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    location = db.Column(db.String(100))  # Ort
    region = db.Column(db.String(100))  # Region
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    room_inventories = db.relationship('HotelRoomInventory', backref='hotel', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': str(self.id),
            'name': self.name,
            'location': self.location,
            'region': self.region,
            'roomInventories': [inv.to_dict() for inv in self.room_inventories]
        }


class HotelRoomInventory(db.Model):
    """Verfügbare Zimmer pro Hotel, Zimmertyp und Zeitraum"""
    __tablename__ = 'hotel_room_inventory'

    id = db.Column(db.Integer, primary_key=True)
    hotel_id = db.Column(db.Integer, db.ForeignKey('hotel.id'), nullable=False)
    room_type_id = db.Column(db.Integer, db.ForeignKey('room_type.id'), nullable=False)
    available_from = db.Column(db.Date, nullable=False)
    available_until = db.Column(db.Date, nullable=False)
    room_count = db.Column(db.Integer, nullable=False)  # Anzahl Zimmer
    has_half_board = db.Column(db.Boolean, default=False)  # HP
    has_sr = db.Column(db.Boolean, default=False)  # SR
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    room_type = db.relationship('RoomType', backref='hotel_inventories')

    def to_dict(self):
        return {
            'id': str(self.id),
            'hotelId': str(self.hotel_id),
            'roomType': self.room_type.to_dict(),
            'availableFrom': self.available_from.isoformat(),
            'availableUntil': self.available_until.isoformat(),
            'roomCount': self.room_count,
            'hasHalfBoard': self.has_half_board,
            'hasSR': self.has_sr
        }


class Event(db.Model):
    """Events/Disziplinen mit Bedarf an Zimmern"""
    __tablename__ = 'event'

    id = db.Column(db.Integer, primary_key=True)
    discipline = db.Column(db.String(100), nullable=False)  # Big Air, Moguls, etc.
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    person_demand = db.Column(db.Integer, nullable=False, default=0)
    single_room_percentage = db.Column(db.Integer, nullable=False, default=50)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    room_demands = db.relationship('EventRoomDemand', backref='event', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': str(self.id),
            'discipline': self.discipline,
            'startDate': self.start_date.isoformat(),
            'endDate': self.end_date.isoformat(),
            'personDemand': self.person_demand,
            'singleRoomPercentage': self.single_room_percentage,
            'roomDemands': [demand.to_dict() for demand in self.room_demands]
        }


class EventRoomDemand(db.Model):
    """Bedarf an Zimmern pro Event und Zimmertyp"""
    __tablename__ = 'event_room_demand'

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(db.Integer, db.ForeignKey('event.id'), nullable=False)
    room_type_id = db.Column(db.Integer, db.ForeignKey('room_type.id'), nullable=False)
    room_count = db.Column(db.Integer, nullable=False)  # Benötigte Zimmer
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    room_type = db.relationship('RoomType', backref='event_demands')

    def to_dict(self):
        return {
            'id': str(self.id),
            'eventId': str(self.event_id),
            'roomType': self.room_type.to_dict(),
            'roomCount': self.room_count
        }


class Athlete(db.Model):
    """Athleten und Staff"""
    __tablename__ = 'athlete'

    id = db.Column(db.Integer, primary_key=True)
    function = db.Column(db.String(50))  # Athlete, NSA Coach, etc.
    competitor_id = db.Column(db.String(50))
    accred_id = db.Column(db.String(50))
    fis_code = db.Column(db.String(50))
    lastname = db.Column(db.String(100), nullable=False)
    firstname = db.Column(db.String(100), nullable=False)
    nation_code = db.Column(db.String(10), nullable=False)
    discipline = db.Column(db.String(100))  # Big Air, Moguls, Slopestyle, etc.
    gender = db.Column(db.String(10))
    for_gender = db.Column(db.String(10))  # Competition gender
    phone = db.Column(db.String(50))
    email = db.Column(db.String(100))
    present = db.Column(db.Boolean, default=False)

    # Event participation
    wc_sbx_w = db.Column(db.Boolean, default=False)
    wc_sbx_m = db.Column(db.Boolean, default=False)

    # Travel
    arrival_date = db.Column(db.Date)
    arrival_time = db.Column(db.String(20))
    arrival_by = db.Column(db.String(50))
    arrival_airport = db.Column(db.String(50))
    arrival_airport_name = db.Column(db.String(100))
    arrival_flight_no = db.Column(db.String(50))
    arrival_need_transportation = db.Column(db.Boolean, default=False)

    departure_date = db.Column(db.Date)
    departure_time = db.Column(db.String(20))
    departure_by = db.Column(db.String(50))
    departure_airport = db.Column(db.String(50))
    departure_airport_name = db.Column(db.String(100))
    departure_flight_no = db.Column(db.String(50))
    departure_need_transportation = db.Column(db.Boolean, default=False)

    # Accommodation
    room_type = db.Column(db.String(50))  # Single, Double shared, etc.
    shared_with_name = db.Column(db.String(200))
    late_checkout = db.Column(db.Boolean, default=False)

    # Meals
    first_meal = db.Column(db.String(50))
    last_meal = db.Column(db.String(50))
    special_meal = db.Column(db.String(200))

    # Additional
    additional_items = db.Column(db.String(200))
    stance = db.Column(db.String(10))  # R/L for snowboard
    tv_picture_status = db.Column(db.String(100))
    tv_picture_date = db.Column(db.Date)
    entry_date = db.Column(db.DateTime)
    last_update = db.Column(db.DateTime)
    entries_sent_date = db.Column(db.DateTime)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Import / change tracking
    athletes_last_seen_at = db.Column(db.DateTime)
    roomlist_last_seen_at = db.Column(db.DateTime)

    roomlist_changed_at = db.Column(db.DateTime)
    roomlist_change_summary = db.Column(db.String(500))
    roomlist_change_acknowledged_at = db.Column(db.DateTime)
    roomlist_change_acknowledged_summary = db.Column(db.String(500))

    def to_dict(self):
        return {
            'id': str(self.id),
            'function': self.function,
            'competitorId': self.competitor_id,
            'accredId': self.accred_id,
            'fisCode': self.fis_code,
            'lastname': self.lastname,
            'firstname': self.firstname,
            'nationCode': self.nation_code,
            'discipline': self.discipline,
            'gender': self.gender,
            'forGender': self.for_gender,
            'phone': self.phone,
            'email': self.email,
            'present': self.present,
            'arrivalDate': self.arrival_date.isoformat() if self.arrival_date else None,
            'arrivalTime': self.arrival_time,
            'arrivalBy': self.arrival_by,
            'arrivalAirport': self.arrival_airport,
            'arrivalAirportName': self.arrival_airport_name,
            'arrivalFlightno': self.arrival_flight_no,
            'arrivalNeedTransportation': self.arrival_need_transportation,
            'departureDate': self.departure_date.isoformat() if self.departure_date else None,
            'departureTime': self.departure_time,
            'departureBy': self.departure_by,
            'departureAirport': self.departure_airport,
            'departureAirportName': self.departure_airport_name,
            'departureFlightno': self.departure_flight_no,
            'departureNeedTransportation': self.departure_need_transportation,
            'roomType': self.room_type,
            'sharedWithName': self.shared_with_name,
            'lateCheckout': self.late_checkout,
            'firstMeal': self.first_meal,
            'lastMeal': self.last_meal,
            'specialMeal': self.special_meal,
            'additionalItems': self.additional_items,
            'tvPictureStatus': self.tv_picture_status,
            'tvPictureDate': self.tv_picture_date.isoformat() if self.tv_picture_date else None,
            'entryDate': self.entry_date.isoformat() if self.entry_date else None,
            'lastUpdate': self.last_update.isoformat() if self.last_update else None,
            'entriesSentDate': self.entries_sent_date.isoformat() if self.entries_sent_date else None,
            'stance': self.stance,
            'athletesLastSeenAt': self.athletes_last_seen_at.isoformat() if self.athletes_last_seen_at else None,
            'roomlistLastSeenAt': self.roomlist_last_seen_at.isoformat() if self.roomlist_last_seen_at else None,
            'roomlistChangedAt': self.roomlist_changed_at.isoformat() if self.roomlist_changed_at else None,
            'roomlistChangeSummary': self.roomlist_change_summary,
            'roomlistChangeAcknowledgedAt': self.roomlist_change_acknowledged_at.isoformat() if self.roomlist_change_acknowledged_at else None,
            'roomlistChangeAcknowledgedSummary': self.roomlist_change_acknowledged_summary,
        }


class FisRoomAssignment(db.Model):
    __tablename__ = 'fis_room_assignment'

    id = db.Column(db.Integer, primary_key=True)
    import_run_id = db.Column(db.Integer, db.ForeignKey('import_run.id'), nullable=True)
    source_row_key = db.Column(db.String(200), nullable=False, unique=True)
    room_type = db.Column(db.String(50), nullable=False)
    person1_id = db.Column(db.Integer, db.ForeignKey('athlete.id'), nullable=False)
    person2_id = db.Column(db.Integer, db.ForeignKey('athlete.id'), nullable=True)
    shared_with_raw_name = db.Column(db.String(200))
    shared_with_nation_code = db.Column(db.String(10))
    hotel_id = db.Column(db.Integer, db.ForeignKey('hotel.id'), nullable=True)
    room_number = db.Column(db.String(20))
    check_in_date = db.Column(db.Date)
    check_out_date = db.Column(db.Date)
    nightly_snapshot = db.Column(db.Text)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    import_run = db.relationship('ImportRun', backref='fis_room_assignments')
    person1 = db.relationship('Athlete', foreign_keys=[person1_id], backref='fis_room_assignments_as_person1')
    person2 = db.relationship('Athlete', foreign_keys=[person2_id], backref='fis_room_assignments_as_person2')
    hotel = db.relationship('Hotel', backref='fis_room_assignments')

    def to_dict(self):
        return {
            'id': str(self.id),
            'importRunId': str(self.import_run_id) if self.import_run_id else None,
            'sourceRowKey': self.source_row_key,
            'roomType': self.room_type,
            'person1': self.person1.to_dict() if self.person1 else None,
            'person2': self.person2.to_dict() if self.person2 else None,
            'sharedWithRawName': self.shared_with_raw_name,
            'sharedWithNationCode': self.shared_with_nation_code,
            'hotelId': str(self.hotel_id) if self.hotel_id else None,
            'roomNumber': self.room_number,
            'checkInDate': self.check_in_date.isoformat() if self.check_in_date else None,
            'checkOutDate': self.check_out_date.isoformat() if self.check_out_date else None,
            'nightlySnapshot': self.nightly_snapshot,
        }


class RoomAssignment(db.Model):
    """Zimmerzuteilungen - wer mit wem"""
    __tablename__ = 'room_assignment'

    id = db.Column(db.Integer, primary_key=True)
    athlete_id = db.Column(db.Integer, db.ForeignKey('athlete.id'), nullable=False)
    hotel_id = db.Column(db.Integer, db.ForeignKey('hotel.id'), nullable=False)
    room_type_id = db.Column(db.Integer, db.ForeignKey('room_type.id'), nullable=False)
    room_number = db.Column(db.String(20))
    check_in_date = db.Column(db.Date)
    check_out_date = db.Column(db.Date)
    shared_with_athlete_id = db.Column(db.Integer, db.ForeignKey('athlete.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    athlete = db.relationship('Athlete', foreign_keys=[athlete_id], backref='room_assignments')
    shared_with = db.relationship('Athlete', foreign_keys=[shared_with_athlete_id])
    hotel = db.relationship('Hotel', backref='room_assignments')
    room_type = db.relationship('RoomType', backref='room_assignments')

    def to_dict(self):
        return {
            'id': str(self.id),
            'athlete': self.athlete.to_dict(),
            'hotel': {'id': str(self.hotel_id), 'name': self.hotel.name},
            'roomType': self.room_type.to_dict(),
            'roomNumber': self.room_number,
            'checkInDate': self.check_in_date.isoformat() if self.check_in_date else None,
            'checkOutDate': self.check_out_date.isoformat() if self.check_out_date else None,
            'sharedWith': self.shared_with.to_dict() if self.shared_with else None
        }


class RoomBooking(db.Model):
    __tablename__ = 'room_booking'

    id = db.Column(db.Integer, primary_key=True)
    hotel_id = db.Column(db.Integer, db.ForeignKey('hotel.id'), nullable=False)
    room_type_id = db.Column(db.Integer, db.ForeignKey('room_type.id'), nullable=False)
    room_number = db.Column(db.String(20))
    check_in_date = db.Column(db.Date)
    check_out_date = db.Column(db.Date)
    counts_as_single = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    hotel = db.relationship('Hotel', backref='room_bookings')
    room_type = db.relationship('RoomType', backref='room_bookings')
    occupants = db.relationship('RoomBookingOccupant', backref='room_booking', lazy=True, cascade='all, delete-orphan')

    def to_dict(self):
        return {
            'id': str(self.id),
            'hotel': {'id': str(self.hotel_id), 'name': self.hotel.name},
            'roomType': self.room_type.to_dict(),
            'roomNumber': self.room_number,
            'checkInDate': self.check_in_date.isoformat() if self.check_in_date else None,
            'checkOutDate': self.check_out_date.isoformat() if self.check_out_date else None,
            'countsAsSingle': bool(self.counts_as_single),
            'occupants': [occupant.to_dict() for occupant in self.occupants]
        }


class RoomBookingOccupant(db.Model):
    __tablename__ = 'room_booking_occupant'
    __table_args__ = (
        db.UniqueConstraint('room_booking_id', 'athlete_id', name='uq_room_booking_athlete'),
    )

    id = db.Column(db.Integer, primary_key=True)
    room_booking_id = db.Column(db.Integer, db.ForeignKey('room_booking.id'), nullable=False)
    athlete_id = db.Column(db.Integer, db.ForeignKey('athlete.id'), nullable=False)
    role = db.Column(db.String(50), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    athlete = db.relationship('Athlete', backref='room_booking_memberships')

    def to_dict(self):
        return {
            'id': str(self.id),
            'roomBookingId': str(self.room_booking_id),
            'athlete': self.athlete.to_dict(),
            'role': self.role
        }
