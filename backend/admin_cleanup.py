"""Event-owned administrative deletion. No quota evaluation or history-only rewrite."""
import json
import uuid
import urllib.request
from flask import current_app, g, request
import sqlalchemy as sa
from models import (db, Athlete, AthleteCompetition, RoomBooking, RoomBookingOccupant,
                    RoomAssignment, FisRoomAssignment, ImportSession, ImportSessionVersion,
                    ImportApproval, ImportSessionEvent, ImportRun, AuditEvent)
from imports.event_context import ImportValidationError

SCOPES = {'nation', 'all', 'imports', 'assignments', 'activities'}
PRESERVED = ['Hotels', 'Kontingente', 'Bedarfsplanung', 'Eventkonfiguration und Quotenregeln',
             'Competition-Mappings', 'Weltmeisterlisten', 'Benutzer', 'Auditnachweise']


def rows(model, condition):
    return db.session.scalars(sa.select(model).where(condition).order_by(model.id)).all()


def plan(owner, scope, nation=None):
    if scope not in SCOPES:
        raise ImportValidationError('INVALID_SCOPE', 'Bitte Nationenmeldung, Eventdaten, Importprüfungen oder Zuweisungen wählen.')
    if scope == 'nation' and (not isinstance(nation, str) or not nation.strip() or len(nation)>10):
        raise ImportValidationError('NATION_REQUIRED', 'Bitte eine Nation auswählen.')
    nation = nation.strip().upper() if scope == 'nation' else None
    everyone = rows(Athlete, Athlete.event_id == owner)
    sessions = rows(ImportSession, ImportSession.event_id == owner)
    nations = sorted({p.nation_code for p in everyone if p.nation_code} | {s.nation for s in sessions})
    people = [p for p in everyone if scope in {'all','nation'} and (not nation or p.nation_code == nation)]
    selected = {p.id for p in people}
    sessions = [s for s in sessions if scope in {'all','nation','imports'} and (not nation or s.nation==nation)]
    session_ids = {s.id for s in sessions}
    if scope == 'imports' and any(p.nation_code in {s.nation for s in sessions} for p in everyone):
        raise ImportValidationError('IMPORT_DATA_IN_USE', 'Importdaten gehören zu vorhandenen Personen. Bitte die betreffende Nationenmeldung einschließlich ihrer operativen Daten löschen.')
    approvals = rows(ImportApproval, ImportApproval.session_id.in_(session_ids))
    aids = {a.id for a in approvals}
    versions = rows(ImportSessionVersion, ImportSessionVersion.session_id.in_(session_ids))
    vids = {v.id for v in versions}
    if any(a.version_id is not None and a.version_id not in vids for a in approvals) or any(s.current_version_id is not None and s.current_version_id not in vids for s in sessions) or db.session.query(ImportSessionEvent.id).filter(ImportSessionEvent.session_id.in_(session_ids),sa.or_(sa.and_(ImportSessionEvent.version_id.isnot(None),~ImportSessionEvent.version_id.in_(vids)),sa.and_(ImportSessionEvent.approval_id.isnot(None),~ImportSessionEvent.approval_id.in_(aids)))).first():
        raise ImportValidationError('CLEANUP_REFERENCE_CONFLICT', 'Widersprüchliche Importhistorie wird nicht automatisch gelöscht.')
    if db.session.query(Athlete.id).filter(~Athlete.id.in_(selected),sa.or_(Athlete.single_room_decision_id.in_(aids),Athlete.accommodation_rate_approval_id.in_(aids))).first():
        raise ImportValidationError('CLEANUP_REFERENCE_CONFLICT', 'Eine andere Person verwendet diese Genehmigungen. Keine Daten wurden gelöscht.')
    if db.session.query(ImportSession.id).filter(~ImportSession.id.in_(session_ids),sa.or_(ImportSession.current_version_id.in_(vids),ImportSession.replaced_by_id.in_(session_ids))).first() or db.session.query(ImportSessionEvent.id).filter(~ImportSessionEvent.session_id.in_(session_ids),sa.or_(ImportSessionEvent.approval_id.in_(aids),ImportSessionEvent.version_id.in_(vids))).first() or db.session.query(ImportApproval.id).filter(~ImportApproval.session_id.in_(session_ids),ImportApproval.version_id.in_(vids)).first():
        raise ImportValidationError('CLEANUP_REFERENCE_CONFLICT', 'Eventübergreifende oder unklare Importreferenz. Keine Daten wurden gelöscht.')
    bookings = rows(RoomBooking, RoomBooking.event_id==owner) if scope in {'all','assignments'} else rows(RoomBooking, RoomBooking.id.in_(sa.select(RoomBookingOccupant.room_booking_id).where(RoomBookingOccupant.athlete_id.in_(selected))))
    bids = {b.id for b in bookings}
    occupants = rows(RoomBookingOccupant, RoomBookingOccupant.room_booking_id.in_(bids))
    involved = selected | {o.athlete_id for o in occupants}
    if any(b.event_id!=owner for b in bookings) or db.session.query(Athlete.id).filter(Athlete.id.in_(involved),Athlete.event_id!=owner).first():
        raise ImportValidationError('CLEANUP_REFERENCE_CONFLICT', 'Gemischte Eventbelegung muss zuerst geprüft werden.')
    remove_occupants = [o.id for o in occupants if scope in {'all','assignments'} or o.athlete_id in selected]
    empty = bids - {o.room_booking_id for o in occupants if o.id not in remove_occupants}
    legacy_people = {p.id for p in everyone} if scope=='assignments' else selected
    legacy = rows(RoomAssignment, sa.or_(RoomAssignment.athlete_id.in_(legacy_people),RoomAssignment.shared_with_athlete_id.in_(legacy_people)))
    fis = rows(FisRoomAssignment, sa.or_(FisRoomAssignment.person1_id.in_(legacy_people),FisRoomAssignment.person2_id.in_(legacy_people)))
    linked = {i for r in legacy for i in (r.athlete_id,r.shared_with_athlete_id) if i} | {i for r in fis for i in (r.person1_id,r.person2_id) if i}
    if db.session.query(Athlete.id).filter(Athlete.id.in_(linked),Athlete.event_id!=owner).first():
        raise ImportValidationError('CLEANUP_REFERENCE_CONFLICT', 'Unklare Legacy-Zuweisung wird nicht automatisch gelöscht.')
    runs = rows(ImportRun, ImportRun.event_id==owner) if scope=='all' else []
    if db.session.query(FisRoomAssignment.id).filter(FisRoomAssignment.import_run_id.in_([r.id for r in runs]),~FisRoomAssignment.id.in_([r.id for r in fis])).first():
        raise ImportValidationError('CLEANUP_REFERENCE_CONFLICT', 'Ein Importlauf wird außerhalb des Löschumfangs verwendet.')
    counts = dict(people=len(people),memberships=db.session.query(AthleteCompetition).filter(AthleteCompetition.athlete_id.in_(selected)).count(),
                  occupants=len(remove_occupants),bookings=len(empty),sharedRoomsRetained=len(bids-empty),
                  legacyAssignments=len(legacy)+len(fis),sessions=len(sessions),versions=len(versions),approvals=len(approvals),
                  workflowEvents=db.session.query(ImportSessionEvent).filter(ImportSessionEvent.session_id.in_(session_ids)).count(),importRuns=len(runs))
    return dict(eventId=owner,scope=scope,nation=nation,nations=nations,counts=counts,preserved=PRESERVED,
                people=people,sessions=sessions,approvals=approvals,versions=versions,empty=empty,removeOccupants=remove_occupants,
                legacy=legacy,fis=fis,runs=runs,everyone=everyone)


