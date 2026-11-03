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


def versions_after_archive(session):
    """An explicit session close is a source boundary, never a history deletion."""
    closed = {h.version_id for h in session.history if h.event_type == 'ARCHIVED'}
    boundary = max((v.version for v in session.versions if v.id in closed), default=0)
    return [v for v in session.versions if v.version > boundary]


def submission_heads(session):
    """Latest accepted source per mapped family, including invalid corrections.

    Review copies of a single submission remain that submission's current draft.
    Composed reviews never become source files. Cancellation is explicit and may
    expose the preceding source; an imported full replacement starts a new set.
    """
    heads = {}
    if session.status == 'ARCHIVED':
        return heads
    for version in sorted(versions_after_archive(session), key=lambda v: v.version):
        preview = json.loads(version.preview_json or '{}')
        state = (preview.get('_workflow') or {}).get('state')
        if state == 'CANCELLED' or preview.get('submissionSources'):
            continue
        scope = preview.get('replacementScope') or {}
        if scope.get('kind') == 'FULL_NATION' and state == 'IMPORTED':
            heads.clear()
        if scope.get('kind') == 'SPORT_FAMILY':
            heads[scope['family']] = version
    return heads


def imported_submission_ids(session):
    imported = {h.version_id for h in session.history if h.event_type=='IMPORTED'}
    for version in session.versions:
        preview = json.loads(version.preview_json or '{}')
        if (preview.get('_workflow') or {}).get('state') == 'IMPORTED':
            imported.add(version.id)
            imported.update((preview.get('submissionSources') or {}).values())
    return imported


def submission_summary(session):
    heads = submission_heads(session)
    imported=imported_submission_ids(session)
    result = []
    for family, version in sorted(heads.items()):
        preview = json.loads(version.preview_json or '{}')
        people = preview.get('people', [])
        pending = any(a.version_id == version.id and a.decision != 'APPROVED' for a in session.approvals)
        status = ('IMPORTED' if version.id in imported else 'DRAFT' if preview.get('errors') else
                  'WAITING_FOR_NATION' if pending else 'PROFESSIONALLY_REVIEWED')
        result.append(dict(family=family, versionId=str(version.id), version=version.version,
            people=len(people), athletes=sum((p.get('function') or '').lower() == 'athlete' for p in people),
            status=status, errors=len(preview.get('errors', []))))
    return result


