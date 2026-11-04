# Final Go-live Admin Polish

Basis: `main` **a08d42e**, einschließlich gemergter PRs335/336. Branch: `codex/go-live-admin-polish`. Repository-Migrationshead vorher: `20261025_01`, neu: `20261025_02`. Der produktive Datenbankstand wurde nicht direkt abgefragt; die produktiven Angaben zu gesundem Backupservice und Sicherungen vom 24./25.10.2026 stammen vom Operator. Kein Deployment, produktiver Datenbankzugriff, produktives Backup, Restore, Reset oder produktive Migration durch diesen Auftrag.

## Umsetzung

### 1. Globale Backupverwaltung, ausdrücklich begrenzte Autorität

`auth.py` verwendet bestehende Administratorrollen (`*`) und ergänzt für den verifizierten konfigurierten Superadmin explizite Funktionsrechte. Keine neuen Authelia-Gruppen, EventAccess-Einträge, Gruppenvererbung oder neue Benutzerverwaltung.

| Aktion | Funktionsrecht | Weitere Schranken |
|---|---|---|
| DB-/Backupstatus, Liste | database.read | authentifizierter Admin/Superadmin |
| Backup erzeugen, hochladen/validieren | database.backup | bestehende Dateivalidierung; zentraler Backupservice |
| Vollständigen Dump herunterladen | database.export | sensitiver globaler Export; bestehende Kategorie-/Pfadvalidierung |
| Restore | database.restore | DATABASE_MAINTENANCE_MODE=true; Bestätigung RESTORE DATABASE; bestehende Validierung, Sicherheitsbackup, Staging und Restore-Lock |
| Reset | database.reset | Wartungsmodus; Bestätigung RESET EVENT DATA; explizites/pin-kompatibles Ziel; bisherige Scope-/Mehr-Event-Historienschutzprüfungen |

Globale Backuprechte benötigen keine individuellen Eventfreigaben und keinen operativen Pin. Normale Benutzer bekommen sie auch mit Event-Schreibrecht nicht. Die Berechtigung wird anhand einer exakten Endpoint→Funktionsrecht-Zuordnung geprüft. Ein GET-Download ist ausdrücklich kein Metadatenlesen. Superadmin erhält nicht pauschal das generische `admin.reset`-Recht anderer Verwaltungswerkzeuge.

**Wartungsmodus:** neue Umgebungsvariable `DATABASE_MAINTENANCE_MODE`, standardmäßig false; nur der Operator kann sie serverseitig freigeben. Requestpayloads können sie nicht aktivieren. Der Modus sperrt normale operative und administrative Schreibrequests mit503. Authentifizierungsbeobachtung, geschützte Backupoperationen und explizit bestätigter Reset bleiben möglich. Vor dem Fenster laufende Requests muss der Operator zusätzlich auslaufen lassen. Ein Reset kann den Pin nicht umgehen; globale Historienbereinigung bei mehreren Events bleibt blockiert.

Der Status liefert getrennte serverseitige capabilities plus maintenanceMode. Die UI aktiviert Create/Upload/Download entsprechend; Restore benötigt ausdrücklich auch maintenanceMode=true, fehlt dieses Feld etwa bei einer veralteten Backendversion, bleibt Restore gesperrt. Reset ist gesondert gesperrt und bestätigt. Fehler403 sind verständlich, Status und Liste unabhängig. Backup-Erfolg, letzter Fehlschlag, DB-Erreichbarkeit und Wartungsmodus sind getrennt erkennbar. HTTP-Health allein ist kein Sicherungsnachweis. Restore-Statuspolling ist begrenzt und beendet sich bei terminalen Authfehlern.

