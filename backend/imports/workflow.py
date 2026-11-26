"""Durable review state on existing ImportSessionVersion.preview_json."""
import json
from copy import deepcopy
from datetime import date, datetime
from models import db, ImportSessionVersion
from accommodation_requirements import REQUIREMENTS, can_defer_imported_requirement
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


def submission_heads(session, preview_for=lambda version: json.loads(version.preview_json or "{}")):
    """Latest accepted source per mapped family, including invalid corrections.

    Review copies of a single submission remain that submission's current draft.
    Composed reviews never become source files. Cancellation is explicit and may
    expose the preceding source; an imported full replacement starts a new set.
    """
    heads = {}
    if session.status == 'ARCHIVED':
        return heads
    for version in sorted(versions_after_archive(session), key=lambda v: v.version):
        preview = preview_for(version)
        state = (preview.get('_workflow') or {}).get('state')
        if state == 'CANCELLED' or preview.get('submissionSources'):
            continue
        scope = preview.get('replacementScope') or {}
        if scope.get('kind') == 'FULL_NATION' and state == 'IMPORTED':
            heads.clear()
        if scope.get('kind') == 'SPORT_FAMILY':
            heads[scope['family']] = version
    return heads


def imported_submission_ids(session, preview_for=lambda version: json.loads(version.preview_json or "{}")):
    imported = {h.version_id for h in session.history if h.event_type=='IMPORTED'}
    for version in session.versions:
        preview = preview_for(version)
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


def import_queue_rows(event_id, decision_id=None):
    """Return stored workflow facts for the queue, without loading preview bodies."""
    from collections import defaultdict
    from types import SimpleNamespace
    from sqlalchemy import case, cast, column, func, JSON, true
    from models import ImportApproval, ImportSession, ImportSessionEvent

    session, version, history, approval = ImportSession, ImportSessionVersion, ImportSessionEvent, ImportApproval
    sessions = (db.session.query(session.id, session.nation, session.status, session.discipline,
                                 session.created_at, session.current_version_id)
                .filter(session.event_id == event_id).order_by(session.created_at.desc()).all())
    if not sessions:
        return []

    preview = func.json_to_record(cast(func.nullif(version.preview_json, ''), JSON)).table_valued(
        column('replacementScope', JSON), column('submissionSources', JSON),
        column('_workflow', JSON), column('errors', JSON), column('warnings', JSON),
    ).render_derived(with_types=True).lateral()
    current = version.id == session.current_version_id
    versions = defaultdict(list)
    for row in db.session.query(
        version.id, version.session_id, version.version, version.uploaded_by, version.created_at,
        func.json_build_object('replacementScope', preview.c.replacementScope,
            'submissionSources', preview.c.submissionSources,
            '_workflow', func.json_build_object('state', preview.c._workflow['state'])).label('facts'),
        case((current, func.json_array_length(preview.c.errors))).label('errors'),
        case((current, func.json_array_length(preview.c.warnings))).label('warnings'),
    ).select_from(version).join(session, session.id == version.session_id).outerjoin(preview, true()).filter(session.event_id == event_id):
        versions[row.session_id].append(row)

    history_by_session, superseded = defaultdict(list), set()
    for row in db.session.query(history.session_id, history.version_id, history.approval_id, history.event_type).join(
            session, session.id == history.session_id).filter(session.event_id == event_id,
            history.event_type.in_(('ARCHIVED', 'IMPORTED', 'QUOTA_DECISION_REVISED_FROM'))):
        if row.event_type == 'QUOTA_DECISION_REVISED_FROM':
            superseded.add((row.session_id, row.approval_id))
        else:
            history_by_session[row.session_id].append(row)

    pending = defaultdict(int)
    for row in db.session.query(approval.session_id, approval.id).join(session, session.id == approval.session_id).filter(
            session.event_id == event_id, approval.version_id == session.current_version_id,
            approval.decision == 'PENDING', approval.approval_type != 'QUOTA_OFFICIALS_EXCEEDED',
            ~approval.description.startswith('Officials überschritten')):
        if (row.session_id, row.id) not in superseded:
            pending[row.session_id] += 1

    decision_session_id = None
    if decision_id:
        decision_session_id = db.session.query(approval.session_id).join(session, session.id == approval.session_id).filter(
            session.event_id == event_id, approval.id == decision_id).scalar()

    result = []
    for row in sessions:
        items = versions[row.id]
        current_version = next((item for item in items if item.id == row.current_version_id), None)
        state = SimpleNamespace(versions=items, history=history_by_session[row.id], status=row.status)
        heads = submission_heads(state, lambda item: item.facts) if row.status != 'CANCELLED' else {}
        imported = imported_submission_ids(state, lambda item: item.facts) if heads else set()
        result.append(dict(id=str(row.id), nation=row.nation, status=row.status, discipline=row.discipline,
            currentVersionId=str(row.current_version_id) if row.current_version_id is not None else None,
            version=current_version.version if current_version else 0,
            uploadedAt=(current_version.created_at if current_version else row.created_at).isoformat() + 'Z',
            uploadedBy=current_version.uploaded_by if current_version else '',
            errors=(current_version.errors or 0) if current_version else 0,
            warnings=(current_version.warnings or 0) if current_version else 0,
            pendingDecisions=pending[row.id], hasOpenSubmissions=any(item.id not in imported for item in heads.values()),
            **({'matchesDecision': True} if row.id == decision_session_id else {})))
    return result


