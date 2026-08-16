# PostgreSQL-Backups – Betriebshandbuch

Der Service `backup` ist eine eigenständige Operations-Komponente. Er kennt
keine Anwendungs- oder Geschäftslogik. Das Flask-Backend liest das Backup-Volume
nur und sendet für manuelle Sicherungen einen HTTP-Steuerimpuls in das interne
Compose-Netzwerk. Es führt weder `pg_dump` noch einen Scheduler aus.

## Konfiguration und Betrieb

Alle Werte stehen in `incoming.env`. `BACKUP_ENABLED` aktiviert den UTC-Zeitplan,
`BACKUP_SCHEDULE` ist ein fünfstelliges Cron-Schema (Standard `0 3 * * *`),
`BACKUP_RETENTION` ist die maximale Anzahl Dumps (Standard 30), und `BACKUP_DIR`
ist im Container `/backups`. Der Service verwendet unverändert `POSTGRES_DB`,
`POSTGRES_USER` und `POSTGRES_PASSWORD`; Zugangsdaten werden nicht dupliziert.

```bash
cp incoming.env.example incoming.env
docker compose up -d --build postgres backup backend frontend
docker compose ps
docker compose logs -f backup
```

Logs sind zeilenweise JSON. Dumps heißen
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

## Manueller Restore (niemals automatisch)

1. Wartungsfenster ankündigen, schreibenden Zugriff stoppen und den gewünschten
   Dump anhand der Statusdatei sowie Größe auswählen.
2. Vor dem Restore ein zusätzliches Backup erstellen und dessen Erfolg prüfen.
3. Ziel-Datenbank bewusst neu anlegen oder eine leere, separate Prüf-Datenbank
   verwenden. Danach den komprimierten Custom-Dump streamen:

```bash
docker compose stop backend
docker compose run --rm --entrypoint sh backup -c \
  'gzip -dc /backups/incoming-2026-08-16_030000.dump.gz | \
   PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
   --host=postgres --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" \
   --clean --if-exists --no-owner --exit-on-error'
docker compose start backend
```

4. `alembic current`, Anwendungsgesundheit und fachliche Stichproben prüfen.
   Bei einer Prüf-Datenbank `--dbname` entsprechend ändern.

Restore bleibt absichtlich ohne API-Endpunkt, Scheduler oder Startautomatik.
Für externes Storage kann später die Volume-/Storage-Schicht ersetzt werden,
ohne die fachliche Anwendung oder das Dump-Format zu ändern.

## Überwachung

Der Container-Healthcheck prüft den internen HTTP-Dienst. Zusätzlich sollten
Monitoring-Regeln Alter und `status` von `last-backup.json`, freien
Volume-Speicher und die erwartete Dump-Anzahl überwachen. Ein gesunder Container
allein beweist nicht, dass das letzte Datenbank-Backup erfolgreich war.
