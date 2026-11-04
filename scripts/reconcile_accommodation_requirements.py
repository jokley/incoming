"""Review legacy No room rows; apply only explicitly selected IDs after inspection."""
import argparse
import json
from pathlib import Path
import sys
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))


def reconcile(ids=(), username='legacy-reconciliation'):
    from models import db, Athlete, AuditEvent
    from accommodation_mutations import lock_accommodation_writes
    from accommodation_requirements import legacy_candidates, set_requirement
    lock_accommodation_writes()
    candidates = legacy_candidates()
    by_id = {p['personId']: p for p in candidates}
    for identity in ids:
        if identity not in by_id or not by_id[identity]['eligible']:
            raise ValueError(f'{identity}: legacy No room candidate is no longer eligible; no changes applied')
    for identity in ids:
        person = db.session.get(Athlete, identity)
        set_requirement(person, 'NO_ROOM', 'IMPORT')
        person.accommodation_requirement_import_value = 'NO_ROOM'
        db.session.add(AuditEvent(username=username, action='update', entity_type='athletes', entity_id=str(identity),
            request_id=str(uuid.uuid4()), method='CLI', path='reconcile-accommodation-requirements',
            activity='Legacy-Unterkunftsbedarf abgeglichen', category='Personen',
            changes_json=json.dumps({'accommodation_requirement': {'old':'REQUIRED','new':'NO_ROOM'},
                'accommodation_requirement_source': {'old':'DEFAULT','new':'IMPORT'}})))
    if ids:
        db.session.commit()
    return candidates


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply-person-id', action='append', type=int, default=[])
    parser.add_argument('--username', default='legacy-reconciliation')
    args = parser.parse_args()
    from app import app
    with app.app_context():
        try:
            print(json.dumps(reconcile(args.apply_person_id, args.username), ensure_ascii=False, indent=2))
        except Exception:
            from models import db
            db.session.rollback()
            raise
