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
    from sport_entry_plausibility import project_entries, active_competitions
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
    # Include active zero-entry counterparts for an explicit 0 / rule-value.
    for cid,c in active_competitions(event,context.competitions_by_id).items() if event else []:
        competitions.setdefault(cid,dict(id=cid,name=c.name,group=c.quota_discipline,gender=c.gender,people=set(),athletes=set()))
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
    return value if isinstance(value, dict) and value.get('format') == CLARIFICATION_FORMAT and value.get('schemaVersion') in {1, 2} else None


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
            if entry.get('reported', 1)>0 and (entry.get('status') in {'REVIEW_REQUIRED','INCOMPLETE'} or entry.get('unverifiedAdditional',0)>0 or entry.get('sharedPoolUnverifiedAdditional',0)>0):
                keys = entry.get('poolPersonKeys',entry['personKeys']) if entry.get('sharedPoolUnverifiedAdditional') else entry['personKeys']
                add('sport', f"SPORT_{comp['id']}_{entry['nation']}", f"Sportliche Plausibilität: {comp['name']}", keys,
                    dict(people=person_facts(keys), competition=comp['id'], assessment=entry), scope=[comp['id'], entry['nation']])
    for issue in control.get('issues', []):
        code = issue['code']
        if code.startswith('QUOTA_') or code == 'ATHLETE_TARIFF_UNRESOLVED':
            continue  # Formal decisions retain their exclusive approval workflow.
        if issue['kind'] == 'info' and code != 'EXPLICIT_ENTRY_NO_ROOM':
            continue  # Explicit No room is a useful contact suggestion, never a task by itself.
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


def _clarification_source_views(session, preview, control):
    """Read current sources, plus the existing merge, without changing a version."""
    from imports.workflow import submission_heads, load_version_preview, merge_submission_previews
    from imports.read_context import ImportReadContext
    from imports.event_context import ImportValidationError, validate_session_event
    from excel_import import resolve_saved_quota_memberships
    from types import SimpleNamespace
    # Upload has flushed the new version before the relationship is reloaded.
    versions = {v.id:v for v in session.versions}
    if session.current_version:versions[session.current_version_id]=session.current_version
    heads = submission_heads(SimpleNamespace(versions=list(versions.values()), history=session.history, status=session.status))
    if not heads or (preview.get('replacementScope') or {}).get('kind')=='FULL_NATION':
        return [dict(families={'*'}, sources={'*':session.current_version_id}, preview=preview,
            subjects=clarification_subjects(preview, control), control=control, valid=not preview.get('errors'), shared=set())]
    context = ImportReadContext(session.event_id)
    views = []
    selections = [({family:version}, False) for family,version in sorted(heads.items())]
    if len(heads)>1:selections.append((heads, True))
    for selected, combined in selections:
        data, projected = {}, {}
        try:
            data = merge_submission_previews(list(selected.values()), read_context=context) if combined else load_version_preview(next(iter(selected.values())))
            validate_session_event(session, data)
            for person in data.get('people', []):
                resolve_saved_quota_memberships(person, read_context=context)
            projected = build_import_control(data, context)
            valid = not data.get('errors') and all(not load_version_preview(v).get('errors') for v in selected.values())
            subjects = clarification_subjects(data, projected)
            shared = {p['matchKey'] for p in data.get('people', []) if len({r['versionId'] for r in p.get('sourceRows', [])})>1}
        except (ImportValidationError, ValueError, TypeError):
            subjects, valid, shared = [], False, None
        views.append(dict(families=set(selected), sources={f:v.id for f,v in selected.items()},
            preview=data, subjects=subjects, control=projected, valid=valid, shared=shared))
    return views


