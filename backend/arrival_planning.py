"""Provisional real-person housing selection. No admission or booking writes.

Operational policy: Officials' EZ tiers must use actual arriving Officials,
capped by their admissible contingent. Officials continue to be planned as named people.
"""
from collections import defaultdict
import hashlib
import json

from accommodation_requirements import NO_ACCOMMODATION
from accommodation_scope import accommodation_event_id, event_query
from competitions import quota_disciplines, competition_athlete_family
from imports.normalization import canonical_fis_code
from models import Athlete, AthleteArrivalForecast, Event, RoomBookingOccupant, db
from quota_rules import fingerprint
from quota_service import is_athlete, normalize_gender
from world_champions import applicable_title_references


def area_id(event_id, nation, discipline, gender):
    return hashlib.sha256(json.dumps([event_id,nation,discipline,gender],ensure_ascii=False).encode()).hexdigest()[:32]


def forecast_values(row):
    return dict(expectedTotal=row.expected_total,checkInDate=row.check_in_date.isoformat() if row.check_in_date else None,
                checkOutDate=row.check_out_date.isoformat() if row.check_out_date else None,note=row.note,
                revision=row.revision,updatedBy=row.updated_by,updatedAt=row.updated_at.isoformat()+'Z') if row else dict(
                    expectedTotal=None,checkInDate=None,checkOutDate=None,note=None,revision=0,updatedBy=None,updatedAt=None)



def imported_entry_rows(nation=None):
    """Replay only committed source replacements, not the current review draft.

    Each family keeps its own file order. Cross-family people are subsequently
    clarification cases, so unrelated source files need no invented global order.
    Archived sessions retain their successfully imported evidence.
    """
    from models import ImportSession, ImportSessionEvent, ImportSessionVersion
    owner = accommodation_event_id()
    query = (db.session.query(ImportSessionEvent, ImportSessionVersion)
        .join(ImportSessionVersion, ImportSessionEvent.version_id == ImportSessionVersion.id)
        .join(ImportSession, ImportSessionVersion.session_id == ImportSession.id)
        .filter(ImportSession.event_id == owner, ImportSessionEvent.session_id == ImportSessionVersion.session_id, ImportSessionEvent.event_type == 'IMPORTED'))
    if nation:
        query = query.filter(ImportSession.nation == nation)
    sources = {}
    for history, version in query.order_by(ImportSessionEvent.created_at, ImportSessionEvent.id):
        preview = json.loads(version.preview_json or '{}')
        scope = preview.get('replacementScope') or {}
        code = version.session.nation
        if scope.get('kind') == 'FULL_NATION':
            sources[code] = {'FULL': preview.get('people', [])}
        elif scope.get('kind') == 'SPORT_FAMILY':
            families = scope.get('families') or [scope.get('family')]
            previous = sources.setdefault(code, {})
            # A prior full list contributes only the families not replaced now.
            if 'FULL' in previous:
                from models import Competition
                comps = {str(c.id): c for c in Competition.query.all()}
                for record in previous.pop('FULL'):
                    groups = {competition_athlete_family(comps[str(cid)]) for cid in record.get('competitionIds', []) if str(cid) in comps}
                    for family in groups - set(families):
                        previous.setdefault(family, []).append(record)
            for family in families:
                source_id = (preview.get('submissionSources') or {}).get(family)
                source = db.session.get(ImportSessionVersion, source_id) if source_id else None
                previous[family] = json.loads(source.preview_json).get('people', []) if source else preview.get('people', [])
    return [p for code in sorted(sources) for family in sorted(sources[code]) for p in sources[code][family]]



def entry_position(record):
    """Original source row only; conflicting provenance is never a tie-breaker."""
    row=record.get('sourceRowNumber') or record.get('rowNumber')
    if type(row) is int and row>0:return row
    rows={source.get('row') for source in record.get('sourceRows',[]) if type(source.get('row')) is int and source['row']>0}
    return next(iter(rows)) if len(rows)==1 else None

