# Global Performance & Shared Components Sprint

## Messmethode und Priorisierung

Phase 1 konzentriert sich auf die gemeinsamen Read Models für Hotels, Personen,
Dashboard, Listen und Analytics. Die UI und die fachlichen Ergebnisse bleiben
unverändert. Als erste Änderung wurde bewusst nur der Datenzugriff und danach,
separat messbar, die gemeinsame Listenprojektion angepasst.

## Optimierung 1: gemeinsame Backend-Read-Models

- **Flaschenhals:** Die Hotel-, Event- und Personen-Endpunkte serialisierten
  Beziehungen, die vorher lazy geladen wurden.
- **Ursache:** Bei Hotels entstand eine zusätzliche Abfrage je Hotel sowie je
  noch nicht geladener Zimmerart. Die Assignment-Zusammenfassung der Personen
  konnte außerdem Person, Hotel und Zimmerart je Belegungszeile nachladen.
- **Architekturentscheidung:** Die bestehenden API-Verträge bleiben erhalten.
  `selectinload` lädt Collections in einer separaten Mengenabfrage;
  `joinedload` lädt die jeweils skalaren Beziehungen in derselben Abfrage. Das
  ist kleiner und risikoärmer als ein neuer, seitenspezifischer Endpunkt.
- **Änderung:** Die drei gemeinsam genutzten Projektionen deklarieren ihren
  vollständigen Ladeplan nun explizit.
- **Vorher/Nachher:** Die Abfragekomplexität des Hotel-Endpunkts sinkt von
  `2 + H + I` im Worst Case (Hotels, Inventare und Zimmerarten) auf konstant
  **2 Abfragen**. Die Belegungsbeziehungen der Personenprojektion sinken von bis
  zu `1 + 4 × O` auf **1 Abfrage** (`O` = Belegungszeilen). Ein Laufzeitvergleich
  benötigt eine konfigurierte PostgreSQL-Testdatenbank; diese stand in der
  Sprint-Umgebung nicht zur Verfügung.
- **Einfluss:** Dashboard, Hotels, Listen und Analytics teilen die
  Hotelprojektion; Dashboard, Athleten, Listen und Analytics teilen die
  Personenprojektion. Events bleibt wegen der kleinen Datenmenge bewusst ohne
  weitere Seitenoptimierung, profitiert aber ebenfalls vom festen Ladeplan.

## Optimierung 2: gemeinsame Listenprojektionen

- **Flaschenhals:** `createContingentRows` filterte für jedes Inventar erneut
  alle Buchungen. Auch die Personenliste durchsuchte Inventare wiederholt.
- **Ursache:** Die Projektionen hatten quadratische Arbeit
  (`Inventare × Buchungen`) statt eines gemeinsamen Lookup-Indexes.
- **Architekturentscheidung:** Ein einmaliger Index nach
  `hotelId/roomTypeId` wird innerhalb der bestehenden, wiederverwendbaren
  Projektionen aufgebaut. Es gibt keinen Cache und damit kein
  Invalidierungs- oder Stale-Data-Risiko.
- **Änderung:** Kontingent- und Personenprojektion verwenden denselben
  linearen Lookup-Ansatz; Filter-, Sortier-, Export- und UI-Verhalten bleiben
  unverändert.
- **Vorher/Nachher:** Ein reproduzierbarer Node-Mikrobenchmark mit 500 Hotels,
  je 10 Inventaren und 10.000 Buchungen (Warm-up, 10 Läufe, Median) sank von
  **389,19 ms auf 2,45 ms** für die Kontingent-Zuordnung, also um rund **99,4 %**.
- **Einfluss:** Die Hotelkontingentliste profitiert direkt. Personen je Hotel,
  Personen je Nation und deren Excel-Projektionen profitieren vom indexierten
  Inventar-Lookup.

## Bewusst nicht umgesetzt

- Kein globaler Frontend-Response-Cache: Ohne durchgängige Invalidierung nach
  Import, Administration und Assignment-Mutationen wäre der Geschwindigkeitsgewinn
  mit einem fachlichen Stale-Data-Risiko erkauft.
- Keine Virtualisierung oder Dialog-Mikrooptimierung: Für diese Komponenten
  wurde in dieser Phase kein belegter Flaschenhals festgestellt.
- Keine seitenbezogenen Änderungen an Events oder Administration: geringe
  Datensatzanzahl beziehungsweise kein gemessener gemeinsamer Hebel.
- Das Vite-Bundle-Warning wird als Kandidat für eine eigene Messung der
  Initialnavigation dokumentiert. Code-Splitting wurde nicht zusammen mit den
  Read-Model-Änderungen eingeführt, damit Wirkung und Risiko getrennt bleiben.
