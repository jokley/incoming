# Feature-Freeze: Quotenrevision, Eventanlage, Weltmeister und Testgenerator

Stand: 25.10.2026. Basis `main` **bd07dee**, PR9 ist gemergt (PR334).
Branch `codex/feature-freeze-polish`. Keine Produktionsverbindung, produktive
Migration, Bereinigung, Deployment oder Merge ausgeführt. Commit, Push und Pull
Request wurden anschließend ausdrücklich für die abschließende Abnahme beauftragt.

## 1. Untersuchung und begrenzter Plan

Untersucht wurden die tatsächlichen Quotenaufrufer, das Eventformular bis zur
Persistenz, gespeicherte Importpläne/Approvals, Weltmeisterreferenzen und die neun
bisherigen Generatorpaare. Verwendete Grundlagen bleiben `Event`, `EventAccess`,
`ActiveEventProvider`, die existierenden mathematischen Evaluatoren,
`ImportSessionVersion`, `ImportApproval`, Change-Plan/Recheck und `AuditEvent`.

Umsetzung: aktive Eventfelder als bestehendes Readmodel erhalten, zusätzliche
unveränderliche Regelhistorie; explizites Preview/Confirm für Revisionen; bestehende
Titel über neue Anerkennungslinks wiederverwenden; Create-/Edit-Fehler sichtbar
behandeln; reproduzierbares isoliertes Zusatzpaket statt produktiver Testdaten.
Keine neue Rule Engine, Personenverwaltung, Gebührenlogik oder Approvalplattform.

## 2. Eventanlage – nachgewiesene Befunde und Grenze

Ein gültiger Create mit Superadmin war auf PR9 bereits lokal erfolgreich und ist
auch hier über echten Browser/HTTP/PostgreSQL nachgewiesen. Der behauptete konkrete
Produktionsausfall ist **ohne HTTP-Status/Response des fehlgeschlagenen POST nicht
eindeutig zugeordnet**. Diese Angaben wurden angefragt; kein Zugriff auf den VPS.
Nicht aus einer Vermutung auf einen bestimmten Produktionsfehler schließen.

Reproduzierbare Fehler im Codepfad:

- Doppelte Namen liefen in die bestehende Unique-Constraint und wurden nicht als
  verständlicher Konflikt behandelt. Ungültige Feldtypen konnten technische Fehler
  statt 400 auslösen. Jetzt 400 mit Validierung bzw. 409 `EVENT_NAME_EXISTS`.
  Ein Primärschlüssel-/Sequenzkonflikt wird gesondert als `EVENT_ID_CONFLICT`
  gemeldet; andere Integritätsfehler werden nicht fälschlich als Namensdubletten
  ausgegeben. Keine automatische produktive Sequenzreparatur.
- `EventEditor` ließ die abgelehnte Speicher-Promise ohne eigene Fehlermeldung
  zurück. Jetzt bleibt der Dialog mit sichtbarem Fehler geöffnet.
- Beim **Bearbeiten** wurde das ganze Eventobjekt mit geschützten `quotaRules`
  zurückgesendet; Backend lehnt das korrekt ab. Handler sendet nun nur Name, Jahr,
  Aktivstatus, FIS-ID und Sector Code. Dies ist ein anderer Pfad als Neuanlage.
- Nach erfolgreichem Create wurde mit einem alten `selectedId` weitergeladen;
  neue/fremde oder inaktive Metadaten waren absichtlich auf den operativ aktiven
  Event beschränkt. Jetzt konkrete gespeicherte ID, separate Erfolgsnachricht,
  asynchron gegen verspätete Auswahlantworten geschützt. Ein Fehler beim Nachladen
  wird als Nachladefehler nach erfolgreichem Speichern bezeichnet.

### Autorisierter Administrationskontext

