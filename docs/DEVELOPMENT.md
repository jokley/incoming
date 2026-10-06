# Development quality checks

Run these commands from the repository root after `pnpm install`.

## Frontend

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

- `typecheck` validates the Vite/React TypeScript project without emitting files.
  The initial compatibility baseline leaves `strict` disabled because the mature
  application has not previously been checked independently of Vite. Stricter
  checks, including `noImplicitAny`, should be introduced in later scoped changes;
  dependency declarations are still checked because `skipLibCheck` is not used.
- `lint` applies practical TypeScript, React, and Hooks correctness rules. It does
  not impose a formatter or broad stylistic rules.
- `test` runs the existing TypeScript tests with Node's built-in test runner.
  Node 22.6 or newer is required for native TypeScript type stripping; the
  script explicitly enables stripping and uses double quotes around the glob
  so tests are discovered on Windows as well as POSIX shells.
  The production container continues to build and run on its existing Node image.
- `build` remains the production Vite build and is intentionally separate from
  type checking.

A failure is a finding to investigate, not permission to weaken a rule globally
or mass-edit unrelated application code. Add a narrow exception only when its
reason and scope are documented.

## Backend

Syntax validation does not require application dependencies:

```bash
python -m compileall -q backend backup
```

Install the application and test dependencies in a virtual environment. Commands
below use `python` from that environment (Windows: `backend/venv/Scripts/python.exe`).

```bash
python -m pip install -r backend/requirements-test.txt -r backup/requirements.txt
```

```bash
python scripts/test_backend.py fast
python scripts/test_backend.py unittest
python scripts/test_backend.py backup
```

The runner creates ignored `.env.test` from committed `.env.test.example` when
absent. It accepts only the dedicated loopback PostgreSQL URL on port 55432,
database/user/password `incoming_test`, and `FLASK_ENV=test`. The application
maps `FLASK_ENV` to Flask's `RUNTIME_ENV`; setting an environment variable named
`RUNTIME_ENV` alone is insufficient. Development authentication uses `test-admin`
and `incoming-admin`, with an empty proxy secret so no proxy header is required.
The runner derives `DATABASE_URL`, local backup paths/service URL, and strips
inherited database, libpq, authentication and backup overrides. Never use a
production URL, credentials, or copy the server environment into this file.

`fast` uses pytest for both unittest classes and pytest functions, including
SQLite ORM/ETL tests, mocks and the offline Alembic check. `unittest` retains the
old discovery baseline but omits pytest functions and skips PostgreSQL tests.
Offline Alembic SQL generation and application are covered by the baseline; see
[PR 3D verification](PR3D_VERIFICATION.md) for the compatibility corrections and
online/offline parity checks. No failing assertion is suppressed.

### Dedicated PostgreSQL 17

Run only the separate test Compose file:

```bash
docker compose -f compose.test.yaml up -d --wait postgres-test
python scripts/test_backend.py migrate
python scripts/test_backend.py postgres
docker compose -f compose.test.yaml down --volumes
```

The last command removes only the test project's volume. Repeat startup and
validation to recreate it. Production Compose and its volumes are unchanged.
The service publishes only `127.0.0.1:55432`.

`migrate` drops/recreates the dedicated database's public schema, runs the
full Alembic chain to the repository head, checks seeded catalogue
rows and a PostgreSQL check constraint, then repeats from an empty schema.
**All test data is disposable.** `postgres` first performs this migration check,
then runs the six PostgreSQL integration modules in a separate process.
It also executes generated offline SQL and compares catalogue IDs, mappings and
memberships with online results, using both empty and seeded legacy schemas.
Missing PostgreSQL or an unsafe target fails the command rather than silently
skipping integration validation. Destructive ORM setup also checks the actual
Flask engine URL and runtime environment.

SQLite remains appropriate for fast mapping, quota and ETL fixture tests.
PostgreSQL owns migration, constraint and integration validation for assignment
projection, import event selection/impacts/versioning, identity and single-room
status. These tests do not establish concurrency/locking coverage.

Without Docker on Windows, use the portable PostgreSQL 17 workflow recorded in
[PR 3B verification](PR3B_VERIFICATION.md); it uses the same target and runner.

## Backup service

### Local application without Docker (Windows PowerShell)

Run from the repository root. Install dependencies once:

```powershell
backend\venv\Scripts\python.exe -m pip install -r backend/requirements.txt -r backup/requirements.txt
```

`scripts/dev_local.py` creates ignored `.env.local` from `.env.local.example`
if absent. Both service commands load it independently. Never use `incoming.env`
or production credentials here. Required local values are supplied by the launcher:

