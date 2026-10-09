"""Characterize analytics HTTP projections before changing their ownership."""
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
from models import (db, AccommodationEvent, AuditEvent, EventRoomDemand,
                    Hotel, HotelRoomInventory, RoomType)


class AnalyticsRoutesTest(unittest.TestCase):
    availability = '/api/analytics/room-availability'
    timeline = '/api/analytics/occupancy-timeline'

    def setUp(self):
        config = patch.dict(app.config)
        config.start()
        self.addCleanup(config.stop)
        configure_test_app(app)
        with app.app_context():
            db.drop_all()
            db.create_all()
        self.client = app.test_client()
        self.viewer = {'X-Authenticated-User': 'viewer',
                       'X-Authenticated-Groups': 'incoming-viewer'}

    def tearDown(self):
        with app.app_context():
            db.session.remove()

    def seed(self):
        with app.app_context():
            single = RoomType(name='Single', max_persons=1)
            double = RoomType(name='Double', max_persons=2)
            triple = RoomType(name='Triple', max_persons=3)
            hotel = Hotel(name='Analytics Hotel')
            db.session.add_all([single, double, triple, hotel])
            db.session.flush()
            # Repeated discipline and reverse date order expose accidental grouping/sorting.
            later = AccommodationEvent(discipline='Big Air', start_date=date(2027, 3, 10),
                                       end_date=date(2027, 3, 20), person_demand=999)
            earlier = AccommodationEvent(discipline='Big Air', start_date=date(2027, 2, 1),
                                         end_date=date(2027, 2, 5))
            empty = AccommodationEvent(discipline='No demands', start_date=date(2027, 4, 1),
                                       end_date=date(2027, 4, 2))
            for event in (later, earlier, empty):
                db.session.add(event)
                db.session.flush()
            for event, rows in (
                (later, [(single, 4), (double, 3), (triple, 1), (triple, 1)]),
                (earlier, [(single, 10), (double, 5), (triple, 1)]),
            ):
                for room_type, count in rows:
                    db.session.add(HotelRoomInventory(hotel_id=hotel.id,
                        room_type_id=room_type.id, room_count=count,
                        available_from=event.start_date, available_until=event.end_date))
            for event, rows in (
                (later, [(single, 6), (double, 3), (triple, 1), (triple, 1)]),
                (earlier, [(single, 2), (triple, 1)]),
            ):
                for room_type, count in rows:
                    db.session.add(EventRoomDemand(event_id=event.id,
                        room_type_id=room_type.id, room_count=count))
                    db.session.flush()
            db.session.commit()

    @staticmethod
    def availability_payload(ez_available, ez_demand, dz_available, dz_demand):
        return [
            {'roomType': {'id': 'ez', 'name': 'EZ / DU', 'maxPersons': 1},
             'available': ez_available, 'demand': ez_demand,
             'difference': ez_available - ez_demand},
            {'roomType': {'id': 'dz', 'name': 'DZ / DU', 'maxPersons': 2},
             'available': dz_available, 'demand': dz_demand,
             'difference': dz_available - dz_demand},
        ]

    def assert_payload(self, path, expected, query=None):
        response = self.client.get(path, query_string=query, headers=self.viewer)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'application/json')
        self.assertEqual(response.get_json(), expected)

    def test_availability_includes_event_demands_and_rounds_each_inventory_and_demand_row(self):
        self.seed()
        self.assert_payload(self.availability, self.availability_payload(14, 8, 11, 6))

    def test_availability_filters_inventory_and_demands_by_inclusive_overlap(self):
        self.seed()
        for start, end in [('2027-03-12', '2027-03-15'),
                           ('2027-03-20', '2027-03-21'),
                           ('2027-03-09', '2027-03-10'),
                           ('2027-03-15', '2027-03-12')]:
            with self.subTest(start=start, end=end):
                self.assert_payload(self.availability, self.availability_payload(4, 6, 5, 5),
                    {'start_date': start, 'end_date': end})
        self.assert_payload(self.availability, self.availability_payload(0, 0, 0, 0),
            {'start_date': '2027-05-01', 'end_date': '2027-05-02'})

    def test_availability_does_not_filter_with_only_one_date_or_empty_dates(self):
        self.seed()
        for query in ({'start_date': '2027-05-01'}, {'end_date': '2027-01-01'},
                      {'start_date': '', 'end_date': ''}):
            with self.subTest(query=query):
                self.assert_payload(self.availability, self.availability_payload(14, 8, 11, 6), query)

    def test_availability_malformed_dates_remain_unhandled_html_500(self):
        with patch.dict(app.config, PROPAGATE_EXCEPTIONS=False):
            for key in ('start_date', 'end_date'):
                with self.subTest(key=key):
                    response = self.client.get(self.availability,
                        query_string={key: 'not-a-date'}, headers=self.viewer)
                    self.assertEqual(response.status_code, 500)
                    self.assertEqual(response.mimetype, 'text/html')
                    self.assertIsNone(response.get_json(silent=True))

    def test_empty_data_returns_zero_availability_and_empty_timeline(self):
        self.assert_payload(self.availability, self.availability_payload(0, 0, 0, 0))
        self.assert_payload(self.timeline, [])

    def test_timeline_preserves_event_and_demand_rows_with_iso_dates_and_raw_bed_counts(self):
        self.seed()
        self.assert_payload(self.timeline, [
            {'discipline': 'Big Air', 'startDate': '2027-03-10', 'endDate': '2027-03-20',
             'demands': [
                 {'roomType': 'Single', 'roomCount': 6, 'maxPersons': 1, 'totalBeds': 6},
                 {'roomType': 'Double', 'roomCount': 3, 'maxPersons': 2, 'totalBeds': 6},
                 {'roomType': 'Triple', 'roomCount': 1, 'maxPersons': 3, 'totalBeds': 3},
                 {'roomType': 'Triple', 'roomCount': 1, 'maxPersons': 3, 'totalBeds': 3}]},
            {'discipline': 'Big Air', 'startDate': '2027-02-01', 'endDate': '2027-02-05',
             'demands': [
                 {'roomType': 'Single', 'roomCount': 2, 'maxPersons': 1, 'totalBeds': 2},
                 {'roomType': 'Triple', 'roomCount': 1, 'maxPersons': 3, 'totalBeds': 3}]},
            {'discipline': 'No demands', 'startDate': '2027-04-01', 'endDate': '2027-04-02',
             'demands': []},
        ])

    def test_timeline_ignores_date_range_parameters_including_malformed_dates(self):
        self.seed()
        baseline = self.client.get(self.timeline, headers=self.viewer).get_json()
        for query in ({'start_date': '2027-05-01', 'end_date': '2027-05-02'},
                      {'start_date': 'not-a-date', 'end_date': 'also-invalid'},
                      {'start_date': '2027-03-20'},
                      {'start_date': '2027-03-20', 'end_date': '2027-03-01'}):
            with self.subTest(query=query):
                self.assert_payload(self.timeline, baseline, query)

    def test_endpoints_require_authentication_and_data_read_without_auditing_reads(self):
        with patch.dict(app.config, AUTH_DEV_USER='', AUTH_PROXY_SECRET='analytics-test-secret'):
            for path in (self.availability, self.timeline):
                with self.subTest(path=path):
                    response = self.client.get(path)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.get_json(), {
                        'error': 'UNAUTHENTICATED', 'message': 'Authentication required'})
                    headers = {'X-Auth-Proxy-Secret': 'analytics-test-secret',
                               'X-Authenticated-User': 'analytics-user',
                               'X-Authenticated-Groups': 'unknown'}
                    response = self.client.get(path, headers=headers)
                    self.assertEqual(response.status_code, 403)
                    self.assertEqual(response.get_json(), {
                        'error': 'FORBIDDEN', 'message': 'Insufficient permissions'})
                    for role in ('incoming-viewer', 'incoming-editor', 'incoming-admin'):
                        response = self.client.get(path, headers={
                            **headers, 'X-Authenticated-Groups': role})
                        self.assertEqual(response.status_code, 200)
        with app.app_context():
            self.assertEqual(AuditEvent.query.count(), 0)
