"""Import explanations and append-only nation contacts; quota decisions stay separate."""
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


# Explicit append-only documents in the existing history, separate from approvals.
CLARIFICATION_FORMAT = 'incoming.nation-clarification'
CLARIFICATION_TYPES = {'NATION_QUESTION', 'NATION_REPLY', 'NATION_RESOLVED'}


def clarification_document(event):
    import json
    if event.event_type not in CLARIFICATION_TYPES:
        return None
    try:
        value = json.loads(event.description or '')
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) and value.get('format') == CLARIFICATION_FORMAT and value.get('schemaVersion') == 1 else None


def clarification_subjects(preview, control):
    """Reference existing findings and their facts; never evaluate a new rule."""
    from quota_rules import fingerprint
    people = {str(p['matchKey']): p for p in preview.get('people', []) if p.get('matchKey')}
    subjects = {}
    def person_facts(keys):
        return [dict(personKey=key, nation=p.get('nationCode'), fisCode=p.get('fisCode'), function=p.get('function'), gender=p.get('gender'),
            competitions=sorted({str(m.get('competitionId')) for m in p.get('competitionMemberships', [])}),
            groups=sorted(p.get('quotaDisciplines') or [])) for key in sorted(keys) if (p := people.get(key))]
    def rooms_facts(rooms):
        fields = ('person1Key', 'person2Key', 'person1Name', 'person2Name', 'roomType', 'sharedWithRawName', 'checkInDate', 'checkOutDate')
        return sorted([{k: str(r[k]) if r.get(k) is not None else None for k in fields} for r in rooms], key=str)
    def add(kind, code, label, keys, facts, scope=None):
        keys = sorted(set(keys) & people.keys())
        key = fingerprint({'kind': kind, 'code': code, 'scope': scope if scope is not None else keys})
        names = [f"{people[k].get('firstname', '')} {people[k].get('lastname', '')}".strip() for k in keys]
        subjects[key] = dict(key=key, digest=fingerprint(facts), kind=kind, code=code,
            label=label, personKeys=keys, people=names, facts=facts)
    for row in control.get('people', []):
        stay = row.get('stayWindow') or {}
        if stay.get('outsideNights', 0) or (stay.get('reason') and stay['reason'] != 'NO_ROOM'):
            key = row['personKey']
            add('stay', 'STAY_WINDOW', 'Aufenthalt / Eventfenster', [key],
                dict(people=person_facts([key]), stay=stay,
                     requirement=people.get(key, {}).get('accommodationRequirement')))
    for comp in control.get('competitions', []):
        for entry in comp.get('sportEntries', []):
            if entry.get('unverifiedAdditional', 0) > 0:
                keys = entry['personKeys']
                add('sport', f"SPORT_{comp['id']}_{entry['nation']}", f"Sportliche Plausibilität: {comp['name']}", keys,
                    dict(people=person_facts(keys), competition=comp['id'], assessment=entry), scope=[comp['id'], entry['nation']])
    for issue in control.get('issues', []):
        code = issue['code']
        if code.startswith('QUOTA_') or code == 'ATHLETE_TARIFF_UNRESOLVED':
            continue  # Formal decisions retain their exclusive approval workflow.
        if issue['kind'] == 'info':
            continue
        keys = issue.get('personKeys') or []
        warning = next((w for w in preview.get('errors', []) + preview.get('warnings', [])
                        if w['code'] == code and (w.get('details') or {}).get('row', (w.get('details') or {}).get('rowNumber')) == issue.get('row')), {})
        details = {k: v for k, v in (warning.get('details') or {}).items() if k not in {'row', 'rowNumber'}}
        if not keys and (details.get('nationCode') or details.get('discipline')):
            keys = [key for key, p in people.items() if
                (not details.get('nationCode') or p.get('nationCode') == details['nationCode']) and
                (not details.get('discipline') or details['discipline'] in (p.get('quotaDisciplines') or []))]
        rooms = [r for r in preview.get('rooms', []) if issue.get('source') == 'Room List' and r.get('rowNumber') == issue.get('row')]
        facts = dict(people=person_facts(keys), details=details, rooms=rooms_facts(rooms))
        # Partner findings also depend on dates and the actual requested partner.
        if 'PARTNER' in code or 'SHARED' in code:
            facts['requests'] = [{k: p.get(k) for k in ('matchKey', 'roomType', 'sharedWithName', 'arrivalDate', 'departureDate')}
                                 for key in sorted(keys) if (p := people.get(key))]
        scope = [[r.get('person1Key') or r.get('person1Name'), r.get('person2Key') or r.get('person2Name')] for r in rooms] if rooms and not keys else None
        add('finding', code, issue['message'], keys, facts, scope=scope)
    for warning in preview.get('warnings', []):
        if warning['code'] != 'INFO_OFFICIALS_OVER_BASIS':
            continue
        details = warning.get('details') or {}
        scope = [details.get(k) for k in ('nationCode', 'discipline', 'gender')]
        keys = [key for key, p in people.items() if not is_athlete(p) and p.get('nationCode') == scope[0] and scope[1] in (p.get('quotaDisciplines') or [])]
        add('officials', warning['code'], f'Officials-Zuordnung: {scope[1]} {scope[2]}', keys,
            dict(people=person_facts(keys), assessment=details), scope=scope)
    return list(subjects.values())


