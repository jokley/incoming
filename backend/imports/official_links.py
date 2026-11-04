"""Explicit, event/nation/source-bound Official links in existing append-only history."""
import json
import uuid
from datetime import datetime
from copy import deepcopy
from .normalization import normalize_whitespace, canonical_fis_code, normalize_string
from .identity import build_name_key
from .event_context import ImportValidationError

FORMAT = 'incoming.official-source-link'
FAMILIES = {'Snowboard', 'Freestyle'}


def identity(person, family):
    try:fis=canonical_fis_code(person.get('fisCode')) or None
    except ValueError:fis='__INVALID_FIS__'
    return dict(family=family, staffId=normalize_whitespace(person.get('sourceCompetitorId', person.get('competitorId'))) or None,
        fisCode=fis, firstname=person.get('firstname'),
        lastname=person.get('lastname'), nation=person.get('nationCode'), function=person.get('function'), row=person.get('rowNumber'))


def name_key(value):
    return build_name_key(value.get('lastname'), value.get('firstname'), value.get('nation'))


def eligible(value):
    return value.get('family') in FAMILIES and value.get('staffId') and not value.get('fisCode') and all(value.get(k) for k in ('firstname','lastname','nation','function')) and normalize_string(value['function']) != 'athlete'


def load_links(event_id, nation=None):
    from models import ImportSessionEvent, ImportSession
    query = ImportSessionEvent.query.join(ImportSession).filter(ImportSession.event_id==event_id, ImportSessionEvent.event_type=='OFFICIAL_SOURCE_LINK')
    if nation: query=query.filter(ImportSession.nation==nation)
    links=[]
    for event in query.order_by(ImportSessionEvent.id):
        try: doc=json.loads(event.description or '{}')
        except (TypeError,ValueError): continue
        if doc.get('format')==FORMAT and doc.get('schemaVersion')==1:
            links.append({**doc,'id':event.id})
    return links


def matching_link(value, links):
    matches=[link for link in links if any(i['family']==value['family'] and i['staffId']==value['staffId'] and name_key(i)==name_key(value) for i in link['identities'])]
    if len({link['primaryStaffId'] for link in matches})>1:
        raise ImportValidationError('OFFICIAL_LINK_CONFLICT','Widersprüchliche bestätigte Officials-Zuordnungen; keine automatische Vereinigung.')
    return matches[-1] if matches else None


def canonicalize(person, family, links, maps):
    value=identity(person,family)
    if not eligible(value):return person
    link=matching_link(value,links)
    if not link:return person
    primary=link['primaryStaffId']
    hits=maps['by_competitor_id'].get(primary,[])
    source_hits=maps['by_competitor_id'].get(value['staffId'],[])
    named=maps['by_name_key'].get(name_key(value),[])
    if len(hits)>1 or any(build_name_key(p.lastname,p.firstname,p.nation_code)!=name_key(value) or canonical_fis_code(p.fis_code) or normalize_string(getattr(p,'function',None))=='athlete' for p in hits) or any(p.id not in {h.id for h in hits} for p in source_hits) or (not hits and named):
        raise ImportValidationError('OFFICIAL_LINK_STALE','Bestätigte Officials-Zuordnung passt nicht mehr zu den aktuellen starken Identitäten; erneut prüfen.')
    person.update(sourceCompetitorId=value['staffId'], competitorId=primary, matchKey=primary,
        confirmedOfficialLinkId=link['id'],sourceIdentities=[value])
    return person


def source_view(source, family, context):
    """Normalize only confirmed aliases on a working copy; saved sources stay immutable."""
    source=deepcopy(source);aliases={}
    for p in source.get('people',[]):
        before=p['matchKey'];canonicalize(p,family,context.official_links,context.athlete_maps);aliases[before]=p['matchKey']
    for room in source.get('rooms',[]):
        for key in ('person1Key','person2Key'):
            if room.get(key) in aliases:room[key]=aliases[room[key]]
    for field in ('accommodationRateOverrides','accommodationRequirementOverrides','singleRoomQuotaExemptOverrides','singleRoomQuotaExemptOverrideRevisions'):
        if field in source:source[field]={aliases.get(k,k):v for k,v in source[field].items()}
    return source