**Audit:** sensible Backup-/Export-/Restoreanforderungen werden vor Ausführung mit Actor, Request-ID und Operation im bestehenden AuditEvent protokolliert. Alle Backup-Endpunkte, auch Status/Liste und Fehler, protokollieren Operation/Actor/HTTP-Ergebnis im Backendlog. Ein202 ist eine angenommene Anforderung, kein bestätigter pg_dump-Erfolg; der tatsächliche Ausgang bleibt im bestehenden Backupservice-Log und last-backup.json. Keine Tokens, Cookies, Dateiinhalte oder Verbindungspasswörter werden in diese neuen Audits aufgenommen. Der Operator muss Systemlog-Retention auch über Containerwechsel sicherstellen; gerade Restore kann den Datenbank-Auditbestand absichtlich auf einen früheren Stand zurücksetzen.

**Parallelität:** der HTTP-Handler reserviert den vorhandenen BACKUP_LOCK atomar vor dem Workerstart; eine zweite manuelle Anfrage erhält409 statt eines zweiten202. Derselbe Prozess-Lock schützt weiterhin Scheduler/CLI-Backupausführung. Scheduler,03:00UTC, Volumes und Retention sind unverändert. Keine zusätzlichen Backupcontainer skalieren oder parallele separate CLI-Prozesse als vermeintlich gleichwertigen Mutex benutzen.

### 2. Administration versus operative Eventauswahl

`admin_scope.py` erlaubt nur ausdrücklich aufgeführte Eventkonfigurations- und Referenzendpunkte ohne operativen Pin. Funktionsberechtigter Admin/Superadmin darf Events einschließlich inaktiver zukünftiger Veranstaltungen konfigurieren. Ziel ist die validierte Pfad-ID; ein mitgesendeter abweichender administrativer Header wird abgewiesen. Der Zielkontext ist ausschließlich requestlokal. Globale Titelstammdaten bleiben administrative Referenzen, keine operativen Personen.

Personen, ImportSessions, Buchungen, Kontingente, Bedarfsplanung und operative Quotenendpunkte benutzen unverändert die bisherigen EventAccess-/Pin-Prüfungen. Keine dauerhafte Rechtevergabe durch Eventanlage oder administrative Auswahl. Gepinntes beziehungsweise letztes aktives Event bleibt gegen unbedachtes Deaktivieren geschützt.

Frontend: lokale Auswahl des administrativen Ziel-Events, Hinweis auf unveränderten operativen Kontext, keine automatische Umschaltung. Quotenentwürfe/Revisionen und WM-Auswahl sind auch bei einem anderen operativen Pin administrativ bearbeitbar. Hat ein normaler Admin überhaupt keine operative Eventfreigabe, stellt derselbe ActiveEventProvider ausschließlich Administration bereit; kein zweiter Provider/State und keine operativen Ansichten. Explizit adressierte Managementrequests funktionieren ohne operative Lease, operative API-Aufrufe nicht. Auch die Eventanlage aus diesem Zustand schaltet kein neues operatives Event frei.

### 3. Ganze Weltmeisterliste

Vorhandene zentrale Titel werden nach Championship+Jahr zu Listen zusammengefasst; keine neue Titelkopie und keine neue Listen-/Personenplattform. Die bestehende zentrale Verwaltung mit Editionen bleibt erhalten. Neue schlanke API: GET `/api/admin/world-champion-lists`, GET/PUT `/api/admin/events/<id>/world-champion-list`.

`Event.world_champion_list_json` hält die ausdrücklich ausgewählte Edition und ihre Titel-IDs. Vorhandene vollständige Anerkennungssätze werden lesend erkannt, einschließlich bisheriger vollständiger Legacy-Anwendbarkeit. Teil-/Mehrfachzuordnungen werden als solche gemeldet; daraus werden keine neuen Anerkennungen abgeleitet. Ein Speichern ist eine ausdrückliche Benutzeraktion mit Vergleichsdigest und bestehenden Transaktionslocks.

