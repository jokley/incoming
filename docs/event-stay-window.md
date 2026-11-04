# Lesende Aufenthaltsprüfung

## Vorhandene Daten und Eingriff

`AccommodationEvent` enthält die vorhandenen Bewerbstermine (`start_date`,
`end_date`) und den Championship-Eigentümer. `Competition` und `EventCompetition`
haben keine Datumsfelder und keinen Fremdschlüssel auf diese Planung.

Die Anzeige verwendet vorhandene exakte Namen/Displaynamen, danach dieselben
lesbaren Bewerbsnamen wie die UI (Geschlechtspräfix sowie Snowboard/Freeski bei
Big Air, Halfpipe und Slopestyle entfernt). Ein Name muss genau einen Termin im
aktuellen Championship treffen. Keine Interpretation von FIS-Codes,
Quotenfamilien oder Datumsannahmen. Beispielsweise ist ein pauschaler
Planungseintrag „Parallel“ kein eindeutiger Nachweis für Parallel Giant Slalom.
Fehlende, ungültige oder mehrdeutige Termine einer einzigen Membership machen die
Bewertung unvollständig. Termine werden nicht automatisch angelegt oder geändert.

`backend/stay_window.py::assess_stay` ist die einzige Berechnung. Sie nimmt
MIN(Start) und MAX(Ende) aller eindeutig aufgelösten Bewerbe. Auch große Lücken
bleiben Teil dieses zusammenhängenden Fensters. Keine Gap- oder Intervallengine.

## Datumssemantik

Planungs-Eventtage sind einschließlich Endtag (siehe `inclusiveDays` in
EventsManagement). Buchungen zählen Nächte mit inklusiver Anreise und exklusiver
Abreise (bestehende Accommodation-Coverage). Deshalb wird `allowedEnd = eventEnd
+ 1 Tag` als **exklusive Abreisegrenze** verwendet. Bei Event 06.–21.03. gilt
Anreise ab 04.03., Abreise bis einschließlich 22.03.; die Nacht 21./22. ist noch
enthalten, die Nacht 22./23. liegt außerhalb. `allowedStart` ist inklusiv.

Vor-/Nachnächte werden auf den tatsächlichen Aufenthalt begrenzt; auch komplett
vor/nach dem Fenster liegende Aufenthalte erhalten keine überhöhten Zahlen.
Unbekannte Daten ergeben `outsideNights=null`, keinen grünen Nullwert. No Room
wird nicht als Unterkunftsabweichung bewertet.

## Anzeigen und Schutz

- Import: `session.importControl.people[].stayWindow` wird ausschließlich beim
  Lesen erzeugt. Kein Feld in `preview_json`, Fingerprint, Change Plan oder
  Approval-Evidence. Keine zusätzlichen Importwarnungen oder Blockaden.
- Personen: derselbe Helfer mit dem gemeldeten persönlichen Aufenthalt und allen
  vorhandenen Competition-Memberships. Bestehende Personendeduplizierung bleibt.
- Hotel/Belegung: derselbe Helfer mit den tatsächlichen Buchungsdaten. Weichen
  diese vom gemeldeten Aufenthalt ab, kann sich die Bewertung entsprechend
  unterscheiden; der bewertete Zeitraum ist immer explizit enthalten.
- Listen/Excel: übernehmen die Serverbewertung des bereits ausgewählten Bookings,
  sonst die Personenbewertung. Eine Person bleibt eine Zeile; weder zusätzliche
  Buchungen noch zusätzliche Exportzeilen entstehen. Eventzeitraum, zulässige
  An-/Abreise und bewerteter Aufenthalt werden mit exportiert. Keine
  Frontend-Datumsberechnung. Bestehende Auswahl eines Bookings bei Split Stays
  wird nicht umgebaut; keine Summierung über mehrere Buchungen im Export.

Eine gescopte Terminabfrage je Projektion, keine Abfrage je Person. In der
Personenliste ersetzt eine gemeinsame PostgreSQL-DISTINCT-ON-Abfrage die beiden
vorhandenen Latest-ImportRun-Abfragen: das bestehende Budget von höchstens acht
SQL-Statements bleibt erhalten. Keine globale oder requestübergreifende Cachelogik.

Keine Migration, Änderung von Bestandsdaten, Tarifen, Preisen, Genehmigungen,
Quoten, Benutzern/Rechten oder Authentifizierung. Die Bewertung ist ausschließlich
Information für das Hotel; Preisentscheidungen trifft das Hotel.

## Reproduzierbare Prüfung

`backend/tests/test_stay_window.py` deckt Grenzen, ganze Aufenthalte vor/nach dem
Fenster, MIN/MAX mit großen Lücken und Überlappungen, fehlende/mehrdeutige Termine,
verschiedene Aufenthalte, echten Reimport und Championship-Isolation ab. Ein
synthetischer JSON-Vertrag wird im Backend gegen Import-, Personen- und
Booking-Antworten geprüft und im Frontend für Filter, Listen und Exportfelder
wiederverwendet. Backendtests laufen ausschließlich gegen die vorhandene lokale
PostgreSQL-Testdatenbank. Referenznationen und vorhandene SQL-Budgets bleiben
Teil der Regression.
