# PR 7 – Eventbezogene FIS-Quotenregeln und Athletenquota-Entscheidungen

Basis: `main` **f29fd77**, einschließlich PR 1–6. Arbeitsbranch:
`codex/event-quota-rules`. Keine produktive Datenbank geöffnet oder migriert,
kein Deployment, kein Reset, kein produktiver Neustart. Commit/Push und PR nur
gemäß ausdrücklichem Abschlussauftrag; kein automatisches Merge.

## Inventar und gezielte Integration

| Bestand / Aufrufer | Änderung |
| --- | --- |
| `models.Event`, `routes/events.py` | bestehendes Championship-Modell um Draft/Fixed-Policy ergänzen; vorhandene Adminrechte wiederverwenden |
| `fis_rules.compute_official_quota` | vorhandenes Athleten-plus-Modell mit validiertem Zuschlag; null Athleten ergeben weiterhin null |
| `fis_rules.compute_single_room_entitlement` | vorhandene Staffel parametrisiert; null Officials ergeben null EZ |
| `quota_service.evaluate_quota_usage` | validierte Eventparameter an beide mathematischen Helfer weitergeben |
| `quota_service.evaluate_athlete_quota_usage` | vorhandene Distinct-Person-Berechnung mit Eventgrenzen und Aktivierung |
| `excel_import.build_quota_warnings` | Requested/Physical/Projected verwenden denselben Regelsatz; neue EZ-Evidence trägt Regelsnapshot/Digest/Revision |
| `create_fis_import_preview`, `recalculate_fis_import_preview` | fehlende Fixierung blockiert; Athletenbedarf und anwendbare Ausnahmeumfänge gemeinsam projizieren |
| `app._build_official_quota_usage_rows` | zentraler Live-Aufrufer einschließlich bestehender API-Aliase bleibt erhalten; Regeln explizit übergeben |
| `ImportSession/Version/Approval`, `imports/workflow.py` | bestehende Aufgaben, Freigabe, Historie und gespeicherte Review-Pläne weiterverwenden |
| `quota_history.py`, Confirm-Entscheidungszuordnung | ATHLETE_QUOTA ausdrücklich von EZ-Anwendbarkeit und Personenzuweisung ausschließen |
| `imports/change_plan.py` | Regelsnapshot/Digest und Athletenprüfung in den geprüften Input aufnehmen; Event ist bereits Bestandteil des Bestandsfingerprints |
| `quota_catalogue.py` | unverändert: Katalogabgleich ist keine Regelkonfiguration |
| `ActiveEventProvider` / API-Transport | unverändert wiederverwendet; neue operative Reads erhalten denselben zentralen Eventheader |

## Datenmodell / Migration

Additive Alembic-Revision **20261023_01**, Vorgänger **20261022_01**:

- `Event.is_world_championship`: Boolean, bestehende Datensätze false;
- `quota_rules_json`: nullable Text mit streng validiertem JSON;
- `quota_rules_revision`: Integer, initial 0;
- `quota_rules_fixed_at`, `quota_rules_fixed_by`.

Keine neue Event-, Personen-, Membership- oder Approval-Tabelle. Keine Änderungen
an Hotels, Inventaren, AccommodationEvents, EventRoomDemand, Buchungen oder
Personenfeldern. Die Migration ergänzt ausschließlich Spalten und Defaults:
**Keine Regelkonfiguration wird durch die Migration automatisch fixiert.**
PostgreSQL-DDL läuft in der bestehenden Alembic-Transaktion. Ein injizierter
Fehler nach dem ersten DDL-Schritt wird in einer separaten Testdatenbank auf
vollständigen Rollback geprüft. Ein Downgrade mit fixierten Regeln wird ausdrücklich
blockiert, statt verbindliche Konfiguration zu verwerfen.

**Diese Migration wurde nicht produktiv ausgeführt.** Der Backup-Container erhält
`quota_rules.py` mit der bestehenden Model-/Migrations-Laufzeit.

