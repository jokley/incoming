# Incoming WM 2027 – Development Guidelines

## Grundprinzip

Die Anwendung besitzt eine stabile, gewachsene Architektur.

Priorität haben Stabilität, Verständlichkeit, Wartbarkeit und schnelle Fehlerbehebung.

**Ändere nur, was für den konkreten Auftrag notwendig ist.**

## Architektur und Code

- Bestehende Services, Komponenten, Datenmodelle und Funktionen wiederverwenden.
- Keine neuen Engines, Layer oder Abstraktionen ohne konkreten Bedarf.
- Keine unnötigen Dateien, Verzeichnisse, Wrapper oder Helper erstellen.
- Neue Dateien nur anlegen, wenn sie die Wartbarkeit tatsächlich verbessern.
- Bestehende Dateien nicht nur wegen ihrer Größe aufteilen.
- Keine Refactorings außerhalb des aktuellen Auftrags.
- Keine parallelen Implementierungen derselben Geschäftsregel.
- Einfache, klar benannte Funktionen und nachvollziehbare Datenflüsse bevorzugen.
- Keine komplexen Lösungen für hypothetische zukünftige Anforderungen.
- Bestehende funktionierende Schnittstellen möglichst erhalten.

## Entwicklung und Fehlerbehebung

Arbeite nach folgendem Prinzip:

**Problem → Ursache → bestehender Code → kleinste Lösung → Regressionstest**

- Vor Änderungen die betroffenen Funktionen und Aufrufer prüfen.
- Bestehendes Verhalten erhalten, sofern keine Änderung beauftragt wurde.
- Fehler an ihrer Ursache beheben, nicht durch zusätzliche Sonderlogik verdecken.
- Änderungen möglichst lokal begrenzen.
- Relevante Regressionstests ergänzen und ausführen.
- Keine unnötigen Testdateien oder umfangreichen Testinfrastrukturen aufbauen.
- Keine umfangreichen Analyse- oder Dokumentationsdateien ohne Auftrag erzeugen.

## Fachliche Konsistenz

- Import, Quota, Genehmigungen, Disposition und Listen müssen fachlich konsistent bleiben.
- Vorhandene Berechnungen wiederverwenden.
- Historische Entscheidungen von ihrer aktuellen Anwendbarkeit unterscheiden.
- Event-Isolation und Berechtigungen erhalten.
- Genehmigungen und operative Buchungen bei Reimports schützen.
- Keine unbestätigten FIS-Regeln als verbindliche Logik implementieren.
- Bestehende Event-Group- und Quotenberechnungen nicht ohne bestätigte fachliche Grundlage verändern.

## Arbeitsumgebung und Sicherheit

Repository: `/workspace/incoming-test`
Branch: `dev`

- Nur im beauftragten Repository arbeiten.
- Vor Änderungen Git-Status und Branch kontrollieren.
- Bereits vorhandene Benutzeränderungen nicht überschreiben.
- Keine PROD-Änderungen.
- Keine Migration ohne ausdrückliche Freigabe.
- Kein Commit, Push, Merge oder Deployment ohne ausdrücklichen Auftrag.
- Bei unerwarteten Architekturproblemen keine eigenmächtige große Umstrukturierung beginnen.

## UI und Frontend

- Bestehende React-/TypeScript-Komponenten und Designkonventionen verwenden.
- Keine neue UI-Bibliothek ohne konkreten Bedarf.
- Vorhandene Dialoge, Tabellen und Styles bevorzugen.
- Bedienbarkeit, Lesbarkeit und konsistente Zustände erhalten.
- Keine zusätzlichen Komponenten nur zur formalen Aufteilung kleiner UI-Bereiche.

## Abschluss eines Auftrags

Berichte kurz:

1. Was wurde geändert und warum?
2. Welche Dateien und Funktionen sind betroffen?
3. Welche Tests wurden ausgeführt?
4. Gibt es Risiken oder offene Punkte?

Keine unnötig langen Abschlussberichte.

**Leitprinzip: So einfach wie möglich, so strukturiert wie nötig.**