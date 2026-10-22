"""Read-only ownership preflight and explicit legacy assignment planning.

Uses reflected tables, so it works before and after the ownership migration.
Never imports application models and never writes data.
"""
import argparse
from datetime import date, datetime
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import sqlalchemy as sa

OWNER_COLUMNS = {
    'athlete': 'event_id', 'room_booking': 'event_id', 'import_session': 'event_id',
    'hotel_room_inventory': 'event_id', 'event': 'championship_event_id',
    'import_run': 'event_id',
}
REQUIRED_OWNERS = set(OWNER_COLUMNS) - {'import_run'}
TABLES = ('championship_event', 'hotel', 'room_type', 'hotel_room_inventory', 'event',
          'event_room_demand', 'athlete', 'athlete_competition', 'room_booking',
          'room_booking_occupant', 'import_session', 'import_session_version',
          'import_approval', 'import_run', 'room_assignment', 'fis_room_assignment',
          'import_session_event', 'event_competition', 'world_champion', 'audit_event')


class OwnershipError(ValueError):
    pass


def _json(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    raise TypeError(type(value).__name__)


def digest(value):
    return hashlib.sha256(json.dumps(value, default=_json, sort_keys=True,
                                    ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()


def inventory(connection):
    """A deterministic data snapshot, including FK consistency, without DML."""
    metadata = sa.MetaData()
    metadata.reflect(connection)
    tables, issues = {}, []
    for name in TABLES:
        table = metadata.tables.get(name)
        if table is None:
            issues.append(f'Missing table: {name}')
            continue
        keys = list(table.primary_key.columns)
        rows = [dict(r) for r in connection.execute(sa.select(table).order_by(*keys)).mappings()]
        # New owner fields are the only allowed data difference after migration.
        protected = [{k: v for k, v in row.items() if k != OWNER_COLUMNS.get(name)} for row in rows]
        tables[name] = {'count': len(rows), 'ids': [r.get('id') for r in rows],
                        'rows': rows, 'protected_sha256': digest(protected)}
        for constraint in table.foreign_key_constraints:
            elements = constraint.elements
            target = elements[0].column.table
            joined_target = target.alias() if target is table else target
            predicate = sa.and_(*(e.parent == joined_target.c[e.column.name] for e in elements))
            populated = sa.and_(*(e.parent.is_not(None) for e in elements))
            missing = joined_target.c[elements[0].column.name].is_(None)
            count = connection.scalar(sa.select(sa.func.count()).select_from(
                table.outerjoin(joined_target, predicate)).where(populated, missing))
            if count:
                issues.append(f'{name}: {count} dangling references to {target.name}')
    fingerprint = digest({name: t['protected_sha256'] for name, t in tables.items()})
    return {'format_version': 1, 'fingerprint': fingerprint, 'tables': tables, 'issues': issues}


def assignment_plan(report, config):
    """Validate explicit operator choices; do not infer ownership from row order."""
    if not isinstance(config, dict):
        raise OwnershipError('Ownership plan must be a JSON object')
    if report['issues']:
        raise OwnershipError('; '.join(report['issues']))
    if config.get('baseline_fingerprint') != report['fingerprint']:
        raise OwnershipError('Baseline fingerprint missing or stale; repeat read-only preflight')
    target = config.get('wsc_event_id')
    if type(target) is not int:
        raise OwnershipError('wsc_event_id must be an explicit integer ID')
    rows = {name: value['rows'] for name, value in report['tables'].items()}
    events = {r['id']: r for r in rows['championship_event']}
    if target not in events or events[target]['name'] != 'WSC Montafon 2027':
        raise OwnershipError('Selected ID does not identify WSC Montafon 2027')
    confirmations = config.get('rows', {})
    unknown = set(confirmations) - set(OWNER_COLUMNS)
    if unknown:
        raise OwnershipError(f'Unknown assignment tables: {sorted(unknown)}')
    result = {name: {} for name in OWNER_COLUMNS}
    for name, column in OWNER_COLUMNS.items():
        supplied = confirmations.get(name, {})
        ids = {str(r['id']) for r in rows[name]}
        if not isinstance(supplied, dict) or set(supplied) - ids:
            raise OwnershipError(f'{name}: unknown row IDs or invalid explicit mapping')
        for row in rows[name]:
            identity = row['id']
            current = row.get(column)
            # Productive inventory/planning ownership is explicitly authorized by this rollout.
            owner = supplied.get(str(identity), target if name in {'hotel_room_inventory', 'event'} else current)
            if owner is None and name in REQUIRED_OWNERS:
                raise OwnershipError(f'{name}:{identity}: explicit confirmed ownership required')
            if owner is not None and (type(owner) is not int or owner not in events):
                raise OwnershipError(f'{name}:{identity}: invalid event ID')
            if current is not None and current != owner:
                raise OwnershipError(f'{name}:{identity}: cannot reassign existing ownership')
            if name in {'hotel_room_inventory', 'event'} and owner != target:
                raise OwnershipError(f'{name}:{identity}: current productive stock must belong to WSC')
            result[name][identity] = owner
    def same(left, right, description):
        if left != right:
            raise OwnershipError(f'Mixed ownership: {description}')
    for r in rows['room_booking_occupant']:
        same(result['room_booking'][r['room_booking_id']], result['athlete'][r['athlete_id']], f'occupant {r["id"]}')
    versions = {r['id']: r for r in rows['import_session_version']}
    approvals = {r['id']: r for r in rows['import_approval']}
    for r in rows['import_session_version']:
        try:
            preview = json.loads(r.get('preview_json') or '{}')
        except (ValueError, TypeError):
            raise OwnershipError(f'Invalid preview JSON: version {r["id"]}')
        if not isinstance(preview, dict):
            raise OwnershipError(f'Invalid preview object: version {r["id"]}')
        if preview.get('eventId') is not None:
            same(str(result['import_session'][r['session_id']]), str(preview['eventId']), f'preview {r["id"]}')
    for r in rows['import_approval']:
        if r.get('version_id') and versions[r['version_id']]['session_id'] != r['session_id']:
            raise OwnershipError(f'Approval {r["id"]} points at another session version')
    for r in rows['import_session']:
        if r.get('current_version_id') and versions[r['current_version_id']]['session_id'] != r['id']:
            raise OwnershipError(f'Session {r["id"]} points at another session version')
    for r in rows['import_session_event']:
        if r.get('version_id') and versions[r['version_id']]['session_id'] != r['session_id']:
            raise OwnershipError(f'History {r["id"]} points at another session version')
        if r.get('approval_id') and approvals[r['approval_id']]['session_id'] != r['session_id']:
            raise OwnershipError(f'History {r["id"]} points at another session approval')
    for r in rows['import_approval']:
        try:
            details = json.loads(r.get('quota_details_json') or '{}')
        except (TypeError, ValueError):
            raise OwnershipError(f'Invalid approval JSON: {r["id"]}')
        if not isinstance(details, dict):
            raise OwnershipError(f'Invalid approval object: {r["id"]}')
        if details.get('eventId') is not None:
            same(str(result['import_session'][r['session_id']]), str(details['eventId']), f'approval scope {r["id"]}')
    for r in rows['athlete']:
        if r.get('single_room_decision_id'):
            approval = approvals[r['single_room_decision_id']]
            same(result['athlete'][r['id']], result['import_session'][approval['session_id']], f'person approval {r["id"]}')
    for name, a, b in [('room_assignment', 'athlete_id', 'shared_with_athlete_id'),
                       ('fis_room_assignment', 'person1_id', 'person2_id')]:
        for r in rows[name]:
            if r.get(b):
                same(result['athlete'][r[a]], result['athlete'][r[b]], f'{name}:{r["id"]}')
    for r in rows['fis_room_assignment']:
        if r.get('import_run_id') and result['import_run'][r['import_run_id']] is not None:
            same(result['athlete'][r['person1_id']], result['import_run'][r['import_run_id']], f'legacy run {r["id"]}')
    return result


def compare(before, after):
    differences = [name for name, value in before['tables'].items()
                   if name not in after['tables'] or value['protected_sha256'] != after['tables'][name]['protected_sha256']]
    if differences or after['issues']:
        raise OwnershipError(f'Protected data changed: {differences}; integrity: {after["issues"]}')


def main():
    parser = argparse.ArgumentParser(description='Read-only event ownership inventory (contains personal data)')
    parser.add_argument('--output', required=True)
    parser.add_argument('--plan', help='Validate explicit migration plan without applying it')
    parser.add_argument('--compare', help='Compare protected data against a previous report')
    args = parser.parse_args()
    from config import RuntimeSettings
    engine = sa.create_engine(RuntimeSettings.from_environment().database_url)
    with engine.connect().execution_options(isolation_level='REPEATABLE READ') as conn:
        conn.execute(sa.text('SET TRANSACTION READ ONLY'))
        report = inventory(conn)
        if args.plan:
            assignment_plan(report, json.loads(Path(args.plan).read_text()))
        if args.compare:
            compare(json.loads(Path(args.compare).read_text()), report)
    output = Path(args.output)
    # Exclusive create prevents overwriting a pre-migration baseline accidentally.
    with output.open('x', encoding='utf8') as stream:
        os.chmod(output, 0o600)
        json.dump(report, stream, default=_json, ensure_ascii=False, indent=2)
    print(json.dumps({'fingerprint': report['fingerprint'], 'counts': {n: t['count'] for n, t in report['tables'].items()}, 'issues': report['issues']}))
    if report['issues']:
        raise SystemExit(2)


if __name__ == '__main__':
    main()
