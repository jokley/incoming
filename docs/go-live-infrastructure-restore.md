# Go-live-Infrastruktur und administrativer Restore

Stand: 26.10.2026. Basis `main` c57162d einschließlich PR338. Branch `codex/go-live-restore-production-frontend`.

**Keine Produktionszugriffe, produktiven Restores, Datenänderungen, Migrationen oder Deployments ausgeführt. Keine neue Migration; Head bleibt `20261025_02`.** Restore und statische Auslieferung sind implementiert, eine produktive Abnahme setzt die unten genannten Betriebsprüfungen voraus.

## Ausgangsbefund

- Frontend: Node20/Vite dev, Source-Bindmounts, absolute Runtime-VITE_API_URL; tatsächlich notwendige Node-Version laut Projekt >=22.6. Der Gateway reicht bisher HMR-WebSockets durch.
- Restore: funktionierendes Staging, automatische Sicherheitskopie und kompensierte Datenbankumbenennung vorhanden; jedoch nur prozesslokaler Thread-Lock und synchroner langer HTTP-Aufruf. Der manuelle Wartungsflag schützt nicht automatisch mehrere Backendprozesse vor gleichzeitig laufenden Transaktionen.
- Bestehende Berechtigungen `database.read`, `database.backup`, `database.export`, `database.restore`, `database.reset` und verifizierte Proxyidentität reichen aus. Keine neue Rolle oder Authelia-Konfiguration.

## Restore-Protokoll

`POST /api/admin/database/restore` behält seinen Pfad und Dateiauswahlvertrag. Neu: ausdrücklicher Text `RESTORE DATABASE`, schnelle Antwort **202 mit Jobstatus**, keine sofortige Erfolgszusage. Der Backendserver übermittelt den eigenen Head-/Modellvertrag, das tatsächliche Datenbankziel seines Engines und ausschließlich die verifizierte Identität an den privaten Backupservice (`/restore-jobs`), abgesichert durch das bereits konfigurierte `AUTH_PROXY_SECRET`. Der alte unkoordinierte private `/restore`-HTTP-Pfad liefert 410. Die interne Python-Restorefunktion bleibt für kontrollierte Jobs/Tests wiederverwendbar.

Der Backupservice verwendet das vorhandene Volume `/backups`, keine Datenbanktabelle für den Job:

- `.restore-control/status.json`: atomar ersetzter und fsync-gesicherter aktueller Zustand.
- `history.jsonl`: vor Veröffentlichung synchronisiertes Journal mit Operation-ID, Administrator, Zeitpunkt, Quelle/Kategorie/Größe, Prüfsumme, Phasen, Sicherheitsbackup und Ergebnis. Keine Zugangsdaten oder Uploadtokens.
- `operation.lock`: exklusiver POSIX-flock während Annahme/Ausführung; verhindert parallele Jobs auch zwischen Prozessen.
- `access.lock`: jeder datenbankabhängige Backendrequest hält eine **gemeinsame** Sperre bis nach `db.session.remove()`; der Restore benötigt die **exklusive** Sperre. Lock-Inodes werden nie ersetzt.

Ablauf:

1. API prüft authentifizierten Admin/Superadmin und `database.restore`, anschließend die Textbestätigung. Dateinamen/Kategorie bzw. Uploadtoken werden durch bestehende Resolver validiert; ungültige Archive/Pfade werden abgewiesen.
2. Der Dienst verlangt zunächst einen zum eigenen Code passenden Backend-Head-/Modellvertrag; ein veraltetes Backupimage wird vor Jobannahme abgewiesen. Auch Host/Port/Datenbank müssen explizit mit dem tatsächlichen API-Engineziel übereinstimmen; keine heuristische Aliasauflösung. Danach validiert er die Archivstruktur, öffnet die ausgewählte Datei und publiziert `QUEUED`. Die Dateikopie und SHA256-Bildung laufen im unabhängigen Worker, nicht im Flaskrequest. Ein offener Dateideskriptor schützt vor zwischenzeitlicher Retention/Löschung der gewählten Quelle.
3. Ab QUEUED werden neue datenbankabhängige Requests systemweit mit 503 gesperrt. Bereits zugelassene Requests dürfen fertig committen/rollbacken. Erst nach exklusiver Dateisperre und Abschluss aktiver PostgreSQL-Transaktionen geht es weiter; nach 120 Sekunden ohne Drain folgt Recovery statt erzwungener Fortsetzung.
4. Automatisches Pre-Restore-Backup; Archivprüfung **und vollständige Probe-Wiederherstellung in eine zusätzliche Wegwerfdatenbank**. Bei Fehler keine Aktivierung der ausgewählten Sicherung.
5. Bestehender Staging-Restore mit `--single-transaction --exit-on-error`, bestehendes Alembic-Upgrade ausschließlich des Stagings. Unbekannte/unmögliche Migrationen blockieren. Danach exakter Headvergleich und Prüfung sämtlicher im laufenden Modell erforderlichen Tabellen/Spalten.
6. Bestehender kompensierter Datenbanktausch. Staging-/Rollbacknamen stehen für die Recovery im Journal. Nach erneuter Schema-/Verbindungsprüfung wird SUCCEEDED publiziert und erst danach die exklusive Sperre freigegeben.

