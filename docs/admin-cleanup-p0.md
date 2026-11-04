# P0: Event- und nationenbezogene Admin-Bereinigung

Basis: `main` d2d8b92 einschließlich PR341. Keine produktive Datenänderung, Migration, Bereinigung oder Deployment durchgeführt. Keine Schemaänderung.

## Nachgewiesene Ursachen und Korrektur

1. Der alte Aktivitätenreset löschte ImportSessionEvent und damit `QUOTA_DECISION_REVISED_FROM`. Diese Historie steuert die Anwendbarkeit von Athleten-/EZ-Entscheidungen und darf nicht wie ein technisches Log behandelt werden. Die Bereinigung löscht deshalb weder AuditEvent noch isoliert Workflowhistorie oder ImportRun. Der alte `activities`-Aufruf ist sicher kompatibel, aber löscht keine Fachevidence und meldet dies ausdrücklich. Die irreführende Löschkarte entfällt.
2. PR341 ergänzte `Athlete.accommodation_rate_approval_id`. Der alte Importreset löschte Genehmigungen bei verbleibenden Tarifreferenzen und scheiterte am FK. Jetzt werden zusammengehörige operative Daten in FK-Reihenfolge gelöscht; verbleibende Tarife/Genehmigungen werden niemals durch Nullsetzen ihrer Herkunft „passend gemacht“.
3. Alte Resetpfade waren global und deshalb bei einem zweiten Event beziehungsweise ohne manuellen Wartungsmodus gesperrt. Sie wurden durch einen expliziten Event-/Nationen-Löschumfang ersetzt. Die globale Restore-Koordination bleibt unverändert verpflichtend.

Keine Änderung an Importengine, Matching, Quotenformeln, Genehmigungsworkflow, Tarifsemantik, NO_ROOM, countsAsSingle oder regulären Buchungsmutationen.

## API und Bedienung

Bestehender Pfad `/api/admin/test-data/reset`:

- `GET ?scope=...&nation=...`: lesende Umfangsvorschau mit Nationenauswahl, Anzahl abhängiger Datensätze und erhaltenen Stammdaten.
- `POST {scope, nation?, confirmed:true}`: normale Dialogbestätigung. Der alte interne Bestätigungstoken bleibt als Kompatibilität akzeptiert; es gibt keine Texteingabe.
- Beide Requests verwenden den zentralen ActiveEvent-Kontext und `X-Championship-Event-ID`. Kein globaler aktiver Eventzustand.
- Authentifizierung und vorhandene `database.reset`-Funktionsberechtigung plus Event-WRITE sind erforderlich. Admin ohne Eventrecht und READ-only werden abgewiesen. Der verifizierte Superadmin nutzt die vorhandene Ausnahme für alle zulässigen Events. Die Deployment-Pin-Grenze bleibt bestehen.
- Kein zusätzlicher manueller Wartungsmodus. Tatsächlicher Restore/Recovery sperrt die Operation weiterhin durch die bestehende Request-Lease und Datenbankgeneration.
- Neue UI im bestehenden Administrationsbereich: Nation wählen → Löschumfang ansehen → „Abbrechen“ / „Löschen“. Eventwechsel während offenem Dialog/laufender Mutation ist durch den vorhandenen Provider geschützt. Nach Erfolg werden Datenansichten neu geladen.

## Verbindlicher Löschumfang

| Auswahl | Wird entfernt/gelöst | Bleibt erhalten |
|---|---|---|
| `nation` | Personen der gewählten Nation im Event, deren Memberships und Belegungen; leere Buchungen; zugehörige ImportSession, Versionen, Genehmigungen und Sessionhistorie | Andere Nationen und Events; gemeinsam genutzte Zimmer für verbleibende Bewohner; globale Auditnachweise; nicht nationengenau zuordenbare ImportRuns |
| `all` | Operative Personen, Memberships, Buchungen, Belegungen, Legacy-Zuweisungen und Importdaten des gewählten Events; eindeutig eventgebundene ImportRuns | Andere Events sowie alle unten genannten Stammdaten und Auditnachweise |
| `assignments` | Physische Buchungen/Belegungen und Legacy-Zuteilungen; Hotel-/Zimmerbezug an FIS-Legacydaten | Personen, Tarife, Genehmigungen, Sessionhistorie und importierte Room-List-Anfragen einschließlich Zimmerwunsch, Partner und Zeitraum |
| `imports` | Unverwendete Importprüfungen mit zugehörigen Versionen/Genehmigungen/Historie | Sobald noch Personen oder externe Referenzen betroffen wären: kontrolliertes409 mit Verweis auf Nationenbereinigung; keine Tarif-/Approval-Umschreibung |
| `activities` | Keine funktionalen Daten; alter API-Aufruf bleibt gefahrlos | Sämtliche Audit-/Workflow-/Revisionsnachweise und ImportRuns |

