"""Deterministic, modular FIS workflow scenarios for manual regression tests."""
from __future__ import annotations

import json
import re
from copy import deepcopy
from dataclasses import dataclass
from pathlib import Path
from generate_test_files import daterange_strings, write_excel


@dataclass(frozen=True)
class ScenarioDefinition:
    number: str
    title: str
    description: str
    steps: tuple[str, ...]

    def public_dict(self) -> dict:
        return {
            'number': self.number,
            'title': self.title,
            'description': self.description,
            'versions': len(self.steps),
        }


SCENARIOS = (
    ScenarioDefinition('001', 'Neue Nation', 'Erstmeldung einer bislang unbekannten Nation.', ('base',)),
    ScenarioDefinition('002', 'Neue Athleten', 'Eine Folgemeldung ergänzt zwei Athleten.', ('base', 'add-athletes')),
    ScenarioDefinition('003', 'Athlet entfernt', 'Eine Folgemeldung entfernt einen gemeldeten Athleten.', ('base', 'remove-athlete')),
    ScenarioDefinition('004', 'Zimmerbedarf geändert', 'Der Bedarf wechselt von Doppel- auf Einzelzimmer.', ('base', 'room-demand')),
    ScenarioDefinition('005', 'Anreise geändert', 'Die Nation meldet eine frühere Anreise.', ('base', 'arrival')),
    ScenarioDefinition('006', 'Abreise geändert', 'Die Nation verlängert den Aufenthalt.', ('base', 'departure')),
    ScenarioDefinition('007', 'Official-Quote verletzt', 'Zusätzliche Officials überschreiten die zulässige Quote.', ('base', 'official-quota')),
    ScenarioDefinition('008', 'Single-Room-Quote verletzt', 'Zu viele Einzelzimmer werden für Officials angefordert.', ('base', 'single-quota')),
    ScenarioDefinition('009', 'Quoten nach neuer Meldeliste wieder erfüllt', 'Eine korrigierte Meldeliste stellt beide Quoten wieder her.', ('base', 'official-quota', 'base')),
    ScenarioDefinition('010', 'Zimmerpartner betroffen', 'Ein bestehender Zimmerpartner wird ausgetauscht.', ('base', 'room-partner')),
    ScenarioDefinition('011', 'Disposition betroffen', 'Geänderte Aufenthaltsdaten betreffen eine bestehende Disposition.', ('base', 'arrival')),
    ScenarioDefinition('012', 'Mehrkosten erforderlich', 'Ein zusätzliches Einzelzimmer erzeugt genehmigungspflichtige Mehrkosten.', ('base', 'room-demand')),
    ScenarioDefinition('013', 'Rücksprache Nation', 'Eine Quotenverletzung erfordert dokumentierte Rücksprache.', ('base', 'official-quota')),
    ScenarioDefinition('014', 'Neue Meldeliste nach Ruecksprache', 'Nach Rücksprache folgt eine korrigierte Meldeliste.', ('base', 'official-quota', 'base')),
    ScenarioDefinition('015', 'Organisatorische Freigabe', 'Eine fachlich geprüfte Abweichung wird zur Freigabe vorgelegt.', ('base', 'single-quota')),
    ScenarioDefinition('016', 'Gesamttest', 'Durchläuft Meldung, Änderungen, Quoten, Rücksprache, Freigabe und Folgewirkungen.',
                       ('base', 'add-athletes', 'room-demand', 'official-quota', 'base', 'arrival', 'room-partner')),
)

SCENARIO_BY_NUMBER = {scenario.number: scenario for scenario in SCENARIOS}


def scenario_slug(scenario: ScenarioDefinition) -> str:
    """Return a filesystem-safe, readable and stable scenario name."""
    value = scenario.title.replace('ä', 'ae').replace('ö', 'oe').replace('ü', 'ue').replace('ß', 'ss')
    return re.sub(r'[^A-Za-z0-9]+', '_', value).strip('_')


def _base_people(number: str) -> list[dict]:
    offset = int(number) * 100
    people = [
        ('Athlete', 'BERGER', 'Mia', 'F', 'Double shared', 'KELLER, Noah'),
        ('Athlete', 'KELLER', 'Noah', 'M', 'Double shared', 'BERGER, Mia'),
        ('Athlete', 'FREI', 'Lina', 'F', 'Double shared', 'VOGT, Elias'),
        ('Athlete', 'VOGT', 'Elias', 'M', 'Double shared', 'FREI, Lina'),
        ('Coach', 'BAUMANN', 'Reto', 'M', 'Single', ''),
        ('Physio', 'AMREIN', 'Sara', 'F', 'Double shared', 'MEIER, Nils'),
        ('Team Captain', 'MEIER', 'Nils', 'M', 'Double shared', 'AMREIN, Sara'),
    ]
    return [{
        'Function': function, 'Competitorid/Staff ID': str(700000 + offset + index),
        'Accredid': str(800000 + offset + index), 'Fiscode': str(900000 + offset + index) if function == 'Athlete' else '',
        'Lastname': last, 'Firstname': first, 'Nationcode': f'X{number[-2:]}', 'Industryname': 'Slopestyle',
        'Gender': gender, 'Arrival_date': '2027-03-12', 'Departure_date': '2027-03-21',
        'Arrival_time': '12:30', 'Departure_time': '09:00', 'Arrival_by': 'Flight', 'Departure_by': 'Flight',
        'Arrival_flightno': f'WM{offset + index:04d}', 'Departure_flightno': f'WM{offset + index + 50:04d}',
        'Arrival_need_transportation': 'Yes', 'Departure_need_transportation': 'Yes',
        'Room_type': room, 'Shared with Name': partner, 'First_meal': '2027-03-12', 'Last_meal': '2027-03-21',
    } for index, (function, last, first, gender, room, partner) in enumerate(people, 1)]