## Kleines Konfigurationsschema

Version 1 unterstützt ausschließlich:

- Familien `Snowboard` und `Freestyle` mit enabled/totalLimit/genderLimit;
- Officials-Modell `ATHLETES_PLUS` mit nichtnegativem ganzzahligem allowance;
- aufsteigende EZ-Schwellen mit nicht fallenden Ansprüchen und offener Endstufe.

Technische Familiennamen bleiben erhalten. Die UI zeigt `Freestyle / Freeski`.
Expliziter Standardvorschlag: 36/20 je Familie, Zuschlag 2, Staffel 3→1 / 6→2 /
offen→3. WM-Kennzeichnung allein aktiviert keine Regeln. Unbekannte Parameter,
Formelmodelle, falsche Datentypen, negative Zahlen und unvollständige Staffeln
werden abgewiesen. Mathematische Standalone-Helfer behalten ihre bisherigen
Standardparameter; operative Flask-Auswertungen benötigen fixierte Eventregeln.
Es gibt keinen globalen Standard-Fallback für ein beliebiges operatives Event.

### Familienherkunft

Die vorhandene kanonische Event-Group-Zuordnung bleibt maßgeblich. Für frei
konfigurierte Officials-Gruppen wird ergänzend der **exakt konfigurierte Sport**
der Competition verwendet: Snowboard / Freeski / Freestyle. Widersprüchliche oder
unbekannte Evidence bleibt ungeklärt und blockiert die verbindliche Prüfung.
Keine Nameninterpretation, keine Codepräfix-Heuristik, kein Function-Mapping.
Keine persistierten Gruppen oder Competition-IDs umbenannt. Die gemeinsame
Funktion `competition_athlete_family()` wird in Upload-/Saved-ID-Auflösung und
Live-Projektion verwendet; vorhandene API-Gruppenbezeichnungen bleiben erhalten.

## Draft → Fixed und Initialisierung des bestehenden Events

Zwei Zustände: Entwurf und Fixiert. Entwürfe werden per Digest gegen verlorene
parallele Änderungen geschützt. Fixierung erfordert ausdrücklich:

1. gespeicherten, validierten Entwurf;
2. aktuellen Konfigurationsdigest;
3. aktuellen Bestandsfingerprint;
4. `confirm: true`.

Vorhandene Advisory-/Tabellenlocks und Event-Zeilenlock schützen den
Bestandsvergleich bis zur atomaren Fixierung. Regeländerung und Audit werden in
derselben Transaktion gespeichert. Nach Fixierung blockieren API und ORM-Guard
normale Änderungen an Snapshot, Revision, Fixierungsangaben und WM-Flag. Keine
Entsperraktion und kein eventweites Recalculate vorhanden.

Der Preflight liest Personen, Sessions/Versionen, Buchungen, Approvals,
Memberships und Event-Mappings. Er liefert Zähler, Fingerprint und Blocker.
Bestehende abgeschlossene Genehmigungen oder APPROVED_EXTRA-Personen blockieren
die Erstfixierung: Ihre Bedeutung wird nicht rückwirkend umgedeutet. Bei bereits
vorhandenen operativen Datensätzen ist nur die explizite bisherige Standardpolicy
als Erstkonfiguration zulässig. Ein anderer Regelsatz verlangt eine gesondert
geprüfte Initialisierung. Nichts wird automatisch gelöscht oder bereinigt.

### Deployment-Voraussetzungen

- Verifiziertes Backup vor Migration; bestehende Ownership-Anweisungen aus
  `docs/event-ownership-pr1.md` weiterhin beachten, sofern PR 1 noch aussteht.
