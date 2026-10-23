# PR 4 – Eventgebundene Buchungs- und Accommodation-Isolation

Basis: `main` / `f0d277b`, einschließlich PR 1, PR 2, PR 3 und Restore-/Event-ID-Fix.
Implementiert und ausschließlich lokal/isoliert geprüft. Commit, Push und PR-Erstellung
erfolgen nach gesonderter Freigabe. **Kein produktives Deployment, keine produktive
Migration, kein produktiver Reset und kein produktiver Neustart.**
Keine neue Tabelle und keine DB-Migration erforderlich.

## 1. Bestandsanalyse und geschlossene Zugriffe

Vor der Änderung waren folgende operative Zugriffe global oder nur über eine
ungeprüfte ID begrenzt. Berücksichtigt wurden auch Helfer, Alias-Routen,
Relationship-Loader, Audit-Snapshots und administrative Schreibpfade.

| Bereich | Dateien / Funktionen | Absicherung |
|---|---|---|
| Buchungslisten und Kompatibilitäts-Aliase | `routes/booking_reads.py`, `_get_grouped_room_bookings_response` | Root-Query auf Buchungseigentümer begrenzt; ungültige gemischte Belegung wird vor Serialisierung abgewiesen. |
| Personen-/Belegungsprojektion | `app.py`, `_build_room_booking_units`, `_build_assignment_planning_view`, `_has_pending_roomlist_review`, `_acknowledge_import_changes`; `routes/athletes.py` | Personen, Buchungen, Occupants und ihre Coverage gehören zum autorisierten Event. Fremde IDs liefern keinen Detaildatensatz. Namens-/Partnerindizes enthalten nur dieses Event. |
| Zuweisen, Bearbeiten, Entfernen | `app.py`, `_validate_booking_payload`, `_save_booking_from_payload`, `_detach_athletes_from_existing_bookings`, Assignment-/Booking-/Unassign-Routen | Personen und bestehende Buchung vor Änderungen prüfen; neue Buchung erhält explizite Event-ID; Overlap-/Kapazitätsqueries eventbezogen; interne Save-Grenze prüft auch übergebene ORM-Objekte. |
| Segmente / Join | `routes/accommodation_segments.py`, `_mutate_segment`, `add_shared_segment`, `bookings_for`, `coverage_for` | Fremde Person, Ursprungsbuchung oder Join-Buchung wird bereits beim serverseitigen Lookup abgewiesen. Bestehende atomare Transaktion bleibt erhalten. |
| Split und External-Ersatz | `accommodation_split.py`, `person_bookings`, `snapshot_token`, `validate_partition_source`, `split_plan`, `partition_booking`, `apply_split`; `external_accommodation.py` | Ursprung prüfen; konkurrierende virtuelle Zimmerbelegungen und Kontingente nur aus demselben Event; Fortsetzungen übernehmen `booking.event_id`. Bestehende Split-/External-Algorithmen unverändert. |
| Eligibility / Hotel-Fit | `assignment_availability.py`, `load_context`, `project` | Einmalig eventbezogene Personen-/Inventar-/Buchungsdaten laden. Derselbe bestehende Projektionsalgorithmus erhält ausschließlich diese Daten. |
| Hotel-/Kontingentzugriffe | `routes/hotels.py`, Hotel-GETs, Inventory-POST/PUT/DELETE, Capacity-Overview, Reservations | Hotels bleiben global; eingebettete Kontingente und Reservierungen werden über ihren Eigentümer begrenzt. Neue Kontingente bekommen beim Flush den validierten Eigentümer. Änderungs-/Löschlookups prüfen zusätzlich Hotel-ID und Event. |
| Bedarfsplanung | `routes/events.py`, AccommodationEvent-CRUD; `routes/analytics.py`, Room-Availability und Occupancy-Timeline | Filter auf `championship_event_id`; EventRoomDemand über seinen Planungs-Event. Die Demand-Schreibendpunkte bleiben wie zuvor deaktiviert. Bestehende Bedarfs- und Timeline-Berechnung unverändert. |
| Simulation / Testdatenverwaltung | `app.py`, `_delete_simulation_data`, `create_simulation`, `reset_test_data` | Nur markierte Daten des aktuellen Events. Nicht zuverlässig eventzuordenbare globale Historien-Resets werden bei mehreren Championships kontrolliert blockiert, auch wenn das zweite Event aktuell keine Personen besitzt. |
| Veraltete Bootstrap-/CSV-Helfer | `seed_data.py`, `import_csv.py`, alte interne CSV-Funktionen und `ensure_reference_data` in `app.py`, `generate_test_files.reset_athlete_related_data` | Vor destruktiven oder statischen Bootstrap-Schritten ausschließlich fail-closed geprüfte isolierte Testdatenbank zulassen. Keine dieser Routinen wurde gegen produktive Daten ausgeführt. Legacy-Single-File-HTTP-Import bleibt HTTP 410. |

