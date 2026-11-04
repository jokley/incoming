# PR9 – Superadmin, Benutzerreferenzen und Multi-Event-Betrieb

Stand: 24.10.2026. Basis: `main` `99ee259` (PR1–8 und Erststart-Anleitung).
Arbeitsbranch: `codex/superadmin-event-permissions`. Keine Produktionszugriffe,
Migrationen, Grants oder Deployments ausgeführt. Commit und Pull Request wurden
am 25.10.2026 ausdrücklich beauftragt. Die unten dokumentierten Testresultate
stammen aus dem Implementierungslauf vom 24.10.2026.

## Inventar und Architekturentscheidung

| Bestand | Wiederverwendung / gezielte Ergänzung |
| --- | --- |
| `auth.py`, `config.py` | Bestehender Secret-verifizierter Authelia-Proxy; exakte optionale Konfiguration `SUPERADMIN_USERNAME`. Keine fest eingebaute Identität. |
| `event_ownership_runtime.py` | Ein Requestowner auf Flask `g`; Superadminfreigabe nur nach Authentifizierung, Pin/Existenz/Aktivstatus weiterhin geprüft. |
| `EventAccess` / `event_access_cli.py` | Gleicher zusammengesetzter Schlüssel Benutzer+Event; READ/WRITE, NONE bleibt fehlende Zeile. CLI und UI benutzen denselben Änderungsservice. |
| `routes/identity.py`, `routes/events.py` | Serverseitige autorisierte Eventliste; Superadmin sieht aktive Events einschließlich neu angelegter Events ohne zusätzliche Grants. |
| `ActiveEventProvider`, `EventRequestScope` | Bestehende Auswahl, Requestgenerationen, Abbrüche, Dirty-/Review-/Write-Blocker. Kein zweiter Provider. |
| `AdministrationEvents` | Bestehende Eventverwaltung; neu angelegte Events aktualisieren die zentrale Auswahlliste ohne stillen Wechsel. |
| `AuditEvent` | Grantänderung mit altem/neuem Wert und Eventowner in derselben Transaktion; keine neue Auditplattform. |
| Authelia-Verzeichnis | Im Repository kein sicherer Verzeichnisclient/Directory-Token/API vorhanden. Kein Zugriff auf private Authelia-Dateien erfunden. |

### Superadmin

`SUPERADMIN_USERNAME` ist standardmäßig leer. Produktion setzt ausdrücklich
`SUPERADMIN_USERNAME=jokley`. Exakter, case-sensitiver Vergleich mit dem durch
`AUTH_PROXY_SECRET` verifizierten Proxybenutzernamen; weder `admin`-Gruppe noch
zusätzlicher frei übermittelter Header verleihen diese Stellung. Die lokale
Entwicklungsidentität ohne Proxysecret erhält sie ebenfalls nicht.

Der Superadmin erhält operative Funktionsrechte `data.read`, `data.write`,
`assignments.write`, `imports.write`, `audit.read` sowie `events.manage` und
`users.manage`. Das ist ausdrücklich **kein funktionales Wildcardrecht**.
Andere administrative Funktionen behalten die bisherigen Rollenprüfungen.
Insbesondere `admin.reset` wird nicht allein durch die Superadminstellung vergeben.
Bestehende Quotenfixierung, fachliche Genehmigungen, NO_ROOM, Preis-, Coverage- und
Buchungsprüfungen bleiben bestehen.

Normale Administratoren können weiterhin Events nach bisherigen Funktionsrechten
verwalten, erhalten dadurch jedoch keine operativen Eventrechte und können keine
Grants verteilen. Die Benutzerverwaltung prüft zusätzlich ausdrücklich die
Superadminstellung; ein funktionales `*` reicht dort nicht aus.

