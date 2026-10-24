# PR8 – Serverautorisierter Multi-Event-Betrieb

Stand: 24.10.2026. Lokale Implementierung auf main einschließlich PR1–7 und
Auditstabilisierung. Kein Commit, Push, Deployment oder produktiver Datenbankzugriff.
Die ursprüngliche Entwicklungsdatenbank wurde weder migriert noch zurückgesetzt.

## Architektur und Berechtigungsvertrag

Die bestehende Authentifizierung liefert `AuthenticatedUser.username` und
Funktionsrechte aus den vertrauenswürdigen Proxygruppen; eine persistierte
Benutzertabelle existiert nicht. Deshalb ergänzt `event_access` diese Identität
direkt: zusammengesetzter Primärschlüssel `(username, event_id)`, zusätzlich
`can_write`. Eine vorhandene Zeile erlaubt Lesen, `can_write=true` zusätzlich
Schreiben. Beides gilt nur zusammen mit dem jeweiligen bisherigen Funktionsrecht.
Auch Administratoren erhalten ohne ausdrücklichen Grant keine Eventdaten.

Migration `20261024_01` legt ausschließlich die neue Tabelle an. Sie vergibt keine
Grants und ändert keine Quoten, Imports, Evidence oder operativen Bestandsdaten.
Operatoren vergeben Rechte ausdrücklich über die Flask-CLI:

```text
flask --app app event-access grant <exakter-benutzername> <event-id> --read-only
flask --app app event-access grant <exakter-benutzername> <event-id> --write
flask --app app event-access revoke <exakter-benutzername> <event-id>
```

Diese Befehle benutzen die ausdrücklich konfigurierte Datenbank. Sie wurden nur
in isolierten Tests ausgeführt; sie sind keine Aufforderung zur Produktionsmigration.
Ein erneutes `grant` setzt das angegebene Recht; ohne Option gilt read-only.
Es gibt keine öffentliche Grant-API, keine automatische Administratorfreigabe
und keinen Schalter zum Umgehen der Eventprüfung.

Der vorhandene Resolver in `event_ownership_runtime.py` bindet nach Authentifizierung
und Rollenprüfung genau eine autorisierte ID an Flask `g`, also den Requestkontext.
`configured_event_id()`, Importresolver und Accommodation-Resolver benutzen diese ID.
Kein Request verändert die Prozesskonfiguration. Grants werden je Request frisch
aus der Datenbank gelesen; ein Entzug wirkt beim nächsten Request, auch bei Confirm.
Eine bereits laufende Transaktion wird dadurch nicht nachträglich abgebrochen.

Ohne `OPERATIONAL_EVENT_ID` benötigt jeder operative Request den Header
`X-Championship-Event-ID`. Fehlend oder widersprüchlich: 409; ohne Grant, inaktiv
oder read-only bei Mutation: 403. Fremde Objekt-IDs bleiben 404/409. Ein ausdrücklich
konfigurierter Pin bleibt eine zusätzliche Einschränkung und ermöglicht alten
Clients ohne Header ausschließlich dieses ebenfalls autorisierte Event.

Bootstrap liefert nur aktive freigegebene Events; ohne Grant ist die Auswahl leer.
Die erste autorisierte Auswahl wird vom Server angegeben, niemals aus Objekt-IDs
abgeleitet. Ein expliziter Bootstrapheader wird ebenfalls autorisiert.
Administrative Eventdetails müssen zum Header passen. Kopieren von Mappings
benötigt zusätzlich Zugriff auf das Quell-Event.

## Geprüfte Grenzen