def provisional_selection(people, event, entry_rows, booked):
    """Select real people in source order; booking facts are never modified."""
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    from imports.event_context import ImportValidationError
    from quota_rules import athlete_housing_limit
    from sport_entry_plausibility import project_entries
    by_id = {str(p.id): p for p in people}
    maps = _build_existing_athlete_maps(people, event_id=event.id)
    provenance = {}
    entered_competitions = defaultdict(set)
    for record in entry_rows:
        if not is_athlete(record):
            continue
        try:
            person = _find_existing_athlete(record, maps)
        except ImportValidationError:
            continue  # Missing evidence is surfaced below, never guessed.
        if not person or record.get('nationCode') != person.nation_code:
            continue
        entered_competitions[str(person.id)].update(str(cid) for cid in record.get('competitionIds', []))
        row = entry_position(record)
        if type(row) is int and row > 0:
            provenance.setdefault(str(person.id), []).append(row)
    records = [dict(personId=p.id, matchKey=str(p.id), fisCode=p.fis_code,
        nationCode=p.nation_code, gender=p.gender, function=p.function,
        competitionMemberships=[dict(competitionId=c.id) for c in p.competitions if str(c.id) in entered_competitions[str(p.id)]]) for p in people]
    from models import Competition
    comps = {c.id:c for c in Competition.query.all()}
    champions = {c['personKey'] for entries in project_entries(records, comps, event).values()
                 for entry in entries for c in entry['champions']}
    groups = defaultdict(list)
    for identity, person in by_id.items():
        disciplines = quota_disciplines(person.competitions)
        gender = normalize_gender(person.gender)
        families={competition_athlete_family(c) for c in person.competitions}-{None}
        key = (person.nation_code, disciplines[0], gender) if len(disciplines)==1 and len(families)==1 and gender in {'M','W'} and all(c.quota_discipline and competition_athlete_family(c) for c in person.competitions) else (person.nation_code,None,None)
        groups[key].append(identity)
    result = {}
    booked_ids = {str(identity) for identity in booked}
    for key, ids in groups.items():
        retained = set(ids) & booked_ids
        skipped = {identity for identity in ids if by_id[identity].accommodation_requirement == 'NO_DISPO'}
        eligible_ids = set(ids) - (skipped - retained)
        limit=athlete_housing_limit(json.loads(event.quota_rules_json or '{}'),key[1])
        reasons = []
        if not all(key):
            reasons.append('Keine eindeutige Event-Group-/Gender-Zuordnung; Unterkunftsbedarf klären.')
        if any(i not in provenance for i in eligible_ids):
            reasons.append('Keine aktuelle bestätigte Importreihenfolge für alle Personen nachweisbar.')
        positions = {i:min(provenance[i]) for i in eligible_ids if i in provenance}
        if len(set(positions.values())) != len(positions):
            reasons.append('Importreihenfolge im Planungsbereich nicht eindeutig.')
        ordered = sorted(eligible_ids, key=lambda i: positions.get(i, 0))
        eligible = eligible_ids & champions & provenance.keys()
        regular = [i for i in ordered if i not in eligible]
        automatic = set(regular[:limit]) | eligible
        # Existing regular bookings consume planned regular places. Do not add
        # new tasks beyond the configured total for an accommodated team.
        selected = retained | eligible
        slots = max(0, limit - len(retained - eligible))
        selected.update([i for i in regular if i not in retained][:slots])
        warnings = []
        if retained & skipped:
            warnings.append('Nicht einplanen steht im Konflikt mit einer bestehenden Buchung. Die Buchung bleibt erhalten.')
        if retained - automatic:
            warnings.append('Bestehende Buchungen weichen von der automatischen Listenauswahl ab; Bestand bleibt erhalten.')
        if len(retained - eligible) > limit:
            warnings.append('Mehr reguläre Personen gebucht als vorläufig vorgesehen; Unterkunftsbestand klären.')
        result[key] = dict(selectedPersonIds=sorted(selected) if not reasons else [],
            provisionalPersonIds=sorted(selected-retained) if not reasons else [],
            excludedPersonIds=sorted(set(ids)-selected if not reasons else skipped-retained),
            selectedCount=len(selected) if not reasons else None,
            # Retained bookings are physical stock, not extra regular quota slots.
            quotaAthleteCount=min(len(selected-eligible),limit)+len(eligible) if not reasons else None,
            selectedWorldChampionCount=len(eligible) if not reasons else 0,
            selectedWorldChampionIds=sorted(eligible) if not reasons else [],
            selectionReasons=reasons, selectionWarnings=warnings)
    return result

