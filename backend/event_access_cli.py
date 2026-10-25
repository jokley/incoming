"""Operator-managed grants; no public self-service or implicit administrator grants."""
import click
from flask.cli import with_appcontext


@click.group('event-access')
def event_access():
    """Manage explicit grants in the explicitly configured database."""


@event_access.command('grant')
@click.argument('username')
@click.argument('event_id', type=click.IntRange(min=1))
@click.option('--write/--read-only', default=False)
@with_appcontext
def grant(username, event_id, write):
    from models import db
    from user_access import lock_grants, set_grant
    try:
        lock_grants()
        set_grant(username, event_id, 'WRITE' if write else 'READ', 'operator-cli', operator_maintenance=True)
        db.session.commit()
    except ValueError as error:
        db.session.rollback()
        raise click.ClickException(str(error))
    click.echo(f'{username}: event {event_id}, {"read/write" if write else "read only"}')


@event_access.command('revoke')
@click.argument('username')
@click.argument('event_id', type=click.IntRange(min=1))
@with_appcontext
def revoke(username,event_id):
    from models import db
    from user_access import lock_grants, set_grant
    try:
        lock_grants()
        set_grant(username, event_id, 'NONE', 'operator-cli', operator_maintenance=True)
        db.session.commit()
    except ValueError as error:
        db.session.rollback()
        raise click.ClickException(str(error))
    click.echo(f'{username}: event {event_id} revoked')


@event_access.command('bootstrap')
@click.option('--username', 'usernames', multiple=True, required=True)
@click.option('--write/--read-only', default=False)
@click.option('--apply', 'expected_digest', help='Apply exactly the reviewed preview digest.')
@with_appcontext
def bootstrap(usernames, write, expected_digest):
    """Preview explicit users × current active events; preserve every existing grant."""
    import json
    from sqlalchemy import text
    from models import db
    from user_access import lock_grants, bootstrap_plan, set_grant
    try:
        lock_grants()
        # Prevent concurrent event additions/activation from changing the reviewed set.
        db.session.execute(text('LOCK TABLE championship_event IN SHARE MODE'))
        plan = bootstrap_plan(usernames, 'WRITE' if write else 'READ')
        if expected_digest:
            if expected_digest != plan['digest']:
                raise ValueError('Preview changed; inspect the current plan before applying.')
            for change in plan['changes']:
                set_grant(change['username'], change['eventId'], change['level'], 'operator-cli-bootstrap')
            db.session.commit()
            click.echo(json.dumps({'applied': len(plan['changes']), 'reviewedDigest': expected_digest}))
        else:
            click.echo(json.dumps(plan, ensure_ascii=False, indent=2))
            db.session.rollback()
    except ValueError as error:
        db.session.rollback()
        raise click.ClickException(str(error))
