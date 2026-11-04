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
            {'nationCode': 'BRA', 'quotaDisciplines': ['Halfpipe'], 'gender': 'M',
             'function': 'Official', 'countsAsSingle': True,
             'singleRoomQuotaExemptReason': 'WORLD_CHAMPION'},
            *[{'nationCode': 'BRA', 'quotaDisciplines': ['Halfpipe'], 'gender': 'M',
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


def test_jpn_style_title_single_and_double_use_only_operational_exemptions():
    from copy import deepcopy
    from quota_service import allocate_single_rooms
    people=[dict(matchKey='single-title',nationCode='JPN',gender='W',function='Athlete',
        quotaDisciplines=['Snowboard Alpine','Snowboard Park & Pipe'],roomType='Single',countsAsSingle=True,singleRoomQuotaExemptReason='WORLD_CHAMPION'),
        dict(matchKey='double-title',nationCode='JPN',gender='W',function='Athlete',
        quotaDisciplines=['Snowboard Park & Pipe'],roomType='Double shared',countsAsSingle=False,singleRoomQuotaExemptReason='WORLD_CHAMPION')]
    before=deepcopy(people)
    rows=evaluate_quota_usage(people,people)
    assert sum(r['quotaExemptSingleRooms'] for r in rows)==1
    assert people==before
    capacities={('JPN',group,'W'):0 for group in ['Snowboard Alpine','Snowboard Park & Pipe']}
    assert len(allocate_single_rooms(people,capacities))==1
    people[1]['roomType']='Single'  # Display label cannot override the operative flag.
    assert len(allocate_single_rooms(people,capacities))==1
    people[1]['countsAsSingle']=True  # Existing recalculation of a changed request.
    assert len(allocate_single_rooms(people,capacities))==2
    assert sum(r['quotaExemptSingleRooms'] for r in evaluate_quota_usage(people,people))==2
