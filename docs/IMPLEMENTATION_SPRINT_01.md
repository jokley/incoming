# Umsetzungssprint 01 – handlungsorientierte KPI-Karte

## Problem

Operative Kennzahlen wurden in zwei ähnlich aussehenden, aber getrennten
Kartenmustern dargestellt. Die Karten benannten einen Wert und einen Hilfstext,
Zeitbezug und nächster Schritt waren jedoch weder Bestandteil des gemeinsamen
Komponentenvertrags noch durchgängig sichtbar.

## Ursache

`MetricCard` war als generische Statistik-Karte definiert. Die Übersicht führte
deshalb eine lokale `KpiCard` ein. Deren freie Eigenschaften `helper` und `trend`
konnten fachlich sowohl Erklärung, Status als auch Handlung bedeuten. Damit ließ
sich die KPI-Darstellungsregel der Informationsarchitektur nicht verlässlich am
gemeinsamen Muster umsetzen.

## UX-Entscheidung

Die bestehende `MetricCard` wird evolutionär erweitert, nicht neu gestaltet. Sie
erhält die eindeutigen Angaben `context` für Zeit- beziehungsweise Datenbezug,
`action` für Priorität oder nächsten Schritt und `href` für den versprochenen
Arbeitskontext. Die bisherigen Eigenschaften bleiben kompatibel, damit keine
große Seitenmigration entsteht.

Die Leitfrage der Übersicht „Was muss ich heute wissen und tun?“ wird besser
beantwortet, weil jede Kennzahl nun Wert, aktuellen Bezug und Arbeitspriorität
zusammen zeigt. Dadurch wird die Entscheidung schneller, ob ein Fall sofort,
heute oder nur beobachtend bearbeitet werden muss.

## Umsetzung

- `MetricCard` unterstützt nun Zeit-/Datenkontext, Handlungsstatus, Icon und
  Deep Link in einem gemeinsamen Vertrag.
- Der kompakte Darstellungsmodus bewahrt Abstände, Dichte und Blickführung der
  bisherigen Übersichtskarten.
- Die lokale KPI-Karte der Übersicht wurde entfernt und die erste KPI-Reihe auf
  die gemeinsame Komponente umgestellt.
- Die bestehenden Deep Links bleiben unverändert und führen weiterhin direkt in
  die gefilterten Arbeitskontexte.

## Nutzen

Die fünf wichtigsten operativen Kennzahlen können ohne Interpretation eines
unspezifischen Hilfstexts nach `Sofort`, `Heute`, `Beobachten` und abgeschlossenem
Zustand unterschieden werden. Farbe bleibt dabei nicht die einzige
Statusinformation. Der nächste Schritt bleibt mit genau einem Klick erreichbar.

## Betroffene gemeinsame Komponenten

- `MetricCard` im Operations Design System.
- Indirekt die bereits von `MetricCard` verwendeten gemeinsamen Muster
  `ContentCard` und `StatusChip`; deren Verhalten bleibt unverändert.

## Automatisch profitierende Seiten

- **Übersicht:** verwendet den neuen Vertrag unmittelbar für die erste KPI-Reihe.
- **Analytics:** bestehende Kennzahlkarten bleiben kompatibel und können in einem
  späteren, separat prüfbaren Sprint denselben Kontext-/Aktionsvertrag nutzen,
  ohne eine weitere Kartenvariante einzuführen.

## Bewusst unveränderte Bereiche

- Die Bereiche „Heute“, kritische Hinweise, Hotelübersicht, Importstatus und
  Aktivitäten wurden nicht verändert.
- Zuweisungsqueue, synchronisierte Hotelansicht und Workflowfilter bleiben
  unangetastet.
- Importworkflow, Listenprinzip, operative Hotelfilter, Navigation, Backend,
  APIs, Businesslogik und Performancearchitektur bleiben unverändert.
- Die Doppelung zwischen KPI-Reihe und „Heute“ wird gemäß Umsetzungsrahmen erst
  nach Vereinheitlichung der gemeinsamen KPI-, Status- und Deep-Link-Muster in
  einem eigenen Sprint bearbeitet.
