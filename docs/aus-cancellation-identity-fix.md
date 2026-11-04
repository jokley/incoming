# AUS: explizite Stornierung und nachvollziehbare Identitätskonflikte

## Verifizierter Originalbefund

Die bereitgestellten unveränderten Dateien `ENTRIES-LIST_2027_SB_WSC_Montafon_AUS_2026_11_03-11-16-44.xlsx`
und `ENTRIES-ROOM-LIST-DETAILED_2027_SB_WSC_Montafon_AUS_2026_11_03-11-16-50.xlsx`
wurden lokal tatsächlich verarbeitet. Sie werden nicht ins Repository übernommen.

- 61 Entry-Zeilen: 60 `YES`, eine `CANCELLED`.
- 26 Room-List-Zeilen.
- 40 Akkreditierungs-IDs `0`; 61 eindeutige Competitor-/Staff-IDs.
- Die stornierte Person ist ein Official ohne FIS-Code und ohne eigene Room-List-Zeile.
- Nach Korrektur: 60 aktive SB-Personen, davon 21 Athleten und 39 Officials.

Auf leerem Bestand liefert das bisherige main für diese Originale HTTP 200 ohne
Identitätsfehler, berücksichtigt aber alle 61 Personen. Die Akkreditierungs-ID ist
kein Schlüssel im vorhandenen exakten Personenabgleich. Die 40 Nullwerte sind
somit kein nachgewiesener Auslöser der gemeldeten Bestandskollision.

## Ursache und Änderung

`parse_entries_list()` wandelte `Present` in ein Boolean um, nahm eine stornierte
Zeile aber trotzdem in Personen, Competition-Auswertung und Änderungsplan auf.
Jetzt wird ausschließlich der explizite Status `CANCELLED` aus der aktiven Meldung
entfernt und als optionale `cancelledPeople`-Evidenz getrennt aufbewahrt. Andere
Werte (`NO`, fehlend/leer) behalten ihre bisherige Bedeutung; keine pauschale
Filterung aller falschen Boolean-Werte. Auch Stornierungen nehmen an den
bestehenden Eindeutigkeitsprüfungen teil und können keine ID-Duplikate verstecken.

Betroffene Funktionen:

- `backend/excel_import.py`: Parser, Vorschauerstellung, wirksamer Nationsbestand
  und bestehender interner Confirm-Schutz. Auch eine nur aus Stornierungen
  bestehende Datei erhält einen eindeutigen Nations-/Sportkontext.
- `backend/app.py::preview_fis_import`: Nationserkennung berücksichtigt die
  expliziten Stornierungen, ohne die Session-/Eventvalidierung zu umgehen.
- `backend/imports/change_plan.py`: optionale Stornoevidenz im Input-Fingerprint,
  Entfernerklärungen im vorhandenen Plan und eng begrenzter Herkunftsnachweis
  für früher importierte Personen ohne Competition-Membership.
- `backend/imports/workflow.py`: Stornoevidenz beim gemeinsamen Prüfstand erhalten;
  bestehenden Entfernungshinweisen den konkreten Grund zuordnen.
- `backend/imports/identity.py`: Fehlermeldung und strukturierte Diagnosedetails
  nennen Importperson/Zeile, bestehende Kandidaten, normalisierte starke IDs,
  Trefferweg (`fisCode`, `competitorId`, `name`) und widersprechende Identifier.
  Keine Änderung der Matchingentscheidung oder Lockerung von Konflikten.
- `frontend`: `DataImport.tsx`, `ImportChangePlan.tsx`, `types.ts` zeigen die
  Stornierung mit ihrem betroffenen Sportbereich und den kontrollierten
  Entfernungsgrund. Eine weiterhin gültige FS-Meldung wird nicht als global
  stornierte Person bezeichnet.

## Erhaltene Schutzmechanismen

