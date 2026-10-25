"""Narrow global administration, separate from operative Event authorization."""
from flask import abort, g, request
from auth import current_user

EVENT_ENDPOINTS = frozenset({
    'events.administer_events', 'events.administer_event', 'events.add_event_competition',
    'events.update_event_competition', 'events.copy_event_competitions',
    'events.event_quota_rules', 'events.fix_event_quota_rules', 'events.revise_quota_rules',
    'world_champions.event_champions', 'world_champions.event_champion_list',
})
CATALOGUE_ENDPOINTS = frozenset({'world_champions.title_catalogue', 'world_champions.champion_lists', 'world_champions.champions', 'world_champions.champion'})


def can_administer_events():
    user = current_user()
    return bool(user and (user.is_superadmin or user.has_permission('events.manage') or user.has_permission('admin.reset')))


def bind_admin_target():
    from models import db, Event
    from imports.event_context import normalize_event_id
    from event_ownership_runtime import OperationalEventError
    if not can_administer_events():
        abort(403)
    target = (request.view_args or {}).get('event_id')
    reference_edit = request.endpoint in {'world_champions.champions','world_champions.champion'}
    if reference_edit:
        if (request.view_args or {}).get('champion_id') is not None:
            from models import WorldChampion
            target = db.get_or_404(WorldChampion, request.view_args['champion_id']).event_id
        elif request.method == 'POST':
            target = normalize_event_id((request.get_json(silent=True) or {}).get('eventId'))
    if target is not None:
        if db.session.get(Event, target) is None:
            abort(404)
        supplied = request.headers.get('X-Championship-Event-ID')
        if not reference_edit and supplied is not None and normalize_event_id(supplied) != target:
            raise OperationalEventError('Administrative request header and target Event differ')
        g.authorized_event_id = target


def bind_reset_target():
    """Global reset authority still names one explicit, pin-compatible target."""
    from flask import current_app
    from models import db,Event
    from imports.event_context import normalize_event_id
    from event_ownership_runtime import deployment_event_id,OperationalEventError
    value=request.headers.get('X-Championship-Event-ID')
    owner=normalize_event_id(value) if value is not None else deployment_event_id()
    if current_app.config.get('OPERATIONAL_EVENT_ID') and owner!=deployment_event_id():
        raise OperationalEventError('Reset target conflicts with the pinned championship')
    event=db.session.get(Event,owner)
    if event is None or not event.active: abort(403)
    g.authorized_event_id=owner
