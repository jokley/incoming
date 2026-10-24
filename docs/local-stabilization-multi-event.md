# Lokale Stabilisierung und Multi-Event-Vorbereitung – 24.10.2026

## Aktivitätenfehler

Reproduziert im lokalen Microsoft Edge (Chromium/CDP), mit Vite auf
127.0.0.1:5173, Flask auf 127.0.0.1:5000 und echten API-Requests.
`GET /api/audit-events?page=1` antwortet mit 200; React scheitert anschließend
in `AuditLog` mit `item.description.details is not iterable`.
Backend-Logs bestätigen erfolgreiche Reads, keinen zugehörigen Backendfehler.

Die konkrete Antwort enthält vier sichtbare Aktivitäten. Import-Einträge 1699/1705
haben strukturierte Details, beispielsweise `peopleUnchanged: 4` und
`bookingsRemoved: 0`. Normale Aktivitäten liefern Textlisten. Der Importabschluss
in `app.py` persistiert seine Ergebniszusammenfassung absichtlich als JSON-Objekt;
`AuditEvent.to_dict()` erhält diese Struktur. Der bisherige Frontendtyp
`details?: string[]` und `event.details ?? []` täuschen dagegen eine Liste vor.
Nicht nur der Suchindex (`...details`), auch die Timeline (`details.map`) benötigt
eine echte Textliste.

PR 5 lässt zwei belegte Eigentumsformen zu: das neue kanonische Envelope mit
`championshipEventId`/`_scope: OPERATIONAL_EVENT` und das eng eingegrenzte alte
Import-Envelope mit `eventId`, POST, Importpfad und Importaktion. Andere alte,
globale oder unzuverlässig zugeordnete Einträge bleiben ausgeschlossen. Das alte
Importformat wird damit sichtbar; seine Objektstruktur war im Frontend unberücksichtigt.
Planungs-`eventId` und Championship-Eigentümer sind weiterhin unterschiedliche Begriffe.

Korrektur ausschließlich an der gemeinsamen Frontendprojektion:
`auditDetailLines` liefert für Listen, Objekte, Einzeltexte und leere Werte eine
Textliste. Bekannte Importzähler erhalten deutsche Beschriftungen; unbekannte
Schlüssel und verschachtelte JSON-Evidence bleiben sichtbar. Null Details werden
leer dargestellt, Nullwerte innerhalb eines Objekts sowie 0/false bleiben erhalten.
Der API-Typ ist bewusst `unknown`, damit Verbraucher normalisieren müssen.
Dashboard, Aktivitätenseite und Verlaufdialog verwenden dieselbe Projektion.
Keine Migration, kein Backfill, keine Änderung an Audit-API, Persistenz oder Filterung.

## Lokale Testtrennung und Nachweise

Die bestehende `.env.local` verwendet `incoming_test` auf IPv4-Loopback:55432.
Der laufende Backendprozess liefert ausdrücklich WSC Montafon 2027, ID 1,
mit `switchingAllowed=false`; die Datei allein enthält diese Laufzeitwahl nicht.
Bestehende Prozesse und Konfiguration wurden wiederverwendet.
Der gewöhnliche Testlauncher wäre hier gefährlich: Seine erlaubte Testdatenbank
ist zugleich die aktuell verwendete Entwicklungsdatenbank.

Deshalb wurde ein eigener PostgreSQL-17-Cluster unter
`.local-dev/audit-isolated-tests/pgdata` gestartet, ausschließlich auf **[::1]:55432**.
Er hat seine eigene Datenbank `incoming_test`; Datenverzeichnis und Ziel wurden vor
Tests geprüft. IPv4-Entwicklungscluster und vorhandene Entwicklungsdaten wurden
weder gestoppt noch zurückgesetzt. Die bestehenden Testzielprüfungen erlauben
IPv6-Loopback bereits; kein Sicherheitsguard wurde geändert. Testcluster wird nach
dem Lauf gestoppt, lokale Logs bleiben erhalten.

