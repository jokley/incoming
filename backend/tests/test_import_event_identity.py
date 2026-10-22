"""PR2 isolation acceptance: actual PostgreSQL, two championships, no live data."""
import io
import json
import os
from datetime import date, datetime
from pathlib import Path

import pandas as pd
import pytest

from test_support import configure_test_app, postgres_test_url
os.environ['DATABASE_URL'] = postgres_test_url()
from app import app
from models import (db, Athlete, Event, Competition, EventCompetition, ImportSession,
                    ImportSessionVersion, ImportApproval, RoomBooking, RoomBookingOccupant, Hotel, RoomType)
from competitions import COMPETITIONS
import excel_import as imports
from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
from imports.normalization import canonical_fis_code
from imports.read_context import ImportReadContext
from imports.event_context import ImportValidationError
from quota_history import applicable_approval_groups, approval_event_matches

pytestmark = pytest.mark.explicit_event_ownership


@pytest.fixture
def events(monkeypatch):
    configure_test_app(app)
    monkeypatch.setitem(app.config, 'OPERATIONAL_EVENT_ID', None)
    with app.app_context():
        db.drop_all(); db.create_all()
        a, b = Event(name='Import A'), Event(name='Import B')
        db.session.add_all([a, b]); db.session.flush()
        for definition in COMPETITIONS:
            competition = Competition(**definition._asdict())
            db.session.add(competition); db.session.flush()
            for event in (a, b):
                db.session.add(EventCompetition(event_id=event.id, competition_id=competition.id,
                    import_code=definition.import_code, fis_codex=definition.code, official_name=definition.name))
        db.session.commit()
        yield a, b
        db.session.remove(); db.drop_all()
    imports.PREVIEW_STORE.clear()


def person(event, fis='9300953', staff='00042', **kwargs):
    p = Athlete(event_id=event.id, firstname='Test', lastname='Identity', nation_code='JPN',
                fis_code=fis, competitor_id=staff, **kwargs)
    db.session.add(p); db.session.commit()
    return p


def rows(fis=9300953.0, staff='00042'):
    return pd.DataFrame([{'Lastname': 'Identity', 'Firstname': 'Test', 'Nationcode': 'JPN',
        'Competitorid/Staff ID': staff, 'Fiscode': fis, 'Function': 'Athlete', 'Gender': 'M',
        'Arrival_date': '03.03.2027', 'Departure_date': '09.03.2027', 'Room_type': 'Double shared',
        'WSC_BA_M_6182': 'yes'}])


def preview(event, monkeypatch, data=None):
    monkeypatch.setattr(imports, 'load_first_sheet', lambda path: rows() if path=='entries' and data is None
        else data if path=='entries' else pd.DataFrame(columns=['no data available']).rename_axis('Data'))
    # Preserve the exact empty signature used by the actual workbook parser.
    original = imports.load_first_sheet
    def load(path):
        frame = original(path)
        if path != 'entries': frame.attrs['fisSheetName'] = 'Data'
        return frame
    monkeypatch.setattr(imports, 'load_first_sheet', load)
    return imports.create_fis_import_preview('entries', 'rooms', event)


@pytest.mark.parametrize('raw', [9300953, '9300953', 9300953.0, '9300953.0'])
def test_fis_formats_and_leading_zeroes(raw):
    assert canonical_fis_code(raw) == '9300953'
    assert canonical_fis_code('00930.0') == '00930'


@pytest.mark.parametrize('raw', [True, 9300953.5, '9300953.5', float('inf'), float(2**53), '9.3e6', '-1'])
def test_invalid_fis_not_repaired(raw):
    with pytest.raises(ValueError): canonical_fis_code(raw)


def test_event_scoped_strong_and_name_matching(events):
    a, b = events
    pa, pb = person(a), person(b)
    for event, expected in ((a,pa),(b,pb)):
        maps = _build_existing_athlete_maps(event_id=event.id)
        for incoming in ({'fisCode': '9300953.0'}, {'competitorId':'00042'},
                         {'lastname':'Identity','firstname':'Test','nationCode':'JPN'}):
            assert _find_existing_athlete(incoming, maps).id == expected.id
        assert {p.id for p in ImportReadContext(event.id).athletes} == {expected.id}


def test_alternative_id_and_controlled_enrichment(events):
    a, _ = events
    p=person(a, fis=None)
    incoming={'fisCode':'9300953.0','competitorId':'00042'}
    assert _find_existing_athlete(incoming,_build_existing_athlete_maps(event_id=a.id)) == p