`EventRequestScope` bleibt der einzige Transportowner für operative Requests.
Für `/api/admin/events/<id>` darf die API-Fassade zusätzlich genau diese explizite
Ziel-ID als **request-lokalen Administrationsheader** schicken. URL und Header
müssen übereinstimmen. Der aktive Workspace wird dabei nicht geändert; Lease,
Requestabbruch und Schutz laufender Writes bleiben erhalten. Serverseitig greift
unverändert `bind_request_event()`, Funktionsrecht + Zielgrant und Pfadvergleich. Der Superadmin verwendet für die
Event-/Weltmeisteradministration sein begrenztes `events.manage`, kein neues
Wildcardrecht und keine zusätzliche globale Backupberechtigung.
Keine Verwendung dieses Mechanismus für Personen-, Buchungs- oder Importrequests.
Der Pin bleibt auch hier bindend; er ist kein Multi-Event-Bypass.

Ein Superadmin kann ein inaktives neues Event konfigurieren, dessen Regeln prüfen,
fixieren und Mappings anlegen/kopieren, während der operative Kontext unverändert
bleibt. Inaktive Events erscheinen nicht im operativen Selector. Normale Benutzer
brauchen die jeweiligen Zielrechte; nicht administrativ Berechtigte bleiben gesperrt.

Die bestehende globale Berechtigung für das **Anlegen leerer Championship-Metadaten**
bleibt bestehen: Superadmin oder bisherige Adminfunktion. Ein fehlender Eventheader
ist hier wie bisher erlaubt, es entsteht kein impliziter Personeneigentümer. Wird
ein Header gesendet, wird er vollständig geprüft (auch WRITE). Daher kann ein
Administrator mit READ auf dem gesendeten Kontext darüber keine Mutation ausführen.
Viewer/Editor werden schon durch die Funktionsprüfung abgewiesen. Ein normales
Adminrecht erzeugt keinen automatischen Grant für den neuen Event.

Aktivstatus und operative Importfreigabe sind getrennt: die bestehende API-Vorbelegung
wird nicht heimlich geändert. Auch ein sichtbar aktiver neuer Event hat zunächst
DRAFT-Regeln; verbindliche Imports benötigen weiterhin fixierte Regeln und passende
Competition-Mappings. Keine Personen, Buchungen, Genehmigungen oder Kontingente kopiert.

## 3. Quotenrevision

`EventQuotaRevision` / Tabelle `event_quota_revision`, Schlüssel Event+Revision:
Konfiguration, WM-Flag, Digest, Aktivierungszeit, Akteur und Begründung.
Die bestehenden Eventfelder zeigen weiterhin auf den aktiven Snapshot und bleiben
FIXED. Keine Entsperrung durch `fixed_at=NULL`. Die ursprüngliche Aktivierungszeit
und der ursprüngliche Akteur bleiben im alten Snapshot erhalten.

- `GET .../quota-rules/revisions`: Historie, rein lesend.
- `POST .../quota-rules/revision-preview`: vollständige Validierung, Vorher/Nachher,
  Basisrevision/-digest und Bestätigungsdigest; noch keine Änderung.
- `POST .../quota-rules/revisions`: explizite Bestätigung desselben Entwurfs mit
  Begründung, CAS und bestehenden Import-/Accommodation-Locks plus Event-Zeilensperre.
- Entwurf im Editor bleibt lokal; kein zusätzlicher serverseitiger Draft-Workflow.
- ORM akzeptiert aktive Änderungen nur im kontrollierten Aktivierungspfad mit
  passendem neuem Snapshot und exakt nächster Nummer. Historische ORM-Updates und
  Deletes werden abgewiesen. Privilegiertes direktes SQL bleibt DBA-Verantwortung.
- API und UI verlangen administrative Funktionsrechte plus **Ziel**-Event-WRITE;
  Superadmin entsprechend seiner bestehenden Rechte. Editor/READ reicht nicht.

Die Aktivierung schreibt ausschließlich Event, neuen Snapshot und Audit atomar.
Sie liest/sperrt vorhandene Tabellen zur Konkurrenzkontrolle, verändert darin aber
keine Personen, Memberships, Sessions, Versionen, Approvals, Belegungen oder Preise.
Bereits gestarteter Confirm kann unter der zuvor gültigen Revision fertig werden,
wenn er zuerst den gemeinsamen Lock besitzt; danach ist das eine historische
Importversion. Gewinnt die Revision zuerst, muss der alte Confirm scheitern.

