# Assignment-Performance: Diagnose und Zielarchitektur

## Status und Abgrenzung

Dieses Dokument ist eine **Analyse des aktuellen Stands**, kein Optimierungs-PR.
Es wurden weder Businesslogik, API-Verträge, Datenbankabfragen noch React-Komponenten
verändert. Die Aussagen trennen bewusst zwischen:

- **statisch nachgewiesen**: direkt aus Kontrollfluss und Datenstrukturen ableitbar,
- **instrumentierbar**: Messpunkte existieren, es liegt in diesem Repository aber
  kein repräsentativer Produktions-Messlauf vor,
- **Hypothese**: muss mit demselben PostgreSQL-Snapshot, Produktions-Build und Browser
  bestätigt werden.

## Sprint 1: temporäre Messinstrumentierung

Die Diagnoseinstrumentierung ist standardmäßig aktiv und lässt sich ohne Codeänderung
vollständig abschalten:

- Backend: `ASSIGNMENT_PERFORMANCE_ENABLED=false`
- Frontend beim Build: `VITE_ASSIGNMENT_PERFORMANCE=false`

Sie verändert weder Response-Body noch fachlichen Requestablauf. Assignment- und
Quotenrequests liefern `Server-Timing`, `X-Assignment-Query-Count`,
`X-Response-Size` und `X-Assignment-Measurement`; die Header werden auch bei einem
separat gehosteten Frontend über CORS exponiert. Das Serverlog enthält je Request
Methode, Pfad, Gesamt-/DB-/Phasenzeit, Queryanzahl und Responsegröße.

Der Browser misst für Planning, Quoten und Assignment-Mutationen getrennt Zeit bis
zu den Response-Headern, Lesen des Bodys, `JSON.parse`, gesamte Clientzeit und
Payloadbytes. React-Profilergrenzen erfassen Queue, Hotelübersicht, Hoteldetail und
Quotenbereich jeweils mit Commitanzahl, tatsächlicher Renderdauer und Zeit vom
Renderstart bis zum Commit-Zeitpunkt. Nach zwei Animationsframes werden DOM-Knoten,
optionaler Chromium-Heap und Long Tasks zusammen mit den Serverwerten als
`[Assignment Performance]` ausgegeben. Der vollständige Rohwert wird zusätzlich als
Browser-Event `assignment:performance` veröffentlicht.

`performance.memory` und die Long-Tasks-API sind optionale Browser-APIs. Fehlen sie,
bleiben die Heapwerte leer beziehungsweise die Long-Task-Werte bei null; die übrigen
Messungen laufen weiter. Parallel laufende Planning- und Quotenrequests erhalten
jeweils einen eigenen Messbericht. React-Commits innerhalb überlappender
Requestfenster erscheinen bewusst in beiden Berichten, weil beide Requests zu diesem
sichtbaren Commit beitragen können.

Ohne einen solchen Lauf sind exakte Millisekunden, die „teuerste“ SQL-Anweisung und
die Komponente mit der höchsten tatsächlichen Commit-Zeit nicht seriös benennbar.
Die Instrumentierung liefert dafür getrennte Request- und Subtree-Messfenster. Sie
aggregiert bewusst noch keine Durchläufe und ersetzt weder einen identischen
PostgreSQL-Snapshot noch ein kontrolliertes Browserprofil.

## Kurzantwort

Der primäre, statisch nachgewiesene Skalierungsengpass ist der Vertrag von
`GET /api/assignments/planning-view`: Der Server berechnet für **jede Einheit** und
noch einmal für **jede Person als Teilvariante** die Zulässigkeit gegen **jeden
physischen Zimmerslot**, serialisiert die vollständige Matrix und der Client ersetzt
nach fast jeder Mutation den gesamten Planning-Snapshot. Damit wachsen Berechnung,
Payload, JSON-Parsing und React-Arbeit gemeinsam statt unabhängig voneinander.

Die wahrscheinlich zweitgrößte Belastung ist die nicht virtualisierte Warteschlange:
alle gefilterten Einheiten und ihre Personen-Karten bleiben gleichzeitig im DOM.
Bei 1.500 Personen können Eingaben in Suche/Filter den Parent neu rendern und eine
vierstellige Zahl komplexer Karten erneut reconciliieren. Das ist eine belastbare
Code-Hypothese, aber ohne Browserprofil noch kein gemessener Sieger.

