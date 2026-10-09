"""Populated read contracts for the two hotel projections extracted together."""
from datetime import date
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_support import configure_test_app, postgres_test_url

os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from models import (db, Athlete, Hotel, HotelRoomInventory, RoomAssignment,
                    RoomBooking, RoomBookingOccupant, RoomType)


class HotelReadRoutesTest(unittest.TestCase):
    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
            hotel = Hotel(name='Projection Hotel', location='Brand', region='Bludenz')
            room_type = RoomType(name='Double', max_persons=2)
            current = Athlete(firstname='Current', lastname='Guest', nation_code='AUT', discipline='Big Air')
            legacy = Athlete(firstname='Legacy', lastname='Guest', nation_code='SUI',
                             discipline='Moguls', special_meal='Vegetarian')
            db.session.add_all([hotel, room_type, current, legacy])
            db.session.flush()
            db.session.add(HotelRoomInventory(hotel_id=hotel.id, room_type_id=room_type.id,
                available_from=date(2027, 3, 1), available_until=date(2027, 3, 20), room_count=3))
            booking = RoomBooking(hotel_id=hotel.id, room_type_id=room_type.id,
                room_number='Current 01', check_in_date=date(2027, 3, 10), check_out_date=date(2027, 3, 14))
            assignment = RoomAssignment(hotel_id=hotel.id, room_type_id=room_type.id,
                athlete_id=legacy.id, room_number='Legacy 02',
                check_in_date=date(2027, 3, 11), check_out_date=date(2027, 3, 15))
            db.session.add_all([booking, assignment])
            db.session.flush()
            db.session.add(RoomBookingOccupant(room_booking_id=booking.id, athlete_id=current.id))
            db.session.commit()
            self.hotel_id = str(hotel.id)
            self.type_id = str(room_type.id)
            self.assignment_id = str(assignment.id)
        self.client = app.test_client()
        self.viewer = {'X-Authenticated-User': 'viewer', 'X-Authenticated-Groups': 'incoming-viewer'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    def test_capacity_overview_preserves_current_booking_projection_and_filters(self):
        query = {'hotel_id': self.hotel_id, 'room_type_id': self.type_id, 'nation': 'AUT',
                 'discipline': 'Big Air', 'start_date': '2027-03-10', 'end_date': '2027-03-14'}
        response = self.client.get('/api/hotels/capacity-overview', query_string=query, headers=self.viewer)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), [{
            'hotel': {'id': self.hotel_id, 'name': 'Projection Hotel', 'location': 'Brand', 'region': 'Bludenz'},
            'roomTypes': [{'roomType': {'id': self.type_id, 'name': 'Double', 'maxPersons': 2},
                'inventoryRooms': 3, 'inventoryBeds': 6, 'occupiedRooms': 1, 'occupiedBeds': 1,
                'remainingRooms': 2, 'remainingBeds': 5}],
            'totals': {'inventoryRooms': 3, 'inventoryBeds': 6, 'occupiedRooms': 1,
                'occupiedBeds': 1, 'remainingRooms': 2, 'remainingBeds': 5},
        }])
        # Inventory is not nation-scoped, and legacy assignments are not counted.
        filtered = self.client.get('/api/hotels/capacity-overview',
            query_string={**query, 'nation': 'SUI', 'discipline': 'Moguls'}, headers=self.viewer)
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(filtered.get_json()[0]['totals']['occupiedBeds'], 0)
        self.assertEqual(filtered.get_json()[0]['totals']['inventoryRooms'], 3)

    def test_reservations_return_legacy_rows_and_preserve_schema(self):
        path = f'/api/hotels/{self.hotel_id}/reservations'
        query = {'room_type_id': self.type_id, 'nation': 'SUI', 'discipline': 'Moguls',
                 'start_date': '2027-03-10', 'end_date': '2027-03-14'}
        for filters in ({}, query):
            with self.subTest(filters=filters):
                response = self.client.get(path, query_string=filters, headers=self.viewer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.mimetype, 'application/json')
                self.assertEqual(response.get_json(), [{
                    'assignmentId': self.assignment_id, 'roomNumber': 'Legacy 02',
                    'roomType': {'id': self.type_id, 'name': 'Double', 'maxPersons': 2},
                    'occupancy': 1, 'guestName': 'Legacy Guest', 'sharedWithName': None,
                    'nationCode': 'SUI', 'discipline': 'Moguls',
                    'checkInDate': '2027-03-11', 'checkOutDate': '2027-03-15',
                    'specialNotes': 'Vegetarian',
                }])

    def test_reservations_filter_primary_guest_when_room_is_shared(self):
        with app.app_context():
            assignment = db.session.get(RoomAssignment, int(self.assignment_id))
            assignment.shared_with = Athlete.query.filter_by(firstname='Current').one()
            db.session.commit()
        path = f'/api/hotels/{self.hotel_id}/reservations'
        response = self.client.get(path,
            query_string={'nation': 'SUI', 'discipline': 'Moguls'}, headers=self.viewer)
        self.assertEqual(response.status_code, 200)
        rows = response.get_json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['assignmentId'], self.assignment_id)
        self.assertEqual(rows[0]['guestName'], 'Legacy Guest')
        self.assertEqual(rows[0]['sharedWithName'], 'Current Guest')
        self.assertEqual(rows[0]['occupancy'], 2)
        for query in ({'nation': 'AUT'}, {'discipline': 'Big Air'}):
            with self.subTest(query=query):
                response = self.client.get(path, query_string=query, headers=self.viewer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), [])

    def test_reservations_return_empty_list_for_no_matches(self):
        path = f'/api/hotels/{self.hotel_id}/reservations'
        for query in ({'room_type_id': 2147483647}, {'nation': 'GER'},
                      {'discipline': 'Slalom'},
                      {'start_date': '2027-04-01', 'end_date': '2027-04-02'}):
            with self.subTest(query=query):
                response = self.client.get(path, query_string=query, headers=self.viewer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), [])
        with app.app_context():
            empty_hotel = Hotel(name='Empty Hotel')
            db.session.add(empty_hotel)
            db.session.commit()
            empty_id = empty_hotel.id
        for hotel_id in (empty_id, 2147483647):
            with self.subTest(hotel_id=hotel_id):
                response = self.client.get(f'/api/hotels/{hotel_id}/reservations', headers=self.viewer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.get_json(), [])

    def test_reservations_preserve_check_in_order_and_null_dates(self):
        with app.app_context():
            original = db.session.get(RoomAssignment, int(self.assignment_id))
            for room, check_in in [('Undated', None), ('Earlier', date(2027, 3, 1))]:
                guest = Athlete(firstname=room, lastname='Guest', nation_code='SUI')
                db.session.add(guest)
                db.session.flush()
                db.session.add(RoomAssignment(hotel_id=original.hotel_id,
                    room_type_id=original.room_type_id, athlete_id=guest.id,
                    room_number=room, check_in_date=check_in))
            db.session.commit()
        response = self.client.get(f'/api/hotels/{self.hotel_id}/reservations', headers=self.viewer)
        self.assertEqual(response.status_code, 200)
        rows = response.get_json()
        self.assertEqual([row['roomNumber'] for row in rows], ['Earlier', 'Legacy 02', 'Undated'])
        self.assertIsNone(rows[-1]['checkInDate'])
        self.assertIsNone(rows[-1]['checkOutDate'])

    def test_reservations_require_data_read_permission(self):
        path = f'/api/hotels/{self.hotel_id}/reservations'
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='hotel-test-secret'):
            response = self.client.get(path)
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.get_json(), {
                'error': 'UNAUTHENTICATED', 'message': 'Authentication required'})
            headers = {'X-Auth-Proxy-Secret': 'hotel-test-secret',
                       'X-Authenticated-User': 'hotel-test-user'}
            response = self.client.get(path,
                headers={**headers, 'X-Authenticated-Groups': 'unknown'})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.get_json(), {
                'error': 'FORBIDDEN', 'message': 'Insufficient permissions'})
            for role in ('incoming-viewer', 'incoming-editor', 'incoming-admin'):
                with self.subTest(role=role):
                    response = self.client.get(path,
                        headers={**headers, 'X-Authenticated-Groups': role})
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual([row['assignmentId'] for row in response.get_json()],
                                     [self.assignment_id])
