# Assignment-Performance: Diagnose und Zielarchitektur

## Status und Abgrenzung

Dieses Dokument ist eine **Analyse des aktuellen Stands**, kein Optimierungs-PR.
Es wurden weder Businesslogik, API-Verträge, Datenbankabfragen noch React-Komponenten
verändert. Die Aussagen trennen bewusst zwischen:

- **statisch nachgewiesen**: direkt aus Kontrollfluss und Datenstrukturen ableitbar,
- **gemessen**: mit der reproduzierbaren Simulation von 1.500 Personen erhoben,
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

Der vorliegende Lauf liefert eine belastbare Größenordnung, aber noch keine p95-
Verteilung. Die Instrumentierung stellt getrennte Request- und Subtree-Messfenster
bereit, aggregiert bewusst keine Durchläufe und ersetzt für Folgemessungen weder
einen identischen PostgreSQL-Snapshot noch ein kontrolliertes Browserprofil.

## Messergebnis: 1.500 Personen

| Request / Phase | Messwert |
| --- | ---: |
| Planning View – Client gesamt | 23,6 s |
| Planning View – Server gesamt | 18,6 s |
| Planning View – Datenbank | 50 ms |
| Planning View – Serialisierung | 3,4 s |
| Planning View – Payload | 148 MB |
| Planning View – `JSON.parse` | 624 ms |
| Planning View – Netzwerk/Body Read | 3,9 s |
| Official Quotas – Client gesamt | 19,4 s |
| Official Quotas – Server gesamt | 19,3 s |
| Official Quotas – Datenbank | 17,6 s |
| Official Quotas – SQL-Queries | 1.889 |

Die React-Commit-Zeiten von Queue und Hotelübersicht waren im selben Lauf
unkritisch. Damit sind die folgenden Aussagen Architekturentscheidungen auf Basis
dieser Messung und nicht mehr nur statische Hypothesen. Für belastbare p95-Werte und
die Skalierung bis 5.000 Personen bleibt die dokumentierte Messmatrix erforderlich;
die Größenordnung und die Trennung der Engpässe sind bei 1.500 Personen jedoch
bereits eindeutig.

## Official-Quotas-Optimierung

Dieser isolierte Sprint ändert ausschließlich den internen Datenzugriff von
`GET /api/fis/official-quotas`. API-Pfad, Filterparameter, Response-Struktur,
Sortierung und Quotenregeln bleiben unverändert.

### Vorher/Nachher

| Messwert | Vorher, Simulation 1.500 | Nachher |
| --- | ---: | ---: |
| SQL-Queries | 1.889 | höchstens 3 |
| Serverzeit | 19,3 s | im Zielsystem erneut zu messen |
| Datenbankzeit | 17,6 s | im Zielsystem erneut zu messen |
| Payloadgröße | unverändert zu erwarten | mit identischem Snapshot zu verifizieren |
| Response | Referenz | per Regressionstest fachlich identisch abgesichert |

Die neue Queryanzahl ist strukturell unabhängig von der Personenzahl: eine Query
lädt den gefilterten Roster, eine Query alle zugehörigen Booking-Memberships samt
persistiertem `counts_as_single` und eine Query alle Approval-Daten samt
Session-Schlüssel. Bei einem leeren Roster entfällt die Membership-Query.

Die gemessenen Nachher-Zeiten werden bewusst nicht aus der Queryreduktion geschätzt.
In dieser Entwicklungsumgebung steht weder der 1.500-Personen-PostgreSQL-Snapshot
noch die zugehörige Deployment-/Netzwerkkonfiguration zur Verfügung. Der verbindliche
Nachher-Lauf verwendet deshalb denselben Snapshot und dieselbe Instrumentierung wie
die Baseline und ergänzt erst dann Serverzeit, DB-Zeit und Payloadbytes in der
Tabelle.

### Technische Entscheidung

