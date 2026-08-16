# Release 1 / Sprint 3.3a: Schema- und Baseline-Bewertung

> Historischer Readiness-Befund aus Sprint 3.3a. Die in Sprint 3.3b
> implementierte Angleichung und der aktuelle Freigabestand sind in
> `SCHEMA_ALIGNMENT.md` dokumentiert.

Stand der Prüfung: 15. August 2026. Untersucht wurden das eingecheckte
SQLite-Artefakt `backend/data/freestyle_wm_new.db` (SHA-256
`c0c1d672ff65f0de0a5f9cd03e950aec50c8c9982d5b1c71a3998faa456d62d7`) und
`db.metadata` aus `backend/models.py`. Es wurde weder eine Revision erzeugt
noch eine Datenbank oder Tabelle verändert. Insbesondere wurde die Anwendung
nicht gestartet, weil deren SQLite-Startpfad `create_all()` und mehrere
Legacy-Upgrades ausführt.

## Entscheidung

**Das eingecheckte SQLite-Schema ist nicht bereit, unverändert als fachliche
Baseline gestempelt zu werden. Die Baseline sollte jetzt noch nicht erstellt
werden.**

Das Artefakt bildet einen älteren, vor dem Anwendungsstart liegenden Stand ab:
11 der 16 modellierten Tabellen sind vorhanden. Fünf Tabellen, sechs normale
Spalten, ein Fremdschlüssel und ein Check-Constraint fehlen. Die alten elf
Tabellen stimmen bei ihren gemeinsam vorhandenen Spalten hinsichtlich Typ,
Nullability und Primärschlüsseln überein. Das ist aber keine vollständige
Schema-Parität.

Vor Freigabe muss zunächst entschieden und reproduzierbar festgelegt werden,
welcher SQLite-Zustand die tatsächlich unterstützten Bestandsinstallationen
repräsentiert. Eine **Kopie** jeder unterstützten Bestandsvariante sollte mit
den heute noch im Startpfad liegenden Legacy-Upgrades auf den kanonischen Stand
gebracht und anschließend erneut gegen die Metadaten geprüft werden. Diese
Datenmigration ist nicht Teil dieses Sprints.

## Prüfumfang und Methode

Die SQLite-Seite wurde read-only über `sqlite_master`, `.schema` und die
PRAGMAs für Tabellen, Spalten, Fremdschlüssel und Indizes inventarisiert. Die
Modellseite wurde vollständig aus allen 16 `db.Model`-Klassen einschließlich
`__table_args__`, `ForeignKey`, `index`, `unique`, Python-Defaults und
Beziehungen inventarisiert. Zusätzlich wurden Alembics `env.py` und die
SQLite-Legacy-Upgrades gelesen.

Ein echter `alembic revision --autogenerate` wurde bewusst **nicht** gestartet:
Er wäre nach Aufgabenstellung unzulässig und würde eine Revisionsdatei
erzeugen. Die unten beschriebene Ausgabe ist daher eine statische Prognose aus
Schema und Metadaten, keine erzeugte Revision.

## Vollständiger Vergleich

### Tabellen und Spalten