def _clarification_rebind(subject, origin, view, session):
    """Recover a changed import key using the unchanged exact identity matcher."""
    from types import SimpleNamespace
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    from imports.event_context import ImportValidationError
    import json
    old = list(origin.get('people', []))
    ids = set((subject.get('coverage') or {}).get('sourceVersionIds', {}).values())
    old += [p for version in session.versions if version.id in ids for p in json.loads(version.preview_json or '{}').get('people', [])]
    refs = [p for p in old if str(p.get('matchKey')) in subject.get('personKeys', [])]
    records = [SimpleNamespace(id=str(p['matchKey']),event_id=session.event_id,fis_code=p.get('fisCode'),competitor_id=p.get('competitorId'),
        firstname=p.get('firstname'),lastname=p.get('lastname'),nation_code=p.get('nationCode')) for p in view['preview'].get('people', []) if p.get('matchKey')]
    try:
        maps = _build_existing_athlete_maps(records,event_id=session.event_id)
        hits = [_find_existing_athlete(p, maps) for p in refs]
        keys = {hit.id for hit in hits if hit}
        if any(hit is None for hit in hits) or len(keys) != len(set(subject.get('personKeys', []))):
            return None, False
    except (ImportValidationError,ValueError,TypeError):
        return None, False
    candidates = [s for s in view['subjects'] if keys and s['code']==subject.get('code') and s['kind']==subject.get('kind') and set(s['personKeys'])==keys]
    return (candidates[0] if len(candidates)==1 else None), len(candidates)<=1


