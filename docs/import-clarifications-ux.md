# Import Center: Klärungsübersicht und Personenliste

Ausgangspunkt: `main` nach den bisherigen Import-/Officials-PRs. Der bestehende
Workflow mit vier Schritten, sämtliche Serverprüfungen und Schreibendpunkte
bleiben unverändert.

## Datenquellen und Bedienung

`importFindings.ts` projiziert `preview.errors`, `preview.warnings` und
`importControl.issues` in eine gemeinsame Anzeige. Rohfehler und ihre bereits
vorhandene Control-Projektion werden nicht doppelt gezählt. Unterschiedliche
Personen, Fakten und Quellversionen bleiben getrennt. Fehler bleiben blockierend;
Control-Klärungen und informative Hinweise behalten ihre Backend-Bedeutung.
Mehrdeutige Quellzeilen führen nicht zu einer geratenen Personenzuordnung.

Die Klärungsübersicht ersetzt die lange Unterkunftswarnbox. Namen öffnen direkt
den bestehenden Personendialog; Personengruppen öffnen einen gezielten Filter.
Gespeicherte SB-/FS-Bedarfsangaben und Aufenthaltszeiträume werden anhand ihrer
Quellversion gegenübergestellt. Fehlende Evidenz wird nicht ergänzt oder als
NO_ROOM interpretiert. Für blockierende Quelldaten nennt die Anzeige die
korrigierte Excel-Meldung und erneute Prüfung als nächsten Schritt.

Offene Genehmigungen öffnen den vorhandenen Entscheidungsdialog. Offene
Nationenrückfragen führen zum vorhandenen Abklärungsbereich. Aus einem Befund
kann eine neue Rückfrage mit vorgeschlagenen Personen geöffnet werden; diese
bleiben vor dem Speichern anpassbar. Öffnen und Navigation speichern nichts.
Notizen bleiben außerhalb offener Rückfragen rein dokumentarisch.

Die Personenfilter verwenden dieselbe Befundprojektion. Zusätzlich verfügbar:
offene Unterkunftsfragen, Unterkunft benötigt ohne Zimmerangabe und gemeinsame
SB-/FS-Personen. `No Room` bedeutet weiterhin den effektiven NO_ROOM-Bedarf;
fehlende Zimmerinformationen werden davon ausdrücklich unterschieden.

Die Personenliste verwendet den neuen opt-in `table`-Modus von EnterpriseDialog:
95 % Fensterbreite, maximal 1800 px, eigene horizontale/vertikale Scrollfläche
und fixierte Tabellenüberschriften. Die Namensspalte ist ab Desktopbreite
horizontal fixiert; auf Mobil scrollt sie mit, damit rechte Bearbeitungsfelder
vollständig erreichbar bleiben. Andere Dialoggrößen bleiben unverändert.
Beim Wechsel zwischen Liste, Person und Rückfrage wird der vorherige Dialog
geschlossen. Vorhandene Bearbeitungsfelder und Rückfrageaktionen sind für Viewer
deaktiviert; bestehende Backend-Berechtigungsprüfungen bleiben maßgeblich.

## Grenzen und Validierung

Keine neue API, Backendlogik, Tabelle, Migration, Fehlerbehebung oder Freigabe
durch die Übersicht. Quoten, Genehmigungen, Quellen-/Versionsschutz, Identitäten,
Löschbestätigungen und Unterkunftsmodell werden nicht verändert.

Gezielte Tests prüfen Deduplizierung, unveränderte Schweregrade, Quellversionen,
mehrdeutige Zeilen, 95-Personen-/Sieben-Fehler-Fall, Filter und Viewer-/Editor-UI.
265 Frontendtests, Typecheck und Produktionsbuild bestanden.

Lokale Chromium-Prüfung mit unveränderten AUT-Originaldateien auf dedizierter
Testdatenbank: 95 Personen, sieben Importfehler ohne Doppelzählung, vier explizite
Unterkunftswidersprüche und ein getrennter Aufenthalt weiter blockierend.
Desktop 1440×1000 und Mobil 390×844, jeweils SB→FS und FS→SB: Personenöffnung,
SB-/FS-Vergleich, Rückfragevorauswahl mit Abbruch, Filter, alle rechten Spalten
und Reimport geprüft. Keine Browserfehler oder horizontaler Seitenüberlauf.
Zusätzlich Viewer und Editor bei 1100 px und 390 px geprüft: Viewer-Felder und
Rückfragen deaktiviert, bestehende Editor-Aktionen verfügbar, keine Freigabe bei
Importfehlern und unveränderte Importhistorie nach der Navigation.
Ein zusätzlicher Editor-Test speichert ausdrücklich eine optionale Rückfrage mit
der vorausgewählten Person; alle sieben Importfehler bleiben danach wirksam.
Originaldateien, personenbezogene Berichte und Screenshots bleiben lokal und
werden nicht eingecheckt. Keine produktiven Datenänderungen, kein Deployment.

