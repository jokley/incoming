# Operative Rechte: Viewer, Editor und Admin

## Befund auf main nach #370

Der Backendguard für `POST /api/import/sessions/:id/archive` verlangt bereits
`imports.write`. Ein Editor mit schreibendem EventAccess kann die gesamte Session
schließen. Das gemeldete Editor-Verbot ist auf diesem Stand nicht reproduzierbar.
Ein fehlender/schreibgeschützter EventAccess bleibt absichtlich ein Ablehnungsgrund.
Die Rollenarchitektur und alle Backendpermissions bleiben unverändert.

Nachgewiesene Frontendinkonsistenzen:

- `buildPermissions` leitete Import-, Assignment- und Auditfähigkeiten auch aus
  Rollenbezeichnungen bzw. allgemeinem `data.write` ab, statt die jeweilige
  vom Backend gelieferte Permission zu verwenden.
- Die Importnavigation verlangte Schreibrecht, obwohl das Backend lesenden
  Importzugriff mit `data.read` erlaubt.
- Bei direktem Lesezugriff blieben Hauptaktionen wie Prüfen/Freigeben/Importieren
  aktiv. Das Öffnen einer Nationssession konnte sogar einen Recheck auslösen.
- Die Schließen-/Rückfragenaktionen prüften nur das breite Event-`canWrite`,
  nicht zusätzlich die konkrete Importfähigkeit.

Die UI verwendet jetzt die bestehenden funktionalen Fähigkeiten und den
bestehenden Eventfilter gemeinsam. Editor mit regulärem Permissionsatz bleibt
voll operativ; Viewer kann prüfen/lesen, aber keine Mutation auslösen. Eine
Session nur zum Lesen zu öffnen erzeugt keine neue Prüfversion. Auch der
Genehmigungsdialog lässt sich lesend öffnen, ohne Speichern zu erlauben.

## Berechtigungsmatrix

„Ja“ bedeutet nur funktionale Berechtigung. EventAccess und fachliche Prüfungen
werden zusätzlich und unabhängig angewandt. Kein Editor erhält eine Wildcard.

| Bereich / bestehende Permission | Viewer | Editor | Admin |
|---|---|---|---|
| Operative Daten, Importqueue/-historie lesen: `data.read` | Ja | Ja | Ja |
| Personen, Competition-Zuordnungen, Bedarf, Aufenthalte: `data.write` | Nein | Ja | Ja |
| Hotels, Kontingente, operative Perioden/Bedarfe, Zimmertypen: `data.write` | Nein | Ja | Ja |
| Zimmer/Buchungen und Disposition: `assignments.write` | Nein | Ja | Ja |
| Session erstellen, Upload, Teilmeldung, Recheck, Reimport: `imports.write` | Nein | Ja | Ja |
| Fachliche Entscheidungen, Rückfragen/Antworten/Erledigungen/Notizen: `imports.write` | Nein | Ja | Ja |
| Freigeben, Confirm, kontrollierter Ersatz, Session schließen: `imports.write` | Nein | Ja | Ja |
| Kontrolliertes operatives Entfernen: jeweilige `data.write`/`assignments.write`/`imports.write` | Nein | Ja | Ja |
| Audit lesen: `audit.read` | Nein | Ja | Ja |
| Championship-Konfiguration, Mappings, Regeln/Fixierungen, Titelreferenzen | Nein | Nein | Bestehende Administration |
| Backup, Restore, Reset, Wartung | Nein | Nein | Bestehende administrative Permissions/Guards |
| Benutzer-/Eventrechteverwaltung | Nein | Nein | Nur bestehender bestätigter Superadmin |

### Unabhängige Schutzschichten

1. Funktionale Rechte: zentrale `_required_permission()`/`ROLE_PERMISSIONS`;
   Importmutationen `imports.write`, Assignmentmutationen `assignments.write`,
   sonstige operative Mutationen `data.write`. Administrative Endpoints werden
   vorher separat klassifiziert. Kein pauschales Freischalten von DELETE/POST.
2. Eventrechte: `bind_request_event()`/`authorize_event()` verlangen einen
   expliziten grant und bei Mutationen `can_write`; Fremdobjekte bleiben isoliert.
   Auch ein funktionaler Admin erhält damit keinen fremden Eventzugriff.
3. Fachlichkeit: aktuelle Version, gültiger Prüfstand, Freigabe, relevante
   verpflichtende Rückfragen, Quoten-/EZ-Evidenz, atomarer Confirm und
   Buchungs-/Löschschutz gelten unverändert. Fehlendes Recht ist kein fachlicher
   Workflowstatus und ein erteiltes Recht ersetzt keinen dieser Guards.
4. Administration: Championship-Parameter und Fixierungen sind getrennt von
   operativen Unterkunftsperioden. Global genutzte Stammdaten bleiben zusätzlich
   durch bestehende Fremdevent-/Verwendungssperren geschützt.

## Validierung und Grenzen

43 Backendtests bestanden (Rollenmatrix für Abschluss einschließlich importierter
Personen/Buchungen, Versionsschutz, fremdes Event, Read-only-Grant, Adminschutz;
bestehender Sessionabschluss und Multi-Event-Regressionssatz). 247 Frontendtests,
Typecheck und Build bestanden.

Echte Browserabläufe gegen isoliertes PostgreSQL: Desktop 1440×1000 und Mobil
390×844, jeweils Viewer, Editor, Admin und Editor mit Read-only-Eventgrant.
Editor/Admin öffnen den Schließen-Dialog und entfernen die Session aus der aktiven
Queue; Viewer/Read-only dürfen das nicht. Zusätzlich wurden verlorene erfolgreiche
Archivierungsantworten und ein anschließend fehlgeschlagener Refresh simuliert:
Der bestehende Read-after-write-Schutz bestätigt den Abschluss, der Refreshfehler
erscheint getrennt als Warnung statt als vermeintlich fehlgeschlagene Mutation.

Kein neuer Backend-Rechtefehler nachgewiesen; keine Erweiterung von Serverrechten.
Ein abweichender produktiver Editorfall benötigt den dortigen Auth-/Eventgrant-
und Versionsstand zur weiteren Diagnose. Keine produktiven Änderungen.
