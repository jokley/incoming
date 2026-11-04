# Nationenabklärung: Gruppen, freie Rückfragen und Notizen

Die Erweiterung verwendet weiterhin `ImportSessionEvent`, den vorhandenen
History-Endpunkt, Freigabeguard und `EnterpriseDialog`. Keine neue Tabelle,
Migration, Sessionstatus, API-Route oder Genehmigungslogik.

## Bedienung

„Abklärung dokumentieren“ bietet Rückfrage oder allgemeine Notiz. Rückfragen
beziehen sich auf Personen, eine Problemgruppe, einen Sportbereich/eine Disziplin
oder die gesamte Nation. Problemgruppen zeigen Anzahl und Sportbereich. Ihre
Personenvorschläge werden erst mit „Vorschlag übernehmen“ ausgewählt; Wechsel der
Gruppe, Suche und Aktualisierungen verändern keine bestehende Auswahl. Ein
Kommentar für zwölf ausgewählte Personen erzeugt genau eine Rückfrage.

Notizen benötigen nur Text. Sie erzeugen einen `NOTE`-Historieneintrag und ändern
weder Status noch offene Aufgaben. Kontaktweg und Datum einer Rückfrage sind im
Dialog kompakt eingeklappt. Antworten und Erledigungen bleiben getrennte Aktionen.

## Gespeicherte Bezüge und Kompatibilität

Neue Auswahlrückfragen verwenden Schema 2 des vorhandenen Dokumentformats.
Gespeichert werden fester Bezug, ausgewählte Personen samt damaliger Identität
und Anzeige, optionaler Sportkontext, konkrete Hinweisreferenzen mit Faktendigest
und Quellabdeckung sowie die Kennzeichnung vollständiger maschineller Prüfbarkeit.
Die Event-ID des Historieneintrags bleibt die Identität der Rückfrage.

Problemgruppen werden aus vorhandenen Codes und Kontexten gebildet. Gleiche
Beschriftungen verschiedener Sport-/Poolkontexte werden nicht zusammengeführt.
Explizites „No room“ liefert einen Vorschlag, erzeugt selbst aber keine Aufgabe.

Eine aktuelle Auswahl-Prüfsumme schützt auch gegen geänderte andere Teilmeldungen.
Personen, Gruppen und Sportkontext werden serverseitig validiert. Historische
Auswahlen werden bei Folgeimporten weder ergänzt noch umgeschrieben. Die
vorhandene exakte Personenidentität wird wiederverwendet; fehlende oder mehrdeutige
Personen gelten nicht als Korrekturbeleg, auch bei Schema 1.

Schema-1-Rückfragen und Freitexte bleiben lesbar und bedienbar. Historische
Dokumente bleiben unverändert. Neue Antworten und Ergebnisse werden angehängt;
die bestehende Historienserialisierung zeigt auch Schema 2 als lesbaren Text.

## Erledigung und Importumfang

Nur offene verpflichtende Rückfragen im tatsächlich betroffenen Importumfang
blockieren. Personenbezüge verwenden ihre Quellen; gemeinsame Unterkunftsbezüge
benötigen weiterhin beide erforderlichen Quellen. Sportbezüge betreffen ihren
Importbereich, Nationsbezüge die Nation. Beide Confirm-Wege verwenden weiterhin
denselben vorhandenen Guard.

Für eine automatische Gruppenerledigung müssen alle gespeicherten Teilbezüge und
alle ausgewählten Personen eindeutig und in gültigen aktuellen Quellen abgedeckt
sein. Eine verschwundene Warnung oder Person genügt nicht. Die positiv belegbaren
Fälle sind derzeit die vorhandene Aufenthaltsbewertung sowie fehlende Zimmerpartner
bei inzwischen belegter Partnerzuordnung beziehungsweise wirksamem `NO_ROOM`.
Andere Problemtypen, freie Rückfragen, breite Sport-/Nationsbezüge und Gruppen mit
zusätzlichen Personen ohne passende Evidenz bleiben manuell zu erledigen.

Teilkorrekturen werden angezeigt und schließen die Gruppe nicht. Ein neuer
betroffener Teilnehmer erweitert eine gespeicherte Rückfrage nicht. Identische
relevante Fakten erhalten eine ausdrückliche Klärung; geänderte Fakten übernehmen
keine alte Klärung. Antworten sind keine Erledigungen.

Dokumentation setzt insbesondere kein `NO_ROOM`, keinen Tarif, keine EZ-Ausnahme
und keine Quotengenehmigung. Technische Importkonflikte bleiben unabhängig davon
wirksam. Die vorhandenen Sperren abgeschlossener Prüfstände bleiben erhalten.

## Prüfung

Backend: `test_grouped_nation_clarifications.py` erweitert die bestehenden
Rückfrage-, Teilmeldungs-, Reimport-, Genehmigungs-, Unterkunfts-, Eventrechte-
und Sessionabschlussregressionen auf der isolierten PostgreSQL-Testdatenbank.
Frontend: bestehende Tests, zusätzliche Vorschlagsprüfung, Typecheck und Build.

Die Browserabnahme verwendet die echte Importkomponente und lokale Backend-APIs
mit synthetischen ARG-SB-/FS-Arbeitsmappen. ARG-Originaldateien stehen in dieser
Arbeitsumgebung nicht zur Verfügung. Die Abnahme ist daher kein Nachweis eines
erneuten Originaldateitests. Lokale Datenbanken, Arbeitsmappen und Screenshots
werden nicht in den PR aufgenommen.

Abschlussprüfung dieses PR: 181 Backendtests bestanden, ein optionaler
JPN-Originaldateitest übersprungen; zusätzlich 46 gezielte Abschlussprüfungen
bestanden. 244 Frontendtests, Typecheck, Produktionsbuild und Diff-Prüfung
bestanden. Desktop 1440×1000 und Mobil 390×844: beide Uploadreihenfolgen mit
11 Personen, Scope-Isolation, Notizen und Rückfragen, Zwölfer-Gruppe mit
8/12-Teilkorrektur und vollständigem Nachweis sowie gemeinsamer Import und
identischer Reimport geprüft. Keine Browserfehler in den erfolgreichen Abläufen.
