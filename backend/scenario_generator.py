"""Small, deterministic FIS import workflow scenarios for manual regression tests."""
from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path

from generate_test_files import daterange_strings, write_excel


TEST_NATION = 'SUI'
DISCIPLINE = 'Slopestyle'
ARRIVAL = '2027-03-12'
DEPARTURE = '2027-03-21'


@dataclass(frozen=True)
class ScenarioDefinition:
    number: str
    title: str
    description: str
    steps: tuple[str, ...]

    def public_dict(self) -> dict:
        return {'number': self.number, 'title': self.title, 'description': self.description, 'versions': len(self.steps)}


# A scenario contains the files a tester imports in order. Except for the explicitly
# named step, every version is derived from exactly the same immutable roster.
SCENARIOS = (
    ScenarioDefinition('001', 'Erstimport', 'Eine neue Nation wird erstmals importiert.', ('base',)),
    ScenarioDefinition('002', 'Unveränderte Meldeliste', 'Dieselbe Meldeliste wird ohne fachliche Änderung erneut importiert.', ('base', 'base')),
    ScenarioDefinition('003', 'Neue Athleten', 'Nur zwei zusätzliche Athleten werden ergänzt.', ('base', 'add-athletes')),
    ScenarioDefinition('004', 'Athlet entfernt', 'Nur ein bestehender Athlet entfällt.', ('base', 'remove-athlete')),
    ScenarioDefinition('005', 'Aufenthaltsdaten geändert', 'Nur die Aufenthaltsdaten eines Athleten ändern sich.', ('base', 'stay-dates')),
    ScenarioDefinition('006', 'Zimmerpartner geändert', 'Nur die Zimmerpartner bestehender Athletinnen ändern sich.', ('base', 'room-partner')),
    ScenarioDefinition('007', 'Genehmigtes Einzelzimmer außerhalb Quote', 'Eine zusätzliche Person benötigt einen genehmigten Einzelzimmeranspruch.', ('single-quota-base', 'single-quota-extra')),
    ScenarioDefinition('008', 'Single-Room-Quote verletzt', 'Nur Einzelzimmeranforderungen verletzen die Quote.', ('base', 'single-quota')),
    ScenarioDefinition('009', 'Korrigierte Meldeliste', 'Die verletzte Official-Quote wird wieder eingehalten.', ('official-quota', 'base')),
    ScenarioDefinition('010', 'Import abschließen', 'Unveränderte Meldeliste ohne offene Entscheidungen.', ('base',)),
)
SCENARIO_BY_NUMBER = {scenario.number: scenario for scenario in SCENARIOS}


def scenario_slug(scenario: ScenarioDefinition) -> str:
    value = scenario.title.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')
    return re.sub(r'[^A-Za-z0-9]+', '_', value).strip('_')


# IDs, names, functions and partners deliberately live in one visible fixture.
# This is the vocabulary developers should learn; do not derive it from a scenario.
BASE_PEOPLE = (
    ('Athlete', 'BERGER', 'Mia', 'F', '100001', '200001', '300001', 'Double shared', 'FREI, Lina'),
    ('Athlete', 'FREI', 'Lina', 'F', '100002', '200002', '300002', 'Double shared', 'BERGER, Mia'),
    ('Athlete', 'SUTER', 'Nora', 'F', '100003', '200003', '300003', 'Double shared', 'WYSS, Lea'),
    ('Athlete', 'WYSS', 'Lea', 'F', '100004', '200004', '300004', 'Double shared', 'SUTER, Nora'),
    ('Athlete', 'KELLER', 'Noah', 'M', '100005', '200005', '300005', 'Double shared', 'VOGT, Elias'),
    ('Athlete', 'VOGT', 'Elias', 'M', '100006', '200006', '300006', 'Double shared', 'KELLER, Noah'),
    ('Coach', 'BAUMANN', 'Reto', 'F', '110001', '210001', '', 'Double shared', 'MEIER, Nils'),
    ('Team Captain', 'MEIER', 'Nils', 'F', '110002', '210002', '', 'Double shared', 'BAUMANN, Reto'),
    ('Physio', 'AMREIN', 'Sara', 'F', '110003', '210003', '', 'Single', ''),
)

ADDED_ATHLETES = (
    ('Athlete', 'MARTI', 'Jonas', 'M', '100007', '200007', '300007', 'Double shared', 'STEINER, Luca'),
    ('Athlete', 'STEINER', 'Luca', 'M', '100008', '200008', '300008', 'Double shared', 'MARTI, Jonas'),
)

ADDED_OFFICIALS = (
    ('Doctor', 'IMHOF', 'Claudia', 'F', '110004', '210004', '', 'Double shared', 'KUNZ, Anna'),
    ('Service', 'KUNZ', 'Anna', 'F', '110005', '210005', '', 'Double shared', 'IMHOF, Claudia'),
    ('Service', 'SCHMID', 'David', 'F', '110006', '210006', '', 'Double shared', 'HUBER, Simon'),
    ('Official', 'HUBER', 'Simon', 'F', '110007', '210007', '', 'Double shared', 'SCHMID, David'),
)
EXTRA_SINGLE_OFFICIAL = ('Official', 'GEIGER', 'Tina', 'F', '110008', '210008', '', 'Single', '')


