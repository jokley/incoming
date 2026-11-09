# CodeServer LOCAL/DEV

LOCAL intentionally writes to shared TEST data. PROD and TEST Docker configuration
are unchanged. Use the existing `incoming.test.env`; never source `incoming.env`.
Do not put the LOCAL identity in the shared environment file.

## Start

From the repository root, with backend dependencies in `backend/.venv` and frontend
dependencies already installed:

```sh
backend/.venv/bin/python scripts/dev-start.py backend --check
backend/.venv/bin/python scripts/dev-start.py backend
# In a second terminal:
backend/.venv/bin/python scripts/dev-start.py frontend
```

An activated compatible Python environment also works with `python scripts/dev-start.py`.
Stop existing listeners on 5000/5173 in their owning terminals before switching.
The helper does not stop processes, invoke Docker, migrate, restore or grant access.
Backend reload is enabled without the interactive debugger; Vite retains HMR.
The current manually started backend used `--no-reload`; restart with the helper
to enable backend reload and the separate outgoing control credential.

The helper sources only the trusted repository `incoming.test.env` in a clean
shell environment. This is executable shell configuration; use only your reviewed
file. It rejects database URL query overrides, non-TEST hosts/databases/ports,
inconsistent POSTGRES settings, libpq routing overrides and other backup targets.
It verifies the actual database identity, Alembic revision, read-only `/backups`,
shared restore lease and backup health before starting either process.
This guard protects helper starts; arbitrary manual Flask starts can bypass it.
No automatic schema upgrade or event grant is performed.

At startup only, it sets:

- `AUTH_PROXY_SECRET=`; `AUTH_DEV_USER=local-admin`; `AUTH_DEV_GROUPS=incoming-admin`.
- `BACKUP_CONTROL_SECRET` from the TEST file's `AUTH_PROXY_SECRET`, for **outgoing**
  backup control requests. It is never exposed through VITE variables or logs.
- `FLASK_ENV=development`, dotenv loading disabled, maintenance mode disabled.
- `VITE_BASE_PATH=/absproxy/5173/`, `VITE_API_URL=/absproxy/5173/api`,
  `VITE_API_PROXY_TARGET=http://127.0.0.1:5000`.

Backend configuration defaults the outgoing control credential to the existing
`AUTH_PROXY_SECRET` when no separate value is supplied. Incoming authentication
and the backup service's secret checks are unchanged for TEST/PROD.
The frontend child process receives no database/auth/backup credentials.

## Addresses and filesystem

| Purpose | Target |
| --- | --- |
| Browser | `https://code.jokley.at/absproxy/5173/` |
| Browser API | `/absproxy/5173/api/...` on the same origin |
| Local Flask | `http://127.0.0.1:5000/api/...` |
| PostgreSQL | `incoming-test-postgres:5432 / incoming_test` |
| Backup service | `http://incoming-test-backup:8080` |
| Backup volume | shared TEST POSIX volume at `/backups`, read-only |

Vite removes the five external proxy-auth headers before forwarding to Flask.
The API rewrite preserves methods, bodies and querystrings. The router uses
Vite's base; full application reloads return to that base. API fallback also uses
the base. Standard builds retain `/` and `/api`. Authelia login/logout remains
owned by the platform, not by the application router.

The read-only mount must expose the same lock inodes as the TEST backup service;
HTTP access or a copied directory does not replace POSIX restore coordination.
LOCAL code/schema must stay compatible with TEST's backup worker. Restore changes
the shared database for both LOCAL and TEST, so never use restore as a smoke test.

## Runtime verification (2026-11-06)

Direct Flask and Vite-prefixed requests returned HTTP 200 for `/auth/me`,
`/active-event-context`, `/admin/database/status`, `/admin/database/backups` and
`/admin/database/restore-status`. Identity: local-admin; event 1 read/write,
WSC Montafon 2027. Database: PostgreSQL 17.11, Alembic `20261028_01`.
Backup `/health`: 200; restore status: IDLE; shared read lease available.
A manual TEST backup was created (202), downloaded (200), and uploaded through
Vite as a validated PostgreSQL custom archive (201, 200112 bytes). One backup
and one staged import were intentionally retained; no restore or deletion ran.
Despite the historical `.dump.gz` suffix, these files use PostgreSQL's custom
archive format (`PGDMP`), not an outer gzip stream; upload them unchanged.

The external browser session was unavailable. An unauthenticated request through
CodeServer returned 401, so authenticated end-to-end upload/HMR at the public
hostname still needs a browser check. Local Vite deep-link, asset-base and HMR
WebSocket checks run in the regression test.

## External upload limit

A harmless POST to a nonexistent API route established:

- Direct Flask and Vite: 1 MiB + 1 byte accepted by transport (normal route 404).
- Direct CodeServer: 401 without a browser session, not a body-size rejection.
- Public `code.jokley.at`: Content-Length 1048576 -> 302 login;
  1048577 and 2097152 -> **413, nginx/1.27.5, HTML**.

The central nginx rejects the request before it reaches Incoming. The available
CodeServer vHost has no `client_max_body_size` override. The exact live `nginx -T`
and container logs were not available; the public threshold matches 1 MiB and the
repository vHost. No Incoming/Vite/Flask size increase can fix that outer limit.

Recommended initial limit: **100m** only for the exact DEV import endpoint,
allowing multipart overhead. This is a bounded DEV policy, not the backup
service's much larger existing 10 GiB ceiling. Files approaching 100 MiB need
headroom or a separately reviewed policy. Other hosts and routes should retain
their existing limits. See [the separate infrastructure prompt](LOCAL_DEV_NGINX_PROMPT.md).

## Final checks

257 frontend tests passed, including proxy header filtering, URI/query/method/body
preservation, deep-link HTML, HMR WebSocket and base-aware generation reload.
Typecheck and the standard base=/ build passed; generated asset URLs remain
`/assets/...`. 22 targeted backend tests plus 10 subtests and 23 isolated backup
service tests passed. `git diff --check` passed. The newly loaded helper
configuration also passed real Flask read-only auth/context/DB/restore-status
requests. Existing local processes were not restarted.

A live restore-control probe was rejected by automatic approval review because
calling `/restore-jobs` with a control credential could potentially enqueue a
restore. No such request was sent. Credential forwarding and coordination were
verified with mocks and temporary cross-process lock tests instead. An actual
shared TEST restore remains intentionally untested.

## Backup UI and start output verification (2026-11-09)

Only the LOCAL frontend starter passes `--logLevel warn --clearScreen false` to
Vite. The public Browser URL remains visible, while Vite's misleading loopback
URL banner is suppressed. Listening on 127.0.0.1:5173, base and HMR are unchanged.
Restart the frontend starter to apply these output flags.

A fresh Chromium visit to Administration → Backups correctly rendered PostgreSQL
17.11 and both existing manual backups. Flask and Vite each returned 200 JSON for
status, backups and restore-status: `databaseStatus=available`,
`backupCount=2`, `backupSize=200370`, `alembicVersion=20261028_01`; the list held
two `manual` entries and restore state was `IDLE`.
These metadata routes read PostgreSQL and the shared /backups filesystem; they do
not proxy their reads to the backup service. Upload/import is delegated by Flask
to the TEST service's /import route. The running LOCAL backend has an empty
incoming proxy secret and a separately configured outgoing control secret.
No live restore-control request was sent.

The upload problem was reproduced in Chromium against LOCAL: POST /api/admin/
database/import returned 201 JSON with filename, size, modified, local=true and a
token. The page made no additional metadata requests, and after closing the
dialog the uploaded filename disappeared. The `local` React state was never
rendered. A staged import deliberately is not a new manual/automatic backup.

After the fix, a valid import awaits a refresh of status/list/restore-status and
remains visible in an explicit imported-file card after the dialog closes.
A manual metadata refresh button is also available. Backup responses now reject
HTML, empty bodies and invalid shapes rather than reporting success or treating
them as empty data. The live verification observed 3 initial metadata requests,
6 after import, and a visible imported filename after closing the dialog.
Two staged copies of an existing TEST backup were retained for the before/after
browser verification; no new backup, restore, deletion or migration was run.

Browser regression tests use a separate Vite server/cache and mock every API
request, including auth and event context. They never contact shared TEST data.
Run `pnpm exec playwright install chromium` once, then `pnpm test:browser` from
frontend/ on a machine with Chromium's required system libraries. On this minimal
CodeServer image, the diagnostic browser libraries and font were extracted under
/tmp; no system packages or infrastructure were changed.

Final validation for this update: 258 frontend tests, three browser scenarios
(four Node test results including their parent), 15 targeted backend/starter tests
plus 10 subtests, TypeScript check, root-base production build and git diff --check
passed. A separate Vite CLI smoke test returned HTTP 200 without a Local/Network
URL banner at logLevel=warn. The final browser-only rerun passed in 9 seconds.
The actual public authenticated Authelia session was not used; live browser
verification addressed LOCAL Vite with the same /absproxy/5173/ path.
No further infrastructure change is required for these UI/start-output fixes.

Files changed in this update: scripts/dev-start.py;
backend/tests/test_dev_start.py;
frontend/src/app/components/DatabaseBackups.tsx;
frontend/src/app/services/api.ts;
frontend/src/app/events/databaseMetadata.test.ts;
frontend/tests/databaseBackups.browser.test.ts;
frontend/package.json; frontend/pnpm-lock.yaml; docs/LOCAL_DEV_RUNTIME.md.
Earlier uncommitted work was preserved.
