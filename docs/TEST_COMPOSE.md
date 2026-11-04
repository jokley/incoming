# Isolierter Incoming-TEST-Stack

Nur Vorbereitung; keine Runtime-Aktionen ausgeführt. Separater Checkout von
`dev`, später `/home/Projects/incoming-test`. Voraussetzungen: Docker Compose
**mindestens 2.24.4**, bereits extern verwaltetes `dev-net`, eigene TEST-Secrets.
Keine Docker-Socket-Mounts oder Code-Server-/Infra-Änderungen.

## Basis und Isolation

Die vorhandene Basis heißt auf diesem Branch `docker-compose.yml` und lädt
**`incoming.env`**, nicht `.env`. Sie bleibt unverändert. `compose.yml` ist ein
Git-Symlink auf diese Basis, keine Stackkopie. Beide ergeben mit gleichem Projekt
und Environment dasselbe effektive Modell. Bisherige PROD-Aufrufe funktionieren
unverändert. Kein top-level `name:`; ausdrücklich `-p incoming-test` verwenden.

Gemeinsam bleiben Builds aus diesem Checkout, Images, Commands, Entrypoints,
Abhängigkeiten, Expose-Ports und Healthchecks. TEST überschreibt feste Container-
Namen, Service-Netze, Environment-Dateien, Runtime-Variablen und Mounts. Alle
veröffentlichten Ports werden ausdrücklich entfernt.

| Service | Container | Netze | Speicher |
| --- | --- | --- | --- |
| backend | incoming-test-backend | incoming-test-net, dev-net | TEST-Backups read-only |
| postgres | incoming-test-postgres | incoming-test-net | TEST-PostgreSQL-Volume |
| backup | incoming-test-backup | incoming-test-net | TEST-Backups beschreibbar |
| frontend | incoming-test-frontend | incoming-test-net | Container-Dateisystem |
| incoming-nginx | incoming-test-nginx | incoming-test-net, dev-net | lokale Nginx-Konfiguration read-only |
| etl (Profil etl) | incoming-test-etl | incoming-test-net | keine Host-/Snapshot-Mounts |

`incoming-test-net` ist ein eigenes internes Compose-Netz. `dev-net` ist external
und wird nicht von Incoming erzeugt oder gelöscht. Code-Server kann HTTP über
`http://incoming-test-nginx:8080` und die Backend-Diagnose über
`http://incoming-test-backend:5000/health` erreichen. PostgreSQL wird weder am
Host noch auf dev-net veröffentlicht. DB-Debugzugriff wäre eine separate Änderung.

Volumes: `incoming-test-postgres-data` und `incoming-test-postgres-backups`.
Der Backend-Source-Bindmount entfällt; das Backend läuft aus seinem Image.
Die einzige Host-Datei ist `./nginx/nginx.conf`, read-only aus dem TEST-Checkout.
Uploads/temporäre Dateien liegen im separaten Container-Dateisystem, Logs gehen
an Docker. Keine gemeinsamen beschreibbaren PROD-Pfade. ETL behält sein opt-in
Profil und `--help`, erbt aber keine Snapshot-/Report-Mounts.

Backup bleibt als benötigter Restore-Koordinator samt Healthcheck aktiv, mit
eigenen Credentials/Volume und `BACKUP_ENABLED=false` gegen geplante Backups.
Manuelle TEST-Backups betreffen ausschließlich TEST-DB und TEST-Backupvolume.

## Environment

`.env.test` wird bereits ignoriert. Das vorhandene `.env.test.example` und
`compose.test.yaml` gehören zum automatisierten Testläufer, **nicht** zu diesem
Stack. Im separaten Deployment-Checkout verwenden:

```sh
cp .env.test.compose.example .env.test
# Zwei verschiedene Secrets erzeugen, z.B. je openssl rand -hex 32,
# und TEST_POSTGRES_PASSWORD sowie TEST_AUTH_PROXY_SECRET ausfüllen.
```

Benötigt: `TEST_POSTGRES_PASSWORD` (URL-sicher, z.B. Hex) und
`TEST_AUTH_PROXY_SECRET`; optional `TEST_SUPERADMIN_USERNAME` für den exakten
Benutzernamen des späteren vertrauenswürdigen Auth-Proxys. Keine PROD-Werte
kopieren. Leere Pflichtwerte lassen bereits `compose config` scheitern.
Exportierte `TEST_*`-Shellvariablen haben Vorrang vor `--env-file`; ebenfalls
prüfen. Den automatisierten Backend-Testläufer nicht mit dieser Deployment-
`.env.test` betreiben.

