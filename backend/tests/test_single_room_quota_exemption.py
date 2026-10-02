import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from quota_service import evaluate_quota_usage  # noqa: E402


class SingleRoomQuotaExemptionTest(unittest.TestCase):
    def test_exempt_single_is_reported_but_not_consumed(self):
        roster = [
            {'nationCode': 'BRA', 'quotaDisciplines': ['Halfpipe'], 'gender': 'M', 'function': 'Athlete'},
            {'nationCode': 'BRA', 'quotaDisciplines': ['Halfpipe'], 'gender': 'M', 'function': 'Athlete'},
        ]
        assigned = [
            {'nationCode': 'BRA', 'discipline': 'Halfpipe', 'gender': 'M',
             'function': 'Official', 'countsAsSingle': True,
             'singleRoomQuotaExemptReason': 'WORLD_CHAMPION'},
            *[{'nationCode': 'BRA', 'discipline': 'Halfpipe', 'gender': 'M',
               'function': 'Official', 'countsAsSingle': True} for _ in range(3)],
        ]

        row = evaluate_quota_usage(roster, assigned)[0]
        self.assertEqual(row['singleRoomsAllowed'], 2)
        self.assertEqual(row['singleRoomsUsed'], 3)
        self.assertEqual(row['quotaExemptSingleRooms'], 1)

    def test_general_exemption_and_multi_competition_are_person_centric(self):
        roster = [{'nationCode': 'BRA', 'quotaDisciplines': ['Moguls', 'Moguls'],
                   'gender': 'F', 'function': 'Athlete'}]
        assigned = [{**roster[0], 'countsAsSingle': True,
                     'singleRoomQuotaExemptReason': 'OTHER'}]

        rows = evaluate_quota_usage(roster, assigned)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['singleRoomsUsed'], 0)
        self.assertEqual(rows[0]['quotaExemptSingleRooms'], 1)


if __name__ == '__main__':
    unittest.main()