Die Datenbank ist für die Planning-View wahrscheinlich **nicht** der dominante Teil:
Personen, Buchungen mit Occupants/Person/Hotel/Zimmertyp sowie Hotels mit Inventar
werden in wenigen eager-loaded Abfragen geladen. Dagegen enthält die separate
Quotenberechnung weiterhin personweise Membership-Abfragen und Relationship-Zugriffe;
sie ist der wichtigste verbliebene N+1-Kandidat und läuft initial, bei jeder
Quotenfilteränderung und parallel nach Assignment-Mutationen.

## 1. Verarbeitete Datenmengen und Komplexität

### Reproduzierbare Simulation

Die Simulation erzeugt deterministisch 1.500 Personen. Davon wünschen 20 Prozent
ein Einzelzimmer. Für die automatische Belegung entstehen nominell etwa 900
Buchungseinheiten (300 Singles plus ungefähr 600 Paare), sofern genügend Inventar
existiert. Die Planning-Projektion gruppiert Personen jedoch anhand des importierten
Partnernamens. Die simulierten Personen besitzen keinen solchen Partnernamen; daher
kann die Planning-View in diesem Datensatz bis zu **1.500 projizierte Einheiten**
erzeugen, auch wenn zwei Personen in derselben Buchung liegen. Dieser Unterschied
muss im Messlauf explizit gezählt werden.

Seien:

- `P` = Personen,
- `U` = projizierte Einheiten,
- `O` = Summe der Personen über alle Einheiten (typisch ungefähr `P`),
- `S` = Summe aller physischen Zimmerslots (`room_count` über Inventare),
- `B` = Buchungen.

Die Response enthält ungefähr:

- `U` vollständige Einheiten und `P` Personenobjekte,
- `S` Slotobjekte, `B` Buchungen und nochmals die zugewiesenen Personenobjekte,
- `(U + O) × S` Validierungsergebnisse, weil pro Einheit und pro einzelner
  Teilvariante alle Slots bewertet werden.

Bei `U = O = 1.500` sind das `3.000 × S` Validierungszeilen. Schon bei 500 Slots
entstehen 1,5 Millionen, bei 1.000 Slots 3 Millionen Ergebnisse. Die Anzahl Hotels
(etwa 100) ist dafür nur ein indirekter Indikator; entscheidend ist die Summe der
Zimmer, nicht die Hotelanzahl. Die tatsächlichen Werte müssen aus dem Response bzw.
per SQL erhoben werden und dürfen nicht aus der Simulationserfolgsmeldung geschätzt
werden.

### Wiederholte Arbeit

- Initial werden Planning-View und die vollständige Athletenliste parallel geladen;
  ein separater Effekt lädt zusätzlich die Quotenansicht.
- Zuweisen, vollständiges Ausbuchen, Teil-Ausbuchen und Änderung des EZ-Status führen
  nach der Mutation jeweils wieder eine vollständige Planning-View und die
  Quotenansicht aus.
- Die Planning-View enthält Personendetails sowohl in Einheiten als auch in
  Buchungs-Occupants. `getAthletes()` liefert dieselben Personen beim Initialladen
  ein weiteres Mal.
- Filterung der Queue ist clientseitig linear in `U`; synchronisierte Hotelfilterung
  traversiert zusätzlich Hotels, Slots, Buchungen und Occupants.
- Quoten-Derivate traversieren die Planning-Hotels mehrfach. `useMemo` verhindert
  dies bei unveränderter Planning-Referenz, aber jeder Full Refresh erzeugt
  erwartungsgemäß neue Referenzen und berechnet alles erneut.

## 2. Backend-Diagnose

### API-Rangfolge (vor dem Messlauf)

1. **Planning-View – sehr hohe Sicherheit.** CPU-Aufwand und Payload werden von der
   kartesischen Validierungsmatrix bestimmt. Die Zeit wächst mit Personen/Einheiten
   *und* Zimmern. JSON-Erzeugung muss Millionen kleiner Objekte materialisieren.
2. **Offizielle Quoten – hohe Sicherheit für unnötige DB-Roundtrips.** Für jede
   gefilterte Person wird mindestens einmal nach einer Membership gesucht; in einem
   zweiten Durchlauf geschieht dies für Personen mit Entitlement erneut. Zugriffe
   auf `room_booking` können weitere Lazy Loads auslösen. Zusätzlich werden Sessions
   und deren Approvals ohne gezielte eager-load-/Aggregationsabfrage traversiert.
3. **Assignment-Mutation – wahrscheinlich kleiner als der anschließende Refresh.**
   Validierung und Speichern betreffen wenige Datensätze. Die Create-Route lädt aber
   alle Buchungen mit Occupants, um eine bestehende identische Belegung zu finden;
   das ist `O(B)` pro Aktion und sollte gemessen werden.
