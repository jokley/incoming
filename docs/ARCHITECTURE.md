# Architektur und Verantwortlichkeiten

Dieses Dokument beschreibt die technischen Grenzen der Anwendung. Es dient als
Orientierung für Refactorings; fachliches Verhalten und API-Verträge bleiben
dabei unverändert.

## Frontend

Der Einstiegspunkt `src/main.tsx` initialisiert die React-Anwendung. Unter
`src/app` sind die Verantwortlichkeiten wie folgt getrennt:

- `components/` enthält Seiten und fachliche UI-Komponenten. Wiederverwendbare
  Basisbausteine liegen in `components/ui/`, übergreifende Enterprise-Komponenten
  im `design-system/`.
- `services/` kapselt Kommunikation, fachlich wiederverwendbare Berechnungen und
  technische Browser-Integrationen. Komponenten sollen keine eigenen API-URLs
  oder `fetch`-Aufrufe einführen.
- `data/` enthält ausschließlich lokale beziehungsweise Mock-Daten und deren
  Datenmodelle.
- `types.ts` ist die gemeinsame Quelle für die vom Frontend verwendeten
  Domänentypen.
- `auth/` kapselt Authentifizierungszustand und Berechtigungsprüfung.

Theme-Werte werden im `design-system/theme/` definiert. Globale CSS-Einstiege
liegen in `src/styles`; neue Komponenten sollen vorhandene Tokens nutzen, statt
Farben oder Abstände parallel zu definieren.

## Backend

Das Flask-Backend liegt in `backend/`. `app.py` stellt HTTP-Endpunkte und deren
Transaktionsgrenzen bereit, `models.py` definiert die persistierten Modelle.
Import-, Quoten- und Authentifizierungslogik ist in den gleichnamigen Modulen
gekapselt. Schemaänderungen werden als explizite Migrationsskripte abgelegt und
dürfen nicht stillschweigend beim Frontend-Start erfolgen.

## Abhängigkeitsregeln

1. UI-Komponenten greifen über `services/api.ts` auf das Backend zu.
2. Gemeinsame Berechnungen werden in einem fachlich benannten Service gehalten,
   nicht in mehreren Seiten dupliziert.
3. Browser-Ressourcen wie Object-URLs werden von kleinen technischen Utilities
   angelegt und wieder freigegeben.
4. Frontend-Typen importieren keine Backend-Implementierungsdetails; der
   JSON-Vertrag bildet die Grenze.
5. Änderungen an einem API-Vertrag erfordern synchron angepasste Typen,
   Endpunkte und Dokumentation.

## Qualitätsprüfungen

- `pnpm run build` prüft und bündelt das Frontend für die Produktion.
- `python -m pytest backend/tests` führt die Backend-Regressionstests aus.
- Für neue fachliche Fehlerkorrekturen ist ein Regressionstest im zuständigen
  Bereich erforderlich. Reine Strukturänderungen müssen mindestens beide
  vorhandenen Prüfschritte unverändert bestehen.