Die Auswahl verwendet WorldChampionRecognition für die ganze Liste. **Engadin2025 umfasst35 Titelreferenzen, davon26 berechtigte Einzeltitel und9 Teamtitel.** Alle35 bleiben Referenzen; die automatische Erkennung berücksichtigt ausschließlich aktive, entitlement_enabled INDIVIDUAL-Titel und nur bei is_world_championship=true. Teamtitel erzeugen keine automatische EZ-Ausnahme. Eine Liste kann mehreren Events zugeordnet sein; WorldChampion bleibt derselbe globale Datensatz.

Die gespeicherten IDs sind ein expliziter Auswahlsnapshot. Später ergänzte Titel werden nicht ungeprüft auf bereits ausgewählte Events übertragen; dieselbe Liste kann ausdrücklich erneut zugeordnet werden. Individuelle technische Anerkennungsendpunkte bleiben für Legacyzustände bestehen, dürfen eine gespeicherte Ganzlistenauswahl aber nicht übersteuern.

Ein Wechsel/Entfernen, das historisch verwendete Anerkennungen entfernen würde, wird konservativ mit409 blockiert und verlangt gesonderte Prüfung. Titeländerungen behalten den vorhandenen historischen Schutz. Personen, Importversionen, Genehmigungen und bestehende manuelle/historische Ausnahmen werden nicht automatisch umgeschrieben. Bei Nicht-WM werden keine neuen automatischen Ausnahmen erteilt; bereits gespeicherte historische Entscheidungen werden bewahrt. Manuelle OTHER-/bestehende Ausnahmen behalten ihre bisherige Semantik.

### 4. FIS-Vollsnapshot ohne zusätzliche Checkbox

Die reguläre Sessionpipeline verwendet weiterhin den serverseitigen FULL_NATION-Änderungsplan. Im Frontend entfällt der zusätzliche Vollständigkeitszustand samt Checkbox; die kurze Ersetzungserklärung bleibt sichtbar. Backend-Approve akzeptiert fehlendes snapshotScope als FULL_NATION; ein ausdrücklich anderer Scope wird weiterhin abgewiesen. Es gibt keinen neuen Teilimportmodus.

Unverändert zwingend: aktueller planDigest, konkrete Importversion, gültige Regeln/Evidence, abgeschlossene Genehmigungsentscheidungen, ausdrückliche Freigabe des gesamten Plans und bei Entfernungen die gesonderte Bestätigung der konkreten Personen-/Membership-/Buchungsfolgen. Erst Confirm führt den Plan atomar aus. Keine Löschung bei Upload/Preview. Event+Nation, Partner-/Buchungsprüfungen, historische Approval-Evidence und kontrollierte Entfernungsoperationen bleiben erhalten. Legacy-Backendkompatibilität wird nicht zu einem neuen Operatorworkflow ausgebaut.

Offene alte Reviews werden weder freigegeben noch verändert. Durch die neue Spalte kann sich der Bestandsfingerprint alter gespeicherter Pläne ändern: diese werden kontrolliert stale und müssen per bestehendem Recheck neu geprüft werden. Bereits abgeschlossene Versionen bleiben lesbar. Eine explizite neue Listenauswahl ist ebenfalls relevante Event-Evidence und kann offene Pläne invalidieren.

### 5. Permanenter Healthcheck

Compose verwendet dauerhaft `http://127.0.0.1:8080/health`, wie produktiv vom Operator bestätigt. Der obsolete version-Eintrag entfällt. Keine Änderung von Backups, Zeitplan, PostgreSQL-Service, Volumes, Retention oder Netzwerkfreigaben.

## Migration und Bestandsintegrität

`20261025_02_champion_list_selection.py` führt ausschließlich `ADD COLUMN championship_event.world_champion_list_json TEXT NULL` aus. Kein UPDATE/INSERT/DELETE, keine automatische Listenauswahl, keine Titelanerkennung, keine WM-Kennzeichnung, keine Quotenfixierung. PostgreSQL führt DDL transaktional aus. Ein injizierter Fehler nach ADD COLUMN hinterlässt weder die Spalte noch eine hochgesetzte Alembicversion.