4. **Athletenliste – Payload-Kandidat, aber nicht als langsamer SQL-Kandidat
   nachgewiesen.** Sie dupliziert beim Initialladen Daten, die Planning bereits trägt.

### Datenbank und Indizes

Die Planning-Leseabfragen nutzen eager loading, sodass eine klassische N+1-Kaskade
dort aktuell nicht der Hauptverdacht ist. Für die schreibenden Pfade und Quoten sind
jedoch relevante Fremdschlüsselspalten (`room_booking.hotel_id`,
`room_booking.room_type_id`, `room_booking_occupant.athlete_id` und
`room_booking_occupant.room_booking_id`) im ORM-Modell nicht einzeln indexiert. Ein
Unique Constraint auf dem Occupant-Paar beginnt mit `room_booking_id` und ersetzt
keinen Index für Suchen allein nach `athlete_id`.

Das ist **noch keine Empfehlung, blind Indizes anzulegen**. Zuerst sind für die
langsamsten Requests `EXPLAIN (ANALYZE, BUFFERS)` und die Queryanzahl zu sichern.
Die reine DB-Zeit ist von Python-Objektmaterialisierung und Serialisierung getrennt
zu beurteilen; `Server-Timing db` misst nur Cursor-Ausführung, nicht zwingend die
gesamte ORM-Hydrierung.

### Serialisierung

`jsonify` wird zwar separat zeitlich markiert, die Messgrenze umfasst aber nur den
Aufruf zur Response-Erstellung. Abhängig vom Flask-JSON-Provider findet die konkrete
Byteerzeugung innerhalb dieses Aufrufs statt; Response-Übertragung, Browser-Download,
`response.text()` und `JSON.parse()` fehlen in der Serverphase. Die Header
`X-Response-Size` und `Server-Timing` sind geeignet, Payload und Phasen pro GET zu
erfassen, werden vom aktuellen Browserbericht für GETs aber nicht automatisch
gesammelt.

## 3. Frontend- und Renderdiagnose

### Komponenten mit dem größten erwarteten Renderdruck

Eine tatsächliche Rangliste existiert noch nicht, weil nur der gesamte
`Assignments`-Baum profiliert wird. Aus der Kardinalität folgt diese Messpriorität:

1. **`QueueSidebar` → `QueueUnitCard` → `QueueOccupantActionRow`/`OccupantCard`:**
   rendert alle Treffer ohne Pagination oder Virtualisierung. Pro Karte werden
   Warnungen, Status, Datums-/Personendetails und Aktionsbuttons erzeugt.
2. **`HotelGridView` → `HotelCard`:** alle sichtbaren Hotels werden gemappt; jede
   Karte aggregiert ihre Slots/Buchungen. Bei Drag-State-Änderungen ändern sich
   Props im gesamten Hotelbereich.
3. **`HotelDetailView`:** nur ein Hotel gleichzeitig, aber potenziell alle seine
   Zimmer, Buchungen und Occupants; relevant bei einem Hotel mit großem Kontingent.
4. **`Assignments`:** besitzt fast den gesamten UI-, Filter-, Drag-, Loading- und
   Dialog-State. Jede dieser Änderungen rendert den Parent; nicht memoisierten
   Kindkomponenten werden dabei erneut aufgerufen.

`useMemo` ist für Maps, Filteroptionen, Queue, Hotels und Quotenableitungen bereits
umfangreich vorhanden. Mehr `useMemo`/`useCallback` auf Verdacht löst weder die
DOM-Menge noch den Snapshot-Austausch. Außerdem werden zahlreiche Inline-Callbacks
an Karten übergeben; dadurch würde ein einfaches `React.memo` allein wenig helfen.

### State- und Context-Fluss

- `Assignments` konsumiert Berechtigungen und Routerzustand, aber keinen großen
  globalen Planning-Context. Ein Context-Broadcast ist daher nicht als primärer
  Re-Render-Auslöser nachgewiesen.
- Filter, Auswahl, Drag-Ziele, Saving und Dialoge liegen lokal im Parent. Besonders
  `dragOverHotelId`, `dragOverRoomTypeKey` und `dragOverBookingId` können während
  Pointerbewegungen häufig wechseln.
- `loading`, `saving`, `pendingAction` und `quotaRefreshing` erzeugen mehrere
  absichtliche State-Übergänge pro Aktion. Diese sind semantisch sinnvoll; zu messen
  ist die Kostenwirkung des großen Teilbaums, nicht die bloße Anzahl der Setter.
- Nach jedem Planning-GET ersetzt `setPlanning` den Snapshot. Damit invalidieren alle
  davon abhängigen Memos korrekt. Das ist kein Memo-Fehler, sondern eine Folge des
  grobgranularen Datenvertrags.

