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
  production container continues to build and run on its existing Node image.
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

After installing `backend/requirements.txt`, run the existing backend convention:

```bash
cd backend && python -m unittest discover -s tests
```

The suite contains fast SQLite-backed tests as well as tests that may skip unless
an isolated PostgreSQL test database is configured. Never point tests at
production data.

## Backup service

After installing `backup/requirements.txt`:

```bash
cd backup && python -m unittest discover -s tests
```