| Bereich | Grenze |
| --- | --- |
| Personen, Listen, Dashboard, Analytics, Exportquellen | Bestehende Eventqueries und PR5-Readmodels verwenden den autorisierten Requestowner. |
| Buchungen, Insassen, Zuweisungen, Segmente | Eventqueries, Elternbeziehungen und bestehende ORM-Guards; fremde IDs und Mischbelegung werden abgewiesen. |
| Hotels und Zimmertypen | Stammdaten bleiben global; Kontingente und Buchungen sind eventgebunden. Globale Stammdatenänderungen bleiben nach bisheriger Funktionsrolle zulässig, benötigen aber ein schreibbares aktives Event. |
| AccommodationEvents / Bedarf | Championship-Eigentümer, getrennt von der ID des Planungseintrags; keine Übertragung zwischen Events. |
| Import, Reimport, Approval, Confirm | Header, Form-/Query-/Bodykontext, Sessionowner, Preview und Token müssen übereinstimmen. Versionen und Approval-Evidence werden auch im ORM gegen ihren Sessionowner geprüft. |
| Quoten | Eventbezogene unveränderliche Fixierung bleibt bestehen; neue Quoten-Audits erhalten den kanonischen Owner. |
| Audit und historische Evidence | Bestehende PR5-Auflösung bleibt erhalten. Unbekannte oder widersprüchliche Eigentümerschaft wird nicht global sichtbar gemacht. Keine historischen Zeilen geändert. |
| Weltmeister | Bestehende eventbezogene Anerkennungen bleiben isoliert; ORM-Guard ergänzt. Globale Referenzdatei und EZ-Ausnahmelogik unverändert. |
| Globale Datenbankaktionen | Im ungepinnten Multi-Event-Betrieb gesperrt: Historische Dumps können inzwischen entfernte Events enthalten. Im ausdrücklich gepinnten Wartungsbetrieb werden zusätzlich zur Adminrolle Rechte für sämtliche aktuellen Events einschließlich inaktiver Events verlangt; für Mutation jeweils Schreibrechte. Kein eventweiser Dump/Restore. |
| Testdaten-Reset | Bestehende Sperre für globale Historienbereinigung bei mehreren Events bleibt erhalten. |

Ausnahmen von einem zwingenden Header sind Identität/Bootstrap sowie globale
Competition-Stammdaten, statische Mockdateien und generierte synthetische Szenarien.
Sie enthalten keine operativen Eventdaten. Ein mitgesendeter Header wird trotzdem
geprüft. Das globale Anlegen eines Championship-Metadatensatzes benötigt die
bisherige Administratorrolle, erzeugt aber keinen Zugriffsgrant für den Ersteller.

## Frontend

Der bestehende ActiveEventProvider und Headerselector bleiben erhalten. Der
Server liefert die freigegebene Auswahl; die bestehenden Requestgenerationen,
Abbrüche, Cachewechsel und Dirty-/Review-/Write-Blocker werden wiederverwendet.
UI-Schreibrechte sind jetzt die Schnittmenge aus Rollenrechten und Event-Schreibrecht.
Die Eventadministration lädt operative Unterpanels nur für das aktive Event;
die Auswahl eines fremden Katalogeintrags erzeugt keinen Request mit falschem Header.

## Separate lokale Umgebung

- Frontend: `http://127.0.0.1:5174`, Proxy auf `http://127.0.0.1:5001`.
- Genau ein Backendprozess für beide Events, ohne operativen Pin.
- PostgreSQL 17, ausschließlich IPv6-Loopback `[::1]:55432`.
- Clusterverzeichnis: `.local-dev/pr8-tests/pgdata`.
- Browserdatenbank: `incoming_multievent_test`; Regressionen: `incoming_test`
  auf demselben separaten IPv6-Testcluster.
- Die vorhandene Entwicklungsinstanz auf **IPv4** `127.0.0.1:55432` und ihre
  Datenbank gleichen Namens bleiben unberührt. Standard-Testbefehle mit der
  vorhandenen `.env.test` dürfen deshalb nicht blind benutzt werden.

`scripts/multievent_local.py` prüft Benutzer, PostgreSQL-Hauptversion und den
exakten Clusterpfad vor jeder Nutzung. `init` verweigert eine vorhandene Datenbank;
es gibt keinen Reset-/Reseed-Befehl. Nur für eine frisch angelegte Testdatenbank
wird ein ausdrücklicher PR1-Ownershipplan erzeugt und die Migrationskette ausgeführt.