def nation_clarifications(session, preview, control):
    import json
    views = _clarification_source_views(session, preview, control)
    selected = preview.get('replacementScope') or {}
    selected_families = set(selected.get('families') or [selected.get('family')]) if selected.get('kind')=='SPORT_FAMILY' else {'*'}

    def view_for(subject, origin):
        saved = subject.get('coverage') or {}
        scope = origin.get('replacementScope') or {}
        families = set(saved.get('families') or scope.get('families') or ([scope['family']] if scope.get('family') else []))
        if not families:
            families = {f for p in origin.get('people', []) if str(p.get('matchKey')) in subject.get('personKeys', []) for f in p.get('athleteQuotaFamilies', []) if f} or {'*'}
        shared = subject.get('kind')=='stay' or any(token in subject.get('code','') for token in ('ROOM','PARTNER','SHARED'))
        joint = next((v for v in views if len(v['families'])>1), None)
        if shared and joint and (joint['shared'] is None or set(subject.get('personKeys',[])) & joint['shared']):
            families |= joint['families']
        candidates = [v for v in views if '*' in v['families'] or families <= v['families']]
        view = (max(views, key=lambda v: len(v['families'])) if views else None) if subject.get('targetType') == 'NATION' else min(candidates,key=lambda v:len(v['families'])) if candidates else None
        return view, dict(schemaVersion=1,eventId=session.event_id,nation=session.nation,
            families=sorted(families),sourceVersionIds=view['sources'] if view else {})

    choices = clarification_choices(session, views, preview)
    subjects = {}
    for base in views:
        if len(base['families'])>1:continue
        for candidate in base['subjects']:
            candidate = {**candidate, 'coverage':dict(families=sorted(base['families']))}
            view, coverage = view_for(candidate,base['preview'])
            found = next((s for s in view['subjects'] if s['key']==candidate['key']),None) if view else None
            if found or not view or not view['valid']:
                subjects[candidate['key']] = {**(found or candidate),'coverage':coverage}
    subjects = list(subjects.values())
    current = {s['key']: s for s in subjects}
    events = sorted(session.history, key=lambda e: e.id)
    documents = [(e, clarification_document(e)) for e in events]
    items = []
    for event, doc in documents:
        if not doc or event.event_type != 'NATION_QUESTION':
            continue
        original = doc['subject']
        version = next((v for v in session.versions if v.id==event.version_id),None)
        origin = json.loads(version.preview_json or '{}') if version else {}
        if original.get('kind') == 'selection':
            items.append(project_selection(session, event, doc, documents, view_for, origin, selected_families))
            continue
        view, coverage = view_for(original,origin)
        subject = next((s for s in view['subjects'] if s['key']==original['key']),None) if view else None
        covered = bool(view and view['valid'])
        if not subject and covered and original.get('personKeys'):
            subject, identified = _clarification_rebind(original,origin,view,session)
            covered = covered and identified
        if subject:
            current.pop(subject['key'],None)
            subject={**subject,'key':original['key'],'coverage':coverage}
            current[subject['key']]=subject
        replies = [(e, d) for e, d in documents if d and str(d.get('questionId')) == str(event.id)]
        last = next(((e,d) for e,d in reversed(replies) if e.event_type=='NATION_RESOLVED'),None)
        resolved = last if last and last[1].get('result')!='CORRECTED' and (not view or (covered and subject and last[1].get('subject',{}).get('digest')==subject['digest'])) else None
        corrected = (covered and not subject) or (not view and last and last[1].get('result')=='CORRECTED')
        baseline = last[1].get('subject', {}).get('digest') if last else original['digest']
        changed = bool(subject and (subject['digest'] != baseline or (last and last[1].get('result')=='CORRECTED')))
        relevant = '*' in selected_families or '*' in coverage['families'] or bool(selected_families & set(coverage['families']))
        items.append(dict(id=str(event.id), versionId=str(event.version_id), subject=subject or {**original,'coverage':coverage},
            originalSubject=original, required=doc['required'], relevant=relevant, covered=covered, state='CORRECTED' if corrected else 'RESOLVED' if resolved else 'OPEN',
            changed=changed, comment=doc['comment'], contactMethod=doc.get('contactMethod'), contactDate=doc.get('contactDate'),
            user=event.username, createdAt=event.created_at.isoformat()+'Z',
            result=resolved[1]['result'] if resolved else 'CORRECTED' if corrected else None,
            resolutionComment=resolved[1]['comment'] if resolved else None,
            replies=[dict(comment=d['comment'], user=e.username, timestamp=e.created_at.isoformat()+'Z') for e, d in replies if e.event_type == 'NATION_REPLY']))
    return dict(subjects=list(current.values()), items=items, **choices, groups=clarification_groups(subjects))


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
    if action == 'NOTE':
        if data.get('required') or data.get('waitingForNation'):
            raise ValueError('Notizen können keine Freigabe blockieren.')
        event = ImportSessionEvent(session_id=session.id, version_id=session.current_version_id, event_type='NOTE',
            title='Allgemeine Notiz', description=comment.strip(), username=username)
        db.session.add(event)
        return event
    if action == 'OPEN':
        subject = selection_subject(session, data, projection) if 'targetType' in data else next((s for s in projection['subjects'] if s['key'] == data.get('subjectKey') and s['digest'] == data.get('subjectDigest')), None)
        if not subject:
            raise ValueError('Sachverhalt wurde geändert; bitte erneut prüfen.')
        if subject.get('kind') == 'selection':
            doc['schemaVersion'] = 2
        if any(i['subject']['key'] == subject['key'] and i['state'] == 'OPEN' and (subject.get('kind') != 'selection' or i['comment'] == comment.strip()) for i in projection['items']):
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
        if item['subject'].get('kind') == 'selection':
            doc['schemaVersion'] = 2
        if action == 'REPLY':
            kind, title = 'NATION_REPLY', 'Rückmeldung dokumentiert: '+item['subject']['label']
        else:
            if not item['covered']:
                raise ValueError('Aktuelle Quelldaten decken den Sachverhalt nicht gültig ab; bitte zuerst prüfen.')
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
            title='Durch korrigierte Liste erledigt' if new_list else 'Sachverhalt im aktuellen Prüfstand nicht mehr vorhanden', description=json.dumps(dict(format=CLARIFICATION_FORMAT, schemaVersion=2 if item['subject'].get('kind') == 'selection' else 1,
                questionId=item['id'], subject=item['originalSubject'], correctionSources=item['subject'].get('coverage'), result='CORRECTED', comment='Der ursprüngliche Hinweis besteht im aktuellen Prüfstand nicht mehr.'), ensure_ascii=False, default=str), username=username))


