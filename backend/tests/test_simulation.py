import os
import sys
import unittest
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from simulation import DEFAULT_PERSON_COUNT, SIMULATION_OWNER, build_people


class SimulationRecipeTest(unittest.TestCase):
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
