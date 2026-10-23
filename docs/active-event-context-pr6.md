# PR 6 – Zentraler Active-Event-Kontext

Basis: main `ad3e9b1`, einschließlich gemergtem PR5 (`64444ce`). Keine produktiven
Operationen, Migrationen oder Resets. Fixtures/Schemaaufbauten ausschließlich
in der dedizierten isolierten Testdatenbank. Commit und Pull Request erfolgen nach ausdrücklichem Abschlussauftrag; kein automatisches Merge.

## Inventar vor Implementierung

| Mechanismus | Bestand | Gezielte Verwendung |
|---|---|---|
| Championship Event / AccommodationEvent | bestehende getrennte Modelle, PR1-Eigentum | unverändert; keine parallele Eventverwaltung |
| `event_ownership_runtime.py` | configured_event_id, validate_operational_import_event | explizite Deploymentgrenze bleibt verbindlich |
| `imports/event_context.py` | normalize_event_id, Session-/Preview-/Mappingvalidierung | Headerkontext mit bestehendem Importkontext abgleichen |
| `accommodation_scope.py` | request-lokale Validierung, event_query/event_get, PR4/5-Filter | vorhandene Datenisolation beibehalten |
| `app.py::authenticate_api_request` | zentrale Authentifizierung, kanonische API-Aliase, Rollenberechtigungen | zentralen expliziten Requestheader nach Auth/Rechten prüfen |
| `routes/identity.py`, `auth.py` | /auth/me, vorhandene Rollen/Permissions | serverseitig erlaubten Eventkontext anbieten, keine neue Benutzerverwaltung |
| `AuthProvider.tsx` | zentraler User-/Berechtigungskontext | ActiveEventProvider darunter einbinden; kein Datenladen vor Bootstrap |
| `services/api.ts` | einzelner API-Service; JSON sowie direkte fetch-Aufrufe für Upload/Downloads | gemeinsame Eventtransportgrenze für sämtliche Aufrufe |
| `DataImport.tsx` | eigener events/eventId-State, erstes Event als Default | entfernen; ausschließlich zentraler Providerkontext |
| `Layout.tsx`, `routes.tsx` | gemeinsamer Header, Browserrouter, Seiten mit lokalem Daten-/Dialogstate | kompakte Eventanzeige; Workspace beim erlaubten Wechsel vollständig ersetzen |
| `CrudDialog.tsx` | dirty/saving und bestehender Verwerfen-Dialog | vorhandenen Änderungsstatus als Wechselblocker registrieren |
| Weitere Dialoge/Formulare | MUI/EnterpriseDialog, bestehende Formulare | offene Dialoge/Formulare konservativ schützen; Review eigens blockieren |
| Dashboard/Analytics/Listen/Audit | lokale React-Daten aus zentralem API-Service | Provider-Grenze remountet alle Daten, keine zweite Eventauswahl pro Seite |
| Query-/Import-Caches | kein globales React-Query-System; PR3/5 request-/sessiongebunden | Transportgeneration und AbortController verhindern alte Responses |

## API-Entscheidung

Server bietet ausschließlich das aktive, ausdrücklich konfigurierte und für den
angemeldeten Benutzer zulässige Championship an. Vorhandene Championship-
Stammdaten sind keine operative Freigabe. `switchingAllowed` bleibt serverseitig
false. Tests dürfen einen anderen autorisierten Katalog simulieren, ohne eine
produktive Multi-Event-Schaltung einzuführen.

Neue UI übergibt den Kontext zentral als `X-Championship-Event-ID`; fehlender
Frontendkontext verhindert operative HTTP-Aufrufe. Server validiert Header nach
Authentifizierung gegen OPERATIONAL_EVENT_ID und vorhandene Kontexthelfer.
Bestehende API-Clients ohne neuen Header behalten den bereits validierten
Single-Event-Kompatibilitätsvertrag über OPERATIONAL_EVENT_ID. Dies ist kein
Fallback auf erstes/aktives Event. Import-Session/Preview-IDs bleiben zusätzlich
unabhängig gegen ihren Eigentümer abgesichert.