# Schema 2 adds fixed selections, not another workflow. Schema 1 remains untouched.
def clarification_choices(session, views, preview):
    from quota_rules import fingerprint
    joint = next((v for v in views if len(v['families']) > 1 and v['valid']), None)
    base = joint or next((v for v in views if v['preview'] == preview), None)
    roster = (joint or base or {}).get('preview', preview).get('people', [])
    rows = []
    for person in roster:
        key = str(person.get('matchKey') or '')
        if not key:
            continue
        families = sorted({f for v in views if len(v['families']) == 1
            for p in v['preview'].get('people', []) if str(p.get('matchKey')) == key for f in v['families']})
        rows.append(dict(personKey=key, name=f"{person.get('firstname', '')} {person.get('lastname', '')}".strip(),
            families=families or ['*'], disciplines=sorted(person.get('quotaDisciplines') or []),
            identity={k: person.get(k) for k in ('matchKey', 'fisCode', 'competitorId', 'firstname', 'lastname', 'nationCode')},
            facts={k: person.get(k) for k in ('arrivalDate', 'departureDate', 'roomType', 'sharedWithName', 'accommodationRequirement')}))
    # The token includes all current heads, even when the selected review is unchanged.
    token = fingerprint(dict(version=session.current_version_id,
        sources=[dict(sources=v['sources'], valid=v['valid'], subjects=[(s['key'], s['digest']) for s in v['subjects']]) for v in views], people=rows))
    return dict(people=rows, selectionDigest=token)


def clarification_groups(subjects):
    from quota_rules import fingerprint
    groups = {}
    labels = {'stay': 'Aufenthalt / Eventfenster', 'officials': 'Officials-Zuordnung',
        'EXPLICIT_ENTRY_NO_ROOM': 'Kein Zimmer laut Entry List',
        'SHARED_PARTNER_NOT_LINKED': 'Zimmerpartner ungeklärt',
        'SHARED_PARTNER_NOT_EVIDENCED': 'Zimmerpartner ungeklärt',
        'ROOM_PARTNER_NOT_FOUND': 'Zimmerpartner nicht gefunden'}
    for subject in subjects:
        context = subject['key'] if subject['kind'] in {'sport', 'officials'} else subject.get('coverage', {}).get('families', [])
        key = fingerprint(dict(kind=subject['kind'], code=subject['code'], context=context))
        group = groups.setdefault(key, dict(key=key, label=labels.get(subject['code'], labels.get(subject['kind'], subject['label'])),
            families=subject.get('coverage', {}).get('families', []), personKeys=[], subjects=[]))
        group['personKeys'] = sorted(set(group['personKeys']) | set(subject['personKeys']))
        group['subjects'].append(dict(key=subject['key'], digest=subject['digest']))
    return list(groups.values())


def selection_subject(session, data, projection):
    from quota_rules import fingerprint
    if data.get('selectionDigest') != projection['selectionDigest']:
        raise ValueError('Personen oder Hinweise wurden geändert; bitte erneut öffnen.')
    target = data.get('targetType')
    if target not in {'PEOPLE', 'FINDING', 'SPORT', 'NATION'}:
        raise ValueError('Ungültiger Bezug.')
    requested = data.get('personKeys', [])
    if not isinstance(requested, list) or any(not isinstance(k, str) for k in requested):
        raise ValueError('Ungültige Personenauswahl.')
    keys = sorted(set(requested))
    available = {p['personKey']: p for p in projection['people']}
    if set(keys) - available.keys():
        raise ValueError('Person gehört nicht zum aktuellen Nationsentwurf.')
    sport = data.get('sport')
    sports = {x for p in available.values() for x in p['families'] + p['disciplines'] if x != '*'}
    if target == 'SPORT' and sport not in sports:
        raise ValueError('Sportbereich oder Disziplin fehlt.')
    if target in {'SPORT', 'NATION'} and data.get('groupKey'):
        raise ValueError('Problemgruppen beziehen sich auf Personen oder Sachverhalte.')
    group = next((g for g in projection['groups'] if g['key'] == data.get('groupKey')), None)
    if data.get('groupKey') and not group:
        raise ValueError('Problemgruppe wurde geändert.')
    if target in {'PEOPLE', 'FINDING'} and not keys and not (target == 'FINDING' and group and not group['personKeys']):
        raise ValueError('Mindestens eine Person auswählen.')
    if target == 'FINDING' and not group:
        raise ValueError('Problemgruppe auswählen.')
    # Broad references cover their whole explicit context, not the currently visible subset.
    if target == 'NATION':
        keys = sorted(available)
    elif target == 'SPORT':
        keys = sorted(k for k, p in available.items() if sport in p['families'] + p['disciplines'])
    refs = []
    for ref in (group or {}).get('subjects', []):
        subject = next(s for s in projection['subjects'] if s['key'] == ref['key'])
        # A multi-person finding is indivisible: subsets remain manual.
        if set(subject['personKeys']) <= set(keys):
            refs.append(subject)
    bound = {k for ref in refs for k in ref['personKeys']}
    automatic = bool(refs) and all(r['personKeys'] for r in refs) and target in {'PEOPLE', 'FINDING'} and set(keys) <= bound and all(
        ref['kind'] == 'stay' or ref['code'] in {'SHARED_PARTNER_NOT_LINKED', 'SHARED_PARTNER_NOT_EVIDENCED', 'ROOM_PARTNER_NOT_FOUND'} for ref in refs)
    people = [available[k] for k in keys]
    families = sorted({f for p in people for f in p['families']} | {f for r in refs for f in r.get('coverage', {}).get('families', [])})
    if target == 'NATION':
        families = ['*']
    if target == 'SPORT' and sport in {'Snowboard', 'Freestyle'}:
        families = [sport]
    label = {'PEOPLE': 'Personen', 'FINDING': 'Sachverhalt', 'SPORT': sport, 'NATION': 'Gesamte Nation'}[target]
    if group:
        label = f"{label} · {group['label']}"
    context = dict(targetType=target, sport=sport if target == 'SPORT' else None, personKeys=keys,
        references=sorted(r['key'] for r in refs), families=families or ['*'])
    return dict(key=fingerprint(context), digest=fingerprint(dict(context=context, people=people, references=refs)),
        kind='selection', code='SELECTION', label=label, personKeys=keys, people=[p['name'] for p in people],
        targetType=target, sport=context['sport'], selectedPeople=people, references=refs, automatic=automatic,
        coverage=dict(schemaVersion=1, eventId=session.event_id, nation=session.nation, families=context['families'],
            sourceVersionIds={f: i for r in refs for f, i in r.get('coverage', {}).get('sourceVersionIds', {}).items()}))