def proposals(incoming, family, session, context):
    from .workflow import submission_heads, load_version_preview
    from .change_plan import digest
    if not session or family not in FAMILIES:return []
    heads=submission_heads(session)
    incoming=[identity(p,family) for p in incoming]
    pending=[]
    for other_family,version in heads.items():
        if other_family==family:continue
        source=load_version_preview(version)
        prior=[identity(p,other_family) for p in source.get('people',[])]
        for value in incoming:
            if not eligible(value) or matching_link(value,context.official_links):continue
            same=[i for i in prior if name_key(i)==name_key(value)]
            if len(same)!=1 or len([i for i in incoming if name_key(i)==name_key(value)])!=1:continue
            other=same[0]
            if not eligible(other) or value['staffId']==other['staffId']:continue
            # Strong-ID collisions with another current person are never confirmation candidates.
            strong=context.athlete_maps['by_competitor_id'].get(value['staffId'],[])
            prior_link=matching_link(other,context.official_links)
            primary=prior_link['primaryStaffId'] if prior_link else other['staffId']
            existing=context.athlete_maps['by_competitor_id'].get(primary,[])
            if strong:
                if len(strong)!=1 or any(build_name_key(p.lastname,p.firstname,p.nation_code)!=name_key(value) or p.fis_code or normalize_string(getattr(p,'function',None))=='athlete' for p in strong) or any(p.id!=strong[0].id for p in existing):
                    raise ImportValidationError('OFFICIAL_LINK_CONFLICT','Staff-ID der Quelle gehört bereits zu einer anderen oder mehrdeutigen Event-Person; keine automatische Zuordnung.')
                primary=value['staffId']
                existing=strong
            if len(existing)>1:continue
            if any(build_name_key(p.lastname,p.firstname,p.nation_code)!=name_key(value) or p.fis_code or normalize_string(getattr(p,'function',None))=='athlete' for p in existing):continue
            pair=sorted([value,{**other,'sourceVersionId':version.id}],key=lambda i:i['family'])
            pending.append(dict(key=digest(pair),name=f"{value['firstname']} {value['lastname']}",
                identities=pair,primaryStaffId=primary))
    return pending


def issue_proposal(session, candidates, *, source_hash=None):
    from excel_import import PREVIEW_STORE
    from .change_plan import state,digest
    token='official-link-'+uuid.uuid4().hex
    PREVIEW_STORE[token]=dict(createdAt=datetime.utcnow(),kind=FORMAT,eventId=session.event_id,nation=session.nation,
        sessionId=session.id,versionId=session.current_version_id,stateDigest=digest(state(session.event_id,session.nation)),
        sourceHash=source_hash,candidates=candidates)
    raise ImportValidationError('OFFICIAL_IDENTITY_REVIEW_REQUIRED',
        'Mögliche identische Officials mit unterschiedlichen Staff-IDs. Einmalige ausdrückliche Zuordnung erforderlich; noch keine Vereinigung.',
        event_id=session.event_id,details=dict(token=token,sessionId=str(session.id),candidates=candidates))


def confirm_links(session, data, username):
    from excel_import import PREVIEW_STORE,PREVIEW_TTL_SECONDS
    from models import db,ImportSessionEvent
    from .change_plan import state,digest
    proposal=PREVIEW_STORE.get(data.get('token'))
    if not proposal or proposal.get('kind')!=FORMAT or (datetime.utcnow()-proposal['createdAt']).total_seconds()>PREVIEW_TTL_SECONDS or proposal['sessionId']!=session.id or proposal['eventId']!=session.event_id or proposal['nation']!=session.nation or proposal['versionId']!=session.current_version_id or proposal['stateDigest']!=digest(state(session.event_id,session.nation)):
        raise ImportValidationError('OFFICIAL_LINK_STALE','Zuordnungsvorschlag veraltet oder gehört zu einem anderen Event; Dateien erneut prüfen.')
    keys=data.get('candidateKeys')
    if not isinstance(keys,list) or not keys or any(not isinstance(k,str) for k in keys) or len(set(keys))!=len(keys):
        raise ValueError('Eindeutig geprüfte Personen ausdrücklich auswählen.')
    selected=[p for p in proposal['candidates'] if p['key'] in keys]
    if len(selected)!=len(keys) or data.get('confirmed') is not True:
        raise ValueError('Personenzuordnung ausdrücklich bestätigen.')
    existing_links=load_links(session.event_id,session.nation)
    for item in selected:
        bound=[matching_link(i,existing_links) for i in item['identities']]
        if all(bound) or any(link and link['primaryStaffId']!=item['primaryStaffId'] for link in bound):
            raise ImportValidationError('OFFICIAL_LINK_STALE','Zuordnung bereits bestätigt oder zwischenzeitlich geändert; erneut prüfen.')
    for item in selected:
        doc=dict(format=FORMAT,schemaVersion=1,eventId=session.event_id,nation=session.nation,
            identities=item['identities'],primaryStaffId=item['primaryStaffId'],sourceHash=proposal['sourceHash'],
            confirmation='Explizite personenbezogene Zuordnung; keine Unterkunfts-, Tarif- oder Quotengenehmigung.')
        db.session.add(ImportSessionEvent(session_id=session.id,version_id=session.current_version_id,event_type='OFFICIAL_SOURCE_LINK',
            title='Official quellenbezogen zugeordnet',description=json.dumps(doc,ensure_ascii=False),username=username))
