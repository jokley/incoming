"""Athlete admission review on existing ImportApproval evidence; no person writes."""
import json
from quota_rules import fingerprint, rules_for_event, accommodation_rule_event
from quota_service import evaluate_athlete_quota_usage,normalize_gender
from competitions import athlete_top_level_discipline


def quota_rows(people, rules, event_id, approvals=(), revision=1):
    names={str(p.get('matchKey') or p.get('personId')):' '.join(filter(None,[p.get('firstname'),p.get('lastname')])) or p.get('name') for p in people}
    rows=evaluate_athlete_quota_usage(people,rules)
    for row in rows:
        family=row['topLevelDiscipline'];nation=row['nationCode']
        roster={str(p.get('matchKey') or p.get('personId')): {
            'key':str(p.get('matchKey') or p.get('personId')), 'gender':'F' if normalize_gender(p.get('gender'))=='W' else normalize_gender(p.get('gender')),
            'competitions':sorted(str(c) for c in p.get('competitionIds',[]))}
            for p in people if (p.get('function') or '').strip().lower()=='athlete'
            and p.get('nationCode')==nation and family in p.get('athleteQuotaFamilies', [athlete_top_level_discipline(g) for g in p.get('quotaDisciplines',[])])}
        required={'total':max(0,row['athleteQuotaUsed']-row['athleteQuotaLimit']),
                  'M':max(0,row['athleteGenderUsed']['M']-row['athleteGenderLimit']),
                  'F':max(0,row['athleteGenderUsed']['F']-row['athleteGenderLimit'])}
        evidence={'decisionKind':'ATHLETE_QUOTA','eventId':event_id,'nationCode':nation,
                  'family':family,'rulesRevision':revision,'rulesDigest':fingerprint(rules),'rulesSnapshot':rules,
                  'rosterDigest':fingerprint(sorted(roster.values(),key=lambda p:p['key'])),
                  'required':required,'candidates':[{'personKey':key,'name':names.get(key) or key,'gender':roster[key]['gender']} for key in sorted(roster)]}
        scope=fingerprint({k:evidence[k] for k in ('eventId','nationCode','family','rulesRevision','rulesDigest','rosterDigest')})
        evidence['scopeDigest']=scope
        covered={k:0 for k in required};ids=[]
        for approval in approvals:
            details=json.loads(approval.quota_details_json or '{}')
            if approval.decision!='APPROVED' or details.get('decisionKind')!='ATHLETE_QUOTA' or details.get('scopeDigest')!=scope:
                continue
            ids.append(approval.id)
            for key in covered:covered[key]+=details.get('approvedExtent',{}).get(key,0)
        row.update(requiredExtent=required,approvedExtent=covered,
                   uncoveredExtent={k:max(0,required[k]-covered[k]) for k in required},
                   decisionStatus='PENDING' if any(required[k]>covered[k] for k in required) else 'APPROVED' if any(required.values()) else 'WITHIN_QUOTA',
                   approvalIds=ids, evidence=evidence)
    return rows


def project_preview(preview, read_context=None):
    from models import Event,ImportApproval,ImportSession,ImportSessionVersion,ImportSessionEvent,db
    rules=rules_for_event(preview['eventId'])
    event=accommodation_rule_event(db.session.get(Event,preview['eventId']))
    nations={p.get('nationCode') for p in preview.get('people',[])}
    superseded=db.select(ImportSessionEvent.approval_id).where(ImportSessionEvent.event_type=='QUOTA_DECISION_REVISED_FROM',ImportSessionEvent.approval_id.isnot(None),ImportSessionEvent.session_id.in_(db.select(ImportSession.id).where(ImportSession.event_id==preview['eventId'])))
    approvals=ImportApproval.query.join(ImportSession).join(ImportSessionVersion,(ImportSessionVersion.id==ImportApproval.version_id)&(ImportSessionVersion.session_id==ImportApproval.session_id)).filter(ImportSession.event_id==preview['eventId'],ImportSession.nation.in_(nations),
        ImportApproval.decision=='APPROVED',~ImportApproval.id.in_(superseded)).order_by(ImportApproval.id).all()
    preview['quotaRulesSnapshot']=rules
    preview['quotaRulesDigest']=fingerprint(rules)
    preview['quotaRulesRevision']=event.quota_rules_revision
    preview['athleteQuotaChecks']=quota_rows(preview.get('people',[]),rules,preview['eventId'],approvals,event.quota_rules_revision)
    preview['warnings']=[w for w in preview.get('warnings',[]) if w.get('code')!='QUOTA_ATHLETE_EXCEEDED']
    for row in preview['athleteQuotaChecks']:
        if any(row['uncoveredExtent'].values()):
            preview['warnings'].append({'code':'QUOTA_ATHLETE_EXCEEDED','message':'Athleten-/Disziplinquote benötigt eine Ausnahmeentscheidung.',
                'details':{**row['evidence'],'uncoveredExtent':row['uncoveredExtent']}})
    unknown=[{'code':'ATHLETE_QUOTA_FAMILY_UNKNOWN','message':'Quotenfamilie der Athletenmeldung ist nicht unterstützt.',
        'details':{'personKey':p.get('matchKey')}} for p in preview.get('people',[])
        if (p.get('function') or '').strip().lower()=='athlete' and (not p.get('athleteQuotaFamilies') or None in p['athleteQuotaFamilies'])]
    preview['errors']=[e for e in preview.get('errors',[]) if e.get('code')!='ATHLETE_QUOTA_FAMILY_UNKNOWN']+unknown
    preview['isValid']=not preview['errors']
    from athlete_quota_tariffs import project_tariffs
    project_tariffs(preview, approvals)
    from quota_overview import build_quota_overview
    preview['quotaOverview']=build_quota_overview(preview.get('people',[]),preview.get('quotaChecks',[]),preview['athleteQuotaChecks'],event,preview['errors'])