**Zustände:** QUEUED → DRAINING → SAFETY_BACKUP → RESTORING → VERIFYING → SUCCEEDED. Fehler/unterbrochene Jobs werden RECOVERY_REQUIRED. Gespeicherte Daten und Genehmigungen werden außerhalb des ausdrücklich bestätigten Restores nicht geändert. Ein Restore stellt natürlich den gewählten Snapshot her; nach dessen Sicherungszeitpunkt entstandene Änderungen liegen anschließend im geprüften Pre-Restore-Backup.

## Neustart, Sperren und Fehler

- Auf demselben Linux-VPS teilen alle Backendprozesse/-container **dasselbe lokale POSIX-Volume**, Backend read-only. Ein Thread-/Prozesscache entscheidet niemals über die Freigabe. NFS/SMB und mehrere VPS ohne gemeinsame verlässlich getestete Locksemantik sind nicht unterstützt.
- Der Koordinator läuft im Backupservice unabhängig von HTTP-Verbindung und Backend. Sein Neustart erkennt unterbrochene Jobs und lässt den Zustand gesperrt. Fehlt der Status trotz vorhandenem Journal, folgt ebenfalls Recovery; keine automatische Normalisierung.
- Fehlender, beschädigter oder nicht erreichbarer Kontrollbestand sperrt das Backend. Compose startet den Backenddienst erst nach gesundem Backupservice. **Kontrolldateien/Lockdateien niemals löschen oder zurücksetzen.**
- Der Backend-Startup führt bestehende Alembic-Schritte unter derselben gemeinsamen Sperre aus; auch der Kindprozess erbt die Sperre. Bei bestehendem Restore startet nur der geschützte Kontrollpfad, keine Startupmigration.
- Authentifizierungs-GET und `GET /api/admin/database/restore-status` benötigen keine Verbindung zur betroffenen Datenbank. Statusantworten sind `no-store`. Das bekannte Admin-Fallback bleibt bei fehlendem operativem Kontext erreichbar.
- SQLAlchemy-Sessions enden vor Lease-Freigabe; nach erfolgreichem Restore entsorgt jeder Prozess seinen alten Pool. `pool_pre_ping` bleibt aktiv.
- `X-Database-Generation` bindet Clients an den bekannten Datenbankstand. Nach Restore werden fehlende/veraltete Schreibgenerationen vor jeder Mutation mit 409 abgewiesen. Der zentrale API-Client verwirft geänderte/veraltete Antworten und lädt die Anwendung vollständig neu; dadurch bleiben keine alten Personen-IDs, Detaildialoge, Events oder Quoten in Caches. Auch Downloads verwenden diesen Transport.
- Kein automatisches Aufheben bei Fehlern, keine zweite Restoreausführung durch Polling. Der Startbutton ist bis zur korrekten Bestätigung und während einer Operation gesperrt. Statuspolling ist seriell, nur während laufender Phasen. Bei verlorener Startantwort wird Status geprüft statt ein weiterer Auftrag gestartet.
- Reset bleibt separat durch das bestehende manuelle `DATABASE_MAINTENANCE_MODE`, `database.reset`, Bestätigung und Scopeprüfungen geschützt. Die automatische Restorekoordination schaltet Reset nicht frei. Ein ausdrücklich gesetzter manueller Wartungsflag bleibt zusätzlich wirksam.

**Betriebsgrenze:** genau ein regulärer Backupservice/Scheduler; mehrere Backendprozesse sind unterstützt. Alle operativen Anwendungsschreibpfade laufen durch das Request-Gate. Direkte SQL-/ETL-/Administrationswerkzeuge außerhalb des HTTP- und Startup-Pfads sind vor Restore anzuhalten; sie sind keine alternative freigegebene Schreibschnittstelle. Kein Deploy/Codewechsel während einer Operation. Das bestehende Datenbankkonto benötigt die bereits zuvor erforderlichen Staging-/Rename-/Verbindungsrechte; es werden keine PostgreSQL-Rechte automatisch vergeben.

