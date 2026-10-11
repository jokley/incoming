# OperationsTimeline

`OperationsTimeline` ist die generische Standard-Timeline der Anwendung. Sie enthält keine fachliche Hotel-, Event- oder Assignment-Logik.

## Beispiel

```tsx
<OperationsTimeline
  startDate="2027-03-04"
  endDate="2027-03-22"
  rows={rows}
  header={{ title: 'WM 2027', showDateRange: true, showDayCount: true }}
  showTodayMarker
  today={new Date('2027-03-10T00:00:00Z')}
  selectedRowId={selectedRowId}
  selectedSegmentId={selectedSegmentId}
  onRowClick={(row) => setSelectedRowId(row.id)}
  onSegmentClick={(row, segment) => setSelectedSegmentId(segment.id)}
/>
```

## Öffentliche Props

| Prop | Typ | Beschreibung |
| --- | --- | --- |
| `startDate`, `endDate` | `string \| Date` | Sichtbarer Zeitraum; Strings verwenden das Format `YYYY-MM-DD`. |
| `rows` | `TimelineRowData[]` | Darzustellende Zeilen. |
| `legend` | `TimelineLegendItem[]` | Optionale Farblegende. |
| `tickInterval` | `number` | Abstand der Achsenmarken in Tagen (Standard: `2`). |
| `emptyMessage` | `string` | Text bei leerer Timeline. |
| `header` | `TimelineHeaderConfig` | Optionaler Titel sowie Datumsbereich und inklusive Tagesanzahl. |
| `showTodayMarker` | `boolean` | Aktiviert die Heute-Linie. |
| `today` | `TimelineDate \| null` | Von außen injiziertes heutiges Datum. `null` und Werte außerhalb des Zeitraums zeigen keine Linie. |
| `selectedRowId`, `selectedSegmentId` | `string` | Kontrollierte visuelle Auswahl. |
| `onRowClick` | `(row) => void` | Generischer Zeilen-Callback. |
| `onSegmentClick` | `(row, segment) => void` | Generischer Segment-Callback. |
| `ariaLabel` | `string` | Zugänglicher Name der Timeline. |

## Datenmodell

Eine `TimelineRowData` benötigt `id` und `title`. Optional sind `subtitle`, `badges`, `status`, `description`, `ariaLabel` und `tooltipData`. Für einen einzelnen Zeitraum können `start`, `end`, `color` und `progress` direkt auf der Zeile stehen. Mehrere Zeiträume werden als `segments` angegeben.

Ein `TimelineSegment` benötigt `id`, `start` und `end`. Optional sind `label`, `color`, `progress`, `status`, `ariaLabel` und `tooltipData`. `progress` liegt zwischen 0 und 100. Daten außerhalb des sichtbaren Bereichs werden visuell abgeschnitten.

`TimelineTooltipData` steuert `title`, `subtitle`, `start`, `end`, `duration`, `badges`, `status` und `description`. Segmentwerte überschreiben Zeilenwerte; fehlende Daten werden generisch aus Zeile und Segment abgeleitet. Das bestehende `tooltip: ReactNode` bleibt als vollständiger Custom-Override kompatibel.

Klickbare Zeilen und alle Segmente sind per Tab erreichbar. Enter beziehungsweise Leertaste aktiviert Zeilen; Segment-Buttons verwenden das native Tastaturverhalten. Auswahl und Fokus werden unabhängig voneinander dargestellt.
