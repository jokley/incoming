# Operational Workflow Review

Stand: 25. August 2026

## Zielbild und Prüfmethode

Incoming wurde als zusammenhängendes Operations-System aus Sicht der täglichen
Unterkunftsdisposition geprüft. Maßstab war für jede Seite die Frage, welche
Entscheidung innerhalb von drei bis fünf Sekunden getroffen werden muss. Die
Prioritäten sind dabei durchgängig:

1. **Kritisch:** Konflikte, fehlende Zimmer, verletzte Reserven und blockierte Entscheidungen.
2. **Wichtig:** Änderungen an Aufenthalt, Zimmerpartner, Hotel oder Importstatus.
3. **Hilfreich:** Kapazität, Zuordnungsstatus, Nation, Disziplin und nächste Bewegung.
4. **Hintergrund:** Stammdaten, Historie, langfristige Kennzahlen und Exportdetails.

Businesslogik, APIs, Datenmodelle, Backend-Prozesse und Performance-Architektur
blieben unverändert.

## Übersicht

- **Operative Frage:** Wo muss heute gehandelt werden und was ist neu?
- **Problem/Ursache:** Die erste KPI-Reihe mischte operative Aufgaben mit ruhigen
  Projektkennzahlen wie Gesamtpersonen, Gesamtkontingent und Dispositionsstand.
  Dadurch konkurrierten Hintergrundinformationen visuell mit Handlungsbedarf.
- **Entscheidung:** Die erste Reihe enthält nur noch offene Dispositionsarbeit,
  importbedingte Prüfungen, Einzelzimmerentscheidungen, kritische Hotels und
  fehlerhafte Stammdaten. Projekt- und Kapazitätskennzahlen bleiben in Analytics.
- **Nutzen:** Die erste Blickbewegung führt nun direkt zu einer Arbeitsliste; ein
  grüner Zustand bedeutet tatsächlich, dass aktuell nichts zu entscheiden ist.
- **Gemeinsame Komponenten:** Vorhandene `KpiCard`, `StatusChip`, `DataPanel` und
  direkte Deep Links wurden bewusst weiterverwendet.
- **Auswirkungen:** Keine neue Navigation und keine neue Statusdefinition. Die
  nachgelagerten Bereiche „Heute“, Hinweise, Bewegungen, Hotels, Import und
  Aktivitäten bleiben als kompaktes Lagebild erhalten.

## Zuweisungen

- **Operative Frage:** Welche Person oder Zimmereinheit muss als Nächstes
  disponiert beziehungsweise geprüft werden?
- **Bewertung:** Bereits hohe operative Qualität. Die Warteschlange startet mit
  offenen Fällen, unterstützt Suche, Nation, Disziplin, Gender, Zimmerkategorie,
  Importprüfung und synchronisierte Hotelansicht. Quoten- und Zimmerpartnerhinweise
  stehen am Entscheidungsort.
- **Informationshierarchie:** Konflikt/Prüfung (kritisch), offene Einheit und
  Quotenzustand (wichtig), Hotelkapazität und Bewohnerdaten (hilfreich), Historie
  (Hintergrund).
- **Entscheidung:** Unverändert. Zusätzliche Standardfilter würden den bereits
  fokussierten Queue-Workflow eher fragmentieren.
- **Auswirkungen:** Die Übersicht verlinkt präziser in die bestehenden Sichten
  `workflow=open` und `workflow=review`.

## Hotels

- **Operative Frage:** Welches Hotel benötigt jetzt Aufmerksamkeit und wo gibt es
  die passende freie Zimmerkategorie?
- **Problem/Ursache:** Die Liste folgte der API-Reihenfolge und die vorhandenen
  Filter HP, SR und Region beschrieben Ausstattung, nicht täglichen
  Handlungsbedarf. Kritische und vollständig belegte Hotels konnten deshalb
  zwischen unkritischen Hotels stehen.
- **Entscheidung:** Standardansicht „Handlungsbedarf“ mit stabiler Priorisierung:
  fehlendes Kontingent, voll, über 90 Prozent beziehungsweise höchstens zwei freie
  Einheiten, über 75 Prozent, danach Hotelname. Ergänzt wurden die operativen
  Sichten „Alle“, „> 75 %“, „> 90 %“, „Voll“, „Freie EZ“ und „Freie DZ“.
- **Umsetzung:** Filter arbeiten ausschließlich auf bereits geladenen
  Hotel-, Inventar- und Buchungsdaten. Suche, Region, HP und SR lassen sich weiter
  kombinieren. Leere Ergebnisse erklären den nächsten Schritt.
- **Nutzen:** Engpässe stehen ohne Sortieraktion oben; freie EZ/DZ sind ohne
  Öffnen mehrerer Hotels auffindbar.
- **Gemeinsame Komponenten:** Bestehende `StatusChip`, `ContentCard`,
  `SectionHeader`, Kapazitätsberechnung und Fortschrittsanzeige werden genutzt.
- **Auswirkungen:** Hotel-Deep-Links und Detailbearbeitung bleiben unverändert.
  Kennzahlenvergleiche und Zeitreihen verbleiben in Analytics; Kontakte und
  exportorientierte Details verbleiben in Listen.

## Athleten

