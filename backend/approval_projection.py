"""Request-local acceleration of read-only approval projections.

The canonical validation remains in quota_history. Nothing is shared between
requests, and write/reimport paths never use this context.
"""
import json
from collections import defaultdict
from flask import g, has_request_context, request


class ApprovalReadProjection:
    def __init__(self):
        self.details = {}
        self.evidence = {}
        self.selected = {}
        self.events = {}
        self.results = {}
        self.cohorts = {}
        self.rosters = {}
        self.identities = {}
        self.contexts = {}
        self.references = []  # retain ORM identities while serializing

    def details_for(self, approval):
        key = id(approval)
        if key not in self.details:
            self.references.append(approval)
            self.details[key] = json.loads(approval.quota_details_json or '{}')
        return self.details[key]

    def selected_for(self, approval):
        key = id(approval)
        if key not in self.selected:
            self.selected[key] = {str(value) for value in json.loads(approval.approved_person_keys_json or '[]')}
        return self.selected[key]

    def evidence_for(self, approval):
        from quota_history import historical_approval_evidence
        key = id(approval)
        if key not in self.evidence:
            self.evidence[key] = historical_approval_evidence(approval)
        return self.evidence[key]

    def event_matches(self, approval, owner):
        from quota_history import approval_event_matches
        from models import db, Event, ImportSession, ImportSessionVersion
        key = (id(approval), owner)
        if key not in self.events:
            # Session identity-map uses weak references. Retain these read objects
            # so subsequent decisions do not refetch the same owner/version.
            self.references.extend([db.session.get(Event, owner) if owner else None,
                db.session.get(ImportSession, approval.session_id),
                db.session.get(ImportSessionVersion, approval.version_id) if approval.version_id else None])
            self.events[key] = approval_event_matches(approval, owner)
        return self.events[key]

    def roster_for(self, person):
        from models import Athlete
        from sqlalchemy.orm import selectinload
        key = (person.event_id, person.nation_code)
        if key not in self.rosters:
            self.rosters[key] = Athlete.query.filter_by(event_id=person.event_id,
                nation_code=person.nation_code).options(selectinload(Athlete.competitions)).all()
        return self.rosters[key]

    def roster_key(self, roster):
        return tuple(id(p) for p in roster)

    def index_for(self, roster):
        from quota_history import person_keys
        key = self.roster_key(roster)
        if key not in self.identities:
            index = defaultdict(list)
            for person in roster:
                for identity in person_keys(person):
                    index[identity].append(person)
            self.identities[key] = index
            self.references.extend(roster)
        return self.identities[key]

    def current_keys(self, person, roster):
        from quota_history import quota_person
        from quota_service import athlete_quota_contexts, quota_keys
        key = self.roster_key(roster)
        if key not in self.contexts:
            self.contexts[key] = athlete_quota_contexts([quota_person(p) for p in roster])
            self.references.extend(roster)
        return quota_keys(quota_person(person), allowance_contexts=self.contexts[key])

    def groups(self, approval, person, person_key=None, roster=None):
        from quota_history import applicable_approval_groups
        if not approval:
            return set()
        # Distinguish an explicitly supplied roster (possibly a preview target)
        # from the persisted event/nation roster. Never broaden that input.
        roster_key = self.roster_key(roster) if roster is not None else None
        key = (id(approval), id(person), person_key, roster_key)
        if key not in self.results:
            self.references.append(person)
            self.results[key] = applicable_approval_groups(approval, person,
                person_key, roster, _projection=self)
        return set(self.results[key])


def projected_approval_groups(approval, person, person_key=None, roster=None):
    from quota_history import applicable_approval_groups
    if not has_request_context() or request.method not in {'GET', 'HEAD'}:
        return applicable_approval_groups(approval, person, person_key, roster)
    context = getattr(g, '_approval_read_projection', None)
    if context is None:
        context = g._approval_read_projection = ApprovalReadProjection()
    return context.groups(approval, person, person_key, roster)
