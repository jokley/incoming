# Operations Lists – Phase A

## Verantwortung und Informationsarchitektur

Operations Lists ist ein generischer, ausschließlich lesender Recherche-Workspace. Er bündelt genau drei Entitäten: **Personen**, **Hotels** und **Kontingente**. Benutzer können Daten suchen, filtern, gruppieren, sortieren, prüfen und nach Excel exportieren. Änderungen erfolgen immer im verantwortlichen Fachmodul: Athleten für Personendaten, Assignments für Dispositionen und Hotels für Hotel- und Kapazitätsdaten.

Ein eigener Aufgaben-Workspace ist bewusst nicht Teil von Phase A. Das fachliche Aufgabenmodell wird erst nach User Testing festgelegt.

## Einheitliches Interaktionsmodell

Jede Entität verwendet dieselbe Toolbar-Reihenfolge: Suche, Gruppierung, fachliche Filter und Excel-Export. Gruppierungen sind keine eigenen Seiten. Bei Personen stehen keine Gruppierung sowie Hotel, Nation, Disziplin und Funktion zur Verfügung. Bewegungen sind kombinierbare Filter nach Richtung und Zeitraum. Redundante Filter werden ausgeblendet, wenn ihr Attribut bereits als Gruppierung gewählt ist.

Der gemeinsame `OperationsSummaryHeader` zeigt konfigurierbare, entitätsspezifische Kennzahlen oberhalb der Tabelle und kann bei Bedarf vollständig ausgeblendet werden. Tabellen, Sticky Header, Sortierung und bestehende Projektionen bleiben erhalten; Phase A führt bewusst keine externe Tabellenbibliothek ein.

## Entitäten

### Personen

Die Personenliste kombiniert Nation, Disziplin, Funktion, Hotel, Workflowstatus, Hinweise, Bewegungsrichtung und Zeitraum. Namen öffnen das Athletenmodul, Zimmer die Disposition und Hotels das Hotelmodul.

### Hotels

Die Hotel Operations List dient dem Vergleich aller Hotels und zeigt Kontakte, Region, HP, SR sowie vorhandene Kapazitätsmetadaten. Sie bleibt read-only; ein Hotel wird im Hotelmodul bearbeitet.

### Kontingente

Die Kontingentliste bietet Gruppierungen nach Hotel, Region und Zimmerart. Ihre Summary verwendet dieselben gefilterten Zeilen wie Tabelle und Excel-Export.

## Deep Links

Der URL-State trennt Entität, Gruppierung und Filter, beispielsweise `/lists?entity=persons&movement=arrival&period=today`. Legacy-Links für Personen, Nationen und die bisherigen Listenarten werden während der Migration weiterhin eingelesen.

Dashboard-Ziele folgen der Modulverantwortung: Dispositionsprobleme öffnen Assignments, Stammdatenprobleme Athleten, Importprobleme Import, kritische Hotels Hotels. Nur Recherchekontexte wie Bewegungen und analytisch identifizierte Personengruppen öffnen vorgefilterte Operations Lists.

## Zukünftige Tabellenevaluation

Die bestehende Tabelle bleibt in Phase A erhalten. Vor einer späteren Migration müssen Column Visibility, Virtualisierung und Performance mit realistischen WM-Datensätzen gemessen werden. Falls die Custom Table an Wartbarkeits- oder Performancegrenzen stößt, ist TanStack Table v8 wegen seiner headless Architektur der bevorzugte Evaluationskandidat; eine Migration ist ausdrücklich nicht Bestandteil dieser Phase.