- **Operative Frage:** Welche Person benötigt wegen Änderung, Konflikt,
  Einzelzimmer oder fehlender Disposition Aufmerksamkeit?
- **Bewertung:** Bereits hohe Qualität. Statusfilter unterscheiden offen, neu,
  Disposition prüfen und Stammdaten prüfen; Deep Links unterstützen
  Einzelzimmerstatus und heutige Bewegungen. Aufenthalts- und
  Zimmerpartneränderungen werden in der Ergebniszeile zusammengefasst.
- **Informationshierarchie:** Konflikt und Importprüfung (kritisch), Aufenthalt,
  Zimmerpartner und Zuweisungsstatus (wichtig), Nation/Hotel/Zimmertyp (hilfreich),
  FIS- und Aktivitätsdetails (Hintergrund).
- **Entscheidung:** Unverändert. Die Seite ist bereits personen- statt
  stammdatenorientiert; die Detailansicht trennt editierbaren Aufenthalt von
  FIS-geführten Feldern und verweist für Zimmerarbeit in Zuweisungen.

## Events

- **Operative Frage:** Welche Veranstaltung benötigt Aufmerksamkeit und wie liegt
  ihr Unterkunftszeitraum im Gesamtplan?
- **Bewertung:** Bereits hohe Qualität für den aktuellen Datenumfang. Suche,
  Disziplin-/Genderfilter, kompakte Eventliste und gemeinsame Timeline beantworten
  Auswahl und zeitliche Überschneidung ohne Seitenwechsel.
- **Informationshierarchie:** Fehlende oder kollidierende Zeit-/Bedarfsdaten wären
  kritisch; Eventzeitraum und Bedarf sind wichtig; Disziplin und Gender hilfreich;
  Stammdatenbearbeitung ist Hintergrund.
- **Entscheidung:** Unverändert, da keine vorhandene fachliche Konfliktkennzeichnung
  ohne neue Businesslogik zuverlässig abgeleitet werden kann.

## Analytics

- **Operative Frage:** Welche Trends, Reserven und Optimierungspotenziale erklären
  die Gesamtsituation?
- **Bewertung:** Die Seite ist korrekt als strategischer Analysebereich
  positioniert. Sie enthält Kapazitätsverläufe, Hotelrisiken, Nationenvergleiche,
  Zuweisungskennzahlen, Einzelzimmerauswertung und Konfliktanalyse.
- **Informationshierarchie:** Management-KPIs und Trends sind hier primär;
  operative Einzelfälle werden über Deep Links an den jeweiligen Arbeitsplatz
  übergeben.
- **Entscheidung:** Unverändert. Die frühere prominente Verlinkung einer
  Kapazitätsreserve aus der Übersicht entfällt, damit Analytics nicht wie eine
  tägliche Queue wirkt.

## Listen

- **Operative Frage:** Welche Detaildaten werden für Recherche, Ausdruck oder
  Export benötigt?
- **Bewertung:** Bereits passend abgegrenzt: Nur-Lese-Ansicht, Spezialfilter,
  sortierbare Tabellen, Gruppierungen und Excel-Export. Personen je Hotel/Nation,
  Hotelkontakte und Kontingente sind hier richtig verortet.
- **Entscheidung:** Unverändert. Listen werden nicht mit operativen Warnungen
  überladen und ersetzen keine Arbeitsqueue.

## Import

- **Operative Frage:** Was hat sich geändert, welche Entscheidung ist offen und
  was blockiert die Übernahme?
- **Bewertung:** Bereits hohe Qualität. Der Workflow trennt technische Prüfung,
  fachliche Entscheidungen, Freigabe und Import. Vorschaukarten beantworten
  explizit, was sich seit der letzten Meldeliste geändert hat; Fehler,
  Informationen und Entscheidungen besitzen eigene Handlungstexte.
- **Informationshierarchie:** Blocker und offene Entscheidungen (kritisch),
  Änderungsumfang (wichtig), Dateiversion und Quelle (hilfreich), Historie
  (Hintergrund).
- **Entscheidung:** Unverändert. Historie bleibt eingeklappt, damit die aktuelle
  Entscheidung vor Dokumentation steht.

## Prüfung gemeinsamer Auswirkungen

- Statusfarben bleiben semantisch konsistent: Rot für Konflikt, Orange für
  Aufmerksamkeit, Grün für erledigt/stabil; jeder Status enthält zusätzlich Text.
- Operative Deep Links führen weiterhin in bestehende Filterzustände. Es wurden
  keine neuen Routen oder Sackgassen eingeführt.
- Analytics und Listen behalten ihre klaren Rollen; keine Detail- oder
  Reportinginformation wurde in operative Seiten dupliziert.
- Die Hotelverbesserung nutzt vorhandene Clientdaten und verändert weder
  Datenabruf noch Speicherung. Such- und Filteroperationen bleiben lokal.

## Erfolgskriterien

Der Sprint reduziert die Zeit bis zur ersten Entscheidung auf Übersicht und
Hotelseite: Handlungsbedarf ist die Standardsicht, kritische Hotels sind stabil
priorisiert, und freie Einzel- beziehungsweise Doppelzimmer sind direkt filterbar.
Alle bereits hochwertigen Bereiche bleiben bewusst unverändert, um Konsistenz und
eingespielte Abläufe zu schützen.