### Aktuelle Anzeigen und Historie

| Pfad | Verwendung |
| --- | --- |
| `quota_rules.rules_for_event()` | einziges operatives aktives Parameterschema |
| `quota_service` / `fis_rules` | dieselben vorhandenen Evaluatoren, keine neue Formel |
| `app._build_official_quota_usage_rows()` | Eventpersonen + aktuelle Officials-/EZ-Parameter |
| `routes/events.live_athlete_quotas()` | aktuelle Mitglieder, distinct je Familie, aktive Grenzen |
| `athlete_quota.project_preview()` | aktuelle Snapshot-/Revisionsstempel im transienten Preview |
| `quota_history.approval_event_matches()` | keine Übertragung alter EZ-Evidence auf neue Revision |
| FIS Rules / Dashboard / Quoten / Nationen | bestehende aktuelle API-Projektionen; keine persistente Frontend-Regelkopie |
| Analytics | bestehende eventreine Personen-/Belegungsprojektionen; physische EZ-/DZ-Kennzahlen sind keine neue Quotenformel |

Die einzigen Standardwerte bleiben explizite Entwurfsvorschläge bzw. bestehende
Standalone-Mathedefaults. Operative Berechnung verlangt den aktiven fixierten Event.
Requestlokale Caches enden mit dem Request; keine neue globale Cacheebene.
Navigation/erneutes Laden verwendet die neuen Anzeigen. Es wurde kein Websocket-
Broadcast für bereits geöffnete andere Browserfenster eingeführt.

38 Athleten, Limit 36 und historisch genehmigte zwei Plätze: nach Limit40 zeigt die
aktuelle Rechnung 38/40 ohne Überschreitung; das alte Approval bleibt unverändert.
Bei Senkung entsteht ggf. neuer angezeigter Bedarf. Alte Evidence ist an ihre
ursprüngliche Revision und Meldung gebunden und deckt nicht automatisch den neuen
Verstoß. Keine automatische Erstellung neuer Approvalzeilen bei Aktivierung oder GET.
`APPROVED_EXTRA`, bestehende EZ-/Preisentscheidungen und manuelle Ausnahmen bleiben
als gespeicherte fachliche Entscheidungen erhalten; aktuelle Bewertung ist eine
Read-Projektion, keine rückwirkende Gebührenentscheidung. Beim ausdrücklichen Reimport wird die bestehende
Personenentscheidung nur nach unveränderter Identitäts-/Membership-Evidence historisch
erhalten; diese eng begrenzte Preservation deckt ausdrücklich **keinen** neuen
Quotenverstoß. Ein Regressionstest bestätigt beides gleichzeitig.

### Offene Reviews

Preview speichert zusätzlich `quotaRulesRevision`; Digest-/State-Prüfung bleibt.
`require_review()` lehnt alte verbindliche Schritte mit `QUOTA_RULES_CHANGED` und
„Quotenregeln wurden geändert – bitte erneut prüfen“ ab. GET liefert aktuelle
transiente Zahlen und Stale-Hinweis, ohne gespeicherte Preview zu überschreiben.
Explizites Recheck forked auch einen noch offenen Review bei geänderter Revision.
Die ursprüngliche Version und abgeschlossene Entscheidungen bleiben erhalten.
Erst dieser bestehende ausdrückliche Workflow erzeugt ggf. neue Entscheidungen.
Keine Massen-Reimports oder eventweites Recalculate.

## 4. Zentrale Titel und Eventanerkennung

Tatsächlicher Bestand: `WorldChampion` enthielt bisher Titel **und** Eventgeltung.
Die vorhandenen Titelzeilen samt IDs, Quellnachweisen, Zeitpunkten und Feldern
bleiben vollständig bestehen. `event_id` bleibt ihre historische Ursprungs-/
Anlageprovenienz. Keine destruktive Umdeutung oder Zusammenführung vorhandener
Dubletten. Neue Zuordnungen kopieren diese Titel nicht.

