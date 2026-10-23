# PR 5 – Eventreine Readmodels

Basis: main 3c6653b (PR 1–4). Keine produktiven Operationen, keine Schemaänderung.

## Inventar vor Implementierung

| Endpunkt/Service | Quelle / bisheriger Filter | Risiko | Gezielte Änderung |
|---|---|---|---|
| Personenliste und Aliase | Athlete bereits eventbezogen; ImportRun global | Fremde letzte Importzeit beeinflusst Änderungsanzeige | ImportRun per Event; NULL-Herkunft ausschließen |
| Personendetail, Suche, Nationen, Reise-/Unterkunftsdaten | bestehende Personen-API/PR4 | indirekte Loader/Identity-Map prüfen | Loader für Personen/Approvals ergänzen, fremde IDs weiterhin 404 |
| /api/official-quotas, Aliase | Personen/Buchungen eventbezogen, Approval-Aggregation global | fremde offene Entscheidungen/Historie | Session-Event im Approval- und Revision-Subquery |
| quota_service / fis_rules / quota_catalogue | reine Evaluatoren/Kataloge | falsche Eingabemenge | keine Formeln ändern, Aufrufer isolieren |
| quota_history | Session/Eventprüfung vorhanden | gespeicherte Preview-/Approvalbezüge | vorhandene Evidenceprüfung erhalten, Loader prüfen |
| ImportSession-Versionen/Approvals/Preview | PR2/3 validierter Kontext | Detail-/Aliasprüfung | bestehende Guards testen, keine Workflow-Neuentwicklung |
| Dashboard / Analytics / Reports / Druck | clientseitige Aggregation aus Personen, Hotels, Bookings, Planung, Quoten, Sessions, Audit | Datenquellen müssen eventrein sein | vorhandene APIs absichern; keine Frontendfilter als Sicherheitsgrenze |
| /api/analytics/* | PR4 Inventar/Bedarf eventbezogen | Loader | vorhandenen Scope wiederverwenden |
| /api/audit-events | globale AuditEvent-Query | personenbezogene Historie anderer Events | fail-closed für nicht zuverlässig zuordenbare Historie; neue Events eindeutig markieren |
| World-Champion-Referenzen | Adminliste global; Recognition bereits eventbezogen | fremde Namen/Referenzen | Adminliste/-details an validierten Kontext binden |
| Legacy NO_ROOM-Kandidaten | globale Personensuche | fremde Namen | vorhandenen event_query nutzen |
| Hotels, RoomTypes, Competitions | globale Stammdaten | gewollt global | unverändert; EventCompetition-Mapping bleibt eventbezogen |

Weitere Prüfung, Tests und Einschränkungen werden nach Implementierung ergänzt.

## 2. Implementierte Datenquellen und Verträge

- `routes/athletes.py::get_athletes`: beide Legacy-ImportRun-Zeitstempel jetzt über
  `event_query(ImportRun)`. Historisches `event_id=NULL` bleibt unverändert und wird
  nicht als aktueller Import ausgegeben. ImportRun besitzt keine Nationenspalte;
  nationenspezifische Historie kommt weiterhin aus `ImportSession(event_id,nation)`.
- `app.py::_build_official_quota_usage_rows`: auch die Abfrage aktueller Approvals
  und der Subquery für revidierte Entscheidungen sind an `ImportSession.event_id`
  gebunden. Personen, Belegungen und Coverage waren bereits seit PR4 gefiltert.
  Bestehende Prüfung von Session, Version und Evidence in `quota_history.py` bleibt
  erhalten. Kein Recalculate und keine Status-/Approval-Schreiboperation in dieser API.
- `app.py::list_import_sessions`: gespeicherte Versionen, Entscheidungen und
  Workflow-Zusammenfassungen ohne flächendeckende Neuberechnung aller Nationen.
  `_current_session_payload(resolve_preview=False)` behält dieselben Antwortfelder.
  Eine einzelne Review-/Detailansicht kann weiterhin ihre transiente aktuelle
  Preview validieren; gespeicherte Evidence wird dadurch nicht geändert.
  Sessionliste, Sessiondetail und Approvaldetail benötigen die explizite
  `OPERATIONAL_EVENT_ID`; Queryparameter können fehlende Deploymentkonfiguration
  nicht ersetzen. Die bestehenden PR2-Guards prüfen Session-/Preview-Konsistenz.
- `imports/event_context.py::revalidate_confirmation_event`: dieselbe validierte
  Eventauswahl und dieselben aktiven Mappings; lediglich gebündeltes Laden von
  `Event.competition_mappings -> Competition` und Auffrischen der Identity-Map.
  Kein SELECT pro gemappter Competition mehr.
- `excel_import.py::infer_discipline_from_events`: vorhandene zeitbasierte
  Fallback-Projektion berücksichtigt ausschließlich Planungs-Events des
  Importevents. Weder neue Disziplinableitung noch neue Competition-Zuordnung.
- `accommodation_requirements.py::legacy_candidates`: vorhandene diagnostische
  Kandidatenprojektion über eventbezogene Personen; keine Anwendungsentscheidung.
- `routes/world_champions.py`: Liste und Detail verwenden den bestehenden
  eventbezogenen Query-/Get-Helfer; Schreiben in ein anderes Event wird ebenfalls
  abgewiesen. Recognition und Ausnahmeformeln selbst bleiben unverändert.

### UI / Reports / Exporte

`frontend/src/app/components/Dashboard.tsx` lädt Personen, Hotels, RoomTypes,
Bedarfsplanung, Bookings, Import-Sessions und Audit aus den vorhandenen APIs.
`RoomAnalytics.tsx` verwendet dieselben Personen-/Hotel-/Planungs-/Bookingquellen.
`Lists.tsx`, `lists/listEngine.ts` und `lists/listExports.ts` erzeugen die
Personen-/Nationen-/Hotel-/Kontingentlisten, Excel-Dateien und Druckdaten aus
bereits geladenen API-Daten. Es existiert kein zusätzlicher serverseitiger
operativer CSV-/Excel-Export mit eigener globaler Personenabfrage. Chart-CSV/PNG
nutzt ebenfalls die dargestellten Daten. Mock-FIS-ZIPs und technische DB-Backups
sind eigene administrative Dateifunktionen, keine operativen Personenreports.
Keine Frontenddatei oder Darstellung wurde geändert.

Globale Hotel-/RoomType-/Competition-Kataloge bleiben global; ihre operativen
Collections sind PR4-gefiltert. Championship-Stammdaten und EventCompetition-
Administration bleiben ausdrücklich administrative Kataloge, kein freigegebener
Eventselector und keine operative Multi-Event-Nutzung.

## 3. Audit / Aktivitäten: belegbare Herkunft statt Rekonstruktion

Neue Activity-Evidence nutzt `accommodation_scope.event_audit_refs` mit einem
kanonischen, serverseitig erzeugten Präfix:

```json
{"championshipEventId": "<validated owner>", "_scope": "OPERATIONAL_EVENT", "personId": "<existing reference>"}
```

Die bestehende Bedeutung von `entityRefs.eventId` bleibt erhalten: Bei
Bedarfsplanungs-Aktivitäten bezeichnet sie einen AccommodationEvent und darf
niemals als Championship-ID interpretiert werden. Alle bisherigen Referenzen
bleiben im Envelope enthalten. Die normale Mutation-Auditierung, atomare
Import-Confirm-Auditierung und World-Champion-Status-Evidence nutzen den Helfer.
Keine neue Auditplattform und keine neue DB-Spalte.

`routes/audit_events.py` begrenzt die SQL-Query **vor** Filter/Paginierung/COUNT.
Das Präfix wird mit LIKE-Escaping verglichen. Nur kanonisch markierte Datensätze
gehören zur normalen Eventansicht. Zusätzlich bleiben die bereits in PR3/4
atomar geschriebenen Import-Confirms lesbar, deren bekannte Quelle explizit
`eventId` im kanonischen JSON enthält (Action import, Typ import, POST auf
Session-Importpfad). Dies ist keine Ableitung aus Namen oder wiederverwendbaren
Personenreferenzen. Fremde IDs, unmarkierte Planungs-Event-IDs, unbekannte,
fehlerhafte oder nur globale technische Alt-Evidence wird nicht zugerechnet.

Historische Datensätze werden weder geändert noch gelöscht. Eine getrennte
administrative Rohhistorien-Diagnose wurde nicht neu eingeführt; falls benötigt,
ist sie ausdrücklich getrennt zu konzipieren. Das normale Activity-UI kann daher
weniger historische Einträge zeigen. Der Befund ist beabsichtigtes Fail-closed.

## 4. Acht bisherige Testfehler: Ursachen und gezielte Korrekturen

Keine Tests deaktiviert, keine Quoten-/Booking-Logik für grüne Tests verändert.

| Bisheriger Test | Befund / fachliche Begründung |
|---|---|
| `test_api_characterization::test_person_and_quota_aliases_keep_read_projection` | Personendetail besitzt bereits Workflowstatus und Coverage. Erwartung prüft jetzt OPEN_ASSIGNMENT und den fehlenden Aufenthaltszeitraum statt ein nicht mehr gültiges Feldverbot. |
| `test_api_route_safety::test_registered_paths_and_methods_match_reviewed_manifest` | Zwei bereits vorhandene PATCH-Routen für Unterkunftsbedarf/-tarif fehlten im Manifest. Nur diese Routen ergänzt; recheck nur in Sortierreihenfolge verschoben. Keine neue Route implementiert. |
| `test_assignment_planning_projection::test_quota_single_flag_is_not_derived_from_entitlement_or_occupancy` | Fixture enthält EZ-Wunsch; damit ist automatisches true beim Anlegen korrekt. Der Test fordert jetzt ausdrücklich false an und prüft unverändert dessen Erhalt nach Sharing, Entfernung und manueller Änderung. Aussagekräftiger Name angepasst. |
| `test_assignment_planning_projection::test_approved_extra_initializes_single_flag_independent_of_room_type` | Normales physisches EZ hat ebenfalls creation default true. Letzte Erwartung korrigiert, bestehende APPROVED_EXTRA-/explizites-false-Prüfungen erhalten. |
| `test_assignment_planning_projection::test_non_entitled_single_occupant_is_not_marked_exclusive` | Fixture hatte Single-Wunsch und damit legitimes true. Für die beabsichtigte Aussage nun explizit Double shared ohne genehmigte Ausnahme; false bleibt geprüft. |
| `test_import_extraction_characterization::test_preview_selects_only_active_mapping_and_preserves_unknown_error_structure` | Preview benötigt seit PR2 validiertes persistiertes Event und ReadContext. Isoliertes SQLite-Schema mit aktivem/inaktivem Mapping statt DB-loser SimpleNamespace-Fixture. Exakter bestehender Fehlervertrag bleibt geprüft. |
| `test_import_operational_impacts::test_live_quota_uses_import_entitlements_not_assigned_room_types` | Exakte Ganz-Dictionary-Erwartung ignorierte später ergänzte Function-/Tarif-/Coverage-Felder. Sämtliche ursprünglichen Quotenwerte bleiben exakt geprüft; neue kompakte Projektionen gesondert geprüft. Testname auf persistiertes countsAsSingle präzisiert. Alter Vier-Query-Budgetwert lag bereits hinter PR4-Event-/Coverage-Reads; begrenztes Sieben-Query-Budget und keine Zunahme bei zusätzlichen Personen. Eine warme Identity-Map darf einen SELECT sparen. |
| `test_wsc_membership_validation::test_missing_mapping_blocks_rows_and_confirmation` | Confirm-Tokenvalidierung benötigt seit PR3 DB/App-Kontext. Isoliertes SQLite-Schema ergänzt; derselbe Blocker wird weiterhin geprüft und schreibt keine Importdaten. |

Audit-Transporttests wurden zusätzlich an das additive Championship-Evidencefeld
angepasst. Die bestehenden personId-, Planungs-eventId-, Filter-, Rechte- und
Paginierungsprüfungen bleiben erhalten. Audit-Fixtures besitzen nun einen
expliziten Championship-Kontext und servermarkierte Datensätze.

Die PR2-Sessiongrenztests und `tests/test_safe_reimport.py` konfigurieren jetzt
ausdrücklich den jeweiligen operativen Testkontext. Zuvor blieb dieser in den
Fixtures leer und wurde allein per Request ausgewählt. Die zusätzlichen
Readmodel-Guards verlangen gemäß PR5 die Deploymentkonfiguration. Zwei-Event-
Szenarien wechseln diese ausschließlich in kontrollierten Testblöcken; bestehende
Ablehnungsprüfungen bei fremdem Event bleiben erhalten. Danach bestehen die
85 gezielten Identity-/Safe-Reimport-/PR5-Fälle einschließlich echter JPN-Dateien.

## 5. Performance / Cacheprüfung

Vergleich: PR4-Code (`6a5e5e0`, Baum identisch zu main `3c6653b`) gegen PR5.
Gleiche isolierte PostgreSQL-17-Daten: zwei Events, zwölf gemeinsame Hotels,
je Event 48 Personen und zwölf Buchungen, gemeinsame Competition, je Event
30 Auditzeilen, eigene archivierte LAT-Session. Sieben Requests pro Pfad mit
frischem App-/ORM-Kontext; Median der lokalen Laufzeit. Keine Produktionstests
und keine statistisch abgesicherte Lastmessung.

| API | Vorher SELECTs / Median ms | PR5 SELECTs / Median ms |
|---|---:|---:|
| Personen | 7 / 17,96 | 7 / 16,46 |
| Live-Quoten | 7 / 20,00 | 7 / 14,52 |
| Sessionliste | 37 / 20,12 | 6 / 6,14 |
| Aktivitäten | 2 / 3,06 | 3 / 5,36 |
| Room availability | 4 / 5,41 | 4 / 8,15 |
| Timeline | 2 / 2,86 | 2 / 3,91 |

Die Audit-Baseline enthält noch fremde Einträge und ist deshalb keine reine
Geschwindigkeitsreferenz. Ein zusätzlicher Event-SELECT ist beabsichtigt. Die kleinen lokalen Zeitwerte
schwanken sichtbar; insbesondere unveränderte Analytics-Queries sind kein
Nachweis einer fachlichen oder algorithmischen Performanceänderung.
Keine neue pro-Person-/pro-Hotel-HTTP- oder DB-Schleife. Requests ohne neue
Event-Metadaten oder eigene Daten verändern fremde Bestände nicht.

Request-Caches bleiben request-lokal. A→B→A wird mit derselben äußeren ORM-Session
geprüft, auch bei identischen FIS-Codes. ImportReadContext bleibt unverändert an
ein Event gebunden. Global gecachte Kataloge enthalten ausschließlich globale
Stammdaten, keine Personendaten. Keine neuen Indizes oder Migrationen notwendig.

Verbleibende bestehende Lazy Loads: gruppierter Booking-Reader pro Buchung,
Analytics pro globalem RoomType bzw. Planungs-Event und historische
Approval-/Versionsauflösung bei mehreren referenzierten Entscheidungen.
Diese wurden nicht neu eingeführt. Größere Optimierung oder ein neues historisches
Readmodel ist kein Bestandteil dieses PR. Audit-Präfixsuche kann ohne dedizierten
Index einen Tabellenscan benötigen; kein ungeprüfter Schemaumbau dafür.

## 6. Abnahme / Ergebnisse

Zwei explizit konfigurierte Championship-Events, gleiche FIS-Codes, Nationen,
Competitions und globale Hotels. Neue Fälle prüfen u.a.:

- Personenliste und Aliase, fremde Detail-IDs, A→B→A ohne Cachevermischung;
- fremde/nullable ImportRuns ohne Einfluss auf eigene Import-Präsenzflags;
- Live-Quoten und ungelöste Approval-Evidence ausschließlich im eigenen Event;
- Session-/Approval-IDs aus fremdem Event abgewiesen;
- unveränderte Daten vor/nach Quoten-, Session-, Analytics- und Personenreads;
- keine Quoten-Neubewertung aller Nationen beim Dashboard-Summary;
- mehrfache Memberships vervielfachen weder Personen noch Unterkunftskennzahlen;
- NO_ROOM, manueller SPECIAL-Tarif, APPROVED_EXTRA und gespeichertes false erhalten;
- World-Champion-Referenz/Recognition bleibt eventrein;
- Audit-COUNT/Paginierung/Filter nach Eventgrenze, unbekannte Altzeilen erhalten;
- bekannte atomare Importhistorie lesbar, Planungs-ID nicht als Championship benutzt;
- Queryparameter ersetzen keine fehlende OPERATIONAL_EVENT_ID;
- Querybudgets wachsen nicht mit fremden Personen oder mit Anzahl der Nationen;
- Legacy-Kandidaten und Planungs-Fallback ohne fremde Personen/Planungsdaten.

**Finaler vollständiger Backend-Lauf: 763 Tests und 1.204 Subtests erfolgreich,
keine Fehler und keine übersprungenen Tests (162,52 s).** Darin enthalten sind
alle 28 neuen PR5-Abnahmefälle, die bestehenden PR4-Schutztests, echte JPN-
Workbooks einschließlich Reimport sowie AUS- und Import-Performance-Budgets.
Die acht bekannten Fehler sind mit den oben begründeten Testkorrekturen behoben.

Lokale Protokolle und
synthetische Vergleichsmessung: `/tmp/pr5-reports/`, nicht versioniert.
Frontend: 141 Tests erfolgreich, Typecheck und Produktionsbuild erfolgreich
(8,46 s), keine Frontendänderung. Backup: 21 Tests und 14 Subtests erfolgreich.
Kein interaktiver Browsertest durchgeführt; tatsächliche HTTP-Readmodels werden
mit Flask-Testclient geprüft. Kein Deployment, kein produktiver Neustart,
keine produktive Migration und keine Datenbereinigung.

## 7. Grenzen / Vorbereitung PR6

- Vollständige Multi-Event-Freigabe bleibt gesperrt. Kein ActiveEventProvider,
  Eventselector, Event-ACL-System oder globale active_event-Variable.
- Globale Stammdatenadministration, technische Backupfunktionen und bereits
  ausdrücklich gesperrte destruktive Legacy-Werkzeuge sind keine Eventreports.
- Unbekannte historische Herkunft bleibt unbekannt; keine Eventzuordnung durch
  Rückschluss auf Namen oder das erste/aktive Event.
- Keine DB-RLS; direkte privilegierte SQL-Zugriffe bleiben organisatorisch zu
  schützen. Ein fremder Event darf über normale APIs nicht sichtbar werden.
- Keine neue WM-Disziplinquote, keine konfigurierbare Rule Engine und keine
  automatische Änderung historischer Genehmigungen beim Lesen.
- PR6 kann auf der eventreinen Personen-/Membershipmenge, unveränderten Quoten-
  Evaluatoren und explizitem Recheck/Confirm aufbauen.

Unverändert: Officials-/EZ-Formeln, countsAsSingle und gespeichertes false,
APPROVED_EXTRA, Sondertarif, NO_ROOM, Importprecedence, manuelle Preservation,
Coverage, Split/Join und Hotel-/Accommodation-Bestandsdaten. Keine neue Tabelle,
Spalte oder Migration. Keine DB- oder Workbookdatei als Sourcebestand aufgenommen.
