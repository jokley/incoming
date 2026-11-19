"""Exclusive operative athlete forecasts. No admission, quota or booking writes.

Operational policy: Officials' EZ tiers must use actual arriving Officials,
capped by their admissible contingent. Officials continue to be planned as named people.
"""
from collections import defaultdict
from datetime import date, datetime
import hashlib
import json

from flask import abort, g
from sqlalchemy.exc import IntegrityError
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


def project(nation=None, *, people_override=None, expected_overrides=None):
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
        override=(expected_overrides or {}).get(area_id(owner,*key))
        if override is not None:values['expectedTotal']=override['expectedTotal']
        expected=values['expectedTotal']
        reasons=[]
        if key[1] is None:
            reasons.append('Klärungsbereich: keine sichere überschneidungsfreie Zuordnung. Keine Prognose bearbeitbar.')
            reasons.extend(sorted({reason for person in members for reason in person['reasons']}))
        roster_digest=fingerprint([{'personId':p['personId'],'gender':normalize_gender(p['personalGender']),'disciplines':p['disciplines']} for p in members])
        maintained=expected is not None or values['checkInDate'] or values['note']
        if forecast and maintained and override is None and forecast.roster_digest!=roster_digest:reasons.append('Gemeldeter Bestand oder Zuordnung seit der letzten Prognose geändert. Prognose prüfen und erneut speichern.')
        if forecast and maintained and not members:reasons.append('Gespeicherter Planungsbereich hat keine gemeldeten Athleten mehr. Prognose prüfen oder zurücksetzen.')
        virtual_planning=key[1] is not None and expected is not None and expected!=len(members)
        if virtual_planning and any(p['hasBooking'] for p in members):
            reasons.append('Abweichende NN-Planung mit bestehenden namentlichen Buchungen. Bestand zuerst klären; keine zusätzlichen virtuellen Plätze.')
        families=sorted({f for p in members for f in p['sportFamilies']})
        rows.append(dict(areaId=area_id(owner,*key),eventId=str(owner),nationCode=key[0],discipline=key[1],personalGender=key[2],
                         sportFamilies=families,reportedCount=len(members),bookedPeopleCount=sum(p['hasBooking'] for p in members),
                         usesVirtualPlanning=virtual_planning,virtualPlaces=expected if virtual_planning and not reasons else 0,
                         replacedPersonIds=[p['personId'] for p in members if virtual_planning and not reasons and not p['hasBooking']],
                         status='CONFLICT' if reasons else 'NOT_SET' if expected is None else 'PLANNED',conflict=bool(reasons),reasons=reasons,
                         source='MANUAL' if forecast else None,editable=key[1] is not None,people=members,
                         worldChampionCount=sum(p['worldChampionMarked'] or bool(p['titleReferences']) for p in members),
                         rosterDigest=roster_digest,baseToken=fingerprint({'forecast':values,'people':members}),**values))
    return dict(eventId=str(owner),nationCode=nation,rows=rows,
                reportedCount=len(people))


class ForecastConflict(ValueError):
    pass


