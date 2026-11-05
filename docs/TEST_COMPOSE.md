# Incoming: PROD und gemeinsames TEST / LOCAL/DEV

## Dateien und unveränderte PROD-Basis

| Zweck | Compose | Environment | Vorlage |
| --- | --- | --- | --- |
| PROD | `docker-compose.yml` | `incoming.env` | `incoming.env.example` |
| TEST | Basis + `docker-compose.test.yml` | `incoming.test.env` | `incoming.test.env.example` |
| CodeServer LOCAL/DEV | direkte Prozesse | **dieselbe** `incoming.test.env` | dieselbe Vorlage |

LOCAL und DEV sind dieselbe Umgebung. Keine `.env.local`, keine separate lokale
Runtime-Datenbank und kein lokaler Backup-Service. **Änderungen aus CodeServer
verändern bewusst die TEST-Daten**, auch wenn der TEST-Webstack gleichzeitig läuft.
PROD-Datei, Container, Daten, Volumes, Auth und Routing werden nicht verändert.
Die echten Environment-Dateien sind gitignored und nicht Bestandteil der Images.

Voraussetzung: Compose >= 2.24.4; statisch geprüft mit 2.40.3. Die Plattform besitzt
`dev-net` und `edge-net` (beide external). Incoming besitzt nur `incoming-test-net`.
Keine Hostports, Docker-Socket-Mounts oder Infra-Änderungen in diesem PR.

## Runtime-Konfiguration

Für eine neue Konfiguration `incoming.test.env.example` nach `incoming.test.env`
kopieren. Für einen bestehenden Stack **die bestehenden TEST-Werte übernehmen**,
insbesondere Passwort, Proxy-Secret, Datenbank und Benutzer. Ein geänderter
`POSTGRES_PASSWORD`-Wert ändert nicht das Passwort im bestehenden Datenvolume.
Keine PROD-Credentials kopieren. Zwei verschiedene URL-sichere Hex-Secrets für
Passwort und Auth nur bei einer neuen Installation erzeugen, nicht ungeplant rotieren.

Die Datei enthält vollständige Runtime-Werte: PostgreSQL-Verbindung, Proxy-Auth,
Superadmin, Betriebsmodus, Logging, Wartungsmodus, optionalen Event-Pin, CORS,
Backup-Verbindung/-Pfad/-Zeitplan und Vite-Proxy. `DATABASE_URL` wird **in dieser
Datei** aus DB/User/Passwort zusammengesetzt, nicht im Compose-YAML umgeschrieben.
Für abweichende Legacy-Passwörter auf URL-Encoding achten; nicht ungeprüft rotieren.
`DATABASE_BACKEND` wird vom aktuellen Code nicht ausgewertet.

`FLASK_ENV=production` erhält den normalen geschützten App-Betrieb auch bei
TEST-Daten. Kein `AUTH_DEV_USER` und keine automatische Admin-Identität.
`AUTH_PROXY_SECRET` muss zum vertrauenswürdigen TEST-Auth-Gateway passen.
`SUPERADMIN_USERNAME` und `OPERATIONAL_EVENT_ID` nur bewusst setzen; ein Event-Pin
vergibt keine Zugriffsrechte. Der Backend-Start migriert wie bisher automatisch;
neue leere Datenbanken benötigen weiterhin den Ownership-Preflight/Plan aus
[event-ownership-pr1.md](event-ownership-pr1.md). Kein Init/Reset/Stamp in diesem PR.

Compose lädt `incoming.test.env` mit **ersetzendem** servicebezogenem `env_file`;
`incoming.env` wird nicht übernommen. `--env-file incoming.test.env` liefert die
Compose-Interpolation und verhindert den impliziten Rückgriff auf eine alte `.env`.
Es bleiben keine Runtime-Werte parallel in YAML gepflegt. Eine versehentlich
exportierte Shellvariable kann die `${...}`-Interpolation beeinflussen: in einem
sauberen Terminal arbeiten und vor dem Start mit `config --quiet` prüfen.
`config` ohne `--quiet` kann Secrets ausgeben; nicht veröffentlichen.

## Dienste, DNS und Speicher

