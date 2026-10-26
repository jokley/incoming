"""Read-only presentation aggregates. Never allocate quota or change decisions."""
from quota_service import is_athlete, normalize_gender, athlete_quota_contexts


def build_quota_overview(people, quota_checks, athlete_checks, event, errors=()):
    people=[p for p in people if p.get('eventId') is None or str(p['eventId'])==str(event.id)]
    nations=[]
    for nation in sorted({p.get('nationCode') or '' for p in people}):
        roster=[p for p in people if (p.get('nationCode') or '')==nation]
        members={}
        missing_identity=False
        for index,p in enumerate(roster):
            identity=next((p.get(k) for k in ('existingAthleteId','personId','matchKey') if p.get(k) is not None and p.get(k)!=''),None)
            if identity is None:missing_identity=True;identity=f'unresolved:{index}'
            namespace='persisted' if p.get('existingAthleteId') is not None or p.get('personId') is not None else 'import'
            entry=members.setdefault((namespace,str(identity)),{'athlete':is_athlete(p),'groups':set(),'genders':set(),'functions':set(),'conflicting':False})
            entry['groups'].update(p.get('quotaDisciplines') or [])
            entry['genders'].add(normalize_gender(p.get('gender')))
            entry['functions'].add(p.get('function') or '')
            if entry['athlete']!=is_athlete(p):entry['conflicting']=True
            if entry['conflicting'] or not p.get('function'):missing_identity=True
        contexts=athlete_quota_contexts(roster)
        athletes={key for key,p in members.items() if p['athlete'] and not p['conflicting']}
        # Same presentation population as existing quota_service: mapped non-athletes.
        officials={key for key,p in members.items() if not p['athlete'] and p['groups'] and not p['conflicting']}
        other=set(members)-athletes-officials
        unmapped=sum(not any(context[1] in p['groups'] for context in contexts) for p in members.values() if not p['athlete'] and not p['conflicting'])
        checks=[q for q in quota_checks if q['nationCode']==nation]
        families=[q for q in athlete_checks if q['nationCode']==nation]
        incomplete=missing_identity or any(len(p['genders'])!=1 or not p['genders']<={'M','W'} for p in members.values() if p['athlete'])
        incomplete=incomplete or any('QUOTA' in e.get('code','') or 'MEMBERSHIP' in e.get('code','') or 'WSC_SOURCE' in e.get('code','') for e in errors)
        groups=[]
        for group in sorted({g for p in members.values() for g in p['groups']}):
            group_checks=[q for q in checks if q['discipline']==group]
            group_officials={key for key in officials if group in members[key]['groups']}
            group_athletes={key for key in athletes if group in members[key]['groups']}
            totals={field:sum(q.get(field,0) for q in group_checks) for field in
                    ('officialQuota','singleRoomsAllowed','singleRoomsRequested','singleRoomsPending','singleRoomsApproved','quotaExemptSingleRooms')}
            groups.append({'name':group,'athletes':len(group_athletes),'officials':len(group_officials),
                'contexts':[{k:v for k,v in q.items() if k!='singleRoomAllocations'} for q in group_checks],'totals':totals,'coverageReviewRequired':not group_checks or any(q.get('officialsExceeded') for q in group_checks)})
        shared=sum(len(members[key]['groups'])>1 for key in officials)
        approved=[q for q in families if any((q.get('approvedExtent') or {}).values())]
        # Quantity approvals on overlapping total/gender/family limits do not
        # establish a distinct set of approved people. Do not invent a count.
        nations.append({'nationCode':nation,'athletes':len(athletes),'officials':len(officials),
            'peopleInQuotaGroups':len(athletes|officials),'peopleTotal':len(members),'otherPeople':len(other),
            'officialsInMultipleGroups':shared,'officialsWithoutContext':unmapped,
            'officialsWithoutCoverage':None,
            'coverageReviewRequired':bool(unmapped or any(g['coverageReviewRequired'] for g in groups)),
            'athleteDecisionsOpen':sum(q.get('decisionStatus')=='PENDING' for q in families),
            'ezDecisionsOpen':sum(q.get('singleRoomsPending',0)>0 for q in checks),
            'athletesApprovedDistinct':None if approved else 0,'athleteApprovalFamilies':len(approved),
            'incomplete':bool(incomplete),'groups':groups,'athleteFamilies':[{k:v for k,v in q.items() if k!='evidence'} for q in families]})
    return {'event':{'id':str(event.id),'name':event.name,'isWorldChampionship':event.is_world_championship,
                    'rulesRevision':event.quota_rules_revision,'rulesFixed':bool(event.quota_rules_fixed_at)},'nations':nations}
