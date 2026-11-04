"""Import verified title references for an explicit target Event; existing rows stay untouched."""
import argparse
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import app
from models import Event, db
from world_champions import reconcile_verified_titles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--event-id', type=int, required=True)
    parser.add_argument('--input', type=Path, default=Path(__file__).resolve().parents[1] / 'backend/reference_data/engadin_2025_world_champions.json')
    args = parser.parse_args()
    with app.app_context():
        if not db.session.get(Event, args.event_id):
            parser.error('Target Event does not exist')
        count = reconcile_verified_titles(args.event_id, json.loads(args.input.read_text()))
        db.session.commit()
        print(f'{count} verified title references created for Event {args.event_id}')


if __name__ == '__main__':
    main()