def project(nation=None, *, people_override=None, entry_rows=None):
    owner=accommodation_event_id()
    query=event_query(Athlete).options(db.selectinload(Athlete.competitions))
    forecasts=event_query(AthleteArrivalForecast)
    if nation:
        query=query.filter_by(nation_code=nation);forecasts=forecasts.filter_by(nation_code=nation)
    people=[p for p in (query.all() if people_override is None else people_override) if is_athlete({'function':p.function})]
    titles=defaultdict(list)
    for title in applicable_title_references(db.session.get(Event,owner),[p.fis_code for p in people if p.fis_code]):
        titles[canonical_fis_code(title.fis_code)].append(title.to_dict())
    booked={row[0] for row in event_query(RoomBookingOccupant).with_entities(RoomBookingOccupant.athlete_id).distinct()}
    event=db.session.get(Event,owner)
    if entry_rows is not None:
        from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
        maps=_build_existing_athlete_maps(people,event_id=owner)
        from imports.event_context import ImportValidationError
        incoming_ids=set()
        for record in entry_rows:
            try:person=_find_existing_athlete(record,maps)
            except ImportValidationError:continue
            if person and entry_position(record) is not None:incoming_ids.add(person.id)
        retained=[]
        for record in imported_entry_rows(nation):
            try:person=_find_existing_athlete(record,maps)
            except ImportValidationError:continue  # Removed historical identities are not current preview people.
            if person and person.id not in incoming_ids:retained.append(record)
        entry_rows=list(entry_rows)+retained
    selection=provisional_selection(people,event,imported_entry_rows(nation) if entry_rows is None else entry_rows,booked)
    groups={}
    for person in people:
        disciplines=quota_disciplines(person.competitions)
        families=sorted({competition_athlete_family(c) for c in person.competitions}-{None})
        gender=normalize_gender(person.gender)
        reasons=[]
        if not (person.nation_code or '').strip():reasons.append('Nation fehlt; Planungsbereich klären.')
        if len(disciplines)!=1:reasons.append('Mehrere Event Groups: gemeinsame Unterkunftszuordnung klären.' if disciplines else 'Keine Event Group zuordenbar.')
        if any(not c.quota_discipline or not competition_athlete_family(c) for c in person.competitions):reasons.append('Wettbewerbszuordnung nicht eindeutig auflösbar.')
        if gender not in {'M','W'}:reasons.append('Persönliches Gender fehlt oder ist nicht eindeutig.')
        if len(families)>1:reasons.append('Sportfamilienübergreifende Zuordnung; gemeinsamen Unterkunftsbedarf klären.')
        # All ambiguous people enter a single exclusive clarification bucket per nation.
        key=(person.nation_code,None,None) if reasons else (person.nation_code,disciplines[0],gender)
        entry=groups.setdefault(key,[])
        entry.append(dict(personId=str(person.id),name=f'{person.firstname} {person.lastname}',
                          personalGender=person.gender,disciplines=disciplines,sportFamilies=families,
                          worldChampionMarked=person.single_room_quota_exempt_reason=='WORLD_CHAMPION',
                          titleReferences=titles.get(canonical_fis_code(person.fis_code),[]),reasons=reasons,
                          hasBooking=person.id in booked))
    saved={(f.nation_code,f.discipline,f.gender):f for f in forecasts.all()}
    rows=[]
    for key in sorted(set(groups)|set(saved),key=lambda k:tuple(v or '' for v in k)):
        members=sorted(groups.get(key,[]),key=lambda p:p['personId'])
        forecast=saved.get(key);values=forecast_values(forecast)
        expected=values['expectedTotal']
        reasons=[]
        if key[1] is None:
            reasons.append('Klärungsbereich: keine sichere überschneidungsfreie Zuordnung. Keine Prognose bearbeitbar.')
            reasons.extend(sorted({reason for person in members for reason in person['reasons']}))
        roster_digest=fingerprint([{'personId':p['personId'],'gender':normalize_gender(p['personalGender']),'disciplines':p['disciplines']} for p in members])
        chosen=selection.get(key,dict(selectedPersonIds=[],provisionalPersonIds=[],excludedPersonIds=[],selectedCount=None,quotaAthleteCount=None,selectedWorldChampionCount=0,selectedWorldChampionIds=[],selectionReasons=['Gespeicherter Bereich ohne aktuelle Meldungen.'],selectionWarnings=[]))
        reasons.extend(chosen['selectionReasons'])
        legacy=expected is not None or bool(values['checkInDate'] or values['note'])
        families=sorted({f for p in members for f in p['sportFamilies']})
        rows.append(dict(areaId=area_id(owner,*key),eventId=str(owner),nationCode=key[0],discipline=key[1],personalGender=key[2],
                         sportFamilies=families,reportedCount=len(members),bookedPeopleCount=sum(p['hasBooking'] for p in members),
                         usesVirtualPlanning=False,virtualPlaces=0,
                         replacedPersonIds=chosen['excludedPersonIds'],**chosen,legacyForecastInactive=legacy,
                         status='CONFLICT' if reasons or chosen['selectionWarnings'] else 'PLANNED',conflict=bool(reasons),reasons=reasons+chosen['selectionWarnings'],
                         source='IMPORTED_ENTRY_LIST',editable=key[1] is not None,people=members,
                         worldChampionCount=sum(p['worldChampionMarked'] or bool(p['titleReferences']) for p in members),
                         rosterDigest=roster_digest,baseToken=fingerprint({'forecast':values,'people':members}),**values))
    return dict(eventId=str(owner),nationCode=nation,rows=rows,
                reportedCount=len(people))