def test_conflicting_and_ambiguous_strong_ids_block(events):
    a, _ = events
    first, second = person(a), person(a, fis='9300954',staff='43')
    with pytest.raises(ImportValidationError,match='verschiedene'):
        _find_existing_athlete({'fisCode':first.fis_code,'competitorId':second.competitor_id},
                               _build_existing_athlete_maps(event_id=a.id))
    person(a, fis='9300953.0',staff='44')
    with pytest.raises(ImportValidationError,match='Mehrdeutiger'):
        _find_existing_athlete({'fisCode':'9300953'},_build_existing_athlete_maps(event_id=a.id))


def test_preview_confirm_reimport_and_preservation_are_event_local(events,monkeypatch):
    a,b=events
    other=person(b,accommodation_requirement='NO_ROOM',accommodation_requirement_source='MANUAL',
                 accommodation_rate_category='SPECIAL',accommodation_rate_source='MANUAL',
                 single_room_quota_exempt_reason='OTHER')
    result=preview(a,monkeypatch)
    assert result['isValid'],result['errors']
    assert result['people'][0]['existingAthleteId'] is None
    assert result['people'][0]['accommodationRateCategory']=='STANDARD'
    assert result['people'][0]['accommodationRequirement']=='REQUIRED'
    assert result['people'][0]['sourceFisCode']=='9300953.0'
    imports.confirm_fis_import(result['previewToken'])
    own=Athlete.query.filter_by(event_id=a.id).one()
    assert own.id != other.id and own.fis_code=='9300953'
    again=preview(a,monkeypatch,rows('9300953'))
    assert again['people'][0]['existingAthleteId']==own.id
    imports.confirm_fis_import(again['previewToken'])
    assert Athlete.query.count()==2
    assert len(own.competitions)==1
    db.session.refresh(other)
    assert (other.accommodation_requirement,other.accommodation_rate_category,other.single_room_quota_exempt_reason)==('NO_ROOM','SPECIAL','OTHER')


def test_missing_snapshot_person_blocked_without_deleting(events,monkeypatch):
    a,b=events
    missing=person(a,fis='9300999',staff='99'); missing.lastname='Absent';db.session.commit();other=person(b)
    result=preview(a,monkeypatch)
    with pytest.raises(ImportValidationError,match='Snapshot-Scope'):
        imports.confirm_fis_import(result['previewToken'])
    db.session.rollback()
    assert db.session.get(Athlete,missing.id) and db.session.get(Athlete,other.id)
    assert Athlete.query.count()==2


def session(event, preview_event=None):
    s=ImportSession(event_id=event.id,nation='JPN');db.session.add(s);db.session.flush()
    v=ImportSessionVersion(session_id=s.id,version=1,preview_json=json.dumps({'eventId': preview_event or event.id,'people':[],'rooms':[]}), uploaded_by='test')
    db.session.add(v);db.session.flush();s.current_version=v;db.session.commit()
    return s


def test_session_approval_and_preview_boundaries(events):
    a,b=events
    sa,sb=session(a),session(b)
    approval=ImportApproval(session_id=sa.id,version_id=sa.current_version_id,nation='JPN',
        approval_type='NATION_APPROVED',description='Test',decision='APPROVED',quota_details_json='{}',username='test')
    db.session.add(approval);db.session.commit()
    assert approval_event_matches(approval,a.id)
    assert not approval_event_matches(approval,b.id)
    client=app.test_client()
    assert client.get(f'/api/import/sessions/{sa.id}?eventId={b.id}').status_code==409
    assert client.get(f'/api/import/approvals/{approval.id}?eventId={b.id}').status_code==409
    assert client.patch(f'/api/import/sessions/{sb.id}/approvals/{approval.id}?eventId={b.id}',json={}).status_code==409
    assert {s['id'] for s in client.get(f'/api/import/sessions?eventId={b.id}').json}=={str(sb.id)}
    sa.current_version.preview_json=json.dumps({'eventId':b.id});db.session.commit()
    assert client.get(f'/api/import/sessions/{sa.id}?eventId={a.id}').status_code==409


def test_foreign_read_context_rejected(events):
    a,b=events
    with pytest.raises(ImportValidationError):
        imports.recalculate_fis_import_preview({'eventId':a.id,'people':[],'rooms':[]},read_context=ImportReadContext(b.id))


