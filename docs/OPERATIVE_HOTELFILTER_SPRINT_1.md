# Sprint 1: Einheitliche operative Hotelfilter

## Problem und Ursache

Hotels und Zuweisungen unterstützten dieselbe operative Entscheidung, verwendeten dafür aber unterschiedliche Filtermuster. Die Hotelseite bot eigene Schnellfilter, während die Zuweisungen nur Suche und Region anboten. Zudem waren Grenzwerte nicht vollständig beziehungsweise nicht eindeutig beschriftet. Disponenten mussten deshalb je Seite neu interpretieren, wie kritische oder noch nutzbare Hotels gefunden werden.

## UX-Entscheidung

Beide operativen Hotelansichten verwenden dieselbe, bewusst kompakte Filterfolge:

1. **Handlungsbedarf** als Standardsicht
2. **Alle**
3. **< 75 %**
4. **≥ 75 %**
5. **Voll**
6. **Freie EZ**
7. **Freie DZ**

`Handlungsbedarf` umfasst Hotels ohne Kapazität, Hotels ab 75 % Auslastung und Hotels mit höchstens zwei freien Kapazitätseinheiten. Dadurch bündelt die Standardsicht nur Zustände, die eine Prüfung oder baldige Entscheidung erfordern. Weitere Filter wurden nicht ergänzt: Region, Suche sowie die bestehenden Ausstattungsfilter erfüllen eigene konkrete Aufgaben; zusätzliche interessante Merkmale würden die Auswahl nur verlängern.

Der Filter **> 90 %** wurde entfernt, weil er keine zusätzliche operative Entscheidung ermöglicht: Diese Hotels gehören bereits zur Sicht **≥ 75 %** und stehen durch die Standardsortierung unmittelbar hinter den vollständig belegten Hotels. Damit bleiben die drei entscheidenden Kapazitätszustände – ausreichend Reserve, wenig Reserve und voll – vollständig sichtbar, während eine konkurrierende Auswahl entfällt.

Die Standardsortierung lautet: voll belegte Hotels, Hotels ab 75 % und anschließend Hotels unter 75 %. Innerhalb der beiden Auslastungsgruppen wird absteigend nach Auslastung sortiert; bei gleicher Auslastung alphabetisch. So stehen drohende Engpässe automatisch oben, ohne dafür einen eigenen Filter zu benötigen. Bei Filterkombinationen ohne Treffer bleiben die Filter erreichbar, damit der Disponent die Sicht direkt korrigieren kann.

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
- Die Reduktion auf zwei Auslastungsbänder vermeidet eine fachlich redundante Auswahl und verkürzt die visuelle Prüfung.
- Eine leere Ergebnismenge ist kein Workflow-Ende mehr, weil die Filter weiterhin bedienbar bleiben.

## Gemeinsame Komponenten und automatisch profitierende Seiten

Verbessert wurde die neue gemeinsame Komponente `OperationalHotelFilters` samt gemeinsamer Filter- und Sortierregeln. Automatisch profitieren aktuell:

- **Hotels**: Hotelliste und deren operative Vorauswahl.
- **Zuweisungen**: Hotelübersicht als Zielauswahl für die Disposition.

## Bewusst unverändert

Übersicht, Analytics, Listen, Dashboard-KPIs, Backend, API, Datenmodell, Performancearchitektur und Businesslogik wurden nicht verändert. Auch Suche, Region sowie HP/SR bleiben erhalten, da sie bereits klare, entscheidungsrelevante Fragen beantworten und nicht Teil des Inkonsistenzproblems waren.
