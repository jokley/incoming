# Development quality checks

Run frontend commands from `frontend/` after `pnpm install`. Python commands
remain repository-root commands. Root `.env*` files remain shared configuration.

## Frontend

```bash
cd frontend
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

The automated runner reads no environment files. It pins the dedicated disposable
loopback PostgreSQL URL on port 55432 (database/user/password `incoming_test`,
`FLASK_ENV=test`), scrubs inherited shared TEST credentials and keeps the existing
target guards. Never point destructive tests at the CodeServer/TEST database.
Ordinary CodeServer LOCAL/DEV instead sources `incoming.test.env`; see
[TEST_COMPOSE.md](TEST_COMPOSE.md).

`fast` uses pytest for both unittest classes and pytest functions, including
SQLite ORM/ETL tests, mocks and the offline Alembic check. `unittest` retains the
old discovery baseline but omits pytest functions and skips PostgreSQL tests.
Offline Alembic SQL generation and application are covered by the baseline; see
[PR 3D verification](PR3D_VERIFICATION.md) for the compatibility corrections and
online/offline parity checks. No failing assertion is suppressed.

### Dedicated PostgreSQL 17

Run only the separate test Compose file:

```bash
docker compose -f backend/tests/fixtures/postgres.compose.yml up -d --wait postgres-test
python scripts/test_backend.py migrate
python scripts/test_backend.py postgres
docker compose -f backend/tests/fixtures/postgres.compose.yml down --volumes
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

### CodeServer LOCAL/DEV

Use the same `incoming.test.env`, TEST PostgreSQL and backup service as the TEST
Docker stack. There is no `.env.local`, separate LOCAL database or LOCAL backup
process. Changes from CodeServer intentionally affect TEST data.

See [TEST_COMPOSE.md](TEST_COMPOSE.md) for shell startup, shared `/backups` volume,
proxy authentication prerequisites and migration from the old file names.
`scripts/dev_local.py` is retained only for historical isolated restore
verification with an explicitly supplied file; it never creates a local env file.
Those isolated restore records are documented in LOCAL_RESTORE_VERIFICATION.md
and do not describe the ordinary CodeServer runtime.

### Frontend ownership

The standalone package and lockfile live in `frontend/`; no pnpm workspace is
needed. Install dependencies there rather than reusing an old root node_modules.
For CodeServer, export the shared `incoming.test.env` before starting Vite; builds write `frontend/dist/`. The frontend
VS Code task runs from frontend/. Existing unanchored ignore rules cover these
nested dependency/build artifacts.

The package pins pnpm 10.30.3 (also used by its Dockerfile), retaining support
for the existing package-level dependency overrides. Optional external static
assets continue to live at root public/ through Vite publicDir and Compose.

### Structural relocation validation (2026-10-09)

Clean frontend installation with pnpm 10.30.3 and --frozen-lockfile passed; the
lockfile was unchanged. Root node_modules was moved aside throughout frontend
validation. Typecheck, all six frontend test files, and Vite build passed.
Backend fast checks passed (75 tests, 951 subtests), backup checks passed (15
tests), dedicated PostgreSQL 17 migration checks passed (2 tests, 6 subtests),
and PostgreSQL integration checks passed (104 tests, 151 subtests). Python
compile checks and git diff --check passed. The API route manifest, backend,
backup, scripts, nginx and relocated frontend source were unchanged in content.
Compose structure was checked using the committed environment example because
incoming.env is intentionally absent. A frontend image build was not performed.
The disposable test PostgreSQL service and volume were removed after validation.
