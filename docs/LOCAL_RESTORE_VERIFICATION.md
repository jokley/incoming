# Lokaler Restore mit Event-Ownership, 23. Oktober 2026

Der vorhandene Dump wurde ausschließlich auf PostgreSQL 17.11 unter
`127.0.0.1:55432` mit der lokalen Rolle `incoming_test` verarbeitet. Es wurde keine
produktive Datenbank angesprochen. Die bestehende Entwicklungsdatenbank
`incoming_test` wurde weder wiederhergestellt noch migriert oder zurückgesetzt.
Die ursprüngliche `.env.local` bleibt unverändert.

## Ursache und Korrekturen

Der Dump steht auf Alembic `20261016_02`. Die nächste Revision `20261022_01`
verlangt korrekt einen geprüften Ownership-Plan. Der Backup-Service stellt in
eine zufällig benannte Staging-Datenbank wieder her und startet anschließend
`python -m alembic -c backend/alembic.ini upgrade head`. Der Subprozess erbt
`EVENT_OWNERSHIP_PLAN` und erhält ausschließlich die Staging-Datenbank als
`DATABASE_URL`. Der vorhandene Mechanismus funktioniert; es fehlte der Plan
in der lokalen Servicekonfiguration.

`scripts/dev_local.py` erlaubte nur drei Konfigurationsschlüssel und ausschließlich
die bestehende Datenbank `incoming_test`. Der Launcher unterstützt jetzt eine
explizite `--env-file`, zusätzlich lokale Datenbanknamen im festen Format
`incoming_restorecheck_YYYYMMDD_HHMMSS`, `BACKUP_PORT=8080`,
`OPERATIONAL_EVENT_ID` und einen bestehenden absoluten `EVENT_OWNERSHIP_PLAN`.
Host, Port, Rolle, Passwort und das Verbot von URL-Optionen bleiben strikt
geprüft. Der Guard für die bisherigen Datenbanktests wurde nicht erweitert.
Ownership-Einstellungen werden ausschließlich aus der gewählten Datei übernommen,
nicht ungeprüft aus geerbten Umgebungsvariablen. Die explizite Laufzeit-Event-ID
wird gegen den vorhandenen WM-Datensatz geprüft. Isolierte Datenbanken erhalten
jeweils ein eigenes Backupverzeichnis.

Der erste erfolgreiche HTTP-Restore zeigte außerdem einen Fehler beim folgenden
Timeline-Aufruf: Eine gepoolte Backend-Verbindung war durch den Datenbanktausch
beendet worden. `backend/config.py` aktiviert deshalb SQLAlchemy `pool_pre_ping`.
Der wiederholte echte Restore bestätigte die automatische Wiederverbindung ohne
Backend-Neustart nach dem Restore. Bereits laufende Transaktionen werden dadurch
nicht transparent wiederholt; während eines Restores keine anderen Schreibaktionen
ausführen.

Es wurden weder Ownership-Prüfungen noch Eventzuordnungen im Migrationscode
verändert. Der Backup-Service benötigt keinen neuen Zuordnungsautomatismus.

## Geprüfter Bestand und Plan

Quelle: `C:\Users\reinh\Downloads\incoming-2026-10-23_030000.dump.gz`

SHA-256: `77feb4bb90ce36f0c8b670f3c279fe18d1250cb0962704eb0a69be7eab56efc9`

Obwohl die Datei `.dump.gz` heißt, ist sie ein PostgreSQL-Custom-Archiv (`PGDMP`)
und wird direkt durch `pg_restore` verarbeitet.

Es existiert genau ein Championship-Event: **ID 1, WSC Montafon 2027, Jahr 2027**.
Beide gespeicherten aktuellen Importvorschauen nennen ausdrücklich `eventId="1"`.
Alle 58 Personen stimmen anhand von Competitor-ID, Accreditation-ID, Vorname,
Nachname und Nation mit diesen Vorschauen überein. Keine Person blieb unbekannt
oder widersprüchlich zugeordnet. Alle vier Buchungen sind durch insgesamt sieben
Occupants mit diesen Personen verbunden. Beide Sessions wurden explizit zugeordnet.
Der historische ImportRun 206 hat keinen eigenen eindeutigen Eventnachweis und
bleibt wie von PR 1 vorgesehen NULL; er wurde weder gelöscht noch geraten zugeordnet.

Der read-only Preflight meldete keine fehlenden Tabellen oder verwaisten
Fremdschlüssel. Der Plan wurde vor der Migration separat validiert.

Bestandsfingerprint vor und nach Migration sowie nach dem HTTP-Restore:
`eb2e90f6ae7525239a6ae75c6ccb34a41d8427859b406d5048ad1ec296f45bae`