Bewusst globale Prüfungen bleiben bei **globalen Stammdaten** bestehen:
Existenz fremder Abhängigkeiten muss Hotel-Löschung, Änderung der Unterkunftsart
bzw. RoomType-Kapazitätsänderung verhindern können. Solche Guards geben keine
fremden Belegungsdetails oder Kontingentmengen aus. RoomType-Löschung schützt
auch bereits referenzierte Buchungen/Planungsdaten.

Die bestehenden Importpfade in `imports/read_context.py`, `imports/change_plan.py`
und `excel_import.py` waren bereits eventbezogen. Ihre Plan-/Confirm-Verträge
wurden nicht neu implementiert oder geändert. `accommodation_requirements.has_bookings`
prüft den Personeneigentümer und weist inkonsistente eventfremde Buchungsbezüge
kontrolliert ab, statt daraus eine gültige NO_ROOM-Entscheidung abzuleiten.

## 2. Gemeinsamer Kontext und Zugriff

Neue Datei: `backend/accommodation_scope.py`.

- `accommodation_event_id()` baut auf den vorhandenen Funktionen
  `configured_event_id()`, `validate_operational_import_event()` und
  `normalize_event_id()` auf. Keine zweite Eventauswahl-/Fallback-Heuristik.
- Ein validierter request-lokaler Importkontext wird konsistent verwendet.
  Ansonsten ist die explizite `OPERATIONAL_EVENT_ID` erforderlich.
- Fehlender/inaktiver Championship oder widersprüchliche Request-Event-ID wird
  kontrolliert abgewiesen. Ein ausdrücklich anderes Event fällt niemals still
  auf Event 1 oder ein erstes/aktives Event zurück.
- Das feste Single-Event-Deployment bleibt verbindlich. Ein Request mit Event B
  kann die für Event A konfigurierte operative Umgebung nicht umschalten.
  Tests wechseln die Konfiguration ausdrücklich zwischen zwei isolierten Events;
  dies ist kein freigegebener Eventselector und keine Multi-Event-Freischaltung.
- `event_query()` begrenzt Root-Queries und relevante Relationship-Loader.
  Indirekte Eigentümer werden über Buchung/Person bzw. Planungs-Event geprüft.
- `event_get()` verwendet einen gefilterten SELECT statt eines möglicherweise
  bereits aus der Identity-Map gelieferten ungeprüften `Session.get`.
- Globale Hotelobjekte werden mit ihren eventbezogenen Collections frisch geladen,
  damit zuvor geladene fremde Kontingente nicht aus dem Cache übernommen werden.
- `validate_serialized_ownership()` verhindert, dass beschädigte alte Beziehungen
  eventfremde Bewohner über eine Buchungsserialisierung sichtbar machen.

Hotels, RoomTypes und Competitions bleiben globale Stammdaten. Kein neues
Personenmodell, keine redundante Event-ID auf Occupant/Demand, keine globale
physische Zimmerverwaltung. Gleich bezeichnete virtuelle Slots verschiedener
Events verbrauchen ausschließlich ihr jeweils eigenes exklusives Kontingent.

## 3. Schreibsicherheit und Transaktionsgrenzen

`backend/event_ownership_runtime.py` erweitert den bestehenden `before_flush`-Guard:

- Neue Pflicht-Eigentümer nur aus validiertem Kontext übernehmen.
- IDs zentral normalisieren, einschließlich String-/Integer-Darstellungen.
- Neue, geänderte **und gelöschte** operative Objekte im Request prüfen.
- Persistierte direkte Eigentümer nicht neu zuordnen, auch nach Expire/Rollback.
- BookingOccupant, RoomAssignment, FIS-Legacy-Partner und EventRoomDemand prüfen.
  Direkte FK-Änderungen werden selbst bei bereits gecachter alter Beziehung geprüft.

