# Trennung von FIS- und internen Athletenbemerkungen

## Problem

`Athlete.additional_items` wird aus der FIS-Spalte `Additional_items` importiert und bei jedem Import aktualisiert. Die bisherige Oberfläche verwendete denselben Wert zugleich als editierbare operative Bemerkung. Damit waren extern verwaltete Stammdaten und dauerhaft benötigte Hinweise des Unterkunftsteams weder hinsichtlich ihrer Quelle noch ihrer Lebensdauer eindeutig.

## Architekturentscheidung

Die beiden Verantwortlichkeiten werden getrennt:

- **Bemerkung Athlet** (`additional_items`) bleibt FIS-Stammdatum, ist in der Oberfläche schreibgeschützt und wird ausschließlich durch den Import aktualisiert.
- **Bemerkung Intern** (`internal_note`) gehört dem Unterkunftsteam, ist editierbar und wird vom Importpfad weder gelesen noch geschrieben.

Bestehende `additional_items`-Werte werden nicht verschoben oder verändert, weil sich importierte Inhalte nicht zuverlässig von möglicherweise zuvor manuell interpretierten Inhalten unterscheiden lassen. So bleiben sämtliche Bestandsdaten erhalten, ohne FIS-Daten nachträglich als interne Aussage umzudeuten.

## Umsetzung

### Backend und Migration

Die Athlete-Tabelle erhält eine nullable `TEXT`-Spalte `internal_note`. Die additive Migration verändert keine bestehende Spalte und keine vorhandenen Werte. `Athlete.to_dict()` liefert beide Bemerkungen getrennt.

### API

Die Athlete-Ressource unterstützt Detail-`GET` sowie `PUT` und `PATCH` für Anreise, Abreise und `internalNote`. Schreibversuche auf `additionalItems` werden abgewiesen, damit die Eigentümerschaft des FIS-Imports auch serverseitig garantiert ist.

### Frontend

Der Athletendialog zeigt `additionalItems` als schreibgeschützte **Bemerkung Athlet** im FIS-Bereich. **Bemerkung Intern**, Anreise und Abreise werden gemeinsam gespeichert. Die globale Personensuche berücksichtigt beide Texte.

### Listen, Filter und Export

**Personen je Hotel** und **Personen je Nation** zeigen beide Bemerkungen gleichzeitig. Die Volltextsuche berücksichtigt beide Werte; zwei zusätzliche Filter ermöglichen ihre unabhängige Eingrenzung. Der Excel-Export enthält die Spalten **Bemerkung Athlet** und **Bemerkung Intern** in dieser Reihenfolge.

## Nutzen

Die klare Datenhoheit verhindert, dass ein FIS-Import operative Teamhinweise überschreibt oder manuelle Eingaben importierte Stammdaten verfälschen. Die Trennung macht Quelle, Änderungsrecht und Lebensdauer sichtbar, erhöht die Importsicherheit und schafft eine stabile Grundlage für weitere operative Workflows.