Bestandsmigrationstest: Upgrade vom bisherigen Head01, Vergleich **jeder bestehenden Tabelle und jeder bestehenden Zeile** mit ausschließlich dem erwarteten neuen NULL-Feld; Wiederholung von upgrade head ändert nichts. Die bisherigen historischen Migrationstests prüfen weiterhin ihren bisherigen Zielstand01; die neue Migration und die gesamte Headkette werden zusätzlich geprüft. Keine Tests deaktiviert.

Unverändert durch Migration/Implementierung: Hotels,109 produktive Kontingente, sieben AccommodationEvents/EventRoomDemand, Personen/Memberships, Buchungen, Importhistorie, historische Genehmigungen/Revisionen, Weltmeistertitel und bisherige Auditzeilen. Explizite neue Adminaktionen schreiben nur die jeweils bestätigte Konfiguration/Zuordnung und neue Audits. Keine produktiven Aktionen wurden ausgeführt. Keine neuen Quotenformeln, Gebühren, SPECIAL-/NO_ROOM-Zuordnungen, countsAsSingle-, APPROVED_EXTRA-, Coverage-, Split-/Join- oder Import-Matching-Regeln.

## Prüfungen

- Vollständige Backend-Suite mit echten JPN-Dateien: **890 bestanden, 0 übersprungen;1.298 Subtests bestanden**. Enthält Migrationen, Import-/Reimport- und Performancebudgets. Letzter kompletter Lauf204,00s; bestehende datetime/SQLAlchemy-Deprecationwarnungen.
- Frontend: **174 bestanden**; Typecheck und Production Build erfolgreich. Bestehende Vite-Chunkgrößenhinweise bleiben.
- Backup: **22 bestanden plus14 Subtests**, inklusive atomarer manueller Lockreservierung.
- Compose-Konfiguration ohne Env-Ausgabe/Envauflösung validiert; git diff --check erfolgreich.
- Neue HTTP-Fälle: Admin und Superadmin ohne Eventgrants, fremde/inaktive Konfiguration unter Pin, unberechtigte Benutzer, Restore ohne Modus/Bestätigung, gesperrte Schreibrequests im Wartungsmodus,35-Referenzliste/26 berechtigte Titel, Nicht-WM, historische Konflikte, Teilzuordnung, Vollsnapshot ohne Scopefeld und Entfernung erst nach ausdrücklichem Confirm.
- Reale Chromium-Prüfung auf synthetischer lokaler DB: Eventanlage/Speichern und direkte Konfiguration, andere Eventkonfiguration/WM-Zuordnung trotz Pin, kein operativer Kontextwechsel, operative Fremdabfrage409; Admin ohne irgendein EventAccess erhält nur Administration und Personenabfrage403; Backupbuttons aktiv; Upload eines echten synthetischen FIS-Workbookpaars erreicht Review ohne Vollständigkeitscheckbox. Zusätzliche Browserfälle prüfen schmale WM-Auswahl, getrennte403-Fehler, fehlende Wartungsfreigabe trotz Restorecapability und den globalen Warn-/Bestätigungsdialog. Kein Restore/Reset und keine produktive Aktion. Backupstart-UI wurde mit abgefangenem202 geprüft, kein Dump erzeugt; tatsächliche Delegation/Validierung wird separat durch Backend-/Backup-Suite geprüft.

### Performance

300 Personen und eine Genehmigung für20 Personen: SQL-Budgets weiterhin **13** Personen, **10** Buchungsalias, **12** Dispositionsplanung, **11** Officials-Quote. Keine Änderung am requestlokalen Approval-Kontext aus PR336. Ganze JSON-Antworten der vier Endpunkte haben weiterhin exakt dieselben kanonischen SHA256-Werte wie im Bericht `production-stability-fix.md`. Kontrollierter Vergleich auf derselben synthetischen DB, jeweils Minimum zweier frischer Requests:

