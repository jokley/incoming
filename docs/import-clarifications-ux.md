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
