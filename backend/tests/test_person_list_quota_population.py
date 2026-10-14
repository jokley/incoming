"""Regression from the uploaded AUS Freestyle Entries/Room List pair."""
from collections import Counter
from copy import deepcopy

from test_real_workbook_import import database, preview
from models import Athlete, db
import excel_import as imports
from quota_service import evaluate_quota_usage


COMPOSITION = {'Athlete':22, 'NSA Coach':12, 'NSA Guest':10,
               'NSA Professional':8, 'NSA Medical':6, 'NSA Media':2, 'NSA President':1}


def test_reported_population_is_persisted_and_returned_as_distinct_people(database,monkeypatch):
    _,event=database
    result=preview('AUS_FREESTYLE',event,monkeypatch)
    assert not result['errors']
    expected={'Freeski Park & Pipe':(3,3,27),'Freestyle':(5,8,33),'Ski Cross':(2,1,26)}
    for group,(men,women,officials) in expected.items():
        checks=[q for q in result['quotaChecks'] if q['discipline']==group]
        assert {(q['gender'],q['athletes'],q['officials']) for q in checks}=={('M',men,officials),('W',women,officials)}
    # Repeating one multi-competition person must not multiply either context.
    people=imports.PREVIEW_STORE[result['previewToken']]['people']
    staff=[p for p in people if p['function']!='Athlete']
    assert len(staff)==39 and all(p['forGender']=='A' for p in staff)
    assert len({p['competitorId'] for p in staff})==39
    assert all(p['accredId'] in {'0','0.0'} for p in staff)
    repeated=[*people,deepcopy(next(p for p in people if p['function']!='Athlete'))]
    usage=evaluate_quota_usage(repeated,repeated)
    for group,(_,_,officials) in expected.items():
        assert [q['assignedOfficials'] for q in usage if q['discipline']==group]==[officials,officials]
    imports.confirm_fis_import(result['previewToken'])
    assert Athlete.query.count()==61
    assert Counter(a.function for a in Athlete.query.all())==COMPOSITION
    from routes.athletes import get_athletes
    persons=get_athletes().get_json()
    assert len(persons)==len({p['id'] for p in persons})==61
    assert Counter(p['function'] for p in persons)==COMPOSITION
    assert len([p for p in persons if p['function']!='Athlete'])==39
    assert all(len(p['competitions'])>=2 for p in persons if p['function']!='Athlete')
    # Accommodation and repeated imports stay person-based, despite memberships.
    from app import _build_room_booking_units
    units,_=_build_room_booking_units()
    assert sum(unit['occupantCount'] for unit in units)==61
    again=preview('AUS_FREESTYLE',event,monkeypatch)
    confirmed=imports.confirm_fis_import(again['previewToken'])
    assert confirmed['summary']['peopleCreated']==0
    assert confirmed['summary']['peopleUpdated']==61
    assert confirmed['summary']['duplicatesRemoved']==0
    assert Athlete.query.count()==61


def test_existing_aus_workbook_staff_survive_import_and_person_read(database,monkeypatch):
    _,event=database
    result=preview('AUS',event,monkeypatch)
    imports.confirm_fis_import(result['previewToken'])
    from routes.athletes import get_athletes
    people=get_athletes().get_json()
    assert len(people)==len({p['id'] for p in people})==58
    assert len([p for p in people if p['function']=='Athlete'])==19
    assert len([p for p in people if p['function']!='Athlete'])==39


def test_reimport_restores_staff_lost_to_zero_accreditation_cleanup(database,monkeypatch):
    _,event=database
    result=preview('AUS_FREESTYLE',event,monkeypatch)
    imports.confirm_fis_import(result['previewToken'])
    staff=Athlete.query.filter(Athlete.function!='Athlete').order_by(Athlete.id).all()
    # Reproduce the persisted population left by the old duplicate cleanup.
    assert imports._remove_athletes(staff[1:])==38
    db.session.commit()
    assert Athlete.query.count()==23
    result=preview('AUS_FREESTYLE',event,monkeypatch)
    summary=imports.confirm_fis_import(result['previewToken'])['summary']
    assert summary['peopleCreated']==38
    assert summary['duplicatesRemoved']==0
    from routes.athletes import get_athletes
    people=get_athletes().get_json()
    assert len(people)==len({p['id'] for p in people})==61
    assert Counter(p['function'] for p in people)==COMPOSITION