def test_real_jpn_pair_twice_in_two_events(events):
    entries=os.environ.get('JPN_ENTRIES_FILE');rooms=os.environ.get('JPN_ROOMS_FILE')
    if not entries or not rooms: pytest.skip('Supply real JPN workbooks via JPN_ENTRIES_FILE/JPN_ROOMS_FILE')
    counts=[]
    for event in events:
        first=imports.create_fis_import_preview(entries,rooms,event)
        assert first['isValid'],first['errors']
        imports.confirm_fis_import(first['previewToken'])
        count=Athlete.query.filter_by(event_id=event.id).count();counts.append(count)
        again=imports.create_fis_import_preview(entries,rooms,event)
        assert again['summary']['people']['wouldCreate']==0
        assert again['summary']['people']['wouldUpdate']==count
        imports.confirm_fis_import(again['previewToken'])
        assert Athlete.query.filter_by(event_id=event.id).count()==count
    assert counts[0]==counts[1] and counts[0]>0
    assert Athlete.query.count()==sum(counts)


def test_enrichment_persists_without_new_person(events,monkeypatch):
    a,_=events
    existing=person(a,fis=None)
    expected=existing.id
    staged=preview(a,monkeypatch)
    assert staged['people'][0]['existingAthleteId']==expected
    imports.confirm_fis_import(staged['previewToken'])
    assert Athlete.query.filter_by(event_id=a.id).count()==1
    assert db.session.get(Athlete,expected).fis_code=='9300953'
    assert db.session.get(Athlete,expected).competitor_id=='00042'


def test_mapping_never_falls_back_to_other_event(events,monkeypatch):
    a,b=events
    for mapping in b.competition_mappings:
        if mapping.import_code=='WSC_BA_M_6182':mapping.active=False
    db.session.commit()
    with pytest.raises(ImportValidationError,match='Unbekannter Competition-Code'):
        preview(b,monkeypatch)
    assert preview(a,monkeypatch)['isValid']
    assert Athlete.query.count()==0


def test_booking_and_manual_choices_stay_in_event(events,monkeypatch):
    a,b=events
    own=person(a)
    other=person(b,accommodation_requirement='NO_ROOM',accommodation_requirement_source='MANUAL',
                 accommodation_rate_category='SPECIAL',accommodation_rate_source='MANUAL')
    hotel=Hotel(name='Event scoped hotel');rt=RoomType(name='DZ',max_persons=2)
    db.session.add_all([hotel,rt]);db.session.flush()
    booking=RoomBooking(event_id=b.id,hotel_id=hotel.id,room_type_id=rt.id,counts_as_single=False,
                       check_in_date=date(2027,3,3),check_out_date=date(2027,3,9))
    db.session.add(booking);db.session.flush()
    db.session.add(RoomBookingOccupant(room_booking_id=booking.id,athlete_id=other.id));db.session.commit()
    saved=(booking.id,booking.counts_as_single,booking.check_in_date,booking.check_out_date)
    assert imports._assignment_context(own,ImportReadContext(a.id)) is None
    staged=preview(a,monkeypatch)
    imports.confirm_fis_import(staged['previewToken'])
    db.session.refresh(booking);db.session.refresh(other)
    assert (booking.id,booking.counts_as_single,booking.check_in_date,booking.check_out_date)==saved
    assert other.accommodation_rate_category=='SPECIAL' and other.accommodation_requirement=='NO_ROOM'


def test_legacy_numeric_approval_key_and_foreign_approval(events):
    a,b=events
    p=person(a,function='Athlete',gender='M')
    p.competitions=[next(m.competition for m in a.competition_mappings if m.competition.gender=='M')]
    group=p.competitions[0].quota_discipline
    sa=session(a);sb=session(b)
    details=dict(quotaMembershipVersion=2,eventId=a.id,nationCode='JPN',discipline=group,gender='M',
        singleRoomCandidates=[dict(personKey='9300953.0',competitionIds=[str(p.competitions[0].id)])])
    decision=ImportApproval(session_id=sa.id,version_id=sa.current_version_id,nation='JPN',
        approval_type='NATION_APPROVED',description='Numeric key evidence',decision='APPROVED',
        quota_details_json=json.dumps(details),approved_person_keys_json='["9300953.0"]',username='test')
    db.session.add(decision);db.session.commit()
    assert applicable_approval_groups(decision,p,'9300953',[p])
    foreign=person(b,function='Athlete',gender='M');foreign.competitions=p.competitions;db.session.commit()
    assert not applicable_approval_groups(decision,foreign,'9300953',[foreign])
    decision.version_id=sb.current_version_id;db.session.commit()
    assert not approval_event_matches(decision,a.id)


