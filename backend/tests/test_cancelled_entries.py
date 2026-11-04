"""Explicit cancellations reuse reviewed scope, membership and deletion safeguards."""
import copy
import io
import json
import os
from pathlib import Path
import pandas as pd
import pytest
from test_import_event_identity import events
from test_partial_nation_snapshots import owner, rows, upload, compose, snapshot
from test_safe_reimport import run, review, booking
from app import app
from models import db,Athlete,ImportSession,ImportApproval,RoomBooking,RoomBookingOccupant,Competition
from imports.change_plan import input_fingerprint
from imports.identity import _build_existing_athlete_maps,_find_existing_athlete
from imports.event_context import ImportValidationError

pytestmark=[pytest.mark.explicit_event_ownership,pytest.mark.quota_rule_lifecycle]


def cancelled_rows():
    data=rows('SB')
    for p in data:p['Present']='YES'
    data[0]['Present']='CANCELLED'
    return data


def test_cancelled_new_person_is_excluded_from_all_active_projections(owner):
    payload=upload(owner,'SB',data=cancelled_rows())
    assert len(payload['people'])==3 and payload['summary']['people']['total']==3
    assert len(payload['cancelledPeople'])==1
    assert all(p['firstname']!='SyntheticSB0' for p in payload['people'])
    assert all(p['firstname']!='SyntheticSB0' for p in payload.get('evaluationPeople',[]))
    assert len(payload['changePlan']['people']['create'])==3
    result=run(payload,owner);assert result['summary']['peopleCreated']==3
    assert Athlete.query.filter_by(firstname='SyntheticSB0').count()==0


def test_cancelled_existing_person_requires_confirmation_and_preserves_survivor_booking(owner):
    first=upload(owner,'SB');run(first,owner)
    target=Athlete.query.filter_by(firstname='SyntheticSB0').one();target_id=target.id
    survivor=Athlete.query.filter_by(firstname='SyntheticSB1').one()
    room=booking([target,survivor]);room_id=room.id
    approval=ImportApproval(session_id=int(first['session']['id']),version_id=int(first['session']['currentVersionId']),nation='ARG',username='test-admin',approval_type='NATION_APPROVED',description='Historical',decision='APPROVED')
    db.session.add(approval);db.session.commit();approval_id=approval.id
    payload=upload(owner,'SB',data=cancelled_rows())
    plan=payload['changePlan'];assert plan['requiresDestructiveConfirmation']
    assert plan['people']['remove'][0]['personId']==target_id
    assert plan['people']['remove'][0]['removalReason']=='Stornierte Meldung (Present = CANCELLED)'
    assert review(payload,owner).status_code==409
    assert db.session.get(Athlete,target_id) is not None
    result=run(payload,owner,True);assert result['summary']['peopleRemoved']==1
    assert db.session.get(Athlete,target_id) is None
    assert db.session.get(RoomBooking,room_id) is not None
    assert RoomBookingOccupant.query.filter_by(room_booking_id=room_id).count()==1
    assert db.session.get(ImportApproval,approval_id) is not None
    again=upload(owner,'SB',data=cancelled_rows());run(again,owner)
    assert Athlete.query.count()==3


def test_sb_cancellation_withdraws_only_sb_memberships_of_a_shared_person(owner):
    sb=upload(owner,'SB');run(sb,owner)
    data=rows('FS')
    for field in ('Firstname','Lastname','Fiscode','Competitorid/Staff ID'):data[0][field]=rows('SB')[0][field]
    fs=upload(owner,'FS',data=data);run(fs,owner)
    target=Athlete.query.filter_by(firstname='SyntheticSB0').one();target_id=target.id
    fs_ids={c.id for c in target.competitions if c.import_code.startswith('WSC_HP_M_8')}
    assert fs_ids
    payload=upload(owner,'SB',data=cancelled_rows())
    assert not payload['changePlan']['people']['remove']
    assert payload['changePlan']['memberships']['remove']
    assert all('CANCELLED' in p['reason'] for p in payload['changePlan']['memberships']['remove'])
    assert review(payload,owner).status_code==409
    run(payload,owner,True)
    assert {c.id for c in db.session.get(Athlete,target_id).competitions}==fs_ids
    assert Athlete.query.count()==10