Die bestehenden atomaren Segment-/Split-/Importtransaktionen bleiben erhalten.
Kontingent- und Bedarfsplanungsmutationen verwenden zusätzlich denselben
vorhandenen Advisory-Writer-Lock wie Buchungsänderungen, um Validierung und
kontrollierte Kapazitätsänderung zu serialisieren. Kein zusätzlicher Commit in
fachlichen Split-/Segment-Helfern; bei Fehlern wird zurückgerollt.

Es wird kein SQL-RLS und kein neues zusammengesetztes DB-Constraint eingeführt.
Direktes privilegiertes SQL umgeht ORM-Guards weiterhin. Die bestehenden
Core-SQL-Entfernungen des Import-ChangePlans bleiben durch den serverseitigen
Event-/Nationen-Snapshot, Fingerprint, stabile IDs und die PR-3-Sperren abgesichert.
Technische ORM-Arbeit außerhalb eines HTTP-Requests benötigt explizite Eigentümer;
sie ersetzt keine Benutzerberechtigung. Vollständige Event-ACLs bleiben Folgearbeit.

## 4. Bestandsschutz: 109 Kontingente und sieben Planungs-Events

Keine Datensätze werden durch die Einführung dieser Query-/Schreibgrenzen
migriert, dupliziert, gelöscht oder neu berechnet. Änderungen an `models.py`
betreffen nur zusätzliche Serialisierungsprüfungen, keine Spalten/Constraints.

Der neue Abnahmetest erzeugt **109 synthetische Kontingente im Eigentümer-Event**
plus ein getrenntes fremdes Kontingent sowie die sieben Planungs-Events:
Parallel, Aerials, Moguls, Big Air, Slopestyle, Snowboard Cross, Ski Cross.
Er vergleicht alle Rohspalten einschließlich IDs, Mengen, Zeiträume, Attribute,
Personenbedarf, EZ-Anteil und EventRoomDemand vor/nach Reads und abgewiesenen
fremden Mutationen. Die Daten bleiben vollständig identisch; ausschließlich der
richtige Eventbestand erscheint in den Antworten. Bestehende Analytics-Tests
prüfen die unveränderten Timeline-/EZ-/DZ-Ergebnisse zusätzlich.

**Der produktive Istbestand wurde nicht geöffnet oder unabhängig nachgezählt.**
Die produktiven Angaben „109 / sieben“ stammen aus dem Auftrag. Die Aussage zum
Bestandsschutz basiert auf unverändertem Schema, fehlender Datenmigration,
Codeprüfung und dem isolierten Vorher-/Nachher-Test; nicht auf einem produktiven
Datenbankzugriff. Die produktiven IDs wurden nicht in Quellcode übernommen.

## 5. Tests und Fixtures

Neue Tests: `backend/tests/test_event_accommodation_isolation.py`.

Abgedeckt: zwei Events mit gemeinsamen globalen Hotel-/RoomType-Stammdaten und
identischen virtuellen Zimmernummern; gefilterte Reads und Cachewechsel A/B/A;
fremde Booking-/Athlete-/Inventory-/Planning-IDs; gemischte Zuweisung; Join über
Eventgrenzen; Split-Eigentümer und explizites `countsAsSingle=false`; eigene
Kapazität ohne fremden Verbrauch; fehlendes eigenes Datumskontingent trotz
passendem fremdem Kontingent; ORM-/Legacy-/Demand-Konflikte; globale Master-Guards;
Bestandsvergleich 109/sieben; blockierte Bootstrap-/Historienbereinigung; beschädigte
Legacy-Belegungen; interne Save-Grenze; begrenzte Hotel-Query-Anzahl.

LAT: portabler, synthetischer Workbook-Regressionstest mit vier Personen und zwei
Paaren über echten Upload → Review → Freigabe → Confirm → zwei Zuweisungen →
identischen Reimport. Vier Personen, Paarbezüge, zwei Buchungen und gespeichertes
`false` bleiben erhalten. **Keine originalen LAT-Dateien waren verfügbar.**
JPN: vorhandene Originaldateien lokal per Umgebungsvariablen verwendet; keine
privaten Originaldateien eingecheckt. Vorhandene AUS/USA/FIN/KOR-, Preservation-,
APPROVED_EXTRA-, Coverage-, External-, Split- und Import-Performance-Tests mitgeprüft.