## Frontend und Proxy

- `frontend/Dockerfile`: Node22-Buildstage, pnpm10.30.3, frozen Lockfile, Typecheck/Build; Runtime ausschließlich Nginx1.28 und dist. Optionale CA-Buildsecret-Mounts bleiben außerhalb der Imagelayer.
- `/api` wird fest beim Build eingebettet. Keine Runtime-VITE_API_URL oder Frontend-Source-Mounts. Das bestehende optionale root/public-Verzeichnis wird als überprüfter Buildinhalt übernommen; keine .env-Dateien im Buildkontext.
- Interner Port5173 bleibt erhalten, keine veröffentlichten Produktionsports. Bestehender Gateway auf8080, Netzwerke, Authelia-Vertrauensgrenze und `/api`→Flask bleiben erhalten. HMR-Upgradeheader entfallen; keine weitere Service-/Proxyebene.
- SPA-Fallback, no-store für index, immutable für Vite-Assets, gzip. Fehlende Assets, Source-/HMR-/versteckte Dateipfade liefern404. API-Antworten werden nicht im statischen Server gecacht.
- Healthcheck prüft den lokalen statischen Listener ausdrücklich ohne Outboundproxy. PostgreSQL- und Backupvolumes bleiben unverändert.

## Prüfungen

- Vollständiges Backend: **905 Tests +1.304 Untertests bestanden** (213,58s). Nach abschließendem Schema-/Zielhandshake zusätzlich sämtliche26 betroffenen Endpoint-/Koordinations-/Startupfälle erfolgreich geprüft.
- Zusätzliche Koordination/Startup-Fälle: 10 bestanden; echter Prozessabbruch, Neustart, fehlender Status trotz Journal, fremder Prozess, readonly Containerlease, alte Clientgeneration, blockierte Import-/Buchungs-/Adminrequests, Status ohne DBzugriff.
- Backup/Infra: **32 Tests** +14 Untertests bestanden; darunter Autorisierung des privaten Jobstarts, Bestätigung, parallele Jobs, Drain, Schemafehler, Safety-Restore-Fehler, explizite Recovery, Compose-Overrideprüfung. Vorhandene Rollback-/Migrationspackagetests bleiben enthalten.
- Frontend: **179 Tests bestanden**; Typecheck und Build erfolgreich. Generationstests verhindern Cacheübernahme/weitere Schreibrequests nach Restore, auch wenn ein alter Responsebody verspätet eintrifft.
- Echter PostgreSQL17-Smoke: `scripts/test_restore_postgres17.py --container-tools`, festes isoliertes Loopback-Testziel55451 und markierter Testcontainer. Vollständiges Schema, geänderter Markerdatensatz, authentifizierter Flask-Endpoint202, unabhängiger HTTP-Backupdienst, Drain, Safety-Probe, Schema-/Zielhandshake, Staging, Tausch und anschließende Daten-/Backendhealthprüfung erfolgreich. Nur eigens erzeugte Testdatenbanken werden gelöscht; kein frei wählbarer Produktions-URL.
- Echter Chromiumlauf über gebauten Nginxcontainer und vorhandenen Gateway: Proxyauth401/200, fünf Ansichten/Deep Links/Refresh, synthetischer FIS-Upload→Freigabe→Confirm mit vier Personen, Restore-Textbestätigung und genau ein **simulierter** Jobstart, Recoveryanzeige, 390px ohne Überlauf. Kein tatsächlicher Restore im Browser; dieser wurde getrennt auf PostgreSQL17 geprüft.
- Beide Nginxkonfigurationen `nginx -t`, statischer Healthcheck, gzip/cache, keine Node-/Source-Runtime, keine HMR-Requests erfolgreich. Compose-Struktur ohne Environmentauflösung validiert; diff-check erfolgreich.
- **Offener Buildnachweis:** Das Backupimage konnte hier wegen Proxy-HTTP403 auf `dl-cdn.alpinelinux.org` nicht gebaut werden. Sein ursprünglicher Alpine-Paketschritt ist unverändert. Packagetests und echter PG17-Restore verwenden dieselben Pythonquellen; der Smoke nutzt die PG17-Clients des isolierten Testcontainers. Das ersetzt ausdrücklich nicht den abschließenden Build-/Healthchecknachweis des tatsächlichen Backupimages auf CI/Staging.
- Authelia auf dem produktiven WireGuard-Proxy, produktiver Override und VPS-Ressourcen wurden nicht angesprochen. Deren Abnahme bleibt Operatoraufgabe.

