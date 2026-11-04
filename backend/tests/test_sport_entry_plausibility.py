"""Numerical display evidence, never sporting approval or import validation."""
from copy import deepcopy
from types import SimpleNamespace as NS
import pytest
import os
from test_support import postgres_test_url
# Shared autouse fixtures initialize the application even for pure projections.
os.environ['DATABASE_URL'] = postgres_test_url()
from sport_entry_plausibility import project_entries
from test_import_event_identity import events


def catalogue(codes=None):
    from competitions import COMPETITIONS
    definitions=[d for d in COMPETITIONS if codes is None or d.code in codes]
    if codes is not None:
        definitions=sorted(definitions,key=lambda d:codes.index(d.code))
    return {i:NS(id=i,active=True,**d._asdict()) for i,d in enumerate(definitions,1)}


def event_for(comps):
    return NS(id=77,is_world_championship=True,year=2027,quota_rules_json=None,
        quota_rules_fixed_at=True,competition_mappings=[NS(competition_id=i,event_id=77,active=True) for i in comps])


def setup_case(count=5):
    comps=catalogue(['6188','6182','6174'])
    people=[dict(matchKey=f'p{i}',fisCode=str(100+i),nationCode='X',gender='M',function='Athlete',
        competitionMemberships=[{'competitionId':1},{'competitionId':2}],singleRoomQuotaExemptReason='WORLD_CHAMPION') for i in range(count)]
    title=dict(fisCode='100',nation='X',gender='M',discipline='SS',eventGroup='Snowboard Park & Pipe',
        championship='Engadin',championshipYear=2025,titleType='INDIVIDUAL',entitlementEnabled=True,sourceVerified=True,source='https://example.test/fis-result')
    return people,comps,event_for(comps),title


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
    comps = catalogue(['6170','6177','6180']);event=event_for(comps)
    for person in people:
        person['competitionMemberships'].append({'competitionId': 3})
    title.update(discipline='PGS', eventGroup='Snowboard Alpine')
    before = deepcopy(people)
    view = project_entries(people + [deepcopy(people[0])], comps, event, [title])
    assert set(view) == {'1', '2', '3'}
    assert view['3'][0]['status']=='TEAM_RULE' and view['3'][0]['regularMax'] is None
    assert view['1'][0]['reported'] == view['2'][0]['reported'] == count
    assert view['1'][0]['championStarters'] == 1
    assert view['1'][0]['unverifiedAdditional'] == remaining
    assert view['2'][0]['championStarters'] == 0
    assert view['2'][0]['unverifiedAdditional'] == max(0, count - 4)
    assert all(row[0]['sharedPoolReported'] is None for row in view.values())
    assert people == before


def participants(comp_ids, count, gender='M', nation='X', base=100):
    return [dict(matchKey=f'{nation}-{base+i}',fisCode=str(base+i),nationCode=nation,gender=gender,function='Athlete',
                 competitionMemberships=[{'competitionId':cid} for cid in comp_ids]) for i in range(count)]


from competitions import COMPETITIONS, competition_title_discipline
INDIVIDUAL_CODES=[d.code for d in COMPETITIONS if not d.team_competition]
TEAM_CODES=[d.code for d in COMPETITIONS if d.team_competition]


@pytest.mark.parametrize('code',INDIVIDUAL_CODES)
@pytest.mark.parametrize('count,status',[(3,'NUMERIC_OK'),(4,'NUMERIC_OK'),(5,'REVIEW_REQUIRED')])
def test_every_individual_uses_four_medal_starters_not_five_training_places(code,count,status):
    comps=catalogue();comp=next(c for c in comps.values() if c.code==code)
    people=participants([comp.id],count,comp.gender)
    before=deepcopy(people);view=project_entries(people,comps,event_for(comps),[])
    row=view[str(comp.id)][0]
    assert (row['reported'],row['regularMax'],row['status'])==(count,4,status)
    assert row['allocationConfirmed'] is False and people==before


@pytest.mark.parametrize('code',INDIVIDUAL_CODES)
def test_every_individual_reuses_only_exact_personal_title_evidence(code):
    comps=catalogue();comp=next(c for c in comps.values() if c.code==code)
    people=participants([comp.id],5,comp.gender)
    title=setup_case()[3]
    title.update(gender=comp.gender,discipline=competition_title_discipline(comp),eventGroup=comp.quota_discipline)
    before=deepcopy((people,title))
    row=project_entries(people,comps,event_for(comps),[title,deepcopy(title)])[str(comp.id)][0]
    assert row['status']=='TITLE_COVERED' and row['championStarters']==1
    assert row['unverifiedAdditional']==0 and (people,title)==before
    title['discipline']='INVALID'
    assert project_entries(people,comps,event_for(comps),[title])[str(comp.id)][0]['status']=='REVIEW_REQUIRED'


