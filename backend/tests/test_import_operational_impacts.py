import os
import sys
import unittest
from datetime import date


database_url = os.environ.get('TEST_DATABASE_URL')
if not database_url:
    raise unittest.SkipTest('TEST_DATABASE_URL is required for database integration tests')
os.environ['DATABASE_URL'] = database_url

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import app  # noqa: E402
from excel_import import (_remove_athletes, build_disposition_analysis, build_import_changes,
                          build_quota_warnings)  # noqa: E402
from models import Athlete, Hotel, RoomBooking, RoomBookingOccupant, RoomType, db  # noqa: E402


class ImportOperationalImpactsTest(unittest.TestCase):
    def setUp(self):
        app.config['TESTING'] = True
        with app.app_context():
            db.drop_all()
            db.create_all()
            db.session.add_all([Hotel(name='Test Hotel'), RoomType(name='Single', max_persons=1)])
            db.session.commit()

    def person(self, athlete, function=None, arrival=None, departure=None):
        return {
            'matchKey': athlete.fis_code, 'fisCode': athlete.fis_code,
            'firstname': athlete.firstname, 'lastname': athlete.lastname,
            'nationCode': athlete.nation_code, 'industryName': athlete.discipline,
            'gender': athlete.gender, 'forGender': athlete.for_gender,
            'function': function or athlete.function, 'roomType': athlete.room_type,
            'arrivalDate': arrival if arrival is not None else athlete.arrival_date,
            'departureDate': departure if departure is not None else athlete.departure_date,
        }

    def room(self, first, second=None, source_key=None):
        return {
            'sourceRowKey': source_key or '|'.join(filter(None, [first.fis_code, second.fis_code if second else None])),
            'person1Key': first.fis_code, 'person2Key': second.fis_code if second else None,
            'roomType': 'Double' if second else 'Single',
        }

    def test_live_quota_uses_import_entitlements_not_assigned_room_types(self):
        with app.app_context():
            roster = [Athlete(fis_code='A1', firstname='A', lastname='One', nation_code='AUT',
                discipline='Big Air', gender='F', function='Athlete')]
            roster += [Athlete(fis_code=f'O{i}', firstname='O', lastname=str(i), nation_code='AUT',
                discipline='Big Air', gender='F', function='Official') for i in range(4)]
            roster[1].single_room_entitlement = 'IN_QUOTA'
            roster[2].single_room_entitlement = 'APPROVED_EXTRA'
            db.session.add_all(roster)
            db.session.flush()
            hotel, room_type = Hotel.query.one(), RoomType.query.one()
            for index, official in enumerate(roster[1:]):
                booking = RoomBooking(hotel_id=hotel.id, room_type_id=room_type.id,
                                      counts_as_single=index < 2)
                db.session.add(booking)
                db.session.flush()
                db.session.add(RoomBookingOccupant(room_booking_id=booking.id, athlete_id=official.id))
            db.session.commit()

            warnings = build_quota_warnings([self.person(person) for person in roster], [])
            self.assertEqual({warning['code'] for warning in warnings}, {
                'QUOTA_OFFICIALS_EXCEEDED', 'QUOTA_SINGLE_ROOMS_EXCEEDED'})
            response = app.test_client().get('/api/fis/official-quotas')
            live = response.get_json()[0]
            self.assertEqual((live['assignedOfficials'], live['officialQuota']), (4, 3))
            self.assertEqual((live['singleRoomsUsed'], live['singleRoomsAllowed']), (2, 1))
            self.assertEqual(live['approvedExtraSingleRooms'], 1)
            self.assertEqual(live, {
                'nationCode': 'AUT', 'discipline': 'Big Air', 'gender': 'F',
                'athletesEntered': 1, 'officialQuota': 3,
                'singleRoomsAllowed': 1, 'assignedOfficials': 4,
                'singleRoomsUsed': 2, 'approvedExtraSingleRooms': 1,
                'requiredSingleRooms': 2, 'implementedSingleRooms': 2,
                'remainingSingleRooms': 0, 'openApprovals': 0,
                'approvedExceptions': 0, 'quotaStatus': 'FULFILLED',
            })
            self.assertLessEqual(
                int(response.headers['X-Assignment-Query-Count']), 3)

    def test_changed_stay_reports_existing_booking_hotel_and_partner(self):
        with app.app_context():
            first = Athlete(fis_code='A1', firstname='Anna', lastname='One', nation_code='AUT', discipline='Big Air',
                gender='F', function='Athlete', arrival_date=date(2027, 3, 10), departure_date=date(2027, 3, 12))
            partner = Athlete(fis_code='A2', firstname='Bea', lastname='Two', nation_code='AUT', discipline='Big Air',
                gender='F', function='Athlete', arrival_date=date(2027, 3, 10), departure_date=date(2027, 3, 12))
            db.session.add_all([first, partner]); db.session.flush()
            booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
            db.session.add(booking); db.session.flush()
            db.session.add_all([RoomBookingOccupant(room_booking_id=booking.id, athlete_id=first.id),
                                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=partner.id)])
            db.session.commit()
            result = build_disposition_analysis([
                self.person(first, arrival=date(2027, 3, 9)), self.person(partner)], [], [])['categories']
            self.assertEqual(result['stayChanged']['count'], 1)
            self.assertEqual(result['hotelAssignmentAffected']['count'], 1)
            self.assertIn('Bea Two', result['dispositionAffected']['records'][0]['roommates'])

            people = [self.person(first, arrival=date(2027, 3, 9)), self.person(partner)]
            room = self.room(first, partner, 'A1|A2')
            analysis = build_disposition_analysis(people, [room], [])
            changes = build_import_changes(analysis, people, [room], [])
            person_stays = [change for change in changes
                            if change['type'] == 'STAY_CHANGED' and change['preview'] == 'persons']
            room_stays = [change for change in changes
                          if change['type'] == 'STAY_CHANGED' and change['preview'] == 'rooms']
            self.assertEqual([change['entityId'] for change in person_stays], ['A1'])
            self.assertEqual([(change['entityId'], change['affectedPersonId']) for change in room_stays],
                             [('A1|A2', 'A1')])

    def test_roommate_replacement_is_one_room_change(self):
        with app.app_context():
            mia = Athlete(fis_code='A1', firstname='Mia', lastname='One', nation_code='AUT', discipline='Big Air')
            lina = Athlete(fis_code='A2', firstname='Lina', lastname='Two', nation_code='AUT', discipline='Big Air')
            luca = Athlete(fis_code='A3', firstname='Luca', lastname='Three', nation_code='AUT', discipline='Big Air')
            db.session.add_all([mia, lina, luca]); db.session.flush()
            booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
            db.session.add(booking); db.session.flush()
            db.session.add_all([RoomBookingOccupant(room_booking_id=booking.id, athlete_id=mia.id),
                                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=lina.id)])
            db.session.commit()
            people = [self.person(mia), self.person(lina), self.person(luca)]
            room = self.room(mia, luca, 'A1|A3')
            analysis = build_disposition_analysis(people, [room], [])
            self.assertEqual(analysis['categories']['roommateAffected']['count'], 1)
            changes = build_import_changes(analysis, people, [room], [])
            roommate_changes = [change for change in changes if change['type'] == 'ROOMMATE_CHANGED']
            self.assertEqual(roommate_changes, [{
                'type': 'ROOMMATE_CHANGED', 'preview': 'rooms', 'severity': 'warning',
                'entityId': 'A1|A3', 'description': 'Zimmerpartner geändert',
            }])

    def test_stay_and_partner_change_share_the_existing_assignment(self):
        with app.app_context():
            mia = Athlete(fis_code='A1', firstname='Mia', lastname='One', nation_code='AUT', discipline='Big Air',
                          arrival_date=date(2027, 3, 12), departure_date=date(2027, 3, 21))
            lina = Athlete(fis_code='A2', firstname='Lina', lastname='Two', nation_code='AUT', discipline='Big Air')
            lea = Athlete(fis_code='A3', firstname='Lea', lastname='Three', nation_code='AUT', discipline='Big Air')
            db.session.add_all([mia, lina, lea]); db.session.flush()
            booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
            db.session.add(booking); db.session.flush()
            db.session.add_all([RoomBookingOccupant(room_booking_id=booking.id, athlete_id=mia.id),
                                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=lina.id)])
            db.session.commit()
            people = [self.person(mia, arrival=date(2027, 3, 11)), self.person(lina), self.person(lea)]
            room = self.room(mia, lea, 'mia-existing-assignment')
            analysis = build_disposition_analysis(people, [room], [])
            changes = build_import_changes(analysis, people, [room], [])

            room_changes = [(change['type'], change['entityId']) for change in changes
                            if change['preview'] == 'rooms']
            self.assertEqual(room_changes.count(('STAY_CHANGED', 'mia-existing-assignment')), 1)
            self.assertEqual(room_changes.count(('ROOMMATE_CHANGED', 'mia-existing-assignment')), 1)
            self.assertNotIn(('ROOM_CREATED', 'mia-existing-assignment'), room_changes)

    def test_mirrored_room_rows_with_different_stays_are_one_assignment(self):
        with app.app_context():
            mia = Athlete(fis_code='A1', firstname='Mia', lastname='One', nation_code='AUT', discipline='Big Air',
                          arrival_date=date(2027, 3, 12), departure_date=date(2027, 3, 21))
            lina = Athlete(fis_code='A2', firstname='Lina', lastname='Two', nation_code='AUT', discipline='Big Air')
            db.session.add_all([mia, lina]); db.session.flush()
            booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
            db.session.add(booking); db.session.flush()
            db.session.add_all([RoomBookingOccupant(room_booking_id=booking.id, athlete_id=mia.id),
                                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=lina.id)])
            db.session.commit()
            people = [self.person(mia, arrival=date(2027, 3, 11)), self.person(lina)]
            rooms = [self.room(mia, lina, 'A1|A2|2027-03-11'),
                     self.room(lina, mia, 'A1|A2|2027-03-12')]
            analysis = build_disposition_analysis(people, rooms, [])
            room_changes = [change for change in build_import_changes(analysis, people, rooms, [])
                            if change['preview'] == 'rooms']

            self.assertEqual([change['type'] for change in room_changes], ['STAY_CHANGED'])
            self.assertEqual(room_changes[0]['entityId'], 'A1|A2|2027-03-11')

    def test_room_changes_do_not_depend_on_spreadsheet_order(self):
        with app.app_context():
            athletes = [Athlete(fis_code=f'A{i}', firstname='Person', lastname=str(i),
                                nation_code='AUT', discipline='Big Air') for i in range(1, 5)]
            db.session.add_all(athletes); db.session.flush()
            for first, second in ((athletes[0], athletes[1]), (athletes[2], athletes[3])):
                booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
                db.session.add(booking); db.session.flush()
                db.session.add_all([
                    RoomBookingOccupant(room_booking_id=booking.id, athlete_id=first.id),
                    RoomBookingOccupant(room_booking_id=booking.id, athlete_id=second.id),
                ])
            db.session.commit()
            people = [self.person(athlete) for athlete in athletes]
            rooms = [self.room(athletes[0], athletes[2]), self.room(athletes[1], athletes[3])]

            def semantics(room_rows):
                analysis = build_disposition_analysis(people, room_rows, [])
                return sorted((change['type'], change['entityId']) for change in
                              build_import_changes(analysis, people, room_rows, [])
                              if change['preview'] == 'rooms')

            self.assertEqual(semantics(rooms), semantics(list(reversed(rooms))))

    def test_two_changed_occupant_stays_are_one_room_status(self):
        with app.app_context():
            first = Athlete(fis_code='A1', firstname='Anna', lastname='One', nation_code='AUT',
                            discipline='Big Air', arrival_date=date(2027, 3, 10))
            second = Athlete(fis_code='A2', firstname='Bea', lastname='Two', nation_code='AUT',
                             discipline='Big Air', arrival_date=date(2027, 3, 10))
            db.session.add_all([first, second]); db.session.flush()
            booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
            db.session.add(booking); db.session.flush()
            db.session.add_all([RoomBookingOccupant(room_booking_id=booking.id, athlete_id=first.id),
                                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=second.id)])
            db.session.commit()
            people = [self.person(first, arrival=date(2027, 3, 9)),
                      self.person(second, arrival=date(2027, 3, 9))]
            room = self.room(first, second)
            analysis = build_disposition_analysis(people, [room], [])
            room_stays = [change for change in build_import_changes(analysis, people, [room], [])
                          if change['preview'] == 'rooms' and change['type'] == 'STAY_CHANGED']
            self.assertEqual(len(room_stays), 1)
            self.assertEqual(room_stays[0]['affectedPersonIds'], ['A1', 'A2'])

    def test_new_person_with_room_emits_person_and_room_created(self):
        with app.app_context():
            mia = Athlete(fis_code='A1', firstname='Mia', lastname='One', nation_code='AUT', discipline='Big Air')
            people = [self.person(mia)]
            room = self.room(mia, source_key='A1|single')
            analysis = build_disposition_analysis(people, [room], [])
            changes = build_import_changes(analysis, people, [room], [])
            self.assertIn(('NEW_PERSON', 'persons', 'A1'),
                          [(change['type'], change['preview'], change['entityId']) for change in changes])
            self.assertIn(('ROOM_CREATED', 'rooms', 'A1|single'),
                          [(change['type'], change['preview'], change['entityId']) for change in changes])

    def test_removed_person_with_room_emits_person_and_room_removed(self):
        with app.app_context():
            mia = Athlete(fis_code='A1', firstname='Mia', lastname='One', nation_code='AUT', discipline='Big Air')
            lina = Athlete(fis_code='A2', firstname='Lina', lastname='Two', nation_code='AUT', discipline='Big Air')
            db.session.add_all([mia, lina]); db.session.flush()
            booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
            db.session.add(booking); db.session.flush()
            db.session.add_all([RoomBookingOccupant(room_booking_id=booking.id, athlete_id=mia.id),
                                RoomBookingOccupant(room_booking_id=booking.id, athlete_id=lina.id)])
            db.session.commit()
            people = [self.person(mia)]
            analysis = build_disposition_analysis(people, [], [])
            changes = build_import_changes(analysis, people, [], [])
            semantics = [(change['type'], change['preview']) for change in changes]
            self.assertIn(('PERSON_REMOVED', 'persons'), semantics)
            self.assertIn(('ROOM_REMOVED', 'rooms'), semantics)

    def test_removed_athlete_releases_empty_booking_without_orphans(self):
        with app.app_context():
            athlete = Athlete(firstname='Anna', lastname='One', nation_code='AUT')
            db.session.add(athlete); db.session.flush()
            booking = RoomBooking(hotel_id=Hotel.query.one().id, room_type_id=RoomType.query.one().id)
            db.session.add(booking); db.session.flush()
            db.session.add(RoomBookingOccupant(room_booking_id=booking.id, athlete_id=athlete.id))
            db.session.commit()
            self.assertEqual(_remove_athletes([athlete]), 1)
            db.session.commit()
            self.assertEqual(RoomBooking.query.count(), 0)
            self.assertEqual(RoomBookingOccupant.query.count(), 0)
            self.assertEqual(Athlete.query.count(), 0)


if __name__ == '__main__':
    unittest.main()