Superadminrechte sind nicht über normale Grants entziehbar. Auch die Deaktivierung
des letzten aktiven oder des gepinnten Events über die Superadmin-UI/API ist gesperrt,
damit keine leere bzw. unerreichbare Eventauswahl entsteht. Die UI sperrt diese
Felder; die HTTP-API lehnt entsprechende Änderungen ab. Die explizite Operator-CLI
kann weiterhin gespeicherte Wartungsgrants setzen/widerrufen (für globale Backups),
ändert damit aber niemals die effektive Superadminstellung. Serverkonfiguration und
Proxyidentität bleiben ein bewusst außerhalb der UI liegender Vertrauensanker.

### Inaktive Events und globale Aktionen

Nur aktive Events erscheinen im operativen Selector. Inaktive Events bleiben in
Admin-/Berechtigungsmetadaten sichtbar; ihre operativen Daten sind auch für den
Superadmin gesperrt. Bestehende administrative Eventendpunkte erlauben die gezielte
Bearbeitung inaktiver Events mit passender expliziter Header-ID. Die bestehende UI
bearbeitet Detailpanels weiterhin nur im aktuellen operativen Event; keine zweite
Auswahl für inaktive operative Daten eingeführt.

`OPERATIONAL_EVENT_ID` bleibt ein optionaler zusätzlicher Pin. Superadmin hebt ihn
nicht auf. Ohne Pin benötigt jeder operative Request den expliziten bestehenden
`X-Championship-Event-ID`; Bootstrap ist weiterhin die kontrollierte Ausnahme.

Globale Datenbankaktionen benötigen weiterhin die bisherige Admin-Funktionsrolle,
einen gepinnten Wartungsbetrieb und **explizite gespeicherte Grants für sämtliche
bestehenden Events einschließlich inaktiver Events**. Hier gilt die Superadmin-
Ausnahme ausdrücklich nicht. Ungepinnter Betrieb bleibt dafür gesperrt, auch bei
Grants für alle aktuellen Events: historische Dumps können weitere Events enthalten.

## Benutzerreferenz und Migration

Additive Migration `20261024_02` nach `20261024_01` legt ausschließlich
`user_reference` an: `username`, `display_name`, `groups_json`, `last_seen_at`.
Keine Änderungen/Backfills an Event, Personen, Hotels, 109 Kontingenten, sieben
Planungs-Events, Quoten, Buchungen oder bestehenden Grants. Keine Erstfreigabe.

`GET /api/auth/me` merkt ausschließlich die erfolgreich authentifizierte Identität
(zur Begrenzung von Writes höchstens stündlich bzw. bei geänderten Gruppen).
Manuell angelegte Referenzen haben noch keine beobachtete Funktionsrolle.
Die Übersicht vereinigt Referenzen, bestehende Grants und die konfigurierte
Superadminidentität. Historisch vorhandene Grants bleiben daher sichtbar, ohne
Migration/Umdeutung. Gespeicherte Gruppen sind nur zuletzt beobachtete Hinweise;
autorisiert wird ausschließlich mit den aktuellen Proxygruppen.

Keine Passwörter, Sessions, Authelia-Verzeichnisreplikation oder Benutzerlöschfunktion.
Ein Anzeigename ist kein Identitätsschlüssel; eine Umbenennung des Authelia-Logins
überträgt keine Rechte automatisch. Der Operator muss sie explizit behandeln.

Migrationen laufen unter PostgreSQL transaktional. Der Downgrade verweigert das
Löschen einer befüllten Referenztabelle. Ein Code-Rollback lässt die additive
Tabelle bestehen. Die Model-Metadaten brauchen keine neue Importabhängigkeit im
Backup-Image; die vorhandene Dockerfile-Kopie der Migrationskette enthält PR9.

## API und UI

- `GET /api/admin/users`: bekannte Benutzer, aktive/inaktive Eventmetadaten,
  Grants, letztes Auftreten, letzte 100 Grant-Auditereignisse.
- `POST /api/admin/users`: nur exakter Benutzername und optionaler Anzeigename;
  keine Rechte, keine neue Authentifizierungsidentität, keine Rollenänderung.
