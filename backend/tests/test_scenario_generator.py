import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scenario_generator import (
    SCENARIOS, TEST_NATION, _apply, _base_people, generate_complete_suite, generate_scenario,
)
from excel_import import create_fis_import_preview


class ScenarioGeneratorTest(unittest.TestCase):
    def test_catalog_is_complete_and_stably_numbered(self):
        self.assertEqual([item.number for item in SCENARIOS], [f'{number:03d}' for number in range(1, 11)])
        self.assertEqual([item.title for item in SCENARIOS], ['Erstimport', 'Unveränderte Meldeliste', 'Neue Athleten',
            'Athlet entfernt', 'Aufenthaltsdaten geändert', 'Zimmerpartner geändert', 'Official-Quote verletzt',
            'Single-Room-Quote verletzt', 'Korrigierte Meldeliste', 'Import abschließen'])
        self.assertEqual([len(item.steps) for item in SCENARIOS], [1, 2, 2, 2, 2, 2, 2, 2, 2, 1])

    def test_every_scenario_uses_the_same_master_data(self):
        base = _base_people()
        self.assertEqual({person['Nationcode'] for person in base}, {TEST_NATION})
        self.assertEqual(_apply(base, 'base'), base)
        self.assertEqual(SCENARIOS[1].steps, ('base', 'base'))
        self.assertEqual(SCENARIOS[8].steps, ('official-quota', 'base'))

    def test_each_change_is_limited_to_its_declared_subject(self):
        base = _base_people()
        identity = lambda row: row['Competitorid/Staff ID']
        by_id = lambda rows: {identity(row): row for row in rows}

        added = _apply(base, 'add-athletes')
        self.assertEqual(by_id(added) | by_id(base), by_id(added))
        self.assertEqual(len(added) - len(base), 2)

        removed = _apply(base, 'remove-athlete')
        self.assertEqual(set(by_id(base)) - set(by_id(removed)), {'100006'})
        self.assertEqual([row for row in base if identity(row) != '100006'], removed)

        stay = by_id(_apply(base, 'stay-dates'))
        changed_fields = {key for key in stay['100001'] if stay['100001'][key] != by_id(base)['100001'][key]}
        self.assertEqual(changed_fields, {'Arrival_date', 'First_meal'})
        self.assertEqual({key: value for key, value in stay.items() if key != '100001'},
                         {key: value for key, value in by_id(base).items() if key != '100001'})

        partners = by_id(_apply(base, 'room-partner'))
        for person_id, person in by_id(base).items():
            differences = {key for key in person if person[key] != partners[person_id][key]}
            self.assertTrue(differences <= {'Shared with Name'})

        singles = by_id(_apply(base, 'single-quota'))
        for person_id, person in by_id(base).items():
            differences = {key for key in person if person[key] != singles[person_id][key]}
            self.assertTrue(differences <= {'Room_type', 'Shared with Name'})

    def test_all_roommates_are_reciprocal_and_same_gender(self):
        for step in ('base', 'add-athletes', 'room-partner', 'official-quota'):
            people = _apply(_base_people(), step)
            by_name = {f"{person['Lastname']}, {person['Firstname']}": person for person in people}
            for person in people:
                if not person['Shared with Name']:
                    continue
                partner = by_name[person['Shared with Name']]
                self.assertEqual(partner['Gender'], person['Gender'])
                self.assertEqual(partner['Shared with Name'], f"{person['Lastname']}, {person['Firstname']}")

    def test_generation_is_byte_for_byte_reproducible(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            one = generate_scenario('010', Path(first))['root']
            two = generate_scenario('010', Path(second))['root']
            hashes = lambda root: [(str(path.relative_to(root)), hashlib.sha256(path.read_bytes()).hexdigest()) for path in sorted(root.rglob('*')) if path.is_file()]
            self.assertEqual(hashes(one), hashes(two))

    def test_every_version_uses_importable_fis_files_and_has_expectations(self):
        with tempfile.TemporaryDirectory() as directory:
            for scenario in SCENARIOS:
                generated = generate_scenario(scenario.number, Path(directory))
                expected = json.loads((generated['root'] / 'expected.json').read_text(encoding='utf-8'))
                self.assertEqual(len(expected['versions']), len(scenario.steps))
                for version in range(1, len(scenario.steps) + 1):
                    prefix = f'{scenario.number}_' + generated['root'].name.split('_', 1)[1] + f'_V{version}'
                    preview = create_fis_import_preview(str(generated['root'] / f'{prefix}_entries.xlsx'), str(generated['root'] / f'{prefix}_entries-room-list-detailed.xlsx'))
                    self.assertTrue(preview['isValid'], (scenario.number, version, preview['errors']))

    def test_complete_suite_contains_every_scenario_without_nested_archives(self):
        with tempfile.TemporaryDirectory() as directory:
            root = generate_complete_suite(Path(directory))
            self.assertEqual(len([path for path in root.iterdir() if path.is_dir()]), 10)
            self.assertTrue((root / '004_Athlet_entfernt' / '004_Athlet_entfernt_V2_entries.xlsx').is_file())


if __name__ == '__main__':
    unittest.main()
