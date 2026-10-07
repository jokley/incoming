# Direct-token confirmation and session approval

## Investigation

- `POST /api/import/fis/preview[/]` creates a UUID hex token in the process-local
  `PREVIEW_STORE`. Tokens expire after one hour and are consumed on success.
  Session/version creation requires `createSession=true` or `sessionId`.
- `POST /api/import/sessions/<id>/approve` rejects blocking preview errors,
  unresolved current decisions, and imported/replaced/archived sessions. It
  records `APPROVED`, `approved_at`, `approved_by`, and approval history.
- `POST /api/import/sessions/<id>/import` requires `APPROVED`, a nonempty
  `approved_at`, and a current version. It supplies approved single-room decision
  IDs to `confirm_fis_import`, then records `IMPORTED`, its timestamp and history.
- Previously `POST /api/import/fis/confirm[/]` called `confirm_fis_import`
  directly. Cache validity and preview/event validation were checked, but
  session approval, current-version linkage, approved decisions, and session
  completion were bypassed.
- All these mutation routes already require `imports.write`; no new role or
  approval authority is introduced.
- `DataImport.tsx` creates session-linked previews, calls `approveImportSession`,
  then `importSession`. The frontend `confirmFisImport` wrapper has no detected
  callers. Static inspection cannot establish external consumer usage.

Existing tests covered token failures, the direct-confirm bypass, rejection of
unapproved session imports, and decision/service behavior. Successful HTTP
imports through both entry points were not previously compared.

## Invariant and implementation

A direct confirmation token must identify the current version of a session
eligible for the existing session import operation. It cannot grant approval.

The direct route first calls `validate_fis_import_token`, the unchanged cache
validation extracted from `confirm_fis_import`. This preserves missing,
invalid/expired, and blocking-preview token errors before workflow lookup.
A valid token without a current session version (including standalone or
superseded tokens) returns 409. A linked token delegates to the existing
`import_approved_session` handler; that handler's approval gate, decision
mapping, completion history, and import-failure handling are reused unchanged.
No internal HTTP request or duplicate audit-hook invocation occurs.

The direct route retains its success keys: `success`, `summary`, and `run`.
The session route retains its additional `session` field. Direct invalid-token
responses remain 400 `INVALID_IMPORT` without altering session state; the normal
route retains its existing error body and `ERROR` transition for failed imports.
The low-level import service remains usable by existing internal callers; the
session approval requirement is enforced at the HTTP confirmation boundary.

Clients using standalone preview/confirmation must now create a session, approve
it, and confirm its current token (or call the normal session import route).
Preview generation itself, approval policy, expiry duration, route registrations,
and unrelated import/session operations are unchanged.

## Regression tests

`test_api_characterization.py` now covers:

- real workbook preview, explicit session approval, and successful direct import;
- the same successful normal import with its original response shape;
- current approved single-room decision IDs passed through both paths;
- rejection of unapproved/terminal states and `APPROVED` without `approved_at`,
  without live-data, import-run, audit, or workflow-history writes;
- rejection of standalone and superseded tokens even when a newer version is approved;
- unchanged missing/unknown/expired/blocked token errors and replay rejection;
- unchanged normal-route expired-token error and session failure transition.

## Verification (2026-10-06)

Using the existing guarded backend test runner:

| Check | Result |
| --- | --- |
| `fast` | 75 passed; 951 subtests passed |
| `unittest` | 54 run, OK; 9 expected PostgreSQL-module skips |
| `postgres`: migrations | 2 passed; 6 subtests passed |
| `postgres`: integration | 54 passed; 49 subtests passed; no skips |
| `backup` | 15 passed |
| Python syntax compilation / `git diff --check` | Passed |

Existing SQLAlchemy legacy API and backup-download resource warnings remain
visible. The route manifest remains 117 paths / 162 explicit method/path pairs.