- `PUT /api/admin/users/grants`: Benutzer, `expectedRevision` und explizite
  `eventId -> NONE/READ/WRITE`-Änderungen. Nicht genannte Events bleiben unverändert.
- Keine öffentliche Selbstregistrierungs-/Rollen-/Passwort-API.

Diese globale Administration ist nur dem Superadmin zugänglich. Ein mitgesendeter
Eventheader wird trotzdem wie bisher geprüft. Fremde/nicht vorhandene Event-IDs,
unbekannte Benutzerreferenzen, ungültige Werte und Selbständerung am Superadmin
werden abgewiesen. CAS-Digest und gemeinsamer Grant-Transaktionslock verhindern
unbemerkte konkurrierende Überschreibungen zwischen CLI und API. Grants und Audit
werden gemeinsam committed; bei Fehler wird die gesamte Änderung zurückgerollt.
Entzug wirkt beim nächsten Request, nicht rückwirkend auf laufende Transaktionen.

Administration → **Benutzer & Berechtigungen**: Suche, Filter, bekannte Benutzer,
letzte authentifizierte Gruppen, Superadminhinweis, Eventrechte als kompakte
Auswahl, ausdrückliches Speichern/Verwerfen, Fehler-/Erfolgsmeldung und Auditliste.
Der Bereich ist für normale Administratoren unsichtbar und serverseitig gesperrt.
Ungespeicherte Grants blockieren Eventwechsel; Benutzer-/Adminbereichwechsel fragt
vor dem Verwerfen. Rechteeskalation durch UI-Manipulation bleibt serverseitig gesperrt.

Neue Eventoptionen werden zentral aktualisiert; der aktive Workspace und offene
Formulare wechseln dabei nicht. Späte Listenantworten nach A→B→A oder einer neueren
Aktualisierung werden verworfen. Der vorhandene vollständige Eventwechsel leert
weiterhin Query-/Detailzustand über die Workspace-Revision und bricht alte Requests ab.

## Expliziter Übergangsbootstrap

Nur ausdrücklich angegebene **bekannte Benutzer** und aktuell **aktive** Championship-
Events werden berücksichtigt; AccommodationEvents sind keine Championship-Events.
Beispiel, nur als Operatoraktion:

```bash
# Zunächst reine Vorschau, keine Änderung:
docker compose exec -T backend flask --app app event-access bootstrap \
  --username 'BESTAETIGTER_BENUTZER' --read-only

# Nach Prüfung von users/events/changes/unchanged, exakt denselben Aufruf mit Digest:
docker compose exec -T backend flask --app app event-access bootstrap \
  --username 'BESTAETIGTER_BENUTZER' --read-only --apply 'GEPRUEFTER_DIGEST'
```

Mehrere `--username` sind möglich. `--write` nur nach ausdrücklicher Prüfung statt
`--read-only`. Bereits vorhandene READ- **und WRITE-Grants bleiben unverändert**;
kein automatisches Hoch-/Herabstufen. Unbekannte Benutzer vorher im Adminbereich
als Referenz anlegen. Bei verändertem Plan scheitert der alte Digest; eine neue
Vorschau ist erforderlich. Wiederholte aktuelle Vorschau/Bestätigung ist idempotent.

Keine Migration, Anmeldung oder periodische Aufgabe führt Bootstrap aus. Spätere
Events werden nicht automatisch freigegeben. NONE ist wie bisher das Fehlen einer
Zeile; der Bootstrap kann eine früher bewusst entfernte Freigabe nicht von einer
nie vorhandenen unterscheiden. Deshalb kein regelmäßiger pauschaler Aufruf: Jede
Wiederholung zeigt fehlende Grants ausdrücklich in `changes` und verlangt erneut
Operatorfreigabe. Individuelle Entzüge jederzeit über UI oder vorhandene CLI.

## Produktionsrollout – ausschließlich durch Operator