| Endpoint | PR336 ms / SQL | Dieser PR ms / SQL |
|---|---:|---:|
| Personen |133,49 /13|145,61 /13|
| Buchungen |23,06 /10|20,66 /10|
| Dispositionsplanung |67,87 /12|64,73 /12|
| Officials-Quote |51,85 /11|36,79 /11|

Die kleine Personenzeitabweichung dieser zwei Samples ist kein belastbarer Regressionsnachweis; Querybudgets und exakte Ergebnisse sind unverändert, der mehrsekündige Approval-Engpass kehrt nicht zurück. Lokale Laufzeiten variieren; sie sind keine Produktions-SLA. Kein Requeststorm durch globale Adminrechte; Admin-Fallback lädt keine operativen Daten.

## Produktionsdiagnose und Go-live

Read-only vorab, im richtigen Compose-Projekt durch den Operator; keine Roh-Env-/Cookie-/Dumpausgaben teilen:

```sh
git rev-parse --short HEAD
docker compose ps
# Datenbankversion ausschließlich lesen; Variablen werden im Container verwendet.
docker compose exec -T postgres sh -c 'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "BEGIN READ ONLY; SELECT version_num FROM alembic_version; COMMIT;"'
docker compose exec -T backup python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8080/health',timeout=5).status)"
```

Zusätzlich vorhandene read-only Routine aus der Stabilitätsanalyse für CPU/RAM, Backupalter/Anzahl, Clientversionen, Locks/Verbindungszahlen nutzen. Weder healthy noch vorhandene Dateinamen ersetzen eine Restoreprobe.

1. Versions-/Schema-Preflight: tatsächlich laufende Images/Bindmounts und DBversion prüfen; bestehende Konfiguration, Anzahl/IDs der geschützten Bestände und vorhandene Anerkennungen sichern. Für die WM das tatsächliche is_world_championship prüfen; keine automatische Korrektur nach Name/Jahr. Falls nötig ausschließlich bestehende Quotenrevision ausdrücklich verwenden.
2. Änderungen/Imports auslaufen lassen und Benutzerzugriff für den Rollout am bestehenden Proxy kontrolliert pausieren. **Frisches Backup vor DDL** durch den Operator über den freigegebenen Bestandsweg; eine202-Antwort reicht nicht, aktuellen Erfolg/Erstellzeit/Größe prüfen. Das interne Service-HTTP startet im selben Lockprozess; keinen konkurrierenden zweiten Backup-CLIprozess starten. Sicherung außerhalb des Containers aufbewahren und in einer getrennten, expliziten Testumgebung wiederherstellen. Kein Produktionsrestore als Smoke-Test.
3. Backend und Backupimage mit Revision02 sowie Frontend gemeinsam vorbereiten. Der Backendentrypoint führt upgrade head aus; die Spalte muss vor Requests des neuen Modells vorhanden sein. Kein Reset, keine Neuinitialisierung, keine automatische Bestandszuordnung. Eine lange offene Transaktion/DDL-Lockwartezeit ist ein Abbruchgrund, kein Anlass für erzwungenes Beenden produktiver Transaktionen.
4. Mit DATABASE_MAINTENANCE_MODE=false starten. Vorher-/Nachher-Vergleich aller alten Spalten/Beziehungen, neue Auswahlfelder NULL, Versionsnummer02 und Healthchecks kontrollieren. Scheduler03:00UTC, Volume und Retention unverändert prüfen.
5. Admin/Superadmin: Status, Backupliste, bewusst manuelles Backup und tatsächlichen Erfolg prüfen; Download/Upload nach Freigabe. Normaler Benutzer bleibt gesperrt. Restore/Reset außerhalb des Modus409. Keine echten Restore-/Reset-Smokeaktionen.
6. Eventverwaltung: zukünftiges Testevent anlegen/konfigurieren, dabei operative Auswahl unverändert; fremde operative Personen/Imports/Kontingente bleiben gesperrt. WM-Liste nur nach Prüfung ausdrücklich zuordnen. Bereits vollständige Zuordnungen werden lesend erkannt; unklare/geschützte Bestände nicht automatisch bereinigen.
7. Vor Go-live offene Reviews rechecken; Plan/Entfernungen und Genehmigungen vor Confirm prüfen. Erstimport und identischer/geänderter Reimport zuerst isoliert, nicht mit Testpersonen in Produktion. Operativen Eventwechsel nur im erlaubten Deployment prüfen; Pin nicht als Testmaßnahme entfernen.
8. Erst nach Freigabe normalen Zugriff öffnen. Logs/Audits und CPU/SQL-Latenzen beobachten. Eine spätere echte Wiederherstellung ist ein eigener autorisierter Wartungsvorgang: Wartungsmodus=true, Requests auslaufen lassen, Schedulerfenster vermeiden, explizite Bestätigung; anschließend Verifikation, Modus=false und kontrollierte Wiederaufnahme.

