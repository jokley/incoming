"""Synthetic ITA acceptance, reflecting supplied totals, not the missing workbooks."""
from copy import deepcopy
from datetime import datetime
from types import SimpleNamespace
import pytest
from quota_overview import build_quota_overview
from quota_rules import standard_rules
from quota_service import evaluate_quota_usage


@pytest.fixture
def reference():
    event=SimpleNamespace(id=7,name='WSC Montafon 2027',is_world_championship=True,quota_rules_revision=3,quota_rules_fixed_at=datetime(2026,10,26))
    people=[]
    for group,count,men in [('Freeski Park & Pipe',4,2),('Ski Cross',6,4)]:
        for i in range(count):people.append(dict(matchKey=f'{group}-{i}',function='Athlete',nationCode='ITA',gender='M' if i<men else 'W',quotaDisciplines=[group],countsAsSingle=False))
    for i in range(14):
        groups=['Freeski Park & Pipe','Ski Cross'] if i<5 else ['Freeski Park & Pipe'] if i<9 else ['Ski Cross']
        people.append(dict(matchKey=f'official-{i}',function='NSA Coach',nationCode='ITA',gender='M',quotaDisciplines=groups,countsAsSingle=False))
    checks=[]
    for group,gender,count,basis,officials,ez in [('Freeski Park & Pipe','M',2,4,9,0),('Freeski Park & Pipe','W',2,4,9,0),('Ski Cross','M',4,6,10,0),('Ski Cross','W',2,4,10,1)]:
        checks.append(dict(nationCode='ITA',discipline=group,gender=gender,athletes=count,officialQuota=basis,officials=officials,
            singleRoomsAllowed=2,singleRoomsRequested=ez,singleRoomsPending=0,singleRoomsApproved=0,quotaExemptSingleRooms=0,officialsExceeded=officials>basis,singleRoomsExceeded=False))
    family=dict(nationCode='ITA',topLevelDiscipline='Freestyle',athleteQuotaUsed=10,athleteQuotaLimit=36,athleteGenderUsed={'M':6,'F':4},athleteGenderLimit=20,athleteQuotaStatus='WITHIN_BASE_LIMITS',decisionStatus='WITHIN_QUOTA',approvedExtent=dict(total=0,M=0,F=0),uncoveredExtent=dict(total=0,M=0,F=0))
    return event,people,checks,[family]


def overview(reference):
    event,people,checks,families=reference
    return build_quota_overview(people,checks,families,event)


def test_italy_distinct_reference_and_gender_context_totals(reference):
    result=overview(reference);nation=result['nations'][0]
    assert (nation['athletes'],nation['officials'],nation['peopleTotal'])==(10,14,24)
    assert nation['officialsInMultipleGroups']==5
    a,b=nation['groups']
    assert (a['officials'],b['officials'])==(9,10)
    assert (a['athletes'],b['athletes'])==(4,6)
    assert a['totals']['officialQuota']==8 and b['totals']['officialQuota']==10
    assert a['totals']['singleRoomsAllowed']==b['totals']['singleRoomsAllowed']==4
    assert a['totals']['singleRoomsRequested']==0 and b['totals']['singleRoomsRequested']==1
    assert [r['athletes'] for r in a['contexts']]==[2,2]
    assert [r['athletes'] for r in b['contexts']]==[4,2]
    # 18 arithmetic slots never becomes an authorized cross-group coverage result.
    assert nation['coverageReviewRequired'] and nation['officialsWithoutCoverage'] is None
    assert nation['ezDecisionsOpen']==0


def test_repeated_sources_and_competitions_do_not_duplicate_people(reference):
    _,people,_,_=reference
    people[-1]['existingAthleteId']=100
    duplicate={**people[-1],'matchKey':'another-source','quotaDisciplines':['Ski Cross','Ski Cross']}
    people.append(duplicate)
    nation=overview(reference)['nations'][0]
    assert nation['peopleTotal']==24 and nation['officials']==14


def test_counts_are_order_independent_and_inputs_unchanged(reference):
    before=deepcopy(reference[1:]);first=overview(reference)
    assert reference[1:]==before
    reference[1].reverse()
    assert overview(reference)==first


def test_cross_family_membership_is_not_added_to_nation_total(reference):
    _,people,_,families=reference
    people[0]['quotaDisciplines'].append('Snowboard Cross')
    families.append({**families[0],'topLevelDiscipline':'Snowboard','athleteQuotaUsed':1})
    nation=overview(reference)['nations'][0]
    assert nation['athletes']==10 and len(nation['athleteFamilies'])==2


