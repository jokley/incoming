# PR 3 – Sicherer Reimport und atomarer Confirm

Implementiert auf dem gemergten PR-1/PR-2-Stand (`3b5ed94`).
**Nicht produktiv ausgeführt. Kein Deployment, keine Migration, kein Reset
und kein Server-Neustart.** Die Implementierungs- und Testphase erfolgte ohne
Commit/Push; Commit und Pull Request werden ausschließlich nach gesonderter
Freigabe erstellt. Keine neue Tabelle oder Schemaänderung erforderlich.
Die Deployment-Voraussetzungen aus `event-ownership-pr1.md` und die noch
unvollständige globale Event-Isolation aus `event-import-identity-pr2.md` gelten weiter.

## Vertrag und Grenzen

Ein ausführbarer Import ersetzt ausschließlich **Event + Nation + FULL_NATION**.
Der Operator muss ausdrücklich bestätigen, dass alle Disziplinen der Nation
enthalten sind. Aus Dateinamen, Sportspalten oder zufälligen Zeilen wird keine
Vollständigkeit abgeleitet. Teilimporte werden nicht unterstützt. Ein leerer
Entries-Snapshot benötigt die explizite bestehende Session-ID zur Nationenzuordnung
und dieselbe destruktive Freigabe. Nationswechsel eines gematchten Datensatzes
werden als `IMPORT_SNAPSHOT_SCOPE_CONFLICT` blockiert.

Die PR-2-Identitätskonflikte bleiben blockierend. Es gibt keine automatische
Dublettenlöschung und keine Namens-basierten Personenlöschungen. Konflikte
erscheinen weiterhin in der bestehenden Validierungs-/Review-Struktur; ein
mehrdeutiger Datensatz wird nicht in einen ausführbaren Löschplan umgewandelt.

## Dateien und Verantwortlichkeiten

- `backend/imports/change_plan.py`: gemeinsamer deterministischer Plan,
  Fingerprints, exakte ID-basierte Entfernung und Partnerbereinigung.
- `backend/imports/workflow.py`: gespeicherte Fakten wiederherstellen,
  Review/Plan validieren, Sperren, kanonische Vorschauzahlen.
- `backend/excel_import.py`: Request-Kontext wiederverwenden, gespeicherte Version
  vor optionalem Cache bevorzugen, Persistence ohne Commit, kontrollierte
  Planentfernungen und Ergebniszähler. Weiterhin anwendbare operative
  EZ-Entscheidungen werden nach der vorhandenen Evidence-Prüfung erhalten.
- `backend/app.py`: Upload/Versionierung, Staging und Entscheidungen, Freigabe,
  atomarer Confirm, idempotenter Wiederholungsaufruf, versionsbezogener Cancel,
  Recheck; Import-Audit in derselben Transaktion.
- `frontend/src/app/components/ImportChangePlan.tsx`: sichtbarer Plan mit
  Personen-/Membership- und Buchungsfolgen, Partnern, Provenance, Genehmigungen,
  expliziten Bestätigungen und Stale-Hinweis.
- `DataImport.tsx`, `services/api.ts`, `services/importReview.ts`,
  `services/importConfirmation.ts`, `types.ts`: bestehende UI/API gezielt erweitern.
- Neue Backend-Abnahmen: `backend/tests/test_safe_reimport.py`.
  Bestehende Tests/Fixtures verwenden jetzt explizite Review-Verträge statt
  impliziter Freigabe oder ausschließlich prozesslokaler Cache-Manipulation.
- Frontend: `ImportChangePlan.test.ts`, aktualisierter Ergebnistext-Test.
  Die API-Routenfixture ergänzt ausschließlich den neuen Recheck-Endpunkt.

## Änderungsplan

Der Server speichert den Plan in der bestehenden
`ImportSessionVersion.preview_json._workflow.plan`. Öffentliche Darstellung:
`preview.changePlan`. Enthalten sind:

- Event, Nation, FULL_NATION, Session, Version, Daten-/Input-Fingerprint, Digest;
- Personen neu/aktualisiert/unverändert/entfernt mit internen IDs und Quelldifferenzen;
- Memberships hinzufügen/entfernen/behalten;
- konkrete Occupant-IDs, betroffene Buchungen, ausdrücklich zu löschende leere
  Buchungen und deren Einstellungen einschließlich `countsAsSingle=false`;