def merge_submission_previews(versions, *, consistency_only=False, read_context=None):
    """Compose parsed sources; reuse the existing exact identity matcher.

    No live writes, quota decisions or date/room guessing happen here. Source
    provenance survives canonical person/room keys and overlapping row numbers.
    """
    from types import SimpleNamespace
    from .identity import _build_existing_athlete_maps, _find_existing_athlete
    from .normalization import normalize_string
    from quota_service import normalize_gender
    from .change_plan import digest
    if not versions:
        raise ImportValidationError('IMPORT_REVIEW_REQUIRED', 'Mindestens eine aktuelle Teilmeldung auswählen.')
    sources = [(v, load_version_preview(v)) for v in versions]
    from excel_import import apply_preview_rates, apply_preview_requirements, apply_single_room_quota_exemptions
    context=read_context or ImportReadContext(versions[0].session.event_id)
    if context.event_id!=versions[0].session.event_id:
        raise ImportValidationError('IMPORT_EVENT_MISMATCH','Fremder Kontext für die Teilmeldungen.')
    imported=imported_submission_ids(versions[0].session)
    def project_source(people,version,source):
        if version.id in imported:
            source.pop('accommodationRateOverrides',None)
            source.pop('accommodationRequirementOverrides',None)
        imported_source=version.id in imported
        apply_preview_rates(people,None if imported_source else source.get('accommodationRateOverrides'),read_context=context)
        apply_preview_requirements(people,source['rooms'],None if imported_source else source.get('accommodationRequirementOverrides'),read_context=context)
        apply_single_room_quota_exemptions(people,event_id=context.event_id,read_context=context)
    if not consistency_only:
        for version,source in sources:project_source(source['people'],version,source)
    result = deepcopy(sources[0][1])
    people, rooms, aliases, records, partner_checks = [], [], {}, [], []
    critical = ('firstname','lastname','nationCode','gender','function','arrivalDate','departureDate',
                'roomType','accommodationRequirement','accommodationRateCategory','singleRoomQuotaExemptReason')
    def comparable(person, field):
        return normalize_gender(person.get(field)) if field=='gender' else normalize_string(str(person.get(field) or ''))
    for version, source in sources:
        for original in source.get('people', []):
            incoming = deepcopy(original)
            incoming['sourceRows'] = [{'versionId':version.id,'version':version.version,'row':original.get('sourceRowNumber',original.get('rowNumber'))}]
            incoming['roomListHasNoData'] = source.get('roomListHasNoData',False)
            maps = _build_existing_athlete_maps(records,event_id=source['eventId'])
            match = _find_existing_athlete(incoming,maps)
            target = people[match.index] if match else None
            if target is not None:
                if consistency_only:
                    prior_version,prior_source=next((v,s) for v,s in sources if v.id==target['sourceRows'][0]['versionId'])
                    project_source([target],prior_version,prior_source)
                    project_source([incoming],version,source)
                if target.get('sharedWithName') and incoming.get('sharedWithName') and normalize_string(target['sharedWithName'])!=normalize_string(incoming['sharedWithName']):
                    partner_checks.append((target['sourceRows'][0]['versionId'],target['matchKey'],version.id,original['matchKey']))
                conflicts = [field for field in critical if comparable(target,field) != comparable(incoming,field)
                             and not (field in {'roomType','sharedWithName'} and (not target.get(field) or not incoming.get(field)))]
                if conflicts:
                    raise ImportValidationError('IMPORT_SHARED_PERSON_CONFLICT', 'Widersprüchliche Personen-, Aufenthalts- oder Zimmerangaben in den Teilmeldungen.',
                        details={'fields':conflicts,'sourceRows':target['sourceRows']+incoming['sourceRows']})
                for field in ('fisCode','competitorId','roomType','sharedWithName'):
                    if not target.get(field):target[field]=incoming.get(field)
                for field in ('competitionIds','competitionImportCodes','affirmativeWscColumns'):
                    target[field]=sorted(set(target.get(field,[]))|set(incoming.get(field,[])),key=str)
                target['sourceRows'] += incoming['sourceRows']
                target['roomListHasNoData'] &= incoming['roomListHasNoData']
            else:
                target=incoming;people.append(target)
            aliases[version.id,original['matchKey']]=target['matchKey']
            records=[SimpleNamespace(id=p['matchKey'],index=i,event_id=source['eventId'],fis_code=p.get('fisCode'),
                competitor_id=p.get('competitorId'),firstname=p['firstname'],lastname=p['lastname'],nation_code=p['nationCode']) for i,p in enumerate(people)]
    def partner(version_id, key):
        source=next(s for v,s in sources if v.id==version_id)
        for room in source.get('rooms',[]):
            members=[room.get('person1Key'),room.get('person2Key')]
            if key in members:
                other=next((member for member in members if member and member!=key),None)
                if other:return aliases.get((version_id,other))
        return None
    for left,left_key,right,right_key in partner_checks:
        if partner(left,left_key) is None or partner(left,left_key)!=partner(right,right_key):
            raise ImportValidationError('IMPORT_SHARED_PERSON_CONFLICT','Zimmerpartnerangaben sind zwischen den Teilmeldungen nicht eindeutig.')
    room_for_person, by_signature = {}, {}
    for version, source in sources:
        for original in source.get('rooms', []):
            room=deepcopy(original)
            for field in ('person1Key','person2Key'):
                if room.get(field):room[field]=aliases[version.id,room[field]]
            keys=tuple(sorted(k for k in (room.get('person1Key'),room.get('person2Key')) if k))
            facts={k:room.get(k) for k in ('checkInDate','checkOutDate','lateCheckout','firstMeal','lastMeal','specialMeal')}
            facts['roomType']=normalize_string(room.get('roomType'))
            if len(keys)==1:facts['partner']=normalize_string(room.get('sharedWithRawName'))
            signature=digest({'people':keys,'request':facts})
            related={id(item):item for key in keys for item in room_for_person.get(key,[]) if item['versionId']!=version.id}
            for item in related.values():
                if item['keys']!=keys or normalize_string(item['room']['roomType'])!=normalize_string(room['roomType']) or (item['room']['person1Key']==room['person1Key'] and item['signature']!=signature):
                    raise ImportValidationError('IMPORT_SHARED_PERSON_CONFLICT','Widersprüchliche Zimmerzuordnungen in den Teilmeldungen.',details={'sourceVersionId':version.id,'row':room.get('rowNumber')})
            previous=by_signature.get(signature)
            if previous:
                previous['room']['sourceRows'].append({'versionId':version.id,'version':version.version,'row':room.get('rowNumber')})
                continue
            room['sourceRows']=[{'versionId':version.id,'version':version.version,'row':room.get('rowNumber')}]
            room['sourceRowKey']=signature
            item={'signature':signature,'room':room,'versionId':version.id,'keys':keys}
            for key in keys:room_for_person.setdefault(key,[]).append(item)
            by_signature[signature]=item
            rooms.append(room)
    result.update(people=people,rooms=rooms,roomListHasNoData=all(p.get('roomListHasNoData') for p in people))
    for field in ('errors','warnings'):
        result[field]=[{**item,'sourceVersionId':v.id} for v,s in sources for item in s.get(field,[])]
    for field in ('entriesColumns','roomColumns','dayColumns'):
        result[field]=list(dict.fromkeys(value for _,s in sources for value in s.get(field,[])))
    for field in ('accommodationRateOverrides','accommodationRequirementOverrides','singleRoomQuotaExemptOverrides','singleRoomQuotaExemptOverrideRevisions'):
        commands={}
        for version,source in sources:
            for key,value in source.get(field,{}).items():
                canonical=aliases.get((version.id,key))
                if canonical is None:continue
                if canonical in commands and commands[canonical]!=value:
                    raise ImportValidationError('IMPORT_SHARED_PERSON_CONFLICT','Widersprüchliche geprüfte Vorgaben in den Teilmeldungen.')
                commands[canonical]=deepcopy(value)
        result[field]=commands
    result['submissionSources']={(s.get('replacementScope') or {})['family']:v.id for v,s in sources}
    result['submissionSourceDigests']={str(v.id):digest(json.loads(v.preview_json)) for v,_ in sources}
    result['replacementScope']={'kind':'SPORT_FAMILY','families':sorted(result['submissionSources'])}
    result['summary']['people']['total']=len(people)
    result.pop('_workflow',None)
    result.pop('reviewSourceVersionId',None)
    return result


