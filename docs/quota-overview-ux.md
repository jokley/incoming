# Import-Quotenübersicht: UI/UX-Fix

Basis: `main` efe10d1 einschließlich PR339. Branch `codex/quota-overview-ux`. Keine produktiven Datenzugriffe, Migrationen, Quotenregeländerungen, Genehmigungsänderungen oder Deployments.

## Befund und Umfang

Die bisherigen Importdialoge verwenden generische Tabellen. Officials erscheinen als Kontextzahl in jeder M-/W-Zeile; dadurch wirkt dieselbe Person mehrfach gemeldet. Zusammengedrängte Athletengenehmigungen (`0 / 0 / 0`) unterscheiden die genehmigten Grenzen nicht verständlich. Ein grünes EZ-Signal konnte neben ungeklärter Officials-Abdeckung stehen.

Die Werte der Quotenberechnung bleiben erhalten. Die Änderung trennt **eindeutige Personen**, **berechnete Quotenkontexte** und **bestehende Entscheidungsfälle**. Insbesondere wird keine rechnerisch mögliche gruppenübergreifende Officials-Abdeckung aktiviert.

### Dateien und Datenfluss

- `backend/quota_overview.py`: reine, datenbankfreie Anzeigeaggregation aus dem bereits validierten Roster, `quotaChecks`, `athleteQuotaChecks` und vorhandenem Eventdatensatz.
- `backend/athlete_quota.py`: vorhandene Previewprojektion ergänzt `quotaOverview`; hält den bereits gelesenen Eventdatensatz für die Metadaten fest. Keine weitere Lookup-/Refetchschleife.
- `backend/excel_import.py`: additive Weitergabe dieses Feldes in der Uploadantwort. Keine Parser-/Matching-/Resolveränderung.
- `frontend/src/app/components/QuotaOverviewDialog.tsx`: gemeinsame Operations-Center-Ansicht mit `EnterpriseDialog`, `ContentCard`, `SectionHeader`, `StatusChip`, `InfoPanel` und bestehenden Designtokens.
- `DataImport.tsx`: beide Quotenbuttons öffnen diese Ansicht anhand des **aktuellen kanonischen Previews**. Keine separaten Requests oder alten Dialogkopien nach einer Mutation. Lesbare Grenzbeschriftungen bleiben auch im Legacy-Zeilenformatter erhalten.
- `frontend/src/app/types.ts`: optionaler, additiver DTO-Vertrag; alte Preview-/Personen-/Quotenfelder bleiben bestehen.
- Backend-/Frontendtests und ausdrücklich synthetische ITA-Anzeigefixture.

## Zählweise und fachliche Grenzen

### Athleten

Die Nationsübersicht zählt Personen, nicht Competitions oder Familienzeilen. Bereits aufgelöste `existingAthleteId`/`personId` haben Vorrang vor dem kanonischen Import-matchKey; unterschiedliche Identitätsnamensräume werden nicht vermischt. Mehrere Zeilen derselben aufgelösten Person werden für die Anzeige zusammengeführt, nicht in der Datenbank. Widersprüchliche Rollenevidence und fehlende Identitäten bleiben als unvollständig erkennbar.

Die Familienzahlen, Gesamt-/Geschlechterlimits, genehmigten und ungedeckten Umfänge kommen **unverändert aus der bestehenden Backendbewertung**. Gesamtlimits verschiedener Familien ergeben keinen gemeinsamen Nationenpool. Derselbe Athlet in zwei Familien zählt national einmal, wird aber weiterhin pro relevanter Familie bewertet.

Genehmigungen sind in den gemeldeten Personen enthalten; sie werden nicht zur Meldung addiert. Mengenbezogene Genehmigungen liefern zudem nicht immer eine eindeutige Personenmenge: Gesamt-/Männer-/Frauengrenzen können überlappen und dieselbe Person kann mehrere Familien betreffen. Deshalb zeigt die Kopfleiste bei vorhandenen Freigaben **„Umfang je Grenze“**, statt eine unbewiesene Zahl zusätzlich genehmigter Personen zu erfinden. Pro Familie stehen die drei genehmigten und noch ungedeckten Grenzen einzeln und beschriftet nebeneinander. Ohne Freigaben wird 0 angezeigt. Das Approvalmodell und optionale Personenauswahlen werden nicht geändert.

### Officials und weitere Personen