| Abweichung | Ursache | Risiko | Empfohlene Behandlung vor Baseline |
| --- | --- | --- | --- |
| Tabellen `audit_event`, `import_session`, `import_session_version`, `import_session_event` und `import_approval` fehlen in SQLite vollständig. | Das eingecheckte DB-Artefakt stammt aus einem Stand vor Einführung dieser Modelle. `db.create_all()` würde sie erst beim SQLite-Anwendungsstart anlegen. | **Hoch:** Eine Stamp-/Baseline-Annahme würde Tabellen als vorhanden deklarieren, die tatsächlich fehlen. Die Anwendung kann auf einer nur gestempelten DB nicht korrekt arbeiten. | Unterstützte Bestandskopie mit dem freigegebenen Legacy-Pfad angleichen; danach erneut inventarisieren. Nicht allein `stamp` verwenden. |
| `athlete.single_room_entitlement VARCHAR(30) NULL` fehlt. | Später ergänztes Legacy-Feld; der Startpfad fügt es per `ALTER TABLE` hinzu. | **Mittel:** Abfragen/Schreibvorgänge über das aktuelle Mapping schlagen vor dem Start-Upgrade fehl. | Expliziten Upgrade-/Backfill-Schritt beibehalten und auf einer Kopie prüfen. |
| `athlete.single_room_status VARCHAR(30) NOT NULL` fehlt. | Späteres fachliches Statusmodell; der Hilfsmigrationspfad ergänzt temporär `DEFAULT 'NONE'` und führt einen fachlichen Backfill aus. | **Hoch:** Direktes Autogenerate kann eine NOT-NULL-Spalte nicht sicher zu den 53 vorhandenen Zeilen hinzufügen; ein bloßer Default `NONE` würde vorhandene Entitlements ohne Backfill semantisch verlieren. | Bewusst manuelle Expand/Backfill/Contract-Migration; Entitlement-Mapping erhalten. |
| `athlete.single_room_decision_id INTEGER NULL` und der FK nach `import_approval.id` fehlen. | Status-/Entscheidungsmodell wurde später ergänzt; SQLite-`ADD COLUMN` erzeugt derzeit keinen FK. | **Hoch:** Selbst nach Legacy-Startupgrade bleibt die physische FK-Parität voraussichtlich offen; ungültige Entscheidungsreferenzen sind möglich. | Nach Datenprüfung in einer Batch-Neuerstellung einen benannten FK anlegen. |
| `athlete.import_change_types_json TEXT NULL` fehlt. | Später ergänztes maschinenlesbares Änderungsfeld; Startpfad ergänzt es. | **Niedrig bis mittel:** Aktuelles Mapping ist vorher nicht nutzbar; nullable, daher kein Backfill-Zwang. | In kontrollierter Migration ergänzen. |
| `event.person_demand INTEGER NOT NULL` und `event.single_room_percentage INTEGER NOT NULL` fehlen. | Spätere Planungslogik. Der Startpfad ergänzt Server-Defaults `0`/`50`, berechnet `person_demand` anschließend aus den Bestandsdaten und lässt die Defaults physisch bestehen. | **Hoch:** 7 Events benötigen einen fachlichen Backfill. Außerdem driftet die gestartete SQLite-DB anschließend von den Metadaten, denn die Modelle besitzen nur Python-Defaults und keine `server_default`s. | Manuelle Add-/Backfill-/NOT-NULL-Sequenz; danach bewusst entscheiden, ob Defaults auf **beiden** Dialekten entfernt oder in den Metadaten als Server-Defaults modelliert werden. |

Für alle übrigen gemeinsam vorhandenen Spalten wurden keine Abweichungen bei
Name, SQLite-deklariertem Typ oder Nullability gefunden. Das umfasst
`import_run`, `room_type`, `hotel`, `hotel_room_inventory`,
`event_room_demand`, `fis_room_assignment`, `room_assignment`, `room_booking`
und `room_booking_occupant` sowie die gemeinsamen Spalten von `event` und
`athlete`.

### Defaults und Server-Defaults

* Die Modelle verwenden ausschließlich **Python-seitige** `default=`-Werte
  (und `onupdate=`), keine `server_default=`-Werte. Deshalb enthält das
  untersuchte SQLite-Schema für die gemeinsamen Spalten ebenfalls keine
  Defaults. Diese gemeinsame Teilmenge ist konsistent.
* Python-Defaults sind kein Datenbankvertrag: direkte SQL-Inserts erhalten
  weder Zeitstempel noch Boolean-/Statuswerte. PostgreSQL und SQLite würden
  insoweit zwar gleich erzeugt, aber nicht robust gegenüber Nicht-ORM-Clients.
* Der Legacy-Upgradepfad erzeugt für `single_room_status`, `person_demand`,
  `single_room_percentage` und gegebenenfalls `counts_as_single` physische
  SQLite-Defaults. Autogenerate vergleicht Server-Defaults in der aktuellen
  Alembic-Konfiguration nicht (`compare_server_default` fehlt). Eine nach dem
  Startpfad geprüfte DB kann deshalb unbemerkt abweichen.

### Schlüssel, Constraints, Indizes und Cascade

* Alle vorhandenen Tabellen haben denselben einspaltigen Integer-Primärschlüssel
  `id` wie das Modell. Primärschlüssel und Fremdschlüssel sind überwiegend
  unbenannt.
* Die vorhandenen Modell-FKs sind in SQLite vorhanden und referenzieren die
  richtigen Tabellen/Spalten. Es gibt nirgendwo ein deklaratives `ondelete`
  oder `onupdate`; Datenbank-seitig gilt damit `NO ACTION`. Die
  `delete-orphan`-Angaben an Beziehungen sind **ORM-Cascades**, keine
  Datenbank-Cascades.