def require_submission_sources(session, preview):
    from .change_plan import digest
    heads=submission_heads(session)
    for family, identity in preview.get('submissionSources',{}).items():
        version=heads.get(family)
        if not version or version.id!=identity or digest(json.loads(version.preview_json))!=preview['submissionSourceDigests'].get(str(identity)):
            raise ImportValidationError('STALE_PREVIEW','Eine verwendete Teilmeldung wurde geändert. Nationsentwurf erneut prüfen.')


def require_submission_consistency(session, preview):
    if (preview.get('replacementScope') or {}).get('kind')=='SPORT_FAMILY':
        merge_submission_previews(list(submission_heads(session).values()),consistency_only=True)


def review_approvals(session, preview):
    """Referenced approvals are candidates, never automatically applicable.

    The existing exact person/context/cohort checks decide their applicability.
    Pending decisions from a different submission never block this selection.
    """
    versions={v.id:v for v in session.versions}
    referenced=set(preview.get('submissionSources',{}).values())
    if preview.get('reviewSourceVersionId'):referenced.add(preview['reviewSourceVersionId'])
    pending=list(referenced)
    while pending:
        identity=pending.pop()
        version=versions.get(identity)
        if not version:raise ImportValidationError('IMPORT_EVENT_MISMATCH','Ungültiger Quellversionsbezug.')
        ancestor=json.loads(version.preview_json or '{}').get('reviewSourceVersionId')
        if ancestor and ancestor not in referenced:referenced.add(ancestor);pending.append(ancestor)
    superseded={e.approval_id for e in session.history if e.event_type=='QUOTA_DECISION_REVISED_FROM'}
    return list({a.id:a for a in [*session.current_approvals,*[a for a in session.approvals
        if a.version_id in referenced and a.decision=='APPROVED' and a.id not in superseded]]}.values())


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
    preview['_currentApprovalIds']=[a.id for a in review_approvals(session,preview)]
    read_context=read_context or ImportReadContext(session.event_id)
    if recalculate:recalculate_fis_import_preview(preview,read_context=read_context)
    from athlete_quota import reconcile_tasks
    reconcile_tasks(session,preview)
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
    if session.status == 'ARCHIVED':
        raise ImportValidationError('IMPORT_SESSION_CLOSED', 'Importsession geschlossen. Für eine neue Prüfung Dateien erneut hochladen.')
    preview=load_version_preview(session.current_version)
    require_submission_sources(session,preview)
    require_submission_consistency(session,preview)
    from quota_rules import rules_for_event, fingerprint, accommodation_rule_event
    from models import Event
    event=accommodation_rule_event(db.session.get(Event,session.event_id))
    if preview.get('quotaRulesDigest') and (preview['quotaRulesDigest']!=fingerprint(rules_for_event(session.event_id)) or preview.get('quotaRulesRevision',1)!=event.quota_rules_revision):
        raise ImportValidationError('QUOTA_RULES_CHANGED','Quotenregeln wurden geändert – bitte erneut prüfen.')
    workflow=preview.get('_workflow') or {}
    plan=workflow.get('plan')
    verify_plan(preview,plan)
    if any(e.event_type == 'NATION_QUESTION' for e in session.history):
        from import_control import build_import_control, nation_clarifications
        control = build_import_control(preview, ImportReadContext(session.event_id))
        pending = [i for i in nation_clarifications(session, preview, control)['items'] if i['required'] and i['state'] == 'OPEN' and i['relevant']]
        if pending:
            raise ImportValidationError('NATION_CLARIFICATION_REQUIRED', 'Verbindliche Rückfrage an die Nation ist noch offen.')
    if approved and (workflow.get('approvedDigest')!=plan['digest'] or workflow.get('confirmedScope')!=plan['snapshotScope']
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
            'championship_event, event_competition, competition, world_champion, world_champion_recognition, event_quota_revision, audit_event IN SHARE ROW EXCLUSIVE MODE'))


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