## Lokaler Performancevergleich

Gleiches Backend, gleicher synthetischer Bestand von rund300 Personen/45 Hotels/109 Kontingenten/sieben Planungs-Events. Beide Frontendvarianten im Container; frische Chromiumkontexte ohne Browsercache, Loopback ohne Drosselung. Dev verwendet dieselbe Buildstage als Testimage, Produktion die tatsächliche Nginxruntime über den Gateway. Transfer/Requestzahl betreffen ResourceTiming-Unterressourcen einschließlich APIs, ohne Hauptnavigation. Ein Messdurchlauf, keine SLA. Erste Devnavigation beinhaltet die anfängliche Dependencyoptimierung. Ladezeit umfasst `networkidle` inklusive500ms; keine isolierte React-Renderzeit.

| Ansicht | Dev / Produktion Ladezeit ms | Dev / Produktion Transfer B | Dev / Produktion Requests | API-Requests |
|---|---:|---:|---:|---:|
| Dashboard |3398 /1062|6.889.651 /1.087.946|85 /14|11|
| Import |1603 /927|6.581.925 /322.240|97 /24|4|
| Administration |1327 /931|6.545.705 /333.803|93 /32|6|
| Hotels |1415 /915|6.371.811 /344.804|93 /34|6|
| Zuweisungen |1925 /1252|8.884.171 /2.091.830|114 /34|6|

Nach Ladeende in einer weiteren Sekunde keine Refetches; maximal8 parallele Dashboard-APIs, sonst2–3. Produktions-API-Dauern je Ansicht: Dashboard9–269ms, Import10–19ms, Administration9–57ms, Hotels10–97ms, Zuweisungen16–309ms. Die API-Requestzahl bleibt gleich. Clientnavigation zu Import/Administration im warmen Kontext: Dev63–115ms, Produktion73–86ms; kein allgemeiner Beschleunigungsnachweis für warme Navigation.

Ein WebSocket und zahlreiche Source-Ressourcen pro Devseite, **null** im Produktionsimage. Finales Hauptbundle478,70kB /153,69kB gzip. Momentaufnahme nach dem Lauf: Devcontainer619,5MiB/0,12% CPU, statisches Frontend4,75MiB/0%, Gateway2,99MiB/0%. Keine Last-/Peakmessung und keine Zusage für den VPS. Große operative JSON-Payloads bleiben fachlich unverändert.

## Rollout auf dem bestehenden VPS – ausschließlich durch Operator

1. In `/home/Projects/incoming` Gitstatus/Commit, lokale Änderungen und Images/Digests dokumentieren. Kein blindes Pull/Überschreiben lokaler Overrides. Abbruch bei ungeklärten Änderungen.
2. Zusammengeführte Konfiguration prüfen, ohne Secrets auszugeben:
   `docker compose config --format json | python3 scripts/check_production_compose.py`
   Der Prüfer verwirft alte Vitecommands, Frontendmounts/Ports, Runtime-VITE_API_URL, abweichende Backupvolumes, unerwartete Backendentrypoints und fehlende Koordinatorabhängigkeit. Er prüft auch vorhandenes, gleiches AUTH_PROXY_SECRET in beiden Diensten, ohne dessen Wert auszugeben. Eine lokale Override-Datei muss bewusst angepasst werden; niemals automatisch löschen. `--structural-only` ist nur für Quellcode-/CI-Prüfung ohne reale Environmentauflösung.
