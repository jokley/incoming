# Architektur und Verantwortlichkeiten

Dieses Dokument beschreibt die technischen Grenzen der Anwendung. Es dient als
Orientierung für Refactorings; fachliches Verhalten und API-Verträge bleiben
dabei unverändert.

## Frontend

Der Einstiegspunkt `frontend/src/main.tsx` initialisiert die React-Anwendung. Unter
`frontend/src/app` sind die Verantwortlichkeiten wie folgt getrennt:

- `components/` enthält Seiten und fachliche UI-Komponenten. Wiederverwendbare
  Basisbausteine liegen in `components/ui/`, übergreifende Enterprise-Komponenten
  im `design-system/`.
- `services/` kapselt Kommunikation, fachlich wiederverwendbare Berechnungen und
  technische Browser-Integrationen. Komponenten sollen keine eigenen API-URLs
  oder `fetch`-Aufrufe einführen.
- `data/` enthält ausschließlich lokale beziehungsweise Mock-Daten und deren
  Datenmodelle.
- `types.ts` ist die gemeinsame Quelle für die vom Frontend verwendeten
  Domänentypen.
- `auth/` kapselt Authentifizierungszustand und Berechtigungsprüfung.

Theme-Werte werden im `design-system/theme/` definiert. Globale CSS-Einstiege
liegen in `frontend/src/styles`; neue Komponenten sollen vorhandene Tokens nutzen, statt
Farben oder Abstände parallel zu definieren.

## Backend

Das Flask-Backend liegt in `backend/`. Der Composition Root `app.py` verbindet
HTTP-Endpunkte und deren Transaktionsgrenzen. `config.py` ist die einzige Stelle,
die Laufzeitumgebung interpretiert; `logging_config.py` definiert die gemeinsame
Observability-Policy. `models.py` definiert Persistenz und Beziehungen. Import-,
Quoten- und Authentifizierungslogik ist in fachlich benannten Modulen gekapselt.
Die detaillierte Modulmatrix und Betriebsanleitung steht in
[`DEVELOPMENT.md`](DEVELOPMENT.md).

### Architekturentscheidungen für Release 1

- **ADR-001 – Expliziter Composition Root:** Initialisierung bleibt sichtbar in
  `app.py`. Konfiguration und Logging haben keine Abhängigkeit zu Routes oder
  Modellen. Damit bleibt die Startreihenfolge überprüfbar.
- **ADR-002 – Routes als Transaktionsgrenze:** Bestehende Commit-/Rollback-
  Semantik wird für Release 1 bewahrt. Fachservices berechnen Ergebnisse, aber
  erzeugen keine HTTP-Responses.
- **ADR-003 – Keine Big-Bang-Aufteilung:** Der historisch gewachsene Route-Layer
  wird nicht lediglich auf Dateien verteilt. Künftige Blueprints werden nur mit
  klarer Service-/Repository-Grenze und Vertragstests extrahiert.
- **ADR-004 – Explizite Migrationen:** Schemaänderungen werden als idempotente
  Migrationsskripte ausgeführt. Model-Importe verändern kein Schema.
- **ADR-005 – Produktionsserver im Container:** Gunicorn übernimmt Worker- und
  Access-Logging; der Flask-Server bleibt ein lokales Entwicklungswerkzeug ohne
  erzwungenen Debug-Modus.

## Abhängigkeitsregeln

1. UI-Komponenten greifen über `services/api.ts` auf das Backend zu.
2. Gemeinsame Berechnungen werden in einem fachlich benannten Service gehalten,
   nicht in mehreren Seiten dupliziert.
3. Browser-Ressourcen wie Object-URLs werden von kleinen technischen Utilities
   angelegt und wieder freigegeben.
4. Frontend-Typen importieren keine Backend-Implementierungsdetails; der
   JSON-Vertrag bildet die Grenze.
5. Änderungen an einem API-Vertrag erfordern synchron angepasste Typen,
   Endpunkte und Dokumentation.

## Qualitätsprüfungen

- `pnpm --dir frontend run build` prüft und bündelt das Frontend für die Produktion.
- `python -m pytest backend/tests` führt die Backend-Regressionstests aus.
- Für neue fachliche Fehlerkorrekturen ist ein Regressionstest im zuständigen
  Bereich erforderlich. Reine Strukturänderungen müssen mindestens beide
  vorhandenen Prüfschritte unverändert bestehen.

## Repository layout and ownership

```text
frontend/                 React source, colocated tests, Node package/lockfile,
                          TypeScript, ESLint, Vite, PostCSS and Dockerfile
backend/                  Flask application, models, routes and domain logic
  migrations/             Alembic revisions (backend/alembic.ini)
  tests/                  Backend tests and API route manifest
  etl/                    Backend-owned data migration tooling
backup/                   Separate backup runtime and Python dependencies
  tests/                  Backup service tests
scripts/                  Cross-system local startup and Python test runners
docs/                     Shared architecture, development and operations docs
nginx/                    Deployment reverse-proxy configuration
docker-compose.yml        Application orchestration
compose.test.yaml         Disposable PostgreSQL test infrastructure
.env*.example             Shared local/test environment templates
incoming.env.example      Deployment configuration template
.vscode/                  Repository editor tasks and launch configuration
```

Frontend commands run inside `frontend/` (`pnpm install`, `pnpm dev`,
`pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm lint`), or from root with
`pnpm --dir frontend`. This is one standalone Node package, without a workspace.
Build output is `frontend/dist/`. Python runners remain root commands:
`python scripts/test_backend.py fast|migrate|postgres|backup`.

Vite loads shared root environment files through explicit `envDir`; its default
`VITE_` exposure prefix is unchanged. Frontend Docker builds copy only frontend
files and never root environment files. Container frontend settings are supplied
explicitly through Compose's `VITE_API_URL` environment setting.

The optional root `public/` Compose bind mount is retained for compatibility with
external/local deployment assets, mounted at `/app/public`. It is absent
from this checkout and has no tracked content; no frontend/public directory is
introduced. Local Vite also uses root public/ through explicit publicDir, preserving the
same asset location in both workflows.

Backend migrations, tests, imports and quota logic remain backend-owned. Backup
is a separate service with its own dependencies/tests. Production Python code
must not move into scripts. Root owns shared orchestration and configuration;
frontend owns its application tooling. Existing ignore rules for node_modules,
dist and .env files also apply beneath frontend/. Historical verification
records describe their original layouts.
