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

Das Flask-Backend liegt in `backend/`. Der Composition Root `app.py` verbindet
HTTP-Endpunkte und deren Transaktionsgrenzen. `config.py` ist die einzige Stelle,
die Laufzeitumgebung interpretiert; `logging_config.py` definiert die gemeinsame
Observability-Policy. `models.py` definiert Persistenz und Beziehungen. Import-,
Quoten- und Authentifizierungslogik ist in fachlich benannten Modulen gekapselt.
Die detaillierte Modulmatrix und Betriebsanleitung steht in
[`backend/README.md`](../backend/README.md).

### Architekturentscheidungen für Release 1

- **ADR-001 – Expliziter Composition Root:** Initialisierung bleibt sichtbar in
  `app.py`. Konfiguration und Logging haben keine Abhängigkeit zu Routes oder
  Modellen. Damit bleibt die Startreihenfolge überprüfbar.
- **ADR-002 – Routes als Transaktionsgrenze:** Bestehende Commit-/Rollback-
  Semantik wird für Release 1 bewahrt. Fachservices berechnen Ergebnisse, aber
  erzeugen keine HTTP-Responses.
- **ADR-003 – Keine Big-Bang-Aufteilung:** Der historisch gewachsene Route-Layer
  wird nicht lediglich auf Dateien verteilt. Künftige Blueprints werden nur mit
  klarer Service-/Repository-Grenze und Vertragstests extrahiert.
- **ADR-004 – Explizite Migrationen:** Schemaänderungen werden als idempotente
  Migrationsskripte ausgeführt. Model-Importe verändern kein Schema.
- **ADR-005 – Produktionsserver im Container:** Gunicorn übernimmt Worker- und
  Access-Logging; der Flask-Server bleibt ein lokales Entwicklungswerkzeug ohne
  erzwungenen Debug-Modus.

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
