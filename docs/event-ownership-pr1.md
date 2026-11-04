# PR 1: Event ownership deployment runbook

This release introduces ownership, not full event isolation. **Do not operate a
second event yet.** Existing global queries, identity lookup and legacy mutation
paths are follow-up work. Global hotels, room types and competitions are retained.
No EventParticipation or duplicate global person model is introduced.

## Required maintenance window

1. Take and verify a recoverable database backup before deployment.
2. Stop application writers, imports, simulation tools and other workers. Do not
   run resets or seed scripts. The migration also locks the relevant tables.
3. Use the *new* backend image as a one-shot tool with its entrypoint overridden;
   its normal entrypoint runs Alembic automatically. Do not start the new normal
   backend before preflight and plan review.
4. Run the read-only report against the intended database:

   `python -m event_ownership --output /review/before.json`

   It uses PostgreSQL REPEATABLE READ / READ ONLY, never writes database data,
   reports every requested table plus reference/history data and checks FKs.
   Reports contain personal information; output is exclusive-create, mode 0600.
5. Inspect event IDs/names/year/active status, all stock, the seven planning events
   (Parallel, Aerials, Moguls, Big Air, Slopestyle, Snowboard Cross, Ski Cross), all
   demands and any operational/test rows. Do not assume these tables are empty.
6. Create a reviewed plan. Example IDs below are placeholders, not defaults:

   ```json
   {
     "wsc_event_id": 123,
     "baseline_fingerprint": "copy exact fingerprint from before.json",
     "rows": {
       "athlete": {"91": 123},
       "room_booking": {"18": 123},
       "import_session": {"4": 123},
       "import_run": {"7": 123}
     }
   }
   ```

   Use `{}` for mappings whose tables are empty. Every pre-existing person,
   booking and session requires an explicit per-row confirmed owner. No inference
   from first/active event, year or nation is made. Target ID must resolve exactly
   to the existing `WSC Montafon 2027` record; it is never created or replaced.
   Existing inventories and planning events receive this confirmed target, as
   explicitly authorized for this rollout. All their old fields remain unchanged.
   Unknown ImportRun provenance may remain NULL; record it for later review.
   Clearly identified runs should be explicitly mapped. Unknown rows are never deleted.
7. Validate without applying: `python -m event_ownership --plan /review/plan.json --output /review/validated.json`
8. Apply only when approved by the operator:

   `python -m alembic -c alembic.ini -x ownership_plan=/review/plan.json upgrade head`

   Alternatively supply `EVENT_OWNERSHIP_PLAN=/review/plan.json` to the process.
   The filename is read by the migration, not embedded in the image. Mount the
   plan and report directory explicitly into the one-shot container.
9. Verify: `python -m event_ownership --compare /review/before.json --plan /review/plan.json --output /review/after.json`
10. Independently confirm all seven planning events, inventory/demand IDs, capacity,
    dates, flags, hotel contacts and room demand parameters match the baseline.
11. Set `OPERATIONAL_EVENT_ID` to the **same confirmed ID** in the backend runtime
    environment and recreate it. This is explicit compatibility configuration,
    not a global session-selected active event. Do not set arbitrary default IDs.
12. Smoke-test hotel inventory reads/creation, planning events and timeline,
    accommodation demand calculations and an isolated import before reopening.

The plan fingerprint ignores only the newly introduced ownership columns, so the
same reviewed plan can validate the post-migration report. A data change during
review causes migration rejection; regenerate/review the baseline rather than
editing the fingerprint blindly. A schema-current Alembic rerun is a no-op.

## Atomicity, interruption and rollback

The migration supports PostgreSQL online mode only. It uses transactional DDL and
ordinary indexes (no CONCURRENTLY/autocommit). Missing/invalid plan, unknown rows,
conflicting source evidence, broken FKs or mixed-event occupants abort the entire
transaction. A final digest comparison verifies every reported old field after
backfill. Offline SQL cannot safely perform these data-dependent checks and is
intentionally refused for this revision.

No destructive downgrade is provided: once events have independent sessions,
restoring global nation uniqueness is unsafe. Recover using the verified backup
under a maintenance window, or prepare a separately reviewed corrective migration.

## Compatibility and retained limitations

The database has no default event. Direct model/SQL person and booking creation
without ownership is rejected. Existing API factories receive ownership only from
explicit `OPERATIONAL_EVENT_ID`; explicit second-event ORM/API creation is blocked
in request context. ORM occupants must match booking ownership. Direct SQL can
still violate the cross-table event invariant; full mutation isolation and any
additional DB-level cross-table enforcement are follow-up work.

Existing serializers retain their response shapes; EventRoomDemand.eventId still
means the planning-event ID and is unchanged. Owner fields are model/DB metadata
in PR1, not a newly enabled event-selection API.
No quota, pricing, NO_ROOM, EXTERNAL, countsAsSingle, date or demand formula changes.

Backup images must include the ownership migration helpers. Restoring a dump
already at this revision needs no backfill plan. Restoring an older dump requires
its own reviewed report/plan available via EVENT_OWNERSHIP_PLAN in the backup
service; otherwise the staging migration fails safely and is not activated.
Do not reuse a plan with a different dump fingerprint.

## Tests

Dedicated migration tests create disposable databases exclusively through the
existing loopback PostgreSQL test guard. No deployment database is used. Legacy
regression fixtures explicitly prepare a test championship for old factories;
ownership tests opt out, exercising real NOT NULL/FK and event guards directly.
Full multi-event query isolation, identity scoping, session cancellation safety,
shared room inventory coordination and frontend event selection remain follow-ups.

## Validation record for this implementation

- Dedicated PostgreSQL/ORM/CLI ownership suite: 14 passed. Includes pre/post DDL
  rollback, explicit legacy approval/booking preservation, strict owner constraints,
  separate JPN sessions and same FIS code in two events, all seven planning events,
  timeline values and existing inventory/planning write API compatibility.
- Complete backend suite after fixture adaptation: 642 passed, 9 failed;
  1194 subtests passed. A clean pre-change backend copy against a fresh isolated
  PostgreSQL test schema had 629 passed and the **same nine failures**. One further
  targeted planning/API acceptance test was added and passed subsequently.
- Existing failures: accommodation requirement reimport transition;
  API person detail characterization; reviewed route manifest;
  three obsolete assignment countsAsSingle expectations;
  preview extraction test lacking Flask application context;
  import operational impacts expecting import-entitlement-based quota usage;
  WSC missing-mapping validation expectation.
- Frontend: 138 passed. Backup service: 17 passed, including packaged runtime imports.
- No production database was connected to, inventoried, migrated or cleaned.
  The actual production event ID and actual preflight fingerprint still require
  operator review; no value has been guessed or embedded in the migration.