- Browser: ursprünglicher Crash dokumentiert; nach Korrektur vier Einträge,
  strukturierte Details, Kategoriefilter und Suche erfolgreich; fremder Header 409.
- Frontend: 164 Tests erfolgreich, keine ausgelassenen Tests. Neue Fälle prüfen
  beide Ownership-Envelopes, unveränderte Evidence, Zahlen/false, verschachtelte
  Objekte, Textlisten, Einzeltexte und leere Werte.
- Typecheck erfolgreich; Produktionsbuild erfolgreich (8,05 Sekunden).
- Backend: neuer API-Regressionstest prüft Objekt-/Listenevidence, beide Envelopes,
  A/B/A unter expliziter Testkonfiguration und unveränderte persistierte Auditzeilen.
  Das ist kein freigeschalteter Multi-Event-HTTP-Wechsel.
- Vollständige Backend-/Migration-/Backup-Ergebnisse: siehe Ergänzung unten.
- Lokale Browsernachweise: `.local-dev/audit-before.json`, `audit-before.png`,
  `audit-after.json`, `audit-after.png`; Testlogs unter `.local-dev/audit-isolated-tests`.

## Schlanker Vorschlag für echte Multi-Event-Nutzung

**Noch nicht implementiert.** Zwei auf unterschiedliche Events festgelegte
Backendprozesse oder ein manipulierter Bootstrap erfüllen A → B → A in derselben
Backendinstanz nicht. Auch der vorhandene globale Event-Stammdateneditor ist
kein operativer Eventwechsel.

| Bestehende Grenze | Erforderliche Änderung |
| --- | --- |
| `auth.py`: globale Rollen/Permissions, keine Benutzer-Event-Zuordnung | Kleine serverseitige Grant-Tabelle mit Benutzerkennung, Event und erlaubten Aktionen; Rollenrechte UND Eventgrant prüfen |
| `routes/identity.py`: ein Event, `switchingAllowed=false` | Nur tatsächlich autorisierte aktive Events und deren Fähigkeiten liefern; kein erster Katalogeintrag als implizite Auswahl |
| `app.py::authenticate_api_request`: Header muss `configured_event_id()` entsprechen | Authentifizierten Requesteigentümer validieren und in `g` speichern; Existenz, Aktivität, Grant und benötigte Aktion prüfen |
| `event_ownership_runtime.py`, `accommodation_scope.py` | Validierten Requesteigentümer verwenden; Objekt-, Relationship- und unveränderliche Ownership-Prüfungen erhalten |
| Importkontext, Session-/Approvalrouten und Confirm | Header, Query/Form/JSON, Session, Version, Preview und Mapping müssen denselben autorisierten Eigentümer haben; auch bei Confirm erneut Rechte prüfen |
| Audit-Stempel abhängig von Deploymentkonfiguration | Kanonischen Eigentümer aus autorisiertem Request ableiten; bestehende historische Evidence unverändert lassen |
| Globaler Admin-Katalog und globale Ressourcen | Eigene Adminrechte erhalten; ein Eventgrant berechtigt nicht automatisch zu globalen Katalog-/Backupänderungen |
| `scripts/dev_local.py`: Testziel und Montafon-Namensprüfung | Separates explizites Sandboxprofil für zwei Events, weiterhin strikt lokale DB-Allowlist |

Ein gemeinsamer Resolver `authorized_event(action)` sollte diese Entscheidung
requestlokal treffen. Kein backendweiter veränderlicher „active event“-Wert und
kein Umschreiben von `app.config` durch den Selector. Fehlender Header im
Multi-Event-Modus wird abgewiesen; der alte Single-Event-Kompatibilitätsweg bleibt
nur in ausdrücklich fest konfiguriertem Modus zulässig. Entzogene Rechte greifen
bei jedem Request; langlebige Import-/Downloadabläufe werden erneut geprüft.
`canWrite` allein reicht bei getrennten Daten-, Import- und Dispositionsrechten
nicht als Aktionsfreigabe. Existierende globale Adminrollen sollen nicht implizit
alle Eventgrants ersetzen.