def save(area, data, username, *, commit=True):
    if not isinstance(data,dict):raise ValueError('Prognose muss ein JSON-Objekt sein.')
    row=next((r for r in project()['rows'] if r['areaId']==area),None)
    if not row:abort(404)
    if not row['editable']:raise ValueError('Mehrfachzuordnung oder Gender zuerst fachlich klären.')
    if data.get('baseToken')!=row['baseToken']:raise ForecastConflict('Planung oder Personenbestand wurde geändert. Bitte neu laden.')
    expected=data.get('expectedTotal')
    if 'expectedTotal' not in data or (expected is not None and (type(expected) is not int or expected<0 or expected>2147483647)):
        raise ValueError('Erwartete Gesamtzahl muss eine nichtnegative ganze Zahl oder null sein.')
    dates=[]
    for key in ('checkInDate','checkOutDate'):
        raw=data.get(key)
        if raw is not None and not isinstance(raw,str):raise ValueError('Aufenthaltsdaten müssen ISO-Daten sein.')
        dates.append(date.fromisoformat(raw) if raw else None)
    if bool(dates[0])!=bool(dates[1]) or (dates[0] and dates[0]>=dates[1]):raise ValueError('Zeitraum vollständig und mit Check-in vor Check-out angeben.')
    note=data.get('note')
    if note is not None and (not isinstance(note,str) or len(note)>2000):raise ValueError('Interner Hinweis darf höchstens 2000 Zeichen enthalten.')
    key=dict(event_id=int(row['eventId']),nation_code=row['nationCode'],discipline=row['discipline'],gender=row['personalGender'])
    values=dict(expected_total=expected,check_in_date=dates[0],check_out_date=dates[1],note=note.strip() or None if note else None,
                revision=row['revision']+1,roster_digest=row['rosterDigest'],updated_by=username,updated_at=datetime.utcnow())
    g.audit_snapshot={k:row[k] for k in ('expectedTotal','checkInDate','checkOutDate','note','revision','updatedBy','updatedAt')}
    try:
        if row['revision']:
            count=event_query(AthleteArrivalForecast).filter_by(**key,revision=row['revision']).update(values,synchronize_session=False)
            if count!=1:raise ForecastConflict('Prognose wurde gleichzeitig bearbeitet. Bitte neu laden.')
        else:
            db.session.add(AthleteArrivalForecast(**key,**values));db.session.flush()
        db.session.flush()
        if commit:db.session.commit()
    except (IntegrityError,ForecastConflict) as exc:
        db.session.rollback()
        raise ForecastConflict('Prognose wurde gleichzeitig bearbeitet. Bitte neu laden.') from exc
    db.session.expire_all()
    return next(r for r in project()['rows'] if r['areaId']==area)


def operative_projection(overview):
    """Only valid forecasts replace named tasks; conflicts remain visible."""
    rows=overview['rows']
    return dict(replacedPersonIds=sorted({identity for row in rows for identity in row['replacedPersonIds']}),
                groups=[row for row in rows if (row['usesVirtualPlanning'] and row['expectedTotal']>0) or row['conflict']],
                controlledAreas=sum(row['usesVirtualPlanning'] for row in rows),
                zeroAreas=sum(row['usesVirtualPlanning'] and not row['conflict'] and row['expectedTotal']==0 for row in rows),
                zeroGroups=[row for row in rows if row['usesVirtualPlanning'] and not row['conflict'] and row['expectedTotal']==0],
                virtualPlaces=sum(row['virtualPlaces'] for row in rows),
                conflicts=sum(row['conflict'] for row in rows))



