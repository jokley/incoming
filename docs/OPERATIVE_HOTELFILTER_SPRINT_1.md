# Sprint 1: Einheitliche operative Hotelfilter

## Problem und Ursache

Hotels und Zuweisungen unterstützten dieselbe operative Entscheidung, verwendeten dafür aber unterschiedliche Filtermuster. Die Hotelseite bot eigene Schnellfilter, während die Zuweisungen nur Suche und Region anboten. Zudem waren Grenzwerte nicht vollständig beziehungsweise nicht eindeutig beschriftet. Disponenten mussten deshalb je Seite neu interpretieren, wie kritische oder noch nutzbare Hotels gefunden werden.

## UX-Entscheidung

Beide operativen Hotelansichten verwenden dieselbe, bewusst kompakte Filterfolge:

1. **Handlungsbedarf** als Standardsicht
2. **Alle**
3. **< 75 %**
4. **≥ 75 %**
5. **> 90 %**
6. **Voll**
7. **Freie EZ**
8. **Freie DZ**

`Handlungsbedarf` umfasst Hotels ohne Kapazität, Hotels ab 75 % Auslastung und Hotels mit höchstens zwei freien Kapazitätseinheiten. Dadurch bündelt die Standardsicht nur Zustände, die eine Prüfung oder baldige Entscheidung erfordern. Weitere Filter wurden nicht ergänzt: Region, Suche sowie die bestehenden Ausstattungsfilter erfüllen eigene konkrete Aufgaben; zusätzliche interessante Merkmale würden die Auswahl nur verlängern.

Die Prioritätssortierung lautet: fehlendes Kontingent, voll, über 90 % beziehungsweise höchstens zwei Einheiten frei, ab 75 %, übrige Hotels. Innerhalb einer Stufe wird alphabetisch sortiert. Fehlende Kontingente stehen vor vollen Hotels, weil sie eine Zuweisung vollständig verhindern und zunächst geklärt werden müssen. Bei Filterkombinationen ohne Treffer bleiben die Filter erreichbar, damit der Disponent die Sicht direkt korrigieren kann.

## Umsetzung

- `OperationalHotelFilters` kapselt Reihenfolge, Bezeichnungen, Chip-Größen, Farben, Hover-, Fokus- und Aktivzustände.
- Gemeinsame Prädikate kapseln Grenzwerte und die operative Standardsortierung.
- Hotels adaptiert Zimmerkontingente auf den gemeinsamen operativen Zustand.
- Zuweisungen adaptiert die bestehende Betten-/Slot-Sicht auf denselben Zustand, ohne API, Datenmodell oder Zuweisungslogik zu verändern.
- Die bestehenden Such-, Regions-, HP- und SR-Filter bleiben unverändert und ergänzen die operative Schnellauswahl.

## Nutzen für Disponenten

- Dieselben Begriffe und dieselbe Reihenfolge reduzieren den Orientierungswechsel zwischen Hotels und Zuweisungen.
- Kritische beziehungsweise nicht nutzbare Hotels erscheinen automatisch zuerst.
- Freie EZ und DZ lassen sich unmittelbar für neue Zuweisungen finden.
- Eindeutige, nicht überlappungsfrei behauptete Grenzzeichen vermeiden Fehlinterpretationen bei exakt 75 % und 90 %.
- Eine leere Ergebnismenge ist kein Workflow-Ende mehr, weil die Filter weiterhin bedienbar bleiben.

## Gemeinsame Komponenten und automatisch profitierende Seiten

Verbessert wurde die neue gemeinsame Komponente `OperationalHotelFilters` samt gemeinsamer Filter- und Sortierregeln. Automatisch profitieren aktuell:

- **Hotels**: Hotelliste und deren operative Vorauswahl.
- **Zuweisungen**: Hotelübersicht als Zielauswahl für die Disposition.

## Bewusst unverändert

Übersicht, Analytics, Listen, Dashboard-KPIs, Backend, API, Datenmodell, Performancearchitektur und Businesslogik wurden nicht verändert. Auch Suche, Region sowie HP/SR bleiben erhalten, da sie bereits klare, entscheidungsrelevante Fragen beantworten und nicht Teil des Inkonsistenzproblems waren.