Neue Tabelle `world_champion_recognition`: Event+Titel-ID, aktiv, Zeitpunkt, Akteur.
Die Migration überträgt ausschließlich jede bereits bestehende Zuordnung mit ihrem
bisherigen Aktivstatus. Keine Anerkennung in zusätzlichen Events und keine Änderung
bestehender Titel-/Personenwerte. `recognize()` prüft den Link des jeweiligen Events
und die bestehenden aktiven/geeigneten Titelmerkmale. Ein enger Legacy-Fallback für
technische Altdatensätze ohne eigenen Anerkennungslink bleibt auf deren Ursprung
begrenzt; eine Anerkennung in B verdrängt die frühere Geltung in A nicht.

- Zentrales Menü bleibt: Referenzkatalog über `GET /api/admin/world-champion-titles`.
  Das sind bewusst globale Titelmetadaten, keine globalen operativen Personen.
- Neuer Tab Administration → Events → Weltmeister: Ursprungstitel suchen, aktuellen
  Link anzeigen und ausdrücklich aktivieren/deaktivieren.
- `GET/POST /api/admin/events/<id>/world-champions` verwenden Zielrechte und Audit.
- Neue globale Referenzduplikate werden kontrolliert abgewiesen: bestehende Quelle
  anerkennen statt erneut für ein weiteres Event anzulegen.
- Änderung verwendeter Ursprungstitel bzw. Deaktivierung einer Anerkennung wird
  konservativ blockiert, wenn Event-Importhistorie oder eine passende gespeicherte
  Weltmeisterausnahme vorhanden ist. Das ist ein Prüfhinweis, keine automatische
  Revalidierung. Die Sperre kann absichtlich auch nicht betroffene Titel umfassen.
- Keine bestehenden Crown-/Approval-/Preiswerte automatisch umgeschrieben.

Titelreferenzen werden weiter im autorisierten Ursprungskontext gepflegt; ein
zentral sichtbarer fremder Titel wird dadurch nicht operativ zu dessen Personen.
Eine vollständige Ablösung der historischen Ursprungs-FK/Legacy-Dublettenbereinigung
ist ausdrücklich kein Freeze-Refactoring. Für inaktive Ursprungskontexte und
verwendete Titel kann die sichere technische Pflege eine gesonderte Prüfung brauchen.

## 5. Generator und Gender-Einzelbelegung

Die bisherigen neun aufeinanderfolgenden Workbookpaare bleiben erhalten.
Zusätzlich: Download `feature-freeze` und Unterordner `FeatureFreeze` im Gesamtpaket,
mit 20 nummerierten Prüffällen, Revision1/Revision2-höher/Revision2-niedriger,
Zwei-Event-Rezept und vier echten Workbooks (Entries+Room List für jeweils genau
eine Frau bzw. genau einen Mann). Membershipflags stimmen mit dem Geschlecht überein;
Aufenthaltsintervalle variieren. Ausgabe ist deterministisch und hat keine DB-Verbindung.
Das Manifest nennt die ausführbaren bestehenden/neuen isolierten Abnahmesuites.
Es ist kein automatischer Seeder, keine Produktionssimulation und kein neues
Test-Orchestrierungsframework. Testpakete nur in isolierten Testevents importieren.

Abnahmebereiche 1–20: Anlage, zweite Nation im zweiten Event, A→B→A, Superadmin,
Grants/READ/NONE, Import Revision1, höhere/niedrigere Limits, historische Evidence,
aktuelle Anzeigen, stale Review/Recheck, distinct Memberships, beide Minderheits-
Geschlechter, Intervalle, eventbezogene Weltmeister und unveränderte operative Daten.