Der alte unpräzise Umfang `athletes` wird nicht stillschweigend zu einem größeren Reset umgedeutet. Die UI bietet die eindeutig beschriebenen Nationen-/Eventaktionen an; ungültige alte Umfänge werden verständlich abgewiesen.

Immer erhalten: Hotels, RoomTypes, Kontingente, AccommodationEvents/Bedarfsplanung und EventRoomDemand, Championship-Event, Competition-Stammdaten und EventCompetition-Mappings, Quotenregeln und Revisionen, Weltmeistertitel/-anerkennungen, Benutzer und Eventrechte.

### Beziehungen und unklare Altdaten

- Bei gemeinsam belegten Zimmern werden nur die Zielpersonen entfernt. Die Buchung der verbleibenden Bewohner behält ID, Zimmer, Zeitraum und countsAsSingle.
- Legacy-Paarzeilen werden bei Bedarf auf den überlebenden Bewohner umgehängt; Personen-/Partner-FKs werden gelöst. Ein neuer lokaler Quellschlüssel verhindert eine Kollision beim frischen Wiederimport der gelöschten Nation. Andere Fachwerte bleiben erhalten.
- Textuelle Zimmerpartnerbezüge werden nur gelöscht, wenn sie eindeutig auf entfernte Personen verweisen.
- Fremde Personen-/Event-/Version-/Genehmigungsreferenzen führen zu einem kontrollierten Konflikt vor jeder Löschung. Keine fremden Datensätze oder Preise werden zur Erzwingung eines Deletes geändert.
- ImportRuns mit `event_id=NULL` und nicht eindeutig zuordenbare Auditdaten werden nicht pauschal gelöscht.
- Personenreferenzen auf Tarife und EZ-Genehmigungen verschwinden nur zusammen mit den ausdrücklich gelöschten Personen. Die Genehmigungen der anderen Personen bleiben unverändert.
- Personen-/Versions-/Buchungs-IDs und Sequenzen werden nicht zurückgesetzt. Alte Previewtokens besitzen nach Entfernung ihrer Session keine Confirm-Autorität.

## Transaktion und Sicherheitsbackup

`backend/admin_cleanup.py` ist ein enger Löschservice für diesen Administrationspfad, keine neue Import- oder Genehmigungsplattform. Er bündelt dieselbe Umfangsprüfung für Vorschau und Ausführung. Ausführung berechnet den Umfang nochmals unter Sperre; der Client bestimmt keine Tabellen oder Personen-IDs.

- Bestehende Accommodation-Schreibsperre plus PostgreSQL-Tabellensperren schützen das kurze Intervall zwischen frischem Backup-Snapshot und Löschen vor konkurrierenden Schreibzugriffen. Lesen/pg_dump bleibt möglich. Ein Locktimeout führt zum vollständigen Rollback.
- Vor einem nicht leeren vollständigen Eventreset wird automatisch ein **frisches** Sicherheitsbackup erstellt und mit PostgreSQL-Werkzeugen geprüft. Ein bloß angenommener202-Backupauftrag reicht nicht.
- Der Backupdienst erhält dafür den kleinen internen Endpoint `/cleanup-backup`: vorhandenes Control-Secret, expliziter Vergleich von Host/Port/Datenbank, vorhandene Backup-/Restorelocks, Wiederverwendung von `create_backup()` und `validate_dump()`. Nur abgeschlossener Erfolg liefert200 und eine Referenz auf das Archiv.
- Timeout/Fehler/ungültiges Archiv/falsches Datenbankziel: kein Delete. Fehler während Delete/Audit/Commit: vollständiger Rollback.
- Ein bereits leeres Event kann wiederholt bereinigt werden, ohne erneut ein unnötiges Backup zu verlangen.
- Nationenbereinigung und Entfernen von Zuweisungen benötigen keine zusätzliche manuelle Wartung oder externe Vorarbeit. Vorhandene Backup- und Downloadrechte bleiben unverändert verfügbar.
- Der administrative Löschumfang samt Akteur und Sicherheitsbackup wird im selben Commit als kanonisch eventgebundener AuditEvent protokolliert. Fachliche Auditdaten werden nicht geleert.