1. **Bestand/Identität prüfen:** aktueller Release, Alembic `20261024_01`, exakter
   `username` über echten Authelia-Browser `/api/auth/me`, Pin und vorhandene Grants.
   Hotel-/Kontingent-/Personen-/Booking-/Planungs-/Approvalzahlen read-only erfassen.
   Keine gerenderten env-/Compose-/Inspect-Ausgaben mit Secrets veröffentlichen.
   Bestehende `jokley`-Freigabe für Code-Rollback erhalten; falls sie fehlt,
   separat ausdrücklich über die Operator-CLI vergeben. Diese CLI bleibt auch
   bei konfiguriertem Superadmin für explizite Wartungsgrants nutzbar; die Web-UI
   kann solche Rechte nicht selbst freischalten.
2. **Backup und Restoreprobe:** bestehendes geprüftes Verfahren benutzen, oder
   im privaten Verzeichnis unter `umask 077` mit dem bestehenden DB-Container:

   ```bash
   docker compose exec -T postgres sh -c \
     'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > incoming-before-pr9.dump
   ```

   Dump ausschließlich in einen **neu angelegten separaten** PostgreSQL-17-
   Restoretest-Container/-Cluster mit eigenen privaten Testzugangsdaten einspielen,
   z. B. `pg_restore --no-owner --no-acl --exit-on-error`. Bestandszahlen/Beziehungen
   dort vergleichen; niemals den laufenden Produktivcluster als Testziel verwenden.
   Dump enthält personenbezogene Daten: geschützt aufbewahren, nicht committen.
3. **Geprüften Release bereitstellen**, private `incoming.env` gesichert ändern:
   `SUPERADMIN_USERNAME=jokley`, `AUTH_DEV_USER` leer, bestehendes `AUTH_PROXY_SECRET`
   beibehalten (eine erforderliche Secret-Rotation ist separat in der PR8-Anleitung
   beschrieben). Zunächst `OPERATIONAL_EVENT_ID=1` **beibehalten**.
4. **Additive Migration/Start:** nach Backup und Freigabe:

   ```bash
   docker compose build backend frontend backup
   docker compose up -d --no-deps --force-recreate backend frontend backup
   docker compose exec -T backend python -m alembic -c /app/alembic.ini current
   ```

   Backend-Entrypoint führt `upgrade head` vor Gunicorn aus; der Head muss der
   geprüfte `20261024_02` sein. Keinen parallelen Migrationsprozess starten.
   Migrationsfehler stoppen den Start, statt halb migriert zu dienen. Kein `down -v`.
5. **Gepinnt prüfen:** echter Browser `/api/auth/me` meldet `isSuperadmin:true` für
   den bestätigten Proxybenutzer. Bootstrap liefert nur Event 1, Pin sperrt Wechsel.
   Bestandswerte/Beziehungen vergleichen. Normale Adminidentität ohne Grant bleibt
   gesperrt. Benutzerverwaltung mit einer bestätigten zweiten Identität prüfen.
6. **Multi-Event freigeben:** erst nach erfolgreicher isolierter Restore-/Regression-
   und Zwei-Championship-Prüfung `OPERATIONAL_EVENT_ID` aus `incoming.env` entfernen
   (auch ggf. Compose-Override prüfen). Nur Backend mit neuer Umgebung neu erstellen:

   ```bash
   docker compose up -d --no-deps --force-recreate backend
   ```

   Bloßes `restart` lädt env-Datei nicht neu. Fehlender Pin ist die bewusste
   Freigabe; keine Codeänderung schaltet Produktion stillschweigend um.
7. **Zwei echte Championship-Kontexte** verwenden (kein zweites Event oder
   Testperson automatisch anlegen). Auswahl A→B→A, getrennte Listen, Imports,
   Quoten, Kontingente, Buchungen prüfen. Leeres neues Event hat zunächst Entwurfs-
   Regeln und muss seine bestehende Fixierung durchlaufen; kein beliebiger Import.
   Steht produktiv erst ein Championship zur Verfügung, bleibt der produktive
   Zwei-Event-Nachweis offen; isolierter Nachweis ersetzt keine Behauptung darüber.
