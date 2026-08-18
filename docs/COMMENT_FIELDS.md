# Analyse der Kommentarfelder

Stand: 18. August 2026. Diese Bestandsaufnahme dokumentiert das bestehende Verhalten; sie führt bewusst keine funktionale Änderung am Kommentarsystem ein.

| Fachlicher Kontext | Datenbankfeld | API-Feld | Verwendende Oberfläche | Befund |
|---|---|---|---|---|
| Athlet / importierte Zusatzangabe | `athlete.additional_items` | `additionalItems` | Hotel-/Nationenliste (`remark`) und Athleten-Dialog | Das Feld stammt aus dem FIS-Import. Die Liste zeigt dieses Feld als Bemerkungs-Tooltip. |
| „Interne Bemerkung“ im Athleten-Dialog | kein eigenes Feld | lokal ebenfalls aus `additionalItems` vorbelegt | Athleten-Dialog | Die Eingabe wird nur in lokalem React-State geändert. Der Dialog hat keinen Speichern-Aufruf; die Eingabe wird daher **nicht gespeichert**. Zudem bezeichnet die UI ein importiertes Feld irreführend als interne Bemerkung. |
| Hotelkontingent | `hotel_room_inventory.comment` | `comment` | Kontingentformular, Hoteldetail, Kontingentliste und Excel-Export | Eigenständiger, korrekt gespeicherter Kommentar je Kontingent. |
| Importentscheidung | `import_approval.comment` | `comment` | Dispositions-/Entscheidungsdialog und Entscheidungsdetail | Dokumentiert die Kommunikation beziehungsweise Entscheidung einer Importsession; kein Athletenkommentar. |
| Audit-Ereignis | `audit_event.changes_json` | `changes` | Aktivitätskomponenten | Technisches Änderungsprotokoll, kein frei pflegbares Kommentarfeld. |

## Ergebnis

Es liegt sowohl eine falsche Zuordnung als auch eine fehlende Speicherfunktion vor: Die Athletenliste verwendet konsistent `additionalItems`, doch das gleiche importgeführte Feld wird im Athleten-Dialog als editierbare „Interne Bemerkung“ dargestellt. Eine Eingabe dort wird nicht an das Backend übertragen. Ein separates persistentes Feld für interne Athletenbemerkungen oder Assignment-Bemerkungen existiert aktuell nicht.

Vor einer funktionalen Korrektur sollte entschieden werden, ob drei getrennte Domänenfelder benötigt werden: (1) importierte Athleten-Zusatzangabe, (2) interne operative Athleten- oder Assignment-Bemerkung und (3) Kontingent-Kommentar. Erst danach sollten Bezeichnung, Schreibrechte, API und Migration angepasst werden.
