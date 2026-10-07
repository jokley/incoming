# FIS import lifecycle

## Purpose and safety boundary

A FIS import is a reviewed, nation-scoped **full-snapshot replacement**, not a
simple spreadsheet upsert. Parsing and review are non-live stages. The explicit
import action is the destructive persistence boundary.

```text
Upload files + championship event
          |
          v
Parse and validate ---- blocking errors ----> remain in review; cannot import
          |
          v
Create preview + ImportSessionVersion
          |
          +---- durable JSON review/audit projection
          +---- process-local typed PREVIEW_STORE token
          |
          v
Stage administrative overrides
          |
          v
Recalculate every quota-derived preview section
          |
          v
Resolve required approvals / preserve eligible prior approvals
          |
          v
Explicitly approve session
          |
          v
Import/confirm typed preview
          |
          v
Revalidate event mappings, apply people and memberships,
resolve single-room state, reconcile authoritative nation snapshot
          |
          v
Write ImportRun and ImportSessionEvent history; consume preview token
```

## 1. Upload, parsing, and validation

The preview endpoint receives an ENTRIES list, a detailed room list, and a
selected championship event.

- The selected event determines which `WSC_*` import codes are valid.
- ENTRIES parsing creates one person with all competition memberships; it must
  not create one accommodation person per competition.
- Identity prefers stable FIS/competitor identifiers and falls back to normalized
  name/nation. Room-list matching may additionally use name-only fallbacks.
- Room rows are matched to imported people and describe requests, roommates,
  stays, and nightly data. They do not create live `RoomBooking` records.
- Blocking parse or mapping errors remain on the preview and prevent import.

## 2. Preview construction

The preview combines incoming files with current operational state to derive:

- people and competition memberships;
- room requests and person matching warnings;
- quota checks by nation, quota discipline, and normalized gender;
- single-room candidates, exemptions, and eligible preserved approvals;
- disposition impacts and machine-readable change reasons.

Quota warnings compare requested use with retained live disposition. They use the
more restrictive visible usage so a new file cannot hide quota already consumed
by an operational booking.

Preview creation also creates or advances the durable `ImportSession` and
`ImportSessionVersion`. The stored `preview_json` is the review/audit projection.
Confirmation currently consumes the typed preview referenced by a token in the
process-local `PREVIEW_STORE`.

### Operational constraint: preview tokens

`PREVIEW_STORE` is in memory. A token:

- expires;
- does not survive a backend restart;
- is not automatically shared between multiple workers;
- must not be assumed reconstructible from `preview_json` without an explicit
  serialization design change.

Deployments must preserve this constraint until a separately tested durable
preview design is introduced.

## 3. Staged administrative overrides

A reviewer can stage `WORLD_CHAMPION`, `OTHER`, or no exemption for a person on
the current editable import version.

The command is deliberately staged:

1. it updates `singleRoomQuotaExemptOverrides` in durable preview JSON;
2. it updates the typed cached preview when that token is present;
3. it recalculates quota checks, warnings, provisional entitlements,
   disposition analysis, and changes as one coherent derived result;
4. it does **not** immediately update the live `Athlete` row.

Pending single-room approval tasks are derived review state and can be rebuilt.
Completed approvals are immutable audit evidence; an override can supersede
their active use, but it must not erase the historical decision.

## 4. Approvals

Quota excess creates `ImportApproval` tasks tied to the session's current
version. An approval records the affected group, candidates, selected people,
approving party, method, date, and audit metadata.

For an excess single-room decision, exactly the required affected people must be
selected. `APPROVED_EXTRA` belongs to those people and that quota group; it does
not authorize every discipline of a multi-competition person.

A completed decision is never edited in place when its selected people change.
The original row remains as evidence, a new current approval is created, and
`ImportSessionEvent` records both the superseded and revised selections.

### Preserving an existing approval

An approval is preserved only when all continuity conditions still hold:

- the same person is in the incoming snapshot;
- the person still requests a single room;
- the person is not quota-exempt;
- nation and normalized gender still match;
- at least one incoming quota group matches the group actually approved.

A removed person or an intervening confirmed non-single request stores `NONE`
and breaks continuity. Historical approval records must not revive that state
when the person later reappears.

## 5. Explicit approval and import

The session can be marked `APPROVED` only after blocking errors are absent and
all current required decisions are approved.

The direct `/api/import/fis/confirm` endpoint also requires a valid token linked
to the current version of an explicitly approved session. It delegates to the
same session import operation; standalone and superseded preview tokens cannot
bypass approval. See [direct confirmation approval](DIRECT_CONFIRMATION_APPROVAL.md).

For an eligible session, import:

1. resolves the typed preview token;
2. rejects an expired/missing token or blocking preview errors;
3. revalidates that the championship event and mappings are still active;
4. creates an `ImportRun`;
5. creates or updates people and replaces their competition memberships;
6. consumes staged exemptions;
7. assigns `NONE`, `IN_QUOTA`, `PENDING_APPROVAL`, or `APPROVED_EXTRA`;
8. records import-change review state for retained people with live bookings;
9. reconciles the full snapshot;
10. commits history and consumes the preview token.

Physical room type, person approval state, and operational
`RoomBooking.counts_as_single` remain independent throughout this step.

## 6. Snapshot reconciliation and destructive behavior

For every nation represented by the confirmed preview, the incoming people are
authoritative. A database person in one of those nations who is absent from the
preview is removed. Reconciliation also removes or detaches dependent state so
that it does not leave:

- booking occupants or empty bookings;
- legacy room assignments;
- imported FIS room assignments;
- stale roommate name references.

Legacy duplicate identities are collapsed after the authoritative import.

Operational bookings for **retained** people are preserved; changes to their
import-owned room-list fields may instead create a review marker. This is why
“imports do not change disposition” means retained disposition is preserved—it
does not mean that assignments can survive deletion of a person absent from the
full snapshot.

## 7. Audit and ownership

- `ImportSessionVersion` preserves uploaded version metadata and review JSON.
- `ImportApproval` preserves business decisions.
- `ImportSessionEvent` preserves workflow, contact, revision, approval, and
  import history.
- `ImportRun` records the technical application of a confirmed preview.
- Imported FIS fields may be replaced by later snapshots; operator-owned notes
  and retained operational bookings have separate ownership.

See [State ownership](STATE_OWNERSHIP.md) for the field-level boundaries and
[Domain glossary](DOMAIN_GLOSSARY.md) for terminology.