- Falls PR1 noch aussteht: zunächst gezielt bis `20261022_01` migrieren und den
  ursprünglichen Ownership-Bestandsvergleich dort durchführen. Danach die
  additive PR7-Migration separat anwenden/verifizieren. Ein alter PR1-Fingerprint
  darf neue legitime PR7-Spalten nicht als ursprüngliche Bestandsdaten behandeln.
- `OPERATIONAL_EVENT_ID` muss weiterhin ausdrücklich den erlaubten Bestand nennen.
- Migration und anschließenden tatsächlichen Preflight unter Betreiberkontrolle
  durchführen. Lokale Tests ersetzen keine Bestandsprüfung auf Produktion.
- Im Adminbereich das bestehende Event auswählen, Standardvorschlag bewusst
  übernehmen, WM-Kennzeichnung prüfen, Entwurf speichern und Bestandszahlen prüfen.
- Bei Blockern: stoppen und Herkunft/Genehmigungen prüfen; keine Testnationen
  automatisch löschen, keine Freigabe über rohe DB-Updates umgehen.
- Erst dann ausdrücklich fixieren. Frühere Import-Prüfstände erneut prüfen;
  ein gespeicherter alter Plan darf die neuen Eventfelder nicht ignorieren.

Die genannten produktiven 109 Kontingente und sieben Planungs-Events wurden nicht
in Produktion abgefragt. Verlustfreiheit wird mit isolierten Bestandsfixtures
geprüft, einschließlich aller sieben Planungs-Events und unveränderter Werte/IDs.

## HTTP-Verträge

| Route | Zweck / Grenze |
| --- | --- |
| GET `/api/quota-rules` | aktueller validierter Event; Draft-Status ohne verbindliche Beispiele oder Fixed-Snapshot mit serverberechneten Beispielen |
| GET/PUT `/api/admin/events/:id/quota-rules` | vorhandene Adminrechte; Preflight, expliziter Standardvorschlag, gespeicherter Entwurf; PUT erwartet expectedDigest |
| POST `/api/admin/events/:id/quota-rules/fix` | vorhandene Adminrechte; confirm, expectedDigest, preflightFingerprint; atomar und einmalig |
| GET `/api/fis/athlete-quotas`, `/api/athlete-quotas` | rein lesende eventbezogene Athleten-/Ausnahmeprojektion; keine Aufgaben oder Personenänderungen |
| vorhandene Officials-/Import-Aliase | bisherige Verträge erhalten, gemeinsame Eventparameter und zusätzliche Evidence |

Fehlende Fixierung ergibt `EVENT_QUOTA_RULES_NOT_FIXED`. Ungültige Regeln werden
abgewiesen, veraltete Fixierung/gesperrte Regeln liefern kontrollierte Konflikte.
Normales Event-PUT akzeptiert keine Umgehung der Quotenregelverwaltung.
Single-Event-Sperre und vorhandene Authentifizierung bleiben verbindlich. Der
öffentliche Championship-Katalog bleibt globale Metadatenliste ohne fremde
Quotenregel-Snapshots oder Fixierungsbearbeiter; operative Regeln kommen nur
über den validierten Eventkontext beziehungsweise die geschützte Administration.

## ATHLETE_QUOTA im bestehenden Genehmigungssystem

Der Entscheidungstyp ist in `quotaDetails.decisionKind` gespeichert. Vorhandene
Spalten enthalten Ansprechpartner, Kommunikationsart, Datum, Kommentar,
Kostenvereinbarung und optionale Personenschlüssel. Nach Genehmigung bleibt die
bestehende Genehmigungsart Nation/Organisator erhalten; decisionKind bleibt
unverwechselbar ATHLETE_QUOTA.

Die Evidence enthält Event, Nation, Familie, Regelsnapshot/Digest/Revision,
Distinct-Person-Roster, exakte Competition-IDs, Geschlecht, benötigte und genehmigte
Umfänge sowie einen Scope-Digest. Gesamt-/Männer-/Frauenüberschreitungen werden
**getrennt** gedeckt, niemals zu einer vermeintlichen Personenzahl addiert.
Teilentscheidungen erzeugen eine Aufgabe für den ungedeckten Rest. Keine Person
wird automatisch ausgewählt. Optionale Auswahl ist dokumentierte Evidence.

