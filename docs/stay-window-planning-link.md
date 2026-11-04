# Aufenthaltsprüfung: vorhandenen Zeitblock im Event-Mapping verknüpfen

Basis: main 89a75998123ed0205d8f913f2fb5bde11f2e9b28; #350/#347 sind enthalten.
Die Terminquelle bleibt die vorhandene WM-bezogene Eventplanung.

## Ursache und gewählte Lösung

Competition besitzt stabile Wettbewerbsidentitäten, aber keine Termine.
EventCompetition verbindet Competition und Championship; AccommodationEvent
enthält Championship, Bezeichnung, Beginn/Ende und Unterkunftsbedarf. Zwischen
beiden fehlte der explizite Bezug. Deshalb passten PGS/PSL nicht zur Kategorie
„Parallel“. Der Regressionstest reproduziert diese Lücke mit unverknüpften Daten.

Der Auftrag bestätigt die vorhandenen WM-2027-Events als maßgebliche Termine und
wählt ausdrücklich die Verknüpfung eines bestehenden Zeitblocks statt doppelter
Von-/Bis-Pflege. Dafür erhält EventCompetition genau eine optionale Referenz
`accommodation_event_id`. Im bestehenden Bearbeitungsdialog wird ein Zeitblock
 derselben WM ausgewählt. Von/Bis sind schreibgeschützte Anzeigen aus diesem Block.
Die Mapping-Tabelle zeigt Bezeichnung und Zeitraum; kein neuer Dialog/Kalender.

Die additive Migration 20261028_01 legt nur die nullable Spalte, einen Index und
Constraints an. Sie befüllt keine Zuordnung automatisch. Bestehende Datensätze,
Genehmigungen und Kalender bleiben unverändert. Ein zusammengesetzter Fremdschlüssel
schließt WM-fremde Verknüpfungen auch bei direkten Datenbankzugriffen aus. Verwendete
Zeitblöcke sind gegen Löschen geschützt. Ein Downgrade mit benutzten Referenzen
wird abgelehnt. Kopieren von Mappings kopiert keine fremden Zeitblockreferenzen.

## Zentrale Prüfung und Bestandsschutz

Die vorhandene gescopte Terminabfrage lädt Referenzen mit demselben Bulk-Query.
Es gibt keine zusätzliche Abfrage pro Person. Ein explizit verknüpfter Zeitraum
hat Vorrang. Die bisherige eindeutige Namensauflösung bleibt als kompatibler
Fallback erhalten. Es gibt keine feste „Parallel“-Aliasliste und keine Zuordnung
über die Quotenfamilie. Fehlende/mehrdeutige/ungültige Termine bleiben unprüfbar.
MIN/MAX, −2/+1, durchgehende Zeiträume und exklusive Abreise bleiben unverändert.

Die neue reine Kalenderreferenz ist explizit aus den bisherigen Mapping-Fakten
für Import-Statefingerprints und Quoten-Initialisierungsprüfstände ausgeschlossen.
Die alten Schlüssel und Werte bleiben dadurch identisch, auch nach der Migration.
Die Genehmigungs- und Quotenregeln ändern sich nicht. Ein echter Codexwechsel
verändert den Import-Statefingerprint weiterhin.

ISR: Der bestätigte WM-2027-Parallelblock 04.–11.03. ergibt zulässige An-/Abreise
02.–12.03. Nach expliziter Verknüpfung der gemeldeten PGS-/PSL-Mappings liefert
04.–22.03. genau 0 Nächte davor / 10 Nächte danach für beide Personen. Der
Abreisetag zählt nicht zusätzlich. Ohne Verknüpfung bleibt „Parallel“ allein
unbelegt. Produktive Zuordnungen wurden nicht geändert; die Konfiguration erfolgt
nach einem separat freigegebenen Rollout im bestehenden Mapping-Dialog.

## Kompakte Hinweise

Unprüfbare Aufenthalte werden in der Importliste einmal mit direktem Filter
zusammengefasst. Personendetails behalten den konkreten Grund und Wettbewerbe.
Bei tatsächlichen Außennächten stehen „davor / danach“ kompakt bei der Person.
Innerhalb des Fensters erscheint kein zusätzlicher grüner Hinweis.

Der vorhandene Tooltipweg in Personen-, Hotel- und Belegungsansichten sowie der
Excel-Export bieten denselben Hotelhinweis; der Export erhält die Spalte
„Hotelhinweis Zusatznächte“: „X Nächte außerhalb des vorgesehenen Unterkunftszeitraums.
Für diese Nächte kann das Hotel den regulären Hotelpreis verrechnen.“

Kein Hotelhinweis für unprüfbare Aufenthalte, No Room oder null Außennächte.
Eine Person bleibt eine Zeile. Keine Preis-, Tarif-, Booking-, Authentifizierungs-
oder Genehmigungsänderung und keine neue API. Die vorhandenen Admin-Mapping-
Endpunkte verarbeiten die optionale Referenz und liefern die read-only Terminwerte.

## Validierung

Echte additive Migration in temporärer PostgreSQL-Testdatenbank einschließlich
Bestandserhalt, Downgrade-Schutz und Rücknahme unbenutzter Referenzen; API-Auswahl,
Entfernen, WM-fremde Ablehnung und DB-Constraint; ISR-Projektion mit 10 Nachnächten;
Terminänderung ohne Review-/Genehmigungsinvalidierung; sieben Referenznationen,
Confirm/Reimport, Quoten, Hotel-/Personenverträge und SQL-Budgets. Frontendtests,
Typecheck, Build, Desktop-/Mobilbrowser, schreibgeschützte Von-/Bis-Werte und
wirklicher Excel-Download mit unveränderter Personenzeilenzahl.

Originaldateien bleiben ausschließlich lokal. Kein produktiver Datenzugriff,
kein Merge und kein Deployment; die Migration wurde nur in Testdatenbanken geprüft.