## Aufnahme einer Meldung mit ungeklärtem Unterkunftsbedarf

Der erste fachliche Schnitt wäre eine eindeutig identifizierte Person mit
übereinstimmenden Aufenthaltsdaten, aber den Meldungen „Double shared“
und „No room“ aus zwei Sportfamilien. Die folgenden Codes und Prüfungen
grenzen diesen Schnitt von anderen Fällen ab.

| Code | Ursache | Heutige Wirkung | Ziel | Risiko |
|---|---|---|---|---|
| `ROOM_PARTNER_NOT_FOUND`, `SHARED_PARTNER_NOT_LINKED`, `SHARED_PARTNER_NOT_EVIDENCED` | Partner fehlt oder ist nicht eindeutig | Warnung bzw. Klärung | Import weiterhin möglich. Wunsch offen lassen. | Falscher Zimmerpartner |
| `IMPORT_SHARED_ACCOMMODATION_CONFLICT` | Widersprüchlicher Unterkunftswunsch, Partner oder Zimmer | Sperrt weiterhin Partner- und Zimmerkonflikte. Double shared gegen No room wird bei Neuanlage mit sicherer Identität und gleichen Daten als offener Bedarf übernommen. | Operativ im Athletendetail entscheiden. | Falscher operativer Bedarf |
| `ACCOMMODATION_REQUIREMENT_SOURCE_CONFLICT` | Entry List und Room List widersprechen sich | Sperrt bis zur Korrektur oder einem passenden expliziten Override | Fachlich offen übernehmbar, sobald der offene Bedarf sicher darstellbar ist. | Falscher Bedarf |
| `ACCOMMODATION_REQUIREMENT_SEPARATE_STAYS`, `IMPORT_SHARED_STAY_SECTIONS`, `ACCOMMODATION_REQUIREMENT_PARTNER_STAY` | Aufenthalte passen nicht in ein sicheres Zeitfenster | Blockiert | Vorläufig blockierend lassen. | Aufenthalt verlängert oder Partnerzeit verändert |
| `QUOTA_SINGLE_ROOMS_EXCEEDED` → `QUOTA_REQUIREMENT_UNREVIEWED`, `ATHLETE_QUOTA_UNREVIEWED` | EZ- oder Athletenquote ohne anwendbare Entscheidung | Warnung in Vorschau, Sperre bei Freigabe/Confirm | Eigener späterer Schnitt. Entscheidung und Audit weiterführen. | Fehlende Genehmigung kann sonst als Deckung oder Mehrpreis gelten |
| `ATHLETE_TARIFF_UNRESOLVED` | Sondertarif fachlich unklar | Klärungshinweis | Tarif ohne ausdrückliche Entscheidung nicht ändern. | Falsche Kostenübernahme |
| `NO_ROOM`, `NO_DISPO`, `ACCOMMODATION_REQUIREMENT_BOOKINGS` | Explizite Entscheidung oder Konflikt mit vorhandener Buchung | Werte grundsätzlich gültig. No Room bei Buchung gesperrt. | Klare Werte übernehmen und Bestand schützen. | Verlorene oder widersprüchliche Buchung |
| `IMPORT_IDENTITY_CONFLICT`, `OFFICIAL_IDENTITY_REVIEW_REQUIRED`, `IMPORT_EVENT_MISMATCH`, `IMPORT_SHARED_PERSON_CONFLICT` | Identität, Event oder quellenübergreifende Zuordnung unklar | Blockiert | Blockierung beibehalten. Eine bestätigte Quellidentität ersetzt keine Unterkunftsentscheidung. | Personen oder Events vermischt |
| `ENTRY_INVALID_STAY_RANGE`, `ROOM_INVALID_STAY_RANGE`, `STALE_PREVIEW`, `IMPORT_SNAPSHOT_SCOPE_REQUIRED`, `NATION_CLARIFICATION_REQUIRED` | Ungültige Daten, veralteter Bestand, unsicherer Ersetzungsumfang oder verbindliche Rückfrage | Blockiert | Schutz beibehalten. | Falsche Daten, unbemerkte Entfernungen oder ungeprüfter Import |

### Kleinster notwendiger Modellschritt

