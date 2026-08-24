"""Deterministic input recipe for the administration load simulation."""
from __future__ import annotations

from datetime import date, timedelta

SIMULATION_OWNER = 'simulation'
DEFAULT_PERSON_COUNT = 1500
SEED_VERSION = 1

NATIONS = ('AUT', 'CAN', 'CHN', 'CZE', 'ESP', 'FIN', 'FRA', 'GBR', 'GER', 'ITA',
           'JPN', 'KOR', 'NED', 'NOR', 'NZL', 'POL', 'SLO', 'SUI', 'SWE', 'USA')
DISCIPLINES = ('Alpine', 'Big Air', 'Cross-Country', 'Freestyle', 'Moguls',
               'Ski Jumping', 'Slopestyle', 'Snowboard Cross')
FUNCTIONS = ('Athlete', 'Athlete', 'Athlete', 'Coach', 'Team Captain', 'Physio', 'Doctor', 'Service')
FIRST_NAMES = ('Anna', 'Lina', 'Mia', 'Nora', 'Sofia', 'Emma', 'Noah', 'Luca', 'Elias', 'Jonas', 'Leo', 'Nils')
LAST_NAMES = ('Berger', 'Frei', 'Suter', 'Wyss', 'Keller', 'Vogt', 'Baumann', 'Meier', 'Marti', 'Steiner', 'Schmid', 'Huber')


def build_people(count: int = DEFAULT_PERSON_COUNT) -> list[dict]:
    """Return a stable, varied roster. No runtime randomness is involved."""
    people = []
    # Align with the immutable 2027 accommodation reference window while
    # varying arrivals and lengths inside it.
    base = date(2027, 3, 4)
    for index in range(count):
        nation = NATIONS[(index * 7 + index // len(NATIONS)) % len(NATIONS)]
        discipline = DISCIPLINES[(index * 5 + index // len(DISCIPLINES)) % len(DISCIPLINES)]
        arrival = base + timedelta(days=(index * 7) % 12)
        departure = min(date(2027, 3, 22), arrival + timedelta(days=4 + (index // 12) % 4))
        wants_single = index % 5 == 0  # reproducible 20 percent single-room share
        people.append({
            'created_by': SIMULATION_OWNER,
            'function': FUNCTIONS[(index * 3) % len(FUNCTIONS)],
            'competitor_id': f'SIM-{SEED_VERSION}-{index + 1:05d}',
            'accred_id': f'SIMA-{SEED_VERSION}-{index + 1:05d}',
            'fis_code': f'SIMF-{SEED_VERSION}-{index + 1:05d}',
            'firstname': FIRST_NAMES[(index * 5) % len(FIRST_NAMES)],
            'lastname': f'{LAST_NAMES[(index * 7) % len(LAST_NAMES)]}-{index + 1:04d}',
            'nation_code': nation,
            'discipline': discipline,
            'gender': 'F' if index % 2 == 0 else 'M',
            'for_gender': 'F' if index % 2 == 0 else 'M',
            'arrival_date': arrival,
            'departure_date': departure,
            'arrival_time': f'{8 + index % 12:02d}:{(index * 15) % 60:02d}',
            'departure_time': f'{7 + index % 11:02d}:{(index * 10) % 60:02d}',
            'arrival_by': ('Flight', 'Train', 'Bus')[index % 3],
            'departure_by': ('Flight', 'Train', 'Bus')[(index + 1) % 3],
            'arrival_need_transportation': index % 3 != 1,
            'departure_need_transportation': index % 4 != 1,
            'room_type': 'Single' if wants_single else 'Double shared',
            'single_room_status': 'IN_QUOTA' if wants_single else 'NONE',
            'present': False,
        })
    return people


def build_assignment_units(people) -> list[list]:
    """Group the roster into requested occupancy units; placement remains production logic."""
    singles, shared = [], []
    for person in people:
        (singles if person.room_type == 'Single' else shared).append(person)
    units = [[person] for person in singles]
    # Equal stays are grouped to preserve the actual requested date interval.
    by_stay = {}
    for person in shared:
        by_stay.setdefault((person.arrival_date, person.departure_date), []).append(person)
    for key in sorted(by_stay):
        rows = by_stay[key]
        units.extend(rows[offset:offset + 2] for offset in range(0, len(rows), 2))
    return units