* Die SQLite-Verbindung meldet standardmäßig `PRAGMA foreign_keys=0`. Somit
  werden vorhandene FKs bei typischen direkten SQLite-Verbindungen nicht
  erzwungen. PostgreSQL erzwingt sie immer. Das ist eine relevante semantische
  Portabilitätsabweichung, auch wenn die DDL übereinstimmt.
* Vorhandene Unique-Regeln stimmen funktional überein:
  `room_type.name`, `fis_room_assignment.source_row_key` und der benannte
  Composite-Constraint `uq_room_booking_athlete`. Die beiden einspaltigen
  Regeln sind in SQLite als unbenannte Autoindizes materialisiert.
* Der modellierte Check-Constraint `ck_athlete_single_room_status` fehlt mit
  seiner Spalte. Der aktuelle SQLite-Hilfspfad ergänzt ihn beim `ALTER TABLE`
  ebenfalls nicht. Nach einem Legacy-Start ist daher eine Batch-Neuerstellung
  nötig, wenn echte Parität verlangt wird.
* Sämtliche expliziten Modellindizes gehören zu den fünf fehlenden Tabellen:
  sechs nicht-eindeutige Audit-Indizes, `ix_import_session_status`, der
  eindeutige `ix_import_session_nation`, sowie Indizes auf Session-/Versions-/
  Approval-Referenzen. Das untersuchte Artefakt besitzt keinen davon. Auf den
  vorhandenen Tabellen fordert das Modell keine zusätzlichen Nicht-Unique-
  Indizes.
* Integer-PKs verwenden in SQLite die implizite ROWID-Autoincrement-Semantik,
  aber nicht das streng monotone Schlüsselwort `AUTOINCREMENT`. SQLAlchemy wird
  auf PostgreSQL eine dialektgerechte Sequenz/Identity-Strategie rendern. Das
  ist erwartete Dialektanpassung, darf beim Datentransfer aber nicht ohne
  anschließendes Setzen der PostgreSQL-Sequenzen übernommen werden.

Constraint-Namen sind derzeit nur für `uq_import_session_version`,
`uq_room_booking_athlete` und `ck_athlete_single_room_status` explizit. Ein
globales SQLAlchemy-Naming-Convention fehlt. Dadurch können Namen für PKs, FKs,
andere Unique-Regeln und Indizes dialektabhängig sein und spätere Drops bzw.
Downgrades erschweren.

## Prognose für Alembic Autogenerate

Gegen **genau das eingecheckte SQLite-Artefakt** ist ungefähr Folgendes zu
erwarten:

1. `create_table` für die fünf fehlenden Tabellen einschließlich ihrer
   Constraints und anschließend die modellierten Indizes;
2. Batch-Änderungen an `athlete` für vier Spalten, den FK nach
   `import_approval` und den Check-Constraint;
3. Batch-Änderungen an `event` für zwei NOT-NULL-Spalten;
4. abhängig von Alembic/SQLite-Reflexion zusätzliche Änderungen oder Warnungen
   für unbenannte Unique-/FK-Constraints;
5. eine Warnung wegen des FK-Zyklus
   `import_session.current_version_id` ↔
   `import_session_version.session_id`; dessen Anlage-/Drop-Reihenfolge muss
   insbesondere für PostgreSQL manuell geprüft werden.

Diese Strukturänderungen beschreiben den Zielzustand grundsätzlich richtig,
sind als produktive Bestandsmigration aber **nicht fachlich ausreichend**:

* `single_room_status` benötigt den vorhandenen fachlichen Backfill aus
  `single_room_entitlement`;
* `event.person_demand` benötigt die vorhandene Ableitung aus Room Demands;
* NOT-NULL muss in mehreren Phasen hergestellt werden;
* Datenvalidierung muss vor Aktivierung neuer FK-/Check-Constraints erfolgen;
* Server-Default-Lebensdauer und FK-Zyklus müssen ausdrücklich entschieden
  werden;
* SQLite-Batch-Rebuilds und PostgreSQL-DDL gehören getrennt getestet;
* `downgrade()` darf bei befüllten neuen Tabellen/Spalten nicht blind Daten
  löschen.

Autogenerate ist hier somit nur ein Review-Ausgangspunkt, nicht die fertige
Baseline oder Upgrade-Migration. Für eine **neue leere PostgreSQL-Datenbank**
soll eine manuell geprüfte Baseline hingegen das vollständige Zielschema in
einem Schritt erzeugen; sie darf keine SQLite-Legacy-Backfills enthalten.

