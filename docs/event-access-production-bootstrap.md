# PR8-Erststart: EVENT_ACCESS_DENIED

Stand 24.10.2026; geprüft gegen `main` `5a7be0d`. Keine Produktionsaktion durch
Codex. Die folgenden VPS-Befehle sind ausdrücklich **Operatoraktionen**.

## Befund und Entscheidung

`auth.py` authentifiziert ausschließlich die bestehende Proxyidentität und leitet
Funktionsrechte aus Gruppen ab. `event_ownership_runtime.authorize_event()` verlangt
zusätzlich eine exakte `(username, event_id)`-Zeile in `event_access`. Auch `admin`
bekommt keine implizite Eventfreigabe. `OPERATIONAL_EVENT_ID=1` begrenzt den
zulässigen Kontext, vergibt aber keine Berechtigung.

`routes/identity.get_active_event_context()` prüft bei gesetztem Pin zuerst dessen
Grant. Fehlt er, entsteht genau `403 EVENT_ACCESS_DENIED`. Ohne Pin liefert der
Bootstrap für einen Benutzer ohne Grants dagegen eine leere Eventauswahl. Beides
bleibt geschlossen. Die Migration `20261024_01` erzeugt absichtlich keine Grants.
Mit dem gemeldeten leeren Bestand erklärt das den Ausfall. Dies ist eine fehlende
explizite Erstfreigabe, kein nachgewiesener Defekt der Proxyanmeldung.

Die bestehende `event-access grant`-CLI reicht vollständig aus. Keine Änderung an
Produktcode, Schema, Proxyanmeldung oder Provider erforderlich. Der vorhandene
Provider sperrt den Workspace bei 403, leert den Requestkontext und kann ihn nach
Freigabe über „Erneut prüfen“ laden. Die API zeigt dafür derzeit nur `FORBIDDEN`;
das ist wenig erklärend, aber kein weiterer Zugriffsblocker. Ein Grant gewährt
niemals fehlende Funktionsrechte.

## Operatorablauf auf dem VPS

Im bestehenden Compose-Projektverzeichnis arbeiten. Nicht `down`, `init`, Reset,
erneute Migration oder Datenbankrestore ausführen. Für diesen Fix ist kein Pull,
Build, Deployment oder Prozessneustart nötig. Die CLI benutzt dieselbe bestehende
Backendkonfiguration/Datenbank; jeder neue HTTP-Request liest Grants erneut.

### 1. Authentifizierten Namen bestimmen

Im bereits über Authelia angemeldeten Browser auf `https://incoming.jokley.at`:

```js
const r = await fetch('/api/auth/me', { credentials: 'same-origin' });
console.log(r.status, await r.json());
```

`username` exakt übernehmen: Groß-/Kleinschreibung zählt; nicht Anzeigename,
E-Mail oder vermuteten Login verwenden. `/api/auth/me` braucht keinen Eventgrant.
Keine eigenen Identitätsheader oder Proxy-Secrets im Browser setzen. Bei 401 ist
zuerst die Proxykette zu prüfen, bei fehlendem `data.read` die Authelia-Gruppe;
ein Eventgrant löst diese Probleme nicht. Keine Cookies/HARs veröffentlichen.

Im VPS-Terminal den bestätigten Namen ohne Shellinterpolation in Python aufnehmen:

```bash
read -r -p 'Exakter username aus /api/auth/me: ' incoming_username
```

Vorher Namen/Grants und Event ohne Änderungen prüfen (nur diese Ausgabe, keine
gesamte Konfiguration ausgeben):

```bash
docker compose exec -T backend python - "$incoming_username" <<'PY'
import sys
from app import app
from models import db, Event, EventAccess
with app.app_context():
    print('OPERATIONAL_EVENT_ID:', app.config.get('OPERATIONAL_EVENT_ID'))
    event = db.session.get(Event, 1)
    print('Event:', None if event is None else (event.id, event.name, event.active))
    row = db.session.get(EventAccess, (sys.argv[1], 1))
    print('Grant:', None if row is None else (row.username, row.event_id, row.can_write))
PY
```

Nur fortsetzen, wenn Pin `1`, Event `WSC Montafon 2027` aktiv und die Identität
bestätigt sind. Bei bestehendem Grant dessen ursprüngliches Recht für Rollback
notieren. Keine automatische Eventsuche oder Änderung des Pins.

### 2. Explizit freigeben

