from app import app, db, RoomType, Hotel, HotelRoomInventory, Event, EventRoomDemand, Athlete, RoomAssignment
from datetime import datetime

def seed_database():
    from event_ownership_runtime import require_isolated_legacy_database
    require_isolated_legacy_database(app)
    with app.app_context():
        # Clear existing data
        db.drop_all()
        db.create_all()

        print("🗑️  Datenbank geleert...")

        # 1. Room Types
        print("📋 Erstelle Zimmertypen...")
        room_types_data = [
            {'name': 'DZ / DU', 'max_persons': 2},
            {'name': 'EZ / DU', 'max_persons': 1},
            {'name': '3BZ / DU', 'max_persons': 2},
            {'name': '4BZ / DU', 'max_persons': 2},
            {'name': 'APP: 1 DZ + DU', 'max_persons': 2},
            {'name': 'APP: 2 DZ + DU', 'max_persons': 2},
            {'name': 'APP: 2 DZ + 2 DU', 'max_persons': 4},
            {'name': 'APP: 3 DZ + DU', 'max_persons': 2},
            {'name': 'APP: 3 DZ + 2 DU', 'max_persons': 4},
            {'name': 'APP: 3 DZ + 3 DU', 'max_persons': 6},
            {'name': 'APP: 1 DZ + 1 EZ + DU', 'max_persons': 2},
        ]

        room_types_map = {}
        for rt_data in room_types_data:
            rt = RoomType(name=rt_data['name'], max_persons=rt_data['max_persons'])
            db.session.add(rt)
            db.session.flush()
            room_types_map[rt.name] = rt.id

        db.session.commit()
        print(f"✅ {len(room_types_data)} Zimmertypen erstellt")

        # 2. Hotels with Inventories (Sample subset from CSV)
        print("🏨 Erstelle Hotels und Inventories...")

        hotels_inventory_data = [
            ('Alpenlodge', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-22', 31, True, False),

            ('Cube Alpine Stay', 'Bürs', 'Bludenz', 'DZ / DU', '2027-03-04', '2027-03-22', 17, False, False),
            ('Cube Alpine Stay', 'Bürs', 'Bludenz', 'APP: 3 DZ + 2 DU', '2027-03-04', '2027-03-22', 4, False, False),
            ('Cube Alpine Stay', 'Bürs', 'Bludenz', 'APP: 2 DZ + 2 DU', '2027-03-04', '2027-03-22', 6, False, False),

            ('Hotel Daneu', 'Nüziders', 'Bludenz', 'DZ / DU', '2027-03-03', '2027-03-22', 9, True, True),
            ('Hotel Daneu', 'Nüziders', 'Bludenz', 'EZ / DU', '2027-03-03', '2027-03-22', 5, True, True),

            ('Hotel Garni Madrisa', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-21', 9, True, True),
            ('Hotel Garni Madrisa', 'Brand', 'Bludenz', 'EZ / DU', '2027-03-07', '2027-03-21', 2, True, True),

            ('Hotel Lagant', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-21', 30, True, True),

            ('Hotel Lün', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-22', 12, False, False),
            ('Hotel Lün', 'Brand', 'Bludenz', 'APP: 2 DZ + 2 DU', '2027-03-07', '2027-03-22', 3, False, False),

            ('Hotel Sarotla', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-22', 40, True, True),

            ('Hotel Sonne', 'Brand', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-21', 11, True, False),
            ('Hotel Sonne', 'Brand', 'Bludenz', 'EZ / DU', '2027-03-07', '2027-03-21', 3, True, False),

            ('Naturhotel Till', 'Satteins', 'Bludenz', 'DZ / DU', '2027-03-04', '2027-03-22', 9, True, True),
            ('Naturhotel Till', 'Satteins', 'Bludenz', 'EZ / DU', '2027-03-04', '2027-03-22', 9, True, True),

            ('Rössle', 'Braz', 'Bludenz', 'DZ / DU', '2027-03-14', '2027-03-21', 10, True, True),
            ('Rössle', 'Braz', 'Bludenz', 'EZ / DU', '2027-03-14', '2027-03-21', 1, True, True),

            ('Val Blu GmbH', 'Bludenz', 'Bludenz', 'DZ / DU', '2027-03-04', '2027-03-22', 26, True, True),

            ('Hotel Löwen', 'Feldkirch', 'Feldkirch', 'DZ / DU', '2027-03-03', '2027-03-22', 21, True, True),

            ('BergSPA & Hotel Zamangspitze', 'St. Gallenkirch', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 5, True, True),
            ('BergSPA & Hotel Zamangspitze', 'St. Gallenkirch', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-22', 5, True, True),
            ('BergSPA & Hotel Zamangspitze', 'St. Gallenkirch', 'Montafon', 'APP: 1 DZ + DU', '2027-03-04', '2027-03-22', 1, True, True),

            ('Chalet Sonne', 'Vandans', 'Montafon', 'DZ / DU', '2027-03-14', '2027-03-22', 27, True, False),
            ('Chalet Sonne', 'Vandans', 'Montafon', 'EZ / DU', '2027-03-14', '2027-03-22', 6, True, False),
            ('Chalet Sonne', 'Vandans', 'Montafon', '3BZ / DU', '2027-03-14', '2027-03-22', 3, True, False),
            ('Chalet Sonne', 'Vandans', 'Montafon', '4BZ / DU', '2027-03-14', '2027-03-22', 2, True, False),
            ('Chalet Sonne', 'Vandans', 'Montafon', 'APP: 2 DZ + 2 DU', '2027-03-14', '2027-03-22', 3, True, False),
            ('Chalet Sonne', 'Vandans', 'Montafon', 'APP: 2 DZ + 2 DU', '2027-03-14', '2027-03-22', 1, True, False),

            ('Christophorus', 'Partenen', 'Montafon', 'DZ / DU', '2027-03-06', '2027-03-22', 2, False, True),
            ('Christophorus', 'Partenen', 'Montafon', 'EZ / DU', '2027-03-06', '2027-03-22', 1, False, True),
            ('Christophorus', 'Partenen', 'Montafon', 'APP: 1 DZ + DU', '2027-03-06', '2027-03-22', 1, False, True),

            ('Die Montafonerin', 'Vandans', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-22', 17, True, True),
            ('Die Montafonerin', 'Vandans', 'Montafon', 'EZ / DU', '2027-03-07', '2027-03-22', 5, True, True),
            ('Die Montafonerin', 'Vandans', 'Montafon', 'APP: 2 DZ + DU', '2027-03-07', '2027-03-22', 2, True, True),
            ('Die Montafonerin', 'Vandans', 'Montafon', 'APP: 2 DZ + DU', '2027-03-07', '2027-03-22', 2, True, True),
            ('Die Montafonerin', 'Vandans', 'Montafon', 'APP: 2 DZ + 2 DU', '2027-03-07', '2027-03-22', 3, True, True),

            ('Explorer Hotels', 'Gaschurn', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 25, True, False),
            ('Explorer Hotels', 'Gaschurn', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-22', 25, True, False),

            ('Gasthof zum Guten Tropfen', 'Partenen', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-21', 3, False, False),
            ('Gasthof zum Guten Tropfen', 'Partenen', 'Montafon', 'EZ / DU', '2027-03-07', '2027-03-21', 2, False, False),

            ('Hochjochstöbli', 'Schruns', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-21', 12, True, True),
            ('Hochjochstöbli', 'Schruns', 'Montafon', 'APP: 2 DZ + DU', '2027-03-07', '2027-03-21', 1, True, True),

            ('Hotel Alpenrose', 'Gargellen', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-21', 18, True, True),
            ('Hotel Alpenrose', 'Gargellen', 'Montafon', 'APP: 2 DZ + 2 DU', '2027-03-04', '2027-03-21', 3, True, True),

            ('Hotel Auhof', 'Schruns', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-21', 10, True, False),
            ('Hotel Auhof', 'Schruns', 'Montafon', 'EZ / DU', '2027-03-07', '2027-03-21', 6, True, False),

            ('Hotel Bergerhof', 'Bartholomäberg', 'Montafon', 'DZ / DU', '2027-03-09', '2027-03-15', 4, True, True),
            ('Hotel Bergerhof', 'Bartholomäberg', 'Montafon', 'EZ / DU', '2027-03-09', '2027-03-15', 2, True, True),
            ('Hotel Bergerhof', 'Bartholomäberg', 'Montafon', 'APP: 2 DZ + DU', '2027-03-09', '2027-03-15', 2, True, True),

            ('Hotel Bradabella', 'Gargellen', 'Montafon', 'DZ / DU', '2027-03-06', '2027-03-21', 2, True, True),
            ('Hotel Bradabella', 'Gargellen', 'Montafon', 'EZ / DU', '2027-03-06', '2027-03-21', 2, True, True),

            ('Hotel Chesa Platina', 'Schruns', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-22', 5, False, False),
            ('Hotel Chesa Platina', 'Schruns', 'Montafon', 'EZ / DU', '2027-03-07', '2027-03-22', 5, False, False),

            ('Hotel Gasthof Adler', 'St. Gallenkirch', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 12, True, True),
            ('Hotel Gasthof Adler', 'St. Gallenkirch', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-22', 8, True, True),

            ('Hotel Hirschen', 'Silbertal', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-21', 20, True, True),
            ('Hotel Hirschen', 'Silbertal', 'Montafon', 'EZ / DU', '2027-03-07', '2027-03-21', 2, True, True),

            ('Hotel Litz', 'Schruns', 'Montafon', 'DZ / DU', '2027-03-03', '2027-03-22', 9, True, True),
            ('Hotel Litz', 'Schruns', 'Montafon', 'APP: 2 DZ + DU', '2027-03-03', '2027-03-22', 1, True, True),
            ('Hotel Litz', 'Schruns', 'Montafon', 'APP: 2 DZ + DU', '2027-03-03', '2027-03-22', 1, True, True),

            ('Hotel Marmotta', 'Gargellen', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-11', 4, False, True),

            ('Hotel Montjola Nova', 'Schruns', 'Montafon', 'DZ / DU', '2027-03-09', '2027-03-22', 19, True, False),
            ('Hotel Montjola Nova', 'Schruns', 'Montafon', 'EZ / DU', '2027-03-09', '2027-03-22', 1, True, False),

            ('Hotel Pfeifer Domig GmbH', 'Gaschurn', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 7, True, True),
            ('Hotel Pfeifer Domig GmbH', 'Gaschurn', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-22', 4, True, True),

            ('Hotel Silvretta', 'Gortipohl', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 8, True, True),
            ('Hotel Silvretta', 'Gortipohl', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-22', 2, True, True),

            ('Hotel Zimba', 'Schruns', 'Montafon', 'DZ / DU', '2027-03-08', '2027-03-22', 44, True, True),

            ('Montafon Moments', 'Gortipohl', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-21', 36, True, True),

            ('Pension Faneskla', 'Silbertal', 'Montafon', 'DZ / DU', '2027-03-06', '2027-03-21', 2, False, True),
            ('Pension Faneskla', 'Silbertal', 'Montafon', 'EZ / DU', '2027-03-06', '2027-03-21', 2, False, True),
            ('Pension Faneskla', 'Silbertal', 'Montafon', 'APP: 1 DZ + DU', '2027-03-06', '2027-03-21', 1, False, True),
            ('Pension Faneskla', 'Silbertal', 'Montafon', 'APP: 1 DZ + 1 EZ + DU', '2027-03-06', '2027-03-21', 2, False, True),

            ('Pension Wilma', 'Gantschier', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-21', 4, True, True),
            ('Pension Wilma', 'Gantschier', 'Montafon', '3BZ / DU', '2027-03-07', '2027-03-21', 4, True, True),
            ('Pension Wilma', 'Gantschier', 'Montafon', '4BZ / DU', '2027-03-07', '2027-03-21', 1, True, True),

            ('Relax und Vitalhotel Adler KG', 'St. Anton i.M.', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-21', 9, True, True),
            ('Relax und Vitalhotel Adler KG', 'St. Anton i.M.', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-21', 6, True, True),

            ('Revier Mountain Lodge', 'St. Gallenkirch', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 9, True, True),

            ('Sonnenhang', 'Gortipohl', 'Montafon', 'DZ / DU', '2027-03-09', '2027-03-22', 4, False, True),
            ('Sonnenhang', 'Gortipohl', 'Montafon', 'APP: 2 DZ + DU', '2027-03-09', '2027-03-22', 1, False, True),
            ('Sonnenhang', 'Gortipohl', 'Montafon', 'APP: 1 DZ + DU', '2027-03-09', '2027-03-22', 1, False, True),

            ('Sporthotel Silvretta Montafon', 'Gaschurn', 'Montafon', 'DZ / DU', '2027-03-07', '2027-03-21', 35, True, True),
            ('Sporthotel Silvretta Montafon', 'Gaschurn', 'Montafon', 'EZ / DU', '2027-03-07', '2027-03-21', 12, True, True),

            ('Post', 'Dalaas', 'Bludenz', 'DZ / DU', '2027-03-07', '2027-03-15', 5, True, True),
            ('Post', 'Dalaas', 'Bludenz', 'EZ / DU', '2027-03-07', '2027-03-15', 13, True, True),

            ('Tiroler Hof', 'Partenen', 'Montafon', 'DZ / DU', '2027-03-04', '2027-03-22', 4, False, False),
            ('Tiroler Hof', 'Partenen', 'Montafon', 'EZ / DU', '2027-03-04', '2027-03-22', 3, False, False),
        ]

        hotels_map = {}
        for hotel_name, location, region, room_type_name, date_from, date_to, room_count, has_hp, has_sr in hotels_inventory_data:
            # Get or create hotel
            if hotel_name not in hotels_map:
                hotel = Hotel(name=hotel_name, location=location, region=region)
                db.session.add(hotel)
                db.session.flush()
                hotels_map[hotel_name] = hotel.id

            # Add inventory
            inventory = HotelRoomInventory(
                hotel_id=hotels_map[hotel_name],
                room_type_id=room_types_map[room_type_name],
                available_from=datetime.strptime(date_from, '%Y-%m-%d').date(),
                available_until=datetime.strptime(date_to, '%Y-%m-%d').date(),
                room_count=room_count,
                has_half_board=has_hp,
                has_sr=has_sr
            )
            db.session.add(inventory)

        db.session.commit()
        print(f"✅ {len(hotels_map)} Hotels mit {len(hotels_inventory_data)} Inventories erstellt")

        # 3. Events with Room Demands
        print("📅 Erstelle Events und Demands...")

        events_demands_data = [
            ('Big Air', '2027-03-07', '2027-03-14', 'DZ / DU', 141),
            ('Big Air', '2027-03-07', '2027-03-14', 'EZ / DU', 139),
            ('Areals', '2027-03-15', '2027-03-21', 'DZ / DU', 50),
            ('Areals', '2027-03-15', '2027-03-21', 'EZ / DU', 50),
            ('Moguls', '2027-03-12', '2027-03-20', 'DZ / DU', 57),
            ('Moguls', '2027-03-12', '2027-03-20', 'EZ / DU', 56),
            ('Parallel', '2027-03-04', '2027-03-11', 'DZ / DU', 57),
            ('Parallel', '2027-03-04', '2027-03-11', 'EZ / DU', 56),
            ('Slopestyle', '2027-03-12', '2027-03-21', 'DZ / DU', 142),
            ('Slopestyle', '2027-03-12', '2027-03-21', 'EZ / DU', 140),
            ('Snowboard Cross', '2027-03-16', '2027-03-22', 'DZ / DU', 60),
            ('Snowboard Cross', '2027-03-16', '2027-03-22', 'EZ / DU', 59),
            ('Ski Cross', '2027-03-09', '2027-03-15', 'DZ / DU', 54),
            ('Ski Cross', '2027-03-09', '2027-03-15', 'EZ / DU', 53),
        ]

        events_map = {}
        for discipline, date_from, date_to, room_type_name, room_demand in events_demands_data:
            # Get or create event
            if discipline not in events_map:
                event = Event(
                    discipline=discipline,
                    start_date=datetime.strptime(date_from, '%Y-%m-%d').date(),
                    end_date=datetime.strptime(date_to, '%Y-%m-%d').date()
                )
                db.session.add(event)
                db.session.flush()
                events_map[discipline] = event.id

            # Add demand
            demand = EventRoomDemand(
                event_id=events_map[discipline],
                room_type_id=room_types_map[room_type_name],
                room_count=room_demand
            )
            db.session.add(demand)

        db.session.commit()
        print(f"✅ {len(events_map)} Events mit {len(events_demands_data)} Demands erstellt")

        # 4. Sample Athletes (AUT Team from CSV)
        print("👥 Erstelle Athleten...")

        athletes_data = [
            # Athletes
            ('DUSEK', 'Jakob', 'AUT', 'Athlete', 'M', 'Snowboard Cross', '2027-03-12', '2027-03-15', 'R'),
            ('HAEMMERLE', 'Alessandro', 'AUT', 'Athlete', 'M', 'Snowboard Cross', '2027-03-13', '2027-03-15', 'R'),
            ('LEITNER', 'Elias', 'AUT', 'Athlete', 'M', 'Snowboard Cross', '2027-03-12', '2027-03-15', 'R'),
            ('PACHNER', 'Lukas', 'AUT', 'Athlete', 'M', 'Snowboard Cross', '2027-03-12', '2027-03-15', 'R'),
            ('PICKL', 'David', 'AUT', 'Athlete', 'M', 'Snowboard Cross', '2027-03-12', '2027-03-15', None),
            ('GALLER', 'Anna-Maria', 'AUT', 'Athlete', 'W', 'Snowboard Cross', '2027-03-12', '2027-03-15', 'R'),
            ('KOBALD', 'Tanja', 'AUT', 'Athlete', 'W', 'Snowboard Cross', '2027-03-12', '2027-03-15', 'R'),
            ('ZERKHOLD', 'Pia', 'AUT', 'Athlete', 'W', 'Snowboard Cross', '2027-03-12', '2027-03-15', 'R'),

            # NSA Staff
            ('BURGSTALLER', 'Christian', 'AUT', 'NSA Professional', 'M', None, '2027-03-12', '2027-03-15', None),
            ('FORSTENPOINTNER', 'Walter', 'AUT', 'NSA Technician', 'M', None, '2027-03-12', '2027-03-15', None),
            ('GALLER', 'Christian', 'AUT', 'NSA Alpine Director', 'M', None, '2027-03-12', '2027-03-15', None),
            ('GONZALES', 'Sandra', 'AUT', 'NSA Guest', 'W', None, '2027-03-12', '2027-03-15', None),
            ('GREIL', 'Thomas', 'AUT', 'NSA Head Coach', 'M', None, '2027-03-12', '2027-03-15', None),
            ('GRUNER', 'Lukas', 'AUT', 'NSA Coach', 'M', None, '2027-03-12', '2027-03-15', None),
            ('IONUT', 'Vilceanu', 'AUT', 'NSA Guest', 'M', None, '2027-03-12', '2027-03-15', None),
            ('MAIR', 'Christopher', 'AUT', 'NSA Team Doctor', 'M', None, '2027-03-12', '2027-03-15', None),
            ('POPPERL', 'Paul', 'AUT', 'NSA Team Service Staff', 'M', None, '2027-03-12', '2027-03-15', None),
            ('RAITMAIR', 'Gernot', 'AUT', 'NSA Coach', 'M', None, '2027-03-12', '2027-03-15', None),
            ('RITCHIE', 'Samuel Magnus', 'AUT', 'NSA Technician', 'M', None, '2027-03-12', '2027-03-15', None),
            ('VONBANK', 'Christoph', 'AUT', 'NSA Technician', 'M', None, '2027-03-13', '2027-03-15', None),
            ('WIESER', 'Kalrheinz', 'AUT', 'NSA Team Press Attaché', 'M', None, '2027-03-12', '2027-03-15', None),
            ('WOODFORD', 'James', 'AUT', 'NSA Technician', 'M', None, '2027-03-12', '2027-03-15', None),
        ]

        for lastname, firstname, nation, function, gender, discipline, arrival, departure, stance in athletes_data:
            athlete = Athlete(
                lastname=lastname,
                firstname=firstname,
                nation_code=nation,
                function=function,
                gender=gender,
                discipline=discipline,
                arrival_date=datetime.strptime(arrival, '%Y-%m-%d').date() if arrival else None,
                departure_date=datetime.strptime(departure, '%Y-%m-%d').date() if departure else None,
                stance=stance
            )
            db.session.add(athlete)

        db.session.commit()
        print(f"✅ {len(athletes_data)} Athleten erstellt")

        print("\n🎉 Datenbank erfolgreich initialisiert!")
        print("\n📊 Zusammenfassung:")
        print(f"   - {len(room_types_data)} Zimmertypen")
        print(f"   - {len(hotels_map)} Hotels")
        print(f"   - {len(hotels_inventory_data)} Hotel Inventories")
        print(f"   - {len(events_map)} Events")
        print(f"   - {len(events_demands_data)} Event Demands")
        print(f"   - {len(athletes_data)} Athleten")
        print("\n✅ Bereit für Freestyle WM 2027!")

if __name__ == '__main__':
    seed_database()