def import_projection(session, preview, control, *, live=False, read_context=None, choices=None):
    """Same forecast model over effective parsed people, never a preview write."""
    from types import SimpleNamespace
    from imports.read_context import ImportReadContext
    context=read_context or ImportReadContext(session.event_id)
    if live:
        result=project(session.nation)
    else:
        records=[]
        for index,person in enumerate(preview.get('evaluationPeople',preview.get('people',[]))):
            if person.get('nationCode')!=session.nation:continue
            ids=person.get('competitionIds',[])
            records.append(SimpleNamespace(id=person.get('existingAthleteId') or 'preview:'+str(person.get('matchKey',index)),
                nation_code=person['nationCode'],function=person.get('function'),firstname=person.get('firstname',''),lastname=person.get('lastname',''),
                gender=person.get('gender'),fis_code=person.get('fisCode'),single_room_quota_exempt_reason=person.get('singleRoomQuotaExemptReason'),
                competitions=[context.competitions_by_id[int(cid)] for cid in ids if str(cid).isdecimal() and int(cid) in context.competitions_by_id]))
        result=project(session.nation,people_override=records)
    # A local draft is validated like an approval, without writing any forecast.
    if choices is not None:
        prepare_import_decisions(session,result,choices)
        result=project(session.nation,people_override=None if live else records,expected_overrides={choice['areaId']:choice for choice in choices})
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
                gender=person.gender,quotaDisciplines=quota_disciplines(person.competitions),singleRoomQuotaExemptReason=person.single_room_quota_exempt_reason)
            roster.append(record)
            groups=projected_approval_groups(person.single_room_decision,person,roster=context.athletes)
            demands.append(dict(record,countsAsSingle=any(m.room_booking.counts_as_single for m in person.room_booking_memberships) or (person.accommodation_requirement!='NO_ROOM' and str(person.room_type or '').strip().lower()=='single'),
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
    """Only valid NN overrides; blocked scopes use the distinct normal roster."""
    return {(row['nationCode'],row['discipline'],row['personalGender']):row['expectedTotal']
        for row in overview['rows'] if row['editable'] and not row['conflict'] and row['expectedTotal'] is not None}


def operational_quota_projection(overview, roster, demands, rules, *, event=None):
    """Read-only alternative basis; allocation and formulas stay in quota_service."""
    from quota_service import evaluate_quota_usage,quota_gender_errors
    errors=quota_gender_errors(roster)
    if errors:return dict(rows=[],conflict=True,reasons=[e['message'] for e in errors])
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
    """Freeze only explicit decisions with current forecast evidence at approval."""
    from imports.event_context import ImportValidationError
    if not isinstance(choices,list):raise ImportValidationError('NN_PLANNING_INVALID','NN-Entscheidungen müssen eine Liste sein.')
    by_id={row['areaId']:row for row in overview['rows']};seen=set();result=[]
    for choice in choices:
        if not isinstance(choice,dict):raise ImportValidationError('NN_PLANNING_INVALID','Ungültige NN-Entscheidung.')
        row=by_id.get(choice.get('areaId')) if isinstance(choice.get('areaId'),str) else None
        total=choice.get('expectedTotal')
        if 'expectedTotal' not in choice or not row or not row['editable'] or row['areaId'] in seen or (total is not None and (type(total) is not int or total<0 or total>2147483647)):
            raise ImportValidationError('NN_PLANNING_INVALID','Eindeutigen Bereich und nichtnegative Gesamtzahl angeben.')
        if choice.get('baseToken')!=row['baseToken']:
            raise ImportValidationError('STALE_PREVIEW','NN-Planung oder Bestand wurde geändert. Erneut prüfen.')
        seen.add(row['areaId'])
        saved=event_query(AthleteArrivalForecast).filter_by(nation_code=row['nationCode'],discipline=row['discipline'],gender=row['personalGender']).first()
        result.append(dict(areaId=row['areaId'],baseToken=row['baseToken'],expectedTotal=total,forecastBase=fingerprint(forecast_values(saved))))
    return result


def apply_import_decisions(session, decisions, username):
    """Caller owns the import transaction, rollback and audit; never commits here."""
    from imports.event_context import ImportValidationError
    from models import ImportSessionEvent
    for decision in decisions:
        current=next((row for row in project(session.nation)['rows'] if row['areaId']==decision['areaId']),None)
        if not current or not current['editable']:raise ImportValidationError('NN_PLANNING_INVALID','NN-Bereich nach Übernahme nicht eindeutig.')
        saved=event_query(AthleteArrivalForecast).filter_by(nation_code=current['nationCode'],discipline=current['discipline'],gender=current['personalGender']).first()
        if fingerprint(forecast_values(saved))!=decision['forecastBase']:
            raise ImportValidationError('STALE_PREVIEW','Prognose wurde zwischenzeitlich geändert. Keine Übernahme.')
        try:
            save(current['areaId'],dict(baseToken=current['baseToken'],expectedTotal=decision['expectedTotal'],checkInDate=current['checkInDate'],checkOutDate=current['checkOutDate'],note=current['note']),username,commit=False)
        except ForecastConflict as exc:raise ImportValidationError('STALE_PREVIEW',str(exc)) from exc
        db.session.add(ImportSessionEvent(session_id=session.id,version_id=session.current_version_id,event_type='NN_PLANNING_APPLIED',title='NN-Unterkunftsplanung übernommen',
            description=json.dumps(dict(areaId=current['areaId'],old=current['expectedTotal'],new=decision['expectedTotal']),ensure_ascii=False),username=username))
        db.session.flush()
