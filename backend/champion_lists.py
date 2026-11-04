"""Whole-edition selection using central titles and existing recognition links."""
import json
from models import db, WorldChampion, WorldChampionRecognition


def catalogue():
    groups = {}
    for title in WorldChampion.query.order_by(WorldChampion.id):
        key = f'{title.championship_year}:{title.championship}'
        group = groups.setdefault(key, dict(id=key, championship=title.championship,
            year=title.championship_year, titleIds=[], eligibleIds=[]))
        group['titleIds'].append(title.id)
        if title.active and title.entitlement_enabled and title.title_type == 'INDIVIDUAL':
            group['eligibleIds'].append(title.id)
    return groups


def selection(event, groups):
    saved = json.loads(event.world_champion_list_json) if event.world_champion_list_json else None
    if saved:
        return dict(listId=saved['listId'], inferred=False, partial=False)
    # Read-only inference: only a complete, exact edition is presented as selected.
    links = {r.title_id:r for r in WorldChampionRecognition.query.filter_by(event_id=event.id)}
    active = {key for key,link in links.items() if link.active}
    for title in WorldChampion.query.filter_by(event_id=event.id):
        if title.id not in links and title.active and title.entitlement_enabled:
            active.add(title.id)
    matches = [key for key,value in groups.items() if active and active in (set(value['eligibleIds']),set(value['titleIds']))]
    return dict(listId=matches[0] if len(matches)==1 else None, inferred=len(matches)==1,
                partial=bool(active) and len(matches)!=1)


def choose(event, list_id):
    from world_champions import recognition_protected, audit_recognition
    groups = catalogue()
    if list_id is not None and list_id not in groups:
        raise ValueError('WM-Liste existiert nicht.')
    desired = set(groups[list_id]['titleIds']) if list_id is not None else set()
    links = {r.title_id:r for r in WorldChampionRecognition.query.filter_by(event_id=event.id)}
    effective = {key for key,link in links.items() if link.active}
    effective |= {t.id for t in WorldChampion.query.filter_by(event_id=event.id) if t.id not in links and t.active and t.entitlement_enabled}
    removed = effective - desired
    titles = {t.id:t for t in WorldChampion.query.filter(WorldChampion.id.in_(removed))}
    if any(recognition_protected(event.id,t) for t in titles.values()):
        raise ValueError('Verwendete Anerkennungen bleiben geschützt. Listenwechsel erfordert gesonderte Prüfung.')
    for key in sorted(desired | removed):
        link = links.get(key); old = key in effective; active = key in desired
        if old == active and link is not None: continue
        if link is None:
            from auth import current_user
            link = WorldChampionRecognition(event_id=event.id,title_id=key,active=active,created_by=current_user().username)
            db.session.add(link)
        else: link.active=active
        audit_recognition(event.id,key,old,active)
    event.world_champion_list_json = json.dumps(dict(listId=list_id,titleIds=sorted(desired)))
