# PostgreSQL-Backups – Betriebshandbuch

Der Service `backup` ist eine eigenständige Operations-Komponente. Er kennt
keine Anwendungs- oder Geschäftslogik. Das Flask-Backend liest das Backup-Volume
nur und sendet für manuelle Sicherungen einen HTTP-Steuerimpuls in das interne
Compose-Netzwerk. Es führt weder `pg_dump` noch einen Scheduler aus.

## Konfiguration und Betrieb

Alle Werte stehen in `incoming.env`. `BACKUP_ENABLED` aktiviert den UTC-Zeitplan,
`BACKUP_SCHEDULE` ist ein fünfstelliges Cron-Schema (Standard `0 3 * * *`) und
`BACKUP_DIR` ist im Container `/backups`. Der Service verwendet unverändert `POSTGRES_DB`,
`POSTGRES_USER` und `POSTGRES_PASSWORD`; Zugangsdaten werden nicht dupliziert.

```bash
cp incoming.env.example incoming.env
docker compose up -d --build postgres backup backend frontend
docker compose ps
docker compose logs -f backup
```

Logs sind zeilenweise JSON. Automatische, manuelle und vor einer Wiederherstellung
erstellte Dumps liegen getrennt in `automatic/`, `manual/` und `pre-restore/`.
Jede Kategorie behält ausschließlich ihre zwei neuesten Dateien. Dumps heißen
`<database>-YYYY-MM-DD_HHMMSS.dump.gz`; `last-backup.json` enthält Erfolg oder
Fehler des letzten Versuchs. Dump und Statusdatei werden atomar ersetzt. Das
benannte Volume `postgres-backups` überlebt Container-Neustarts.

Ein bewusst gestartetes Sofort-Backup läuft über dieselbe Implementierung:

```bash
docker compose run --rm backup now
```

Die Admin-API bietet Status, Liste und Download unter
`/api/admin/database/...`. `POST /api/admin/database/backup` delegiert an den
internen Backup-Service und antwortet mit HTTP 202; es wird kein Dump im
Backend erzeugt.

## Wiederherstellung (niemals automatisch)

Die Administration delegiert Import und Wiederherstellung über
`POST /api/admin/database/import` und `POST /api/admin/database/restore` an
denselben internen Backup-Service. Der Service validiert PostgreSQL-Custom-Dumps,
erstellt zwingend ein Sicherheitsbackup und stellt den Dump zunächst in einer
neuen, isolierten Datenbank wieder her. `pg_restore --single-transaction` und
alle ausstehenden Alembic-Migrationen müssen dort erfolgreich sein. Erst danach
wird die geprüfte Datenbank durch Umbenennen aktiviert. Bis zu diesem kurzen
Umschaltpunkt bleibt die produktive Datenbank unverändert. Schlägt das
Umschalten oder die anschließende Integritätsprüfung fehl, erhält die bisherige
Datenbank ihren ursprünglichen Namen zurück. Temporäre Imports werden
ausschließlich nach einem vollständig erfolgreichen Ablauf gelöscht.

Der konfigurierte `POSTGRES_USER` muss Eigentümer der Produktivdatenbank sein
und Datenbanken erstellen, umbenennen und löschen dürfen (`CREATEDB`; beim
offiziellen PostgreSQL-Container ist der initiale Benutzer entsprechend
berechtigt). Das Wiederherstellen direkt in das aktive Schema mit `--clean` ist
ausdrücklich nicht unterstützt: neuere Fremdschlüssel können sonst das Löschen
älterer, im Dump enthaltener Constraints verhindern.

Der folgende CLI-Ablauf bleibt für betriebliche Notfälle verfügbar:

1. Wartungsfenster ankündigen, schreibenden Zugriff stoppen und den gewünschten
   Dump anhand der Statusdatei sowie Größe auswählen.
2. Vor dem Restore ein zusätzliches Backup erstellen und dessen Erfolg prüfen.
3. Eine leere, separate Prüf-Datenbank anlegen. Niemals `--clean` gegen die
   aktive Produktivdatenbank ausführen. Danach den Custom-Dump transaktional
   einspielen:

```bash
docker compose stop backend
docker compose run --rm --entrypoint sh backup -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
   --host=postgres --username="$POSTGRES_USER" --dbname=incoming_restore_check \
   --single-transaction --no-owner --no-privileges --exit-on-error \
   /backups/automatic/incoming-2026-08-16_030000.dump.gz'
docker compose start backend
```

4. `alembic current`, Anwendungsgesundheit und fachliche Stichproben prüfen.
   Bei einer Prüf-Datenbank `--dbname` entsprechend ändern.

Restore bleibt absichtlich ohne Scheduler oder Startautomatik. Für externes
Storage kann später die Volume-/Storage-Schicht ersetzt werden, ohne die
fachliche Anwendung oder das Dump-Format zu ändern.

## Überwachung

Der Container-Healthcheck prüft den internen HTTP-Dienst. Zusätzlich sollten
Monitoring-Regeln Alter und `status` von `last-backup.json`, freien
Volume-Speicher und die erwartete Dump-Anzahl überwachen. Ein gesunder Container
allein beweist nicht, dass das letzte Datenbank-Backup erfolgreich war.