Beispiel JPN: 40 Snowboard-Athleten, M=23, F=17 → Gesamtüberschreitung 4,
Männerüberschreitung 3, Frauenüberschreitung 0. Das sind keine sieben automatisch
kostenpflichtigen Personen. Unvollständige Geschlechter/Familien dürfen nicht
als eingehaltene Quote durchlaufen.

Freigabe und Confirm prüfen erneut den ungedeckten Bedarf. Auch ein direkter
interner Legacy-Confirm kann eine offene Athletenüberschreitung nicht umgehen;
der echte JPN-Negativtest prüft dies, während die positiven Zwei-Event-
Import-/Reimportfälle den ausdrücklichen HTTP-Review durchlaufen. FULL_NATION,
Entfernungsbestätigung, atomarer Import und veraltete Plan-/Versionssperren bleiben
bestehen. Eine Ausnahmegenehmigung schreibt niemals SPECIAL, APPROVED_EXTRA,
countsAsSingle, NO_ROOM, Unterkunftspflicht, Buchungen oder Mehrpreis.

### Reimport und Revision

Identische Scope-Evidence kann historische Genehmigungen wiederverwenden. Personen
werden innerhalb einer Familie einmal gezählt, auch mit mehreren Competitions.
Änderungen am geprüften Familienroster, Geschlecht oder exakten Memberships werden
nicht ungeprüft durch alte Mengenfreigaben gedeckt. Andere Events und Nationen
liefern keine Entscheidungen. Superseded-Historie wird eventbezogen gelesen;
Approval und gespeicherte Version müssen derselben Session gehören.

Abgeschlossene Mengenentscheidungen werden bei einer ausdrücklichen Revision
nicht überschrieben: neue Entscheidung mit bestehender Superseded-Historie. Nach
veröffentlichtem Import entsteht dafür eine neue Prüfversion; die alte Version
und Evidence bleiben unverändert. Ein reduzierter Umfang erzeugt erneut offenen
Bedarf, verändert aber keine operative Person. Der bestehende Recheck teilt die
kleine Funktion für das sichere Anlegen einer neuen Review-Version.

## Frontend

- Admin: zusätzlicher kompakter Quotenreiter; Zahlen, Aktivierung, WM-Flag,
  Staffelbearbeitung, serverberechnete gespeicherte Vorschau, Preflight und
  expliziter Fixierungsdialog. Danach gesperrte Felder mit Bearbeiter/Datum.
- Import: vier Kacheln Personen / Zimmerzuordnungen / Officials & EZ-Quote /
  Athleten-/Disziplinquote. Tatsächliche Nutzungszahlen, genehmigte/offene Umfänge
  und eigener Detaildialog; keine 36/20-Konstante als vermeintliches Ergebnis.
- Entscheidungen: bestehender Dialog mit separaten Umfangsfeldern und optionaler
  Personenauswahl; bestehende Kontakt-/Kostenfelder. Historienanzeige verwendet
  bei Athleten keine APPROVED_EXTRA-Badges.
- Dashboard: kompakter lesender Athletenquota-Status und Link zu Entscheidungen;
  kein neues Dashboard-Layout und keine Aufgabenänderung beim Lesen.
- FIS Rules: vorhandenes Poster bleibt erhalten. Eventregeln, Staffel,
  Familienlimits und Beispiele stammen vom Server. Zusätzliche Athletenkachel,
  gültiger Event/Revision, Draft-Status ohne scheinbar verbindliche Defaults.