## Empfohlene Baseline-Strategie

### 1. Kanonischen Vertrag festlegen

1. SQLAlchemy-Metadaten werden als kanonischer Zielvertrag festgelegt.
2. Vor der Baseline werden eine Naming Convention, der Umgang mit
   Server-Defaults, FK-Cascades und der zyklische FK schriftlich entschieden.
3. Der geprüfte Schema-Snapshot wird in CI sowohl für SQLite als auch für eine
   temporäre PostgreSQL-Instanz erzeugt und anschließend mit Alembic
   `check`/Autogenerate auf **null Diff** geprüft.
4. Die erste Revision enthält ausschließlich die leere-DB-Baseline. Legacy-
   Datenanpassungen werden nicht darin versteckt.

### 2. Bestehende SQLite-Installationen

1. Vorab Backup plus Integritätsprüfung (`integrity_check`, `foreign_key_check`)
   und Versionserkennung durchführen; nie anhand bloßer Existenz der DB
   annehmen, dass sie aktuell ist.
2. Auf einer Kopie zunächst die bisher ausgelieferten, idempotenten Legacy-
   Upgrades einschließlich fachlicher Backfills vollständig ausführen.
3. Die verbleibenden strukturellen Lücken (vor allem FK, Check, Namen und
   Defaults) mit einer **separaten, bewusst geschriebenen Pre-Baseline-
   Angleichung** schließen. Für SQLite sind dabei transaktional getestete
   Batch-Rebuilds erforderlich.
4. Daten, Counts, Nullwerte, Statusdomänen, verwaiste FKs und Unique-Regeln
   validieren. Danach muss der Metadatenvergleich null Diff ergeben.
5. Erst dann die bestehende DB mit `alembic stamp <baseline_revision>` markieren;
   `stamp` verändert nur die Versionsmarke und repariert kein Schema.
6. Danach alle Installationen ausschließlich über dieselbe Alembic-Kette
   fortführen und die automatischen DDL-Upgrades aus dem Anwendungsstart in
   einem späteren, gesonderten Release entfernen.

Installationen auf mehreren historischen Ständen brauchen explizite
Upgrade-Pfade oder müssen als nicht unterstützt abgewiesen werden. Das
eingecheckte Sample darf nicht ungeprüft als Stellvertreter aller produktiven
SQLite-Dateien gelten.

### 3. Neue PostgreSQL-Installationen

1. Leere Datenbank und dedizierten Schema-Owner anlegen; keine Anwendung vor
   dem Schema-Upgrade starten.
2. Die freigegebene Baseline mit `alembic upgrade head` ausführen. Sie erzeugt
   alle 16 Tabellen, Constraints und Indizes direkt im Zielzustand.
3. Schema-null-Diff, Constraints und Transaktionsverhalten prüfen; erst danach
   Referenz-/Seed-Daten in einem getrennten, wiederholbaren Schritt laden.
4. Ab dann dieselben nachfolgenden Revisionen wie bei den gestempelten
   SQLite-Installationen verwenden. Dialektspezifische Zweige nur innerhalb
   derselben Revision und mit Tests für beide Dialekte zulassen.

Eine spätere **Datenübernahme SQLite → PostgreSQL** ist keine Baseline-Aktion.
Sie braucht einen eigenen ETL-/Cutover-Plan: Schreibstopp, konsistenten Export,
Typnormalisierung (insbesondere Boolean/DateTime), vorübergehend geordnete
Constraint-Behandlung, Validierung aller Beziehungen und das Setzen aller
PostgreSQL-Sequenzen auf `max(id)+1`.

## Risikoanalyse