def test_unmapped_legacy_cancellation_requires_confirmed_source_provenance(owner):
    data=rows('SB');data[0]['WSC_HP_M_6174']='';data[0]['Function']='NSA Coach'
    first=upload(owner,'SB',data=data);run(first,owner)
    target=Athlete.query.filter_by(firstname='SyntheticSB0').one();assert not target.competitions
    data[0]['Present']='CANCELLED'
    payload=upload(owner,'SB',data=data)
    assert payload['changePlan']['people']['remove'][0]['personId']==target.id
    run(payload,owner,True);assert Athlete.query.count()==3


def test_unmapped_person_without_import_proof_is_not_deleted_by_partial_cancellation(owner):
    data=cancelled_rows()
    target=Athlete(event_id=owner.id,firstname=data[0]['Firstname'],lastname=data[0]['Lastname'],nation_code='ARG',fis_code=data[0]['Fiscode'],competitor_id=data[0]['Competitorid/Staff ID'])
    db.session.add(target);db.session.commit()
    response=upload(owner,'SB',data=data,expected=422)
    assert response['error']=='IMPORT_SNAPSHOT_SCOPE_REQUIRED'
    assert Athlete.query.count()==1


def test_only_cancelled_file_still_requires_review_and_preserves_other_family(owner):
    sb=upload(owner,'SB');run(sb,owner);fs=upload(owner,'FS');run(fs,owner)
    fs_saved=snapshot(Athlete.query.filter(Athlete.firstname.like('SyntheticFS%')).all())
    data=[{**p,'Present':'CANCELLED'} for p in rows('SB')]
    payload=upload(owner,'SB',data=data)
    assert payload['people']==[] and payload['summary']['people']['total']==0
    assert len(payload.get('evaluationPeople',[]))==7
    assert len(payload['changePlan']['people']['remove'])==4
    assert review(payload,owner).status_code==409
    run(payload,owner,True)
    assert Athlete.query.count()==7
    assert snapshot(Athlete.query.all())==fs_saved


def test_cancellation_evidence_is_fingerprinted_and_legacy_hash_is_unchanged(owner):
    payload=upload(owner,'SB',data=cancelled_rows())
    session=db.session.get(ImportSession,int(payload['session']['id']))
    parsed=json.loads(session.current_version.preview_json)
    before=input_fingerprint(parsed)
    parsed['cancelledPeople'][0]['competitorId']='changed'
    assert input_fingerprint(parsed)!=before
    current=json.loads(session.current_version.preview_json)
    current['cancelledPeople'][0]['competitorId']='changed'
    session.current_version.preview_json=json.dumps(current);db.session.commit()
    assert review(payload,owner).status_code==409


def test_identity_diagnostics_preserve_strong_id_and_exact_name_conflicts(owner):
    row=rows('SB')[0]
    p=Athlete(event_id=owner.id,firstname=row['Firstname'],lastname=row['Lastname'],nation_code='ARG',fis_code=row['Fiscode'],competitor_id='old-staff')
    db.session.add(p);db.session.commit()
    response=upload(owner,'SB',expected=422)
    assert response['error']=='IMPORT_IDENTITY_CONFLICT'
    assert response['details']['matchedBy']==['fisCode']
    assert response['details']['conflictingIdentifiers']==['competitorId']
    assert response['details']['candidates'][0]['id']==p.id
    assert response['details']['incoming']['row']==2
    assert row['Fiscode'] in response['message'] and 'old-staff' in response['message']
    assert p.competitor_id=='old-staff'
    # Disjoint strong identifiers plus exact same name are a review case, never a merge.
    p.fis_code='9999001';db.session.commit()
    response=upload(owner,'SB',expected=422)
    assert response['details']['matchedBy']==['name']
    assert set(response['details']['conflictingIdentifiers'])=={'fisCode','competitorId'}


@pytest.mark.parametrize('status',['NO','',None])
def test_non_cancelled_presence_values_keep_existing_semantics(owner,status):
    data=[{**p,'Present':status} for p in rows('SB')]
    assert len(upload(owner,'SB',data=data)['people'])==4


