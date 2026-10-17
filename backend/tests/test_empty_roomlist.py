"""Real FIS Data-sheet sentinel is missing evidence, never a No room request."""
import json
from io import BytesIO
from pathlib import Path
import pandas as pd
import pytest
from test_real_workbook_import import database
from models import db, Athlete, ImportSession, ImportSessionVersion, ImportApproval, Hotel, RoomType, RoomBooking, RoomBookingOccupant
import excel_import as imports
from accommodation_requirements import set_requirement


def files(tmp_path, nation='GER'):
    fixture = json.loads((Path(__file__).parent / 'fixtures/real_entries' / f'{nation}_EMPTY_ROOMLIST.json').read_text())
    entries, rooms = tmp_path / 'random-a.xlsx', tmp_path / 'random-b.xlsx'
    pd.DataFrame(fixture['entries']).to_excel(entries, index=False, sheet_name='Data')
    pd.DataFrame(columns=[fixture['roomListSentinel']]).to_excel(rooms, index=False, sheet_name=fixture['roomListSheet'])
    return str(entries), str(rooms)


@pytest.mark.parametrize('nation,count', [('GER',21),('FIN',8)])
def test_real_empty_roomlist_reaches_review_and_confirmation(database,tmp_path,nation,count):
    import app as routes
    flask, championship = database
    entries, rooms = files(tmp_path,nation)
    assert imports.detect_fis_file_type(entries) == 'entries'
    assert imports.detect_fis_file_type(rooms) == 'roomlist'
    result = imports.create_fis_import_preview(entries,rooms,championship)
    assert result['isValid'] and result['errors'] == []
    assert result['rooms'] == [] and result['summary']['rooms']['total'] == 0
    notice = [w for w in result['warnings'] if w['code']=='ROOM_LIST_NO_DATA']
    assert len(notice)==1 and notice[0]['severity']=='info'
    assert not any(p['accommodationRequirement']=='NO_ROOM' for p in result['people'] if p['roomType']!='No room')
    session = ImportSession(nation=nation,status='DRAFT');db.session.add(session);db.session.flush()
    version = ImportSessionVersion(session_id=session.id,version=1,preview_json=json.dumps(result),preview_token=result['previewToken'],uploaded_by='test')
    db.session.add(version);db.session.flush();session.current_version=version;db.session.commit()
    with flask.test_request_context():
        reviewed=routes.get_import_session(session.id).get_json()
        assert reviewed['preview']['isValid'] and reviewed['errors']==0
        assert reviewed['preview']['roomListHasNoData']
    flask.config.update(AUTH_DEV_USER='test-admin',AUTH_DEV_GROUPS='incoming-admin',AUTH_PROXY_SECRET='')
    with flask.test_request_context('/api/import/sessions/1/approve', method='POST'):
        routes.authenticate_api_request()
        assert routes.approve_import_session(session.id).status_code==200
    with flask.test_request_context('/api/import/sessions/1/approve', method='POST'):
        routes.authenticate_api_request()
        imported=routes.import_approved_session(session.id)
        assert imported.status_code==200
        assert imported.get_json()['success']
    assert Athlete.query.count()==count


def test_empty_roomlist_preserves_manual_requirement_tariff_ez_and_partner(database,tmp_path):
    _, championship=database
    entries,rooms=files(tmp_path)
    result=imports.create_fis_import_preview(entries,rooms,championship)
    imports.confirm_fis_import(result['previewToken'])
    people=Athlete.query.order_by(Athlete.id).all()
    set_requirement(people[0],'NO_ROOM','MANUAL');set_requirement(people[1],'REQUIRED','MANUAL')
    people[1].accommodation_rate_category='SPECIAL';people[1].accommodation_rate_source='MANUAL'
    people[1].single_room_status='APPROVED_EXTRA';people[1].single_room_entitlement='APPROVED_EXTRA'
    people[1].shared_with_name='Preserved partner'
    session=ImportSession(nation='GER',status='IMPORTED');db.session.add(session);db.session.flush()
    version=ImportSessionVersion(session_id=session.id,version=1,preview_json=json.dumps(result),preview_token=result['previewToken'],uploaded_by='test');db.session.add(version);db.session.flush();session.current_version=version
    decision=ImportApproval(session_id=session.id,version_id=version.id,nation='GER',approval_type='ORGANIZER_APPROVED',description='Historical approval',decision='APPROVED',username='test')
    db.session.add(decision);people[1].single_room_decision=decision
    db.session.commit();decision_id=decision.id
    result=imports.create_fis_import_preview(entries,rooms,championship)
    imports.confirm_fis_import(result['previewToken'])
    assert people[0].accommodation_requirement=='NO_ROOM' and people[0].accommodation_requirement_source=='MANUAL'
    assert people[1].accommodation_requirement=='REQUIRED' and people[1].accommodation_requirement_source=='MANUAL'
    assert people[1].accommodation_rate_category=='SPECIAL' and people[1].accommodation_rate_source=='MANUAL'
    assert people[1].single_room_status==people[1].single_room_entitlement=='APPROVED_EXTRA'
    assert people[1].shared_with_name=='Preserved partner'
    assert people[1].single_room_decision_id==decision_id and db.session.get(ImportApproval,decision_id).decision=='APPROVED'


