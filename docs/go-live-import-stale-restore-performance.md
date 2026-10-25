# Go-live: Import-Stale, Restore-Vorbereitung und Performance

Basis: `main` de51fdb, gemergte PR337. Branch `codex/go-live-import-stale`.
Keine produktiven Datenzugriffe, Backups, Restores, Resets, Migrationen oder Deployments. Keine Schemaänderung. Der produktive Deploystand ist die Angabe des Operators; kein direkter VPS-Zugriff.

## A. Reproduzierbare Ursache und begrenzte Korrektur

Realer HTTP-Pfad, isoliertes PostgreSQL, synthetische LAT-Workbooks: Event 1, Version 1, vier neue Athleten, keine Entfernungen. `state()` unmittelbar nach Upload, nach drei Listen-/Detailrefreshes und nach Freigabe verglichen; zusätzlich gespeichertes Preview gegen die neu berechnete Detailprojektion verglichen.

| Prüfpunkt vor der Korrektur | Upload | Refresh | Freigegeben |
|---|---|---|---|
| DB-`stateFingerprint` unverändert/passend | ja | ja | ja |
| gespeicherter `inputFingerprint` passend | ja | ja | ja |
| Detailprojektion `inputFingerprint` passend | nein | nein | nein |
| Detailprojektion `planStale` | true | true | true |
| einzige abweichende Input-Komponente | quotaRulesRevision: fehlt → 1 | fehlt → 1 | fehlt → 1 |

`athlete_quota.project_preview()` setzt die aktive Revision. `create_fis_import_preview()` übernahm Snapshot und Digest in die Uploadantwort, ließ aber **quotaRulesRevision** aus. Genau diese Antwort wurde bei der Sessionanlage ohne Neuberechnung gespeichert und von `build_plan()` gefingerprintet. `_current_session_preview()` berechnet beim Detail-/Freigaberesponse neu und ergänzt die Revision. `verify_plan()` lehnte deshalb die Projektion ab, obwohl Fakten und Datenbank unverändert waren. Die UI deaktiviert dann „Importieren“.

Direkter Confirm des unveränderten gespeicherten Revision-1-Reviews war lokal bereits vor dem Fix erfolgreich (HTTP 200). Das trennt den falschen UI-Stale-Zustand vom echten Confirm-Konflikt. Bei einer aktiven Revision >1 fehlt dieselbe Metainformation auch im gespeicherten Review: `require_review()` interpretiert fehlende Revision historisch als 1 und weist dann ebenfalls zurück. Originale LAT-Dateien/produktive Fehlerresponse waren hier nicht vorhanden; die beschriebenen Befunde sind lokale reproduzierte Codepfade, keine Aussage über eine ausgelesene Produktionssession.

### Änderungen

- `backend/excel_import.py`: bereits berechnete Revision in Uploadantwort und damit den initialen gespeicherten Prüfstand übernehmen. Kein zweiter Regelresolver, keine zusätzliche Query.
- `backend/app.py`: Legacy-Kompatibilität ausschließlich für gespeicherte Reviews **ohne** Revisionsfeld, deren aktuelle Projektion ausdrücklich Revision **1** hat. Für den Projektionsvergleich wird nur dieses nachträglich ergänzte Feld entfernt. Gespeichertes JSON, Plan, Digest und Genehmigungen bleiben unangetastet. Alle übrigen Inputfelder und der vollständige DB-Fingerprint werden weiterhin geprüft.
- `imports/change_plan.py` (`state`, `build_plan`, `verify_plan`), `require_review`, Locking, Confirm, Scope-/Löschbestätigung und Idempotenz bleiben unverändert.

Kein generisches Ignorieren von Revisionen, kein Neuaufbau eines Plans beim Lesen, keine automatische Freigabe oder Löschung. Alte Reviews mit fehlender Revision bei aktueller Revision >1 müssen ausdrücklich neu geprüft werden; keine heuristische Umschreibung historischer Evidence.

### Abdeckung

Neue HTTP-Regressionen in `test_import_projection_stability.py`: Erstimport Revision 1 und 2, Legacy-Review Revision 1, Refresh ohne JSON-/Stateänderung, Freigabeantwort weiterhin aktuell, Confirm erzeugt genau vier Personen, vollständiger Import einer anderen Nation macht LAT nicht veraltet, tatsächliche Regelrevision macht Legacy-Review veraltet und Confirm liefert `QUOTA_RULES_CHANGED`/409.

Bestehende Suite deckt weiterhin Änderungen an Personen, Buchungen, Memberships, Mapping und Genehmigungen derselben Nation, Änderung nach Freigabe, neue Sessionversionen, Rollback und parallelen Confirm (genau ein Abschluss plus idempotente Antwort) ab. Sessionstatus/Freigabeaudit ändern den normalisierten Bestandsfingerprint absichtlich nicht. Kein Eingriff in diese Normalisierung.

## B. Restore-Vorbereitung ohne Aufweichung des Schutzes