Die bisherige Schleife führte pro Official eine Membership-Abfrage aus und für
Personen mit Einzelzimmeranspruch ein zweites Mal. Zusätzlich löste der Zugriff auf
`membership.room_booking` Lazy Loads aus. Die Implementierung lädt nun alle
Membership-/Booking-Paare in einem geordneten Set und baut daraus eine
`athlete_id → counts_as_single`-Map. Bei inkonsistenten Legacy-Daten mit mehreren
Memberships gewinnt weiterhin die erste Membership; die Ordnung wird jetzt explizit
über deren Primärschlüssel stabilisiert.

Approvals werden ebenfalls in einer einzigen Join-Abfrage mit Nation und Disziplin
der Session geladen. Die bestehende Python-Quotenberechnung, Gender-Normalisierung,
Entitlement-Auswertung und Statusbildung bleiben unangetastet. Es wurde kein Index
ergänzt: Nach der Reduktion auf höchstens drei Queries gibt es ohne realen
`EXPLAIN (ANALYZE, BUFFERS)`-Nachweis keinen Grund für zusätzliche Write-Kosten.

## Aktualisierte Architekturentscheidung

### Kurzantwort

Der größte strukturelle Engpass ist bestätigt: der Vertrag von
`GET /api/assignments/planning-view`: Der Server berechnet für **jede Einheit** und
noch einmal für **jede Person als Teilvariante** die Zulässigkeit gegen **jeden
physischen Zimmerslot**, serialisiert die vollständige Matrix und der Client ersetzt
nach fast jeder Mutation den gesamten Planning-Snapshot. Damit wachsen Berechnung,
Payload und Netzwerk gemeinsam statt unabhängig voneinander. Von 18,6 Sekunden
Serverzeit entfallen nur 50 Millisekunden auf SQL und 3,4 Sekunden auf
Serialisierung. Rund 15,15 Sekunden liegen damit in der übrigen serverseitigen
Projektion und Validierungsarbeit. Die 148-MB-Response verursacht zusätzlich
3,9 Sekunden Transfer und 624 Millisekunden Parsing.

Die Quotenansicht ist ein **separater Datenbankengpass**: 17,6 von 19,3 Sekunden
Serverzeit und 1.889 Queries bestätigen das N+1-Verhalten. Es wäre falsch, aus der
schnellen Planning-Datenbankzeit abzuleiten, dass Datenbankarbeit insgesamt
unkritisch ist; die beiden Endpunkte benötigen unterschiedliche Lösungen.

Die ursprüngliche Frontend-Priorität wird dagegen widerlegt: React-Commit-Zeiten,
Queue und Hotelübersicht sind bei 1.500 Personen nicht relevant. Virtualisierung,
zusätzliche Memoisierung und Komponentenrefactorings würden derzeit nicht den
gemessenen kritischen Pfad verbessern.

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

## 2. Backend-Diagnose nach dem Messlauf

### Planning View

Die Datenbank ist mit 50 Millisekunden weder Optimierungsziel noch Erklärung für
18,6 Sekunden Serverzeit. Auch die isolierte Optimierung der Serialisierung würde
höchstens den gemessenen 3,4-Sekunden-Anteil adressieren. Der dominante Anteil ist
die Materialisierung der Planning-Projektion einschließlich der vollständigen
Validierungsmatrix. Diese Diagnose passt zur statisch ermittelten Komplexität
`(U + O) × S` und wird durch die 148-MB-Response bestätigt.

Die Phasen sind nicht vollständig additiv als CPU-Profil zu interpretieren; aus den
vorliegenden Messgrenzen ergibt sich aber eine belastbare Obergrenze: Nach Abzug von
DB und Serialisierung verbleiben rund 15,15 Sekunden Serverzeit. Vor der Umsetzung
wird dieser Anteil im Planning-Contract-Sprint noch in Projektion und Validierung
getrennt, damit der Vorher-/Nachher-Nachweis eindeutig bleibt.

### Official Quotas