Für „nur eine Frau/ein Mann“ wird eine echte alleinige DZ-Belegung getestet:
physische Kapazität2, ein Insasse, countsAsSingle=false bei DZ-Wunsch, keine
zusätzliche Genehmigung, kein automatischer Sondertarif/EZ-Sonderstatus. Die bereits
bestehenden Tests decken physisches EZ, countsAsSingle=true/false und APPROVED_EXTRA ab.
Fehlender Zimmerpartner allein wird nicht zur Gebührenbefreiung oder zu Mehrpreis.
Eine besondere WM-Kostenübernahme dafür ist **nicht fachlich bestätigt** und bleibt
eine offene Betreiber-/FIS-Entscheidung. Die ältere PDF-Anlage konnte in dieser
Laufzeit nicht erneut aufgelöst werden; keine daraus erfundene Rechtsauslegung.

## 6. Additive Migration und GET-Sicherheit

`20261025_01` nach PR9 `20261024_02` legt ausschließlich die beiden neuen Tabellen
an und schreibt Kopien vorhandener Regel-Snapshots bzw. Anerkennungslinks **in diese
neuen Tabellen**. Kein UPDATE/DELETE alter Tabellen. Keine neue produktive Erstfixierung.
Nicht lesbare fixierte JSON-Bestände führen zum kontrollierten Migrationsabbruch
statt zu erfundenen Defaults. PostgreSQL-DDL und Backfills sind eine Transaktion.
Downgrade verweigert das Vernichten befüllter Historien/Anerkennungen.

Der PR9-GET `/api/auth/me` hatte als Ausnahme eine Benutzerreferenz gespeichert.
Diese Speicherung erfolgt jetzt ausdrücklich per authentifiziertem POST auf denselben
bestehenden Endpunkt; der AuthProvider ruft ihn nach Identitätslesen auf. GET bleibt
rein lesend. Kein zweites Login, keine neuen Credentials und keine Grantvergabe.

## 7. Prüfungen

Maßgeblicher finaler Einzel-Lauf auf frischem isoliertem Cluster:

| Prüfung | Ergebnis |
| --- | --- |
| Vollständiges Backend einschließlich PostgreSQL-Migrationen und Original-JPN | **872 bestanden, 1.282 Subtests**, keine ausgelassenen Tests; 200,14 s |
| Neue fachliche Freeze-Abnahme | 13 Fälle in `test_freeze_acceptance.py`, in der Gesamtsuite enthalten |
| Neue PostgreSQL-Migrationsprüfung | 2 Fälle, in der Gesamtsuite enthalten |
| Vollständiges Frontend | **173 bestanden**, keine ausgelassenen Tests |
| Typecheck / Produktionsbuild | erfolgreich; Build 8,93 s |
| Vollständige Backup-Suite | **21 bestanden, 14 Subtests**, 1,77 s |
| Echter lokaler Chromium-Browser | **10 End-to-End-Prüfungen**, keine JavaScript-Ausnahmen |
| `git diff --check` | erfolgreich |

Maßgeblicher Backendlog: `/tmp/freeze-release-regression.log`.
Bestehende datetime-/SQLAlchemy-Deprecation-Warnungen bleiben (27.295).
Eine versehentlich überlappende Zwischenrunde auf derselben lokalen Testdatenbank
wurde vollständig verworfen; beide Prozesse gestoppt, ausschließlich der eigene
Testcontainer neu erstellt und die oben genannte vollständige Suite einzeln
neu ausgeführt. Kein Ergebnis dieses Zwischenlaufs wird als Nachweis verwendet.

Browser verwendet Vite/Flask/PostgreSQL und eine separate neu angelegte Datenbank
`incoming_freeze_browser2`, zwei Championship-Events, einen bestehenden Ursprungstitel
und fixierte Revision1. Ein Loopback-Testproxy überschreibt Identitätsheader;
**kein** produktiver Authelia-Nachweis, keine API-Mocks. Geprüft: sichtbarer
Dublettenfehler, inaktive Neuanlage, Bearbeitung ohne geschützte Quotenfelder,
kein stiller operativer Wechsel, serverseitiger Vorher-/Nachher-Vergleich,
Revision2, aktive Projektion, Anerkennung ohne Titelkopie, dynamische FIS-Seite,
390px ohne horizontales Clipping. Backend-/Frontendlogs und Screenshots bleiben
unter `/tmp/freeze-*`, nicht im Repository.