Für den bestätigten operativen Bearbeiter:

```bash
docker compose exec -T backend flask --app app event-access grant "$incoming_username" 1 --write
```

Für einen ausschließlich lesenden Benutzer stattdessen `--read-only` verwenden.
Die Angabe ist bewusst explizit: Ohne Option setzt die CLI **read-only**, auch bei
einem bereits schreibberechtigten Grant. Wiederholung mit demselben Modus erzeugt
keine weitere Zeile. Andere Grants bleiben erhalten. Keine automatische Freigabe
für Gruppen, Administratoren, andere Benutzer oder zukünftige Events.

### 3. Kontrollieren

Den Read-only-Pythonbefehl aus Schritt 1 erneut ausführen. Anschließend im Browser:

```js
const r = await fetch('/api/active-event-context', { credentials: 'same-origin' });
console.log(r.status, await r.json());
```

Erwartet: HTTP 200, genau Event `1`, `selectedEventId: "1"`,
`switchingAllowed: false`; `canWrite` zusätzlich abhängig von der Funktionsrolle.
„Erneut prüfen“ anklicken oder neu laden. Hotels, Kontingente, Personen, Buchungen
und Events/Bedarfsplanung öffnen. Der gemeldete Ausgangsbestand ist 45 Hotels,
109 Kontingente, 7 Planungs-Events, 58 Personen, 4 Buchungen und 35 Weltmeister;
das sind **vom Operator gemeldete, nicht durch Codex produktiv verifizierte** Werte.
Die Grantvergabe ändert ausschließlich die eine Berechtigungszeile, keine dieser
Bestandsdaten. Eine inzwischen erfolgte fachliche Änderung bei Vergleichen beachten.

Mit einer separat angemeldeten, nicht freigegebenen Identität muss Bootstrap im
gepinnten Betrieb weiterhin 403 liefern. Keine fremde Identität durch manuelle
HTTP-Header simulieren. Mit read-only-Grant bleibt Schreiben serverseitig gesperrt;
dies wurde lokal getestet, keine produktive Testmutation erforderlich.

### 4. Rollback der Freigabe

War vorher kein Grant vorhanden:

```bash
docker compose exec -T backend flask --app app event-access revoke "$incoming_username" 1
```

Bei zuvor vorhandenem Grant dessen vorherigen Modus ausdrücklich über `grant`
wiederherstellen. Widerruf wirkt beim nächsten Request; eine bereits laufende
Transaktion wird nicht nachträglich abgebrochen. Nicht das Schema zurückrollen oder
PR8 ausbauen. Die Dokumentations-/Teständerungen dieses Hotfix benötigen kein
Produktionsdeployment; ihr Git-Rollback verändert keine Grants.

## Proxyprüfung und Secret-Rotation als separate Operatoraktion

Der Anwendungscode nutzt `secrets.compare_digest`; fehlendes/falsches Secret
verwirft die Identität. `AUTH_DEV_USER` muss produktiv leer bleiben. Im Repository
ist nur Incoming-Nginx vorhanden; dieser reicht Requestheader standardmäßig an
Flask weiter und publiziert keinen eigenen Hostport. Die tatsächliche Edge-/Authelia-
Konfiguration ist hier nicht verfügbar und kann daher nicht als geprüft gelten.

Am Edge muss ausschließlich das Ergebnis einer erfolgreichen Authelia-Prüfung
`X-Authenticated-User/Groups/Name/Email` setzen: sämtliche gleichnamigen
Clientheader überschreiben, ebenso `X-Auth-Proxy-Secret`. Backend und Incoming-Nginx
dürfen nicht ungeschützt direkt aus dem Internet erreichbar sein. Mitglieder des
Docker-`edge-net` und VPS-/Dockeradministratoren gehören zur Vertrauensgrenze.
TLS außen, Netzwerkgrenzen und bestehenden Auth-Request-Flow erhalten.

Das sichtbar gewordene Secret muss rotiert werden; Codex kennt/liest es nicht.
Keine Werte in Chat, Git, Tickets, Shellargumente, Accesslogs oder Screenshots
übernehmen. Nicht `docker compose config`, `docker inspect` oder `printenv` zur
Diagnose ausgeben. Sichere Schritte:

1. Wartungsfenster/kurze fail-closed Unterbrechung planen. Bestehende private
   Konfigurationsdateien mit eingeschränkten Dateirechten gesichert halten.