Umsetzung in zwei kleinen Schritten:

1. Grants, zentralen Resolver und alle abhängigen Read-/Write-/Importpfade
   zusammen absichern; negative und parallele HTTP-Tests vor Freigabe.
2. Erst anschließend Bootstrap für mehrere erlaubte Events öffnen und den
   vorhandenen ActiveEventStore/RequestScope nutzen. Workspace-Neuaufbau,
   Requestabbruch, Generationenprüfung sowie Dirty-/Import-/Writeblocker bleiben.

Dauerhafte lokale Umgebung: eigene Datenbank `incoming_multievent_test` und
eigener DB-Benutzer, idealerweise eigener Cluster/Port mit eigener strikt
geprüfter Launcher-Konfiguration. Ein Backend und ein Frontend verwenden genau
diese Datenbank. Migrationen auf leerem Testziel, danach explizites Fixture-Skript:
WSC Montafon 2027 (synthetischer Testbestand, keine Kopie der Entwicklungsdaten)
und Synthetisches Testevent 2028; pro Event eigene Personen, Importsessions,
Kontingente, Buchungen, Planung, fixierte Testquoten und Audit-Evidence. Globale
Hotel-/RoomType-/Competition-Kataloge dürfen gemeinsam sein, deren operative
Daten nicht. Fixture-Reset muss Datenbank, Benutzer und Cluster prüfen.

Abnahme: echter Browserwechsel A → B → A gegen denselben Backendprozess, ohne
Requestumleitung/Mocks; erkennbare unterschiedliche Testpersonen und Aktivitäten.
Zusätzlich A-only-, B-only-, Read-only- und A+B-Benutzer, fehlende/falsche Header,
fremde Objekt-IDs, Rechteentzug, parallele A/B-Requests, verspätete Antworten,
Back-Navigation, Import-Confirm und Dirty-/Writeblocker. Keine Sicherheitsprüfung
für diesen Aufbau abschalten. In diesem Auftrag wurden noch keine dauerhaften
Multi-Event-Fixtures angelegt; nur isolierte Regressionstest-Fixtures.

## Vorschlag: Administration → Events → Weltmeister

**Noch nicht implementiert.** Vorhandene `AdministrationWorldChampions` als
eingebettetes Panel wiederverwenden, neuen vierten Tab in `AdministrationEvents`
ergänzen und das ausgewählte Ziel-Event ausdrücklich übergeben. Dialoge setzen
diesen Eventbezug fest; `events[0]` und freie Ziel-Event-Auswahl entfallen dort.
Bei Katalogauswahl eines anderen als des autorisierten operativen Events darf
das Panel aktuell keine Daten laden/speichern; stattdessen erklärt es den fehlenden
operativen Kontext. Nach Einführung der Eventgrants kann ein autorisierter
Wechsel angeboten werden. Ein Tabwechsel darf ihn nicht stillschweigend auslösen.
Panel je Event neu aufbauen; Entwürfe weiterhin über vorhandene Blocker schützen.
Alten Administrationseinstieg kompatibel auf den neuen Tab weiterleiten.

Historische Titelherkunft (z. B. Engadin 2025, FIS-Code, Disziplin, Titeltyp und
Quelle) von Gültigkeit/Anerkennung im Ziel-Event (Montafon 2027 bzw. Testevent 2028)
sichtbar unterscheiden. Die JSON-Referenzdatei ist wiederverwendbare Herkunft;
die bestehende `world_champion`-Tabelle ist **bereits eventgebunden**, keine globale
Titelbibliothek. Für den kleinen UI-Schritt ist keine Schemaänderung erforderlich.
Eine spätere echte globale Titelbibliothek wäre ein eigener Schritt mit separater
Eventzuordnung, nicht eine Umdeutung oder globale Freigabe der vorhandenen Zeilen.