```powershell
# Der separate Testcluster ist bereits angelegt und läuft.
backend/venv/Scripts/python.exe scripts/multievent_local.py serve
# In einem weiteren Terminal im Verzeichnis frontend:
$env:VITE_API_PROXY_TARGET = 'http://127.0.0.1:5001'
pnpm dev --host 127.0.0.1 --port 5174 --strictPort
```

`init` ist nur für eine noch nicht existierende `incoming_multievent_test` bestimmt.
Der normale Vite-Proxy bleibt ohne diese Variable unverändert auf Port 5000.
Die lokale Fixture verwendet die bestehende explizite Entwicklungsidentität;
dies ersetzt weder Proxy-Authentifizierung noch Eventgrants im Produktivbetrieb.

Event A ist `WSC Montafon 2027`, Event B `Synthetisches Incoming Testevent 2028`.
Beide enthalten JPN und FIS-Code 9300953, aber eigene Personen, Buchungen,
Kontingente, Sessions, Auditzeilen und Bedarfsplanung. Hotel, Zimmertyp und
Competition werden geteilt. Die ausdrücklich gesetzten Fixture-Quoten unterscheiden
sich: Officials-Allowance A=2, B=5. Testidentitäten: `both`/`test-admin` für A+B,
`only-a` nur A, `reader` nur A lesend. Diese Grants existieren ausschließlich in
der Testfixture; die Migration legt keine davon an.

Die echten bereitgestellten JPN-Workbooks werden zusätzlich in den automatisierten
PostgreSQL-/HTTP-Tests in beide Events importiert, genehmigt, bestätigt und erneut
importiert. Die Originaldateien wurden nicht verändert oder ins Repository kopiert.

## Nachweise und Restrisiken

Der lokale Browserharness `.local-dev/pr8-browser.mjs` steuert echtes Edge über
CDP und Vite/Flask/PostgreSQL. Keine API-Mocks. Die 32 Prüfungen umfassen A→B→A,
getrennte Personen/Sessions/Kontingente/Buchungen/Planung/Quoten/Audit, offene
Formulare, Importreview, laufenden Write und verspätete A-Antwort nach Wechsel zu B.
Weiterhin: Benutzer nur A, serverseitig abgelehntes B und read-only trotz Adminrolle.
CDP verzögert reale Antworten; es ersetzt keine Backendantwort. Der Write verändert
nur die Notiz einer synthetischen B-Person und stellt ihren vorherigen Wert wieder her.
Ergebnis: keine JavaScript-Ausnahmen, keine Backend-500/Tracebacks im finalen Browserlauf.
Artefakte: `.local-dev/pr8-tests/browser.json`, `browser-a.png`, Backendlogs.

| Abschließende Prüfung | Ergebnis |
| --- | --- |
| Vollständiges Backend, Migrationsdatei separat | 839 bestanden, 1.229 Subtests bestanden, 1 bekannter Windows-Fehler, keine ausgelassen; 334,98 s |
| Vollständige PostgreSQL-Migrationsdatei | 4 bestanden, 6 Subtests bestanden; 29,12 s |
| Vollständige Frontend-Suite | 167 bestanden, keine ausgelassen |
| Vollständige Backup-Suite | 21 bestanden; 3,37 s |
| Typecheck / Build / `git diff --check` | erfolgreich |
| Echter lokaler Browser | 32 Prüfungen bestanden; keine JavaScript-Ausnahmen |

Die Backendrunde enthält die neuen expliziten Grant-, Revoke-, Parallelrequest-,
Route-Map-, Wartungsgrenzen- und additiven Migrationstests sowie die vorhandenen
Isolations-/Import-/Approval-/Quoten-/Weltmeisterregressionen. Der Route-Map-Test
prüft jede registrierte API-Methode einschließlich kompatibler Aliase mit einem
nicht freigegebenen expliziten Event. Die vier zuvor mangels Originaldateien
ausgelassenen JPN-Tests liefen diesmal mit den bereitgestellten Workbooks.
425 bestehende SQLAlchemy-/Bibliothekswarnungen sind im Backendlauf protokolliert.
Die maßgebliche vollständige Ausgabe steht in `.local-dev/pr8-tests/release-regression.log`;
Zwischenläufe sind kein Freigabenachweis.