Zwischenläufe sind kein Freigabenachweis: aktualisierte Verträge für zusätzliche
Routen/Generatorpakete, ein falsches Arbeitsverzeichnis bei einem alten relativen
Testfixturepfad sowie Vite-Optimize-Cache-Konflikte im parallelen lokalen Harness
wurden getrennt erkannt. Keine produktive Fachlogik für einen grünen Test verbogen,
keine Tests deaktiviert. Die Backendrunde verwendet die echten bereitgestellten JPN-
Dateien, bestehende AUS-Fixtures und sämtliche bisherigen Import-Querybudgets.

Neue Abnahmetests: `test_freeze_acceptance.py` (Revision, Rechte/CAS, erhöhte/gesenkte
Limits, unveränderte Historie, Stale/Recheck, Titelanerkennung und Genderbelegung,
Anlagevalidierung, Sequenzkonflikt, Reimport-Preis-Preservation) und
`test_freeze_migration.py` (Originaldatenvergleich und DDL-Rollback). Bestehende
Generator-, Routen-, GET-/POST-Identitäts- und Transporttests gezielt erweitert.
 Alle Datenbanken
liegen ausschließlich im frisch gestarteten lokalen PostgreSQL17-Wegwerfcontainer.
Produktionsähnlicher Migrationstest beginnt bei PR9, mit bereits fixierter Revision1
und einem bestehenden Titel: vorher/nachher sämtliche inventarisierten Originalfelder
identisch; neue Historie/Links stimmen exakt. Injizierter DDL-Fehler rollt alles zurück.
Snapshot-Abnahme vergleicht sämtliche Zeilen von Personen, Approvals, Sessions,
Versionen, Buchungen und Titeln vor/nach Regelaktivierung unverändert.

### Geänderte Implementierungspfade

Backend: `models.py`, `quota_rules.py`, `routes/events.py`, `quota_history.py`,
`athlete_quota.py`, `excel_import.py`, `imports/workflow.py`, `imports/change_plan.py`,
`event_ownership_runtime.py`, `routes/world_champions.py`, `world_champions.py`,
`routes/identity.py`, `scenario_generator.py`, `routes/admin_scenarios.py`,
neue Migration und die genannten Tests/Routenmanifest.
Frontend: `AdministrationEvents`, `EventQuotaRulesEditor`, neuer
`EventWorldChampions`-Tab, bestehende `AdministrationWorldChampions`,
`DataImport`, `AuthProvider`, `eventRequestScope`, `api.ts`, Typen und Transporttest.

## 8. Rollout auf dem VPS – nur Operator

1. Tatsächlichen Release und Migration feststellen. `main` enthält PR9, aber sein
   produktiver Deploy-/Migrationsstand ist hier **nicht geprüft**. Vorhandene private
   Konfiguration, Superadminidentität, Pin/Grants und `/api/auth/me` prüfen, ohne
   Secret-/Cookie-/Inspect-Ausgaben zu veröffentlichen. Counts und IDs von Hotels,
   Inventaren, Personen, Buchungen, Titeln, Approvals und Importversionen sichern.
2. Bestehenden geprüften Backupweg verwenden. Alternativ im geschützten Verzeichnis
   unter `umask 077` ein `pg_dump -Fc` aus dem bestehenden Postgrescontainer erzeugen.
   Dump in einen **neuen separaten PostgreSQL17-Cluster** mit eigenen Testcredentials
   zurückspielen; niemals Produktion als Restoretestziel. Counts/Beziehungen und
   fixierte Revision1 auf dem Restore vergleichen. Personenbezogene Dumps nicht in Git.
