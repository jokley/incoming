# Incoming Software

## Projektübersicht

Incoming unterstützt die operative Planung von Athleten, Kontingenten, Hotels,
Zimmern, Events und FIS-Importen. Die Webanwendung besteht aus einem
React-Frontend, einer Flask-API und PostgreSQL. Datenbankschemata werden
versioniert mit Alembic ausgerollt; Sicherung und Wiederherstellung übernimmt
ein separater Backup-Service.

## Architektur

Quota architecture: [docs/quota-architecture.md](docs/quota-architecture.md)

### Frontend

Das TypeScript-Frontend unter `frontend/src/` wird mit React und Vite gebaut. Es greift
über `/api` auf das Backend zu. Wiederverwendbare UI-Bausteine liegen in
`frontend/src/app/components/ui`, fachliche Ansichten in `frontend/src/app/components` und
API-Zugriffe in `frontend/src/app/services`.

### Backend

Die Flask-Anwendung unter `backend/` stellt REST-Endpunkte, Authentisierung,
Import-, Planungs- und Administrationslogik bereit. SQLAlchemy bildet das
Datenmodell ab. `DATABASE_URL` ist die einzige Datenbankkonfiguration und muss
auf PostgreSQL zeigen.

### PostgreSQL und Alembic

PostgreSQL 17 ist der persistente Datenspeicher. Schemaänderungen werden
ausschließlich als Alembic-Revisionen in `backend/migrations/versions`
versioniert und vor dem Start einer neuen Anwendungsversion ausgeführt.

### Backup-Service

Der Dienst unter `backup/` erstellt komprimierte `pg_dump`-Sicherungen, verwaltet
die Aufbewahrung und stellt kontrollierte Import- und Restore-Endpunkte für die
Admin-Datenbankseite bereit. Details stehen im
[Betriebshandbuch](docs/DATABASE_BACKUP_OPERATIONS.md).

### ETL

`backend/etl/` ist ein eigenständiges Werkzeug zur einmaligen Übernahme
historischer Daten. Es gehört nicht zum Anwendungsstart und wird durch das
Compose-Profil `etl` ausschließlich manuell aktiviert. Das archivierte
Migrations-Runbook liegt unter `docs/migration/`.

## Projektstruktur

```text
backend/                 Flask-API, Modelle und Alembic
  etl/                   separat gestartetes Migrationswerkzeug
  migrations/            Schema-Revisionen
  tests/                 Backend-Tests
backup/                  Backup-, Import- und Restore-Service
  tests/                 Service-Tests
docs/                    aktuelle Architektur- und Betriebsdokumentation
  archive/               historische, nicht operative Dokumente
  migration/             Runbooks für einmalige Datenübernahmen
frontend/                React-/TypeScript-Frontend und Node/pnpm-Konfiguration
```

## Entwicklung

### Voraussetzungen

- Docker Engine mit Docker Compose
- alternativ: Python 3.12+, Node.js 20+ und pnpm

### PROD und TEST

PROD verwendet unverändert `incoming.env` und `docker-compose.yml`:

```sh
docker compose --env-file incoming.env -f docker-compose.yml up -d
```

TEST verwendet die gemeinsame Basis plus strukturelles Override:

```sh
docker compose -p incoming-test --env-file incoming.test.env -f docker-compose.yml -f docker-compose.test.yml up -d
```

Vorlage: `incoming.test.env.example`. Echte Env-Dateien nicht einchecken.
LOCAL/DEV im CodeServer verwendet dieselbe `incoming.test.env`, TEST-Datenbank
und denselben Backup-Service. Änderungen aus LOCAL/DEV verändern TEST-Daten.
Kein `.env.local`, keine separate lokale Runtime-DB und kein lokaler Backup-Service.
Start, Stop, Umstellung, Restore-Volume-/Auth-Voraussetzungen und lokale Prozesse:
[TEST-/LOCAL-Anleitung](docs/TEST_COMPOSE.md).

### Migrationen

```bash
cd backend
alembic upgrade head
alembic current
```

Neue Schemaänderungen benötigen eine geprüfte Alembic-Revision. Das Backend-
Container-Entrypoint führt vor dem Start von Gunicorn automatisch
`alembic upgrade head` aus. Schlägt das Upgrade fehl, startet die Anwendung
bewusst nicht mit einem veralteten oder nur teilweise aktualisierten Schema.

### Tests

```bash
cd backend && python -m unittest discover -s tests
cd backup && python -m unittest discover -s tests
pnpm --dir frontend build
```

Datenbank-Integrationstests benötigen eine isolierte PostgreSQL-Testdatenbank.
Produktionsdaten dürfen niemals als Testziel verwendet werden.

## Backup

Automatische Sicherungen werden mit `BACKUP_SCHEDULE` geplant. Manuelle
Sicherungen können über die Admin-Datenbankseite ausgelöst werden. Das
Backup-Volume ist für das Backend nur lesbar; Datenbankwerkzeuge und
Schreibzugriff liegen ausschließlich beim Backup-Service.

## Restore

1. Wartungsfenster aktivieren und Schreibzugriffe stoppen.
2. Sicherungsdatei in der Admin-Datenbankseite prüfen/importieren.
3. Restore mit der angezeigten Bestätigung starten.
4. Alembic-Stand, Healthcheck und fachliche Stichproben kontrollieren.
5. Anwendung erst danach wieder freigeben.

Der Restore ersetzt den Zielbestand vollständig. Das detaillierte Verfahren und
die Sicherheitsprüfungen beschreibt das
[Backup-Handbuch](docs/DATABASE_BACKUP_OPERATIONS.md).

## Deployment

1. Secrets über die Zielplattform bereitstellen; `incoming.env` nicht committen.
2. PostgreSQL und Backup-Service starten und deren Healthchecks abwarten.
3. Das Backend ausrollen. Sein Entrypoint führt `alembic upgrade head` vor dem
   Anwendungsstart aus; den erfolgreichen Migrationslauf in den Container-Logs
   kontrollieren.
4. Backend und Frontend aus unveränderlichen Images ausrollen.
5. `/health`, Admin-Datenbankstatus und zentrale Benutzerabläufe prüfen.

Reverse-Proxy- und Authentisierungsdetails stehen in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) und
[`docs/AUTHENTICATION.md`](docs/AUTHENTICATION.md).

## Troubleshooting

- **Backend startet nicht:** `DATABASE_URL`, Erreichbarkeit, Zugangsdaten und
  PostgreSQL-Healthcheck prüfen.
- **Schemafehler:** `cd backend && alembic current` und `alembic history`
  vergleichen; niemals Tabellen manuell anpassen.
- **Frontend erreicht die API nicht:** Vite-Proxy beziehungsweise
  `VITE_API_URL`, Reverse Proxy und CORS-Konfiguration prüfen.
- **Backup fehlgeschlagen:** Status und Logs des `backup`-Containers sowie
  freien Platz im Backup-Volume prüfen.
- **Restore abgelehnt:** Dateiname, Format, Prüfsumme, Bestätigungstext und
  laufende Datenbankverbindungen anhand des Betriebshandbuchs prüfen.
