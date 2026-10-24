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
    from models import db, Event, EventAccess
    if not username.strip() or username != username.strip() or len(username) > 100:
        raise click.ClickException('Use the exact authenticated username (1–100 characters).')
    if db.session.get(Event,event_id) is None:
        raise click.ClickException('Championship does not exist.')
    row=db.session.get(EventAccess,(username,event_id))
    if row is None:
        row=EventAccess(username=username,event_id=event_id)
        db.session.add(row)
    row.can_write=write
    db.session.commit()
    click.echo(f'{username}: event {event_id}, {"read/write" if write else "read only"}')


@event_access.command('revoke')
@click.argument('username')
@click.argument('event_id', type=click.IntRange(min=1))
@with_appcontext
def revoke(username,event_id):
    from models import db, EventAccess
    row=db.session.get(EventAccess,(username,event_id))
    if row is not None:
        db.session.delete(row)
        db.session.commit()
    click.echo(f'{username}: event {event_id} revoked')