Officials sind hier die **bereits bestehende Präsentationspopulation gemappter Nicht-Athleten**, keine neu eingeführte FIS-Kategorie. Keine automatische Zuordnung von NSA Guest/Professional/Media zu Regular/Extra/Special Guest.

Pro Event Group wird deren Vereinigung eindeutiger Officials einmal angezeigt; die Tabelle darunter enthält nur Männer/Frauen, Athleten, Officials-Basis, EZ-Anspruch und EZ angefordert. Die nationale Officials-Zahl ist die Vereinigung über Gruppen, keine Summe dieser Gruppenzahlen. Mehrfachzugehörigkeiten werden mit einem Satz erklärt.

Weitere/unzugeordnete Funktionen werden nicht heimlich in die bekannte Teilsumme eingerechnet: **„Athleten + Officials“** und daneben die vollständige Meldungszahl samt zusätzlichen Personen. Ohne weitere Personen lautet die Kennzahl „Personen gesamt“. Nicht zuordenbare Officials und widersprüchliche Daten erhalten einen Prüfhinweis.

Die Summenzeile der **Basis/EZ-Ansprüche** ist ausdrücklich eine rechnerische Summe der vorhandenen Gender-Kontexte. Sie erlaubt keine Übertragung zwischen M/W oder Event Groups. `officialsWithoutCoverage` bleibt bewusst null, solange die gruppenübergreifende Regel fachlich nicht freigegeben ist. Es wird kein neues Matching ausgeführt, kein vorhandener Verstoß aufgehoben und kein neuer Preis-/Approvalfall erzeugt.

### EZ und tatsächliche Entscheidungen

EZ-Werte werden aus den vorhandenen Kontextzeilen übernommen: Anfrage-/Belegungsprojektion, `countsAsSingle`, explizites false, `APPROVED_EXTRA` und Weltmeisterausnahmen bleiben unverändert. Genehmigte zusätzliche EZ heißen genau so und werden nicht als genehmigte Officials ausgegeben.

Offene Fälle sind die bestehenden Athletenfamilienentscheidungen und EZ-Kontexte mit offenem Bedarf. Ungedeckte Personenzahl und Zahl der Entscheidungsfälle sind unterschiedliche Größen. Eine rohe Officials-Abweichung wird als **„Quotenabdeckung fachlich zu prüfen“** angezeigt, nicht als Mehrpreis oder automatische Genehmigung. Keine neue Officials-Genehmigungsplattform; historische Officials-Entscheidungen werden nicht neu interpretiert.

## Event-/Reviewkonsistenz

Eventname, WM-/Nicht-WM-Kennzeichnung sowie fixierte Revision stehen im selben Dialog. Eine unbekannte, unvollständige oder nicht fixierte Bewertung darf keinen grünen Quotenstatus erhalten. Nationen werden separat aggregiert; explizit eventfremde Personen gelangen nicht in diese Anzeige.

`quotaOverview` ist ein Readmodel und gehört nicht zu den autoritativen Change-Plan-Eingaben. Neue Metadaten verändern keinen bestehenden Input-/Statefingerprint. Ein GET schreibt keine gespeicherte Reviewversion um. Erstimport, Freigabe, Confirm und identischer Reimport werden unverändert durch die vorhandenen Prüfungen abgesichert.

Ältere archivierte Snapshots ohne diese Aggregate werden nicht rückwirkend umgeschrieben. Der Dialog kennzeichnet dann die fehlende vollständige Anzeigeübersicht. Eine aktuelle Importprüfung ergänzt die Aggregate über den bestehenden Workflow. Aktuelle Sessions erhalten die Ansicht bereits über die vorhandene Detailprojektion.

Die Live-Disposition bleibt auf ihren expliziten Nation/Event-Group/Gender-Kontexten; dortige Kontextzahlen sind keine nationale Personenaddition. Bestehende Personenlisten/Funktionsgruppen sind bereits distinct. Ihre Quotenwerte, Karten und API-Verträge wurden nicht verändert. `quota_service.py`, `_distinct_memberships()`, `quota_keys()`, EZ-Allokation, `fis_rules.py` und `quota_history.py` bleiben unverändert.

## Referenz Italien und Tests

**Die zwei im Auftrag genannten realen ITA-XLSX-Dateien waren nicht angehängt und sind im Workspace nicht vorhanden.** Es wird ausdrücklich keine Prüfung dieser konkreten Originaldateien behauptet.

Stattdessen zwei reproduzierbare Nachweise:

