import ast
import os
import sys
import unittest
from collections import Counter
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from simulation import DEFAULT_PERSON_COUNT, SIMULATION_OWNER, build_people


class SimulationRecipeTest(unittest.TestCase):
    def test_generator_does_not_call_production_assignment_functions(self):
        app_source = (Path(__file__).parents[1] / 'app.py').read_text(encoding='utf-8')
        module = ast.parse(app_source)
        generator = next(node for node in module.body
                         if isinstance(node, ast.FunctionDef) and node.name == 'create_simulation')
        calls = {node.func.id for node in ast.walk(generator)
                 if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)}
        self.assertNotIn('_validate_booking_payload', calls)
        self.assertNotIn('_save_booking_from_payload', calls)
        self.assertIn('RoomBooking', calls)
        self.assertIn('RoomBookingOccupant', calls)

    def test_default_roster_is_reproducible_and_uniquely_owned(self):
        first = build_people()
        second = build_people()
        self.assertEqual(first, second)
        self.assertEqual(len(first), DEFAULT_PERSON_COUNT)
        self.assertEqual(len({person['competitor_id'] for person in first}), DEFAULT_PERSON_COUNT)
        self.assertEqual({person['created_by'] for person in first}, {SIMULATION_OWNER})

    def test_roster_has_realistic_variety_and_fixed_single_share(self):
        people = build_people()
        self.assertGreaterEqual(len(Counter(person['nation_code'] for person in people)), 20)
        self.assertGreaterEqual(len(Counter(person['discipline'] for person in people)), 8)
        self.assertGreaterEqual(len(Counter(person['function'] for person in people)), 6)
        self.assertGreaterEqual(len({(person['arrival_date'], person['departure_date']) for person in people}), 15)
        self.assertEqual(sum(person['room_type'] == 'Single' for person in people), 300)


if __name__ == '__main__':
    unittest.main()