2. Neuen starken Zufallswert im bestehenden Secretmanager oder einer geschützten
   Datei erzeugen (z. B. Python `secrets.token_urlsafe(48)` direkt in eine neue
   Datei unter `umask 077`, nicht auf stdout; Shelltracing deaktiviert). Kein
   neues Login-/Secretmanagement einführen.
3. Neuen Wert sicher sowohl in die bestehende Edge-Nginx-Secretkonfiguration als
   auch `AUTH_PROXY_SECRET` der bestehenden Backend-Umgebung übernehmen. Das
   Compose-Projekt lädt Backendwerte aus `incoming.env`; Datei nicht committen.
   Konfigurationstests ohne Ausgabe gerenderter Secrets ausführen.
4. Backend kontrolliert mit neuer Umgebung neu erstellen (bloßes `restart` lädt
   eine geänderte env-Datei nicht), dann Edge kontrolliert reloaden. In diesem
   kurzen Übergang liefern abweichende Secrets 401; keine unsichere Übergangsfreigabe
   einbauen. **Der Backend-Entrypoint führt bei Start Alembic `upgrade head` aus:**
   vorher sicherstellen, dass der geprüfte laufende Release/Head bereits migriert
   ist und keine unfreigegebenen Migrationen mitgezogen werden. Produktionsrestart
   und eventuelle Migrationsfreigabe sind separate Operatorentscheidungen.
5. Über die echte Browser-/Authelia-Kette `/api/auth/me` und Eventbootstrap prüfen;
   Geheimnisse niemals in Testheader-Ausgaben protokollieren. Die Grantzeilen bleiben
   unverändert. Alten offengelegten Wert aus aktiven Konfigurationen entfernen und
   zugängliche Diagnoseausgaben gemäß bestehender Betriebsrichtlinie behandeln.

Bei Rotationsfehler bevorzugt neue Werte/Übergabe korrigieren und geschlossen
bleiben. Rückkehr zum offengelegten alten Secret stellt die Sicherheit nicht wieder
her. Kein Ausschalten der Secretprüfung, kein `AUTH_DEV_USER`, keine pauschalen Grants.

## Lokale Verifikation

Ergebnisse vom 24.10.2026, ausschließlich auf einem frisch erstellten lokalen
PostgreSQL-17-Testcontainer mit dedizierter `incoming_test`-Datenbank:

- `tests/test_multi_event_access.py`: **21 bestanden**, 4,59 s; bestehende
  datetime-/SQLAlchemy-Deprecation-Warnungen. Zwei neue Backendtests.
- Vollständige Frontend-Suite: **168 bestanden**, keine ausgelassenen Tests;
  ein neuer Bootstrap-/Retry-Test (gezielte Store-Suite: 15 bestanden).
- Typecheck, Produktionsbuild und `git diff --check`: erfolgreich.
- Kein echter Produktions-/Authelia-Browsertest möglich; keine vollständige
  Backend-/Backup-Suite erneut ausgeführt, da keine Produktimplementierung geändert.

Frontendbefehle direkt mit den vorhandenen Abhängigkeiten ausgeführt:
`node --experimental-strip-types --test 'src/**/*.test.ts'`,
`node node_modules/typescript/bin/tsc --noEmit`,
`node node_modules/vite/bin/vite.js build`. Der erste `pnpm`-Aufruf scheiterte vor
Teststart am nicht verfügbaren lokalen pnpm-Home; kein Produkt-/Testfehler.
Der erste Backendaufruf fehlte bei der Testkonfiguration (`DATABASE_URL`); mit
beiden ausdrücklich auf die isolierte Datenbank gesetzten URL-Variablen lief die
Suite erfolgreich. Testcontainer anschließend entfernt.

Geänderte Dateien: diese Anleitung, Verweis in `docs/event-access-pr8.md`,
`backend/tests/test_multi_event_access.py` und
`frontend/src/app/events/activeEvent.test.ts`.
Keine neuen Produktcode- oder Migrationsdateien. Tests betreffen Grant/kein Grant,
fremden Benutzer, Pin, read-only, Wiederholung, Widerruf, Proxysecret und gesperrten
Frontend-Bootstrap mit anschließendem Retry. Keine produktiven Daten gelesen oder
geschrieben. Commit und Pull Request anschließend ausdrücklich beauftragt;
keine produktive Grantvergabe, Migration oder Deployment.