1. Synthetische Anzeige-Regressionsfixture: 10 Athleten (6M/4W), 14 Officials, 24 Personen, 5 Officials in beiden Gruppen. Freeski: Athleten2M/2W, Officials9, Basisgesamt8, EZ-Anspruchgesamt4, Anfrage0. Ski Cross: Athleten4M/2W, Officials10, Basisgesamt10, EZ-Anspruchgesamt4, eine W-Anfrage. Diese Werte sind als **synthetisch** unter `backend/tests/fixtures/quota-overview-ita.synthetic.json` gekennzeichnet.
2. Echter lokaler Browserupload eines separat erzeugten synthetischen ITA-Workbookpaars in einer neu angelegten isolierten Testdatenbank. Die bestehenden Parser/Competition-Mappings liefern dieselben 10/14/24/5 und genau eine Ski-Cross-W-EZ-Anfrage. Keine produktiven Eventmappings geändert. Review und beide neuen Dialoge wurden ohne Mock der Quotenprojektion geprüft.

Backendtests prüfen außerdem Mehrfach-Competitions, familienübergreifende Athleten, wiederholte Quellen, Identitätskonflikte, Reihenfolgeunabhängigkeit, Event/Nation-Isolation, unbekanntes Gender, unzugeordnete Personen, WM/Nicht-WM/Revision, Teilgenehmigungen und unveränderte EZ-Auswertung. HTTP-Regression: Upload → aktuelles Detail ohne falsches Stale → Freigabe → Confirm → identischer Reimport ohne neue Personen; gespeichertes JSON bleibt beim Lesen gleich.

Frontendtests prüfen die verständlichen Grenzwerte, beide Dialoginhalte, Referenzzahlen, fehlende spekulative Abdeckung, Teil-/Vollgenehmigung, unvollständigen/draft Prüfstand und zusätzliche Personen. Bestehende Quoten-, Genehmigungs-, Preservation-, Import-/Reimport-, Coverage-, Stale- und EZ-Regressionen bleiben in der vollständigen Suite enthalten.

### Testergebnisse und Performance

- Neue Backendfälle plus bestehende Import-/Approval-Performancebudgets: 22 erfolgreich.
- Vollständiges Backend: **918 Tests +1.304 Untertests erfolgreich**.
- Frontend: **184 Tests erfolgreich**, Typecheck und Produktionsbuild erfolgreich.
- Kein zusätzlicher HTTP-Request zum Öffnen der Dialoge. Pure Set-Aggregation; keine Datenbankqueries im neuen Aggregator und keine per-Person-/per-Gruppe-Refetches. Bestehende SQL-/Flushbudgets bestehen.
- Neue Displayfelder enthalten keine zweite Kopie der vollständigen Approval-Evidence oder EZ-Personenallokation. Kein zusätzlicher Quotenberechnungslauf, keine historische Neuberechnung und kein persistenter Cache.
- Chromium: Desktop1366×900 und schmal390×844, beide Dialoge, tatsächliche Referenzwerte und Quotenrevision, keine Browserfehler oder horizontale Dokument-/Dialogüberläufe. Die kleinen Gruppentabellen bleiben bei schmaler Breite vollständig über fokussierbare Scrollbereiche erreichbar. Light und Dark Mode wurden jeweils mit den tatsächlichen Theme-Tokens geprüft; beim Öffnen der Dialoge wurden jeweils null API-Requests ausgelöst.
- `git diff --check` erfolgreich. Keine Schemaänderung oder Migration erforderlich.

## Offene fachliche und operative Punkte

- Reale ITA-Originalworkbooks nachreichen und denselben Referenzfall daran bestätigen; der synthetische Nachweis ersetzt diesen Dateiabgleich nicht.
- Verbindliche WM/FIS-Auslegung einer personenbasierten **gruppenübergreifenden Officials-Abdeckung** bleibt offen. Dieser PR aktiviert weder Matching noch Quotenübertragung, Gebührenbefreiung oder neue Approvals.
- Eine eindeutige Gesamtzahl zusätzlich genehmigter Athleten ist ohne vollständig personenbasierte Evidence nicht immer ableitbar. Die UI zeigt deshalb bestätigte Umfänge je Grenze, statt sie falsch zusammenzurechnen.

Kein automatischer Merge/Deployment. Alle bestehenden fachlichen Berechnungen und historisierten Entscheidungen bleiben erhalten.
