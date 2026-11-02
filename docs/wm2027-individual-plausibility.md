# WM 2027: numerische Einzelwettbewerbsprüfung

Stand: 02.11.2026. Lesende Projektion für die bestehende Importtabelle, keine
FIS-Startzulassung und keine zusätzliche Import- oder Unterkunftsgenehmigung.

## Belegte Grenzen

- [WSC Organisation, April 2024](https://assets.fis-ski.com/f/252177/x/c574d4b3c1/2023_03_19-rules-for-the-organisation-of-fis-world-championships_clean_v2b.pdf):
  Art. 8.3 und 8.11 begrenzen die Medaillenwettbewerbe auf vier Starter je NSA und
  Geschlecht; Art. 8.2 regelt persönliche Rechte der amtierenden Einzelweltmeister
  für den jeweils gewonnenen Wettbewerb und dieselbe NSA.
- [Montafon 2027 Precisions](https://assets.fis-ski.com/f/252177/x/13e88f83bf/2027-fis-rule-precisions-specific-to-the-fis-snowboard-and-freestyle-ski-freeski-sbfsfk-wsc-2027-in-aut_clean.pdf):
  Die fünf Plätze bei Alpine/Cross betreffen offizielles Training, nicht den
  regulären Medaillenwettbewerb. SS/BA besitzen gemeinsame Zuteilungspools,
  getrennt nach Sport und Geschlecht. Vier ist die reguläre numerische Obergrenze,
  keine Bestätigung der tatsächlichen NSA-Zuteilung.
- [ICR SB/FS/FK, Juni 2026](https://assets.fis-ski.com/f/252177/x/74599b71fa/sbfsfk-new-icr-spring-2026_clean.pdf):
  Art. 215.4 verweist für WM-Einträge auf die WSC-Organisationsregeln.
  Weltcup- oder Juniorenquoten werden nicht auf diese WM übertragen.

## Vollständige Abdeckung

Die Codes identifizieren den vorhandenen zentralen Competition-Katalog. Bewertet
werden die tatsächlichen `Competition.id` der aktiven `EventCompetition`-Mappings;
Anzeige-/Dateinamen oder Codex-Präfixe entscheiden nicht über eine Regel.

| Event Group | Einzelwettbewerb | Katalogcode M / W | Regulär M / W |
|---|---|---|---|
| Snowboard Alpine | Parallel Giant Slalom | 6170 / 6172 | 4 / 4 |
| Snowboard Alpine | Parallel Slalom | 6177 / 6178 | 4 / 4 |
| Snowboard Cross | Snowboard Cross | 6191 / 6192 | 4 / 4 |
| Snowboard Park & Pipe | Halfpipe | 6174 / 6175 | 4 / 4 |
| Snowboard Park & Pipe | Slopestyle | 6188 / 6190 | 4 / 4 |
| Snowboard Park & Pipe | Big Air | 6182 / 6183 | 4 / 4 |
| Freestyle | Moguls | 8179 / 8183 | 4 / 4 |
| Freestyle | Dual Moguls | 8186 / 8187 | 4 / 4 |
| Freestyle | Aerials | 8193 / 8194 | 4 / 4 |
| Ski Cross | Ski Cross | 8180 / 8184 | 4 / 4 |
| Freeski Park & Pipe | Halfpipe | 8171 / 8172 | 4 / 4 |
| Freeski Park & Pipe | Slopestyle | 8196 / 8197 | 4 / 4 |
| Freeski Park & Pipe | Big Air | 8178 / 8181 | 4 / 4 |

26 Einzel-Competitions. Parallel Team (6180), Snowboard Cross Team (6193), Ski
Cross Team (8185), Dual Moguls Team (8188) und Aerials Team (8195) erhalten neutral
„Teamwettbewerb – gesonderte Regel“, ohne Vierergrenze oder persönliche Titelrechte.

## Personen, Titel und Pools

Die Projektion zählt vorhandene persistierte/importierte Identitäten, mit exaktem
FIS-Code als vorhandenem Identifikator, je Wettbewerb einmal. Keine unscharfe
Namenszuordnung und keine Änderungen der Importidentität. PGS/PSL, MO/DM und SS/BA
werden nicht zu Familienquoten addiert.

Die bestehenden verifizierten Engadin-2025-Referenzen werden wiederverwendet.
Erforderlich sind übereinstimmender FIS-Code, NSA, Geschlecht, Event Group/Sport,
konkreter Einzelwettbewerb, Titelperiode und verifizierte HTTPS-Quelle. Ein
Unterkunfts-/EZ-Weltmeisterstatus reicht nicht. SS ist kein BA-Titel; MO ist kein
DM-Titel. Eine Person verbraucht auch mit mehreren Starts oder Titelreferenzen nur
einen zusätzlichen gemeinsamen Poolplatz. Die einzelne BA-Meldung benötigt
weiterhin ihren eigenen Titelnachweis, wenn sie dort die reguläre Grenze übersteigt.

Ein SS/BA-Pool zählt eindeutige Personen, auch wenn jede Einzelmeldung für sich
höchstens vier Personen enthält. Eine gemeinsame Acht-Personen-Meldung aus zwei
getrennten Vierergruppen wird deshalb nicht grün. Die Statusaktion führt bei einem
Poolproblem zur vereinigten Personenliste, die Meldezahl zum einzelnen Wettbewerb.

## Bestehende Konfiguration und Grenzen

Nur für WM-Events mit Jahr 2027. Fixierte `sportEntryRules` werden lesend verwendet:
Schalter, Competition-IDs, Titelreferenzen und unterstützte SS/BA-Pools. Fehlende
Einzelregeln verwenden den hier belegten WM-2027-Standard, ohne ihn zu speichern,
zu revisionieren oder ein Event automatisch zu konfigurieren. Für andere Jahre
wird keine neue Sportauswertung eingeführt.

Deaktivierte, nicht fixierte, widersprüchliche oder nicht belegte Konfigurationen,
fehlende/fremde/inaktive Event-Mappings und widersprüchliche Personenfakten ergeben
„Bewertung unvollständig“, keine erfundene erlaubte Zahl. Ein abweichend
konfigurierter Grenzwert (auch 5) wird nicht als belegte FIS-Regel ausgegeben.
Andere Poolarten bleiben fachlich offen. Eine andere Titelperiode ersetzt nicht
stillschweigend Engadin 2025. Diese Fälle benötigen geprüfte Regeln, nicht mehr Code
im Importworkflow.

Alle Statuswerte sind Anzeigeprojektionen, keine neuen Workflowstatus. Sportliche
Hinweise bleiben informativ. Die endgültige FIS-Zuteilung, Qualifikation und
Startzulassung sind weiterhin unbestätigt. Familienquoten bleiben autoritativ;
Officials/EZ, Genehmigungen, Preise, Confirm, Fingerprints und gespeicherte
Prüfstände werden nicht verändert.

## Nachweis

Die Regressionen prüfen alle 26 Einzel-Competitions unter/an/über vier, genaue und
unpassende Titel, alle fünf Teams, aktive Event-Mappings, mehrfach gemeldete
Personen, getrennte Sport-/Geschlechterpools, Poolüberschreitungen sowie
konfigurierte und unvollständige Regeln. Der Vollständigkeitstest vergleicht die
aktiven ORM-Event-Mappings des vollständigen WM-Testevents mit der Projektion;
ein neu hinzugefügter nicht abgedeckter Einzelwettbewerb lässt ihn fehlschlagen.

Die bestehenden Bestandsschutztests prüfen weiterhin unveränderte Regel-Digests,
Unterkunftsrevisionen, Approval-Evidenz, Buchungen, Fingerprints und identische
Reimporte über die sieben Referenznationen. Nur die informative `sportEntries`-
Anzeige darf sich nach einer Sportregelrevision ändern. Originalmeldungen und
Browserartefakte werden ausschließlich lokal verwendet.

Abnahme am 02.11.2026: 313 Backendtests, 228 Frontendtests sowie nach dem letzten
mobilen Textfeinschliff erneut 41 betroffene UI-/Filtertests bestanden; Typecheck,
Produktionsbuild und `git diff --check` erfolgreich. Browser: Desktop 1440×1000 und
Mobil 390×844 mit ITA/CAN/JPN, synthetischer gemischter Meldung aller 31 Competitions
und acht ARG-Kombinationen (beide Reihenfolgen, Einzel-/Gesamtimport, beide
Bildschirmgrößen). Alle ARG-Importe ergeben elf Personen (7 Athleten, 4 Officials).
Der synthetische Gesamtimport mit sieben sportlichen Prüfpositionen bleibt
importierbar. Die Statusaktion filtert auf die betroffenen Männer statt auf
unauffällige Frauen; Haupttabellen sind ohne seitliches Abschneiden lesbar.
