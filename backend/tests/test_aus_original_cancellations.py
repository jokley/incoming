"""Optional, unmodified AUS originals; no private workbook contents in the repository."""
import io
import os
from pathlib import Path
import pandas as pd
import pytest
from test_import_event_identity import events
from test_partial_nation_snapshots import owner
from test_safe_reimport import run,review
from app import app
from models import db,Athlete

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


@pytest.fixture
def original_files():
    files=[Path(os.environ.get(name,'')) for name in ('AUS_ENTRIES_FILE','AUS_ROOMS_FILE')]
    if not all(p.is_file() for p in files):pytest.skip('AUS originals require AUS_ENTRIES_FILE and AUS_ROOMS_FILE')
    return files


def send(owner,files,entries_bytes=None):
    entries,rooms=files
    response=app.test_client().post('/api/import/fis/preview',data={'eventId':str(owner.id),'createSession':'true',
        'entriesList':(io.BytesIO(entries.read_bytes() if entries_bytes is None else entries_bytes),entries.name),
        'roomListDetailed':(io.BytesIO(rooms.read_bytes()),rooms.name)})
    assert response.status_code==200, response.json.get('error')
    return response.json


def test_original_empty_import_and_identical_reimport(owner,original_files):
    entries,rooms=original_files
    df=pd.read_excel(entries,sheet_name='Data');room=pd.read_excel(rooms,sheet_name='Data')
    assert len(df)==61 and len(room)==26
    assert df['Present'].value_counts().to_dict()=={'YES':60,'CANCELLED':1}
    assert (df['Accredid']==0).sum()==40
    assert df['Competitorid/Staff ID'].nunique()==61
    payload=send(owner,original_files)
    assert len(payload['people'])==60 and payload['summary']['people']['total']==60
    assert len(payload['cancelledPeople'])==1 and not payload['errors']
    result=run(payload,owner);assert result['summary']['peopleCreated']==60
    assert Athlete.query.count()==60
    ids={p.id for p in Athlete.query.all()}
    again=send(owner,original_files);result=run(again,owner)
    assert result['summary']['peopleCreated']==0 and Athlete.query.count()==60
    assert {p.id for p in Athlete.query.all()}==ids


def test_original_corrects_legacy_61_person_seed_with_review(owner,original_files,monkeypatch):
    entries,_=original_files
    data=pd.read_excel(entries,sheet_name='Data');cancelled=data.loc[data['Present']=='CANCELLED'].iloc[0]
    # Emulate only the old presence bug; both uploads use the exact original bytes.
    import excel_import
    parser=excel_import.parse_entries_list
    def old_presence(frame,*args,**kwargs):
        before=frame.copy()
        before.loc[before['Present']=='CANCELLED','Present']='YES'
        parsed=parser(before,*args,**kwargs)
        for person in parsed['people']:
            if person.get('competitorId')==str(cancelled['Competitorid/Staff ID']):person['present']=False
        return parsed
    with monkeypatch.context() as legacy:
        legacy.setattr(excel_import,'parse_entries_list',old_presence)
        old=send(owner,original_files);run(old,owner)
    assert Athlete.query.count()==61
    old_person=Athlete.query.filter_by(competitor_id=str(cancelled['Competitorid/Staff ID'])).one()
    old_id=old_person.id
    current=send(owner,original_files)
    assert current['knownFiles'] is True
    assert len(current['people'])==60
    removed=current['changePlan']['people']['remove']
    assert len(removed)==1 and removed[0]['personId']==old_id and 'CANCELLED' in removed[0]['removalReason']
    assert review(current,owner).status_code==409
    assert db.session.get(Athlete,old_id) is not None
    result=run(current,owner,True)
    assert result['summary']['peopleRemoved']==1 and Athlete.query.count()==60
    assert db.session.get(Athlete,old_id) is None


def test_original_conflict_diagnoses_a_controlled_existing_id_disagreement(owner,original_files):
    payload=send(owner,original_files);run(payload,owner)
    person=Athlete.query.filter(Athlete.fis_code.isnot(None)).order_by(Athlete.id).first()
    assert person is not None
    person.competitor_id='different-existing-staff-id';db.session.commit()
    entries,rooms=original_files
    response=app.test_client().post('/api/import/fis/preview',data={'eventId':str(owner.id),'createSession':'true',
        'entriesList':(io.BytesIO(entries.read_bytes()),entries.name),'roomListDetailed':(io.BytesIO(rooms.read_bytes()),rooms.name)})
    assert response.status_code==422
    details=response.json['details']
    assert response.json['error']=='IMPORT_IDENTITY_CONFLICT'
    assert details['matchedBy']==['fisCode'] and details['conflictingIdentifiers']==['competitorId']
    assert details['candidateIds']==[person.id] and details['incoming']['row']>=2
    assert person.competitor_id=='different-existing-staff-id' and Athlete.query.count()==60