- Responsive: 4 / 2×2 / 1 Kacheln. Im Browser entdeckte bestehende Höhenbegrenzung
  des schmalen Importlayouts wurde gezielt korrigiert: Warteschlange und Review
  bleiben im Seitenfluss erreichbar, Desktop behält die geteilte Scrollansicht.
  Detailtabellen können horizontal gescrollt und per Tastatur fokussiert werden.
- Light/Dark verwenden bestehende Designtokens; Print-Struktur der FIS-Seite bleibt.

## Performance

Keine pro-Person-/Hotel-Requests. Policy wird über den bereits validierten,
request-lokalen Eventdatensatz gelesen, nicht eventübergreifend gecacht.
Historische Athletenentscheidungen werden in einer aggregierten, event-/nation-
und versionsgebundenen Query geladen. Stabile Reihenfolge verhindert wechselnde
Fingerprints bei identischen Daten. Dashboard-Lesen erzeugt keine DB-Schreibvorgänge.

AUS-HTTP-Abnahme: Preview **58**, identische erneute Preview **69**, Confirm **126**
SQL-Statements; die zusätzliche History-Invalidierung benötigt je Preview eine
konstante Abfrage mehr als vor dieser abschließenden Korrektur. Vorhandene Budgets <80 / <80 / <160 eingehalten. Bestehender
Live-Quoten-Querybudgettest bleibt unverändert. Zahlen sind lokale isolierte
Messungen, keine Behauptung über produktive Laufzeiten.

## Tests und Browser

- Vollständige Backend-Suite: **823 Tests und 1.235 Subtests erfolgreich**, keine
  Fehler und keine übersprungenen Tests. 33 neue PR7-Fälle gegenüber PR6.
- Abschließender Workflowlauf nach Historienkorrektur: **81 Tests und 30 Subtests
  erfolgreich**. Offene reine Athletenquota-Fälle erzeugen einen Historieneintrag
  für Handlungsbedarf und keinen irreführenden „Quote erfüllt“-Eintrag.
- Zusätzlicher gezielter Abnahmelauf: **35 Tests erfolgreich**, einschließlich
  paralleler Fixierung (genau ein Gewinner), Teilgenehmigung/Reimport, historischer
  Revision sowie echter Additiv-/Rollback-Migrationsprüfungen.
- **162 Frontendtests erfolgreich**, einschließlich vier Kacheln, tatsächlicher
  Nutzung, unbekannter Familie, abgedeckter Überschreitung und dynamischem Guide.
- Typecheck und Produktionsbuild erfolgreich (letzter Build: **7,17 s**).
- Backup-Suite: **21 Tests und 14 Subtests erfolgreich**.
- Finaler separater Performance-Lauf: **2 Tests erfolgreich**. AUS 58/69/126
  Statements; Live-Quote **7 Queries** sowohl beim kleinen als auch beim
  erweiterten Bestand. Bestehende Budgets unverändert eingehalten.
- Python-Kompilierung, Dateiprüfung und `git diff --check` erfolgreich.
- Bestehende Deprecation-/SQLAlchemy-Legacy-Warnungen verbleiben; keine
  Testerwartungen pauschal an Ist-Ergebnisse angepasst und keine Tests deaktiviert.

### Echter lokaler Chromium-Workflow

Reales Vite-Frontend, Flask-Backend und isolierter PostgreSQL-Container:

1. Entwurf im Admin gespeichert, tatsächlichen Preflight geprüft und Fixierung im
   Bestätigungsdialog ausgelöst. Danach Felder/WM-Flag gesperrt.
2. Echte JPN-Workbooks hochgeladen: 64 Personen, 40 Snowboard-Athleten, M=23/F=17.
   Die neue Kachel/Details zeigen echte Nutzungszahlen, vier Gesamt- und drei
   Männer-Ausnahmeplätze; keine automatische Personenauswahl.
3. Bestehende EZ-Entscheidung und neue Athletenquota-Entscheidung separat im
   Browser dokumentiert, einschließlich Kostenvereinbarung als Evidence.