def test_composed_review_keeps_cancellation_and_replaces_only_its_memberships(owner):
    sb=upload(owner,'SB');run(sb,owner)
    fs_data=rows('FS')
    for field in ('Firstname','Lastname','Fiscode','Competitorid/Staff ID'):fs_data[0][field]=rows('SB')[0][field]
    upload(owner,'FS',data=fs_data)
    latest=upload(owner,'SB',data=cancelled_rows())
    combined=compose(latest,owner);assert combined.status_code==200
    current=combined.json
    assert len(current['preview']['cancelledPeople'])==1
    assert len(current['preview']['people'])==10
    run({'session':current},owner,True)
    assert Athlete.query.count()==10
    person=Athlete.query.filter_by(firstname='SyntheticSB0').one()
    assert all(c.import_code.startswith('WSC_HP_M_8') for c in person.competitions)


def test_unimported_source_is_not_proof_for_deleting_an_unmapped_person(owner):
    data=rows('SB');data[0]['WSC_HP_M_6174']='';data[0]['Function']='NSA Coach'
    upload(owner,'SB',data=data)
    p=Athlete(event_id=owner.id,firstname=data[0]['Firstname'],lastname=data[0]['Lastname'],nation_code='ARG',fis_code=data[0]['Fiscode'],competitor_id=data[0]['Competitorid/Staff ID'])
    db.session.add(p);db.session.commit()
    data[0]['Present']='CANCELLED'
    result=upload(owner,'SB',data=data,expected=422)
    assert result['error']=='IMPORT_SNAPSHOT_SCOPE_REQUIRED'
    assert Athlete.query.count()==1


def test_legacy_preview_without_cancellation_metadata_retains_its_input_fingerprint():
    legacy={'people':[],'rooms':[],'replacementScope':{'kind':'SPORT_FAMILY','family':'Snowboard'}}
    assert input_fingerprint(legacy)=='1eda8b20f10cf4a846e0bf49a2f3fef2691496bf5fc3af37ad909cb47f5fce4e'


def test_cancellation_cannot_hide_duplicate_strong_identifiers(owner):
    data=cancelled_rows();data[1]['Competitorid/Staff ID']=data[0]['Competitorid/Staff ID']
    result=upload(owner,'SB',data=data,expected=422)
    assert result['error']=='IMPORT_IDENTITY_CONFLICT'
    assert result['details']['identifier']=='staff' and result['details']['rows']==[3,2]
    assert Athlete.query.count()==0


def test_shared_cancellation_does_not_bypass_existing_approval_protection(owner):
    first=upload(owner,'SB');run(first,owner)
    data=rows('FS')
    for field in ('Firstname','Lastname','Fiscode','Competitorid/Staff ID'):data[0][field]=rows('SB')[0][field]
    fs=upload(owner,'FS',data=data);run(fs,owner)
    target=Athlete.query.filter_by(firstname='SyntheticSB0').one()
    approval=ImportApproval(session_id=int(first['session']['id']),version_id=int(first['session']['currentVersionId']),nation='ARG',username='test-admin',approval_type='NATION_APPROVED',description='Historical protected reference',decision='APPROVED')
    db.session.add(approval);db.session.flush();target.single_room_decision_id=approval.id;db.session.commit()
    saved={c.id for c in target.competitions};decision=approval.to_dict()
    result=upload(owner,'SB',data=cancelled_rows(),expected=422)
    assert result['error']=='IMPORT_SHARED_PERSON_CONFLICT'
    assert {c.id for c in target.competitions}==saved and approval.to_dict()==decision


def test_unmapped_withdrawal_needs_a_current_strong_id_not_only_a_name(owner):
    data=rows('SB');data[0]['WSC_HP_M_6174']='';data[0]['Function']='NSA Coach'
    first=upload(owner,'SB',data=data);run(first,owner)
    data[0].update(Present='CANCELLED',Fiscode=None)
    data[0]['Competitorid/Staff ID']=None
    result=upload(owner,'SB',data=data,expected=422)
    assert result['error']=='IMPORT_SNAPSHOT_SCOPE_REQUIRED'
    assert Athlete.query.count()==4