class ForecastConflict(ValueError):
    pass


def save(area, data, username, *, commit=True):
    raise ValueError('Manuelle NN-Prognosen sind abgelöst; die bestätigte Entry List bestimmt die vorläufige Personenauswahl.')


def operative_projection(overview):
    """One shared real-person selection for queue and accommodation predicates."""
    rows=overview['rows']
    return dict(replacedPersonIds=sorted({i for row in rows for i in row['replacedPersonIds']}),
        provisionalPersonIds=sorted({i for row in rows for i in row['provisionalPersonIds']}),
        worldChampionPersonIds=sorted({i for row in rows for i in row['selectedWorldChampionIds']}),
        groups=[row for row in rows if row['reasons']], controlledAreas=len(rows),
        zeroAreas=0,zeroGroups=[],virtualPlaces=0,conflicts=sum(bool(row['reasons']) for row in rows))



def project_import_people(people, context, nation=None):
    """Same effective roster adapter for visible checks and binding requirements."""
    from types import SimpleNamespace
    records=[]
    for index,person in enumerate(people):
        if nation and person.get('nationCode')!=nation:continue
        ids=person.get('competitionIds',[])
        records.append(SimpleNamespace(id=person.get('existingAthleteId') or 'preview:'+str(person.get('matchKey',index)),event_id=context.event_id,competitor_id=person.get('competitorId'),
            nation_code=person.get('nationCode'),function=person.get('function'),firstname=person.get('firstname',''),lastname=person.get('lastname',''),
            gender=person.get('gender'),fis_code=person.get('fisCode'),accommodation_requirement=person.get('accommodationRequirement'),single_room_quota_exempt_reason=person.get('singleRoomQuotaExemptReason'),
            competitions=[context.competitions_by_id[int(cid)] for cid in ids if str(cid).isdecimal() and int(cid) in context.competitions_by_id]))
    return project(nation,people_override=records,entry_rows=people)


def import_projection(session, preview, control, *, live=False, read_context=None, choices=None):
    """Same selection over effective parsed people, never a preview write."""
    from imports.read_context import ImportReadContext
    context=read_context or ImportReadContext(session.event_id)
    if live:
        result=project(session.nation)
    else:
        result=project_import_people(preview.get('evaluationPeople',preview.get('people',[])),context,session.nation)
    # Retire old editing clients explicitly; historical forecast rows stay intact.
    if choices:
        prepare_import_decisions(session,result,choices)
    for row in result['rows']:
        row['quotaHints']=[dict(name=c['name'],regularMax=entry['regularMax']) for c in control.get('competitions',[]) if c.get('group')==row['discipline'] and normalize_gender(c.get('gender'))==row['personalGender']
            for entry in c.get('sportEntries',[]) if entry.get('nation')==session.nation]
    roster=[];demands=[]
    if live:
        from approval_projection import projected_approval_groups
        from quota_history import person_keys
        for person in context.athletes:
            if session.nation and person.nation_code!=session.nation:continue
            record=dict(personId=person.id,matchKey=person.fis_code or person.competitor_id or next(iter(sorted(person_keys(person))),str(person.id)),nationCode=person.nation_code,function=person.function,
                gender=person.gender,quotaDisciplines=quota_disciplines(person.competitions),accommodationRequirement=person.accommodation_requirement,singleRoomQuotaExemptReason=person.single_room_quota_exempt_reason)
            roster.append(record)
            groups=projected_approval_groups(person.single_room_decision,person,roster=context.athletes)
            demands.append(dict(record,countsAsSingle=any(m.room_booking.counts_as_single for m in person.room_booking_memberships) or (person.accommodation_requirement not in NO_ACCOMMODATION and str(person.room_type or '').strip().lower()=='single'),
                singleRoomStatus=person.single_room_status,approvedQuotaContexts=[dict(nationCode=n,discipline=d,gender=g) for n,d,g in groups]))
    else:
        allocations={item['personKey']:item for check in preview.get('quotaChecks',[]) for item in check.get('singleRoomAllocations',[])}
        for person in preview.get('evaluationPeople',preview.get('people',[])):
            if person.get('nationCode')!=session.nation:continue
            record=dict(person,discipline=person.get('industryName'))
            roster.append(record)
            allocation=allocations.get(person.get('matchKey')) or person.get('singleRoomAllocation') or {}
            approved=allocation.get('status')=='APPROVED_EXTRA'
            ctx=allocation.get('context')
            demands.append(dict(record,countsAsSingle=bool(allocation),singleRoomStatus='APPROVED_EXTRA' if approved else None,
                approvedQuotaContexts=[dict(nationCode=ctx[0],discipline=ctx[1],gender=ctx[2])] if approved and ctx else []))
    from quota_rules import rules_for_event
    result['operationalQuota']=operational_quota_projection(result,roster,demands,rules_for_event(session.event_id),event=db.session.get(Event,session.event_id))
    result.update(versionId=str(session.current_version_id),mode='LIVE' if live else 'IMPORT',decisions=[] if live else (preview.get('_workflow') or {}).get('nnPlanning',[]))
    return result