Normale TEST-Service-Keys: `backend`, `frontend`, `incoming-test-postgres`,
`incoming-test-backup`, `incoming-test-nginx`. Das bestehende ETL-Werkzeug bleibt
opt-in (`etl`-Profil), ohne Snapshot-/Host-Mounts. Die geerbten PROD-Service-Keys
`postgres`, `backup`, `incoming-nginx` werden mit `!reset null` entfernt.
Das verhindert ihre automatischen generischen Compose-DNS-Aliase auf dev-net.

PostgreSQL und Backup haben auf **incoming-test-net und dev-net** explizit die
Namen `incoming-test-postgres` und `incoming-test-backup`. Alle Verbraucher nutzen
sie unverändert: Port 5432 bzw. 8080. Keine generischen DB-/Backup-Aliase auf dev-net.
Backend hat beide internen/DEV-Netze, Frontend nur incoming-test-net. Nur
`incoming-test-nginx` hängt zusätzlich an edge-net; kein `incoming-nginx`-Alias.
Nginx-Konfiguration und bestehende Healthchecks werden beibehalten.

Bestehende physische Volumes bleiben **exakt**:

- `incoming-test-postgres-data` für PostgreSQL.
- `incoming-test-postgres-backups` für Backup/Restore, Backend read-only.

Kein Source-Bindmount des Backends, keine PROD-Mounts. Einziger Host-Mount im
Webstack: `./nginx/nginx.conf` read-only. `!override` für Env-Dateien, Abhängigkeiten,
Mounts und Netze und `!reset` für alte Services/Ports bleiben nötig: normale
Compose-Merges würden PROD-Einträge ergänzen, statt sie sicher zu entfernen.
Die zwei qualifizierten Datenservice-Definitionen behalten Image/Build und
Healthchecks der Basis bei; der übrige Webstack bleibt ein Override der Basis.

## Spätere Befehle – hier nicht ausgeführt

PROD bleibt unverändert:

```sh
docker compose --env-file incoming.env -f docker-compose.yml up -d
```

TEST, immer mit explizitem Projekt und beiden Dateien:

```sh
docker compose -p incoming-test --env-file incoming.test.env -f docker-compose.yml -f docker-compose.test.yml config --quiet
docker compose -p incoming-test --env-file incoming.test.env -f docker-compose.yml -f docker-compose.test.yml up -d
docker compose -p incoming-test --env-file incoming.test.env -f docker-compose.yml -f docker-compose.test.yml ps
docker compose -p incoming-test --env-file incoming.test.env -f docker-compose.yml -f docker-compose.test.yml logs --tail=100
docker compose -p incoming-test --env-file incoming.test.env -f docker-compose.yml -f docker-compose.test.yml down
```

Normales `down` behält die Volumes und löscht die externen Netze nicht.
**Kein `down -v`: Das würde die TEST-Daten und Backups löschen.** Spätere Updates:
sauberes `dev` aktualisieren, obigen `up`-Aufruf mit `--build` verwenden, dann
Status, Logs und HTTP/API prüfen. Kein Build oder Deployment wurde hier ausgeführt.

## CodeServer LOCAL/DEV

Den pnpm-Store außerhalb des Workspace ablegen, damit Paketdateien die
CodeServer-Dateiüberwachung und Suche nicht belasten. Vor der Installation
der Frontend-Abhängigkeiten einmal im CodeServer ausführen:

```sh
pnpm config set store-dir /home/coder/.local/share/pnpm/store
```

CodeServer muss bereits an dev-net hängen. **DNS/HTTP allein reicht nicht:** Der
bestehende Restore-Schutz benötigt dasselbe lokale POSIX-Volume
`incoming-test-postgres-backups` auch im CodeServer, read-only unter `/backups`.
Eine Kopie, ein eigenes Verzeichnis oder ein Remote-Filesystem ersetzt die
geteilten Lock-Inodes nicht. Dies ist eine externe Voraussetzung; keine Änderung
am CodeServer-/Infra-Repository hier. Ohne diesen Mount den lokalen Backend-
Betrieb nicht aufnehmen und den Restore-Schutz nicht deaktivieren.

Weiterhin erforderlich: Python-/Frontend-Abhängigkeiten, gleicher Schema-/Code-
Stand wie TEST und die bestehende vertrauenswürdige Proxy-Authentifizierung für
lokale Browserrequests. Vite's Proxy erfindet keine Auth-Header. Fehlende Auth-
Weiterleitung separat einrichten; keine DEV-Identität in der gemeinsamen Datei
setzen, denn sie würde auch im TEST-Stack gelten. Keine Secrets in VITE_* speichern.