def fork_review_version(session, preview, username, *, source_version=None, preserve_overrides=False):
    """Reuse parsed facts while retaining the published version and its history."""
    import uuid
    prior=source_version or session.current_version
    preview=deepcopy(preview)
    if not preview.get('submissionSources'):
        preview['reviewSourceVersionId']=prior.id
    if not preserve_overrides:
        preview.pop('accommodationRateOverrides',None)
        preview.pop('accommodationRequirementOverrides',None)
    preview['carriedSingleRoomQuotaExemptKeys']=list(preview.get('singleRoomQuotaExemptOverrides',{}))
    preview.pop('_workflow',None)
    token=uuid.uuid4().hex
    preview['previewToken']=token
    sources=preview.get('submissionSources')
    if sources:
        from .change_plan import digest
        source_hash=digest({v.id:v.source_hash for v in session.versions if v.id in sources.values()})
    else:
        source_hash=prior.source_hash
    version=ImportSessionVersion(session_id=session.id,version=session.next_version_number(),preview_token=token,
        preview_json=encoded(preview),source_hash=source_hash,entries_filename=None if sources else prior.entries_filename,
        room_filename=None if sources else prior.room_filename,uploaded_by=username)
    db.session.add(version);db.session.flush();session.current_version=version
    session.status='PROFESSIONALLY_REVIEWED'
    session.approved_at=session.approved_by=None
    db.session.flush()
    return preview
