"""Numerical display evidence, never sporting approval or import validation."""
from copy import deepcopy
from types import SimpleNamespace as NS
import pytest
import os
from test_support import postgres_test_url
# Shared autouse fixtures initialize the application even for pure projections.
os.environ['DATABASE_URL'] = postgres_test_url()
from sport_entry_plausibility import project_entries


def setup_case(count=5):
    comps={i:NS(id=i,display_name=name,sport='Snowboard',gender='M',team_competition=False,quota_discipline='Snowboard Park & Pipe')
        for i,name in [(1,'Snowboard Slopestyle'),(2,'Snowboard Big Air'),(3,'Snowboard Halfpipe')]}
    people=[dict(matchKey=f'p{i}',fisCode=str(100+i),nationCode='X',gender='M',function='Athlete',
        competitionMemberships=[{'competitionId':1},{'competitionId':2}],singleRoomQuotaExemptReason='WORLD_CHAMPION') for i in range(count)]
    title=dict(fisCode='100',nation='X',gender='M',discipline='SS',eventGroup='Snowboard Park & Pipe',
        championship='Engadin',championshipYear=2025,titleType='INDIVIDUAL',entitlementEnabled=True,sourceVerified=True,source='https://example.test/fis-result')
    return people,comps,NS(is_world_championship=True,year=2027),title


def test_exact_title_only_and_shared_pool_preserve_preview():
    people,comps,event,title=setup_case();before=deepcopy(people)
    view=project_entries(people,comps,event,[title]);ss,ba=view['1'][0],view['2'][0]
    assert ss['reported']==ba['reported']==ss['sharedPoolReported']==ba['sharedPoolReported']==5
    assert ss['championStarters']==1 and ss['unverifiedAdditional']==0
    assert ba['championStarters']==0 and ba['unverifiedAdditional']==1
    assert ss['allocationConfirmed'] is ba['allocationConfirmed'] is False
    assert people==before
    people[0]['singleRoomQuotaExemptReason']=None
    assert project_entries(people,comps,event,[title])==view


@pytest.mark.parametrize('field,value',[
    ('fisCode','999'),('nation','Y'),('gender','W'),('discipline','BA'),
    ('championshipYear',2023),('titleType','TEAM'),('sourceVerified',False),
    ('source',''),('entitlementEnabled',False),('eventGroup','Freeski Park & Pipe'),
])
def test_inexact_or_unverified_title_never_grants_extra(field,value):
    people,comps,event,title=setup_case();title[field]=value
    assert project_entries(people,comps,event,[title])['1'][0]['unverifiedAdditional']==1


def test_ez_flag_without_title_and_nine_entrants_are_not_automatically_cleared():
    people,comps,event,title=setup_case(9)
    view=project_entries(people,comps,event,[])
    assert view['1'][0]['unverifiedAdditional']==5
    assert view['2'][0]['sharedPoolReported']==9
    people.append({**people[0],'function':'NSA Coach','matchKey':'staff'})
    assert project_entries(people,comps,event,[])==view
    assert project_entries(people,comps,NS(is_world_championship=False,year=2027),[title])=={}
    assert project_entries(people,comps,NS(is_world_championship=True,year=2029),[title])=={}


def test_title_requires_exact_competition_membership():
    people,comps,event,title=setup_case()
    people[0]['competitionMemberships']=[{'competitionId':2}]
    view=project_entries(people,comps,event,[title])
    assert view['1'][0]['reported']==4 and view['1'][0]['championStarters']==0
    assert view['2'][0]['reported']==5 and view['2'][0]['championStarters']==0


@pytest.mark.parametrize('count,remaining', [(4, 0), (5, 0), (9, 4)])
def test_alpine_individual_title_is_not_transferred_or_applied_to_team(count, remaining):
    people, _, event, title = setup_case(count)
    comps = {i: NS(id=i, display_name=name, sport='Snowboard', gender=gender,
        team_competition=team, quota_discipline='Snowboard Alpine')
        for i, name, gender, team in [(1, 'Parallel Giant Slalom', 'M', False),
            (2, 'Parallel Slalom', 'M', False), (3, 'Parallel Team', 'A', True)]}
    for person in people:
        person['competitionMemberships'].append({'competitionId': 3})
    title.update(discipline='PGS', eventGroup='Snowboard Alpine')
    before = deepcopy(people)
    view = project_entries(people + [deepcopy(people[0])], comps, event, [title])
    assert set(view) == {'1', '2'}
    assert view['1'][0]['reported'] == view['2'][0]['reported'] == count
    assert view['1'][0]['championStarters'] == 1
    assert view['1'][0]['unverifiedAdditional'] == remaining
    assert view['2'][0]['championStarters'] == 0
    assert view['2'][0]['unverifiedAdditional'] == max(0, count - 4)
    assert all(row[0]['sharedPoolReported'] is None for row in view.values())
    assert people == before
