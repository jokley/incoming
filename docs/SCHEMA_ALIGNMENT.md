# Release 1 / Sprint 3.3b: SQLite-Schema-Alignment

## Zielzustand

Der bestehende SQLite-Startpfad bleibt bis zur Alembic-Baseline der
evolutionäre Upgrade-Pfad. Er legt fehlende Tabellen mit `db.create_all()` an,
ergänzt fehlende Spalten und führt die bereits vorhandenen fachlichen Backfills
für Single-Room-Status und Event-Personenbedarf aus. Anschließend gleicht
`align_sqlite_schema()` die physische DDL an `db.metadata` an.

Die Ausführung ist auf SQLite begrenzt. PostgreSQL wird weder initialisiert noch
verändert. Es wird keine Alembic-Revision erzeugt und keine Datenübernahme nach
PostgreSQL durchgeführt.

## Behobene Abweichungen

1. Die fünf bisher fehlenden Tabellen `audit_event`, `import_session`,
   `import_session_version`, `import_session_event` und `import_approval`
   entstehen weiterhin kontrolliert aus den kanonischen Metadaten.
2. Die vier fehlenden Athlete-Spalten sowie die beiden fehlenden Event-Spalten
   werden vor dem Alignment durch die bestehenden additiven Legacy-Upgrades
   ergänzt.
3. `single_room_status` wird weiterhin aus `single_room_entitlement`
   zurückgefüllt; `event.person_demand` wird weiterhin aus den vorhandenen
   Zimmerbedarfen abgeleitet. Das Alignment selbst verändert keine fachlichen
   Werte.
4. Weil SQLite Constraints nicht nachträglich per `ALTER COLUMN` ergänzen kann,
   wird `athlete` bei Bedarf transaktional neu aufgebaut. Dadurch werden
   `ck_athlete_single_room_status` und der Foreign Key von
   `single_room_decision_id` nach `import_approval.id` hergestellt.
5. Temporäre Server-Defaults aus früheren Legacy-Upgrades werden durch einen
   bedarfsgesteuerten Rebuild von `audit_event`, `athlete`, `event` und
   `room_booking` entfernt. Danach entspricht die Datenbank den Modellen, die
   bewusst nur Python-Defaults besitzen.
6. Vor dem Commit jedes Rebuilds läuft `PRAGMA foreign_key_check`. Ein Fehler
   rollt die gesamte Alignment-Transaktion zurück. Wiederholte Ausführung ist
   ein No-op.

## Reproduzierbarkeit und Rollback

Das Alignment läuft nur nach den additiven Backfills und kopiert jede Zeile mit
einer expliziten, aus den Metadaten abgeleiteten Spaltenliste in die neue
Tabellenstruktur. Die betroffenen Tabellen werden gemeinsam in einer
Transaktion ersetzt. Bei DDL-, Copy- oder FK-Prüffehlern bleibt das alte Schema
erhalten.

Ein erfolgreicher Schema-Rebuild ist nicht durch eine fachliche Down-Migration
rückgängig zu machen, weil er keine fachlichen Werte entfernt. Der operative
Rollback ist deshalb die Wiederherstellung des vor dem Deployment erstellten
SQLite-Backups. Bis zur Baseline bleibt ein geprüftes Backup zwingende
Deployment-Voraussetzung.

## Alembic-Konventionen

`compare_server_default=True`, `compare_type=True` und SQLite Batch Mode sind
jetzt Teil der Alembic-Konfiguration. Damit wird künftige Default-Drift nicht
mehr stillschweigend übergangen und SQLite kann nicht direkt unterstützte
Änderungen als Batch-Rebuild darstellen.

Folgende Punkte werden bewusst **vor Erzeugung der Baseline in Sprint 3.3c**
entschieden, aber nicht rückwirkend in diesem Alignment erzwungen:

* Eine globale SQLAlchemy Naming Convention würde sämtliche bisher unbenannten
  PK-, FK- und Unique-Constraints umbenennen. Das wäre eine große zusätzliche
  DDL-Änderung ohne fachlichen Nutzen für die Bestandsangleichung. Die
  Convention muss spätestens vor der Baseline festgelegt werden; wird sie
  eingeführt, ist danach ein erneuter Null-Diff-Nachweis erforderlich.
* DB-seitige Cascade-Regeln werden nicht ergänzt. Die Modelle deklarieren
  derzeit bewusst keine `ondelete`-/`onupdate`-Aktionen; ORM-`delete-orphan`
  bleibt davon getrennt. Eine Änderung wäre potenziell fachlich.
* Server-Defaults werden nicht neu eingeführt. Die bestehende Policy bleibt:
  Defaults und `onupdate` werden vom ORM geliefert. Soll direkter SQL-Zugriff
  unterstützt werden, muss diese Policy vor der Baseline für beide Dialekte
  geändert und getestet werden.
* Der zyklische FK zwischen `import_session` und `import_session_version` muss
  beim Review der PostgreSQL-Baseline explizit auf Anlage- und Drop-Reihenfolge
  geprüft werden.

## Readiness-Gates für Sprint 3.3c

Die eingecheckte Legacy-Fixture wird in einem temporären Verzeichnis gestartet
und anschließend mit Alembic `compare_metadata()` inklusive Server-Defaults
geprüft. Erwartet wird eine leere Differenzliste. Zusätzlich werden Tabellen,
Check/FK, Default-Freiheit, `foreign_key_check` und Idempotenz geprüft.

Sprint 3.3c kann beginnen, wenn diese Tests in CI grün sind und die Naming-
Convention-Entscheidung gefallen ist. Die eigentliche Baseline bleibt ein
separater, bewusst freizugebender Schritt.

## Abschluss in Sprint 3.3c

Die Gates wurden erfüllt und Revision `20260815_01` wurde als reine
Leere-Datenbank-Baseline freigegeben. Die endgültige Constraint-Strategie und
der künftige Workflow sind in `ADR-0001-PRODUCTION-BASELINE.md` dokumentiert.
Dieser Alignment-Pfad bleibt ausschließlich die kontrollierte Vorstufe für
Bestands-SQLite-Dateien und ist kein Bestandteil der Baseline.