| Bestand | Vorher | Nach Migration und HTTP-Restore |
| --- | ---: | ---: |
| Hotels | 45 | 45 |
| Zimmertypen | 10 | 10 |
| HotelRoomInventory | 109 | 109 |
| AccommodationEvents | 7 | 7 |
| EventRoomDemand | 14 | 14 |
| Personen | 58 | 58 |
| Buchungen / Occupants | 4 / 7 | 4 / 7 |
| Importsessions / Versionen | 2 / 2 | 2 / 2 |
| ImportApproval / ImportRun | 1 / 1 | 1 / 1 |

Der Vergleich über alle 20 vom Ownership-Workflow erfassten Tabellen prüft alle
bisherigen Felder, nicht nur Anzahlen. Auch IDs, Kontaktdaten, Kapazitäten,
Zeiträume, Flags und Bedarfsparameter bleiben identisch. Nur die neu eingeführten
Ownership-Felder sind vom Bestandsfingerprint ausgenommen.

## End-to-End-Ergebnisse

Aktive lokale Datenbank: `incoming_restorecheck_20261023_070957`.
Schema: `20261022_01`. Backend: Port 5000. Frontend: Port 5173.
Backup-Service: Port 8080. `OPERATIONAL_EVENT_ID=1`.

Frontend-HTTP und beide Healthchecks liefern 200. Über den Vite-Proxy wurden
Hotels, Events, Timeline, Bedarfsberechnung und Datenbankstatus erfolgreich
abgerufen. Upload über `/api/admin/database/import` liefert 201. Restore über
`/api/admin/database/restore` liefert 200 einschließlich Sicherheitsbackup,
Staging-Restore, Ownership-Migration und Aktivierung. Timeline und
Bedarfsberechnung sind vor und direkt nach dem Restore identisch.
Ein zusätzlicher unabhängiger Vergleich berechnet Timeline und EZ-/DZ-Bedarf aus
dem ursprünglichen Dump-Bericht: EZ verfügbar/Bedarf 129/553, DZ 701/561.
Die aktuellen API-Werte stimmen damit überein. Diese Gesamtwerte sind keine
Prüfung einer bestimmten einzelnen Übernachtung.

Diese Prüfung verwendet die echten HTTP-Endpunkte der Oberfläche. Ein visueller
Browser-/Klicktest wurde nicht durchgeführt. Um keine vorhandene Backupdatei zu
löschen, wurde das hochgeladene temporäre Archiv behalten und derselbe Dump als
separat kopiertes Serverbackup ausgewählt. Der erfolgreiche Token-Restore würde
standardmäßig seine temporäre Upload-Datei entfernen. Der Originaldump und alle
bisherigen Backups bleiben erhalten. Auch beide neu erzeugten Sicherheitsbackups
bleiben erhalten. Die normale Aufbewahrungsregel des Services beträgt zwei Dumps
je Kategorie; weitere Restore-Experimente in einem neuen isolierten Verzeichnis
ausführen, wenn sämtliche Versuchsbackups erhalten bleiben sollen.
Die abschließende read-only Prüfung bestätigt außerdem den unveränderten
Bestandsfingerprint und die unveränderten bereits vorhandenen Schemahinweise von
`incoming_test` sowie identische SHA-256-Prüfsummen aller fünf ursprünglichen
Dump-Dateien einschließlich des Downloads.

Für den JPN-Test wurde eine weitere Datenbank angelegt:
`incoming_restorecheck_20261023_071641`. Darin erzeugt ein synthetischer XLSX-Import
zwei neue JPN-Personen. Der Reimport erkennt beide unverändert, erzeugt keine
Duplikate und behält IDs 26791/26792. Alle 58 Bestandspersonen, Planungsdaten und
Buchungen bleiben identisch. Die laufende Anwendung zeigt weiterhin die saubere
Restore-Datenbank, nicht die Datenbank mit synthetischen JPN-Personen.

Gezielte Tests: 20 Backup-/Launcher-Tests, drei Konfigurationstests und sechs
Datenbank-Admin-API-Tests erfolgreich. Kein vollständiger destruktiver
Datenbank-Testlauf auf einem erhaltenen Datenbestand.
`pnpm --dir frontend build` ist ebenfalls erfolgreich (3258 Module).

## Vorhandene lokale Umgebung starten

Die Dienste laufen bereits im Hintergrund. Die folgenden Befehle sind für einen
späteren Neustart gedacht. Vor dem Neustart bestehende Backend-/Backup-Prozesse
gezielt beenden; keinen zweiten Listener auf denselben Port starten.

