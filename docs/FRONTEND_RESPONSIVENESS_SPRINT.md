# Frontend Responsiveness Sprint

## Messmethode

Als reproduzierbare Ausgangsmessung dient der Vite-Produktionsbuild (`pnpm build`).
Er zeigt, welche JavaScript-Menge vor dem ersten Dashboard-Render heruntergeladen und
ausgewertet werden muss. Die Request-Abhängigkeiten wurden zusätzlich aus dem
Dashboard-Ladepfad abgeleitet; die lokale Umgebung stellt keine repräsentative
Produktionslatenz bereit.

## 1. Initial Bundle und Navigation

- **Ursache:** Alle Seiten, einschließlich der sehr großen Assignment-, Analytics-
  und Import-Oberflächen, wurden synchron vom Router importiert. Damit bezahlte der
  Dashboard-Aufruf die Parse- und Transferkosten jeder späteren Route.
- **Architekturentscheidung:** Das App-Shell, Layout und Dashboard bleiben eager.
  Alle nachgelagerten Seiten werden an der vorhandenen Router-Grenze geladen. Dies
  verändert weder Businesslogik noch API-Verträge oder Workflows.
- **Änderung:** Route Modules verwenden `lazy` und dynamische Imports. Geschützte
  Admin-Seiten laden Route und Guard gemeinsam bei Bedarf.
- **Vorher:** ein JavaScript-Bundle mit **1.477,96 kB** (gzip **420,95 kB**).
- **Nachher:** Der initiale JavaScript-Chunk umfasst **446,01 kB** (gzip
  **144,09 kB**). Das sind **69,8 % weniger** ungepacktes beziehungsweise
  **65,8 % weniger** gzip-komprimiertes JavaScript im initialen Chunk. Die übrigen
  Seiten liegen in separaten, bedarfsgeladenen Chunks; der größte davon ist die
  Analytics-Seite mit 481,99 kB und gehört nicht mehr zum Dashboard-Start.
- **Erwarteter Nutzen:** Der erste Dashboard-Aufruf lädt und verarbeitet keine
  Implementierungen für Athleten, Assignments, Hotels, Events, Import, Analytics,
  Listen, Audit oder Administration. Spätere Navigation lädt nur die gewählte Seite;
  bereits geladene Route Modules bleiben im Browser-Cache.

## 2. Dashboard Critical Path und Ladefeedback

- **Ursache:** Audit-Log und Import-Sessions lagen im selben `Promise.all` wie die
  Daten für die sichtbaren KPIs. Obwohl beide Requests unabhängig und fehlertolerant
  waren, verzögerte der langsamste von ihnen das gesamte Dashboard. Währenddessen
  zeigte die Seite lediglich einen einzelnen pulsierenden Textblock.
- **Architekturentscheidung:** Nur Athleten, Hotels, Zimmertypen, Events und
  Zuweisungen bilden den Critical Path. Audit und Import sind progressive
  Ergänzungen für Bereiche weiter unten und werden unabhängig geladen.
- **Änderung:** Alle sieben Requests starten weiterhin parallel. Das Dashboard wird
  nach Abschluss der fünf operativen Requests freigegeben; Audit und Import
  aktualisieren ihre Bereiche anschließend. Ein layoutnahes Skeleton reserviert
  währenddessen die wichtigsten Flächen und vermeidet einen visuellen Sprung.
- **Vorher:** sichtbares Dashboard nach
  `max(operativ, audit, imports)`; ein generischer Ladeblock.
- **Nachher:** sichtbares Dashboard nach `max(operativ)`; Audit und Import blockieren
  den First Content nicht. Der strukturelle Gewinn entspricht exakt der Zeit, um die
  der langsamste Nebenrequest den langsamsten operativen Request übersteigt
  (`max(0, max(audit, imports) - max(operativ))`). Eine belastbare Millisekundenangabe
  erfordert Produktions-Telemetrie und wird bewusst nicht simuliert.
- **Erwarteter Nutzen:** Schnellere wahrgenommene Dashboard-Bereitschaft bei
  unveränderter Requestanzahl, sofort verständliches Ladefeedback und keine
  State-Updates nach Navigation/Unmount.

## Bewusst unverändert

Gemeinsame Listen, Timeline, Cards, Dialoge, Tabellen, Contexts und fachliche Seiten
wurden nach statischer Prüfung nicht auf Verdacht refaktoriert. Ohne ein gemessenes
Renderproblem wäre Memoisierung dort zusätzliche Komplexität. Virtualisierung,
Backend, API-Verträge und Businesslogik bleiben ausdrücklich unverändert.
