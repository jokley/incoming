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
- Eine sofort sichtbare, barrierearme Fortschrittsanzeige startet synchron mit der
  Aktion und bleibt bis Mutation und konsistentem Refresh sichtbar.
- Der React-Profiler erfasst tatsächliche Commit-Dauern und Komponenten. Weitere
  Memoisierung wurde bewusst nicht spekulativ eingebaut; die Messwerte zeigen künftig,
  welche Teilbäume einen relevanten Nutzen versprechen.

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