Im Repository-Root in PowerShell PostgreSQL prüfen/starten:

```powershell
Set-Location C:\Users\reinh\repos\incoming
$pgBin = 'C:\Users\reinh\AppData\Local\Temp\incoming-pr3b-postgresql17\pgsql\bin'
& "$pgBin\pg_ctl.exe" -D "$PWD\.local-test\pgdata" status
if ($LASTEXITCODE -eq 3) {
    & "$pgBin\pg_ctl.exe" -D "$PWD\.local-test\pgdata" -l "$PWD\.local-test\postgres.log" -o '-h 127.0.0.1 -p 55432' -w start
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL konnte nicht gestartet werden' }
} elseif ($LASTEXITCODE -ne 0) {
    throw 'PostgreSQL-Status ungeklärt; nicht initialisieren'
}
```

Konfiguration prüfen, dann Backup und Backend jeweils in einem eigenen Terminal
starten; jeweils zuerst in den Repository-Root wechseln:

```powershell
Set-Location C:\Users\reinh\repos\incoming
$localConfig = '.local-dev/restore-review-20261023-070957/runtime.env'
& .\backend\venv\Scripts\python.exe scripts/dev_local.py check --env-file $localConfig

# Terminal 1
& .\backend\venv\Scripts\python.exe scripts/dev_local.py backup --env-file $localConfig

# Terminal 2 (Variable in diesem Terminal ebenfalls setzen)
& .\backend\venv\Scripts\python.exe scripts/dev_local.py backend --env-file .local-dev/restore-review-20261023-070957/runtime.env

# Terminal 3
pnpm --dir frontend dev --host 127.0.0.1 --strictPort
```

Prüfen:

```powershell
Invoke-RestMethod http://127.0.0.1:5000/health
Invoke-RestMethod http://127.0.0.1:8080/health
Invoke-RestMethod http://127.0.0.1:5173/api/admin/database/status
```

Die vorhandene ignorierte `runtime.env` enthält den konkreten lokalen
Datenbanknamen, `BACKUP_PORT=8080`, `OPERATIONAL_EVENT_ID=1` und den absoluten Pfad
zum geprüften Plan. Das eigene Backupverzeichnis ist
`.local-dev/restores/incoming_restorecheck_20261023_070957/backups`.
Ohne `--env-file` gilt weiterhin die ursprüngliche `.env.local` mit `incoming_test`;
deshalb für diese Restore-Umgebung immer die explizite Datei verwenden.

## Neuen Dump reproduzierbar vorbereiten

Für einen anderen Dump niemals diesen Plan oder die Event-ID ungeprüft übernehmen.
Eine neue leere lokale Datenbank unter einem neuen Namen im zugelassenen Format
anlegen; `CREATE DATABASE` soll bei existierendem Namen abbrechen. Kein `initdb`,
kein Reset, kein `--clean`, kein `stamp head`.
Mit lokalen Verbindungsparametern und `pg_restore --no-owner --no-privileges
--exit-on-error --single-transaction` ausschließlich dort wiederherstellen.
Bei älteren Schemata zuerst prüfen, welche Vorgängerrevisionen nötig sind;
kein ungeprüftes `upgrade head` vor dem Ownership-Plan.

Dann den [PR-1-Workflow](event-ownership-pr1.md) ausführen: read-only Bestandsbericht,
eindeutige Event-/Personennachweise, explizite Zeilenzuordnungen und exakten
Fingerprint im Plan. Bei unbekannten Personen oder widersprüchlichen Zuordnungen
vor der Migration stoppen. Den Plan mit `python -m event_ownership --plan ...`
validieren, erst dann Alembic auf dieser Datenbank mit `EVENT_OWNERSHIP_PLAN`
starten und anschließend `--compare` ausführen. Beide Dienste mit derselben
expliziten lokalen Konfiguration starten. Niemals den Test-Runner
`scripts/test_backend.py migrate` für einen erhaltenen Datenbestand verwenden;
dieser führt destruktive Datenbanktests aus.

Die tatsächlichen Berichte und Pläne dieses Laufs liegen ausschließlich lokal in
`.local-dev/restore-review-20261023-070957/`: `summary.json`, `before.json`,
`plan.json`, `ownership-evidence.json`, `validated.json`, `after.json`,
`after-ui-restore-second.json`, `http-check.json`, `jpn-check.json` und Logs.
`final-verification.json` enthält die abschließenden Erhaltungs- und Healthchecks.
Sie enthalten teils personenbezogene Daten und sind durch `.gitignore` ausgeschlossen.
Es wurde kein Commit oder Push erstellt.