## 4. Verbindlicher Messplan vor Umsetzung

### Datensatz und Szenarien

Ein PostgreSQL-Snapshot wird einmal aufgebaut und für alle Läufe unverändert
verwendet. Zu protokollieren sind `P`, `U`, `O`, `S`, `B`, Hotels, Response-Bytes
und Browser-Hardware. Mindestens drei Größen (1.500, 3.000, 5.000 Personen) werden
getestet, damit lineares von multiplikativem Wachstum unterscheidbar wird.

Pro Größe werden mindestens diese Aktionen je zehnmal ausgeführt und **Einzelwerte
statt nur Mittelwerte** gespeichert:

1. kaltes und warmes Öffnen von Assignments,
2. Queue-Suche und jeder Filtertyp,
3. Hotel öffnen und zurück,
4. Drag über mehrere Hotels/Zimmer ohne Drop,
5. Zuweisen, Teil-Ausbuchen, vollständiges Ausbuchen, EZ-Umschalten.

Erfasst werden Median, p95 und Maximum für:

- TTFB, Download, JSON-Parse und Response-Bytes je Request,
- Serverphasen API/DB/Assignment/Rooms/Serialization und Queryanzahl,
- React-Commit-Dauer und Commits pro Interaktion,
- Long Tasks, maximale DOM-Node-Anzahl und Heap vor/nach Refresh,
- `EXPLAIN (ANALYZE, BUFFERS)` der tatsächlich teuersten SQL-Statements.

Für die Render-Rangfolge werden vorübergehend Profiler-Grenzen um Queue, Hotelgrid,
Hoteldetail und Quotenbereich benötigt oder der React DevTools Profiler verwendet.
Das ist Messinstrumentierung für einen separaten Sprint, keine Produktoptimierung.

### Entscheidungsschwellen

- Dominiert `assignment`/`serialization` oder die Response-Größe: zuerst
  Planning-Vertrag und Validierungsarchitektur ändern.
- Dominiert DB bei hoher Queryanzahl: Quoten-N+1 bzw. konkrete Querypläne beheben.
- Ist API schnell, aber Commit/Long Tasks hoch: Queue/Room-Liste virtualisieren.
- Ist nur der Refresh nach Mutationen langsam: Delta-/Revisionsvertrag priorisieren.
- Caching wird nur verfolgt, wenn wiederholte identische Reads einen relevanten
  Anteil haben und Invalidierung eindeutig definiert werden kann.

## 5. Maßnahmen nach erwartetem Nutzen

### Priorität A: Planning-Vertrag zerlegen

**Größter erwarteter Nutzen, mittlere Architekturkomplexität.** Die Übersicht sollte
nur Einheiten, Hotel-/Kapazitätssummen und die für die erste Ansicht nötigen Daten
liefern. Slots/Buchungen werden beim Öffnen eines Hotels geladen. Validierung wird
für die aktuell gezogene/ausgewählte Einheit und relevante Hotel- oder Slotmenge
serverseitig berechnet, nicht für alle denkbaren Kombinationen vorab.

Das ist inkrementelles Laden und serverseitige fachliche Berechnung, keine
Funktionsreduktion: dieselben Informationen bleiben beim Nutzungsmoment verfügbar.
Der Vertrag braucht eine Planning-Revision, damit parallel geladene Ausschnitte und
Mutationen nicht veralten.

### Priorität B: Delta-Response nach Mutationen

**Sehr hoher Nutzen im täglichen Workflow, höhere Konsistenzanforderung.** Mutation
und Response sollten atomar den betroffenen Slot, die betroffenen Einheiten,
Kapazitäts-/Quotenänderungen und eine neue Revision liefern. Nur diese Ausschnitte
werden ersetzt; bei Revisionskonflikt bleibt der Full Refresh als Fallback.

Eine bloße optimistic UI ohne autoritativen Server-Delta ist nicht ausreichend, weil
der Client sonst Assignment-, Datums- und Quotenregeln duplizieren müsste.

### Priorität C: Queue und große Zimmerlisten virtualisieren

**Hoher Frontend-Nutzen bei unverändertem UI.** Windowing hält nur sichtbare Karten
plus Overscan im DOM. Für Drag-and-drop, variable Kartenhöhen, Fokus, Screenreader
und `scrollIntoView` ist ein Prototyp mit Akzeptanztests nötig. Die Hotelliste mit
etwa 100 Karten braucht wahrscheinlich keine Virtualisierung; Hotelzimmer und Queue
sind anhand der Messwerte zu priorisieren.