`--env-file .env.test` liefert **nur Interpolationswerte**. Alle geerbten
servicebezogenen `env_file`-Listen werden geleert. Nur explizit aufgeführte
Variablen gelangen in die Container. `POSTGRES_DB` und `POSTGRES_USER` sind fest
`incoming_test`; `DATABASE_URL` wird mit TEST-Passwort und internem Host
`postgres:5432` erzeugt. Externe `DATABASE_URL`, `POSTGRES_HOST` oder PROD-DB-
Credentials aus der Shell werden nicht übernommen. `DATABASE_BACKEND` wird im
aktuellen Code nicht ausgewertet; erwartet wird eine PostgreSQL-`DATABASE_URL`.
Ein zusätzlicher Flask-Session-Secret-Parameter existiert in der aktuellen
Runtime-Konfiguration nicht. Dev-Authentifizierung bleibt aus;
`FLASK_ENV=production` bezeichnet den Betriebsmodus, nicht die Datenumgebung.

## Override-Semantik

`container_name` wird als Skalar ersetzt. Ohne spezielle Tags wird `environment`
nach Variablennamen zusammengeführt, `env_file` angehängt und `networks` nach
Netzschlüsseln ergänzt. Volumes werden nach Container-Zielpfad zusammengeführt;
Ports anhand IP/Ziel/veröffentlichtem Port/Protokoll ergänzt/dedupliziert.
Ein bloßes `[]` entfernt geerbte Ports oder Mounts nicht zuverlässig.

Hier ersetzt `!override` vollständige Environment-, Netzwerk- und Volume-Blöcke;
`!reset []` entfernt Env-Dateien, Ports und unnötige Mounts. Auch die top-level
Netz-/Volume-Definitionen werden ersetzt. Kein `freestyle-network`, PROD-Volume
oder PROD-Edge-Alias bleibt im TEST-Modell. Builds/Images, `depends_on` und
Healthchecks werden unverändert geerbt. Ohne Override würden Build-/Dependency-/
Healthcheck-Mappings nach Schlüsseln zusammengeführt; `image` wird ersetzt.
`command`, `entrypoint` und `healthcheck.test` werden ersetzt statt angehängt.

## Spätere Bedienung – nur dokumentiert

Alle Befehle im TEST-Checkout; stets Projekt und beide Dateien angeben:

```sh
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml config --quiet
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml up -d
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml ps
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml logs --tail=100
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml down
```

Normales `down` behält TEST-Volumes und entfernt dev-net nicht. **`down -v`
löscht TEST-Daten- und Backupvolume** und ist kein normaler Stop-Befehl.
Feste TEST-Namen erlauben nur eine Instanz dieses Stacks auf demselben Host.

Späteres Update auf sauberem `dev`-Checkout:

```sh
git pull --ff-only origin dev
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml up -d --build
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml ps
docker compose -p incoming-test --env-file .env.test -f compose.yml -f compose.test.yml logs --tail=100 backend postgres backup
```

Beim ersten Start initialisiert PostgreSQL das leere TEST-Volume. Der bestehende
Backend-Entrypoint führt automatisch Alembic bis `head` gegen TEST aus. Das
geschieht erst beim späteren Start, nicht hier. App-Testdaten danach bewusst
über TEST einspielen. PostgreSQL-, Backend-, Frontend- und Backup-Healthchecks
werden geerbt. Anschließend HTTP/API aus Code-Server über die obigen Adressen
prüfen. Nginx hat in der Basis keinen Healthcheck; der HTTP-Test prüft das Routing.

## Späterer Edge und optionale Datenübernahme

TEST hängt zunächst **nicht an edge-net** und hat keine Hostports. Das vermeidet
auch die Kollision des automatisch von Compose registrierten Servicealias
`incoming-nginx` mit PROD. Vor einer Edge-Anbindung muss dieser Service-DNS-Name
sicher getrennt werden; ein zusätzlicher Alias allein reicht nicht. Bei einer
späteren Anbindung muss edge-net external bleiben. Danach separat zentralen
Edge/Authelia/TLS/DNS für `test.incoming.jokley.at` vorbereiten und auf einen
eindeutigen TEST-Endpunkt routen, mit eigenem TEST-Proxy-Secret. Keine Änderungen
an zentralem Nginx, Authelia, Certbot, DNS oder WireGuard hier.

Optional, nicht automatisiert: geprüftes PROD-Backup separat nach TEST übernehmen
→ in TEST wiederherstellen → anonymisieren/pseudonymisieren → TEST-Migrationen
und Prüfungen. Keine produktiven Zugangsdaten oder direkten PROD-Verbindungen
für TEST; aktuell nur eine leere TEST-Datenbank vorgesehen.

## Statischer Nachweis

Mit Compose 2.40.3 und synthetischen Platzhaltern geprüft: `config --format json`
inklusive Profil `etl`, alle Container-/Volume-Namen, Mounts, Ports, Netze,
Build-Kontexte, Env-Dateien, DB-Ziele und geerbten Healthchecks. TEST benötigt
keine `incoming.env`. Der effektive PROD-JSON-Output der bisherigen Basis und
des Symlinks war exakt gleich. Keine echten Secrets gelesen, keine Runtime-
Aktionen ausgeführt.