`DatabaseBackups.tsx`: vorhandene Sicherung öffnet über die Listenaktion bereits im Normalbetrieb die Vorbereitung. Anzeige des Dateinamens, globalen Datenbankumfangs, automatischen Sicherheitsbackups und Wartungshinweisen. Vorbereitung erzeugt keinen Restore-Request.

Die Ausführung bleibt zweifach geschützt:

1. UI-Handler und Bestätigungsbutton verlangen weiterhin `maintenanceMode === true` **und** serverseitige Restorecapability.
2. Backend verlangt weiterhin `database.restore`, serverseitigen `DATABASE_MAINTENANCE_MODE` und `RESTORE DATABASE` als ausdrückliche Bestätigung. Bestehende Datei-/Pfadvalidierung, Sicherheitsbackup, Restore-Lock und Staging bleiben unverändert.

Ein berechtigter Operator setzt die Variable im tatsächlich vom Backend verwendeten Deployment-Environment, führt den kontrollierten Backend-Neustart/Recreate im vereinbarten Wartungsfenster durch und lädt die Ansicht neu. Operative Schreibrequests sind dann gesperrt. Vorher aktive Arbeiten abstimmen und Sicherungs-/Restoreprobe prüfen; nach erfolgreicher Wartung die Variable kontrolliert zurücknehmen. Keine Frontend-Umschaltung, keine automatische Ausführung solcher Betriebsschritte durch diesen PR.

UI-Tests prüfen Anweisung, Dateiname, globalen Umfang, Rechtewarnung und Hinweise im autorisierten Modus. Chromium: Listenaktion ohne Modus nutzbar, Ausführung gesperrt, null Restore-Requests, Dialog bei 390 px ohne horizontalen Überlauf. Backupliste/Status im Browser hierfür simuliert; **kein tatsächlicher Restore** ausgeführt. Serverseitige Schutzmaßnahmen werden durch die vorhandenen Backend-/Backup-Suites geprüft.

## C. Gemessene Performance, unveränderte Auslieferung

Isolierte lokale Umgebung: PostgreSQL17, synthetischer Bestand 300 Personen, 45 Hotels, 109 Kontingente, sieben Planungs-Events, bestehende Genehmigung/Belegungen, zusätzliche isolierte Importreviews. Headless Chromium auf Loopback, neue Browserkontexte ohne Browsercache. Keine Netz-/CPU-Drosselung. Derselbe Backenddienst für Dev-Frontend und gebaute Anwendung; keine Produktionsmessung/SLA.

### API/SQL

Flask-Testclient, eine Aufwärmanfrage plus drei Messungen; Median der gesamten Requestdauer. SQL-Zeit anhand before/after_cursor_execute, ohne Netzwerk zum Browser. Zeitbereiche sind die drei SQL-Summen; Queryzahl jeweils konstant.

| Endpoint | Requestmedian ms | SQL-Queries | SQL-Zeit ms | Payload Bytes |
|---|---:|---:|---:|---:|
| /api/admin/events | 1,93 | 1 | 0,41–0,60 | 1.804 |
| /api/import/sessions | 7,06 | 8 | 2,17–2,39 | 6.720 |
| /api/import/sessions/:id (vier LAT-Personen) | 54,73 | 37 | 19,50–21,08 | 16.966 |
| /api/athletes | 57,06 | 13 | 10,10–11,28 | 780.824 |
| /api/room-assignments | 22,12 | 10 | 5,97–6,54 | 8.958 |
| /api/assignments/planning-view?includeValidations=false | 66,95 | 12 | 11,70–16,13 | 873.744 |
| /api/fis/official-quotas | 42,13 | 11 | 8,64–10,34 | 54.601 |

Die PR336-Budgets 13/10/12/11 bleiben erhalten. Detailprüfung hat bewusst mehr Queries für Bestand/Evidence; kein Beleg für eine pro-Person-Schleife aus dieser Einzelmessung. Keine neue Query im Fix. Strukturelle Import- und Approval-Projektionsbudgets zusätzlich per Tests geprüft.

### Browservergleich

Vite-Devserver gegen `vite preview` des erfolgreichen Produktionsbuilds, ausschließlich als lokales Vergleichswerkzeug. **Vite preview ist keine vorgeschlagene Produktionsserver-Lösung.** Zahlen aus einem kontrollierten Folgepass nach initialem Dev-Dependency-Aufwärmen. `ready` = Navigation bis networkidle einschließlich 500-ms-Idle-Schwelle, keine isolierte React-Renderdauer. Transfer = Summe ResourceTiming.transferSize der Unterressourcen einschließlich APIs/HTTP-Overhead. Lokales Preview liefert komprimierte Assets; ein späterer statischer Produktionsserver muss Kompression ebenfalls korrekt konfigurieren.

| Ansicht | Dev ready ms / Ressourcen / Transfer | Build ready ms / Ressourcen / Transfer | API-Anzahl / maximal parallel |
|---|---|---|---|
| Administration | 1.283 / 90 / 6.590.361 B | 910 / 33 / 291.758 B | 6 / 3 |
| Import | 1.318 / 94 / 6.631.363 B | 931 / 24 / 275.548 B | 4 / 2 |
| Dashboard (/) | 1.533 / 81 / 6.896.072 B | 1.060 / 13 / 1.023.907 B | 11 / 8 |

