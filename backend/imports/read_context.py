"""Bulk data for one import calculation; never cached across requests."""
from sqlalchemy.orm import selectinload, joinedload, with_loader_criteria
from models import Athlete, Competition, RoomBooking, RoomBookingOccupant, FisRoomAssignment, ImportApproval, ImportSession
from .identity import _build_existing_athlete_maps
from .event_context import import_event_id, ImportValidationError
from .normalization import canonical_fis_code


class ImportReadContext:
    def __init__(self, event_id=None):
        self.event_id = import_event_id(event_id)
        self.competitions_by_id = {c.id: c for c in Competition.query.all()}
        owner = self.event_id
        self.athletes = Athlete.query.filter_by(event_id=owner).options(
            with_loader_criteria(Athlete, Athlete.event_id == owner, include_aliases=True),
            with_loader_criteria(RoomBooking, RoomBooking.event_id == owner, include_aliases=True),
            with_loader_criteria(ImportApproval, ImportApproval.session_id.in_(
                ImportSession.query.with_entities(ImportSession.id).filter_by(event_id=owner)), include_aliases=True),
            selectinload(Athlete.room_booking_memberships).joinedload(RoomBookingOccupant.room_booking)
                .joinedload(RoomBooking.hotel),
            selectinload(Athlete.room_booking_memberships).joinedload(RoomBookingOccupant.room_booking)
                .joinedload(RoomBooking.room_type),
            selectinload(Athlete.room_booking_memberships).joinedload(RoomBookingOccupant.room_booking)
                .selectinload(RoomBooking.occupants).joinedload(RoomBookingOccupant.athlete),
            selectinload(Athlete.fis_room_assignments_as_person1).joinedload(FisRoomAssignment.hotel),
            selectinload(Athlete.fis_room_assignments_as_person1).joinedload(FisRoomAssignment.person2),
            selectinload(Athlete.fis_room_assignments_as_person2).joinedload(FisRoomAssignment.hotel),
            selectinload(Athlete.fis_room_assignments_as_person2).joinedload(FisRoomAssignment.person1),
            joinedload(Athlete.single_room_decision).joinedload(ImportApproval.session).selectinload(ImportSession.versions),
        ).all()
        for athlete in self.athletes:
            for assignment in [*athlete.fis_room_assignments_as_person1, *athlete.fis_room_assignments_as_person2]:
                if ((assignment.person1_id and assignment.person1 is None)
                        or (assignment.person2_id and assignment.person2 is None)):
                    raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Eventfremder Legacy-Zimmerpartner.')
            if any(m.room_booking is None for m in athlete.room_booking_memberships):
                raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Eventfremder Buchungsbezug.')
            if any(o.athlete is None for m in athlete.room_booking_memberships for o in m.room_booking.occupants):
                raise ImportValidationError('IMPORT_EVENT_MISMATCH', 'Gemischte Eventbelegung.')
        self.athlete_maps = _build_existing_athlete_maps(self.athletes, event_id=self.event_id)
        self.by_fis_code = {}
        for athlete in self.athletes:
            if athlete.fis_code:
                self.by_fis_code.setdefault(canonical_fis_code(athlete.fis_code), []).append(athlete)

    def identity_rows(self, athlete):
        if athlete.event_id != self.event_id:
            raise ValueError('Foreign-event identity row')
        return self.by_fis_code.get(canonical_fis_code(athlete.fis_code), []) if athlete.fis_code else [athlete]