def operational_athlete_basis(overview):
    """Only verified, exclusive selections override the normal distinct roster."""
    return {(row['nationCode'],row['discipline'],row['personalGender']):row.get('quotaAthleteCount',row['selectedCount'])
        for row in overview['rows'] if row['editable'] and not row['conflict'] and row['selectedCount'] is not None}


def operational_quota_projection(overview, roster, demands, rules, *, event=None):
    """Read-only alternative basis; allocation and formulas stay in quota_service."""
    from quota_service import evaluate_quota_usage,quota_gender_errors
    errors=quota_gender_errors(roster)
    if errors:return dict(rows=[],conflict=True,reasons=[e['message'] for e in errors])
    excluded={i for row in overview['rows'] for i in row['replacedPersonIds']}
    demands=[p for p in demands if p.get('accommodationRequirement') != 'NO_DISPO' and str(p.get('existingAthleteId') or p.get('personId') or 'preview:'+str(p.get('matchKey'))) not in excluded]
    bases=operational_athlete_basis(overview)
    official=evaluate_quota_usage(roster,demands,rules)
    operative=evaluate_quota_usage(roster,demands,rules,operational_athletes=bases,include_unallocated=True,include_allocations=True)
    by_key={(row['nationCode'],row['discipline'],row['gender']):row for row in official}
    blocked={(r['nationCode'],r['discipline'],r['personalGender']) for r in overview['rows'] if r['conflict']}
    for row in operative['rows']:
        row['nnForecastBlocked']=(row['nationCode'],row['discipline'],row['gender']) in blocked
        previous=by_key[(row['nationCode'],row['discipline'],row['gender'])]
        row.update(fisOfficialQuota=previous['officialQuota'],fisSingleRoomsAllowed=previous['singleRoomsAllowed'],
            singleRoomsRequested=len(row['singleRoomAllocations']),
            approvedExtraSingleRooms=sum(a['status']=='APPROVED_EXTRA' for a in row['singleRoomAllocations']),
            officialsExceeded=row['registeredOfficials']>row['officialQuota'],
            coverageChanged=any(a['status']!=next((p['status'] for p in previous['singleRoomAllocations'] if p['identity']==a['identity']),None) for a in row['singleRoomAllocations']))
    reasons=[reason for row in overview['rows'] if row['conflict'] for reason in row['reasons']]
    result=dict(rows=operative['rows'],conflict=bool(reasons or operative['unallocatedSingleRooms']),reasons=reasons,
        unallocatedSingleRooms=operative['unallocatedSingleRooms'])
    # Reuse the existing presentation aggregates and physical allocations. No
    # frontend quota arithmetic or replacement of the original FIS snapshot.
    from quota_service import person_identity
    by_identity={item['identity']:item for item in operative['singleRoomAllocations']}
    fields=('matchKey','personId','existingAthleteId','nationCode','singleRoomQuotaExemptReason','accommodationRequirement')
    result['people']=[dict({key:p.get(key) for key in fields},singleRoomAllocation=by_identity.get(person_identity(p,index))) for index,p in enumerate(roster)]
    if event is not None:
        from quota_overview import build_quota_overview
        checks=[dict(row,athletes=row['expectedAthletes'],singleRoomsApproved=row['approvedExtraSingleRooms']) for row in operative['rows']]
        result['overview']=build_quota_overview(roster,checks,[],event)
    return result



def prepare_import_decisions(session, overview, choices):
    from imports.event_context import ImportValidationError
    if not isinstance(choices,list) or choices:
        raise ImportValidationError('NN_PLANNING_RETIRED','Manuelle NN-Prognosen wurden durch automatische Personenauswahl abgelöst. Import erneut prüfen.')
    return []


def apply_import_decisions(session, decisions, username):
    # Old approved drafts must be reviewed again; never silently apply NN writes.
    prepare_import_decisions(session, None, decisions)
