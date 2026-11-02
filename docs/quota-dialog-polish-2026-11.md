# Quoten-Dialoge und FIS-Abgrenzung – 2. November 2026

Basis: main `9c647bd` nach #362 und #363. Reiner Darstellungsfeinschliff; #359 bleibt separat.

## Quellen und geprüfte Regelgrenzen

Offizielle, am 2. November 2026 abgerufene Quellen:

- [FIS World Championships Rules, Edition April 2024](https://assets.fis-ski.com/f/252177/x/c574d4b3c1/2023_03_19-rules-for-the-organisation-of-fis-world-championships_clean_v2b.pdf), Art. 8.2, 8.3, 8.11, 9.1.3, 9.1.5 und 13.1/13.3.
- [Montafon 2027 Rule Precisions](https://assets.fis-ski.com/f/252177/x/13e88f83bf/2027-fis-rule-precisions-specific-to-the-fis-snowboard-and-freestyle-ski-freeski-sbfsfk-wsc-2027-in-aut_clean.pdf), Abschnitte 1 und 3, verlinkt in der [FIS-Dokumentbibliothek](https://www.fis-ski.com/inside-fis/document-library/world-championships).

Die Organisationsregeln unterscheiden Medaillenwettbewerbe von Training. Regulär gelten vier Starter je Geschlecht im Medaillenwettbewerb; persönliche Titelrechte nach 8.2 sind gesondert nachzuweisen. Art. 9.1.5 nimmt President und Secretary General von der Registrierungsquote aus. Das ist kein zusätzlicher EZ-Anspruch. Art. 13.1 nennt diese Funktionen ausdrücklich bei der Preisobergrenze von CHF 120 pro Person/Tag einschließlich drei Mahlzeiten; daraus folgt weder kostenlose Unterkunft noch eine technische STANDARD-/SPECIAL-Zuordnung. Die tatsächliche LOC-Abwicklung und vereinbarte Leistungen bleiben gesondert zu prüfen. Die EZ-Staffel steht in 13.3.

Die Montafon-Precisions erlauben im offiziellen Training fünf Athleten pro NSA/Geschlecht für Snowboard Cross, Snowboard Alpine und Ski Cross, sonst vier. Diese Trainingszahlen dürfen nicht als Wettkampfgrenzen angezeigt werden. SS/BA verwenden jeweils einen gemeinsamen Zuteilungspool für Snowboard bzw. Freeski. Persönliche Titelplätze und endgültige FIS-Zuteilung bleiben davon getrennte Nachweise. Keine Trainingsbewertung, Punktequalifikation oder zusätzliche Startrechtslogik wird implementiert.

## Datenfluss und Bedeutung der Zahlen

- `quota_service.evaluate_quota_usage`: vorhandene Athleten-/Officials-Kontexte und personenbezogene EZ-Allokation.
- `quota_overview.build_quota_overview`: eindeutige gemappte Nicht-Athleten als Anzeige-Officials, Event-Group-Zuordnungen und bestehende Kontextwerte. Gruppenwerte sind keine additive nationale Officials-Quote.
- `singleRoomSummary`: vorhandene persönliche Allokationen COVERED, APPROVED_EXTRA, EXEMPT und PENDING; keine neue Zuteilung. Ein offener Kontext ist nicht gleich einer offenen Person.
- `sport_entry_plausibility.project_entries`: derzeit Snowboard HP/SS/BA/PGS/PSL, vorhandener Regelwert und exakter Titelabgleich. Andere Einzel- und Teamwettbewerbe bleiben ohne automatische Sportbewertung. Keine Übertragung einer Viererregel im Frontend.

Die Officials-Ansicht stellt zuerst eindeutige Officials und EZ-Anfragen dar, danach regulär gedeckte, zusätzlich genehmigte und ausgenommene EZ. Nur bestehende offene EZ-Personen/-Kontexte werden als EZ-Bedarf hervorgehoben. Eine unbestätigte Officials-Abdeckung bleibt ausdrücklich unbestätigt und ist keine behauptete Quotenverletzung. Ein grüner EZ-Status bestätigt ausschließlich die vorhandene EZ-Bewertung.

Die Event-Group-Tabelle behält eindeutige Officials, Anfragen und EZ-Status. EZ-Kontextanspruch, Berechnungsbasis und unveränderte M/W-Zeilen bleiben eingeklappt erreichbar. Mehrfachzugehörigkeiten verlinken weiterhin die bestehende gefilterte Personenliste.

Die Wettbewerbstabelle zeigt je Geschlecht immer „gemeldet / gespeicherter Regelwert“, bei fehlender Bewertung „/ —“, und einen einzigen numerischen Status je Wettbewerbszeile. „Nicht geprüft“ ist neutral. Titelberücksichtigung und ungeklärte Zusatzmeldungen bleiben unterscheidbar. Gruppen zählen eindeutige Athleten, Unterwettbewerbe sind nicht addierbar. Die autoritative Familienquote mit Gesamt-/Geschlechtergrenzen und offenen/genehmigten Überschreitungen bleibt unverändert darunter.

## Getrennter fachlicher Befund: Art. 9.1.5

Der Parser übernimmt `Function` als normalisierten Text. `Athlete.function` ist ein Textfeld, keine verifizierte FIS-Registrierungskategorie. In den verfügbaren Originalen von ITA/CAN/JPN/GER/ISR/ARG kommen die beiden Leitungsfunktionen nicht vor. Eine vorhandene AUS-Referenz enthält exakt „NSA President“; ein belegter Secretary-General-Originaldatensatz liegt nicht vor. Das ist kein Beleg für eine vollständige oder verbindliche Rollen-Codeliste.

Alle gemappten Nicht-Athleten werden derzeit in `officials`/`assignedOfficials` berücksichtigt, einschließlich eines so beschrifteten Presidents oder Secretary General. Eine Ausnahme von der regulären Registrierungszählung ist nicht implementiert. Wer diese Zahl als normale FIS-Registrierungsquote liest, erhält damit eine fachlich zu breite Population. `INFO_OFFICIALS_OVER_BASIS` kann diese Personen ebenfalls einschließen; der Hinweis ist bereits informativ und kein eigener Approvalblocker.

Die EZ-Berechnungsbasis ist dagegen die eingegebene Athletenzahl plus Event-Zuschlag; eine andere Officials-Klassifikation würde diesen Wert nicht automatisch ändern. Eine EZ-Anfrage der Leitungsfunktion verbraucht im bestehenden Modell einen persönlichen Platz, sofern keine separat gültige Ausnahme vorliegt. Die Registrierungsausnahme allein rechtfertigt keine EZ-, Unterkunfts- oder Tarifbefreiung. Bei mehreren Event Groups bleibt die Person national einmal gezählt; ihre Zuordnungen erscheinen in mehreren Gruppen, ihre physische EZ-Allokation erfolgt einmal.

**Keine fachliche Korrektur in diesem PR.** Für eine spätere Registrierungsabgrenzung wären eine bestätigte Funktionscodierung und ein belegter Bezug zur konkreten Person erforderlich. Keine Namensfragment-Heuristik und keine pauschale Anerkennung von „Professional“, „Guest“ oder ähnlichen Rollen. Der ergänzte Backendtest beschreibt ausdrücklich den vorhandenen Zustand und soll eine spätere bewusste Änderung nicht verhindern.

## Operative Einordnung für das Importteam

| Sachverhalt | Bestehende Wirkung |
|---|---|
| Sportliche Plausibilität, Aufenthaltsabweichung, informatives Officials-Über-Basis | Nicht allein importblockierend; keine FIS-Startfreigabe |
| Partnerhinweis | Klärungshinweis, sofern kein tatsächlicher Parser-/Identitätsfehler vorliegt |
| Technischer Fehler, widersprüchliche Identität, ungesicherter Ersetzungsbereich | Bestehende harte Validierung bleibt |
| Offene erforderliche EZ-/Familienquotenentscheidung | Bestehende Approvalbedingung bleibt vor Freigabe/Confirm erforderlich |
| Gültige dokumentierte Genehmigung | Nur im nachgewiesenen Personen-/Regel-/Versionskontext anwendbar |
| Offene Rückfrage an Nation | Bestehende Historie/Kommunikation; keine neue Rückfrageverwaltung oder rückwirkende Pflicht. #359 bleibt separat |

Nicht blockierende Hinweise können nach dem Import weiter abgeklärt werden. Erforderliche Genehmigungen oder technische Fehler dürfen dafür nicht übersprungen werden. Die Dialoge erstellen weder Entscheidungen noch neue Blocker.

## Nachweise und Grenzen

Die ITA-Anzeigeregression bildet ausdrücklich synthetisch die angegebenen 25 Officials, fünf Mehrfachzugehörigkeiten, drei Event Groups und acht persönliche EZ-Anfragen (sieben COVERED, eine EXEMPT) ab. M/W-Basis und Ansprüche bleiben unverändert. Diese Ausnahme ist vorgegebene Testevidenz, keine aus einem Funktionsnamen erfundene Berechtigung.

Originaldateien werden ausschließlich lokal geprüft. Ein sauberer lokaler Import ohne historische Ausnahme kann einen anderen EZ-Status zeigen als ein bereits bearbeiteter Prüfstand. Deshalb wird eine im Screenshot dokumentierte Ausnahme nicht automatisch aus der XLSX rekonstruiert.

Kein neuer HTTP-Request zum Öffnen der Quotendialoge. Keine Backend-Funktionsänderung, Migration, Datenmodelländerung, neue API, Preislogik oder Fingerprintänderung. Keine produktiven Datenänderungen, kein Merge und kein Deployment. Testergebnisse und Browserabnahme stehen im PR.
