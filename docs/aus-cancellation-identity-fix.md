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

## AUT: sportbereichsbezogene Staff-IDs und gemeinsame Unterkunft

Nachtrag auf Basis von `main` nach den zusammengeführten PRs #371 und #372.
Die vier unveränderten AUT-Originaldateien vom 4. November 2026 enthalten
56 aktive SB- und 45 aktive FS-Meldungen. Sechs Officials haben in beiden
Sportbereichen denselben vollständigen Namen und dieselbe Nation, aber
unterschiedliche Staff-IDs. Das ist ein Prüfvorschlag, kein Identitätsnachweis.
Erst nach einzeln ausdrücklich bestätigter Zuordnung ergeben sich 95 eindeutige
Personen mit ihren jeweiligen Competition-Memberships.

### Datenstruktur und sichere Zuordnung

Die vorhandenen Event-Personen, Memberships, unveränderlichen Quellversionen und
die append-only `ImportSessionEvent`-Historie reichen für diesen Fall aus.
Keine neue Identitätstabelle oder Migration: `OFFICIAL_SOURCE_LINK` dokumentiert
Event, Nation, beide Sportbereiche, ursprüngliche Staff-IDs, Quellzeilen,
vorhandene Quellversion, Uploadhash und bestätigenden Benutzer. Die bestehende
primäre Staff-ID bleibt die technische Personenidentität; alle Original-IDs
bleiben mit ihrem Quellenbezug sichtbar und bei Reimport wiederverwendbar.
Je nach Erstimport kann die technische primäre ID unterschiedlich sein; Anzahl,
Memberships und fachliches Unterkunftsergebnis sind reihenfolgeunabhängig.

Der kleine Bestätigungsdialog startet ohne ausgewählte Personen und zeigt die
beiden Staff-IDs samt Funktion und Quellenbezug. Vorschläge gelten ausschließlich
für eindeutig gleichnamige Officials ohne FIS-Code aus verschiedenen
Sportbereichen. Athleten, widersprüchliche FIS-Codes, Staff-ID-Kollisionen mit
anderen Personen und Änderungen innerhalb desselben Sportbereichs behalten die
starken Identitätsprüfungen. Bestätigungen sind an Event, Nation, aktuellen
Quellstand und Datenbestand gebunden, kurzlebig und gegen Wiederholung geschützt.
Ein später nicht mehr passender starker Personenbestand sperrt auch gespeicherte
Zuordnungen erneut. Es werden keine zwei bereits getrennten SQL-Personen
ungeprüft vereinigt.

### Unterkunft bleibt personenbezogen

Fehlende Zimmerangaben sind keine ausdrückliche `NO_ROOM`-Meldung. Nur tatsächlich
fehlende Evidenz darf die konkrete Meldung der anderen Quelle übernehmen;
unbekannte oder widersprüchliche ausdrückliche Werte bleiben klärungspflichtig.
Der ursprüngliche fehlende Quellenbefund und seine Aufenthaltsdaten bleiben
erhalten. Identische Zimmermeldungen werden einmal gezählt und behalten beide
Quellenbezüge. Dokumentation und Identitätsbestätigung ändern weder manuelle
Unterkunftsentscheidungen noch Tarife, Genehmigungen oder Quoten.

Die Originale enthalten vier echte Widersprüche: ausdrücklich „No room“ in SB
gegen drei Double-shared- und eine Single-Meldung in FS. Ein weiterer Official
hat getrennte Abschnitte (FS 9.–15. März, SB 16.–21. März). Bestehende
`RoomBooking`-Segmente allein lösen dies nicht: Der personenbezogene Bedarf und
die Deckungsprüfung beruhen auf einem einzigen An-/Abreisefenster. Dessen
stilles Aufspannen würde Unterkunft in der Lücke erfinden. Daher wird dieser
Fall gesondert gesperrt, statt ohne nachgewiesenen Bedarf ein neues
Mehrfachaufenthaltsmodell einzuführen. Auch fehlende Zimmerangaben dürfen einen
bekannten getrennten Aufenthalt nicht verdecken.

**Ergebnis mit den Originalen:** Nach sechs bewussten Zuordnungen ist ein
95-Personen-Entwurf prüfbar, aber wegen dieser fünf Unterkunftsfälle nicht
importierbar. Keine Unterkunftsentscheidung wird erfunden. SB hat zusätzlich
21 männliche Athleten gegenüber einer Grenze von 20; die vorhandene formale
Quotenentscheidung bleibt separat erforderlich. Ein Test eines bereits
importierten SB-Bestands setzt diese Entscheidung ausschließlich im isolierten
Test ausdrücklich und prüft ihren Erhalt. Die Originalprüfung ohne vorhandenen
Import erzeugt keine SQL-Personen oder Genehmigungen.

### Validierung des AUT-Nachtrags

Abschließende Regression: 205 Backendtests bestanden, drei optionale
JPN-Originaltests mangels Dateien übersprungen; darunter 23 gezielte
Officials-/Unterkunftsfälle sowie die AUS-Original- und ARG-Regressionen.
250 Frontendtests, Typecheck, Produktionsbuild und Diff-Prüfung bestanden.

Die gezielten Tests verwenden beide Importreihenfolgen, sowohl zwei Entwürfe
als auch einen bereits importierten ersten Sportbereich. Konsistente kontrollierte
Meldungen erzeugen genau eine Person mit zwei Memberships; spätere Reimporte
verwenden die bestätigten Quellen-IDs erneut. Gegenbeispiele prüfen fehlende,
unbekannte und explizit widersprüchliche Unterkunft, identische Zimmermeldungen,
getrennte Aufenthalte, manuelle Entscheidungen, bestehende Genehmigungen,
fremde Sportzugehörigkeiten, starke ID-Kollisionen, veraltete Bestätigungen,
Event-Isolation und fehlende Schreibberechtigung.

Die AUT-Originaltests lassen sich mit `AUT_SB_ENTRIES`, `AUT_SB_ROOMS`,
`AUT_FS_ENTRIES` und `AUT_FS_ROOMS` sowie der oben beschriebenen abgesicherten
Testdatenbank über `backend/tests/test_confirmed_official_links.py` ausführen.
Originaldateien und personenbezogene Diagnoseartefakte werden nicht eingecheckt.

Lokale Chromium-Prüfung mit den Originalen: Desktop 1440×1000 und Mobil 390×844,
jeweils SB→FS und FS→SB. Sechs anfangs unmarkierte Vorschläge, ausdrückliche
Bestätigung, 95-Personen-Entwurf mit fünf offenen Unterkunftsfällen, gesperrter
Import und Reimport ohne erneute Zuordnung. Keine Browserfehler und kein
horizontaler Überlauf. Alle Schreibvorgänge betreffen ausschließlich die
dedizierte lokale Testdatenbank; kein Merge, Deployment oder Produktionseingriff.
