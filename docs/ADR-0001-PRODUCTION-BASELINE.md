# ADR 0001: Erste produktive Alembic-Baseline

* Status: akzeptiert
* Datum: 2026-08-15
* Release: 1 / Sprint 3.3c

## Kontext und Entscheidung

Sprint 3.3b hat die repräsentative SQLite-Bestandsdatenbank transaktional an
die SQLAlchemy-Metadaten angeglichen. Die Integritäts- und Null-Diff-Gates sind
damit erfüllt. Revision `20260815_01` wird als langfristiger Ursprung der
Alembic-Kette festgelegt. Sie beschreibt ausschließlich das kanonische Schema
einer leeren Datenbank: keine Daten, Backfills, Businesslogik oder
Legacy-Transformationen.

SQLAlchemy verwendet ab der Baseline folgende Naming Convention:

| Objekt | Muster |
| --- | --- |
| Primary Key | `pk_<table>` |
| Foreign Key | `fk_<table>_<column>_<referred_table>` |
| Unique Constraint | `uq_<table>_<first_column>` |
| Check Constraint | `ck_<table>_<semantic_name>` |
| Index | `ix_<table>_<column>` |

Mehrspaltige und fachlich benannte Constraints behalten einen expliziten,
stabilen Namen. ORM-Defaults bleiben Python-Defaults; die Baseline erfindet
keine Server-Defaults. Foreign Keys verwenden weiterhin `NO ACTION`, weil eine
Cascade-Änderung fachliche Semantik wäre.

Der FK-Zyklus zwischen `import_session` und `import_session_version` wird ohne
Schemaabweichung dialektgerecht aufgelöst: PostgreSQL erhält den
`current_version_id`-FK nach Erzeugung beider Tabellen, SQLite inline, da es
den Constraint nicht nachträglich per `ALTER TABLE` hinzufügen kann.

## Konsequenzen und Workflow

Neue Installationen führen `alembic upgrade head` aus. Eine Bestands-SQLite-DB
wird niemals blind aktualisiert oder gestempelt: zuerst Backup, freigegebenes
Alignment, Integritätsprüfung und `compare_metadata()`-Null-Diff, danach
`alembic stamp 20260815_01`.

Künftige Änderungen beginnen in den Modellen, danach wird eine einzelne
Autogenerate-Revision erzeugt. Der Diff muss manuell auf Namen, Drop-Reihenfolge,
SQLite-Batch-Verhalten, PostgreSQL-DDL, Datenverlust und Rollback geprüft
werden. CI muss Upgrade, Downgrade/Re-Upgrade, Offline-SQL und einen erneuten
Autogenerate-/Metadaten-Null-Diff für beide unterstützten Dialekte prüfen.

Die spätere Datenübernahme SQLite → PostgreSQL bleibt ausdrücklich Sprint 3.4.
Dabei bestehen weiterhin Risiken durch SQLite-Typaffinität, deaktivierbare
FK-Prüfung, naive Zeitstempel und nach explizitem ID-Import nachzuziehende
PostgreSQL-Sequenzen. Diese Risiken gehören ins ETL und nicht in die Baseline.