3. Wartungsfenster: Import/Confirm, CLI-Writes und Referenzpflege pausieren. Backend
   stoppen **bevor** neuer Code in den bindgemounteten Backendpfad gezogen wird.
   Geschützten Dump/Restoretest und vorherigen Release samt Images bereithalten.
4. Geprüften neuen Release bereitstellen, bestehende env-/DB-/Volume-Werte erhalten:

   ```bash
   docker compose stop backend
   # Jetzt erst den geprüften Release bereitstellen; kein Reset/keine Bereinigung.
   docker compose build backend frontend backup
   docker compose run --rm --no-deps backend true
   ```

   Der vorhandene Entrypoint führt Alembic aus. Head muss `20261025_01` sein; kein
   paralleler Upgradeprozess. Ein Fehler stoppt die Einmalaktion. Nur nach Erfolg:

   ```bash
   docker compose up -d --no-deps backend frontend backup
   docker compose exec -T backend python -m alembic -c /app/alembic.ini current
   docker compose ps
   ```

5. Read-only-Nachprüfung: alte Tabellen/Felder, IDs, Quotenparameter, fixierte
   Revision1 und Approvals unverändert; je existierendem fixiertem Event genau
   dessen historische Snapshotzeile. Titelanzahl/IDs unverändert, Anerkennungen
   zunächst ausschließlich in bisherigen Ziel-Events. Keine Grants entstanden.
6. Healthchecks, echte Authelia-Identität und getrennte Eventkontexte prüfen. Pin
   nicht beiläufig entfernen; dessen bestehender Betriebsentscheid bleibt bestehen.
   Eventanlage mit autorisiertem Superadmin bewusst testen, vorher Responseproblem
   reproduzieren/aufzeichnen. Keine produktiven Testpersonen oder automatische
   Testevents anlegen. Regelrevision nur mit fachlicher Freigabe und Begründung.
   Offenen Review auf Recheck-Pflicht prüfen; historische Approvals vergleichen.
7. Browsercache/alte Assets normal neu laden. Bei Fehler keine zweite Neuanlage
   raten: zuerst POST-Status, Response und gespeicherte ID kontrollieren.

## 9. Rollback und offene Go-live-Grenzen

- Vor erfolgreicher Migration bleibt der alte Stand durch die Transaktion erhalten;
  bei Fehler keine Reset-/Stamp-/Bereinigungsskripte anwenden.
- Nach Upgrade additive Tabellen **behalten**. Ein unverändertes älteres Image kennt
  die neue Revision nicht. Vorbereitetes Rollbackartefakt muss die Migrationsdatei
  mitführen. Neue Anerkennungen in anderen Events und neu aktivierte Regeln sind
  bei PR9-Code-Rollback nicht vollständig interpretierbar: dann kein blinder Rollback.
- Nach Nutzung neuer Funktionen vorzugsweise Betrieb/Writes pausieren und vorwärts
  korrigieren. Vor einer Schema-/Datenwiederherstellung separat RPO und neue operative
  Änderungen prüfen; keinen alten Dump über inzwischen importierte Daten spielen.
- Produktiver spezifischer Create-Fehler bleibt bis zur HTTP-Evidence unbewiesen.
  Lokale gültige Anlage und die konkreten Fehlerfälle sind geprüft.
- Produktive Restore-/Authelia-/Zwei-Event-Prüfung muss der Operator durchführen.
- Sichere Deaktivierung historisch verwendeter Weltmeisteranerkennungen bleibt
  absichtlich gesperrt; echte fachliche Revalidierung ist Post-go-live-Arbeit.
- Keine sofortige Aktualisierung bereits geöffneter fremder Browserfenster;
  verbindliche Serverchecks verhindern deren stale Confirm.
- Fehlender geeigneter Zimmerpartner begründet in diesem PR keine neue Gebührenregel.

Kein automatisches Go-live-/Feature-Freeze-Siegel: Produktive Evidence und die
expliziten fachlichen Entscheidungen bleiben Voraussetzungen für die Betriebsfreigabe.