Die verwendeten lokalen Befehle (Projektwurzel, vorhandener dedizierter Testcluster):

```powershell
backend/venv/Scripts/python.exe .local-dev/pr8-tests.py release-regression tests --ignore=tests/test_postgres_migrations.py -q
backend/venv/Scripts/python.exe .local-dev/pr8-tests.py migrations tests/test_postgres_migrations.py -q
backend/venv/Scripts/python.exe .local-dev/pr8-backup.py
node .local-dev/pr8-browser.mjs
# Im Verzeichnis frontend:
pnpm test
pnpm typecheck
pnpm build
```

Der lokale Testharness entfernt geerbte Datenbank-/Authentifizierungsvariablen,
setzt ausschließlich die IPv6-Testverbindung und prüft den tatsächlichen Clusterpfad.
Er setzt außerdem die beiden bereitgestellten JPN-Dateipfade. Backend- und
Migrationstests dürfen dieselbe Wegwerfdatenbank nicht gleichzeitig bearbeiten.

Die bekannte Windows-Dateirechteassertion im Ownership-CLI-Test verlangt POSIX
`0600`; Windows meldet `0666`. Der Test und der Dateischutz wurden nicht abgeschwächt.
Der Nachweis benötigt eine separate Windows-ACL-Prüfung oder einen POSIX-Lauf.
Bis dahin ist die Gesamtsuite nicht vollständig grün und dies keine allgemeine
Produktionsfreigabe. Bestehende Pins und fehlende Grants bleiben geschlossen.

Vor einem späteren Rollout sind Migration und explizite Benutzergrants als eigene
Operatoraktion notwendig. Die Identitätsquelle muss stabile Benutzernamen liefern;
Umbenennungen übernehmen keine Rechte automatisch. Backups bleiben globale
Administratorartefakte und benötigen eine gesonderte betriebliche Rechteprüfung,
insbesondere für historische Dumps mit inzwischen entfernten Events.

Die vorgeschlagene Weltmeister-Tabintegration ist weiterhin nur der kleine
UI-Vorschlag in `docs/local-stabilization-multi-event.md`: vorhandenes Panel unter
Administration → Events → Weltmeister, mit aktivem Ziel-Event; Herkunft eines Titels
und Anerkennung im Event getrennt anzeigen. Keine neue globale Interpretation
der eventgebundenen Tabelle, keine Änderung bestehender EZ-Ausnahmen.

## Geänderte Dateien

- Backendprodukt: `app.py`, `event_ownership_runtime.py`, `models.py`,
  `quota_history.py`, `quota_rules.py`, `routes/events.py`, `routes/identity.py`,
  neu `event_access_cli.py` und Migration `20261024_01_event_access.py`.
- Backendtests: explizite Legacy-Testgrants in `conftest.py`, neue
  `test_multi_event_access.py` und `test_event_access_migration.py`; angepasst:
  `test_active_event_context.py`, `test_api_route_safety.py`,
  `test_event_quota_migration.py`, `test_event_routes.py`,
  `test_import_event_id_api.py`, `test_import_event_identity.py`,
  `test_import_operational_impacts.py`, `test_room_type_routes.py`,
  `test_single_room_status.py`. Alte Domänentests erhalten ausdrücklich ihre
  Fixturegrants; neue Sicherheitstests schalten diese Fixture aus. Das
  Quoten-Abfragebudget steigt von sieben auf acht für die zusätzliche Grantprüfung.
- Frontend: `AuthProvider.tsx`, `permissions.ts`/Tests, `ActiveEventProvider.tsx`,
  `activeEventStore.ts`/Tests, `AdministrationEvents.tsx`, `vite.config.ts`.
- Lokale Einrichtung: `scripts/multievent_local.py`; dieser Bericht.
- Browser-/Regressionharnesses und Testartefakte bleiben ignoriert unter `.local-dev`.

Die zuvor behobene Auditursache (strukturierte Details statt immer Stringarray)
und die zugehörige verlustarme Normalisierung bleiben unverändert. Kein Bugfix
an der bereits funktionierenden Listenübersicht, keine Weltmeister-UI-Implementierung.