@pytest.mark.parametrize('code',TEAM_CODES)
def test_all_five_teams_are_neutral_without_an_individual_limit(code):
    comps=catalogue();comp=next(c for c in comps.values() if c.code==code)
    people=participants([comp.id],9)
    row=project_entries(people,comps,event_for(comps),[])[str(comp.id)][0]
    assert row['status']=='TEAM_RULE' and row['regularMax'] is None
    assert row['reported']==9 and row['aboveRegular']==0 and row['champions']==[]
    assert 'Teamregel' in row['reason']


@pytest.mark.explicit_event_ownership
@pytest.mark.quota_rule_lifecycle
def test_active_event_mapping_completeness_against_every_current_definition(events):
    """A new mapped catalogue individual without proven metadata must fail this test."""
    from models import Competition
    owner,_=events;owner.is_world_championship=True;owner.year=2027
    comps={c.id:c for c in Competition.query.all()}
    people=participants([],1)
    view=project_entries(people,comps,owner,[])
    active={m.competition_id for m in owner.competition_mappings if m.active and comps[m.competition_id].active}
    assert set(view)=={str(cid) for cid in active}
    individuals=[cid for cid in active if not comps[cid].team_competition]
    assert len(individuals)==26 and len(active)-len(individuals)==5
    assert all(view[str(cid)][0]['regularMax']==4 and view[str(cid)][0]['status']=='NUMERIC_OK' for cid in individuals)
    assert all(competition_title_discipline(comps[cid]) for cid in individuals)


@pytest.mark.parametrize('codes',[['6170','6177'],['8179','8186'],['6188','6182'],['8196','8178']])
def test_multistarts_and_duplicate_sources_count_one_person_per_competition(codes):
    comps=catalogue();ids=[c.id for c in comps.values() if c.code in codes]
    people=participants(ids,4);duplicate=deepcopy(people[0]);duplicate['matchKey']='another-source'
    view=project_entries(people+[duplicate],comps,event_for(comps),[])
    assert all(view[str(cid)][0]['reported']==4 for cid in ids)
    assert all(view[str(cid)][0]['status']=='NUMERIC_OK' for cid in ids)


def test_distinct_ss_ba_pool_and_double_title_never_duplicate_the_personal_place():
    comps=catalogue();ss=next(c for c in comps.values() if c.code=='6188');ba=next(c for c in comps.values() if c.code=='6182')
    people=participants([ss.id],4)+participants([ba.id],4,base=200)
    view=project_entries(people,comps,event_for(comps),[])
    for comp in (ss,ba):
        row=view[str(comp.id)][0]
        assert row['reported']==4 and row['aboveRegular']==0
        assert row['sharedPoolReported']==8 and row['sharedPoolUnverifiedAdditional']==4
        assert row['status']=='REVIEW_REQUIRED' and len(row['poolPersonKeys'])==8
    people=participants([ss.id,ba.id],5)
    title=setup_case()[3];second={**title,'discipline':'BA'}
    view=project_entries(people,comps,event_for(comps),[title,second,title])
    for comp in (ss,ba):
        row=view[str(comp.id)][0]
        assert row['status']=='TITLE_COVERED' and row['sharedPoolChampionStarters']==1
        assert row['sharedPoolReported']==5 and row['sharedPoolUnverifiedAdditional']==0


def test_mixed_sports_and_genders_keep_their_own_pools_and_exact_titles():
    comps=catalogue();sb=next(c for c in comps.values() if c.code=='6188');fs=next(c for c in comps.values() if c.code=='8196')
    people=participants([sb.id,fs.id],5)
    title=setup_case()[3]
    view=project_entries(people,comps,event_for(comps),[title])
    assert view[str(sb.id)][0]['status']=='TITLE_COVERED'
    assert view[str(fs.id)][0]['status']=='REVIEW_REQUIRED' and view[str(fs.id)][0]['sharedPoolReported']==5
    assert view[str(sb.id)][0]['sharedPoolChampionStarters']==1
    assert view[str(fs.id)][0]['sharedPoolChampionStarters']==0


@pytest.mark.parametrize('defect',['mapping','inactive','metadata','gender','identity','foreign-event'])
def test_uncertain_mapping_or_person_facts_cannot_turn_green(defect):
    people,comps,event,title=setup_case(4)
    if defect=='mapping':event.competition_mappings=[m for m in event.competition_mappings if m.competition_id!=1]
    elif defect=='inactive':comps[1].active=False
    elif defect=='metadata':comps[1].sport='Freestyle Ski'  # Display name remains identical.
    elif defect=='gender':people[0]['gender']='?'
    elif defect=='identity':people[0].pop('matchKey')
    else:event.competition_mappings[0].event_id=99
    row=project_entries(people,comps,event,[title])['1'][0]
    assert row['status']=='INCOMPLETE' and row['regularMax'] is None
    assert row['championStarters']==0