def selection_people(session, saved, view):
    """Every saved identity must match exactly once. Missing people are not corrections."""
    from types import SimpleNamespace
    from imports.identity import _build_existing_athlete_maps, _find_existing_athlete
    from imports.event_context import ImportValidationError
    records = [SimpleNamespace(id=str(p['matchKey']), event_id=session.event_id, fis_code=p.get('fisCode'),
        competitor_id=p.get('competitorId'), firstname=p.get('firstname'), lastname=p.get('lastname'), nation_code=p.get('nationCode'))
        for p in view['preview'].get('people', []) if p.get('matchKey')]
    try:
        maps = _build_existing_athlete_maps(records, event_id=session.event_id)
        matches = [_find_existing_athlete(p['identity'], maps) for p in saved]
        if any(m is None for m in matches) or len({m.id for m in matches}) != len(saved):
            return None
        return [next(p for p in view['preview']['people'] if str(p['matchKey']) == m.id) for m in matches]
    except (ImportValidationError, ValueError, TypeError):
        return None


def selection_reference(session, ref, saved, view):
    """Positive correction predicates only; disappearing warnings alone are insufficient."""
    people = selection_people(session, saved, view)
    if people is None or not view['valid']:
        return False, None
    keys = {str(p['matchKey']) for p in people}
    related = [s for s in view['subjects'] if set(s['personKeys']) & keys and
        (s['kind'] == 'stay' if ref['kind'] == 'stay' else
         s['code'].startswith(('SHARED_', 'ROOM_')) if ref['code'].startswith(('SHARED_', 'ROOM_')) else
         s['code'] == ref['code'])]
    if ref['kind'] == 'stay':
        # Reuse the existing assessment; lack of an assessment is not a proof.
        assessments = [row['stayWindow'] for row in view['control']['people'] if row['personKey'] in keys]
        fixed = len(assessments) == len(people) and bool(assessments) and all(not a.get('outsideNights') and (not a.get('reason') or a['reason'] == 'NO_ROOM') for a in assessments)
    elif ref['code'] in {'SHARED_PARTNER_NOT_LINKED', 'SHARED_PARTNER_NOT_EVIDENCED', 'ROOM_PARTNER_NOT_FOUND'}:
        def evidenced(p):
            if p.get('accommodationRequirement') == 'NO_ROOM':
                return True
            rooms = [r for r in view['preview'].get('rooms', []) if str(p['matchKey']) in {str(r.get('person1Key')), str(r.get('person2Key'))}]
            return bool(rooms) and all(r.get('person1Key') and r.get('person2Key') and
                r['person1Key'] != r['person2Key'] and r.get('checkInDate') and r.get('checkOutDate') and
                str(r['checkInDate']) < str(r['checkOutDate']) for r in rooms)
        fixed = all(evidenced(p) for p in people)
    else:
        fixed = False
    from quota_rules import fingerprint
    facts = dict(people=[{k: p.get(k) for k in ('fisCode', 'competitorId', 'arrivalDate', 'departureDate', 'roomType', 'sharedWithName', 'accommodationRequirement')} for p in people],
        findings=[s['digest'] for s in sorted(related, key=lambda s: s['key'])])
    return bool(fixed and not related), fingerprint(facts)