4. FULL_NATION und Entfernung der zwei zuvor angelegten synthetischen
   Browser-Testpersonen ausdrücklich bestätigt. Freigabe und Confirm erfolgreich:
   64 Personen angelegt, keine automatische Zimmerbuchung.
5. Live-Athletenquote anschließend APPROVED; dynamische FIS-Seite verwendet den
   fixierten Regelsatz. Light/Dark, 1366×900 und 390×844 geprüft.
6. Nach Korrektur der schmalen Scrollaufteilung sind die vier Kacheln tatsächlich
   klickbar; Detailtabelle und Admin-/FIS-Ansicht erreichbar. Kein horizontaler
   Seitenüberlauf, keine Browser-JavaScriptfehler. Dunkle Kachel: Text #e5edf7 auf
   Hintergrund #111c2e.

Nachweise: `browser-smoke-second.log`, `browser-confirm.log`,
`browser-responsive-second.log`, `rules-fixed.png`, `athlete-approval.png`,
`quota-cards-dark-narrow.png`, `quota-detail-dark-narrow.png`,
`fis-rules-live.png`, `fis-rules-dark-narrow.png` unter `/tmp/pr7-reports/`.
Frühere Harnessläufe mit fehlendem Schließen-Button wurden auf den vorhandenen
Escape-Schließpfad angepasst; der echte responsive Klickfehler wurde im Produkt
behoben und erneut geprüft.

Die bisherigen Tests wurden nicht deaktiviert. Bestehende Fixtures erhalten
explizit den bisherigen fixierten Standardregelsatz; PR7-Lebenszyklustests optieren
aus und starten ohne Regeln. Änderungen an alten Erwartungen sind begründet:
Athletenüberschreitungen sind jetzt verbindlicher Handlungsbedarf; reale JPN-
Workflows dokumentieren den Umfang ausdrücklich. Synthetische EZ-/Mapping-Fixtures
benennen einen gültigen Sport, ohne ihre Officials-Gruppen oder EZ-Erwartungen zu
ändern. PR1-Tests prüfen ausdrücklich PR1; neue separate Tests prüfen PR7-DDL und
unveränderte Bestandsdaten. Kein pauschales Abschwächen von Quoten-/EZ-Assertions.

Lokale Logs/Screenshots: `/tmp/pr7-reports/`, nicht versioniert. Browser-Harnesses
und echte Excel-Dateien verbleiben außerhalb des Repositories.

## Grenzen

Keine produktive Multi-Event-Freigabe, kein ActiveEventProvider-Ersatz, kein
allgemeines Regelwerk oder frei ausführbare Formeln, kein eventweites Recalculate.
Fixierte Regeln bleiben unveränderlich; spätere technische Korrekturen verlangen
einen gesondert geprüften Recovery-/Migrationsweg. Neue mathematische Modelle
außerhalb ATHLETES_PLUS und der Staffel sind nicht Teil dieses PR.
World-Champion-EZ-Ausnahmen bleiben unabhängig; keine automatische Athleten-
Zulassungsausnahme, kein Function→Tarif-/FIS-Kategorie-Mapping.

## Geänderte / neue Dateien