def merge_submission_previews(versions, *, consistency_only=False, read_context=None, read_only=False, allow_unresolved=None):
    """Compose parsed sources; reuse the existing exact identity matcher.

    No live writes, quota decisions or date/room guessing happen here. Source
    provenance survives canonical person/room keys and overlapping row numbers.
    """
    from types import SimpleNamespace
    from .identity import _build_existing_athlete_maps, _find_existing_athlete
    from .normalization import normalize_string, parse_date
    from quota_service import normalize_gender
    from .change_plan import digest
    if not versions:
        raise ImportValidationError('IMPORT_REVIEW_REQUIRED', 'Mindestens eine aktuelle Teilmeldung auswählen.')
    sources = [(v, load_version_preview(v)) for v in sorted(versions,key=lambda v:(json.loads(v.preview_json).get('replacementScope',{}).get('family',''),v.id))]
    from excel_import import apply_preview_rates, apply_preview_requirements, apply_single_room_quota_exemptions, _match_room_partner
    context=read_context or ImportReadContext(versions[0].session.event_id)
    if context.event_id!=versions[0].session.event_id:
        raise ImportValidationError('IMPORT_EVENT_MISMATCH','Fremder Kontext für die Teilmeldungen.')
    from .official_links import source_view, proposals, issue_proposal
    for version,source in sources:
        candidates=proposals(source.get('people',[]),(source.get('replacementScope') or {}).get('family'),version.session,context)
        if candidates:
            if read_only:
                raise ImportValidationError('OFFICIAL_IDENTITY_REVIEW_REQUIRED',
                    'Mögliche identische Officials benötigen eine geprüfte Zuordnung.')
            issue_proposal(version.session,candidates)
    sources=[(v,source_view(s,(s.get('replacementScope') or {}).get('family'),context)) for v,s in sources]
    shared_issues=[]
    unresolved_warnings=[]
    allow_unresolved = not consistency_only if allow_unresolved is None else allow_unresolved
    imported=imported_submission_ids(versions[0].session)
    prior_unresolved_keys = None

    def unchanged_unresolved_keys():
        # Only a previously imported joint snapshot can establish that these
        # exact files carried the same exception for this person.
        by_id = {v.id: v for v in versions_after_archive(versions[0].session)}
        current_hashes = {v.source_hash for v, _ in sources}
        if None in current_hashes or len(current_hashes) != len(sources):
            return set()
        keys = set()
        for version_id in sorted(imported & by_id.keys(), reverse=True):
            facts = json.loads(by_id[version_id].preview_json or '{}')
            if (facts.get('_workflow') or {}).get('state') != 'IMPORTED':
                continue
            source_ids = list((facts.get('submissionSources') or {}).values())
            if (len(source_ids) != len(sources) or any(i not in by_id for i in source_ids)
                    or {by_id[i].source_hash for i in source_ids} != current_hashes):
                break
            keys.update(p['matchKey'] for p in facts.get('people', []) if p.get('unresolvedSourceAccommodation'))
            if keys:
                break
        return keys

    def compatible_partner(person, source, start, end, *, identical=False, importing_remaining=False):
        key = person['matchKey']
        rooms = [r for r in source.get('rooms', []) if key in (r.get('person1Key'), r.get('person2Key'))]
        if any(parse_date(r.get('checkInDate')) != start or parse_date(r.get('checkOutDate')) != end for r in rooms):
            return False
        paired = [r for r in rooms if r.get('person2Key') or r.get('sharedWithRawName')]
        if not paired:
            return not person.get('sharedWithName')
        if len(rooms) != 1 or normalize_string(person.get('roomType')) != 'double shared':
            return False
        room = paired[0]
        if (normalize_string(room.get('roomType')) != 'double shared'
                or any(room.get(field) and parse_date(room[field]) != expected
                       for field, expected in (('sharedArrivalSource', start), ('sharedDepartureSource', end)))):
            return False
        members = [next((p for p in source['people'] if p['matchKey'] == room.get(field)), None)
                   for field in ('person1Key', 'person2Key')]
        if (not all(members) or members[0]['matchKey'] == members[1]['matchKey']
                or _match_room_partner(room.get('sharedWithRawName'), person['nationCode'], source['people']) is not members[1]):
            return False
        for member, other in (members, members[::-1]):
            evidence = member.get('entryAccommodationSource') or member
            named = evidence.get('sharedWithName')
            if (member['nationCode'] != person['nationCode']
                    or not (member.get('fisCode') or member.get('competitorId'))
                    or parse_date(member.get('arrivalDate')) != start or parse_date(member.get('departureDate')) != end
                    or normalize_string(evidence.get('roomType')) != 'double shared'
                    or (named and _match_room_partner(named, person['nationCode'], source['people']) is not other)
                    or member['matchKey'] in source.get('accommodationRequirementOverrides', {})
                    or any(r is not room and member['matchKey'] in (r.get('person1Key'), r.get('person2Key')) for r in source['rooms'])):
                return False
            existing = _find_existing_athlete(member, context.athlete_maps)
            if existing and not (
                    (identical and not existing.room_booking_memberships and not existing.single_room_decision_id
                     and not existing.accommodation_rate_approval_id)
                    or (importing_remaining and member['matchKey'] in imported_keys and can_defer_imported_requirement(existing))):
                return False
        return True

    def project_source(people,version,source):
        if version.id in imported:
            source.pop('accommodationRateOverrides',None)
            source.pop('accommodationRequirementOverrides',None)
        imported_source=version.id in imported
        apply_preview_rates(people,None if imported_source else source.get('accommodationRateOverrides'),read_context=context)
        original_rooms = [(evidence.get('roomType'), evidence.get('sharedWithName'))
                          for p in people for evidence in (p.get('entryAccommodationSource') or p,)]
        apply_preview_requirements(people,source['rooms'],None if imported_source else source.get('accommodationRequirementOverrides'),read_context=context)
        for p, (room_type, partner_name) in zip(people, original_rooms):
            if p['accommodationRequirement'] == 'UNRESOLVED':
                p.update(roomType=room_type, sharedWithName=partner_name)
        apply_single_room_quota_exemptions(people,event_id=context.event_id,read_context=context)
    if not consistency_only:
        for version,source in sources:project_source(source['people'],version,source)
    imported_keys = {p['matchKey'] for version, source in sources if version.id in imported for p in source['people']}
    result = deepcopy(sources[0][1])
    people, rooms, aliases, records, partner_checks = [], [], {}, [], []
    source_only_keys = set()
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
                from .shared_accommodation import harmonize_missing,issue
                prior_version,prior_source=next((v,s) for v,s in sources if v.id==target['sourceRows'][0]['versionId'])
                left,right=harmonize_missing(target,incoming,prior_source,source)
                if target.get('sharedWithName') and incoming.get('sharedWithName') and normalize_string(target['sharedWithName'])!=normalize_string(incoming['sharedWithName']):
                    partner_checks.append((target['sourceRows'][0]['versionId'],target['matchKey'],version.id,original['matchKey']))
                conflicts = [field for field in critical if comparable(target,field) != comparable(incoming,field)
                             and not (field in {'roomType','sharedWithName'} and (not target.get(field) or not incoming.get(field)))]
                if left and right and left!=right and 'accommodationRequirement' not in conflicts:conflicts.append('accommodationRequirement')
                linked=target.get('confirmedOfficialLinkId') or incoming.get('confirmedOfficialLinkId')
                housing={'roomType','accommodationRequirement','arrivalDate','departureDate'}
                can_defer = False
                retained_decision = None
                deferred_imported_id = None
                if (allow_unresolved and conflicts and set(conflicts) <= {'roomType', 'accommodationRequirement'}
                        and {left, right} == {'REQUIRED', 'NO_ROOM'}
                        and {comparable(p, 'roomType') for p in (target, incoming)} == {'double shared', 'no room'}):
                    strong_identity = linked or any(target.get(key) and target[key] == incoming.get(key)
                                                    for key in ('fisCode', 'competitorId'))
                    agreed_start, agreed_end = parse_date(target.get('arrivalDate')), parse_date(target.get('departureDate'))
                    if strong_identity and agreed_start and agreed_end and agreed_start < agreed_end:
                        existing, other = (_find_existing_athlete(p, context.athlete_maps) for p in (target, incoming))
                        same_person = existing is not None and other is not None and existing.id == other.id
                        if same_person and not existing.room_booking_memberships:
                            if prior_unresolved_keys is None:
                                prior_unresolved_keys = unchanged_unresolved_keys()
                        identical = bool(same_person and prior_unresolved_keys and target['matchKey'] in prior_unresolved_keys
                                         and not existing.room_booking_memberships)
                        imported_requirement = (left if prior_version.id in imported and version.id not in imported
                                                else right if version.id in imported and prior_version.id not in imported else None)
                        importing_remaining = bool(
                            same_person and imported_requirement
                            and existing.accommodation_requirement == existing.accommodation_requirement_import_value
                            and existing.accommodation_requirement in {imported_requirement, 'UNRESOLVED'}
                            and can_defer_imported_requirement(existing)
                            and existing.arrival_date == agreed_start and existing.departure_date == agreed_end
                        )
                        safe_conflict = all(
                            p['matchKey'] not in facts.get('accommodationRequirementOverrides', {})
                            and compatible_partner(p, facts, agreed_start, agreed_end, identical=identical, importing_remaining=importing_remaining)
                            for p, facts in ((target, prior_source), (incoming, source))
                        )
                        can_defer = safe_conflict and ((existing is None and other is None) or importing_remaining)
                        if can_defer and importing_remaining:
                            deferred_imported_id = existing.id
                        if safe_conflict and identical and (
                            (existing.accommodation_requirement_source == 'MANUAL' and existing.accommodation_requirement in REQUIREMENTS)
                            or existing.accommodation_requirement == 'UNRESOLVED'
                        ):
                            retained_decision = existing
                if can_defer or retained_decision is not None:
                    source_only_keys.add(target['matchKey'])
                if can_defer or (retained_decision is not None and retained_decision.accommodation_requirement == 'UNRESOLVED'):
                    warning = issue(target, incoming, conflicts, left, right)
                    warning['code'] = 'IMPORT_SHARED_ACCOMMODATION_UNRESOLVED'
                    warning['message'] = 'Person kann importiert werden. Unterkunftsbedarf bleibt offen; Disposition erst nach Entscheidung im Athletendetail.'
                    unresolved_warnings.append(warning)
                    if deferred_imported_id is not None:
                        target['deferredImportedPersonId'] = deferred_imported_id
                    target.update(
                        unresolvedSourceAccommodation=can_defer, accommodationRequirement="UNRESOLVED",
                        roomType=None, sharedWithName=None,
                    )
                elif retained_decision is not None:
                    target.update(roomType=retained_decision.room_type, sharedWithName=retained_decision.shared_with_name)
                elif conflicts and linked and set(conflicts)<=housing:
                    shared_issues.append(issue(target,incoming,conflicts,left,right))
                elif conflicts:
                    raise ImportValidationError('IMPORT_SHARED_PERSON_CONFLICT', 'Widersprüchliche Personen-, Aufenthalts- oder Zimmerangaben in den Teilmeldungen.',
                        details={'fields':conflicts,'sourceRows':target['sourceRows']+incoming['sourceRows']})
                for field in ('fisCode','competitorId','roomType','sharedWithName'):
                    if not target.get(field) and not ((can_defer or retained_decision is not None) and field in {'roomType', 'sharedWithName'}):
                        target[field]=incoming.get(field)
                for field in ('competitionIds','competitionImportCodes','affirmativeWscColumns'):
                    target[field]=sorted(set(target.get(field,[]))|set(incoming.get(field,[])),key=str)
                target['sourceRows'] += incoming['sourceRows']
                if linked:
                    target['confirmedOfficialLinkId']=linked
                    target['sourceIdentities']=target.get('sourceIdentities',[])+incoming.get('sourceIdentities',[])
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
            linked_keys={p['matchKey'] for p in people if p.get('confirmedOfficialLinkId')}
            if aliases.get((left,left_key)) in linked_keys:
                shared_issues.append(dict(code='IMPORT_SHARED_ACCOMMODATION_CONFLICT',message='Zimmerpartnerangaben unterscheiden sich zwischen den Quellen; Klärung erforderlich.',details={'personKey':aliases.get((left,left_key))}))
            else:
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
                    linked_keys={p['matchKey'] for p in people if p.get('confirmedOfficialLinkId')}
                    if set(keys) & linked_keys:
                        shared_issues.append(dict(code='IMPORT_SHARED_ACCOMMODATION_CONFLICT',message='Widersprüchliche explizite Zimmerzuordnungen; keine automatische Übernahme.',details={'sourceVersionId':version.id,'row':room.get('rowNumber')}))
                    else:
                        raise ImportValidationError('IMPORT_SHARED_PERSON_CONFLICT','Widersprüchliche Zimmerzuordnungen in den Teilmeldungen.',details={'sourceVersionId':version.id,'row':room.get('rowNumber')})
            source_rows = [
                {**entry, 'versionId': version.id, 'version': version.version}
                for entry in room.get('sourceRows', [{'row': room.get('rowNumber')}])
            ]
            previous=by_signature.get(signature)
            if previous:
                previous['room']['sourceRows'].extend(source_rows)
                continue
            room['sourceRows']=source_rows
            room['sourceRowKey']=signature
            item={'signature':signature,'room':room,'versionId':version.id,'keys':keys}
            for key in keys:room_for_person.setdefault(key,[]).append(item)
            by_signature[signature]=item
            rooms.append(room)
    source_only_participants = set()
    for room in rooms:
        members = {room.get('person1Key'), room.get('person2Key')}
        if room.get('person2Key') and members & source_only_keys:
            room['sourceOnlyPartner'] = True
            source_only_participants.update(members)
    for person in people:
        if person['matchKey'] in source_only_participants:
            person['sourceOnlyPartner'] = True
            person['sharedWithName'] = None
    cancellations = [{**p, 'sourceVersionId': v.id} for v, source in sources for p in source.get('cancelledPeople', [])]
    if cancellations:
        result['cancelledPeople'] = cancellations
    else:
        result.pop('cancelledPeople', None)
    result.update(people=people,rooms=rooms,roomListHasNoData=all(p.get('roomListHasNoData') for p in people))
    for field in ('errors','warnings'):
        result[field]=[{**item,'sourceVersionId':v.id} for v,s in sources for item in s.get(field,[]) if not (field=='errors' and len(sources)>1 and (item.get('details') or {}).get('singleScopeReview'))]
    result['warnings'] += unresolved_warnings
    result['errors'] += shared_issues
    if shared_issues:result['isValid']=False
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
        merged=merge_submission_previews(list(submission_heads(session).values()), consistency_only=True,
            allow_unresolved=bool(preview.get('submissionSources')))
        conflicts=[e for e in merged.get('errors',[]) if e.get('code') in {'IMPORT_SHARED_ACCOMMODATION_CONFLICT','IMPORT_SHARED_STAY_SECTIONS'}]
        if conflicts:raise ImportValidationError(conflicts[0]['code'],conflicts[0]['message'],details={'issues':conflicts})


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
            'reason':p.get('removalReason') or 'Im bestätigten vollständigen Nationen-Snapshot nicht mehr gemeldet'} for p in plan['people']['remove']]
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