- verbleibende Partner, Legacy-/FIS-Beziehungen und notwendige Textbereinigung;
- entfernte Personen als vollständiger Vorher-Snapshot mit Identifikatoren,
  Competitions, manuellen Feldern und Entscheidungsreferenzen;
- vorhandene Approval-Evidence sowie Anwendbarkeit bisheriger Personenentscheidungen.

Review und Confirm verwenden denselben serverseitigen Plan. Confirm akzeptiert
keine vom Client gelieferten Löschmengen. Die bestehende Source-Persistence und
Membership-Auflösung bleiben erhalten; die unveränderten Fakten werden unter
Sperre nochmals validiert. Die Löschmenge stammt ausschließlich aus dem Plan.

## HTTP-Ablauf

1. `POST /api/import/fis/preview`: explizites Event, bestehende Session oder
   `createSession`. Auch identische Dateien erzeugen eine neue Version;
   `knownFiles` ist nur ein Hinweis. Keine operative Persistence.
2. GET Session zeigt gespeicherten Plan und aktuellen Stale-Zustand. Lesen
   erneuert **nicht** den bestätigten Prüfstand.
3. Vorhandene Review-/Approval-PATCHes aktualisieren den Plan und nehmen eine
   frühere Importfreigabe zurück; keine neue Quoten-/Approval-Semantik.
4. `POST /api/import/sessions/:id/approve` benötigt `planDigest`,
   `snapshotScope: "FULL_NATION"` und bei Personen- **oder** Membership-Entfernungen
   `confirmDestructiveChanges: true`. Vorhandene fachliche Gates bleiben bestehen.
5. `POST /api/import/sessions/:id/import` benötigt die ausdrücklich geprüfte
   `versionId`. `/api/import/fis/confirm` bleibt kompatibel über den aktuellen
   `previewToken` und verwendet denselben Abschluss. Fremde Events, alte
   Versionen, fehlende Freigaben und veraltete Pläne werden abgewiesen.
6. `POST /api/import/sessions/:id/recheck` bewertet gespeicherte geparste Fakten
   gegen den aktuellen Stand. Bei abgeschlossenen Versionen entsteht eine neue
   Version; neue Freigabe ist erforderlich. Keine Personen-/Buchungsänderung.
   Das ist **kein erneutes Excel-Parsen**. Dafür müssen die Dateien neu hochgeladen
   werden; keine neue dauerhafte Originaldateiverwaltung.
7. `POST /api/import/sessions/:id/cancel` benötigt `versionId` und betrifft nur
   die aktuelle unfertige Version. Die letzte importierte Version wird wieder
   aktuell. Frühere Approvals, Personen, Buchungen und Historie bleiben erhalten.
   Auch ältere importierte Versionen werden über vorhandene IMPORTED-Historie
   erkannt. Ohne vorherigen Import bleibt die Session CANCELLED.

## Concurrency, Dauerhaftigkeit und Atomarität

Fingerprints berücksichtigen Personen, Memberships, Buchungen/Occupants,
ID-verknüpfte Partner und Legacy-Zuordnungen, Session-/Versionsidentität,
Approval-Zeilen und Supersession-Evidence, historische Version-Fakten,
Event-/Competition-Mapping, Weltmeisterreferenzen und relevante Personen-Audits.
Geparste Fakten und Review-Overrides haben einen eigenen Fingerprint.
Änderungen führen zu `STALE_PREVIEW`, HTTP 409, und erneuter Prüfung/Freigabe.

Der bestehende PostgreSQL-Advisory-Writer-Lock wird vor den Sperren genommen.
Confirm verwendet zusätzlich kurze SHARE ROW EXCLUSIVE-Tabellensperren auf den
relevanten Snapshot-Tabellen und eine Session-Zeilensperre. Dadurch sind auch
Insert-Phantome und nicht kooperierende Admin-Schreiber zwischen Fingerprint-
Prüfung und Persistence ausgeschlossen. Diese konservative Sperre ist global
über die betroffenen Tabellen; sie kann andere Schreibvorgänge kurz warten lassen.
Kein Netzwerkaufruf oder Datei-Parsen innerhalb dieser Confirm-Transaktion.
SQLite-Unit-Tests ersetzen keine PostgreSQL-Concurrency-Abnahme.