`world_champions.recognize` erkennt weiterhin ausschließlich über exakten FIS-Code
und eventbezogene aktive/freigegebene Referenzen. `MANUAL_SET`, `MANUAL_REMOVE`,
historisches WORLD_CHAMPION und OTHER bleiben nach bestehenden Vorrangregeln
erhalten. TEAM erzeugt weiterhin keinen automatischen Anspruch. Öffnen oder
Bearbeiten des Tabs löst keine Massen-Neuberechnung bestehender Personen aus.
EZ-Formeln, Ausnahmeentscheidungen und gespeicherte Evidence bleiben unverändert.

## Umfang und Restrisiken

Geändert: `frontend/src/app/types.ts`, `services/auditActivity.ts`, dessen Test,
`backend/tests/test_event_readmodels.py` und dieser Bericht. Lokale Browser- und
Testharnesses liegen ausschließlich im ignorierten `.local-dev`.
Keine Änderung der Listenübersicht, Backend-Produktlogik, Sicherheitsgrenzen,
Weltmeisterlogik oder Datenbankschemata. Kein Commit, Push oder Deployment.

Unbekannte zukünftige Auditfelder werden mit ihrem Rohschlüssel/JSON angezeigt;
das ist absichtlich verlustarm, aber nicht vollständig fachlich übersetzt.
Historische Einträge ohne belegbaren Eventeigentümer bleiben unsichtbar.
Echte Multi-Event-Autorisierung ist weiterhin offen. Die vorhandene lokale
Namenskollision von Test- und Entwicklungsdatenbank muss bei künftigen Testläufen
beachtet werden; Standard-Testkommandos dürfen nicht blind ausgeführt werden.

## Abschließende Regressionsergebnisse

| Prüfung | Ergebnis |
| --- | --- |
| Audit-/Active-Event-Backendtests | 55 bestanden, 1 JPN-Workbook-Test ausgelassen |
| Vollständiges Backend ohne separat ausgeführte Migrationsdatei | 815 bestanden, 1.229 Subtests bestanden, 1 Fehler, 4 ausgelassen; 251,09 s |
| Vollständige PostgreSQL-Migrationsdatei | 4 bestanden, 6 Subtests bestanden; 22,86 s |
| Backup-Suite | 21 bestanden; 3,22 s |
| Vollständige Frontend-Suite | 164 bestanden, keine ausgelassen |
| Typecheck / Build / `git diff --check` | erfolgreich |
| Abschließender Browserlauf | keine JS-/Console-Fehler; Darstellung, Kategorie, Suche bestanden; fremder Kontext 409 |

Der Fehler in `test_event_ownership.py::test_read_only_cli_and_post_migration_verification`
betrifft die unveränderte Assertion `report_path.stat().st_mode & 0o777 == 0o600`.
Windows meldet hier `0666`; der CLI-Prozess selbst endet erfolgreich. Das ist eine
plattformabhängige Dateirechteprüfung außerhalb der Auditkorrektur. Weder Prüfung
noch Schutzmechanismus wurden abgeschwächt. Die Gesamtsuite ist somit ausdrücklich
**nicht vollständig grün**. Eine Windows-ACL-Prüfung oder ein POSIX-Testlauf bleibt
für diesen Dateischutz-Nachweis erforderlich.

Vier bestehende Fälle (zwei Import-Identity-, ein Reimport- und dessen
Active-Event-HTTP-Test) benötigen `JPN_ENTRIES_FILE`/`JPN_ROOMS_FILE`; die externen
Originaldateien waren nicht konfiguriert. Synthetische und vorhandene AUS-Fixtures
liefen in der vollständigen Suite. Keine Tests deaktiviert oder Erwartungen geändert.
410 bestehende SQLAlchemy-/Bibliothekswarnungen wurden im Backendlauf protokolliert.
Der separate IPv6-Testcluster wurde nach den Prüfungen sauber gestoppt.
