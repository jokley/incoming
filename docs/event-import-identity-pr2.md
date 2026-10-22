# PR 2 — Event-bound FIS import identity

Based on PR 1 (`20261022_01`). No new schema/migration is required. This change has
not deployed or migrated a production database. Keep PR 1's reviewed ownership
plan, inventory fingerprint, backup and `OPERATIONAL_EVENT_ID` prerequisites in
[the deployment runbook](event-ownership-pr1.md).

## Import boundary

- Upload requires an explicit active championship Event. Preview, source hash,
  people projections and the persisted session/version retain that identity.
- Session lookup is `(event_id, nation)`. Request/session/token/preview mismatches
  block the request; session ownership is never replaced by request data.
- Session/approval URLs accept `eventId` (query or JSON); old single-event clients
  may use `OPERATIONAL_EVENT_ID`. With no explicit/default selection, a validated
  owning session supplies the context. The session-list endpoint requires an
  explicit selection or the configured single-event default.
- `g.import_event_id` is request-local and is established after authentication,
  authorization and validation. It permits explicit import writes for their
  selected Event; it is not a global active event or general multi-event UI.
  An explicit Event B is never replaced by a configured Event A.
- Versions must belong to their current session. An eventless historic preview
  can inherit its owning session, but explicit conflicting evidence is rejected.

## Identity and preservation

`ImportReadContext(event_id)` preloads only that Event's people, booking and legacy
relationships and approval evidence. Global Competition master data stays global;
import membership resolution/confirmation uses only the active EventCompetition
mapping. Matching never falls back to another Event.

One canonical `imports.normalization.canonical_fis_code` is reused by the parser,
existing-person indices and World Champion/reference/evidence lookups. Integer
`9300953`, string `"9300953"`, float `9300953.0` and string `"9300953.0"` become
`"9300953"`. String leading zeros remain intact. Non-integral, imprecise or
ambiguous numeric renderings are rejected; no arbitrary float parsing is used.
Opaque historical string identifiers are retained verbatim, not converted into
numbers. The parser's `sourceFisCode` retains the source spelling in preview and
version evidence. Numeric legacy approval-key `.0` evidence is recognized only
against the same exact FIS identity and validated Event/session.

All supplied FIS/Staff IDs are checked together. One compatible candidate wins;
a missing strong ID may be added to that person. An absent source ID does not erase
an existing strong ID. Different candidates, duplicate indices, conflicting stored
IDs, duplicate incoming strong IDs and multiple rows targeting one person block
review/confirmation with `IMPORT_IDENTITY_CONFLICT`. Complete name + nation is only
a unique, compatible fallback. Room-list names likewise cannot pick an arbitrary
last collision or override an explicitly conflicting nation.

NO_ROOM, SPECIAL, manual exemptions, approval evidence, override bases/revisions and
bookings are read/preserved only through the matched Event-owned person. Approval
scope checks require matching owning session, version evidence, current membership
and gender/nation evidence. Quota formulas and operational field meanings are
unchanged. Memberships use the existing AthleteCompetition association and are
de-duplicated per person.

## Deliberate PR 3 safety boundary

Automatic duplicate deletion is disabled. A confirmation with missing people in
its Event + imported nation blocks with
`IMPORT_DESTRUCTIVE_CHANGE_REVIEW_REQUIRED`, before person/membership changes. No
other Event is included in the missing-person set. The final scoped recheck also
blocks a newly detected missing row; API callers roll back on failure.

This is not the complete snapshot change/deletion plan. PR 3 must define explicit
scope, review evidence, concurrency/staleness checks, mutation planning and the
remaining split data/status transaction boundary. ImportSession cancellation with
live approval references also blocks instead of clearing operative decisions.

Identical-file version deduplication and the process-local preview-token store are
retained. Durable/restart-safe confirmation and a redesigned reimport workflow
are not introduced here.

## Remaining global paths

Do not release a second operational event in the general workspace yet. Athlete
list/detail aggregation, non-import editing, booking/accommodation mutations,
availability, Dashboard/Analytics/reports, administrative resets and general
quota/read models still require their follow-up isolation work. Import-scoped
inputs to evaluators are isolated here; general evaluators/formulas are untouched.
No ActiveEventProvider, header selector, global Person or EventParticipation was
added. No production/test data cleanup is part of this change.

## Reproduction and validation

Use only the fail-closed loopback PostgreSQL service accepted by `test_support`:

```sh
cd backend
PYTHONPATH=. FLASK_ENV=test TEST_DATABASE_URL='<dedicated test URL>' \
  JPN_ENTRIES_FILE='/local/path/ENTRIES-LIST_2027_SB_WSC_Montafon_JPN_2026_10_20-12-14-39.xlsx' \
  JPN_ROOMS_FILE='/local/path/ENTRIES-ROOM-LIST-DETAILED_2027_SB_WSC_Montafon_JPN_2026_10_20-12-14-38.xlsx' \
  python -m pytest tests/test_import_event_identity.py -q
```