def _apply(rows: list[dict], step: str, number: str) -> list[dict]:
    rows = deepcopy(rows)
    athletes = [row for row in rows if row['Function'] == 'Athlete']
    if step == 'add-athletes':
        seed = _base_people(number)[0]
        for index, (last, first, gender) in enumerate((('SUTER', 'Nora', 'F'), ('WYSS', 'Jonas', 'M')), 20):
            row = deepcopy(seed); row.update({'Lastname': last, 'Firstname': first, 'Gender': gender,
                'Competitorid/Staff ID': str(700000 + int(number) * 100 + index), 'Accredid': str(800000 + int(number) * 100 + index),
                'Fiscode': str(900000 + int(number) * 100 + index), 'Shared with Name': 'WYSS, Jonas' if first == 'Nora' else 'SUTER, Nora'})
            rows.append(row)
    elif step == 'remove-athlete': rows.remove(athletes[-1])
    elif step == 'room-demand': athletes[0].update({'Room_type': 'Single', 'Shared with Name': ''})
    elif step == 'arrival':
        for row in rows: row.update({'Arrival_date': '2027-03-10', 'First_meal': '2027-03-10'})
    elif step == 'departure':
        for row in rows: row.update({'Departure_date': '2027-03-23', 'Last_meal': '2027-03-23'})
    elif step == 'official-quota':
        seed = next(row for row in rows if row['Function'] != 'Athlete')
        for index in range(4):
            row = deepcopy(seed); row.update({'Lastname': f'OFFICIAL{index + 1}', 'Firstname': 'Test', 'Function': 'Official',
                'Competitorid/Staff ID': str(710000 + int(number) * 100 + index), 'Accredid': str(810000 + int(number) * 100 + index)})
            rows.append(row)
    elif step == 'single-quota':
        for row in rows:
            if row['Function'] != 'Athlete': row.update({'Room_type': 'Single', 'Shared with Name': ''})
    elif step == 'room-partner':
        athletes[0]['Shared with Name'], athletes[2]['Shared with Name'] = 'FREI, Lina', 'BERGER, Mia'
    return rows


def _room_rows(entries: list[dict]) -> list[dict]:
    rows = []
    for person in entries:
        flags = {'Single': 0, 'Double_shared': 0, 'Double_single': 0, 'Appartment': 0}
        flags['Single' if person['Room_type'] == 'Single' else 'Double_shared'] = 1
        row = {key: person.get(key, '') for key in ('Lastname', 'Firstname', 'Nationcode', 'Function', 'Arrival_date', 'Departure_date', 'Shared with Name', 'Room_type', 'First_meal', 'Last_meal')}
        row['Shared with Nationcode'] = person['Nationcode'] if person.get('Shared with Name') else ''
        row.update(flags)
        for day in daterange_strings(person['Arrival_date'], person['Departure_date']): row[f'{day} (Persons by room)'] = 1
        rows.append(row)
    return rows


def _expectation(scenario: ScenarioDefinition, version: int, step: str) -> dict:
    special = step != 'base'
    return {
        'version': version, 'change': step, 'technicalCheck': 'valid',
        'functionalCheck': 'review-required' if special else 'valid',
        'quotas': 'violated' if step in {'official-quota', 'single-quota'} else 'fulfilled',
        'importStatus': 'READY_FOR_REVIEW',
        'expectedTasks': ['Fachliche Prüfung'] if special else [],
        'expectedHistory': [f'Version {version} hochgeladen', 'Technische Prüfung abgeschlossen'],
        'expectedDispositionChanges': step in {'arrival', 'departure', 'room-demand'},
        'expectedRoommateChanges': step in {'room-partner', 'remove-athlete'},
        'expectedApprovals': ['Organisatorische Freigabe'] if scenario.number in {'012', '015', '016'} and special else [],
        'expectedConsultation': step == 'official-quota',
        'expectedFinalStatus': 'WAITING_FOR_NATION' if step == 'official-quota' else 'READY_FOR_APPROVAL',
    }


def generate_scenario(number: str, output_dir: Path) -> dict:
    scenario = SCENARIO_BY_NUMBER.get(number)
    if not scenario: raise KeyError(number)
    slug = scenario_slug(scenario)
    root = output_dir / f'{scenario.number}_{slug}'
    expectations = {'scenario': scenario.public_dict(), 'nation': f'X{number[-2:]}', 'versions': []}
    base = _base_people(number)
    for version, step in enumerate(scenario.steps, 1):
        entries = _apply(base, step, number)
        root.mkdir(parents=True, exist_ok=True)
        prefix = f'{scenario.number}_{slug}_V{version}'
        write_excel(entries, root / f'{prefix}_entries.xlsx')
        write_excel(_room_rows(entries), root / f'{prefix}_entries-room-list-detailed.xlsx')
        expectations['versions'].append(_expectation(scenario, version, step))
    root.mkdir(parents=True, exist_ok=True)
    (root / 'expected.json').write_text(json.dumps(expectations, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return {'root': root, **scenario.public_dict()}


def generate_complete_suite(output_dir: Path) -> Path:
    """Generate all scenarios as a directly usable chronological workspace."""
    root = output_dir / 'Kompletter_Testordner'
    for scenario in SCENARIOS:
        generate_scenario(scenario.number, root)
    return root