3. PostgreSQL-/Backupzustand, freien Speicher für Safety-/Stagingdatenbanken und Backups prüfen. Aktueller Alembichead muss bereits20261025_02 sein. Bei Abweichung separaten Migrationsreview durchführen. Aktuelles Backup und isolierte Restoreprobe nachweisen; Konfiguration/Override/incoming.env geschützt außerhalb Git sichern. Vorherige Images und Codeversion als Rollback erhalten.
4. Wartungsfenster abstimmen. Aktive Imports/Buchungen abschließen lassen; externe SQL-/ETL-/Adminwerkzeuge anhalten. Laufender Restore/RECOVERY_REQUIRED blockiert Rollout. **Der Backend-Source-Bindmount besteht weiter:** vor dem Codecheckout alle bisherigen Backendprozesse kontrolliert stoppen, damit kein alter Prozess neue Module nachlädt. PostgreSQL und Volumes nicht stoppen/löschen. Kein `down -v`, kein Reset.
5. Gewünschten Reviewcommit übernehmen und ausschließlich geänderte Images backend/backup/frontend bauen. Backupimage muss auf CI/Staging vollständig gebaut/healthy und aus demselben Release wie Backend sein; der lokale Proxyblocker darf nicht ignoriert werden. Bei Buildfehler altes Release wiederherstellen, keine Teilfreigabe.
6. Backupservice kontrolliert mit neuem Image starten, Healthcheck und initiales Kontrollverzeichnis prüfen. **Seine Neuerstellung ist für den neuen Koordinator erforderlich**, PostgreSQL bleibt unangetastet. Dann Backend, Frontend und Gateway gezielt `up -d --no-deps` aktualisieren. Bestehender Backendentrypoint führt bei unverändertem Head nur den bestehenden No-op-Migrationscheck unter Lease aus.
7. Healthchecks, externen Authelia-Login, API401/200, Eventwahl, Daten-/Kontingentzahlen, Dashboard, Hotels, Zuweisungen, Deep Links und Caching testen. Kein öffentlicher Devport/HMR mehr. Backupstatus, Rechte und Vorbereitungsdialog einschließlich Textbestätigung prüfen; **keinen produktiven Restore als Smoke auslösen**. Normaler Benutzer muss403 erhalten; Reset bleibt separat gesperrt.
8. Releasecommit/Images/Prüfergebnisse dokumentieren. Datenbank- und Backupvolumes unverändert erhalten. Kein automatischer Merge/Deployment durch Codex.

## Fehler-Recovery und Rollback

Status/Journal und Sicherheitsbackup liegen unabhängig von der Datenbank im Backupvolume. Der Status kann im Adminbereich bzw. im Backupcontainer lesend geprüft werden. Bei RECOVERY_REQUIRED: keine weiteren Imports, keine Lock-/Statusdateien löschen und keine alten Backendimages starten, die den Koordinator noch nicht beachten.

1. Operation-ID, Phase, Safety-Backup und protokollierte Staging-/Rollbacknamen ermitteln. Fehler/Platz/DBverfügbarkeit prüfen. Ursprüngliche oder neue Datenbank und fachlichen Datenbestand bewusst identifizieren; einen laufenden Job nicht durch Gitrollback vermeintlich rückgängig machen.
2. Falls erforderlich original erhaltene Datenbank oder geprüftes Safety-Backup durch autorisierten DBA kontrolliert recovern. Keine automatische Löschung/Umbenennung auf Basis einer Vermutung. Arbeitskopien/Archive erhalten.
3. Erst nach fachlicher Betriebsprüfung explizite Freigabe im Backupcontainer:
   `python /opt/backup/restore_jobs.py recover --operation-id "$RESTORE_OPERATION_ID" --confirmation 'RECOVERY VERIFIED'`
   Der Operator setzt RESTORE_OPERATION_ID anhand des geprüften Status. Das Werkzeug verlangt passenden Recoveryzustand, exklusive Sperren sowie aktuellen Head und sämtliche Modellspalten. Es kann einen laufenden Job oder eine weiterhin unerreichbare/inkompatible Datenbank nicht freigeben. Keine einfache Umgehung durch Wartungsvariable.
4. Browser neu laden; neue Generation und Backendpools prüfen. Das Journal bleibt erhalten.

Ein reiner Release-Rollback ist nur bei nachgewiesenem IDLE/SUCCEEDED zulässig: Backend stoppen, vorherigen Code **und** Images konsistent zurücknehmen (Source-Bindmount beachten), Frontend/Gateway zurückstellen. Keine Datenbankwiederherstellung, kein Volumewechsel, keine Migrationdowngrades. Nach begonnenem Restore zuerst Recovery abschließen; ein Git-/Image-Rollback stellt keine verlorenen Daten wieder her. Alte Images dürfen eine noch wirksame Koordinationssperre niemals umgehen.

## Verbleibende Abnahmebedingungen

Backupimage-Build/Healthcheck auf freigegebener CI-/Staginginfrastruktur, tatsächlicher produktiver Compose-Override und Authelia-/VPS-Smokes bleiben offen. Die Implementierung ist für Review vorbereitet, **keine unbeaufsichtigte Go-live-Freigabe**. Keine Änderungen an Quoten, WM-Listenzuordnung, Gebühren, FIS-Importsemantik, Eventisolierung oder fachlichen Stammdaten.