- `backend/athlete_quota.py`
- `backend/migrations/versions/20261023_01_event_quota_rules.py`
- `backend/quota_rules.py`
- `backend/tests/test_event_quota_migration.py`
- `backend/tests/test_event_quota_rules.py`
- `docs/event-quota-rules-pr7.md`
- `frontend/src/app/components/EventQuotaPreview.test.ts`
- `frontend/src/app/components/EventQuotaRulesEditor.tsx`
- `backend/accommodation_scope.py`
- `backend/app.py`
- `backend/competitions.py`
- `backend/excel_import.py`
- `backend/fis_rules.py`
- `backend/imports/change_plan.py`
- `backend/imports/workflow.py`
- `backend/models.py`
- `backend/quota_history.py`
- `backend/quota_service.py`
- `backend/routes/events.py`
- `backend/tests/conftest.py`
- `backend/tests/fixtures/api_routes.json`
- `backend/tests/test_athlete_quota.py`
- `backend/tests/test_canonical_quota.py`
- `backend/tests/test_event_ownership.py`
- `backend/tests/test_event_routes.py`
- `backend/tests/test_import_event_identity.py`
- `backend/tests/test_safe_reimport.py`
- `backend/tests/test_single_room_status.py`
- `backup/Dockerfile`
- `frontend/src/app/components/AdministrationEvents.tsx`
- `frontend/src/app/components/Dashboard.tsx`
- `frontend/src/app/components/DataImport.tsx`
- `frontend/src/app/components/FisRulesPanel.test.ts`
- `frontend/src/app/components/FisRulesPanel.tsx`
- `frontend/src/app/components/ImportDecisionDialog.tsx`
- `frontend/src/app/components/ImportQueue.tsx`
- `frontend/src/app/components/OperationsDecisionDialog.tsx`
- `frontend/src/app/data/importSessions.ts`
- `frontend/src/app/services/api.ts`
- `frontend/src/app/services/importDecision.test.ts`
- `frontend/src/app/services/importDecision.ts`
- `frontend/src/app/services/importPreview.ts`
- `frontend/src/app/types.ts`

## Abschlussprüfung für den Pull Request – 24.10.2026

Aktueller `origin/main` erneut abgeglichen: **f29fd77**, identisch mit der
Implementierungsbasis einschließlich PR6. Vollständiges Code- und Migrationsreview
abgeschlossen. Keine zusätzliche Sicherheitslücke gefunden; keine weiteren
Produktänderungen, Features, Refactorings oder Regressionstests beim Abschluss.

Erneut ausgeführte vollständige Prüfungen:

- Backend: **823 Tests und 1.235 Subtests erfolgreich**, keine Fehler/Skips
  (**166,05 s**), einschließlich echter JPN-Dateien, Reimport, Event-Isolation,
  vorhandener Genehmigungen, paralleler Fixierung und Migrations-Rollback.
- Frontend: **162 Tests erfolgreich**, keine Fehler/Skips.
- Backup: **21 Tests und 14 Subtests erfolgreich** (**1,95 s**).
- Typecheck und Produktionsbuild erfolgreich (**7,17 s**).
- Python-Kompilierung und `git diff --check` erfolgreich.
- Bestehende Import- und Live-Quoten-Performance-Budgets erneut eingehalten.

Vier Importkacheln gegen die kanonischen serverseitigen Prüfdaten und die
FIS-Rules-Seite gegen den fixierten Snapshot / serverberechnete Beispiele geprüft.
Die dokumentierte interaktive Chromium-Abnahme stammt aus der Implementierungsphase
am 23.10.; beim Abschluss keine weitere UI- oder Berechnungsänderung vorgenommen.

43 vorgesehene Quell-/Test-/Dokumentationsdateien geprüft. Keine Datenbankdateien,
privaten Workbooks, lokalen Zugangsdaten oder produktiven Event-IDs aufgenommen.
Die bestehende achtfache Backend-Fehlerbasis aus früheren PRs ist weiterhin behoben;
lediglich vorhandene Deprecation-/Legacy-Warnungen verbleiben.

**Migration nicht produktiv ausgeführt; keine produktiven Datenänderungen und
kein Deployment.** Die Erstfixierung benötigt weiterhin den tatsächlichen
Bestands-Preflight und explizite Bestätigung. Bestehende abgeschlossene
Genehmigungen blockieren eine unkontrollierte Erstfixierung. Kein Recalculate,
keine produktive Multi-Event-Freigabe, kein automatisches Merge.

Abschlusslogs lokal unter `/tmp/pr7-closing/`, nicht versioniert.