| Bereich | Risiko | Einstufung | Gegenmaßnahme |
| --- | --- | --- | --- |
| Erste Baseline | Ein abweichendes SQLite-Schema wird nur gestempelt und erscheint danach fälschlich aktuell. | Kritisch | Null-Diff als harte Stamp-Voraussetzung; Schema-Fingerprint und Upgrade-Matrix. |
| Erste Baseline | Baseline vermischt leere Neuinstallation und datenhaltige Legacy-Transformation. | Hoch | Baseline-DDL und Pre-Baseline-Angleichung strikt trennen. |
| Zukünftige Migrationen | Unbenannte Constraints lassen sich auf PostgreSQL/SQLite unterschiedlich droppen; Autogenerate produziert Rauschen. | Hoch | Naming Convention vor der ersten Revision festlegen; Namen stabilisieren. |
| Zukünftige Migrationen | Python-Defaults werden irrtümlich als DB-Defaults verstanden; `onupdate` ist ebenfalls nur ORM-seitig. | Mittel | Default-Policy dokumentieren, nötige Server-Defaults explizit modellieren und vergleichen. |
| Zukünftige Migrationen | SQLite-Batch-Rebuild verliert Constraints/Indizes oder scheitert bei FK-Zyklen. | Hoch | Upgrade und Downgrade auf befüllten SQLite-Kopien testen; generierte DDL reviewen. |
| SQLite → PostgreSQL | SQLite akzeptiert schwächere Typen und deaktivierte FK-Prüfung; PostgreSQL weist Altlasten zurück. | Kritisch | Vorab Typ-, Null-, Domain-, Unique- und FK-Audit; `foreign_key_check`; Quarantäne ungültiger Datensätze. |
| SQLite → PostgreSQL | IDs werden importiert, PostgreSQL-Sequenzen bleiben zurück. | Hoch | Nach Import Sequenzen atomar auf den nächsten freien Wert setzen und testen. |
| SQLite → PostgreSQL | Naive DateTimes besitzen keine Zeitzonen; Boolean-Darstellung kann inkonsistent sein. | Hoch | Zeitzonenvertrag und explizite Konvertierung im ETL festlegen. |
| Downgrade | Drop der fünf neuen Tabellen oder vier fachlichen Athlete-Felder vernichtet Historie und Entscheidungen. | Kritisch | Destruktive Downgrades ablehnen oder nur nach Export/Backup; bevorzugt Forward-Fix. |
| Rollback | PostgreSQL-DDL ist transaktional, SQLite-Batch-/Datentransformationen und Deployment-Rollback haben andere Grenzen. | Hoch | Backup/Restore-Probe, Wartungsfenster, expand/contract und getrennten App-/DB-Rollback-Runbook verwenden. |
| Laufzeit | ORM-`delete-orphan` wirkt nur über ORM, während direkte SQL-Löschungen an `NO ACTION` scheitern; SQLite mit deaktivierten FKs kann Waisen erzeugen. | Hoch | DB-Cascade-Policy bewusst festlegen und FK-Enforcement für jede Verbindung aktivieren. |

## Kleine, nichtfachliche Verbesserungsvorschläge

Noch **nicht implementiert**, weil sie vor der Baseline als bewusstes
Schema-Design freigegeben werden sollten:

1. Deterministische SQLAlchemy-Naming-Convention für `pk`, `fk`, `uq`, `ck`
   und `ix` einführen. Da dies reflektierte Namen und die Baseline beeinflusst,
   ist es trotz Wartbarkeitsgewinn keine risikofreie reine Codekosmetik.
2. `compare_server_default=True` nach Festlegung der Default-Policy aktivieren.
3. Einen read-only Schema-Audit/CI-Test ergänzen, der Tabellen, Spalten,
   Nullability, Typen, PK/FK/Unique/Checks, Indizes, Defaults und FK-Aktionen
   prüft und bei Drift fehlschlägt.
4. PostgreSQL als CI-Service aufnehmen und für jede Revision mindestens
   `upgrade head`, null Diff und den unterstützten Downgrade-/Re-upgrade-Pfad
   testen; parallel eine befüllte SQLite-Fixture testen.
5. Nach erfolgreicher Adoption von Alembic die Startzeit-DDL (`create_all`,
   `ALTER TABLE`) entfernen. Bis dahin verhindert ein exklusiver Migrationslock
   konkurrierende SQLite-Starts.
6. Den FK-Zyklus explizit modellieren (zum Beispiel benannter, auf PostgreSQL
   separat angelegter Constraint) und die gewünschte Deferrability prüfen.

## Freigabeempfehlung

**Keine Baseline-Freigabe in diesem Zustand.** Vorher sind mindestens nötig:

1. repräsentative Bestands-DBs identifizieren und auf Kopien angleichen;
2. fachliche Backfills sowie Datenintegrität nachweisen;
3. Default-, Naming-, FK-Enforcement- und FK-Zyklus-Policy festlegen;
4. nach der Angleichung einen echten Alembic-null-Diff für SQLite nachweisen;
5. die später erzeugte Baseline gegen eine leere PostgreSQL-Datenbank testen.

Erst wenn diese Gates grün sind, sollte die Baseline bewusst erzeugt werden.
Sie wird in diesem Sprint ausdrücklich nicht erstellt.