In zwei sauberen CodeServer-Terminals jeweils aus dem Repository:

```sh
set -a
. ./incoming.test.env
set +a
# Terminal 1, nach Aktivierung der Python-Umgebung:
cd backend
FLASK_SKIP_DOTENV=1 flask --app app run --host 127.0.0.1 --port 5000 --no-reload
```

```sh
set -a
. ./incoming.test.env
set +a
# Terminal 2:
pnpm --dir frontend dev --host 127.0.0.1
```

Nur die eigene geprüfte Datei sourcen: Shell-Dateien sind ausführbar. Die Vorlage
verwendet gemeinsam kompatible POSIX-/Compose-Syntax; Zeitplan mit Leerzeichen ist
quotiert. Kein zusätzlicher Env-Loader, keine URL-Umschreibung, kein lokaler Backup.
CodeServer-Portfreigabe/Authentifizierung gehört zur vorhandenen Plattform.

## Einmalige Umstellung eines bestehenden Stacks nach PR-Merge

1. Wartungsfenster planen; auch CodeServer-Schreiber stoppen. Vor dem lokalen
   `git pull`, solange die bisherigen Dateien noch vorhanden sind, den bisherigen
   **TEST**-Stack mit dem alten expliziten Projekt-/Dateiaufruf herunterfahren
   (`down`, niemals `-v`). Das gibt auch die Container-Namen für die neuen
   PostgreSQL-/Backup-Service-Keys frei. PROD nicht anfassen.
2. `.env.test` nach `incoming.test.env` umbenennen. Schlüssel umbenennen, **Werte
   beibehalten**: `TEST_POSTGRES_PASSWORD` → `POSTGRES_PASSWORD`,
   `TEST_AUTH_PROXY_SECRET` → `AUTH_PROXY_SECRET`, optional
   `TEST_SUPERADMIN_USERNAME` → `SUPERADMIN_USERNAME`.
3. Fehlende Werte aus der neuen Vorlage ergänzen: DB/User des bestehenden Volumes,
   beide qualifizierten Hosts/Ports/URLs, `/backups`, Scheduler, Logging, Auth-
   und Betriebsmodus. Bestehende bewusste Event-/CORS-Einstellungen übernehmen.
   Alte `.env.local` nach bewusster Übernahme benötigter Werte entfernen: Vite
   würde eine liegengebliebene Standard-Env-Datei weiterhin laden. Keine neue
   `.env.local` erzeugen.
4. `dev` mit `git pull --ff-only origin dev` aktualisieren. Git ersetzt
   `compose.test.yml` durch `docker-compose.test.yml` und entfernt den Symlink
   `compose.yml`. Kein manuelles Kopieren des Compose-Modells.
5. Neue TEST-Konfiguration statisch prüfen; dann erst bewusst mit dem neuen
   Aufruf starten (für den Service-Key-Wechsel mit `up -d --build`). Der Backup-
   Build behält Kontext/Dockerfile; sein impliziter Compose-Image-Tag hängt am
   neuen Service-Key. Die unveränderten Volumenamen verwenden den vorhandenen
   Daten-/Backupbestand; kein Restore, Reset oder neue Datenbank erforderlich.
   Healthchecks, HTTP/API und DNS prüfen. Der CodeServer-Mount/Auth sind gesonderte
   Voraussetzungen, keine automatisch durch dieses Repository erledigten Schritte.

## Automatisierte Tests sind keine LOCAL/DEV-Runtime

Destruktive Migrationstests dürfen **nie** auf die gemeinsame TEST-Datenbank.
`scripts/test_backend.py` liest keine Env-Dateien mehr und erzwingt weiterhin
seine separate, wegwerfbare Loopback-Instanz auf 55432 mit den bestehenden Test-
Guards. Die bisherige `compose.test.yaml` liegt nur noch als unveränderte Fixture
unter `backend/tests/fixtures/postgres.compose.yml`; sie gehört nicht zum Webstack
und ist kein zusätzlicher CodeServer-Dienst. `scripts/dev_local.py` bleibt nur
für historische isolierte Restore-Prüfungen mit explizitem `--env-file` erhalten;
es erzeugt keine `.env.local` und ist nicht der normale CodeServer-Startweg.