**PR 6 bereitet die zentrale Eventauswahl vor, aktiviert aber noch keine vollständige produktive Multi-Event-Nutzung.**

## Implementierte Architektur

`AuthProvider -> ActiveEventProvider -> EventWorkspace -> RouterProvider`.
Es existiert genau ein Event-Store, zu dem React über `useSyncExternalStore`
abonniert ist. `ActiveEventStore` enthält Auswahl, Metadaten, Status, serverseitige
Capabilities, Revision und Wechselblocker. Kein Seiten-State und kein
localStorage-Fallback entscheidet den Championship-Kontext.

`EventRequestScope` ist ausschließlich eine daraus abgeleitete Transport-Lease:
Header, Generation, AbortController und laufende Schreibrequests. Er ist weder
eine zweite Eventverwaltung noch ein globaler Backendzustand. Die bestehenden
Seiten verwenden weiterhin den einen `api`-Service. JSON, FormData, FIS-Upload,
Szenario-Downloads und Backup-Dateipfade gehen durch dieselbe Transportgrenze.
FormData erhält keinen künstlichen Content-Type. Authentifizierungsrequests
bleiben beim Workspace-Abbau erhalten, damit Auth-Refresh nicht sich selbst
abbricht. Auth- und Event-Bootstrap benötigen naturgemäß noch keinen ausgewählten
Clientkontext.

### Neue und geänderte Dateien

Neu:
- `frontend/src/app/events/activeEventStore.ts`: einziger Auswahl-/Capability-Store.
- `frontend/src/app/events/eventRequestScope.ts`: generationengebundener Transport.
- `frontend/src/app/events/ActiveEventProvider.tsx`: zentraler Provider und Blocker-Hook.
- `frontend/src/app/events/ActiveEventSelector.tsx`: kompakte Headeranzeige/-auswahl.
- `frontend/src/app/events/activeEvent.test.ts`: Auswahl-, Abbruch-, Schreib-/Review-/Auth-Tests.
- `frontend/src/app/events/activeEventApi.test.ts`: tatsächlicher API-Service und SSR-Headerstruktur.
- `backend/tests/test_active_event_context.py`: Bootstrap-/Header-/Objektgrenztests.
- dieser Bericht.

Geändert:
- `backend/routes/identity.py`: Capability-Bootstrap über bestehende Authentifizierung.
- `backend/app.py`: expliziten Header zentral prüfen und Importkontexte vergleichen;
  Validierungscaches auch bei wiederverwendeten äußeren Test-App-Kontexten je HTTP-Request zurücksetzen.
- `backend/tests/fixtures/api_routes.json`: nur den neuen GET-Bootstrap ergänzen;
  Auth-/Permission-Manifesttests prüfen ihn mit.
- `frontend/src/app/App.tsx`, `routes.tsx`: Provider integrieren, Browserrouter je Revision erzeugen/entsorgen.
- `Layout.tsx`: Header-Kontext, bestehende Desktop-/Kompaktnavigation erhalten.
- `DataImport.tsx`: eigene Eventauswahl und First-Event-Default entfernen; Review-/Uploadzustand sperrt Wechsel.
- `AdministrationEvents.tsx`: vorhandenen globalen Metadateneditor beim aktiven Event öffnen.
- `CrudDialog.tsx`: vorhandenes dirty/saving als Wechselblocker wiederverwenden.
- `services/api.ts`, `services/download.ts`: zentrale Header-/Generationsgrenze, Guard vor Dateidownload.
- `services/assignmentPerformance.test.ts`: Test-Lease explizit konfigurieren; Messverhalten unverändert.

Der globale Championship-Metadateneditor bleibt eine vorhandene Adminfunktion.
Seine Auswahl eines Katalogdatensatzes ist **kein** operativer Eventwechsel und
schaltet keinen weiteren Bestand frei. AccommodationEvent-Auswahlen bleiben
Bedarfsplanungs-Datensätze und werden nicht als Championship-Kontext umgedeutet.

## API-Vertrag / Rechte

`GET /api/active-event-context` benötigt wie operative Reads `data.read` und liefert:

```json
{
  "events": [{"id":"<configured ID>","name":"<existing Event name>","active":true,"canRead":true,"canWrite":false}],
  "selectedEventId":"<configured ID>",
  "switchingAllowed":false
}
```

Zusätzlich enthält das Event die vorhandenen Jahr-/FIS-/Sektormetadaten. Keine
Event-ID wird im Sourcecode auf eine produktive ID festgelegt. `canWrite` ergibt
sich ausschließlich aus den vorhandenen data.write/assignments.write/imports.write-
Berechtigungen. Kein neues Rollen-, Nutzer- oder ACL-System. Der Bootstrap ist die
kleine zentrale Stelle, an der später echte Eventberechtigungen anzubinden sind.

Expliziter Header wird nach Authentifizierung und Rollenprüfung, vor Snapshots,
Schreiblock und Mutation normalisiert und gegen die konfigurierte Veranstaltung
sowie deren Existenz/Aktivität geprüft. Import-Header, Query-/Form-/JSON-Event-ID
und owning Session/Version müssen übereinstimmen. Der Header kann beim Upload
allein den Eventkontext liefern; neue UI sendet ihn zusätzlich zum bestehenden
Formfeld. Keine Session-ID überschreibt eine ausdrücklich andere Auswahl.

Ohne Authentifizierung bleibt 401, fehlende Rollenrechte ergeben 403. Ungültige,
fremde oder nicht verfügbare explizite Kontexte werden kontrolliert mit 409
abgewiesen. Fehlende Deploymentkonfiguration bietet keinen ersten/aktiven Event
an. Bestehende Fremd-ID-Prüfungen liefern weiterhin 404/409. Neue UI führt ohne
initialisierten Eventkontext keine operativen HTTP-Aufrufe aus.

## Wechsel, Dialoge und Cache-Isolation

Im echten Backend bleibt der Wähler deaktiviert: nur ein zulässiger Kontext,
`switchingAllowed=false`. Es gibt keinen produktiven Schalter zur Multi-Event-
Freigabe. Vorhandene weitere Eventstammdaten reichen niemals zur Auswahl.

Für einen später ausdrücklich autorisierten Wechsel ist vorbereitet:
1. Ziel muss im serverseitig freigegebenen Katalog liegen.
2. Laufende Schreiboperationen einschließlich Response-/Bodyverarbeitung blockieren.
3. Bestehendes CrudDialog dirty/saving, offene Dialoge und geänderte Formulare
   blockieren konservativ; keine automatische Verwerfung. Bestehenden Dialog
   speichern/schließen oder bewusst verwerfen, anschließend erneut wechseln.
4. Geöffneter Import-Review, ausgewählte Upload-Dateien oder laufender Import
   blockieren; der Operator muss ihn abschließen oder die Ansicht bewusst verlassen.
5. Nach Freigabe werden alte Eventrequests abgebrochen und ihre Transportgeneration
   ungültig. Auch ignoriertes AbortSignal oder verspäteter Response-Body kann keine
   alten Daten mehr publizieren oder einen alten Download auslösen.
6. URL wird auf die Übersicht ohne frühere Personen-/Sessionparameter gesetzt.
   Router/Workspace werden anhand der neuen Revision vollständig ersetzt; alter
   Router wird entsorgt. Dashboard, Personen, Disposition, Quoten, Import, Planung,
   Kontingente, Analytics, Listen, Aktivitäten und Admin laden ihre Daten neu.

Keine separaten Query-Caches pro Seite eingeführt. Bestehender lokaler React-
Daten-, Auswahl-, Dialog- und Formularstate gehört zur verworfenen Workspace-
Instanz. Alte History-Einträge werden nicht umgeschrieben: ein späteres Zurück
auf eine fremde Objekt-ID bleibt zusätzlich serverseitig geschützt. Bootstrap-
Lade-/Fehlerzustände zeigen keine vorherige private Workspaceansicht.

## Tests / Browsernachweise

