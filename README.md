# Incoming Software

## Projektübersicht

Incoming unterstützt die operative Planung von Athleten, Kontingenten, Hotels,
Zimmern, Events und FIS-Importen. Die Webanwendung besteht aus einem
React-Frontend, einer Flask-API und PostgreSQL. Datenbankschemata werden
versioniert mit Alembic ausgerollt; Sicherung und Wiederherstellung übernimmt
ein separater Backup-Service.

## Architektur

### Frontend

Das TypeScript-Frontend unter `src/` wird mit React und Vite gebaut. Es greift
über `/api` auf das Backend zu. Wiederverwendbare UI-Bausteine liegen in
`src/app/components/ui`, fachliche Ansichten in `src/app/components` und
API-Zugriffe in `src/app/services`.

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
src/                     React-/TypeScript-Frontend
```

## Entwicklung

### Voraussetzungen

- Docker Engine mit Docker Compose
- alternativ: Python 3.12+, Node.js 20+ und pnpm

### Docker Compose

```bash
cp incoming.env.example incoming.env
# Kennwörter und AUTH_PROXY_SECRET in incoming.env ersetzen
docker compose up --build postgres backup backend frontend
```

Frontend: `http://localhost:5173`, Backend-Healthcheck:
`http://localhost:5000/health`.

### Backend

```bash
cd backend
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql://incoming:secret@localhost:5432/incoming
flask --app app run --debug
```

### Frontend

```bash
pnpm install
pnpm dev
```

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
pnpm build
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
