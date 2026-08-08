import hashlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from scenario_generator import SCENARIOS, generate_scenario
from excel_import import create_fis_import_preview, confirm_fis_import
from models import Nation, db
from flask import Flask


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
                    folder = generated['root'] / f'version-{version}'
                    preview = create_fis_import_preview(str(folder / 'entries.xlsx'), str(folder / 'entries-room-list-detailed.xlsx'))
                    self.assertTrue(preview['isValid'], (scenario.number, version, preview['errors']))

    def test_scenario_001_creates_nation_master_data_only_on_successful_import(self):
        app = Flask(__name__)
        app.config.update(
            SQLALCHEMY_DATABASE_URI='sqlite:///:memory:',
            SQLALCHEMY_TRACK_MODIFICATIONS=False,
        )
        db.init_app(app)
        with app.app_context(), tempfile.TemporaryDirectory() as directory:
            db.create_all()
            generated = generate_scenario('001', Path(directory))
            expected = json.loads((generated['root'] / 'expected.json').read_text(encoding='utf-8'))
            folder = generated['root'] / 'version-1'

            preview = create_fis_import_preview(
                str(folder / 'entries.xlsx'),
                str(folder / 'entries-room-list-detailed.xlsx'),
            )
            self.assertTrue(preview['isValid'])
            self.assertIsNone(Nation.query.filter_by(code=expected['nation']).first())

            result = confirm_fis_import(preview['previewToken'])

            self.assertEqual(result['summary']['nationsCreated'], [expected['nation']])
            self.assertEqual(
                [nation.code for nation in Nation.query.order_by(Nation.code).all()],
                [expected['nation']],
            )
            self.assertEqual(expected['masterData'], {
                'createdOnSuccessfulImport': True,
                'availableInNationFiltersImmediately': True,
                'notCreatedByPreview': True,
            })


if __name__ == '__main__':
    unittest.main()
