"""Read-only import explanation. Never persisted in preview facts or decisions."""
from collections import defaultdict
from quota_service import quota_keys, is_athlete, athlete_quota_contexts

CLARIFY = {'ROOM_PARTNER_NOT_FOUND','ROOM_PERSON_NOT_FOUND','ROOM_DUPLICATE_SINGLE',
           'ROOM_NO_DAY_OVERLAP','ENTRY_QUOTA_MEMBERSHIP_UNRESOLVED','ATHLETE_TARIFF_UNRESOLVED',
           'QUOTA_SINGLE_ROOMS_EXCEEDED','QUOTA_ATHLETE_EXCEEDED'}


def build_import_control(preview, context):
    from stay_window import assess_stay, load_stay_schedule
    schedule = load_stay_schedule(context.event_id) if getattr(context, 'event_id', None) else []
    from models import db, Event
    from sport_entry_plausibility import project_entries
    event = db.session.get(Event, context.event_id) if getattr(context, 'event_id', None) else None
    sport = project_entries(preview.get('people', []), context.competitions_by_id, event)
    people=preview.get('people',[]);rooms=preview.get('rooms',[])
    by_key={str(p.get('matchKey')):p for p in people if p.get('matchKey') is not None}
    by_entry={p.get('rowNumber'):str(p['matchKey']) for p in people if p.get('matchKey') is not None}
    by_room=defaultdict(set);person_rooms=defaultdict(list)
    for room in rooms:
        for field in ('person1Key','person2Key'):
            key=room.get(field)
            if key is not None:
                by_room[room.get('rowNumber')].add(str(key));person_rooms[str(key)].append(room)
    issues=[];known_keys=set(by_key);allowances=athlete_quota_contexts(people)
    def add(kind,code,message,keys=(),source=None,row=None):
        issues.append(dict(kind=kind,code=code,message=message,personKeys=sorted(set(keys)&known_keys),source=source,row=row))
    for kind,items in [('error',preview.get('errors',[])),('warning',preview.get('warnings',[]))]:
        for issue in items:
            code=issue['code'];details=issue.get('details') or {};row=details.get('row') or details.get('rowNumber')
            source='Room List' if code.startswith('ROOM_') else 'Entry List' if code.startswith('ENTRY_') else 'Bestehende Bewertung'
            keys={str(details['personKey'])} if details.get('personKey') is not None else by_room.get(row,set()) if source=='Room List' else {by_entry[row]} if source=='Entry List' and row in by_entry else set()
            messages={'ROOM_PARTNER_NOT_FOUND':'Der angegebene Zimmerpartner konnte nicht eindeutig zugeordnet werden.', 'ROOM_PERSON_NOT_FOUND':'Die Room-List-Zeile konnte keiner gemeldeten Person eindeutig zugeordnet werden.'}
            add('error' if kind=='error' else 'clarification' if code in CLARIFY else 'info',code,messages.get(code,issue['message']),keys,source,row)
    rows=[];competitions={}
    existing={p.id:p for p in context.athletes}
    for key,p in by_key.items():
        memberships=[]
        for member in p.get('competitionMemberships',[]):
            cid=str(member.get('competitionId'));c=context.competitions_by_id.get(int(cid)) if cid.isdecimal() else None
            label=c.name if c else member.get('importCode') or 'Zuordnung nicht hinterlegt'
            membership=dict(id=cid,name=label,group=member.get('quotaDiscipline'),gender=c.gender if c else None)
            if cid not in {m['id'] for m in memberships}:memberships.append(membership)
            entry=competitions.setdefault(cid,dict(**membership,people=set(),athletes=set()))
            entry['people'].add(key)
            if is_athlete(p):entry['athletes'].add(key)
        resolved = [context.competitions_by_id.get(int(m['id'])) if m['id'].isdecimal() else None for m in memberships]
        rows.append(dict(personKey=key,competitions=memberships,
            stayWindow=assess_stay(p.get('arrivalDate'),p.get('departureDate'),
                resolved if all(resolved) else [],
                schedule,p.get('accommodationRequirement')),
            quotaContexts=[dict(nation=n,group=d,gender=g) for n,d,g in sorted(quota_keys(p,allowance_contexts=allowances))],
            internalNote=getattr(existing.get(p.get('existingAthleteId')),'internal_note',None)))
        if len(memberships)>1:add('info','MULTIPLE_MEMBERSHIPS','Mehrere Competition-Zuordnungen. Athleten zählen je Quotenfamilie nur einmal; Staff-Zuordnungen sind keine sportlichen Starts.',[key],'Entry List',p.get('rowNumber'))
        if str(p.get('roomType') or '').strip().casefold()=='no room':add('info','EXPLICIT_ENTRY_NO_ROOM','Entry List meldet ausdrücklich No room. Der effektive Unterkunftsbedarf wird separat angezeigt.',[key],'Entry List',p.get('rowNumber'))
        relevant=person_rooms[key]
        if p.get('accommodationRequirement')!='NO_ROOM':
            shared=[r for r in relevant if str(r.get('roomType') or '').strip().casefold()=='double shared']
            for room in shared:
                if not room.get('person2Key') and not any(i['code']=='ROOM_PARTNER_NOT_FOUND' and i['row']==room.get('rowNumber') for i in issues):
                    add('clarification','SHARED_PARTNER_NOT_LINKED','Double Shared: In dieser Room-List-Zeile ist kein eindeutiger Zimmerpartner zugeordnet.',[key],'Room List',room.get('rowNumber'))
            if not relevant and str(p.get('roomType') or '').strip().casefold()=='double shared':
                add('clarification','SHARED_PARTNER_NOT_EVIDENCED','Double Shared in der Entry List; eine Partnerzuordnung aus der Room List ist nicht belegt.',[key],'Entry List',p.get('rowNumber'))
        if p.get('singleRoomQuotaExemptReason')=='WORLD_CHAMPION':
            refs=p.get('worldChampionReferences') or []
            if not refs or any(not r.get('discipline') for r in refs):
                add('clarification','TITLE_REFERENCE_UNCLEAR','Weltmeister-EZ-Ausnahme vorhanden; eindeutige Titel-/Disziplinreferenz ist in diesem Prüfstand nicht hinterlegt. Kein sportliches Startrecht daraus ableiten.',[key],'Bestehende Bewertung')
    return dict(people=rows,issues=issues,competitions=[{**{k:v for k,v in c.items() if k not in {'people','athletes'}},'people':len(c['people']),'athletes':len(c['athletes']),'sportEntries':sport.get(c['id'],[])} for c in sorted(competitions.values(),key=lambda c:(c['group'] or '',c['name']))])
