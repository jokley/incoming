import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scenario_generator import SCENARIOS, generate_complete_suite, generate_scenario
from excel_import import create_fis_import_preview


class ScenarioGeneratorTest(unittest.TestCase):
    def test_catalog_is_complete_and_stably_numbered(self):
        self.assertEqual([item.number for item in SCENARIOS], [f'{number:03d}' for number in range(1, 17)])

    def test_generation_is_byte_for_byte_reproducible(self):
        with tempfile.TemporaryDirectory() as first, tempfile.TemporaryDirectory() as second:
            one = generate_scenario('016', Path(first))['root']
            two = generate_scenario('016', Path(second))['root']
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
            self.assertEqual(len([path for path in root.iterdir() if path.is_dir()]), 16)
            self.assertTrue((root / '003_Athlet_entfernt' / '003_Athlet_entfernt_V2_entries.xlsx').is_file())


if __name__ == '__main__':
    unittest.main()
