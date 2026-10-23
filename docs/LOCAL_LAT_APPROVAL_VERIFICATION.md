# Lokale LAT-Freigabe: Fehleranalyse und Prüfung am 23. Oktober 2026

## Ursache

Die vorhandene LAT-Session 95 gehört zu Championship-Event 1. Bei einem Request
ohne ausdrückliches `eventId` nahm `validate_import_request_context` den Wert
`app.config['OPERATIONAL_EVENT_ID']` unverändert aus der Umgebung: den String
`"1"`. Dieser wurde als `g.import_event_id` gespeichert.

Beim `commit()` der Freigabe prüft der `before_flush`-Listener
`apply_event_ownership` in `backend/event_ownership_runtime.py` die veränderte
`ImportSession`. Deren `event_id` ist der Integer `1`. Der Vergleich
`1 != "1"` löste fälschlich `OperationalEventError` aus. Die Konfiguration war
inhaltlich richtig; es fehlte die Normalisierung des Request-Kontexts.

Die Reproduktion mit der vorhandenen LAT-Situation ergab HTTP 409 und exakt die
gemeldete Fehlermeldung. Der Flush enthielt `ImportSession` 95,
`ImportSessionVersion` 266 und einen neuen `ImportSessionEvent`.
Personen, Buchungen und Importläufe blieben unverändert (58 / 5 / 1).

`Athlete`, `ImportSession` und `ImportRun` verwendeten den nicht normalisierten
Import-Kontext. `RoomBooking` verwendete dagegen `configured_event_id()`, das
bereits einen Integer liefert. So konnte derselbe konfigurierte Eventwert je
nach Modell unterschiedlich verglichen werden.

## Änderungen

- Der Request-Kontext normalisiert die aufgelöste Event-ID auch dann, wenn sie
  aus der Konfiguration stammt.
- `validate_operational_import_event` normalisiert zusätzlich am ORM-Guard und
  lehnt bei expliziter `OPERATIONAL_EVENT_ID` ein tatsächlich fremdes Event ab.
  Preview und andere Import-Endpunkte prüfen dies vor der eventbezogenen
  Verarbeitung. Der ORM-Guard bleibt aktiv; unzulässige Eigentümerwechsel und
  gemischte Zimmerbelegungen bleiben verboten.
- Der lokale Launcher protokolliert beim Backendstart die tatsächlich geladene
  Flask-Konfiguration. Am Ende dieses Laufs meldet der laufende Flask-Prozess
  PID 145328 `Flask OPERATIONAL_EVENT_ID='1'` und verwendet weiterhin
  `incoming_restorecheck_20261023_070957` auf `127.0.0.1:55432`.
- Die Checkbox heißt jetzt **Vollständige Nationenmeldung bestätigen**. Der
  gewünschte Erklärungstext steht darunter und ist per `aria-describedby`
  verbunden. Request-Payload, `FULL_NATION`, Digestprüfung und serverseitige
  Pflichtbestätigung bleiben unverändert.
- Zwei bestehende Frontend-Tests verwenden für Windows `fileURLToPath` statt
  URL-`pathname` und starten keinen kollidierenden HMR-Websocket.

Quoten-, EZ-, Tarif- und Unterkunftsregeln wurden nicht geändert.

## Prüfung mit dem vorhandenen LAT-Bestand

Der lokale Bestand einschließlich LAT-Session wurde in eine neu angelegte
Datenbank `incoming_restorecheck_20261023_073707` kopiert. Nur dort wurden
Freigabe und Import ausgeführt. Die laufende Browserdatenbank behält den
fachlich geprüften, noch nicht importierten LAT-Stand.

| Prüfung | Ergebnis |
| --- | --- |
| Fehlende FULL_NATION-Pflichtbestätigung | weiterhin HTTP 409 |
| LAT-Freigabe ohne Event-ID im Request | HTTP 200 |
| LAT-Import ohne Event-ID im Request | HTTP 200, vier neue Personen |
| ORM-Kontext beim Approve | Integer 1 |
| Operative Personen-/Buchungsänderungen beim Approve | keine |
| Zwei Zimmerpartner-Paare | IDs 26791/26792 und 26793/26794 |
| 58 Bestandspersonen und Planungsdaten | unverändert |
| Physische Hotelbuchungen | unverändert |
| Fremdes Event bei explizit konfiguriertem Event | HTTP 409, keine Importänderungen |

Die beiden Zimmerzuordnungen sind die importierten Zimmerpartner-Paare aus der
Vorschau. Sie sind in den Personendaten übernommen. Der bestehende Import legt
daraus keine physischen Hotelbuchungen an; dieses Verhalten wurde nicht geändert.

Beim erfolgreichen Approve werden nur die vorgesehene Sessionfreigabe,
Workflowdaten in der Prüfversion sowie Historien-/Audit-Einträge geschrieben.
Die unabhängige Bestandsprüfung vergleicht Personen, Competition-Memberships,
Buchungen, Occupants, FIS-/Legacy-Zuordnungen und Importläufe vor/nach Approve.

## Tests und Laufzeit

Die drei Backend-Dateien `test_safe_reimport.py`, `test_import_event_identity.py`
und `test_event_ownership.py` wurden ausschließlich in einem frisch initialisierten
separaten PostgreSQL-Cluster ausgeführt. Der Guard für die ursprünglichen Tests
blieb unverändert. Der bisherige Cluster wurde dafür kurz angehalten und
anschließend erfolgreich wieder gestartet; seine Datenbanken wurden nicht durch
die Testfixtures zurückgesetzt.

Ergebnis: **71 bestanden, drei übersprungen, ein bestehender Windows-Fehler**.
Alle PR-3-/Identity-Tests und die sieben neuen parametrisierten Regressionen
bestanden. Die drei übersprungenen Fälle benötigen externe JPN-XLSX-Dateien.
Der zusätzliche Fehler betrifft ausschließlich
`test_read_only_cli_and_post_migration_verification`: Der Test erwartet POSIX-Modus
`0600`, Windows liefert nach `os.chmod(..., 0o600)` jedoch einen anderen Modus.
Diese bestehende Rechteprüfung wurde weder abgeschwächt noch übersprungen.

Frontend: **141 Tests erfolgreich**, einschließlich Checkboxtext und weiterhin
erforderlicher Scope-/Destruktivbestätigung. `pnpm --dir frontend build` erfolgreich.

Nach dem Backendneustart liefern Frontend 5173, Backend-Healthcheck 5000,
Backup-Healthcheck 8080 und das Lesen der LAT-Session jeweils HTTP 200.

Lokale Belege: `.local-dev/lat-review-20261023-073707/reproduction.json`,
`verification.json`, `baseline.dump.gz`, `live-backend.log` sowie
`.local-dev/lat-pr3-tests-20261023-074317/pytest.log`. Diese Dateien bleiben lokal
und sind von Git ausgeschlossen. Kein produktiver Datenbankzugriff, kein Commit
und kein Push.