Die bisherigen Personen-/Membership-/Buchungsentfernungen bleiben der einzige
Schreibpfad. Eine SB-Stornierung entfernt eine gültige FS-Membership nicht.
Destruktive Änderungen verlangen weiterhin den aktuellen Plan und die explizite
Bestätigung. Eine belegte Buchung behält überlebende Gäste und Einstellungen;
Genehmigungsevidenz wird nicht gelöscht oder umgeschrieben. Der bestehende Schutz
für gemeinsame Personen mit Genehmigungsbezug bleibt aktiv.

Für eine früher importierte Person ohne jede Membership kann der Sportbereich
nicht aus ihrer bloßen Abwesenheit abgeleitet werden. Die eng begrenzte Ausnahme
verlangt explizite Stornierung, aktuell übereinstimmende starke Identität und den
vorhandenen Nachweis eines bestätigten Imports aus genau dem ausgewählten
Sportumfang. Entwürfe, Namensfallback allein und unklare/fremde Importumfänge
reichen nicht. Ohne diesen Nachweis bleibt der Teilimport gesperrt.

Die neue JSON-Evidenz ist fingerprintgeschützt. Bei alten Vorschauen ohne dieses
optionale Feld bleibt der bisherige Input-Fingerprint exakt erhalten (Golden-Test).
Keine Migration, neue Tabelle, Importengine oder neue Identitätsarchitektur.
Dateierkennung überspringt keinen neuen Parserlauf und keine erneute Prüfung.

## Prüfung

- Breite Regression: 178 bestanden, drei optionale JPN-Originaltests mangels Dateien
  übersprungen. Enthält exakte Identitäten, Event-Isolation, ARG/SB/FS mit elf
  eindeutigen Personen, Reimport, Quoten, EZ-Ausnahmen, Tarife und Rückfragen.
- Abschließende gezielte Prüfung: 20 bestanden, einschließlich drei tatsächlicher
  AUS-Originaltests. Zusammen 182 unterschiedliche erfolgreiche Backendfälle.
- Frontend: 245 Tests bestanden; Typecheck, Produktionsbuild und Diff-Prüfung bestanden.
- Tatsächliche lokale Chromium-Abläufe mit Originaldateien, Desktop 1440×1000 und
  Mobil 390×844: Erstimport 60 Personen, identischer Reimport ohne Duplikate,
  Korrektur eines lokal nachgestellten Altparser-Bestands von 61 auf 60 erst nach
  Löschbestätigung sowie sichtbare Diagnose einer kontrolliert erzeugten starken
  ID-Kollision ohne automatische Zusammenführung. Keine Browserfehler in den
  erfolgreichen Abläufen; kein horizontaler Seitenüberlauf.

Die Altparser-Simulation ist ausdrücklich ein isolierter Testzustand. Dabei wird
nur das alte Presence-Verhalten nachgestellt; die hochgeladenen Originaldateien
bleiben unverändert. Die zusätzlichen Kollisionsfälle verändern ausschließlich
gezielt erzeugte Testbestände.

Reproduzierbare Originaltests: `AUS_ENTRIES_FILE` und `AUS_ROOMS_FILE` auf die
lokalen Originale setzen; mit `FLASK_ENV=test`, dem dedizierten
`TEST_DATABASE_URL` und `PYTHONPATH=backend` die Dateien
`test_aus_original_cancellations.py` und `test_cancelled_entries.py` ausführen.
Die bestehende Testdatenbank-Allowlist bleibt zwingend.

## Offene Diagnosegrenze

Produktive bestehende Personendatensätze und frühere produktive AUS-Versionen
stehen hier nicht zur Verfügung. Das konkrete ursprünglich kollidierende Paar
kann daher nicht seriös benannt und keine berechtigte ID-Änderung bestätigt werden.
Die neuen Diagnosedetails ermöglichen diese Zuordnung beim nächsten Konflikt.
Echte Widersprüche bleiben gesperrt; keine automatische Reparatur von IDs oder
Zusammenführung nach Namensähnlichkeit. Originaldateien, private Diagnoseausgaben
und Screenshots verbleiben ausschließlich lokal.

Keine produktiven Datenänderungen, kein Merge oder Deployment. Unabhängig von
PR #371; PR #370 wird nicht verändert.
