"""Exclusive operative athlete forecasts. No admission, quota or booking writes.

Confirmed follow-up policy: Officials' EZ tiers must use actual arriving Officials,
capped by their admissible contingent. This PR deliberately leaves that evaluator
unchanged; Officials continue to be planned as named people.
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


def project(nation=None):
    owner=accommodation_event_id()
    query=event_query(Athlete).options(db.selectinload(Athlete.competitions))
    forecasts=event_query(AthleteArrivalForecast)
    if nation:
        query=query.filter_by(nation_code=nation);forecasts=forecasts.filter_by(nation_code=nation)
    people=[p for p in query.all() if is_athlete({'function':p.function})]
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
        expected=values['expectedTotal']
        reasons=[]
        if key[1] is None:
            reasons.append('Klärungsbereich: keine sichere überschneidungsfreie Zuordnung. Keine Prognose bearbeitbar.')
            reasons.extend(sorted({reason for person in members for reason in person['reasons']}))
        roster_digest=fingerprint([{'personId':p['personId'],'gender':normalize_gender(p['personalGender']),'disciplines':p['disciplines']} for p in members])
        maintained=expected is not None or values['checkInDate'] or values['note']
        if forecast and maintained and forecast.roster_digest!=roster_digest:reasons.append('Gemeldeter Bestand oder Zuordnung seit der letzten Prognose geändert. Prognose prüfen und erneut speichern.')
        if forecast and maintained and not members:reasons.append('Gespeicherter Planungsbereich hat keine gemeldeten Athleten mehr. Prognose prüfen oder zurücksetzen.')
        if expected is not None and expected>len(members):reasons.append('Erwartete Gesamtzahl übersteigt den aktuell gemeldeten Bestand.')
        reduced=key[1] is not None and expected is not None and expected<len(members)
        if reduced and any(p['hasBooking'] for p in members):
            reasons.append('Reduzierte Prognose mit bestehenden namentlichen Buchungen. Bestand zuerst klären; keine zusätzlichen virtuellen Plätze.')
        families=sorted({f for p in members for f in p['sportFamilies']})
        rows.append(dict(areaId=area_id(owner,*key),eventId=str(owner),nationCode=key[0],discipline=key[1],personalGender=key[2],
                         sportFamilies=families,reportedCount=len(members),bookedPeopleCount=sum(p['hasBooking'] for p in members),
                         usesVirtualPlanning=reduced,virtualPlaces=expected if reduced and not reasons else 0,
                         replacedPersonIds=[p['personId'] for p in members if reduced and not reasons and not p['hasBooking']],
                         status='CONFLICT' if reasons else 'NOT_SET' if expected is None else 'PLANNED',conflict=bool(reasons),reasons=reasons,
                         source='MANUAL' if forecast else None,editable=key[1] is not None,people=members,
                         worldChampionCount=sum(p['worldChampionMarked'] or bool(p['titleReferences']) for p in members),
                         rosterDigest=roster_digest,baseToken=fingerprint({'forecast':values,'people':members}),**values))
    return dict(eventId=str(owner),nationCode=nation,rows=rows,
                reportedCount=len(people))


class ForecastConflict(ValueError):
    pass


def save(area, data, username):
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
        db.session.commit()
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