def test_unknown_and_other_population_is_explicit(reference):
    _,people,_,_=reference
    people.append(dict(matchKey='other',nationCode='ITA',function='Unmapped source function',gender='M',quotaDisciplines=[]))
    nation=overview(reference)['nations'][0]
    assert (nation['peopleInQuotaGroups'],nation['peopleTotal'],nation['otherPeople'])==(24,25,1)
    assert nation['officialsWithoutContext']==1


def test_no_athlete_allowance_context_is_not_silently_covered(reference):
    _,people,_,_=reference
    people.append(dict(matchKey='uncovered-context',nationCode='ITA',function='NSA Technician',gender='W',quotaDisciplines=['Other group']))
    nation=overview(reference)['nations'][0]
    assert nation['officialsWithoutContext']==1 and nation['coverageReviewRequired']


@pytest.mark.parametrize('world_championship',[True,False])
def test_event_revision_and_nation_isolation(reference,world_championship):
    event,people,_,_=reference;event.is_world_championship=world_championship
    people.append(dict(matchKey='foreign',eventId=8,nationCode='ITA',function='Athlete',gender='M',quotaDisciplines=[]))
    people.append(dict(matchKey='local-other-nation',eventId=7,nationCode='JPN',function='Athlete',gender='M',quotaDisciplines=[]))
    result=overview(reference)
    assert result['event']['isWorldChampionship']==world_championship and result['event']['rulesRevision']==3
    assert [n['peopleTotal'] for n in result['nations']]==[24,1]


def test_approval_extents_are_not_added_as_distinct_people(reference):
    _,_,checks,families=reference
    families[0].update(decisionStatus='PENDING',approvedExtent=dict(total=2,M=1,F=1),uncoveredExtent=dict(total=2,M=0,F=0))
    checks[0].update(singleRoomsPending=2,singleRoomsApproved=1)
    nation=overview(reference)['nations'][0]
    assert nation['athletesApprovedDistinct'] is None
    assert nation['athleteDecisionsOpen']==1 and nation['ezDecisionsOpen']==1
    assert nation['peopleTotal']==24
    assert nation['groups'][0]['totals']['singleRoomsApproved']==1


def test_unknown_gender_and_missing_identity_are_visible(reference):
    _,people,_,_=reference
    people[0]['gender']='X';people[1].pop('matchKey')
    assert overview(reference)['nations'][0]['incomplete']


def test_ez_approval_exemption_and_explicit_false_remain_unchanged(reference):
    event,people,_,families=reference
    people[-1].update(countsAsSingle=True,singleRoomStatus='APPROVED_EXTRA',approvedQuotaContexts=[{'nationCode':'ITA','discipline':'Ski Cross','gender':'M'}])
    people[0].update(countsAsSingle=True,singleRoomQuotaExemptReason='WORLD_CHAMPION')
    people[1].update(countsAsSingle=False)
    rules=standard_rules();before=evaluate_quota_usage(people,people,rules)
    build_quota_overview(people,[dict(nationCode=r['nationCode'],discipline=r['discipline'],gender=r['gender'],athletes=r['athletesEntered'],officialQuota=r['officialQuota'],singleRoomsAllowed=r['singleRoomsAllowed'],singleRoomsRequested=r['singleRoomsUsed']) for r in before],families,event)
    assert evaluate_quota_usage(people,people,rules)==before
    assert people[1]['countsAsSingle'] is False and people[-1]['singleRoomStatus']=='APPROVED_EXTRA'


def test_conflicting_function_evidence_is_not_arbitrarily_classified(reference):
    _,people,_,_=reference
    people[-1]['existingAthleteId']=123
    people.append({**people[-1],'function':'Athlete'})
    before=overview(reference)
    people.reverse()
    assert overview(reference)==before
    assert before['nations'][0]['incomplete'] and before['nations'][0]['otherPeople']==1


from test_import_event_identity import events

@pytest.mark.explicit_event_ownership
def test_preview_approval_confirm_and_reimport_keep_current_overview_and_plan(events,monkeypatch):
    import json
    from app import app
    from models import db,ImportSession
    from test_safe_reimport import upload,run
    a,_=events
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',str(a.id))
    first=upload(a)
    assert first['quotaOverview']['nations'][0]['athletes']==2
    session=db.session.get(ImportSession,int(first['session']['id']))
    original=session.current_version.preview_json
    detail=app.test_client().get(f'/api/import/sessions/{session.id}')
    assert detail.status_code==200 and detail.json['preview']['planStale'] is False
    assert session.current_version.preview_json==original
    assert detail.json['preview']['quotaOverview']==first['quotaOverview']
    assert run(first,a)['summary']['peopleCreated']==2
    repeated=upload(a)
    assert repeated['quotaOverview']['nations'][0]['athletes']==2
    assert run(repeated,a)['summary']['peopleCreated']==0