def _person(record: tuple[str, ...]) -> dict:
    function, last, first, gender, person_id, accred_id, fis_code, room, partner = record
    return {
        'Function': function, 'Competitorid/Staff ID': person_id, 'Accredid': accred_id, 'Fiscode': fis_code,
        'Lastname': last, 'Firstname': first, 'Nationcode': TEST_NATION, 'Industryname': DISCIPLINE,
        'Gender': gender, 'Arrival_date': ARRIVAL, 'Departure_date': DEPARTURE,
        'Arrival_time': '12:30', 'Departure_time': '09:00', 'Arrival_by': 'Flight', 'Departure_by': 'Flight',
        'Arrival_flightno': 'LX WM27', 'Departure_flightno': 'LX WM28',
        'Arrival_need_transportation': 'Yes', 'Departure_need_transportation': 'Yes',
        'Room_type': room, 'Shared with Name': partner, 'First_meal': ARRIVAL, 'Last_meal': DEPARTURE,
    }


def _base_people() -> list[dict]:
    return [_person(record) for record in BASE_PEOPLE]


def _apply(rows: list[dict], step: str) -> list[dict]:
    rows = deepcopy(rows)
    if step == 'base':
        return rows
    if step == 'single-quota-base':
        rows = [row for row in rows if row['Competitorid/Staff ID'] not in {'100005', '100006'}]
        for row in rows:
            if row['Competitorid/Staff ID'] in {'110001', '110002', '110003'}:
                row.update({'Room_type': 'Single', 'Shared with Name': ''})
        return rows
    if step == 'add-athletes':
        rows.extend(_person(record) for record in ADDED_ATHLETES)
    elif step == 'remove-athlete':
        rows.remove(next(row for row in rows if row['Fiscode'] == '300006'))
    elif step == 'stay-dates':
        mia = next(row for row in rows if row['Fiscode'] == '300001')
        mia.update({'Arrival_date': '2027-03-11', 'First_meal': '2027-03-11'})
    elif step == 'room-partner':
        partners = {'300001': 'WYSS, Lea', '300004': 'BERGER, Mia', '300002': 'SUTER, Nora', '300003': 'FREI, Lina'}
        for row in rows:
            if row['Fiscode'] in partners:
                row['Shared with Name'] = partners[row['Fiscode']]
    elif step == 'official-quota':
        rows.extend(_person(record) for record in ADDED_OFFICIALS)
    elif step == 'single-quota':
        for person_id in ('110001', '110002'):
            official = next(row for row in rows if row['Competitorid/Staff ID'] == person_id)
            official.update({'Room_type': 'Single', 'Shared with Name': ''})
    elif step == 'single-quota-extra':
        rows = _apply(rows, 'single-quota-base')
        rows.append(_person(EXTRA_SINGLE_OFFICIAL))
    else:
        raise ValueError(f'Unknown scenario step: {step}')
    return rows


def _room_rows(entries: list[dict]) -> list[dict]:
    rows = []
    for person in entries:
        flags = {'Single': 0, 'Double_shared': 0, 'Double_single': 0, 'Appartment': 0}
        flags['Single' if person['Room_type'] == 'Single' else 'Double_shared'] = 1
        row = {key: person.get(key, '') for key in ('Lastname', 'Firstname', 'Nationcode', 'Function', 'Arrival_date', 'Departure_date', 'Shared with Name', 'Room_type', 'First_meal', 'Last_meal')}
        row['Shared with Nationcode'] = TEST_NATION if person['Shared with Name'] else ''
        row.update(flags)
        for day in daterange_strings(person['Arrival_date'], person['Departure_date']):
            row[f'{day} (Persons by room)'] = 1
        rows.append(row)
    return rows


def _expectation(version: int, step: str) -> dict:
    changed = step != 'base'
    quota_violation = step in {'official-quota', 'single-quota', 'single-quota-extra'}
    return {
        'version': version, 'change': step, 'technicalCheck': 'valid',
        'functionalCheck': 'review-required' if changed else 'valid',
        'quotas': 'violated' if quota_violation else 'fulfilled', 'importStatus': 'READY_FOR_REVIEW',
        'expectedTasks': ['Fachliche Prüfung'] if changed else [],
        'expectedHistory': [f'Version {version} hochgeladen', 'Technische Prüfung abgeschlossen'],
        'expectedDispositionChanges': step == 'stay-dates', 'expectedRoommateChanges': step == 'room-partner',
        'expectedApprovals': [], 'expectedConsultation': step == 'official-quota',
        'expectedFinalStatus': 'WAITING_FOR_NATION' if quota_violation else ('READY_FOR_IMPORT' if not changed else 'READY_FOR_APPROVAL'),
    }


def generate_scenario(number: str, output_dir: Path) -> dict:
    scenario = SCENARIO_BY_NUMBER.get(number)
    if not scenario:
        raise KeyError(number)
    root = output_dir / f'{scenario.number}_{scenario_slug(scenario)}'
    root.mkdir(parents=True, exist_ok=True)
    expectations = {'scenario': scenario.public_dict(), 'nation': TEST_NATION, 'versions': []}
    base = _base_people()
    for version, step in enumerate(scenario.steps, 1):
        entries = _apply(base, step)
        prefix = f'{scenario.number}_{scenario_slug(scenario)}_V{version}'
        write_excel(entries, root / f'{prefix}_entries.xlsx')
        write_excel(_room_rows(entries), root / f'{prefix}_entries-room-list-detailed.xlsx')
        expectations['versions'].append(_expectation(version, step))
    (root / 'expected.json').write_text(json.dumps(expectations, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'root': root, **scenario.public_dict()}


def generate_complete_suite(output_dir: Path) -> Path:
    root = output_dir / 'Kompletter_Testordner'
    for scenario in SCENARIOS:
        generate_scenario(scenario.number, root)
    return root