def test_real_jpn_http_workflow_both_events(events,monkeypatch):
    entries=os.environ.get('JPN_ENTRIES_FILE');rooms=os.environ.get('JPN_ROOMS_FILE')
    if not entries or not rooms:pytest.skip('Supply real JPN workbooks via environment')
    a,b=events
    monkeypatch.setitem(app.config,'OPERATIONAL_EVENT_ID',a.id)
    client=app.test_client()
    totals=[]
    for event in (a,b):
        def upload(**extra):
            return client.post('/api/import/fis/preview',data={
                'eventId':str(event.id),'createSession':'true',**extra,
                'entriesList':(io.BytesIO(Path(entries).read_bytes()),Path(entries).name),
                'roomListDetailed':(io.BytesIO(Path(rooms).read_bytes()),Path(rooms).name)})
        result=upload()
        assert result.status_code==200,result.json
        assert result.json['isValid'],result.json['errors']
        sid=result.json['session']['id']
        for approval in result.json['session']['approvals']:
            if approval['decision']=='APPROVED':continue
            details=approval['quotaDetails']
            keys=[p['personKey'] for p in details.get('singleRoomCandidates',[])][:details.get('excessCount',0)]
            decided=client.patch(f"/api/import/sessions/{sid}/approvals/{approval['id']}?eventId={event.id}",json={
                'decision':'APPROVED','approvalType':'NATION_APPROVED','approvalMethod':'EMAIL',
                'approvalBy':'Explicit JPN test decision','approvalDate':'2026-10-22T12:00:00Z',
                'approvedPersonKeys':keys})
            assert decided.status_code==200,decided.json
        current=client.get(f'/api/import/sessions/{sid}?eventId={event.id}').json['preview']
        approved=client.post(f'/api/import/sessions/{sid}/approve?eventId={event.id}',json={
            'snapshotScope':'FULL_NATION','planDigest':current['changePlan']['digest'],
            'confirmDestructiveChanges':True})
        assert approved.status_code==200,approved.json
        imported=client.post('/api/import/fis/confirm',json={'eventId':event.id,'previewToken':result.json['previewToken']})
        assert imported.status_code==200,imported.json
        totals.append(Athlete.query.filter_by(event_id=event.id).count())
        repeated=upload()
        assert repeated.status_code==200,repeated.json
        assert repeated.json['summary']['people']['wouldCreate']==0
        if event==b:
            wrong=upload(sessionId=str(ImportSession.query.filter_by(event_id=a.id).one().id))
            assert wrong.status_code==409,wrong.json
    assert len(set(totals))==1 and totals[0]>0
    assert ImportSession.query.count()==2
    print(f'JPN real HTTP: {totals[0]} people per event, two isolated JPN sessions; reupload creates zero people')


def test_text_identifier_cells_preserve_leading_zeroes(tmp_path):
    path=tmp_path/'text-identities.xlsx'
    rows('009300953','00042').to_excel(path,index=False,sheet_name='Data')
    frame=imports.load_first_sheet(str(path))
    assert frame.iloc[0]['Fiscode']=='009300953'
    assert frame.iloc[0]['Competitorid/Staff ID']=='00042'


def test_foreign_cached_token_cannot_be_modified_by_session(events):
    a,b=events
    own=session(a)
    own.current_version.preview_token='foreign-cache'
    db.session.commit()
    raw={'createdAt':datetime.utcnow(),'eventId':b.id,'people':[],'rooms':[],'errors':[]}
    imports.PREVIEW_STORE['foreign-cache']=raw
    response=app.test_client().patch(f'/api/import/sessions/{own.id}/accommodation-rates/9300953?eventId={a.id}',
        json={'accommodationRateCategory':'SPECIAL'})
    assert response.status_code==409,response.json
    assert imports.PREVIEW_STORE['foreign-cache']==raw
    assert 'accommodationRateOverrides' not in raw


def test_foreign_current_version_is_rejected(events):
    a,b=events
    own,foreign=session(a),session(b)
    own.current_version=foreign.current_version;db.session.commit()
    response=app.test_client().get(f'/api/import/sessions/{own.id}?eventId={a.id}')
    assert response.status_code==409
    assert response.json['error']=='IMPORT_SESSION_VERSION_MISMATCH'
