# Letzter Import-UX-Feinschliff

## Stand und kleiner Eingriff

Geprüfter main: 4f8dfa24a890b35a79b0795218898b265d0a5e09 (28.10.2026).
PR #346 und #348 sind enthalten. Personen-/Zimmerlisten, direkte Problemfilter,
kompakte Personendetails ohne Notizverwaltung und der Familienquotenabschluss
bestehen bereits. Diese Funktionen bleiben erhalten.

Die Officials-Ansicht wiederholt die sportlichen Athletenmeldungen. Diese
Wettbewerbstabelle entfällt ausschließlich dort; die bestehende gruppierte
Officials-/EZ-Tabelle und ihre Personenlinks bleiben. Die vorhandene Officials-Basis
wird als Summe der M/W-Kontexte sichtbar, ohne diese als übertragbares Kontingent
oder nachgewiesene Abdeckung zu interpretieren. Geschlechterdetails bleiben zu.
Unklare Abdeckung heißt „Abdeckung prüfen“. Wiederholte Nullmeldungen entfallen.
Der bestehende Personenfilter heißt „Einzelzimmer / EZ-Status“ statt
„EZ-Entscheidungen“: Seine Population enthält Wünsche und vorhandene EZ-Status,
nicht ausschließlich offene Genehmigungen.

## Sportliche Datenlücke

Die vorhandene Projektion enthält konkrete Competition-Zuordnungen und eindeutige
Athletenzahlen. Sie enthält keine bestätigte sportliche FIS-Zuteilung je Nation
und keine bewertete persönliche Startberechtigung je Wettbewerb. Deshalb zeigt
die bestehende Tabelle Meldungen mit „FIS-Zuteilung klären“ und kennzeichnet
Startrechte als ungeprüft. Es gibt weder eine neue Bewertung noch eine erfundene
„Erlaubt“-Zahl. Der Familienquotenabschluss ist ausdrücklich als Familienquote
beschriftet und verwendet unverändert die Backendwerte und Genehmigungen.

Lokal geprüfte CAN-Originalmeldung: 14 eindeutige Athleten; Slopestyle und Big Air
je 5 Männer / 4 Frauen, Halfpipe 2 Männer / 3 Frauen. Die fünf Männer in Slopestyle
und Big Air sind dieselben Personen. Der Titelkatalog enthält einen passenden
Slopestyle-Weltmeister, der in beiden Wettbewerben gemeldet ist. Das ist kein
Nachweis eines Big-Air-Titels oder einer endgültigen Zuteilung.

FIS-WM-Regeln Art. 8.2/8.3 und Montafon-Precisions 2027 sind gemeinsam zu lesen:
Slopestyle/Big Air haben eine gemeinsame Zuteilung; persönliche Titelrechte sind
nicht aus dem vorhandenen EZ-Ausnahmestatus abzuleiten. Vor einer weitergehenden
Darstellung fehlen die bestätigte Zuteilung und die eindeutige Anwendung des
persönlichen Zusatzrechts auf den jeweils anderen Medaillenwettbewerb.

Quellen:
- https://assets.fis-ski.com/f/252177/x/c574d4b3c1/2023_03_19-rules-for-the-organisation-of-fis-world-championships_clean_v2b.pdf
- https://assets.fis-ski.com/f/252177/x/13e88f83bf/2027-fis-rule-precisions-specific-to-the-fis-snowboard-and-freestyle-ski-freeski-sbfsfk-wsc-2027-in-aut_clean.pdf

## Aufenthaltsprüfung: Integrationslücke

PR #347 wurde in `ux/import-four-tiles` gemergt, nachdem #346 bereits auf main war.
Sein Commit 9dd6bd6ecd2eb8a791ebea9ebddd7708d544cd06 und die Aufenthaltsprojektion
sind im oben geprüften main noch nicht enthalten. Dieser UI-PR kopiert die
Berechnung nicht und ändert weder Backend noch Hotel-/Exportlogik. Die vorhandene
Implementierung aus #347 muss separat auf main integriert werden; dieser PR führt
keinen Merge durch. Die beiden Änderungen lassen sich unabhängig prüfen.

Originalmeldungen und personenbezogene Prüfpayloads bleiben ausschließlich lokal.