`import_approved_session` besitzt den finalen Commit: Personen, Memberships,
Entfernungen, ImportRun, IMPORTED-Status, Ergebnis und Historie/Audit gemeinsam.
`confirm_fis_import` macht nur Flush, **keinen Commit**. Technische interne
Aufrufer müssen selbst committen/rollbacken. Der allgemeine Audit-Hook macht
nach erfolgreichem Import keinen zweiten Commit. Bei Fehler bleibt der vorherige
APPROVED-Stand erhalten; alle operativen Teiländerungen werden zurückgerollt.
Nach erfolgreichem Commit wird der optionale Cache invalidiert. Doppelte/parallele
Confirms derselben aktuellen importierten Version liefern das gespeicherte
Ergebnis zurück, ohne einen weiteren fachlichen Import/Audit zu erzeugen.

Der ausführbare Stand lebt in der DB; ein leerer Worker-Cache verhindert Confirm
nicht. Testabdeckung simuliert Workerwechsel durch vollständiges Leeren des
Caches und neue Request-Sessions, keinen echten produktiven Neustart.
Alte Previews ohne Plan benötigen Recheck; fehlende Source-Evidence erfordert
weiterhin Reupload. Es wird keine alte APPROVED-Markierung blind ausgeführt.

## Preservation und Ergebnis

Erhaltene Buchungen behalten ID, Daten, Typ, Belegung und manuelle Einstellungen.
Nur aufgeführte Occupants werden entfernt. Leere Buchungen werden nur als
bestätigte Planoperation gelöscht. Legacy/FIS-Partnerbezüge werden gezielt
aufgehoben; verbleibende Personen/Zuordnungen bleiben erhalten. Textbezüge werden
nur bei zusätzlich bestätigter ID-Beziehung bereinigt.

Manuelles NO_ROOM/REQUIRED, Tarif und Provenance, EZ-Ausnahmen, anwendbare
APPROVED_EXTRA-Entscheidungen, Kommentare und Audit bleiben nach den bestehenden
Regeln erhalten. Membership-Änderungen können Evidence unanwendbar machen;
Entscheidungsdatensätze werden nicht gelöscht. IMPORTED-Historie speichert
Vorher-Snapshots entfernter Personen und Approval-Evidence mit Verantwortlichem
und Zeitpunkt; entfernte Personen verlassen aktive Listen/Quoten.

Ergebniszähler unterscheiden neu/aktualisiert/unverändert/entfernt,
Membership-Entfernungen, betroffene/gelöschte Buchungen, entfernte Occupants und
erhaltene Approvals. `dispositionsChanged` enthält Buchungs- und Legacy-Effekte;
eine gelöschte Buchung wird nicht mehr als null Änderungen gemeldet.
`duplicatesRemoved` bleibt null, weil keine automatische Dublettenbereinigung läuft.

## Verifikation

Nur isolierte, fail-closed geprüfte Loopback-PostgreSQL-Testdatenbank benutzt.
Private JPN-Originaldateien wurden lokal per Umgebungsvariablen verwendet und
werden nicht eingecheckt. AUS über bestehende portable Real-Entries-Fixture.

Abnahmen umfassen zwei Events, echte JPN-Erstimporte/Reimports, stabile Personen-
und Membership-IDs, Source-Updates/Neuanlagen, destruktive Freigabe, leeren Snapshot,
Shared-/leere Buchungen, Legacy-Partner, manuelle Werte, Stale-Zustände,
Cache-Unabhängigkeit, Commit-/Persistence-Fehlerinjektion, parallele/idempotente
Confirms, Recheck und Cancel einschließlich früherer Approval-Evidence.

Abschließende vollständige Backend-Suite: **686 erfolgreich, 8 bekannte
Bestandsfehler, 1196 Subtests erfolgreich** (137,63 s), mit echten JPN-Dateien
und ohne übersprungene Tests. Alle **27 neuen PR-3-Abnahmefälle** sind erfolgreich.
Die acht Fehler entsprechen genau der PR-2-Baseline; keine neuen Regressionen.

Frontend: **141 Tests erfolgreich**, Typecheck und Produktionsbuild erfolgreich
(Build: 9,03 s). Python-Kompilierung und `git diff --check` ebenfalls erfolgreich.
SSR-Tests prüfen sichtbare Planfolgen, explizite Checkboxen und Stale-Sperre.
Kein interaktiver Browser-/Viewporttest durchgeführt; dies bleibt ein manueller
Abnahmeschritt vor produktiver Freigabe.

### Vergleichsmessung AUS (58 Personen)