8. **Benutzerrechte:** explizite Referenz ohne Grant, READ, WRITE mit Rollenrechten,
   Entzug, normaler Admin ohne Benutzerverwaltung. Übergangsbootstrap nur bei Bedarf
   nach seiner eigenen Vorschau/Bestätigung. Backups im ungepinnten Modus bleiben
   absichtlich gesperrt und brauchen getrennten Wartungsbetrieb.

## Rollback ohne Bestandsverlust

- Bei Umschaltproblemen zuerst Pin wieder setzen und Backend mit neuer Umgebung
  neu erstellen. Keine Daten, Regeln oder Grants löschen.
- Falls Code-Rollback nötig: vorigen geprüften PR8-Release und dessen Images
  bereitstellen, `SUPERADMIN_USERNAME` entfernen, vorhandene explizite persönliche
  Freigabe und Pin verwenden. Alten Release nicht mit neuen Modeldateien mischen.
- Additive `user_reference`-Tabelle bestehen lassen, Alembic nicht blind downgraden.
  Ein unverändertes PR8-Image kennt die neue Alembicrevision nicht und ist daher
  kein direkt startfähiges Rollbackartefakt. Vorab ein geprüftes Rollbackartefakt
  vorbereiten: PR8-Laufzeitcode mit beibehaltener Datei
  `20261024_02_user_reference.py` in der Migrationskette. Damit erkennt Alembic
  den bereits erreichten Head, ohne Schemaänderung. Dieses Artefakt zuerst auf
  der wiederhergestellten isolierten Datenbank prüfen. Bevorzugt Pin-Rollback oder
  vorwärts korrigieren; kein produktives Stamp/Downgrade/Restore automatisch.
- Keine Sicherung über inzwischen entstandene operative Daten zurückspielen.
  Ein echter Disaster-Recovery-Restore ist separat freizugeben, mit eigenem RPO.

## Tests, Nachweise und verbleibende Grenzen

Alle finalen Tests isoliert am 24.10.2026:

| Prüfung | Ergebnis |
| --- | --- |
| Vollständiges Backend einschließlich Migrationen und echten JPN-Dateien | **856 bestanden, 1.250 Subtests**, keine ausgelassenen Tests; 188,18 s |
| Neue PostgreSQL-/HTTP-Sicherheitsfälle | **9 bestanden** (in Gesamtsuite enthalten) |
| Vollständiges Frontend | **172 bestanden**, keine ausgelassenen Tests |
| Vollständige Backup-Suite | **21 bestanden, 14 Subtests**; 1,70 s |
| Typecheck | erfolgreich |
| Produktionsbuild | erfolgreich; 7,07 s |
| `git diff --check` | erfolgreich |
| Echter lokaler Chromium-Browser | **14 Prüfungen**, keine JavaScript-Ausnahmen |

Die Backendrunde enthält die echten JPN-Imports/Reimports, vorhandene Quoten-/EZ-/
Tarif-/NO_ROOM-/Coverage-/Split-/Preservation-Regressionen, bestehende Querybudgets,
Route-Manifest und alle bisherigen Accessgrenzen. Bekannte datetime-/SQLAlchemy-
Deprecation-Warnungen bleiben bestehen (26.841 im finalen Testlog).

Erster Gesamtlauf: 849 bestanden, vier JPN-Fälle mangels Umgebungsdateipfaden
übersprungen, vier fehlgeschlagene Assertions. Korrigiert wurden der echte
OPTIONS-Fehler am neuen Blueprint sowie nachweislich additive Testerwartungen:
`isSuperadmin:false`, unveränderte Ausgangsrevision bei transaktionalem Rollback.
Routenmanifest um die beiden neuen Pfade ergänzt; reine Authentifizierungs-
Sentineltests isolieren die Referenzpersistenz, deren echte DB-Wirkung separat
abgenommen wird. Keine Tests deaktiviert. Der finale Lauf enthält alle Originaldateien.