def preview(value):
    return {k:value[k] for k in ('eventId','scope','nation','nations','counts','preserved')}


def safety_backup():
    """Fresh synchronous backup of the explicit target, never an accepted job."""
    from database_admin import restore_database_target
    payload=json.dumps({'databaseTarget':restore_database_target()}).encode()
    req=urllib.request.Request(current_app.config['BACKUP_SERVICE_URL'].rstrip('/')+'/cleanup-backup',data=payload,
        headers={'Content-Type':'application/json','X-Backup-Control-Secret':current_app.config['AUTH_PROXY_SECRET']},method='POST')
    try:
        with urllib.request.urlopen(req,timeout=120) as response:
            result=json.loads(response.read())
            if response.status!=200 or result.get('status')!='success' or not result.get('filename') or result.get('size',0)<=0:
                raise ValueError('No verified backup')
            return {k:result[k] for k in ('filename','category','size')}
    except Exception:
        raise ImportValidationError('CLEANUP_BACKUP_REQUIRED', 'Sicherheitsbackup konnte nicht erfolgreich erstellt werden. Keine Daten wurden gelöscht.') from None


def execute(owner, scope, nation, username):
    from accommodation_mutations import lock_accommodation_writes
    lock_accommodation_writes()
    if db.engine.dialect.name=='postgresql':
        db.session.execute(sa.text("SET LOCAL lock_timeout='5s'"))
        # Writes cannot enter between the fresh pg_dump snapshot and deletion.
        # Reads/pg_dump remain possible; locks end with the same transaction.
        tables=sorted(m.__tablename__ for m in (Athlete,AthleteCompetition,RoomBooking,RoomBookingOccupant,RoomAssignment,FisRoomAssignment,ImportSession,ImportSessionVersion,ImportApproval,ImportSessionEvent,ImportRun))
        db.session.execute(sa.text('LOCK TABLE '+', '.join(tables)+' IN SHARE ROW EXCLUSIVE MODE'))
    value=plan(owner,scope,nation)
    backup=safety_backup() if scope=='all' and any(value['counts'].values()) else None
    ids={p.id for p in value['people']};sids={s.id for s in value['sessions']}
    db.session.execute(sa.delete(RoomBookingOccupant).where(RoomBookingOccupant.id.in_(value['removeOccupants'])))
    for row in value['legacy']:
        survivors=[i for i in (row.athlete_id,row.shared_with_athlete_id) if i and i not in ids]
        if scope=='assignments' or not survivors:db.session.delete(row)
        else:row.athlete_id=survivors[0];row.shared_with_athlete_id=None
    for row in value['fis']:
        survivors=[i for i in (row.person1_id,row.person2_id) if i and i not in ids]
        if scope=='assignments':row.hotel_id=None;row.room_number=None
        elif not survivors:db.session.delete(row)
        else:
            row.person1_id=survivors[0];row.person2_id=None;row.shared_with_raw_name=None;row.shared_with_nation_code=None
            row.source_row_key=f'admin-retained:{row.id}:{uuid.uuid4().hex}'
    # Clear only unambiguous textual references to removed partners.
    from imports.normalization import normalize_string,normalize_whitespace
    names={}
    for person in value['everyone']:
        for name in (f'{person.lastname}, {person.firstname}',f'{person.lastname} {person.firstname}',f'{person.firstname} {person.lastname}'):
            names.setdefault(normalize_string(normalize_whitespace(name)),set()).add(person.id)
    for person in value['everyone']:
        referenced=names.get(normalize_string(normalize_whitespace(person.shared_with_name)),set())
        if person.id not in ids and referenced and referenced<=ids:person.shared_with_name=None
    db.session.flush()
    db.session.execute(sa.delete(AthleteCompetition).where(AthleteCompetition.athlete_id.in_(ids)))
    db.session.execute(sa.delete(Athlete).where(Athlete.id.in_(ids),Athlete.event_id==owner))
    db.session.execute(sa.delete(RoomBooking).where(RoomBooking.id.in_(value['empty']),RoomBooking.event_id==owner))
    db.session.execute(sa.update(ImportSession).where(ImportSession.id.in_(sids)).values(current_version_id=None,replaced_by_id=None))
    db.session.execute(sa.delete(ImportSessionEvent).where(ImportSessionEvent.session_id.in_(sids)))
    db.session.execute(sa.delete(ImportApproval).where(ImportApproval.session_id.in_(sids)))
    db.session.execute(sa.delete(ImportSessionVersion).where(ImportSessionVersion.session_id.in_(sids)))
    db.session.execute(sa.delete(ImportSession).where(ImportSession.id.in_(sids),ImportSession.event_id==owner))
    db.session.execute(sa.delete(ImportRun).where(ImportRun.id.in_([r.id for r in value['runs']]),ImportRun.event_id==owner))
    result={**preview(value),'safetyBackup':backup,'message':'Genehmigungs- und Auditnachweise bleiben erhalten.' if scope=='activities' else 'Ausgewählte operative Daten wurden gelöscht.'}
    db.session.add(AuditEvent(username=username,action='delete',entity_type='admin-cleanup',entity_id=str(owner),request_id=str(g.request_id)[:36],
        method='POST',path=request.path,category='Administration',activity='Operative Datenbereinigung',changes_json=json.dumps(result),
        details_json=json.dumps([f'Umfang: {scope}',f"Nation: {value['nation'] or 'gesamtes Event'}",f"Personen: {value['counts']['people']}; Buchungen: {value['counts']['bookings']}; Imports: {value['counts']['sessions']}"]),
        entity_refs_json=json.dumps({'championshipEventId':str(owner),'_scope':'OPERATIONAL_EVENT','nation':value['nation']})))
    db.session.commit();g.atomic_import_audit=True
    return result