Backend-HTTP-Zeiten im gebauten Browserlauf: Administration-Fachrequests jeweils39 ms, Importliste73 ms, Dashboard-Fachrequests77–272 ms. Gleichzeitige Requests enthalten Wartezeiten/Backendkonkurrenz und sind nicht mit seriellen Testclientmedians gleichzusetzen.

Nach networkidle in weiteren zwei Sekunden **null** zusätzliche Requests auf allen drei Seiten, in beiden Varianten. Kein gemessener Requestloop. Zweimal `/auth/me` bedeutet GET Benutzer plus POST bestehende Benutzerbeobachtung; keine zwei identischen Datenrefetches. Import lädt initial nur die Sessionliste; ein direkt verlinkter Review lädt zusätzlich das gewählte Detail. Freigabe lädt anschließend die Liste einmal; Confirm lädt Detail und Liste einmal. Kein Anlass, diese Sicherheits-/Aktualisierungsrequests pauschal zu entfernen.

PerformanceObserver long tasks (>50 ms): Dev Admin106 ms, Import106 ms, Dashboard99+54 ms; Build Admin58 ms, Import keine, Dashboard54+53 ms. Das sind Main-Thread-Blockaden, **keine exakt gemessenen React-Commitzeiten**. Initialer erster Dev-Lauf war zusätzlich langsamer (Admin3.574 ms mit Dependency-/HMR-Aufwärmung); kein stabiler Backendregressionsnachweis. Kein Renderingrefactoring auf Grundlage dieser wenigen Samples.

### Kleiner sicherer Vorschlag zur Auslieferung

Repositorybefund: `frontend/Dockerfile` startet `pnpm run dev`; `nginx/nginx.conf` leitet Frontendzugriffe an Port5173 mit HMR-Upgrade weiter. Compose bindet Quellcode. Das belegt die Konfiguration, nicht den tatsächlich laufenden VPS-Container.

Separat reviewbarer nächster Betriebsschritt, **hier nicht umgestellt**:

1. Operator prüft lesend Image/Commit und laufendes Entrypoint des Frontendcontainers sowie ResourceTiming/HAR ohne Cookies/Personenpayloads. Keine komplette Environment-Ausgabe.
2. Unveränderliches Multistage-Frontendimage mit unterstütztem Node-Build, `pnpm install --frozen-lockfile`, erfolgreichem Typecheck/Build und `VITE_API_URL=/api` erstellen. Keine Environmentdateien ins Image übernehmen.
3. Gebautes dist mit kleinem statischem Webserver auf bestehendem internen Port5173 ausliefern, SPA-Fallback, Kompression und Cache für gehashte Assets; index.html nicht langfristig cachen. Keine Source-/node_modules-Bindmounts. Bestehenden äußeren `/api`-/Authelia-Proxy unverändert lassen.
4. Zuerst isoliert/staging prüfen: Deep Links, Auth/Eventwechsel, Importupload/Freigabe/Confirm, globale Backupinformationen, fehlende HMR-/Source-Requests, gleiche APIs/Ergebnisse. Dann ausdrücklicher Deploymentreview; altes Image als Rollback verfügbar halten. Keine DB-Migration für diese Auslieferung nötig.

Messbarer Nutzen hier: erheblich kleinere Frontendtransfers und weniger Ressourcen. Keine Zusage zur Gesamtbeschleunigung auf dem VPS, solange dessen tatsächliche Auslieferung und Ressourcen nicht gemessen sind. Kein zusätzlicher Performancecode oder allgemeines Refactoring in diesem PR.

## Regression und Grenzen

- Vollständiges Backend, abschließender Lauf: **895 Tests +1.298 Subtests bestanden** (229,07 s), einschließlich der fünf neuen Fälle. Die echten angehängten JPN-Workbooks wurden dabei verwendet.
- Gezielte Import-/Reimport-/Performanceprüfung: 44 bestanden, ein echter JPN-Dateifall in diesem Teillauf mangels Umgebungsvariablen übersprungen; vollständige Suite verwendet die angehängten JPN-Dateien.
- Frontend: 177 Tests bestanden, einschließlich drei neuer Restore-Informationstests; Typecheck und Produktionsbuild erfolgreich.
- Backup: 22 Tests +14 Untertests bestanden.
- `git diff --check`: erfolgreich.
- Chromium lokal: LAT Upload/Freigabe/Refresh, aktiver Importbutton ohne falsches stale, anschließender echter Browser-Confirm mit vier neu angelegten synthetischen LAT-Personen und ohne Entfernungen; Restore-Vorbereitung und schmaler Dialog ohne Restore-Ausführung. Parallele Confirmfälle zusätzlich echte Backend-HTTP-Tests.

Keine Änderung an Quoten, EZ, Tarifen, NO_ROOM, Coverage, Importidentität, Snapshot-/Preservation-Semantik, Berechtigungen oder Restore-Schutz. Keine produktiven Daten oder lokalen Zugangsdaten im Patch. Freigabe und Deployment erfolgen ausdrücklich separat.