Bei Official Quotas erklären 17,6 Sekunden Datenbankzeit fast die gesamten
19,3 Sekunden Serverzeit. 1.889 Queries bei 1.500 Personen zeigen personabhängige
Roundtrips statt einer konstanten set-basierten Abfrage. Hier ist kein neuer
API-Vertrag erforderlich: Datenzugriff und Aggregation können intern geändert und
gegen denselben Response verglichen werden.

### Datenbank und Indizes

Planning und Quoten dürfen nicht gemeinsam als „Datenbankproblem“ behandelt werden.
Für Planning wäre eine breite Indexkampagne wirkungslos. Für Quoten werden zuerst die
N+1-Roundtrips entfernt; erst anschließend entscheiden die verbleibenden Querypläne
über gezielte Indizes. Damit wird vermieden, 1.889 schlechte Einzelabfragen lediglich
schneller auszuführen.

## 3. Frontend-Diagnose nach dem Messlauf

Die getrennten Profilergrenzen zeigen keine relevanten Commit-Kosten für Queue und
Hotelübersicht. Der Browser wartet überwiegend auf Server, Transfer und Parsing;
React ist bei 1.500 Personen nicht der kritische Pfad. Die bestehende lokale
State-Struktur und die Anzahl der Setter rechtfertigen daher aktuell weder ein
Refactoring noch zusätzliche Memoisierung.

`JSON.parse` benötigt 624 Millisekunden und ist damit messbar, aber gegenüber
23,6 Sekunden Clientgesamtzeit sekundär. Ein Web Worker würde höchstens diesen
Teil verschieben und die 148-MB-Allokation nicht beseitigen. Die richtige
Frontendmaßnahme ist deshalb zunächst, einen wesentlich kleineren Read-Vertrag zu
konsumieren, nicht denselben Full Snapshot anders zu verarbeiten.

Virtualisierung bleibt eine mögliche spätere Skalierungsmaßnahme für 3.000–5.000
Personen. Sie wird erst priorisiert, wenn erneute Profiler-, DOM-, Heap- oder
Long-Task-Messungen einen Frontendengpass zeigen. Für den nächsten Sprint ist sie
aufgrund der Messwerte ausdrücklich zurückgestellt.

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

Für Folgeläufe bleiben die vorhandenen Profiler-Grenzen um Queue, Hotelgrid,
Hoteldetail und Quotenbereich aktiv; für eine tiefergehende Ursachenanalyse kann
ergänzend der React DevTools Profiler verwendet werden.

### Entscheidungsschwellen

- Dominiert `assignment`/`serialization` oder die Response-Größe: zuerst
  Planning-Vertrag und Validierungsarchitektur ändern.
- Dominiert DB bei hoher Queryanzahl: Quoten-N+1 bzw. konkrete Querypläne beheben.
- Ist API schnell, aber Commit/Long Tasks hoch: Queue/Room-Liste virtualisieren.
- Ist nur der Refresh nach Mutationen langsam: Delta-/Revisionsvertrag priorisieren.
- Caching wird nur verfolgt, wenn wiederholte identische Reads einen relevanten
  Anteil haben und Invalidierung eindeutig definiert werden kann.

## 5. Neu priorisierte Maßnahmen

### Größter Architekturhebel: Planning-Read-Modell zerlegen

Der größte absolute Gewinn kommt nicht aus einer schnelleren SQL-Abfrage, einem
zusätzlichen Index oder React-Tuning, sondern aus dem Entfernen der vollständigen
`(U + O) × S`-Validierungsmatrix aus dem initialen Planning-Response.

Die Zielarchitektur besteht aus drei revisionierten, fachlich autoritativen Reads:

1. **Planning-Übersicht:** Einheiten, Hotel-/Kapazitätssummen und die Daten der
   initial sichtbaren Arbeitsfläche. Keine vollständige Slot-Validierungsmatrix.
2. **Hotel-Detail:** Slots und Buchungen genau des geöffneten Hotels. Dadurch werden
   nicht gleichzeitig alle Zimmer aller Hotels übertragen.