Notwendige Fixture-Anpassungen:

- Leere Read-/API-Tests konfigurieren jetzt ausdrücklich einen gültigen Event.
- Zwei ältere Fixtures erhalten den richtigen Eigentümer von Anfang an, statt
  Kontingente und Buchung künstlich auf verschiedene Events zu verteilen oder
  die Session nachträglich einem anderen Event zuzuordnen.
- Der reale JPN-HTTP-Test prüft den bereits in `f0d277b` eingeführten Deployment-
  Guard: mit A konfiguriert wird B abgewiesen; danach wird B ausdrücklich als
  alleiniger Testkontext konfiguriert. Keine Lockerung des Produktguards.
- Keine Tests deaktiviert, keine Quoten-/EZ-Formel zur Testberuhigung geändert.

Backup-Runtime: `backup/Dockerfile` nimmt die kleinen neuen Runtime-Abhängigkeiten
`accommodation_scope.py` und `imports/{__init__,event_context}.py` auf. Der erweiterte
Filesystem-Pakettest prüft Flush/Serialisierung mit numerischer String-Event-ID
in einer isolierten In-Memory-DB, ohne vollständigen App-Quellbaum. Damit wird
kein erneuter Restore-Fehler durch ein fehlendes Python-Modul eingeführt.

## 6. Baseline, Ergebnisse und Performance

Read-only Integrationsstand und Implementierung wurden mit demselben Interpreter,
Arbeitsverzeichnis `backend/` und einer dedizierten fail-closed geprüften lokalen
PostgreSQL-17-Testinstanz auf Loopback-Port 55432 geprüft.

Baseline `f0d277b`, echte JPN-Dateien aktiviert: **692 erfolgreich, neun Fehler,
1196 Subtests erfolgreich** (115,02 s). Davon sind acht die bekannten Bestandsfehler;
der neunte war die inzwischen überholte JPN-Testannahme zum Single-Event-Guard.

Abschließender vollständiger Lauf: **727 erfolgreich, acht bekannte Fehler,
1196 Subtests erfolgreich**, keine übersprungenen Tests (151,84 s). Alle **34
neuen PR-4-Abnahmefälle** sind erfolgreich. Gegenüber der Baseline keine neuen
Fehler; zusätzlich zum neuen Umfang besteht der an den aktuellen Guard-Vertrag
angepasste JPN-Test. Die acht verbleibenden Fehler sind unten einzeln aufgeführt.

Weitere Ergebnisse: Frontend **141 Tests erfolgreich**, Typecheck und
Produktionsbuild erfolgreich (8,48 s), keine Frontenddateien geändert.
Backup-Suite **21 erfolgreich, 14 Subtests erfolgreich**. Python-Kompilierung
und `git diff --check` erfolgreich. Kein interaktiver Browser-/Produktivtest.

### Vergleichsmessung mit zwei Events

Identische synthetische Daten: 12 globale Hotels, je Event 48 Personen und zwölf
Buchungen, jeweils eigene Kontingente. Frische Request-Sessions. Einzelmessungen,
keine statistische Zeitserie. Vorher wurden auch fremde Datensätze ausgegeben;
deshalb sind Antwortumfang und Query-Zahlen nicht als reine Optimierung vergleichbar.

| HTTP-Pfad | Vorher SQL / ms | PR 4 SQL / ms |
|---|---:|---:|
| Hotels | 2 / 9,24 | 3 / 14,05 |
| Gruppierte Buchungen | 134 / 81,90 | 74 / 65,39 |
| Capacity-Overview | 39 / 23,95 | 27 / 33,52 |
| Planning-View | 5 / 95,72 | 5 / 49,62 |
| Neue Buchung | 26 / 34,07 | 26 / 49,41 |

Zusätzlich: 31 Hotels mit je einem eigenen und einem fremden Kontingent benötigen
höchstens vier SELECTs für die Hotelprojektion; keine neue pro-Hotel-Abfrageserie.
Die zusätzliche Eventvalidierung ist request-lokal gecacht. Bestehende virtuelle
Zimmer-/Fit-Algorithmen bleiben unverändert; zusätzliche EXISTS-/Event-Prädikate
können DB-/CPU-Kosten erhöhen. Der alte gruppierte Booking-Reader hat weiterhin
lazy Loads pro Buchung; diese wurden in diesem Isolations-PR nicht neu eingeführt
und nicht im Rahmen eines allgemeinen Performance-Redesigns ersetzt.