def project_selection(session, event, doc, documents, view_for, origin, selected_families):
    from quota_rules import fingerprint
    original = doc['subject']
    view, coverage = view_for(original, origin)
    # References retain individual source scopes; a group never silently changes its roster.
    parts, digests, reference_changes = [], [], []
    all_valid = bool(view and view['valid'])
    for ref in original['references']:
        ref_view, _ = view_for(ref, origin)
        saved = [p for p in original['selectedPeople'] if p['personKey'] in ref['personKeys']]
        fixed, value = selection_reference(session, ref, saved, ref_view) if ref_view else (False, None)
        parts.append(fixed)
        digests.append(value)
        current_ref = next((s for s in ref_view['subjects'] if s['key'] == ref['key']), None) if ref_view else None
        reference_changes.append(not current_ref or current_ref['digest'] != ref['digest'])
        all_valid = all_valid and value is not None
    matched = selection_people(session, original['selectedPeople'], view) if view else None
    if original['selectedPeople'] and matched is None:
        all_valid = False
    facts = [{k: p.get(k) for k in ('fisCode', 'competitorId', 'arrivalDate', 'departureDate', 'roomType', 'sharedWithName', 'accommodationRequirement')} for p in (matched or [])]
    subject = {**original, 'digest': fingerprint(dict(key=original['key'], facts=facts, parts=digests)), 'coverage': coverage}
    replies = [(e, d) for e, d in documents if d and str(d.get('questionId')) == str(event.id)]
    last = next((d for e, d in reversed(replies) if e.event_type == 'NATION_RESOLVED'), None)
    corrected = bool(original['automatic'] and all_valid and parts and all(parts))
    # General manual questions have no import-fact assertion to invalidate.
    manual = not original['references']
    covered = all_valid or (manual and original['targetType'] in {'NATION', 'SPORT'})
    resolved = bool(last and last.get('result') != 'CORRECTED' and covered and last['subject']['digest'] == subject['digest'])
    original_facts = [{k: {**p['identity'], **p['facts']}.get(k) for k in
        ('fisCode', 'competitorId', 'arrivalDate', 'departureDate', 'roomType', 'sharedWithName', 'accommodationRequirement')} for p in original['selectedPeople']]
    changed = subject['digest'] != last['subject']['digest'] if last else fingerprint(facts) != fingerprint(original_facts) or any(reference_changes)
    relevant = '*' in selected_families or '*' in coverage['families'] or bool(selected_families & set(coverage['families']))
    return dict(id=str(event.id), versionId=str(event.version_id), subject=subject, originalSubject=original,
        required=doc['required'], relevant=relevant, covered=covered, state='CORRECTED' if corrected else 'RESOLVED' if resolved else 'OPEN',
        changed=changed, correctedParts=sum(parts), totalParts=len(parts),
        comment=doc['comment'], contactMethod=doc.get('contactMethod'), contactDate=doc.get('contactDate'),
        user=event.username, createdAt=event.created_at.isoformat()+'Z', result='CORRECTED' if corrected else last['result'] if resolved else None,
        resolutionComment=last['comment'] if resolved else None,
        replies=[dict(comment=d['comment'], user=e.username, timestamp=e.created_at.isoformat()+'Z') for e, d in replies if e.event_type == 'NATION_REPLY'])