3. **On-demand-Validierung:** Zulässigkeit nur für die aktuell ausgewählte oder
   gezogene Einheit gegen das relevante Hotel beziehungsweise dessen Slots. Die
   Regeln bleiben ausschließlich auf dem Server.

Diese Zerlegung adressiert gleichzeitig den ungefähr 15,15 Sekunden großen
Berechnungsanteil, den 3,4-Sekunden-Serialisierungsanteil und einen Großteil der
148-MB-Payload. Deshalb ist sie der wirkungsvollste Architekturbaustein. Der erste
vertikale Schnitt muss eine deutliche, gemessene Größenreduktion gegenüber der
148-MB-Baseline zeigen; ein verbindliches Byte- und Zeitbudget wird erst anhand des
Prototyps mit identischem Datensatz festgelegt.

Eine Planning-Revision ist Bestandteil des Vertrags, nicht optionale Zusatztechnik.
Sie verhindert, dass parallel geladene Hotel-Details oder Validierungen nach einer
Zuweisung auf einem veralteten Stand angewendet werden.

### Erster Umsetzungsschritt: Quoten-N+1 eliminieren

Obwohl der Planning-Vertrag den größten Architekturgewinn verspricht, sollte die
Quotenabfrage als **erster kleiner Implementierungssprint** umgesetzt werden. Die
Messung ist eindeutig (1.889 Queries, 17,6 Sekunden DB-Zeit), der fachliche Vertrag
kann unverändert bleiben und die Komplexität ist deutlich niedriger als bei der
Planning-Zerlegung.

Der Sprint soll Memberships, Buchungen und Approvals set-basiert laden beziehungsweise
aggregieren. Konkrete Indizes werden nur anhand von `EXPLAIN (ANALYZE, BUFFERS)` der
resultierenden wenigen Queries ergänzt. Akzeptanzkriterien sind identische
Quotenresultate, eine konstante beziehungsweise kleine Queryanzahl unabhängig von
der Personenzahl und ein Vorher-/Nachher-Lauf mit demselben Snapshot.

Diese Reihenfolge ist kein Widerspruch: **größter Architekturhebel** ist die
Planning-Zerlegung; **bestes erstes Kosten-Nutzen-Paket** ist die Quotenabfrage.

### Danach: Planning-Vertrag als vertikaler Schnitt

Der zweite Umsetzungssprint liefert zunächst nur Übersicht und Hotel-Detail mit
Revision. Der bestehende Full Read bleibt während der Migration als Vergleichs- und
Fallbackpfad verfügbar. Erst wenn Response-Größe, Serverphasen und fachliche
Gleichheit belegt sind, folgt die On-demand-Validierung. So wird nicht gleichzeitig
Backendvertrag, gesamter Clientzustand und Mutationsmodell umgestellt.

### Später: Delta-Response nach Mutationen

Mutation-Deltas bleiben architektonisch sinnvoll, sind aber nicht der erste Schritt.
Solange jeder Mutationsabschluss den 23,6-Sekunden-Full-Refresh auslöst, würden sie
einen hohen Nutzen haben; ein sicherer Delta-Vertrag benötigt jedoch dieselbe
Revisionierung und dieselben feingranularen Ressourcen wie das neue Read-Modell.
Deshalb folgt er **nach** der Planning-Zerlegung und verwendet deren Verträge, statt
eine parallele Übergangsarchitektur zu schaffen.

### Aufgrund der Messung zurückgestellt

- **Virtualisierung von Queue und Hotelübersicht:** Commit-Zeiten sind unkritisch.
  Erneut bewerten erst bei höheren Datenmengen, auffälligen Long Tasks oder stark
  wachsender DOM-/Heap-Nutzung.
- **Zusätzliche Memoisierung, `React.memo` und Callback-Refactorings:** kein
  gemessener React-Engpass; aktuell nur Komplexität ohne relevanten Gewinn.
- **Server-side Filtering und Pagination:** nicht nötig, um die aktuell gemessenen
  148 MB zu lösen; diese stammen primär aus Slots und Validierungen. Als spätere
  Skalierungsgrenze für 3.000–5.000 Einheiten erneut messen.