`Athlete.accommodation_requirement` ist verpflichtend und auf `REQUIRED`,
`NO_ROOM` und `NO_DISPO` beschränkt. `accommodation_requirement_import_value`
kann leer sein, steuert aber die Disposition nicht. Die bestehenden
Importänderungsdetails sind quittier- und überschreibbar. Sie eignen sich zur
Anzeige und Nachvollziehbarkeit eines Vorgangs, aber nicht als dauerhafte Sperre
gegen eine falsche operative Zuweisung. Die vorhandene Importversion kann beide
Quellangaben unverändert aufbewahren. Die Person benötigt zusätzlich einen
eindeutigen operativen Wert für **Unterkunftsbedarf offen**.

Der kleinste sichere nächste Schritt ist ein zusätzlicher Wert `UNRESOLVED`
im **bestehenden** operativen Unterkunftsbedarfsfeld einschließlich bestehendem
Check-Constraint. Die Spaltenlänge reicht dafür aus. Der Quellwert bleibt in der
Importrevision. Ein bestehendes Audit-Ereignis kann die Revision und die
betroffenen Quellzeilen mit der Person verknüpfen. Warteschlange, Bedarfszahlen
und Schreibvalidierung müssen den Wert gemeinsam behandeln. Ein offener Bedarf
erzeugt weder einen Zuweisungsvorschlag noch eine automatische Buchung.
`REQUIRED`, `NO_ROOM` oder `NO_DISPO` wird erst über das bestehende Personendetail
explizit gewählt. Der erste Schnitt gilt für Neuanlagen ohne Buchung. Bei bestehenden Buchungen
bleibt der heutige Konfliktschutz aktiv, damit wirksamer Bedarf, Aufenthalt und
erteilte Genehmigung erhalten bleiben.

Die Migration erweitert ausschließlich den Constraint des operativen Felds.
Der synthetische ITA-Regressionstest verwendet die bestehende bestätigte
Quellverknüpfung und prüft beide Memberships und unveränderte Quellversionen.
Er prüft auch, dass die Buchungs-API bei offenem Bedarf sperrt und eine
anschließende explizite Entscheidung die Person wieder disponierbar macht.
Bei bereits vorhandener Buchung bleibt die bisherige Importblockade bestehen.
Sichere unabhängige Teilmeldungen sind weiterhin über den bestehenden
Teilimport verfügbar.

## Personenimport bei offenen Unterkunftsentscheidungen

Lieber sicher importieren und vorerst nicht disponieren, als den gesamten
Nationsimport an einem Unterkunftswunsch zu sperren. Personenidentität,
fachliche Unterkunftsklärung und operative Disposition werden getrennt
geprüft. Ein eindeutiger Quellkonflikt kann als `UNRESOLVED` übernommen
werden. Ein expliziter Zimmerpartner setzt dafür eine eindeutige Zuordnung
und passende Aufenthaltsdaten voraus.

Die importierten Quellversionen halten beide Wünsche und Room-List-Zeilen
nachvollziehbar. Diese Paarung bleibt ein Quellwunsch. Auch die spätere Wahl
von `REQUIRED` erzeugt daraus keinen gemeinsamen Buchungsvorschlag. Ein
regulärer Partner behält seinen eigenen Bedarf. Mehrdeutige Identitäten,
abweichende Paarungen oder gefährdete Buchungen und Genehmigungen bleiben
unter den bestehenden Schutzprüfungen.

## Abgleich mit dem Main-Hotfix `27feefb`

Die Warnung „Gemeinsame Unterkunft klären“ bleibt bei den serverseitig
blockierenden Befunden `IMPORT_SHARED_ACCOMMODATION_CONFLICT` und
`IMPORT_SHARED_STAY_SECTIONS` auch bei gefilterter Sportfamilienansicht
sichtbar. Die Klärungsübersicht liefert dazu Personenlinks,
Quellvergleiche und die vorhandenen Rückfrageaktionen. Fälle, die der
Server als übernehmbaren offenen Bedarf `UNRESOLVED` einstuft, erhalten
weiterhin den eigenen Hinweis und bleiben von der Disposition ausgeschlossen.

Der separate MUI-Dialog des Hotfixes wird durch den responsiven
EnterpriseDialog mit zugänglichem Titel, Schließen-Schaltfläche,
horizontaler Tabellenfläche und Pagination abgedeckt. Die gemeinsame
Befundprojektion behält ihre Fehler- und Klärungsfilter. Die strengeren
Bearbeitungsgrenzen von `dev` und die Übergabe betroffener Personen an
Nationenrückfragen bleiben bestehen. Es ändern sich weder
Backend-Freigaberegeln noch Quoten- oder Reimport-Berechnungen.