## Rollback ohne Datenverlust

Bevor deployt wird, eine getestete Rollbackrelease vorbereiten. **Ein altes unverändertes Image kennt Alembicrevision02 nicht und kann beim automatischen upgrade head scheitern.** Die Rollbackrelease muss die additive Revision02 behalten; die zusätzliche nullable DBspalte bleibt bestehen und kann vom bisherigen Anwendungscode ignoriert werden. Backupimage/Migrationswerkzeuge müssen die neue Revision ebenfalls kennen. Nicht auf01 stampen und die benutzte Auswahlspalte nicht löschen.

Bei Problemen Zugriff wieder pausieren und laufende Writes abwarten. Anwendung auf die vorbereitete kompatible Release zurücksetzen; Datenbank, neue Spalte, Titel/Recognitionlinks, Audits und zwischenzeitliche echte operative Writes erhalten. Kein DBrestore nur für Code-Rollback. Ein Downgrade ist bei gespeicherter Auswahl bewusst blockiert.

Rollback auf PR336 stellt dessen frühere Backup-/Pinbeschränkungen und frühere Weltmeisterinterpretation wieder her. Daher insbesondere Imports unter einer zurückgerollten Interpretation nicht ungeprüft wieder freigeben. Bevorzugt gezielter Roll-forward; nach Code-Rollback Diagnose und ausdrückliche Wiederaufnahme. Alle Titel-/Auswahländerungen bleiben auditierbar; keine automatische Rückbereinigung.

## Offene Freigabepunkte

Keine bekannten lokalen Testfehler. Nicht durch Codex geprüft: tatsächlicher produktiver Alembicstand/WM-Flag, aktuelle vollständige Backup-/Restorefähigkeit, VPS-Ressourcen und das reale Auth-/Proxy-Rolloutfenster. Das sind operative Freigabevoraussetzungen, keine automatisch ausgeführten Aktionen. Historisch geschützte Listenwechsel bleiben bewusst ein manueller Prüfbedarf. Die bestehende Vite-Devserver-Auslieferung und zusätzliche UI-Optimierungen sind nicht Teil dieses fokussierten PR.

## Dateien / Scope

Backend: `admin_scope.py`, `champion_lists.py`, `app.py`, `auth.py`, `config.py`, `database_admin.py`, `models.py`, `routes/events.py`, `routes/world_champions.py`, `world_champions.py`; additive Migration02. Backupservice: ausschließlich Reservierung des bestehenden manuellen Locks; Compose: Healthadresse/version. Frontend: vorhandene Admin-, Backup-, Event-/WM- und Importkomponenten, vorhandener Provider/Transport und App-Integration für den Admin-only-Fall. Tests: neue Go-live-/Migrationstests, aktualisierte Rollen-/Scope-/WM-Fixtures und Routenmanifest, Backup-Locktest sowie bisherige Performancebudgets. Environment: nur das Beispiel mit deaktiviertem Wartungsmodus. Keine DBdateien, echten Workbooks, lokalen Zugangsdaten, produktiven Event-IDs oder Build-/Dependencyartefakte.