@pytest.mark.parametrize('sheet,values',[('Other',['no data available']),('Data',['unrelated']),('Data',['no data available','extra'])])
def test_unrelated_or_mixed_workbook_is_not_empty_roomlist(tmp_path,sheet,values):
    path=tmp_path/'random.xlsx';pd.DataFrame(values).to_excel(path,index=False,header=False,sheet_name=sheet)
    assert imports.detect_fis_file_type(str(path))=='unknown'
    assert imports.parse_room_list(imports.load_first_sheet(str(path)),[])['errors']


def test_corrupt_excel_still_fails(tmp_path):
    path=tmp_path/'random.xlsx';path.write_text('not an excel workbook')
    with pytest.raises(imports.InvalidExcelFileError):imports.detect_fis_file_type(str(path))


def test_missing_entries_evidence_preserves_existing_imported_requirement(database,tmp_path):
    _, championship=database
    entries,rooms=files(tmp_path)
    result=imports.create_fis_import_preview(entries,rooms,championship)
    imports.confirm_fis_import(result['previewToken'])
    person=Athlete.query.order_by(Athlete.id).first()
    set_requirement(person,'NO_ROOM','IMPORT');db.session.commit()
    frame=pd.read_excel(entries);frame.loc[0,'Room_type']=None;frame.to_excel(entries,index=False,sheet_name='Data')
    result=imports.create_fis_import_preview(entries,rooms,championship)
    assert result['people'][0]['accommodationRequirement']=='NO_ROOM'
    assert result['people'][0]['accommodationRequirementSource']=='IMPORT'
    imports.confirm_fis_import(result['previewToken'])
    assert person.accommodation_requirement=='NO_ROOM'


@pytest.mark.parametrize('reverse',[False,True])
def test_multipart_detection_uses_workbook_structure_not_upload_filename(database,tmp_path,reverse):
    import app as routes
    flask,championship=database
    entries,rooms=files(tmp_path)
    flask.config.update(AUTH_DEV_USER='test-admin',AUTH_DEV_GROUPS='incoming-admin',AUTH_PROXY_SECRET='')
    flask.before_request(routes.authenticate_api_request)
    flask.add_url_rule('/api/import/fis/preview/',view_func=routes.preview_fis_import,methods=['POST'])
    uploads=[(BytesIO(Path(entries).read_bytes()),'opaque-one.xlsx'),(BytesIO(Path(rooms).read_bytes()),'opaque-two.xlsx')]
    if reverse: uploads.reverse()
    result=flask.test_client().post('/api/import/fis/preview/',data={'eventId':str(championship.id),'createSession':'true','files':uploads})
    assert result.status_code==200,result.get_json()
    assert result.json['isValid'] and result.json['session']['preview']['rooms']==[]
    assert result.json['session']['status']!='ERROR'


def test_normal_entries_request_is_not_inferred_from_empty_roomlist(database,tmp_path):
    _,championship=database
    entries,rooms=files(tmp_path)
    frame=pd.read_excel(entries);frame.loc[0,'Room_type']='Double shared';frame.to_excel(entries,index=False,sheet_name='Data')
    result=imports.create_fis_import_preview(entries,rooms,championship)
    assert result['people'][0]['accommodationRequirement']=='REQUIRED'
    assert result['people'][0]['accommodationRequirementSource']=='IMPORT'
    assert result['rooms']==[]


def test_missing_roomlist_does_not_report_shared_booking_removal(database,tmp_path):
    _,championship=database
    entries,rooms=files(tmp_path)
    result=imports.create_fis_import_preview(entries,rooms,championship);imports.confirm_fis_import(result['previewToken'])
    people=Athlete.query.order_by(Athlete.id).limit(2).all()
    for person in people:set_requirement(person,'REQUIRED','MANUAL')
    hotel=Hotel(name='Retained');rt=RoomType(name='DZ',max_persons=2);db.session.add_all([hotel,rt]);db.session.flush()
    booking=RoomBooking(hotel=hotel,room_type=rt,check_in_date=people[0].arrival_date,check_out_date=people[0].departure_date)
    db.session.add(booking);db.session.flush()
    for person in people:db.session.add(RoomBookingOccupant(athlete=person,room_booking=booking))
    db.session.commit();bid=booking.id
    result=imports.create_fis_import_preview(entries,rooms,championship)
    assert result['isValid']
    assert not any(c['type']=='ROOM_REMOVED' for c in result['dispositionAnalysis']['changes'])
    assert result['dispositionAnalysis']['categories']['roommateAffected']['count']==0
    imports.confirm_fis_import(result['previewToken'])
    assert RoomBooking.query.count()==1 and len(db.session.get(RoomBooking,bid).occupants)==2
