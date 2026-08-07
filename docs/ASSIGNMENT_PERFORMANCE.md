# Assignment-Performance-Analyse

## Messung

Jede Assignment-Mutation erzeugt im Browser einen strukturierten Bericht unter
`[Assignment Performance]`. Ausgegeben werden nicht aggregierte Einzelmessungen für
Drop→Request, API, React-Commit, Render-Anzahl, gerenderte Komponenten, Request-Anzahl
und Response-Größe. Der Server liefert pro Request `Server-Timing` für API, DB,
Quote, Zimmerberechnung, Assignment-Logik und Serialisierung sowie
`X-Assignment-Query-Count` und `X-Response-Size`. Zusätzlich schreibt er jede
Einzelmessung als `assignment_performance` in das Serverlog. So bleiben Ausreißer
sichtbar; es werden ausdrücklich nicht nur Durchschnittswerte erfasst.

## Analyse des bisherigen Workflows

Nach jeder Zuweisung, Ausbuchung, Teil-Ausbuchung und EZ-Änderung wurden drei Requests
ausgeführt: Mutation, vollständige `planning-view` und vollständige Quotenansicht.
Die Planning-View lädt und serialisiert erneut alle Hotels, Zimmer/Slots,
Warteschlangen-Einheiten, Assignments und Validierungsmatrizen. Personen werden nur
beim initialen Laden separat geladen. Der teuerste algorithmische Teil ist die
Validierung jeder Einheit (und jeder Teil-Einheit) gegen jeden Slot. Außerdem führte
die Kennzeichnung geänderter, bereits zugewiesener Personen bisher eine zusätzliche
Existenzabfrage pro Person aus (N+1).

## Umgesetzte gezielte Optimierungen

- Die N+1-Existenzabfragen verwenden nun die bereits eager geladenen Buchungen.
- Die Suche nach einer bestehenden Buchung lädt deren Occupants eager und verhindert
  Lazy-Load-Abfragen in der Schleife.
- FIS-Einheiten laden beide Personen in derselben Query. Dadurch entfallen beim
  vollständigen Planning-Refresh bis zu zwei Lazy-Load-Queries pro Einheit.
- Die Quotenberechnung lädt Occupants, Personen und Zimmertyp gemeinsam statt diese
  Beziehungen pro Buchung bzw. Person nachzuladen.
- Buchungen werden einmal nach Hotel/Zimmertyp und nach Slot indiziert. Slot-Aufbau
  und Validierung durchsuchen deshalb nicht mehr für jede Variante erneut sämtliche
  Buchungen. Das Ergebnis und die Reihenfolge der Validierungen bleiben unverändert.
- Planning-Collections behalten bei reinen UI-State-Updates ihre Referenz. Die im
  Profiler sichtbare erneute Berechnung aller Maps, Filteroptionen, Queue-Filter und
  Hotel-Filter entfällt; ein Full Refresh ersetzt die Referenzen weiterhin bewusst.
- Eine sofort sichtbare, barrierearme Fortschrittsanzeige startet synchron mit der
  Aktion und bleibt bis Mutation und konsistentem Refresh sichtbar.
- Der React-Profiler erfasst tatsächliche Commit-Dauern und Komponenten. Weitere
  Memoisierung wurde bewusst nicht spekulativ eingebaut; die Messwerte zeigen künftig,
  welche Teilbäume einen relevanten Nutzen versprechen.

## Vorher-/Nachher-Bericht

Die vorhandene Instrumentierung bleibt die maßgebliche Laufzeitmessung, weil API-,
DB- und Renderzeiten von Datenmenge, Browser und Deployment abhängen. In der
Ausführungsumgebung dieses PRs stehen die Python-Abhängigkeiten nicht zur Verfügung;
deshalb werden keine erfundenen Millisekundenwerte dokumentiert. Der Browser-Event
`assignment:performance` und `Server-Timing` liefern nach Deployment weiterhin für
jede Einzelaktion die folgende direkt vergleichbare Tabelle:

| Messwert | Vorher | Nachher / erwartete nachweisbare Änderung |
| --- | --- | --- |
| API-/Backend-/Gesamtzeit | Instrumentierter Einzelwert | geringer durch weniger DB-Roundtrips und lineare Indizes; vom Datensatz messen |
| DB-Zeit | Instrumentierter Einzelwert | geringer; Personen- und Quoten-N+1 entfallen |
| DB-Queries Planning | Basiswert | Basiswert minus bis zu `2 × Anzahl FIS-Einheiten` |
| DB-Queries Quoten | Basiswert | konstante Eager-Load-Query statt Relationship-Queries je Buchung/Occupant |
| Assignment-Berechnung | Varianten × Slots × alle Buchungen | Varianten × Slots × Buchungen des Slots |
| React-Renderzeit | Profiler-Commit | reine UI-Updates berechnen die Planning-Derivate nicht erneut |
| Requests pro Mutation | 3 | 3 (Mutation, Full Refresh, Quoten; die beiden Reads laufen parallel) |
| React-Commits | unverändert instrumentiert | unverändert; keine Business-/Refresh-Semantik geändert |

Für einen belastbaren Vergleich werden vor und nach Deployment derselbe Drop,
dieselbe Datenbankkopie, derselbe Browser und ein Produktions-Build verwendet. Pro
Durchlauf werden die unaggregierten Browserberichte und die korrespondierenden
`assignment_performance`-Logzeilen gesichert. Das bewahrt Ausreißer und vergleicht
API-, Backend-, DB-, Render- und Gesamtzeit sowie Requests und Re-Renders ohne die
bewusst beibehaltene Full-Refresh-Architektur zu verändern.

## Selektives Reloading und Optimistic UI

Der aktuelle Response der Mutation enthält nur die Buchung, aber keine aktualisierte
Einheit, Slot-Validierungen oder Quoten. Ein rein clientseitiges Partial-Update könnte
daher serverseitige Regeln duplizieren und ist nicht risikofrei. Empfohlene Architektur:

1. Mutation akzeptiert eine Client-Operation-ID und liefert einen atomaren Delta-
   Response mit betroffenem Slot, Einheit, Warteschlangenstatus, Quotenzeilen und
   Detaildaten.
2. Der Client verschiebt beim Drop zunächst nur eine visuelle Schattenkarte und merkt
   sich den unveränderten Snapshot.
3. Bei Erfolg ersetzt der Server-Delta ausschließlich betroffenes Zimmer,
   Warteschlange, Quoten und offenen Detaildialog; bei Fehler wird der Snapshot
   zurückgespielt.
4. Eine versionierte Planning-Revision verhindert, dass parallele Aktionen veraltete
   Deltas anwenden. Bei Versionskonflikt bleibt der vollständige Refresh der sichere
   Fallback.

Damit ist Optimistic UI möglich, ohne Assignment- oder Quotenregeln in den Client zu
verlagern. Bis der Delta-Vertrag existiert, bleibt der konsistente vollständige
Refresh erhalten; das sofortige Feedback verhindert dennoch den Eindruck einer
hängenden Anwendung.