### Acht bekannte Bestandsfehler

- `tests/test_api_characterization.py::ApiCharacterizationTest::test_person_and_quota_aliases_keep_read_projection`
- `tests/test_api_route_safety.py::ApiRouteSafetyTest::test_registered_paths_and_methods_match_reviewed_manifest`
- `tests/test_assignment_planning_projection.py::AssignmentPlanningProjectionTest::test_approved_extra_initializes_single_flag_independent_of_room_type`
- `tests/test_assignment_planning_projection.py::AssignmentPlanningProjectionTest::test_non_entitled_single_occupant_is_not_marked_exclusive`
- `tests/test_assignment_planning_projection.py::AssignmentPlanningProjectionTest::test_quota_single_flag_is_not_derived_from_entitlement_or_occupancy`
- `tests/test_import_extraction_characterization.py::test_preview_selects_only_active_mapping_and_preserves_unknown_error_structure`
- `tests/test_import_operational_impacts.py::ImportOperationalImpactsTest::test_live_quota_uses_import_entitlements_not_assigned_room_types`
- `tests/test_wsc_membership_validation.py::test_missing_mapping_blocks_rows_and_confirmation`

## 7. Verbleibende Grenzen / PR 5

- Vollständige Event-Isolation sämtlicher Quoten-/Dashboard-/Analytics-/Report-
  und Audit-Readmodels ist nicht erledigt. Hier wurden nur ihre notwendigen
  Accommodation-Datenquellen begrenzt, keine fachlichen Quotenformeln umgebaut.
- Beispielsweise bleiben globale „letzter Import“-Metadaten und Audit-/Historien-
  Administration außerhalb der begrenzten Unterkunftsquellen Folgearbeit.
- Keine Event-Benutzer-ACLs, kein ActiveEventProvider und kein neuer Eventselector.
  Ein zweiter operativer Bestand bleibt für das feste Deployment gesperrt.
- Shared Hotel-/RoomType-Metadaten bleiben global. Gemeinsam genutzte physische
  Zimmer oder eventübergreifend geteilte Kapazitäten sind kein unterstütztes Modell.
- Bestehende direkte SQL-Schreibrechte und externe Administration benötigen
  weiterhin organisatorische Absicherung; es gibt keine DB-RLS.
- Die bereits dokumentierten PR-1-Migrationsvoraussetzungen einschließlich Backup,
  `OPERATIONAL_EVENT_ID` und Bestandsfingerprint bleiben relevant. PR 4 selbst
  führt keine Migration aus und ergänzt keine.

**Unverändert:** countsAsSingle/ausdrückliches false, APPROVED_EXTRA, EZ/DZ,
RoomType-Semantik, NO_ROOM/REQUIRED, STANDARD/SPECIAL, Aufenthaltsintervalle,
Coverage, Partner-/Split-/External-Semantik, Quotenformeln, Preservation und
Approval-Evidence. Die einzigen absichtlichen Zugriffseinschränkungen betreffen
fremde/widersprüchliche Eigentümer und ungesicherte globale Wartungsaktionen.

## 8. Reproduktion und lokale Artefakte

Aus `backend/`, ausschließlich mit dedizierter Testdatenbank:

```sh
FLASK_ENV=test TEST_DATABASE_URL='<dedicated loopback test URL>' \
  JPN_ENTRIES_FILE='/local/path/JPN-Entries.xlsx' \
  JPN_ROOMS_FILE='/local/path/JPN-Rooms.xlsx' \
  PYTHONPATH=. python -m pytest -q --tb=short --disable-warnings
```

Gezielte Abnahmen: `tests/test_event_accommodation_isolation.py`.
Backup aus dem Repo-Root: `python -m pytest backup/tests -q`.
Frontend aus `frontend/`: `npm test`, `npm run typecheck`, `npm run build`.
Vollständige lokale Protokolle liegen unter `/tmp/pr4-reports/` und werden nicht
versioniert. Die ursprünglichen produktiven Datensätze wurden nicht berührt.