Gleiche lokale PostgreSQL-Instanz, Interpreter und HTTP-Fixture; einzelne Läufe,
keine belastbare Zeit-Benchmarkserie. SQL-Zahlen enthalten auch Schreibanweisungen.

| Pfad | PR 2 SQL / ms | PR 3 SQL / ms |
|---|---:|---:|
| Erstvorschau | 41 / 279 | 52 / 300 |
| Erst-Confirm | 425 / 473 | 408 / 414 |
| Erneute Vorschau | 38 / 149 | 63 / 205 |
| Reimport-Confirm | durch Hash blockiert | 95 / 210 |

Die PR-3-Werte enthalten die abschließenden zusätzlichen Prüfungen auf
Approval-Supersession und historische Preview-Evidence.
Das bestehende <80-Preview-/Recalculation- und <160-Reimport-Confirm-Budget,
<=6 Flushes und <125 Session-Listen-Statements werden weiter automatisiert geprüft.
Das <160-Budget ist ein **Reimportbudget**; der Erstimport enthält bereits vorher
mehr Statements für die Neuanlagen. Keine pro-Hotel-Requests oder neue
pro-Person-Refetch-Schleifen. Preview ist wegen der zusätzlichen Plan-/Evidence-
Prüfung aufwendiger; diese Mehrarbeit ist beabsichtigt und bleibt budgetiert.

### Bekannte Bestandsfehler

Die folgenden acht Fehler bestanden bereits vor PR 3 (PR-2-Bericht):

- `test_api_characterization::ApiCharacterizationTest::test_person_and_quota_aliases_keep_read_projection`
- `test_api_route_safety::ApiRouteSafetyTest::test_registered_paths_and_methods_match_reviewed_manifest`
- `test_assignment_planning_projection::AssignmentPlanningProjectionTest::test_approved_extra_initializes_single_flag_independent_of_room_type`
- `test_assignment_planning_projection::AssignmentPlanningProjectionTest::test_non_entitled_single_occupant_is_not_marked_exclusive`
- `test_assignment_planning_projection::AssignmentPlanningProjectionTest::test_quota_single_flag_is_not_derived_from_entitlement_or_occupancy`
- `test_import_extraction_characterization::test_preview_selects_only_active_mapping_and_preserves_unknown_error_structure`
- `test_import_operational_impacts::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types`
- `test_wsc_membership_validation::test_missing_mapping_blocks_rows_and_confirmation`

Nicht deaktiviert: alte Read-Projection-/Routenmanifest-Erwartungen, veraltete
countsAsSingle-Erwartungen sowie zwei Tests ohne Flask-Kontext. Keine Änderung
an fachlicher Quoten-/EZ-/Tarif-/NO_ROOM-/Coverage-Semantik zur Testberuhigung.

## Vor produktiver Freigabe

- PR-1/PR-2-Voraussetzungen inklusive Backup, expliziter OPERATIONAL_EVENT_ID,
  Bestandsfingerprint und geplanter Ownership-Migration beachten.
- Backend und Frontend gemeinsam ausrollen: neue Release-/Version-Verträge.
- Ältere unfertige Importversionen ausdrücklich neu prüfen.
- Sperrverhalten und JSON-/Historiengröße mit echtem Betriebsvolumen beobachten;
  langfristig gezieltere Revisionen/Sperren möglich, hier kein neues Framework.
- Die globale Event-Isolation außerhalb der Importpfade ist weiterhin Folgearbeit.
- Kein allgemeiner Import-Rollback, keine Teilimport-Engine, keine neue Quote,
  kein automatisches Matching bei Konflikten, keine automatische Raumzuweisung.

Reproduzierbarer Testaufruf aus `backend/` (nur dedizierte Testdatenbank):

```sh
FLASK_ENV=test TEST_DATABASE_URL='<dedicated loopback test URL>' \
  JPN_ENTRIES_FILE='/local/path/JPN-Entries.xlsx' \
  JPN_ROOMS_FILE='/local/path/JPN-Rooms.xlsx' \
  PYTHONPATH=. python -m pytest -q --tb=short --disable-warnings
```

Frontend aus `frontend/`: `npm test`, `npm run typecheck`, `npm run build`.
Ausführliche lokale Laufprotokolle liegen unter `/tmp/pr3-reports/`; sie werden
nicht versioniert. Die interaktive Prüfung von schmalen Layouts, Drag-and-drop-
Dateiauswahl und tatsächlichem Prozessneustart bleibt vor Freigabe erforderlich.