The private uploaded workbooks are not committed. Portable numeric-format cases
and the existing AUS/USA/KOR/FIN fixtures remain in automated coverage; the two
real-file acceptance tests skip explicitly when local paths are absent.

Real JPN evidence: 64 people per Event, two isolated JPN sessions, zero new people
on identical reupload/reimport. Tested both direct helper confirmation and the
actual Flask upload → review → explicit EZ approval → approve → confirm endpoints,
including an explicit B import with the compatibility default pointing to A.

Legacy tests now prepare explicit test championship/mapping evidence rather than
asserting arbitrary collision winners, eventless persistence or destructive import
cleanup. Tests are not disabled. A clean checkout of the merged baseline was run
with the same interpreter, working directory and isolated PostgreSQL service for
comparison. Final totals are recorded in the implementation report.

## Final validation record

- Full backend, actual JPN file paths enabled: **659 passed, 8 failed,
  1194 subtests passed**, no skipped acceptance tests.
- Clean merged-main baseline, same command/environment: **632 passed, 8 failed,
  1194 subtests passed**. Failure node IDs are identical; no new failures. The
  previously reported ninth failure (a fixture path resolved from the repository
  root) does not reproduce when both suites run from the required backend directory.
- All **27 new identity/isolation acceptance cases** passed, including real JPN
  helper and HTTP workflows and leading-zero workbook cells.
- Existing real workbook, import-performance budgets and preservation tests pass.
  Structural budgets remain: preview/recalculation <80 statements, confirm <160,
  confirm <=6 flushes, session list <125. No per-hotel/person HTTP calls were added;
  approval evidence is fetched in event-scoped batches.
- Backup runtime suite: **17 passed**. Python compilation and diff whitespace
  checks passed. No frontend files changed; no browser/deployment verification
  is claimed.

Unchanged baseline failures:

- `backend/tests/test_api_characterization.py::ApiCharacterizationTest::test_person_and_quota_aliases_keep_read_projection`
- `backend/tests/test_api_route_safety.py::ApiRouteSafetyTest::test_registered_paths_and_methods_match_reviewed_manifest`
- `backend/tests/test_assignment_planning_projection.py::AssignmentPlanningProjectionTest::test_approved_extra_initializes_single_flag_independent_of_room_type`
- `backend/tests/test_assignment_planning_projection.py::AssignmentPlanningProjectionTest::test_non_entitled_single_occupant_is_not_marked_exclusive`
- `backend/tests/test_assignment_planning_projection.py::AssignmentPlanningProjectionTest::test_quota_single_flag_is_not_derived_from_entitlement_or_occupancy`
- `backend/tests/test_import_extraction_characterization.py::test_preview_selects_only_active_mapping_and_preserves_unknown_error_structure`
- `backend/tests/test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types`
- `backend/tests/test_wsc_membership_validation.py::test_missing_mapping_blocks_rows_and_confirmation`

## Changed files and responsibilities

- `backend/app.py`: request context validation; session list/lookup; staging,
  approval, token/current-version checks; cancellation guard.
- `backend/event_ownership_runtime.py`: permit validated explicit import context
  only for import-owned ORM writes; general workspace remains single-event.
- `backend/excel_import.py`: parser/source IDs, preview/recalculation, preserved
  decisions, room evidence, confirm matching/memberships and destructive blockers.
- `backend/imports/event_context.py`: strict IDs and session/preview validation.
- `backend/imports/identity.py`: scoped indices, compatible strong-ID matching,
  bounded names, conflict and incoming-duplicate checks.
- `backend/imports/normalization.py`: canonical exact FIS rendering.
- `backend/imports/read_context.py`: request-local scoped preload.
- `backend/quota_history.py`: session/event/evidence checks and scoped rosters.
- `backend/world_champions.py`: reuse canonical normalization.
- `backend/test_support.py`, `backend/tests/conftest.py`: explicit isolated fixture
  ownership/mapping; constraints stay enabled.

Changed acceptance/regression test files:

- `backend/tests/test_accommodation_requirements.py`
- `backend/tests/test_api_route_safety.py`
- `backend/tests/test_athlete_quota.py`
- `backend/tests/test_canonical_quota.py`
- `backend/tests/test_current_quota_decisions.py`
- `backend/tests/test_fis_event_groups.py`
- `backend/tests/test_import_athlete_single_room_quota.py`
- `backend/tests/test_import_extraction_characterization.py`
- `backend/tests/test_import_operational_impacts.py`
- `backend/tests/test_import_safety_baseline.py`
- `backend/tests/test_person_identity.py`
- `backend/tests/test_person_list_quota_population.py`
- `backend/tests/test_precommit_fixes.py`
- `backend/tests/test_scenario_generator.py`
- `backend/tests/test_single_room_status.py`
- `backend/tests/test_wsc_membership_validation.py`
- `backend/tests/test_import_event_identity.py`