Abschließend erneut ausgeführte vollständige Backend-Suite: **789 Tests und 1.208 Subtests erfolgreich**, keine Fehler
und keine übersprungenen Tests (180,38 s). Zusätzlich danach ergänzter echter
JPN-Header-End-to-End-Test: **1 erfolgreich** (7,08 s). Damit insgesamt
**790 erfolgreiche Backendfälle**, davon 27 neue PR6-Abnahmefälle.
Echte JPN-Import-/Reimportfälle, AUS-Fixtures, Import-Performance-Budgets und die
bestehenden Quoten-, Unterkunfts-, Preservation-, Split-/Join- und PR4/5-
Isolationsregressionen bestehen. Die acht früheren Fehler bleiben behoben.

Frontend umfasst Store-/Transporttests und den realen API-Service über Vite-SSR:
Single-Event-Auswahl, fehlende/fremde Auswahl, keine First-Event-Heuristik,
A→B→A, alle relevanten Quellen, alte Requests und verspätete Bodies, externe
Cancellation, Schreibblocker, Dirty-/Reviewblocker, Auth-Refresh, FormData,
Downloadpfade sowie Header-/Loading-Rendering. **155 Frontendtests erfolgreich**, keine Fehler oder übersprungenen Tests;
Typecheck erfolgreich und Produktionsbuild erneut erfolgreich (9,10 s).
Backup-Suite: **21 Tests und 14 Subtests erfolgreich** (4,26 s).
Python-Kompilierung und `git diff --check` erfolgreich.

### Reale lokale Chromium-Prüfung

System-Chromium über Playwright, tatsächlicher Vite-Frontendserver und isolierte
Flask-/PostgreSQL-Testdaten, keine produktive URL:
- Einziger freigegebener Event im Hauptheader, Wähler deaktiviert, fremde
  Personen nicht sichtbar; explizite Header bei Personen-, Session-, Upload- und
  Activity-Requests kontrolliert.
- Originale JPN-Dateien im Browser hochgeladen: Preview akzeptiert **64 Personen**.
  Keine Browser-Confirm-Aktion ausgeführt; Confirm/Reimport ist durch die echte
  Backend-Regressionssuite geprüft.
- Import zeigt den zentralen Veranstaltungskontext, keine zweite lokale Eventauswahl.
- Browserrequest mit fremder Event-ID bleibt unter echter Single-Event-Konfiguration 409.
- Light/Dark, 1366×900 und 390×844 geprüft; kein horizontaler Seitenüberlauf.

### Abschließender JPN-HTTP-Full-Flow

Originale JPN-Workbooks über die echten Flask-Routen in isoliertem PostgreSQL:
Upload → Preview → Session-Review → einzelne Approval-Entscheidungen →
FULL_NATION-Freigabe mit gespeichertem Plan-Digest → Confirm → identischer Reimport.
Der neue Test `test_real_jpn_full_http_workflow_with_central_header` verwendet den
zentralen Header bei **allen 9 HTTP-Requests**; alle Antworten 200.
64 Personen nach Erstimport und Reimport, keine doppelten Memberships, keine
Person in Event B; Session und gespeicherte Preview-Versionen gehören Event A.
Die bestehenden PR3-Workflow-Assertions bleiben unverändert wiederverwendet.
Dies ist ein In-Process-HTTP-End-to-End-Test über Flask-Testclient, kein zusätzlicher
interaktiver Browser-Confirm. **Der vollständige interaktive Browserablauf nach
Preview bis Confirm bleibt offen**; der reale Browser-Upload und die getrennten
Wechselprüfungen oben sind erfolgreich. Keine Produktionsdaten verwendet.

### Ausschließlich simuliert autorisierte Wechselprüfung

Für A→B→A wurde nur im Browsertest der Capability-Bootstrap durch einen explizit
freigegebenen Testkatalog ersetzt. Datenrequests wurden anhand des Headers an
**zwei getrennte lokale Backendprozesse** mit jeweils fester A- bzw. B-Konfiguration
geroutet. Beide verwenden dieselbe isolierte Testdatenbank und echte Readmodels.
Kein veränderbarer backendweiter active_event-State, kein Produktionsschalter.