def reconcile_tasks(session,preview):
    from models import db,ImportApproval,ImportSessionEvent
    db.session.flush()  # Materialize current_version_id before binding new tasks.
    remaining_rows={row['evidence']['scopeDigest']:row for row in preview.get('athleteQuotaChecks',[]) if any(row['uncoveredExtent'].values())}
    for item in list(session.current_approvals):
        details=json.loads(item.quota_details_json or '{}')
        if item.decision=='APPROVED' or details.get('decisionKind')!='ATHLETE_QUOTA':continue
        row=remaining_rows.get(details.get('scopeDigest'))
        if row and details.get('uncoveredExtent')==row['uncoveredExtent']:
            remaining_rows.pop(details['scopeDigest'])
        else:db.session.delete(item)
    for row in remaining_rows.values():
        details={**row['evidence'],'uncoveredExtent':row['uncoveredExtent']}
        db.session.add(ImportApproval(session_id=session.id,version_id=session.current_version_id,nation=session.nation,
            approval_type='ATHLETE_QUOTA',description=f"Athletenquote · {row['topLevelDiscipline']}",decision='PENDING',
            quota_details_json=json.dumps(details),username='quota-evaluation'))
        db.session.add(ImportSessionEvent(session_id=session.id,version_id=session.current_version_id,
            event_type='QUOTA_VIOLATION',title=f"Athletenquote offen · {row['topLevelDiscipline']}",
            description=json.dumps(row['uncoveredExtent']),username=session.current_version.uploaded_by))
    db.session.flush();db.session.expire(session,['approvals','history'])
    if any(a.decision!='APPROVED' for a in session.current_approvals):session.status='WAITING_FOR_NATION'


def requirement_errors(preview,approvals,require_approved):
    errors=[]
    for row in preview.get('athleteQuotaChecks',[]):
        if not any(row['uncoveredExtent'].values()):continue
        if not require_approved and any(json.loads(a.quota_details_json or '{}').get('scopeDigest')==row['evidence']['scopeDigest']
                                      and a.decision!='APPROVED' for a in approvals):continue
        errors.append({'code':'ATHLETE_QUOTA_UNREVIEWED','message':'Ungedeckte Athletenquote benötigt eine Entscheidung.',
                       'details':{'family':row['topLevelDiscipline'],'uncoveredExtent':row['uncoveredExtent']}})
    return errors


def validated_extent(details,data,*,allow_zero=False):
    extent=data.get('approvedExtent')
    remaining=details['uncoveredExtent']
    if not isinstance(extent,dict) or set(extent)!={'total','M','F'} or any(type(v) is not int or v<0 or v>remaining[k] for k,v in extent.items()) or (not allow_zero and not any(extent.values())):
        raise ValueError('Ausnahmeumfang muss je Grenze positiv und höchstens der offene Rest sein.')
    keys=data.get('approvedPersonKeys') or []
    valid={c['personKey'] for c in details['candidates']}
    if not isinstance(keys,list) or any(not isinstance(k,str) for k in keys) or len(keys)!=len(set(keys)) or not set(keys)<=valid:
        raise ValueError('Ungültige optionale Personenauswahl.')
    from athlete_quota_tariffs import validate_tariff_selection
    effect = data.get('tariffEffect', 'NONE')
    validate_tariff_selection(details, extent, keys, effect)
    resolved = {**details,'approvedExtent':extent,'tariffEffect':effect}
    resolved.pop('approvedPersonKeysByBoundary', None)
    return resolved,keys
