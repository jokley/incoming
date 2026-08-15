# Backend-Betrieb und Modulverantwortung

Das Backend stellt die bestehende Incoming-REST-API bereit. Änderungen an den
hier beschriebenen Grenzen dürfen weder JSON-Verträge noch fachliche Regeln
implizit verändern.

## Module

| Modul | Verantwortung |
| --- | --- |
| `app.py` | Composition Root, HTTP-Routen, Request-Lifecycle und Transaktionsgrenzen |
| `config.py` | Einmaliges Lesen und Normalisieren der Laufzeitkonfiguration |
| `logging_config.py` | Einheitliches Prozess-Logging und Request-Korrelation |
| `models.py` | SQLAlchemy-Modelle, Beziehungen und Serialisierung persistierter Entitäten |
| `auth.py` | Vertrauensgrenze zum Auth-Proxy sowie Rollen/Berechtigungen |
| `excel_import.py` | Vorschau, Validierung und Bestätigung von FIS-Importen |
| `quota_service.py` | Fachliche Quotenberechnung ohne HTTP-Verantwortung |
| `scenario_generator.py` | Deterministische Testdaten-Artefakte |
| `*_migration.py` | Idempotente, explizite SQLite-Schemaanpassungen |

`import_csv.py`, `seed_data.py` und `generate_test_files.py` sind operative
Werkzeuge und gehören nicht zum Request-Pfad.

## Konfiguration

Alle Umgebungsvariablen werden in `config.RuntimeSettings` interpretiert. Eine
vollständige Vorlage steht in `../incoming.env.example`. Geheimnisse dürfen
nicht eingecheckt werden. `AUTH_DEV_*` ist ausschließlich für lokale Entwicklung
vorgesehen. CORS bleibt ohne `CORS_ORIGINS` deaktiviert.

`DATABASE_BACKEND` akzeptiert `sqlite` (Standard) oder `postgresql`. SQLite
verwendet weiterhin `DATABASE_PATH`. Für PostgreSQL ist zusätzlich eine
`DATABASE_URL` mit `postgresql://` erforderlich; die Anwendung verwendet dafür
den Psycopg-3-Treiber. Bis zur Alembic-Baseline führt die Anwendung ihre
bestehenden automatischen Schema-Upgrades ausschließlich im SQLite-Modus aus.
Der operative Endpunkt `GET /health` prüft die Datenbankverbindung und meldet
den ausgewählten Datenbanktyp als `databaseBackend`.

## Alembic-Migrationsworkflow

Alembic verwendet dieselben `RuntimeSettings` und dieselben SQLAlchemy-Metadaten
wie die Anwendung. Befehle werden aus `backend/` ausgeführt; `DATABASE_BACKEND`,
`DATABASE_PATH` und `DATABASE_URL` wählen deshalb für Anwendung und Migration
dieselbe Datenbank. SQLite bleibt der Standard. PostgreSQL wird nur bei einer
bewussten Konfiguration angesprochen.

```bash
cd backend

# Freigegebene Revisionskette als SQL rendern (öffnet keine Datenbankverbindung)
python -m alembic upgrade head --sql

# Zukünftig: Revision nach einer bewussten Modelländerung erzeugen und prüfen
python -m alembic revision --autogenerate -m "kurze beschreibung"

# Zukünftig: freigegebene Revisionen anwenden bzw. zurückrollen
python -m alembic upgrade head
python -m alembic downgrade -1
```

Autogenerierte Revisionen sind immer manuell auf Dialektunterschiede,
Constraint-Namen, Datenverlust und eine belastbare `downgrade()`-Operation zu
prüfen. Vor `upgrade` ist ein Backup vorgeschrieben. Migrationen werden nicht
beim Anwendungsstart ausgeführt, damit Deployment und Schemaänderung getrennte,
beobachtbare Schritte bleiben. Der Ordner `migrations/versions/` ist in diesem
Sprint absichtlich leer; Baseline und Schemaänderungen gehören in Folgesprints.

## Logging und Fehler

Anwendungs- und Bibliothekslogs gehen nach stdout und enthalten Level, Logger
und die `request_id`. Der Server übernimmt Access Logs. Fachlich erwartbare
Fehler werden weiterhin am jeweiligen API-Rand in das bestehende JSON-Format
übersetzt. Unerwartete Ausnahmen werden mit Stacktrace protokolliert; ein
globaler Catch-all wird bewusst vermieden, damit Flask/SQLAlchemy ihre
Fehlersemantik nicht verdecken.

## Datenzugriff und Transaktionen

Routes bilden derzeit die Transaktionsgrenze: Schreiboperationen committen erst
nach erfolgreicher fachlicher Verarbeitung und rollen bei Fehlern zurück.
Services dürfen keine eigenen Flask-Responses erzeugen. Neue Abfragen sollen
Beziehungen gezielt laden und ungefilterte `.all()`-Aufrufe nur für nachweislich
kleine Referenzdaten verwenden. Schemaänderungen gehören in ein
Migrationsmodul, nicht in Model-Importe.

## Produktion und Entwicklung

Der Container startet Gunicorn mit einem Prozess und acht Threads. Der einzelne
Prozess vermeidet konkurrierende SQLite-Writer über mehrere Worker-Prozesse;
Threads erlauben weiterhin parallele I/O-Verarbeitung. Für eine spätere
Mehrprozess-Skalierung ist zuerst eine dafür geeignete Datenbank einzuführen.
Persistente SQLite-Daten müssen auf einem Volume unter `APP_DATA_DIR` liegen.
Der Flask-Entwicklungsserver kann lokal mit `python backend/app.py` gestartet
werden, läuft aber nie mit implizitem Debug-Modus.

```bash
python -m pip install -r backend/requirements.txt
python -m pytest backend/tests
```

## Refactoring-Grenze

`app.py` enthält historisch noch mehrere Fachbereiche. Weitere Extraktionen
sollen vertikale Blueprints mit zugehörigem Service/Repository bilden und in
kleinen, vertragstestbaren Schritten erfolgen. Eine rein mechanische Aufteilung
ohne klare Abhängigkeitsrichtung würde lediglich Kopplung verschieben und ist
deshalb keine Architekturverbesserung.
