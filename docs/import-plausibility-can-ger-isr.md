# CAN / GER / ISR: nicht blockierende Plausibilitätsanzeige

## Analyse vor Änderung

Basis: main `df9268ae95c584bdf83e5a73da6f1030bacedc3a` (#349 enthalten).
Die neue sportliche Anzeige ist eine lesende Import-Control-Projektion. Sie wird
nicht in preview_json, Fingerprints, Change Plans oder Approval-Evidence gespeichert.
Familienquoten, Importparser, Identitäten, Genehmigungen und Tarife bleiben gleich.

### GER: die hochgeladene Datei enthält neun, nicht acht

Geprüft wurde `ENTRIES-LIST_2027_SB_WSC_Montafon_GER_2026_10_28-20-58-17.xlsx`:
SHA-256 `dffa8e367461b588224da45abdc6d98ede9eabaf6c4fc9debfee4218f90ec217`.
Die Data-Tabelle enthält 55 Personen, davon 32 Athleten. In den männlichen
Big-Air- und Slopestyle-Spalten steht bei neun Athleten jeweils Yes. Die
Excelzeilen sind 5, 6, 9, 10, 12, 16, 17, 19 und 20. Alle neun haben Geschlecht M,
unterschiedliche FIS-Codes und unterschiedliche Competitor-IDs; dieselben neun
Personen sind in beiden Wettbewerben gemeldet. Es gibt keine versteckten Zeilen.
Der unabhängige XLSX-Abgleich und die tatsächliche Importprojektion bestätigen neun.
Der bereitgestellte GER-Screenshot mit 55 Personen / 32 Athleten passt hierzu.

Eine Version mit acht ist in den aktuell bereitgestellten Dateien nicht belegt.
Der Screenshot enthält keine Import-Session-/Versions-ID oder Dateihash; ein
früherer Versionswechsel lässt sich daraus nicht rekonstruieren. Es besteht kein
nachgewiesener Parser- oder Zählfehler. Die numerische Differenz zu vier ist im
geprüften Fall fünf, nicht vier. Es werden keine Datensätze korrigiert.

### CAN: persönlicher Titelbezug, kein übertragener BA-Titel

Die Originalmeldung bestätigt 20 Personen / 14 eindeutige Athleten. SS und BA:
5 Männer / 4 Frauen; Halfpipe: 2 Männer / 3 Frauen. Die fünf Männer in SS/BA sind
dieselben Personen. Der vorhandene verifizierte Engadin-2025-Titelkatalog belegt
einen persönlichen Slopestyle-Titel mit exakter FIS-Identität, Nation, Geschlecht
und konkreter Meldung. Dafür ist kein EZ-Ausnahmestatus erforderlich.

### ISR: fehlende Integration und unbekannte Termine

Beide Originaldateien melden 04.03.–22.03.2027. Beide Personen sind den konkreten
Bewerben Parallel Giant Slalom und Parallel Slalom zugeordnet. Die tatsächliche
Importprojektion bestätigt dies.

#347 wurde in ux/import-four-tiles gemergt und war auf dem geprüften main weiterhin
nicht enthalten. Damit fehlte dort bereits die gesamte Aufenthaltsprojektion.
Dieser PR übernimmt die bestehende Implementierung einschließlich Personen-,
Hotel-, Belegungs- und Exportanbindung. Die Konflikte beschränken sich auf aktuelle
Frontendimports und Filterbeschriftungen. Die zentrale MIN/MAX-Funktion bleibt
unverändert; keine zweite Berechnung im Frontend.

Die vorhandenen AccommodationEvent-Termine werden einmal je Projektion im
Championship-Scope geladen und über eindeutige konkrete Bewerbsnamen aufgelöst.
Fehlende, mehrdeutige oder unvollständige Zuordnungen liefern außerhalbNächte=null
und EVENT_DATES_UNCLEAR. In der UI: „Eventtermine nicht zuordenbar“, ein direkter
„Aufenthalt nicht prüfbar“-Personenfilter und kein OK in der Personenkachel.

Kein Zugriff auf produktive Import-Sessions oder gespeicherte Eventtermine stand
zur Verfügung. Für ISR wird daher keine tatsächliche Überschreitungszahl behauptet.
Der lokale Originaldateitest prüft den Fall ohne Kalender. Der zusätzliche
Datumsfall verwendet ausdrücklich synthetische PGS-/PSL-Termine (08.–09.03.):
zulässige An-/Abreise 06.–10.03.; Aufenthalt 04.–22.03. ergibt 14 Außennächte.
Diese Testtermine werden weder ausgeliefert noch als tatsächliche FIS-Termine benutzt.

## Kleine fachliche Ergänzung

Die numerische Projektion gilt ausschließlich für die eindeutig katalogisierten
Snowboard-HP-/SS-/BA-Einzelwettbewerbe einer WM 2027. Regulärer numerischer Maximalwert:
4 je Geschlecht und Medaillenwettbewerb. Die bestehende geprüfte Titelreferenzdatei
wird lesend benutzt; keine neue Titelverwaltung oder Änderung der EZ-Erkennung.

Persönliche Zusatzstarter benötigen einen verifizierten individuellen Engadin-2025-
Titel mit Quelle und exakter Übereinstimmung von FIS-Code, Nation, Geschlecht,
Event Group, Disziplin und tatsächlicher Wettbewerbsmeldung. Kein Rückschluss aus
EZ-Flags, manuellen EZ-Ausnahmen oder Familienquoten-Genehmigungen. Keine Übertragung
des SS-Titels auf BA. Andere Jahre/Sportarten/Teamwettbewerbe werden nicht neu bewertet.

Die vorhandenen Tabellenzellen zeigen numerisch „4 / 4 · OK“, „5 inkl. WM“ oder
„5 / 4 · Zusatzrecht prüfen“. Mobil werden die Chips kürzer beschriftet. Ein Klick
führt direkt zum exakten Athletenkreis in der bestehenden Personenliste.
SS/BA-Poolzahlen sind Mengenvereinigungen eindeutiger Personen und werden nicht
addiert; der gemeinsame Pool ist im Zellhinweis nachvollziehbar. Es gibt keine
zusätzliche Gesamtzahl vermeintlicher Überschreitungsplätze.

Die endgültige FIS-Zuteilung und Qualifikation werden ausdrücklich nicht behauptet,
auch nicht bei grünem numerischem Titelbefund. Es entsteht keine Importsperre,
Genehmigung, Buchung, Tarifänderung oder automatische Hotelpreisberechnung.

Fachquellen (bereits in der vorangegangenen Analyse geprüft):
- WM-Regeln Art. 8.2/8.3: https://assets.fis-ski.com/f/252177/x/c574d4b3c1/2023_03_19-rules-for-the-organisation-of-fis-world-championships_clean_v2b.pdf
- Montafon 2027, gemeinsame SS-/BA-Zuteilung und persönliche Titelplätze: https://assets.fis-ski.com/f/252177/x/13e88f83bf/2027-fis-rule-precisions-specific-to-the-fis-snowboard-and-freestyle-ski-freeski-sbfsfk-wsc-2027-in-aut_clean.pdf

## Abnahme

- Drei aktuelle Original-Dateipaare lokal gegen die isolierte PostgreSQL-Testdatenbank;
  keine Originaldaten im Repository, in öffentlichen Fixtures oder Anhängen.
- Sieben bestehende anonymisierte Referenznationen: Preview, Confirm, identischer
  Reimport, Buchungen, Genehmigungen, Tarife und Event-Isolation unverändert.
- Exakter Titel / falsche Nation, Person, Geschlecht, Disziplin, Titeljahr, Teamtitel,
  fehlender Quellenbeleg, nur EZ-Flag, fehlende Meldung und gemeinsamer SS-/BA-Pool.
- Aufenthaltsgrenzen, MIN/MAX mit Lücken/Überlappungen, unbekannte Termine, echter
  Reimport mit geänderten Daten; bestehende Import-/Personen-/Booking-Vertragstests.
- Frontendtests, Typecheck, Build und gezieltes ESLint; Chromium Desktop 1440×1000
  und Mobil 390×844 mit anonymisierten Projektionen und simulierter API.
- Direkte CAN-/GER-Wettbewerbsfilter (5 / 9 Personen), ISR-Unprüfbarkeit und
  synthetische Außennächte; keine zusätzlichen Dialoge oder Browserausnahmen.
- Tatsächlicher Excel-Download einer synthetischen Hotel-/Personenliste mit
  unveränderten 20 Personenzeilen und denselben Aufenthaltsinformationen.

Keine produktiven Daten geändert. Kein Merge oder Deployment.
