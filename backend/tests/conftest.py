"""Explicit championship fixture for legacy tests predating mandatory ownership.

Existing tests exercise domain rules, not owner selection. Seed/choose their fixture
championship and configure the same compatibility setting used by single-event API
writes. Ownership-specific tests opt out and supply every FK explicitly; DB NOT NULL
and cross-event guards remain fully enabled.
"""
import pytest
from flask import current_app, has_app_context
from sqlalchemy import event, select, func


def pytest_configure(config):
    config.addinivalue_line('markers', 'quota_rule_lifecycle: exercises draft/fixed rules without legacy policy fixture')
    config.addinivalue_line('markers', 'explicit_event_ownership: supplies ownership explicitly without legacy fixture defaults')


@pytest.fixture(autouse=True)
def legacy_championship_fixture(request):
    if request.node.get_closest_marker('explicit_event_ownership'):
        yield
        return
    from models import db, Event, Athlete, RoomBooking, ImportSession, HotelRoomInventory, AccommodationEvent, ImportRun
    changed_configs = {}
    def prepare(session, context, instances):
        if not has_app_context():
            return
        owned = [obj for obj in session.new if isinstance(obj, (Athlete,RoomBooking,ImportSession,HotelRoomInventory,AccommodationEvent,ImportRun))]
        pending_events = [obj for obj in session.new if isinstance(obj, Event)]
        if not owned and len(pending_events) != 1:
            return
        app = current_app._get_current_object()
        changed_configs.setdefault(app, app.config.get('OPERATIONAL_EVENT_ID'))
        field = lambda obj: 'championship_event_id' if isinstance(obj,AccommodationEvent) else 'event_id'
        explicit = {getattr(obj,field(obj)) for obj in owned if getattr(obj,field(obj)) is not None}
        pending = [obj for obj in session.new if isinstance(obj,Event)]
        existing = session.connection().execute(select(Event.id)).scalars().all()
        if len(explicit)==1:
            owner=next(iter(explicit))
        elif len(pending)==1:
            if pending[0].id is None:
                pending[0].id=max(existing or [0])+1
            owner=pending[0].id
        elif len(existing)==1:
            owner=existing[0]
        elif not existing and not pending:
            owner=900000001
            session.connection().execute(Event.__table__.insert().values(id=owner,name='Explicit legacy test championship',year=2027,active=True,quota_rules_json=__import__('json').dumps(__import__('quota_rules').standard_rules()),quota_rules_fixed_at=__import__('datetime').datetime(2026,10,23),quota_rules_fixed_by='explicit-test-fixture',quota_rules_revision=1))
        elif app.config.get('OPERATIONAL_EVENT_ID') in existing:
            owner=app.config['OPERATIONAL_EVENT_ID']
        else:
            raise AssertionError('Legacy fixture requires an explicit test event; adapt this test')
        app.config['OPERATIONAL_EVENT_ID']=owner
    event.listen(db.session, 'before_flush', prepare, insert=True)
    try:
        yield
    finally:
        event.remove(db.session,'before_flush',prepare)
        for app,old in changed_configs.items():
            if old is None:app.config.pop('OPERATIONAL_EVENT_ID',None)
            else:app.config['OPERATIONAL_EVENT_ID']=old


@pytest.fixture(autouse=True)
def explicit_standard_quota_policy_for_existing_fixtures(request):
    """Old domain fixtures explicitly use the frozen historical policy.

    PR7 lifecycle tests opt out; production never seeds/fixes policy implicitly.
    """
    if request.node.get_closest_marker('quota_rule_lifecycle'):
        yield
        return
    from datetime import datetime
    import json
    from models import Event, db
    from quota_rules import standard_rules
    def seed(session, context, instances):
        for obj in session.new:
            if isinstance(obj,Event) and obj.quota_rules_json is None:
                obj.quota_rules_json=json.dumps(standard_rules())
                obj.quota_rules_fixed_at=datetime(2026,10,23)
                obj.quota_rules_fixed_by='explicit-test-fixture'
                obj.quota_rules_revision=1
    event.listen(db.session,'before_flush',seed,insert=True)
    try:yield
    finally:event.remove(db.session,'before_flush',seed)