### Priorität D: Quotenabfragen set-basiert ausführen

**Wahrscheinlich guter Nutzen bei begrenzter Komplexität**, falls Queryzählung die
N+1-Hypothese bestätigt. Memberships/Buchungen und Approvals sollten per eager load,
Join oder Aggregation für den gesamten Filter geladen werden. Erst der Queryplan
entscheidet über konkrete Indizes.

### Priorität E: Caching und Hintergrundberechnung

Caching ist erst nach Verkleinerung des Vertrags sinnvoll. Ein revisionsgebundener,
kurzlebiger Cache kann Hotelübersichten oder Validierung für `(revision, unit,
hotel)` tragen. Globale TTL-Caches ohne revisionssichere Invalidierung sind im
Dispositionbetrieb riskant.

Hintergrundberechnung eignet sich für Vorwärmen oder Statistiken, nicht als Ersatz
für synchrone Prüfung einer Mutation. Web Worker können JSON-Nachverarbeitung vom
Main Thread nehmen, beheben aber weder Netzwerkvolumen noch Serverkomplexität und
sind deshalb keine erste Maßnahme.

### Server-side Filtering und Pagination

Serverseitige Filterung ist für die Queue sinnvoll, sobald die Übersicht nicht mehr
vollständig geladen wird. Cursor-Pagination oder inkrementelles Windowing ist stabiler
als Offset-Pagination bei gleichzeitig laufenden Änderungen. Aktive Auswahl und
Suchtreffer müssen weiterhin direkt adressierbar sein.

Klassische Seitenzahlen sind für die Drag-and-drop-Disposition voraussichtlich
schlechter als Virtualisierung plus serverseitige Suche, weil Ziel und Quelle auf
verschiedenen Seiten verschwinden können. Für auditartige Tabellen wären sie passend,
für das Herzstück Assignments nicht die erste Wahl.

## 6. Ausdrücklich nicht empfohlen

1. **Keine weiteren Memos, Callbacks oder `React.memo` ohne Komponentenprofil.** Das
   reduziert weder Validierungsmatrix noch Payload/DOM und erhöht Prop-Komplexität.
2. **Keine Indizes auf Verdacht.** Sie belasten Writes und lösen Python-/JSON-Kosten
   nicht; Grundlage sind reale Querypläne.
3. **Kein globaler Cache mit TTL als erste Lösung.** Veraltete Zimmer- oder
   Quotendaten sind operativ gefährlicher als eine langsame Ansicht.
4. **Keine vollständige Vorberechnung aller Unit×Slot-Kombinationen im Hintergrund.**
   Sie verschiebt die multiplikative Arbeit nur und erschwert Invalidierung.
5. **Keine reine Client-Nachbildung der Validierungslogik.** Zwei Regelquellen führen
   zu inkonsistenten Zuweisungen.
6. **Keine Web-Worker-/Kompressions-Maßnahme als Primärlösung.** Kompression reduziert
   Transferbytes, nicht Objekterzeugung, Parsing oder fachliche Matrixgröße.
7. **Keine Entfernung von Informationen oder Funktionen.** Lazy Loading und
   Virtualisierung müssen Details, Tastaturbedienung, Fokus und Drag-and-drop
   vollständig erhalten.
8. **Keine klassische Pagination der Dispositionsfläche ohne UX-Prototyp.** Sie kann
   den Kernworkflow verschlechtern und löst den teuren Full-Snapshot allein nicht.

## 7. Empfohlene Sprintfolge

1. **Mess-Sprint:** GET-Korrelation ergänzen, Subtree-Profiler setzen, reproduzierbare
   1.500/3.000/5.000-Matrix ausführen und Rohwerte archivieren.
2. **Backend-Vertrags-Sprint:** Übersicht, Hotel-Detail und On-demand-Validierung als
   revisionierte Reads entwerfen; noch ohne optimistic UI.
3. **Frontend-Sprint:** Queue/Hotelzimmer anhand gemessener DOM- und Commit-Kosten
   virtualisieren und Barrierefreiheit/Drag-and-drop regressionsprüfen.
4. **Mutations-Sprint:** atomare Deltas und Revisionskonflikt-Fallback einführen.
5. **DB-Sprint nur bei Messnachweis:** Quotenabfragen set-basiert machen und gezielte
   Indizes anhand der Produktionspläne ergänzen.

Damit wird zuerst die multiplikative Architekturgrenze beseitigt, danach die
Darstellung skaliert und erst zuletzt lokal optimiert. Bedienbarkeit und fachliche
Autorität bleiben unverändert.
