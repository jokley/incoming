"""Durable review state on existing ImportSessionVersion.preview_json."""
import json
from copy import deepcopy
from datetime import date, datetime
from models import db, ImportSessionVersion
from .event_context import ImportValidationError, validate_session_event
from .read_context import ImportReadContext
from .change_plan import build_plan, verify_plan, encoded

DATE_FIELDS={'arrivalDate','departureDate','tvPictureDate','checkInDate','checkOutDate'}
DATETIME_FIELDS={'entryDate','lastUpdate','entriesSentDate'}


def restore_preview(value):
    preview=deepcopy(value)
    def convert(item):
        if isinstance(item,list):return [convert(v) for v in item]
        if not isinstance(item,dict):return item
        result={}
        for k,v in item.items():
            if isinstance(v,str) and v and k in DATE_FIELDS:
                v=date.fromisoformat(v[:10])
            elif isinstance(v,str) and v and k in DATETIME_FIELDS:
                v=datetime.fromisoformat(v.replace('Z','+00:00')).replace(tzinfo=None)
            elif isinstance(v,(dict,list)):v=convert(v)
            result[k]=v
        return result
    # Workflow evidence is serialized JSON; do not re-type historical plan snapshots.
    workflow=preview.pop('_workflow',None)
    preview=convert(preview)
    if isinstance(preview.get('createdAt'),str):
        preview['createdAt']=datetime.fromisoformat(preview['createdAt'].replace('Z','+00:00')).replace(tzinfo=None)
    if workflow:preview['_workflow']=workflow
    return preview


def load_version_preview(version):
    preview=restore_preview(json.loads(version.preview_json or '{}'))
    validate_session_event(version.session,preview)
    return preview


def refresh_plan(session, preview=None, *, read_context=None, recalculate=True):
    from excel_import import recalculate_fis_import_preview
    version=session.current_version
    if not version:raise ImportValidationError('IMPORT_REVIEW_REQUIRED','Keine aktuelle Importversion.')
    preview=restore_preview(preview) if preview is not None else load_version_preview(version)
    preview['_currentApprovalIds']=[a.id for a in session.current_approvals]
    read_context=read_context or ImportReadContext(session.event_id)
    if recalculate:recalculate_fis_import_preview(preview,read_context=read_context)
    db.session.flush()
    plan=build_plan(preview,read_context,version=version)
    preview['_workflow']={'state':'REVIEW','plan':plan}
    present_plan(preview,plan)
    preview['planStale']=False
    version.preview_json=encoded(preview)
    if session.status=='APPROVED':session.status='PROFESSIONALLY_REVIEWED'
    session.approved_at=session.approved_by=None
    return preview


def require_review(session, *, approved=False):
    preview=load_version_preview(session.current_version)
    workflow=preview.get('_workflow') or {}
    plan=workflow.get('plan')
    verify_plan(preview,plan)
    if approved and (workflow.get('approvedDigest')!=plan['digest'] or workflow.get('confirmedScope')!='FULL_NATION'
            or (plan['requiresDestructiveConfirmation'] and not workflow.get('destructiveConfirmed'))):
        raise ImportValidationError('IMPORT_REVIEW_REQUIRED','Änderungsplan wurde nicht ausdrücklich freigegeben.')
    return preview,workflow,plan


def completed_result(session):
    if not session.current_version:return None
    workflow=json.loads(session.current_version.preview_json or '{}').get('_workflow') or {}
    return workflow.get('result') if workflow.get('state')=='IMPORTED' else None


def lock_import_snapshot():
    """Protect fingerprint-to-write interval, including inserts by admin writers.

    The existing advisory lock serializes import/booking writers first. Table
    locks additionally exclude non-cooperating source/mapping writers and phantom
    approvals during this short transaction. No schema/global rule engine.
    """
    from sqlalchemy import text
    if db.session.get_bind().dialect.name=='postgresql':
        db.session.execute(text('LOCK TABLE athlete, athlete_competition, room_booking, room_booking_occupant, '
            'room_assignment, fis_room_assignment, import_session, import_session_version, import_approval, import_session_event, '
            'championship_event, event_competition, competition, world_champion, audit_event IN SHARE ROW EXCLUSIVE MODE'))


def present_plan(preview,plan):
    preview['changePlan']=plan
    analysis=preview.get('dispositionAnalysis') or {}
    categories=analysis.get('categories') or {}
    if 'removedAthletes' in categories:
        records=[{'personId':str(p['personId']),'athlete':p['name'],'nation':plan['nation'],
            'reason':'Im bestätigten vollständigen Nationen-Snapshot nicht mehr gemeldet'} for p in plan['people']['remove']]
        categories['removedAthletes'].update(count=len(records),records=records)
        changes=[c for c in analysis.get('changes',[]) if c.get('type')!='PERSON_REMOVED']
        changes += [{'type':'PERSON_REMOVED','preview':'persons','entityId':str(p['personId']),
            'description':'Person aus vollständiger Meldung entfernen','severity':'warning'} for p in plan['people']['remove']]
        analysis['changes']=changes
    if 'summary' in preview:
        preview['summary']['people'].update(wouldCreate=len(plan['people']['create']),wouldUpdate=len(plan['people']['update']),
            wouldUnchanged=len(plan['people']['unchanged']),wouldRemove=len(plan['people']['remove']))