Ergebnisse:
- A→B→A zeigt jeweils die richtigen Personen, keine Cachevermischung;
- ungespeicherter Hotelentwurf bleibt erhalten und verhindert Wechsel;
- tief verlinkter JPN-Import-Review blockiert Wechsel;
- absichtlich verzögerte A-Antwort überschreibt die B-Ansicht nicht;
- 41 kontextbezogene Requests geprüft, keine Browser-JavaScriptfehler.

Nachweise/Logs/Screenshots liegen lokal unter `/tmp/pr6-reports/`, u.a.
`browser-smoke.log`, `browser-switch.log`, `active-event-desktop.png`,
`active-event-narrow.png`, `active-event-dark-narrow.png` und
`active-event-simulated-b.png`; keine Screenshots/Workbooks/DB-Dateien versioniert.
Browser-Harnesses sind lokale Testartefakte; dauerhafte Regressionstests liegen
in den oben genannten Backend-/Frontend-Testdateien.

## Performance und Bestandskompatibilität

Bootstrap einmal je authentifiziertem Workspace, nicht pro Seite/Person/Hotel.
Explizite Header verursachen eine request-lokal wiederverwendete Eventvalidierung;
keine neue pro-Person-/Hotel-Abfrageschleife. Nach einem zulässigen Testwechsel
ist bewusst ein vollständiger Reload der operativen Ansichten vorgesehen.
Keine spekulativen parallelen Prefetches für nicht freigegebene Events.

Keine Modell-/Schema-/Migrationsänderung. Bestehende Hotels, 109 Kontingente,
sieben AccommodationEvents und EventRoomDemand wurden nicht produktiv geöffnet
oder geändert; die synthetischen Bestands-/Integritätstests aus PR4 bestehen.
Unverändert: Import/Reimport, manuelle Preservation, NO_ROOM, STANDARD/SPECIAL,
countsAsSingle einschließlich false, APPROVED_EXTRA, Officials-/EZ-Formeln,
Coverage, Split/Join sowie Audit-/Historienbedeutung.

## Vor einer echten Multi-Event-Freigabe weiterhin erforderlich

- Explizite serverseitige Freigabe mehrerer operativer Events und echte
  benutzerbezogene Eventrechte, geprüft in jedem Lese-/Schreibpfad.
- Gemeinsame Resolver von der festen OPERATIONAL_EVENT_ID-Grenze auf einen
  autorisierten Requesteigentümer umstellen und sämtliche Mutationen erneut prüfen.
- Capability-Bootstrap erst danach erweitern. Nur switchingAllowed=true oder ein
  weiterer Stammdatensatz reicht ausdrücklich nicht.
- Globalen Hotel-/RoomType-/Competition-Katalog und globale technische Administration
  von eventgebundenen Daten weiterhin unterscheiden; gemeinsame physische Räume
  werden nicht automatisch zu geteilten Ressourcen.
- Eventbezogene Rechte-/Widerrufs- und konkurrierende Mehrbenutzerfälle explizit
  testen; keine neue ACL-Datenbank in diesem PR vorwegnehmen.

Keine neue WM-Quote, Eventquotenparameter, Tarife oder Genehmigungsworkflows.
Keine produktive Migration, kein Deployment, kein produktiver Reset oder Neustart.
Commit/Push/PR nur gemäß ausdrücklichem Abschlussauftrag; kein Merge oder Deployment.

## Abschlussreview

`origin/main` erneut abgerufen: unverändert `ad3e9b1`. Keine zusätzlichen
Produktkorrekturen erforderlich; ausschließlich ein ergänzter JPN-Header-
Abnahmetest und dieser aktualisierte Bericht beim Abschluss.
Frontend-/Backup-Suite, Typecheck, Produktionsbuild, Python-Kompilierung und
`git diff --check` erneut erfolgreich. Nur die vorgesehenen 20 Quell-/Test-/
Dokumentationsdateien, keine Datenbanken, Excel-Dateien, lokalen Zugangsdaten
oder produktiven Event-IDs aufgenommen. Vorhandene Deprecation-Warnungen bleiben;
keine Tests deaktiviert. Keine neue Schemaänderung.