def configure(event, comp_id, **changes):
    rule=dict(competitionId=str(comp_id),enabled=True,regularLimit=4,titleReferences=[],poolId=None)
    rule.update(changes)
    config=dict(schemaVersion=1,enabled=True,titleEdition={'championship':'Engadin','year':2025},competitions=[rule],pools=[])
    event.quota_rules_json=__import__('json').dumps({'sportEntryRules':config})
    return config


def test_fixed_existing_config_is_read_without_writing_or_activating_anything():
    people,comps,event,title=setup_case()
    configure(event,1,titleReferences=[title])
    raw=event.quota_rules_json;before=deepcopy(people)
    assert project_entries(people,comps,event,[])['1'][0]['status']=='TITLE_COVERED'
    assert event.quota_rules_json==raw and people==before
    event.quota_rules_fixed_at=None
    assert project_entries(people,comps,event,[title])['1'][0]['status']=='INCOMPLETE'


@pytest.mark.parametrize('change',[{'enabled':False},{'regularLimit':5},{'regularLimit':3},{'regularLimit':True}])
def test_disabled_or_unproven_configured_limit_is_not_a_fis_green(change):
    people,comps,event,title=setup_case(3)
    configure(event,1,**change)
    assert project_entries(people,comps,event,[title])['1'][0]['status']=='INCOMPLETE'


def test_global_switch_pool_validation_and_missing_config_fallback():
    import json
    people,comps,event,title=setup_case()
    config=configure(event,1);config['enabled']=False
    event.quota_rules_json=json.dumps({'sportEntryRules':config})
    assert project_entries(people,comps,event,[title])['1'][0]['status']=='INCOMPLETE'
    config['enabled']=True;config['competitions'][0]['poolId']='shared';config['pools']=[dict(id='shared',regularLimit=4)]
    event.quota_rules_json=json.dumps({'sportEntryRules':config})
    view=project_entries(people,comps,event,[title])
    assert view['1'][0]['status']==view['2'][0]['status']=='INCOMPLETE'
    config['competitions'].append(dict(competitionId='2',enabled=True,regularLimit=4,titleReferences=[],poolId='shared'))
    event.quota_rules_json=json.dumps({'sportEntryRules':config})
    assert project_entries(people,comps,event,[title])['2'][0]['status']=='REVIEW_REQUIRED'
    assert project_entries(people,comps,event,[title])['3'][0]['regularMax']==4  # Belegter Standard für fehlende Einzelregel.


def test_title_has_to_be_https_and_no_sport_projection_changes_import_fingerprints():
    from imports.change_plan import input_fingerprint
    people,comps,event,title=setup_case()
    preview=dict(people=people,rooms=[],replacementScope={'kind':'SPORT_FAMILY','family':'Snowboard'})
    before=input_fingerprint(preview)
    title['source']='https://'
    assert project_entries(people,comps,event,[title])['1'][0]['status']=='REVIEW_REQUIRED'
    assert input_fingerprint(preview)==before


@pytest.mark.parametrize('code',INDIVIDUAL_CODES)
def test_existing_verified_title_catalogue_covers_each_individual_without_ez_status(code):
    from sport_entry_plausibility import verified_titles
    comps=catalogue();comp=next(c for c in comps.values() if c.code==code)
    title=next(t for t in verified_titles() if t.get('titleType')=='INDIVIDUAL'
        and t['discipline']==competition_title_discipline(comp) and t['eventGroup']==comp.quota_discipline
        and t['gender']==comp.gender)
    people=participants([comp.id],5,comp.gender,title['nation'])
    people[0]['fisCode']=title['fisCode']
    row=project_entries(people,comps,event_for(comps))[str(comp.id)][0]
    assert row['status']=='TITLE_COVERED' and row['championStarters']==1
    assert all('singleRoomQuotaExemptReason' not in person for person in people)


@pytest.mark.parametrize('missing_id',[False,True])
def test_unresolvable_configured_competition_is_incomplete_without_hiding_other_rows(missing_id):
    import json
    people,comps,event,title=setup_case(4)
    config=configure(event,999)
    if missing_id:config['competitions'][0].pop('competitionId')
    event.quota_rules_json=json.dumps({'sportEntryRules':config})
    rows=project_entries(people,comps,event,[title])
    assert set(rows)=={'1','2','3'}
    assert all(row['status']=='INCOMPLETE' and row['regularMax'] is None for values in rows.values() for row in values)
