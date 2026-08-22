import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scenario_generator import (
    SCENARIOS, TEST_NATION, _apply, _base_people, _scenario_people, generate_complete_suite, generate_scenario,
)
from excel_import import create_fis_import_preview


class ScenarioGeneratorTest(unittest.TestCase):
    def test_catalog_is_complete_and_stably_numbered(self):
        self.assertEqual([item.number for item in SCENARIOS], [f'{number:03d}' for number in range(1, 10)])
        self.assertEqual([item.title for item in SCENARIOS], ['Erstimport', 'Unveränderte Meldeliste', 'Neue Athleten',
            'Athlet entfernt', 'Aufenthaltsdaten geändert', 'Zimmerpartner geändert', 'Genehmigtes Einzelzimmer außerhalb Quote',
            'Single Room Quote verletzt', 'Korrigierte Meldeliste'])

    def test_chain_contains_only_the_declared_delta(self):
        states = [_scenario_people(scenario) for scenario in SCENARIOS]
        by_id = lambda rows: {row['Competitorid/Staff ID']: row for row in rows}
        self.assertEqual(states[0], states[1])
        self.assertEqual(set(by_id(states[2])) - set(by_id(states[1])), {'100007', '100008'})
        self.assertEqual(set(by_id(states[2])) - set(by_id(states[3])), {'100006'})

        def differences(before, after):
            left, right = by_id(before), by_id(after)
            return {(person_id, field) for person_id in left.keys() & right.keys()
                    for field in left[person_id] if left[person_id][field] != right[person_id][field]}
        self.assertEqual(differences(states[3], states[4]), {('100001', 'Arrival_date'), ('100001', 'First_meal')})
        self.assertTrue({field for _, field in differences(states[4], states[5])} <= {'Shared with Name'})
        self.assertTrue({field for _, field in differences(states[5], states[6])} <= {'Room_type', 'Shared with Name'})
        self.assertEqual(states[6], states[7])
        self.assertTrue({field for _, field in differences(states[7], states[8])} <= {'Room_type', 'Shared with Name'})

    def test_all_generated_pairs_are_valid_and_expected_quota_isolated(self):
        with tempfile.TemporaryDirectory() as directory:
            for scenario in SCENARIOS:
                generated = generate_scenario(scenario.number, Path(directory))['root']
                prefix = f'{scenario.number}_' + generated.name.split('_', 1)[1]
                preview = create_fis_import_preview(str(generated / f'{prefix}_entries.xlsx'),
                                                    str(generated / f'{prefix}_room_list.xlsx'))
                self.assertTrue(preview['isValid'], (scenario.number, preview['errors']))
                quota_codes = {warning['code'] for warning in preview['warnings']
                               if warning['code'].startswith('QUOTA_')}
                expected = {'QUOTA_SINGLE_ROOMS_EXCEEDED'} if scenario.number in {'007', '008'} else set()
                self.assertEqual(quota_codes, expected, scenario.number)

    def test_generation_is_byte_for_byte_reproducible(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            one = generate_complete_suite(Path(first))
            two = generate_complete_suite(Path(second))
            hashes = lambda root: [(path.name, hashlib.sha256(path.read_bytes()).hexdigest())
                                   for path in sorted(root.iterdir()) if path.is_file()]
            self.assertEqual(hashes(one), hashes(two))

    def test_complete_suite_is_flat_and_contains_nine_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = generate_complete_suite(Path(directory))
            self.assertFalse(any(path.is_dir() for path in root.iterdir()))
            self.assertEqual(len(list(root.glob('*_entries.xlsx'))), 9)
            self.assertEqual(len(list(root.glob('*_room_list.xlsx'))), 9)
            self.assertTrue((root / '004_Athlet_entfernt_entries.xlsx').is_file())
            self.assertTrue((root / '009_Korrigierte_Meldeliste_room_list.xlsx').is_file())
            expected = json.loads((root / 'expected.json').read_text(encoding='utf-8'))
            self.assertEqual([item['number'] for item in expected['scenarios']],
                             [f'{number:03d}' for number in range(1, 10)])


if __name__ == '__main__':
    unittest.main()