def nation_clarifications(session, preview, control):
    subjects = clarification_subjects(preview, control)
    current = {s['key']: s for s in subjects}
    events = sorted(session.history, key=lambda e: e.id)
    documents = [(e, clarification_document(e)) for e in events]
    items = []
    for event, doc in documents:
        if not doc or event.event_type != 'NATION_QUESTION':
            continue
        subject = current.get(doc['subject']['key'])
        replies = [(e, d) for e, d in documents if d and str(d.get('questionId')) == str(event.id)]
        resolved = next(((e, d) for e, d in reversed(replies) if e.event_type == 'NATION_RESOLVED' and subject and
                         d.get('subject', {}).get('digest') == subject['digest'] and d.get('result') != 'CORRECTED'), None)
        changed = bool(subject and subject['digest'] != doc['subject']['digest'])
        items.append(dict(id=str(event.id), versionId=str(event.version_id), subject=subject or doc['subject'],
            originalSubject=doc['subject'], required=doc['required'], state='CORRECTED' if not subject else 'RESOLVED' if resolved else 'OPEN',
            changed=changed, comment=doc['comment'], contactMethod=doc.get('contactMethod'), contactDate=doc.get('contactDate'),
            user=event.username, createdAt=event.created_at.isoformat()+'Z',
            result=resolved[1]['result'] if resolved else 'CORRECTED' if not subject else None,
            resolutionComment=resolved[1]['comment'] if resolved else None,
            replies=[dict(comment=d['comment'], user=e.username, timestamp=e.created_at.isoformat()+'Z') for e, d in replies if e.event_type == 'NATION_REPLY']))
    return dict(subjects=subjects, items=items)


def document_nation_clarification(session, data, preview, control, username):
    """Append one contact/reply/result through the existing history endpoint."""
    from datetime import date
    import json
    from models import db, ImportSessionEvent
    if session.status in {'APPROVED', 'IMPORTED', 'REPLACED', 'ARCHIVED', 'CANCELLED'}:
        raise ValueError('Freigegebene oder abgeschlossene Sessions sind für neue Abklärungen gesperrt.')
    if str(data.get('versionId')) != str(session.current_version_id):
        raise ValueError('Neue Importversion vorhanden; bitte erneut öffnen.')
    action = data.get('clarificationAction')
    projection = nation_clarifications(session, preview, control)
    comment = data.get('comment')
    if not isinstance(comment, str) or not comment.strip() or len(comment) > 4000:
        raise ValueError('Nachvollziehbarer Kommentar erforderlich (maximal 4000 Zeichen).')
    doc = dict(format=CLARIFICATION_FORMAT, schemaVersion=1, comment=comment.strip())
    if action == 'OPEN':
        subject = next((s for s in projection['subjects'] if s['key'] == data.get('subjectKey') and s['digest'] == data.get('subjectDigest')), None)
        if not subject:
            raise ValueError('Sachverhalt wurde geändert; bitte erneut prüfen.')
        if any(i['subject']['key'] == subject['key'] and i['state'] == 'OPEN' for i in projection['items']):
            raise ValueError('Für diesen Sachverhalt besteht bereits eine offene Rückfrage.')
        if type(data.get('required')) is not bool or data.get('contactMethod') not in {'EMAIL', 'PHONE', 'OTHER'}:
            raise ValueError('Kontaktweg und Kennzeichnung vor Freigabe erforderlich.')
        contact = date.fromisoformat(data.get('contactDate') or '')
        doc.update(subject=subject, required=data['required'], contactMethod=data['contactMethod'], contactDate=contact.isoformat())
        kind, title = 'NATION_QUESTION', 'Rückfrage an Nation: '+subject['label']
    elif action in {'REPLY', 'RESOLVE'}:
        item = next((i for i in projection['items'] if i['id'] == str(data.get('questionId'))), None)
        if not item or item['state'] != 'OPEN' or item['subject']['digest'] != data.get('subjectDigest'):
            raise ValueError('Rückfrage ist erledigt oder der Sachverhalt wurde geändert; bitte erneut öffnen.')
        doc.update(questionId=item['id'], subject=item['subject'])
        if action == 'REPLY':
            kind, title = 'NATION_REPLY', 'Rückmeldung dokumentiert: '+item['subject']['label']
        else:
            if data.get('result') not in {'CLARIFIED', 'IRRELEVANT'}:
                raise ValueError('Durch Korrektur erledigt wird ausschließlich aus der aktuellen Liste abgeleitet.')
            doc['result'] = data['result']
            kind, title = 'NATION_RESOLVED', ('Mit Nation geklärt: ' if data['result'] == 'CLARIFIED' else 'Nicht mehr relevant: ')+item['subject']['label']
    else:
        raise ValueError('Unbekannte Rückfrageaktion.')
    event = ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type=kind,
        title=title[:200], description=json.dumps(doc, ensure_ascii=False, default=str), username=username)
    db.session.add(event)
    return event


def record_clarification_corrections(session, preview, control, username, *, new_list=False):
    import json
    from models import db, ImportSessionEvent
    if not any(e.event_type == 'NATION_QUESTION' for e in session.history):
        return
    for item in nation_clarifications(session, preview, control)['items']:
        last_result = next((clarification_document(e) for e in sorted(session.history, key=lambda e: e.id, reverse=True)
            if e.event_type == 'NATION_RESOLVED' and (clarification_document(e) or {}).get('questionId') == item['id']), None)
        if item['state'] != 'CORRECTED' or (last_result and last_result.get('result') == 'CORRECTED'):
            continue
        db.session.add(ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='NATION_RESOLVED',
            title='Durch korrigierte Liste erledigt' if new_list else 'Sachverhalt im aktuellen Prüfstand nicht mehr vorhanden', description=json.dumps(dict(format=CLARIFICATION_FORMAT, schemaVersion=1,
                questionId=item['id'], subject=item['originalSubject'], result='CORRECTED', comment='Der ursprüngliche Hinweis besteht im aktuellen Prüfstand nicht mehr.'), ensure_ascii=False, default=str), username=username))
