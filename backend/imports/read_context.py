"""Bulk data for one import calculation; never cached across requests."""
from sqlalchemy.orm import selectinload, joinedload
from models import Athlete, Competition, RoomBooking, RoomBookingOccupant, FisRoomAssignment
from .identity import _build_existing_athlete_maps


class ImportReadContext:
    def __init__(self):
        self.competitions_by_id = {c.id: c for c in Competition.query.all()}
        self.athletes = Athlete.query.options(
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
            joinedload(Athlete.single_room_decision),
        ).all()
        self.athlete_maps = _build_existing_athlete_maps(self.athletes)
        self.by_fis_code = {}
        for athlete in self.athletes:
            if athlete.fis_code:
                self.by_fis_code.setdefault(athlete.fis_code.strip().upper(), []).append(athlete)

    def identity_rows(self, athlete):
        return self.by_fis_code.get(athlete.fis_code.strip().upper(), []) if athlete.fis_code else [athlete]
