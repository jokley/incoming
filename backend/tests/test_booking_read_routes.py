"""Contracts for the grouped booking read aliases."""
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
from models import db, Athlete, AuditEvent, Hotel, RoomBooking, RoomBookingOccupant, RoomType


class BookingReadRoutesTest(unittest.TestCase):
    paths = [base + slash for base in (
        '/api/room-bookings/grouped', '/room-bookings/grouped',
        '/api/room-assignments/grouped', '/api/room-assignments', '/room-assignments')
        for slash in ('', '/')]

    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.viewer = {'X-Authenticated-User': 'reader',
                       'X-Authenticated-Groups': 'incoming-viewer'}

    def tearDown(self):
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)
            db.session.remove()

    def seed(self):
        with app.app_context():
            first, second = Hotel(name='Zulu'), Hotel(name='Alpha')
            room_type = RoomType(name='Double', max_persons=2)
            person = Athlete(firstname='Ada', lastname='Guest', nation_code='AUT')
            db.session.add_all([first, second, room_type, person])
            db.session.flush()
            expected = []
            for hotel, number, dated in [(second, '01', False), (first, '20', False),
                                         (first, '10', True), (first, '10', False)]:
                booking = RoomBooking(hotel_id=hotel.id, room_type_id=room_type.id,
                    room_number=number, counts_as_single=dated,
                    check_in_date=date(2027, 3, 1) if dated else None,
                    check_out_date=date(2027, 3, 5) if dated else None)
                db.session.add(booking)
                db.session.flush()
                occupants = []
                if dated:
                    occupant = RoomBookingOccupant(room_booking_id=booking.id, athlete_id=person.id)
                    db.session.add(occupant)
                    db.session.flush()
                    occupants = [{'id': str(occupant.id), 'roomBookingId': str(booking.id),
                                  'athlete': person.to_dict(), 'role': None}]
                expected.append({'id': str(booking.id), 'hotel': {'id': str(hotel.id), 'name': hotel.name},
                    'roomType': {'id': str(room_type.id), 'name': 'Double', 'maxPersons': 2},
                    'roomNumber': number, 'checkInDate': '2027-03-01' if dated else None,
                    'checkOutDate': '2027-03-05' if dated else None,
                    'countsAsSingle': dated, 'occupants': occupants})
            db.session.commit()
            return [expected[2], expected[3], expected[1], expected[0]]

    def test_all_aliases_preserve_flat_projection_order_nulls_and_ignore_filters(self):
        expected = self.seed()
        for path in self.paths:
            for query in ({}, {'hotelId': '999', 'nation': 'XXX', 'page': '99'}):
                with self.subTest(path=path, query=query):
                    response = self.client.get(path, query_string=query, headers=self.viewer)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.mimetype, 'application/json')
                    self.assertEqual(response.get_json(), expected)

    def test_empty_results_on_every_alias(self):
        for path in self.paths:
            response = self.client.get(path, headers=self.viewer)
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.get_json(), [])

    def test_every_alias_requires_authentication_and_data_read(self):
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='booking-secret'):
            for path in self.paths:
                with self.subTest(path=path):
                    self.assertEqual(self.client.get(path).status_code, 401)
                    headers = {'X-Auth-Proxy-Secret': 'booking-secret',
                               'X-Authenticated-User': 'reader', 'X-Authenticated-Groups': 'unknown'}
                    self.assertEqual(self.client.get(path, headers=headers).status_code, 403)
                    self.assertEqual(self.client.get(path, headers={
                        **headers, 'X-Authenticated-Groups': 'incoming-viewer'}).status_code, 200)

    def test_performance_headers_retain_path_based_behavior(self):
        with patch.dict(os.environ, ASSIGNMENT_PERFORMANCE_ENABLED='true'):
            for path in self.paths:
                response = self.client.get(path, headers=self.viewer)
                self.assertEqual('Server-Timing' in response.headers,
                                 path.startswith('/api/room-assignments'))
