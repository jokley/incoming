import os
import sys
import tempfile
import unittest
from datetime import date


DB_FILE = tempfile.NamedTemporaryFile(suffix='.db', delete=False).name
os.environ['DATABASE_PATH'] = DB_FILE
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app  # noqa: E402
from models import (  # noqa: E402
    Athlete,
    FisRoomAssignment,
    Hotel,
    HotelRoomInventory,
    RoomBooking,
    RoomBookingOccupant,
    RoomType,
    db,
)


class AssignmentPlanningProjectionTest(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        with app.app_context():
            db.drop_all()
            db.create_all()
            double = RoomType(name='Double', max_persons=2)
            hotel = Hotel(name='Projection Hotel', location='Test', region='Test')
            db.session.add_all([double, hotel])
            db.session.flush()
            db.session.add(HotelRoomInventory(
                hotel_id=hotel.id,
                room_type_id=double.id,
                available_from=date(2027, 3, 1),
                available_until=date(2027, 3, 31),
                room_count=5,
            ))
            db.session.commit()

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    @staticmethod
    def athlete(firstname, lastname, nation='AUT', discipline='Big Air', gender='F', partner=None):
        return Athlete(
            firstname=firstname,
            lastname=lastname,
            nation_code=nation,
            discipline=discipline,
            gender=gender,
            function='Athlete',
            room_type='Double shared' if partner else 'Single',
            shared_with_name=partner,
            arrival_date=date(2027, 3, 10),
            departure_date=date(2027, 3, 14),
        )

    def planning(self):
        response = app.test_client().get('/api/assignments/planning-view')
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_new_athletes_and_nations_appear_without_persisted_units_or_rebuild(self):
        with app.app_context():
            db.session.add(self.athlete('Mia', 'Berger'))
            db.session.commit()

        first = self.planning()
        self.assertEqual([unit['nationCode'] for unit in first['units']['unassigned']], ['AUT'])

        with app.app_context():
            db.session.add(self.athlete('Noah', 'Keller', nation='SUI', discipline='Moguls', gender='M'))
            db.session.commit()

        second = self.planning()
        units = second['units']['unassigned']
        self.assertEqual({unit['nationCode'] for unit in units}, {'AUT', 'SUI'})
        with app.app_context():
            self.assertEqual(FisRoomAssignment.query.count(), 0)
        sui = next(unit for unit in units if unit['nationCode'] == 'SUI')
        self.assertEqual(sui['occupants'][0]['discipline'], 'Moguls')
        self.assertEqual(sui['occupants'][0]['gender'], 'male')

    def test_partner_projection_is_deterministic_and_ignores_legacy_fis_units(self):
        with app.app_context():
            mia = self.athlete('Mia', 'Berger', partner='KELLER, Noah')
            noah = self.athlete('Noah', 'Keller', gender='F', partner='BERGER, Mia')
            db.session.add_all([mia, noah])
            db.session.flush()
            db.session.add(FisRoomAssignment(
                source_row_key='stale-legacy-row',
                room_type='Single',
                person1_id=mia.id,
                check_in_date=date(2020, 1, 1),
                check_out_date=date(2020, 1, 2),
            ))
            db.session.commit()

        first = self.planning()['units']['unassigned']
        second = self.planning()['units']['unassigned']
        self.assertEqual(len(first), 1)
        self.assertEqual(first[0]['unitId'], second[0]['unitId'])
        self.assertTrue(first[0]['unitId'].startswith('athlete-unit-'))
        self.assertEqual({occupant['name'] for occupant in first[0]['occupants']}, {'Mia Berger', 'Noah Keller'})
        self.assertEqual(first[0]['checkInDate'], '2027-03-10')

    def test_room_booking_marks_projected_athletes_assigned_and_is_displayed(self):
        with app.app_context():
            mia = self.athlete('Mia', 'Berger', partner='KELLER, Noah')
            noah = self.athlete('Noah', 'Keller', gender='F', partner='BERGER, Mia')
            db.session.add_all([mia, noah])
            db.session.flush()
            hotel = Hotel.query.one()
            room_type = RoomType.query.one()
            booking = RoomBooking(
                hotel_id=hotel.id,
                room_type_id=room_type.id,
                room_number='Slot 01',
                check_in_date=date(2027, 3, 10),
                check_out_date=date(2027, 3, 14),
            )
            db.session.add(booking)
            db.session.flush()
            db.session.add_all([
                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=mia.id),
                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=noah.id),
            ])
            db.session.commit()
            booking_id = str(booking.id)

        planning = self.planning()
        self.assertEqual(planning['units']['unassigned'], [])
        unit = planning['units']['assigned'][0]
        self.assertTrue(unit['isFullyAssigned'])
        self.assertEqual(unit['assignedBookingId'], booking_id)
        grid_bookings = [
            booking
            for hotel in planning['hotels']
            for slot in hotel['slots']
            for booking in slot['bookings']
        ]
        self.assertEqual(grid_bookings[0]['bookingId'], booking_id)

    def test_booking_creation_accepts_athlete_ids_without_unit_id(self):
        with app.app_context():
            athlete = self.athlete('Lina', 'Frei')
            db.session.add(athlete)
            db.session.commit()
            athlete_id = str(athlete.id)
            hotel_id = str(Hotel.query.one().id)
            room_type_id = str(RoomType.query.one().id)

        response = app.test_client().post('/api/assignments/bookings', json={
            'athleteIds': [athlete_id],
            'hotelId': hotel_id,
            'roomTypeId': room_type_id,
            'roomNumber': 'Slot 01',
            'checkInDate': '2027-03-10',
            'checkOutDate': '2027-03-14',
        })
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()['occupants'][0]['athlete']['id'], athlete_id)

    def test_exclusive_occupancy_follows_status_and_actual_double_room_occupancy(self):
        with app.app_context():
            entitled = self.athlete('Lina', 'Frei')
            entitled.single_room_status = 'IN_QUOTA'
            partner = self.athlete('Mia', 'Berger')
            db.session.add_all([entitled, partner])
            db.session.commit()
            entitled_id, partner_id = str(entitled.id), str(partner.id)
            hotel_id = str(Hotel.query.one().id)
            room_type_id = str(RoomType.query.one().id)

        client = app.test_client()
        created = client.post('/api/assignments/bookings', json={
            'athleteIds': [entitled_id], 'hotelId': hotel_id, 'roomTypeId': room_type_id,
            'roomNumber': 'Slot 01', 'checkInDate': '2027-03-10', 'checkOutDate': '2027-03-14',
        })
        self.assertEqual(created.status_code, 201)
        self.assertTrue(created.get_json()['countsAsSingle'])
        booking_id = created.get_json()['id']

        shared = client.post('/api/assignments/bookings', json={
            'assignedBookingId': booking_id, 'athleteIds': [entitled_id, partner_id],
            'hotelId': hotel_id, 'roomTypeId': room_type_id, 'roomNumber': 'Slot 01',
            'checkInDate': '2027-03-10', 'checkOutDate': '2027-03-14',
        })
        self.assertEqual(shared.status_code, 200)
        self.assertFalse(shared.get_json()['countsAsSingle'])

        removed = client.post(f'/api/assignments/bookings/{booking_id}/occupants/{partner_id}/unassign')
        self.assertEqual(removed.status_code, 200)
        with app.app_context():
            self.assertTrue(db.session.get(RoomBooking, int(booking_id)).counts_as_single)

        overridden = client.put(f'/api/assignments/bookings/{booking_id}', json={'countsAsSingle': False})
        self.assertEqual(overridden.status_code, 200)
        self.assertFalse(overridden.get_json()['countsAsSingle'])

    def test_non_entitled_single_occupant_is_not_marked_exclusive(self):
        with app.app_context():
            athlete = self.athlete('Noah', 'Keller')
            athlete.single_room_status = 'PENDING_APPROVAL'
            db.session.add(athlete)
            db.session.commit()
            athlete_id = str(athlete.id)
            hotel_id = str(Hotel.query.one().id)
            room_type_id = str(RoomType.query.one().id)

        response = app.test_client().post('/api/assignments/bookings', json={
            'athleteIds': [athlete_id], 'hotelId': hotel_id, 'roomTypeId': room_type_id,
            'roomNumber': 'Slot 01', 'checkInDate': '2027-03-10', 'checkOutDate': '2027-03-14',
        })
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.get_json()['countsAsSingle'])


if __name__ == '__main__':
    unittest.main()