| Setting | Local value |
| --- | --- |
| `DATABASE_URL` | `postgresql://incoming_test:incoming_test@127.0.0.1:55432/incoming_test` |
| `POSTGRES_HOST` / `POSTGRES_PORT` | `127.0.0.1` / `55432` |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `incoming_test` |
| `BACKUP_SERVICE_URL` | `http://127.0.0.1:58080` |
| `BACKUP_DIR` | absolute repository path to `.local-dev/backups` |
| upload staging | `.local-dev/backups/.imports` (derived by the existing service) |
| `BACKUP_ENABLED` | `false` (scheduler only; manual backup/restore still works) |
| `FLASK_ENV` | `development` |
| `AUTH_DEV_USER` / `AUTH_DEV_GROUPS` | `test-admin` / `incoming-admin` |
| `AUTH_PROXY_SECRET` | empty; internal backup API has no separate secret |
| `VITE_API_URL` | `/api` (existing Vite proxy) |

Only `DATABASE_URL`, optional `POSTGRES_BIN`, and `VITE_API_URL` belong in
`.env.local`. The database URL must match the PR3B local allowlist; other targets
and URL routing options are rejected. Inherited database/libpq, authentication,
backup and proxy overrides are removed. Startup verifies PostgreSQL 17, database
and role identity, and permission to create staging databases. Both Python
listeners bind to `127.0.0.1`; the unauthenticated backup API is not exposed to
the LAN. `POSTGRES_BIN` can specify an absolute PostgreSQL 17 `bin` directory
(no quotes); otherwise the launcher uses the PR3B TEMP installation or PATH.

1. Start the existing PR3B PostgreSQL cluster (do **not** initialize it again):

   ```powershell
   $pgBin = "$env:TEMP\incoming-pr3b-postgresql17\pgsql\bin"
   & "$pgBin\pg_ctl.exe" -D "$PWD\.local-test\pgdata" -l "$PWD\.local-test\postgres.log" -o '-h 127.0.0.1 -p 55432' -w start
   ```

   For first-time cluster creation, follow [PR3B](PR3B_VERIFICATION.md).
   Do not start another server if one is already listening on port 55432.

2. Start the backup service in its own terminal:

   ```powershell
   backend\venv\Scripts\python.exe scripts/dev_local.py backup
   ```

3. Stop any previously started backend, then start it with the same local setup:

   ```powershell
   backend\venv\Scripts\python.exe scripts/dev_local.py backend
   ```

4. Start (or restart, to load `.env.local`) the frontend:

   ```powershell
   pnpm dev --host 127.0.0.1
   ```

Check configuration/database without starting a listener with
`backend\venv\Scripts\python.exe scripts/dev_local.py check`.
Check service health at `http://127.0.0.1:58080/health`, database status at
`http://127.0.0.1:5000/api/admin/database/status`, and the backup list at
`http://127.0.0.1:5000/api/admin/database/backups`. Status/list alone do not probe
the backup service: metadata is read from the shared directory.

Use the existing Operations database UI to upload the `.dump.gz` and confirm
restore. The existing `/api/admin/database/import` and `/restore` endpoints
delegate to the local service. A successful upload creates an import token; it
is not yet a categorized server backup. Restore creates a pre-restore backup,
restores into an `incoming_test_restore_*` staging database, migrates/verifies it,
and activates it as `incoming_test`. No database target is accepted from the UI.
The first status request afterward can return 503 while stale database
connections are discarded; the existing UI retries automatically.
Despite the `.dump.gz` suffix, the existing format is PostgreSQL custom format
(`PGDMP`), not an additional gzip wrapper. Invalid archives are rejected.

**The PR3B `migrate` and `postgres` test commands destroy data in `incoming_test`.**
Do not run them after importing reference data you want to retain. Keep the
original archive outside the managed backup categories, which retain only two
backups each. Local uploads/backups are ignored by Git. Stop each Python service
with Ctrl+C; stop PostgreSQL with the PR3B `pg_ctl -m fast -w stop` command.

Verified on Windows with PostgreSQL 17 on 2026-10-05: service health, database
status, manual backup/list/download, invalid upload rejection, multipart
`.dump.gz` import, and full restore through Vite's `/api` proxy and the existing
backend/service endpoints. A generated local snapshot was restored to the same
local database: its database OID changed, all 21 table row counts were preserved,
the safety backup appeared in the list, and status recovered with the UI's retry
behavior. No production archive was supplied or tested. Backup/safety tests:
15 passed. Fast backend suite: 65 passed plus 14 safety subtests (two existing
SQLAlchemy legacy warnings). `git diff --check` passed. Production Compose,
Dockerfile and environment template were unchanged.

After installing `backup/requirements.txt`:

```bash
cd backup && python -m unittest discover -s tests
```