- **Caching:** würde 18,6 Sekunden Berechnung nur verdecken und erfordert schwierige
  Invalidierung. Erst nach einem kleinen, revisionierten Read-Modell prüfen.
- **Hintergrundberechnung/Web Worker:** verschiebt die falsche Arbeit. `JSON.parse`
  kostet 624 Millisekunden, nicht 23,6 Sekunden; die Payload darf nicht dauerhaft
  148 MB groß bleiben.
- **Kompression als Hauptmaßnahme:** kann die 3,9 Sekunden Transfer reduzieren,
  beseitigt aber weder serverseitige Matrixberechnung noch Serialisierung und
  Browserobjekte.
- **Breite Indexkampagne:** Planning verbringt nur 50 Millisekunden in der DB.
  Indizes sind ausschließlich Teil der gezielten Quoten-Queryarbeit.

## 6. Gegenüber der ursprünglichen Diagnose

### Bestätigt

1. Die vollständige Unit-/Teilunit-×-Slot-Matrix ist die zentrale Skalierungsgrenze
   der Planning-View.
2. Der Full-Snapshot koppelt Berechnung, Serialisierung, Transfer und Parsing.
3. Die Quotenberechnung enthält ein relevantes N+1-Problem.
4. Blindes Caching, Client-Regelduplikation und klassische Pagination bleiben keine
   geeigneten Primärlösungen.

### Präzisiert

1. „Backend“ ist kein einheitlicher Flaschenhals: Planning ist überwiegend Python-
   Projektion/Validierung, Quoten sind überwiegend Datenbank-Roundtrips.
2. Serialisierung ist mit 3,4 Sekunden relevant, aber nicht isoliert zu optimieren.
   Sie ist eine Folge der Matrixgröße und verschwindet weitgehend mit dem kleineren
   Vertrag.
3. Netzwerk ist mit 3,9 Sekunden relevant, aber ebenfalls Symptom der 148-MB-
   Response. Kompression allein wäre daher nur Schadensbegrenzung.
4. `JSON.parse` ist mit 624 Millisekunden sichtbar, aber kein Primärengpass.

### Widerlegt

1. Queue und Hotelübersicht sind bei 1.500 Personen kein relevanter Renderengpass.
2. Virtualisierung ist für den nächsten Sprint nicht gerechtfertigt.
3. Zusätzliche `useMemo`-/`useCallback`-/`React.memo`-Arbeit hat derzeit keine
   messbare Priorität.

## 7. Verbindliche Sprintfolge

1. **Quoten-Query-Sprint (implementiert):** N+1 set-basiert eliminiert; identische
   Fachresultate und höchstens drei Queries sind regressionsgesichert. Server- und
   DB-Nachher-Zeit werden mit dem unveränderten 1.500-Personen-Snapshot ergänzt.
2. **Planning-Contract-Sprint:** revisionierte Übersicht und Hotel-Detail als
   vertikalen Schnitt einführen; Payload und Serverphasen gegen die Baseline messen.
3. **Validation-Sprint:** Validierungen für aktive Einheit und relevanten Zielbereich
   on demand liefern; vollständige Matrix erst nach Gleichheitsnachweis entfernen.
4. **Mutation-Sprint:** atomare, revisionierte Deltas auf Basis derselben Ressourcen;
   Full Refresh als Konflikt-Fallback beibehalten.
5. **Skalierungs-Recheck:** 1.500/3.000/5.000 Personen erneut messen. Nur wenn DOM,
   Heap, Long Tasks oder Commits dann relevant werden, Virtualisierung beziehungsweise
   serverseitige Queue-Filterung einplanen.

Vor jedem Sprint bleibt die bestehende Funktionalität Referenz. Keine Information
wird entfernt; sie wird bei Bedarf über fachlich konsistente, revisionierte Reads
geladen. Diese Entscheidung optimiert zuerst die beiden gemessenen Engpässe und
stellt alle nicht belegten Frontendmaßnahmen bewusst zurück.