## Tests und Browsernachweise

- Vollständiges Backend: **956 erfolgreich, 1.309 Untertests**, keine übersprungenen Fälle; reale bestehende JPN-Regressionsdateien eingebunden.
- Abschließender gezielter Lauf: **77 erfolgreich**, einschließlich zusätzlicher Nachweise für Room-List-Erhalt beim reinen Zuweisungsreset und die konkurrierende Schreibsperre.
- Neue Abnahmefälle: Vier statt acht nach Aktivitätenbereinigung; unveränderte historische Approval-Evidence; APPROVAL-Tarif-FK; Nationen-/Event-Isolation; gemeinsame Zimmer und Legacy-Partner; fehlschlagendes Backup und Commit; Wiederholung; alte Tokens; fehlende/READ-/WRITE-Rechte; fremde Tarifreferenz; kein Erfolg aus202; frischer Import nach Reset.
- Sieben strukturell anonymisierte FIS-Paare (ITA, NZL, ISR, JPN, GER, KOR, USA): Import/Reimport und Nation löschen → dieselben Dateien frisch importieren. Originalnamen, IDs, Kontakte und Dateien sind nicht im PR.
- Frontend: **188 Tests erfolgreich**, Typecheck und Produktionsbuild erfolgreich.
- Backup-Suite: **33 Tests und 14 Untertests erfolgreich**; zusätzlicher Test prüft internes Secret, Datenbankziel, echte Abschlussantwort und Archivprüfung. Restore-Tests bleiben bestehen.
- Chromium mit isolierter synthetischer PostgreSQL-Datenbank: Nation mit genehmigungsgebundenem SPECIAL über normalen Dialog gelöscht, Eventheader geprüft, Eventreset mit **echtem pg_dump/pg_restore --list**, kein Texteingabefeld/manueller Wartungsmodus, schmale Ansicht ohne Überlauf. Nachprüfung: Event A leer, Person in Event B sowie Hotel und109 Kontingentzimmer erhalten.
- Ebenfalls im Browser: echtes manuelles Testbackup erstellt und heruntergeladen. Kein Restore ausgeführt.
- `git diff --check` erfolgreich.

Die anonymisierten Referenzfixtures sind aus der vorangegangenen Analyse übernommen; nur strukturelle Testdaten werden versioniert. Das frühere Analysepapier und private Originaldateien sind nicht Teil dieses PR.

## Rollout und Grenzen

- Backend, Frontend **und Backupimage gemeinsam** aus diesem Release bauen. Ein altes Backupimage ohne `/cleanup-backup` führt absichtlich zu einem Fehler vor der Eventlöschung.
- Keine neue Migration. Vorhandene Backups/Volumes, Schema und Eventkonfiguration behalten.
- Kein produktiver Reset als Deployment-Schritt. Die Funktion wird erst auf ausdrückliche Adminaktion ausgeführt.
- Globale Datenbankwiederherstellung und deren Schutzmaßnahmen werden nicht verändert; dieser PR entfernt auch keinen bestehenden Restore-Bestätigungsschutz.
- Unklare/korrupt eventübergreifende Altreferenzen bleiben ein expliziter Konflikt; sie werden nicht automatisch bereinigt.
- Aktivitäten-/Audithistorie kann nicht durch eine kosmetische Resetaktion aus der Datenbank gelöscht werden. Das schützt die aktuelle Wirksamkeit und Nachvollziehbarkeit bestehender Entscheidungen.

Kein automatischer Merge und kein Deployment.