Browser: echte Vite-/Flask-/PostgreSQL-Instanzen, separate neu erstellte Datenbank
`incoming_pr9_browser` auf dem eigenen Wegwerfcluster, zwei Championship-Events,
identischer FIS-Code, getrennte Personen. Ein ausschließlich auf Loopback laufender
Testproxy überschreibt Identitätsheader; kein API-Mock, aber **kein produktiver
Authelia-End-to-End-Nachweis**. Geprüft: Grant speichern/persistieren, Superadmin-
Selbstschutz, Dirty-Blocker, A→B→A, manuelle Referenz ohne Grant, gesperrte normale
Admins, neue Eventoption ohne stillen Wechsel, Light/Dark und 390px ohne horizontales
Clipping. Erste Harnessversuche korrigierten Locator und Testzustand; keine daraus
abgeleitete Produktcodeänderung. Artefakte/Logs nur lokal unter `/tmp/pr9-*`.

Frontendbefehle entsprechen direkt den vorhandenen Paketskripten:
`node --experimental-strip-types --test 'src/**/*.test.ts'`,
`node node_modules/typescript/bin/tsc --noEmit`,
`node node_modules/vite/bin/vite.js build`. Backend: `python -m pytest tests -q`
mit ausschließlich explizitem isoliertem PostgreSQL-Testziel und beiden bereitgestellten
JPN-Dateipfaden. Backup: `python -m pytest backup/tests -q`.

### Dateien

- Backend: `auth.py`, `config.py`, `event_ownership_runtime.py`, `models.py`,
  `app.py`, `routes/identity.py`, `routes/events.py`, `event_access_cli.py`;
  neu `user_access.py`, `routes/user_access.py`,
  `migrations/versions/20261024_02_user_reference.py`.
- Backendtests: neu `tests/test_user_access_admin.py`; erweitert
  `test_event_access_migration.py`, `test_api_route_safety.py`,
  `test_identity_audit_read_routes.py`, `test_event_quota_migration.py`,
  `fixtures/api_routes.json`.
- Frontend: neu `components/AdministrationUsers.tsx` und zugehöriger Test;
  `Administration.tsx`, `AdministrationEvents.tsx`, `auth/permissions.ts`,
  `events/ActiveEventProvider.tsx`, `events/activeEventStore.ts`,
  `events/activeEvent.test.ts`, `services/api.ts`, `types.ts`.
- Dokumentation: dieser Bericht.

### Verbleibende Grenzen

- Produktiver Authelia-/Edge- und Zwei-Championship-Nachweis sowie Restoreprobe
  liegen beim Operator; hier wurde nichts gegen den VPS ausgeführt.
- Konfigurations-/Identitätsänderungen des Superadmins können nur außerhalb der
  UI erfolgen. Sichere private Konfiguration/Proxyheader bleiben Voraussetzung.
- Normale Rechteverwaltung ist global nur für den Superadmin; es gibt bewusst
  keine delegierten Rechteverwalter oder Rollenbearbeitung.
- Bekannte Gruppen sind letzter Beobachtungsstand; kein vollständiges Authelia-
  Verzeichnis und keine Garantie, dass eine manuelle Referenz dort existiert.
- Ein Widerruf bricht keine bereits laufende autorisierte Transaktion ab.
- Ungepinnte globale Backups/Restores bleiben gesperrt; Wartungsverfahren ist separat.
- Code-Rollback auf ein unverändertes älteres Image ist wegen der neuen Revision
  nicht ausreichend; vorbereitetes Artefakt wie oben erforderlich.

Keine Änderungen an Quotenformeln, Fixierungsmodell, Approvals, Tarifen, EZ,
NO_ROOM, Import-Preservation, Coverage, Split/Join oder Room Assignments.
Authelia-Verzeichnisintegration, Benutzernamenänderung, Weltmeisterverwaltung,
Internationalisierung und generisches Berechtigungsframework sind nicht Bestandteil.
