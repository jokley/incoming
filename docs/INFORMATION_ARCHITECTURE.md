# Informationsarchitektur Incoming

Stand: 25. August 2026  
Status: verbindliche Produktvision und Entscheidungsgrundlage für jede Umsetzung

## 1. Zweck und Entscheidungsprinzip

Incoming ist das Operations Center der Unterkunftsdisposition. Die Architektur
ordnet Informationen nicht nach Datenmodell oder vorhandenen Komponenten,
sondern nach der **nächsten Entscheidung des Disponenten**. Eine Information
erscheint nur dann prominent, wenn sie die Frage der jeweiligen Seite unmittelbar
beantwortet.

Für jede Information gelten drei Prüfungen:

1. Welche konkrete Entscheidung wird dadurch schneller oder sicherer?
2. Ist dies die Seite, auf der diese Entscheidung getroffen wird?
3. Führt der angezeigte Zustand per Deep Link ohne erneute Suche zum betroffenen
   Arbeitskontext?

Eine Kennzahl darf in mehreren Kontexten vorkommen, wenn Darstellung, Zeithorizont
und Folgeschritt verschieden sind. Beispiel: Auf **Hotels** bedeutet freie
Kapazität „Kann ich diese Person jetzt hier unterbringen?“, in **Analytics**
bedeutet der Kapazitätsverlauf „Wann und warum entsteht eine Unterdeckung?“.
Eine identische Zahl ohne anderen Entscheidungsnutzen wird nicht wiederholt.

### 1.1 Verbindlichkeit und Änderungsprinzipien

Dieses Dokument ist der verbindliche fachliche Vertrag für die
Informationsarchitektur von Incoming. Neue Anforderungen, UI-Anpassungen und
Refactorings müssen sich daran messen lassen. Eine technisch einfache Platzierung
oder eine rein visuelle Verbesserung ist kein ausreichender Grund, von diesem
Zielbild abzuweichen.

Für die Weiterentwicklung gelten folgende Leitplanken:

- **Evolution statt Redesign:** Änderungen erfolgen in kleinen, überprüfbaren
  Schritten innerhalb der bestehenden Produktoberfläche.
- **Bewährte Workflows schützen:** Ein bestehender Ablauf wird nur verändert,
  wenn ein konkret benannter operativer Nachteil behoben und die Verbesserung
  nachgewiesen wird.
- **Als optimal bewertete Bereiche bleiben unverändert:** Die in den
  Seitenverträgen mit „Bewusst beibehalten“ markierten Lösungen sind geschützte
  Produktentscheidungen, keine offene Umsetzungswarteschlange.
- **Gemeinsame Muster zuerst:** Vor jeder Seitenänderung wird geprüft, ob die
  Aufgabe durch ein bestehendes gemeinsames Muster gelöst werden kann oder ob ein
  gemeinsames Muster für mehrere Seiten gezielt weiterentwickelt werden muss.
- **Produktwirkung vor lokaler Optimierung:** Verbessert eine Änderung mehrere
  Seiten gleichzeitig, hat sie Vorrang vor einer individuellen Seitenlösung.
- **Kein Design um des Designs willen:** Eine Änderung, die nur moderner, ruhiger
  oder schöner aussieht, aber keine Entscheidung beschleunigt und keinen
  Workflow verbessert, wird nicht umgesetzt.

Vor Freigabe jeder UI-Änderung sind vier Fragen mit einem konkreten Nachweis zu
beantworten:

1. Unterstützt die Änderung eine schnellere oder sicherere Entscheidung?
2. Reduziert sie die kognitive Belastung im betroffenen Workflow?
3. Ist sie mit `AI_GUIDELINES.md` und den bestehenden Produktmustern konsistent?
4. Entspricht sie dem Seitenvertrag und der Informationsverantwortung dieses
   Dokuments?

Kann eine Frage nicht bejaht werden, wird die Änderung nicht umgesetzt oder auf
den fachlich richtigen Zielbereich verlagert. Abweichungen von der Architektur
erfordern eine begründete Änderung dieses Dokuments **vor** der UI-Änderung; die
Oberfläche darf keine stillschweigende neue Produktregel etablieren.

## 2. Benutzerfragen und eindeutige Ziele

| Benutzerfrage | Primäres Ziel | Übergabe an |
|---|---|---|
| Wo muss ich heute handeln? | Übersicht | gefilterte Arbeitsseite |
| Welche Person/Zimmereinheit disponiere ich als Nächstes? | Zuweisungen | Athlet oder Hotel |
| Wo kann ich passend unterbringen, welches Hotel ist kritisch? | Hotels | Zuweisungen oder Hoteldetail |
| Was ist bei einer bestimmten Person zu klären? | Athleten | Zuweisungen oder Import |
| Was hat sich in der Meldeliste geändert und was blockiert den Import? | Import | Athlet oder Zuweisung |
| Warum entsteht ein Engpass und wo kann optimiert werden? | Analytics | gefilterte operative Seite |
| Welche Datensätze muss ich nachschlagen, drucken oder exportieren? | Listen | operativer Datensatz |
| Wann erzeugen Veranstaltungen welchen Planbedarf? | Events | Analytics „Bedarf & Kontingent“ |
| Wer hat wann welche Änderung vorgenommen? | Aktivitäten/Audit | betroffener Datensatz |
| Wie werden Stammdaten, Rechte und Betriebsmittel verwaltet? | Administration | jeweilige Verwaltungsfunktion |

**Navigationslogik:** Übersicht, Zuweisungen und Hotels bilden den täglichen
Operationspfad. Athleten und Import bearbeiten Ursachen einzelner Fälle.
Analytics erklärt Muster. Listen belegen und verteilen Daten. Events liefern
Planbedarf. Audit und Administration sind unterstützende Bereiche, keine
operativen Cockpits.

## 3. Seitenverträge

### 3.1 Übersicht – „Was muss ich heute wissen und tun?“

**Aufgabe**  
Priorisierte, rollenübergreifende Lageübergabe für den heutigen Arbeitstag. Die
Übersicht benennt Abweichung, Auswirkung, Dringlichkeit und nächsten Schritt; sie
ist weder Reporting noch vollständige Bestandsübersicht.

**Zielgruppe**  
Leitender Unterkunftsdisponent und Schichtverantwortliche beim Arbeitsbeginn,
Schichtwechsel und kurzen Lagecheck.

**Unterstützte Entscheidungen**

- Welche Fälle müssen sofort, heute oder anschließend bearbeitet werden?
- Welche neue Änderung hat bestehende Disposition berührt?
- Welche fachliche Entscheidung oder Freigabe blockiert den Ablauf?
- Welches Hotel droht kurzfristig auszufallen oder vollzulaufen?
- Welche An- und Abreisen erfordern heute Vorbereitung?

**Zulässige KPIs und Informationen**

- Anzahl **Personen ohne Zimmer**, mit Dringlichkeit und ältestem/offenstem Fall.
- Anzahl **durch Import zu prüfender Zuweisungen**.
- Anzahl **offener fachlicher Entscheidungen** (z. B. Einzelzimmerfreigaben und
  Importentscheidungen), getrennt nach Verantwortungsziel statt als anonyme Summe.
- Anzahl **akut kritischer Hotels** nach einheitlicher Risikoregel; zusätzlich nur
  die wenigen wichtigsten Hotelfälle mit Ursache und Restkapazität.
- Anzahl **fehlerhafter oder unvollständiger Stammdaten**, sofern sie eine heutige
  Disposition blockieren.
- **Heutige Anreisen und Abreisen**, dabei nur Ausnahmen beziehungsweise noch
  unvorbereitete Bewegungen als Aufgabe priorisieren.
- **Seit dem letzten Lagecheck relevante Änderungen**: Import, Hotelkontingent,
  Aufenthalt, Zimmerpartner, Storno oder manuelle Disposition.
- Klarer Gesamtstatus „Handlungsbedarf“ oder „stabil“; grün nur, wenn keine offene
  operative Aufgabe vorhanden ist.

Jedes Element benötigt Verantwortungsziel, Zeitbezug und Handlung. Priorität ist
**blockiert/sofort**, **heute**, **beobachten**, danach **erledigt**. Reine
Aktivitäten ohne Auswirkung bleiben außerhalb des primären Sichtfelds.

**Ausdrücklich nicht hier**

- Gesamtzahl aller Athleten, Zimmer, Betten oder Hotels.
- globale Auslastungsquote, langfristige Trends, Nationenrankings oder Diagramme.
- vollständige Hotel-, Bewegungs-, Import- oder Aktivitätslisten.
- Exporte, Stammdatenpflege und historische Vollprotokolle.
- „Interessante“ Kennzahlen ohne Schwelle, Abweichung oder Folgeschritt.

**Stattdessen**  
Gesamtbestand, Zeitreihen, Quotenqualität und Optimierung nach **Analytics**;
vollständige Tagesbewegungen nach **Athleten/Listen**; Historie nach **Audit**;
Hotelbestand nach **Hotels**; Importworkflow nach **Import**.

**Sinnvolle Deep Links**

- `/assignments?workflow=open` und `/assignments?workflow=review`
- `/athletes?singleRoomStatus=PENDING_APPROVAL`
- `/athletes?review=invalid`
- `/athletes?movement=arrival&date=YYYY-MM-DD` beziehungsweise `departure`
- `/hotels?hotelId=…` zum konkret kritischsten Hotel
- `/import?sessionId=…&decisionId=…` zur offenen Entscheidung
- `/audit` mit Bezug auf die betroffene Aktivität, sobald dieser Filtervertrag
  unterstützt wird

**Bewusst beibehalten**  
Die bereits handlungsorientierte erste KPI-Reihe, die Bereiche „Heute“, kritische
Hinweise und Deep Links in gefilterte Arbeitslisten sind richtig. Beibehalten wird
auch, dass Projektkennzahlen nicht mehr die erste Blickbewegung beanspruchen.
Künftig zu schärfen sind nur die Doppelung derselben Tageszahlen zwischen KPI-Reihe
und „Heute“ sowie die unpriorisierte Aktivitätsdarstellung.

### 3.2 Zuweisungen – „Welche Unterbringungsentscheidung treffe ich jetzt?“

**Aufgabe**  
Primärer Arbeitsplatz für die sichere Zuordnung einer Person oder Zimmereinheit zu
Hotel, Zimmerkategorie und Zimmerpartner. Die Seite hält Arbeitswarteschlange,
betroffenen Fall und verfügbare Optionen in einem Entscheidungskontext.

**Zielgruppe**  
Unterkunftsdisponenten in der laufenden Einzel- und Massendisposition.

**Unterstützte Entscheidungen**

- Welcher offene oder geänderte Fall kommt als Nächstes?
- Welches Hotel und welcher Zimmertyp erfüllen Aufenthalt, Geschlecht,
  Zimmerpartner, Einzelzimmerstatus und Quote?
- Kann eine bestehende Zuordnung bestehen bleiben oder muss sie geändert werden?
- Welche Auswirkung hat die Auswahl unmittelbar auf Kontingent und Reserve?

**Zulässige KPIs und Informationen**

- Kleine Queue-Zähler: offen, durch Änderung zu prüfen, Konflikt; keine
  Management-KPIs.
- Pro Arbeitsfall: Name, Nation, Rolle/Funktion, Disziplin, An-/Abreise,
  Nächte, gewünschte/zulässige Zimmerkategorie, Einzelzimmerstatus,
  Zimmerpartner und konkrete Änderungsmarkierung.
- Aktuelle Zuweisung und Quelle/Grund einer erforderlichen Prüfung.
- Pro auswählbarer Hoteloption: Hotelstatus, freie **passende** EZ/DZ im
  relevanten Zeitraum, Quotenzustand, verbleibende Reserve nach Zuweisung,
  Einschränkungen/Besonderheiten und bestehende passende Belegung.
- Vor Bestätigung: eindeutige Folgenvorschau; bei Verletzung Blocker oder bewusst
  zu begründende Ausnahme.
- Nach Bestätigung: Erfolg, verbleibende Aufgabe und nächster Queue-Fall.

**Ausdrücklich nicht hier**

- langfristige Kapazitätskurven, Nationentrends und Optimierungsrankings.
- vollständige Hotelstammdaten, Kontakte oder alle Zimmerkategorien ohne Relevanz
  für den aktiven Aufenthalt.
- vollständige Personenakte oder komplette Audit-Historie.
- Importfreigabe, Druckansichten und Exporte.

**Stattdessen**  
Ursachenanalyse nach **Analytics**; Hotelpflege und gesamter Zimmermix nach
**Hotels**; Personenstammdaten nach **Athleten**; Importentscheidung nach
**Import**; Nachweise und Exporte nach **Listen**.

**Sinnvolle Deep Links**

- `?workflow=open`, `?workflow=review` und ein stabiler Filter für Konflikte
- `?athleteId=…` beziehungsweise ein Schlüssel für die Zimmereinheit
- `?hotelId=…` für aus Hotels gestartete Disposition
- zum Athletenprofil, zum Hoteldetail und zur verursachenden Importsession

**Bewusst beibehalten**  
Queue-zuerst, synchronisierte Hotelansicht, vorhandene Workflowfilter sowie
Quoten- und Zimmerpartnerhinweise am Entscheidungsort sind bereits optimal. Keine
zusätzliche Dashboardebene und keine Standardfilter ohne konkreten Queue-Nutzen.

### 3.3 Hotels – „Wo ist passende Kapazität, welches Hotel braucht Aufmerksamkeit?“

**Aufgabe**  
Operatives Kapazitäts- und Partnermanagement je Hotel. Die Seite beantwortet den
aktuellen Zustand und ermöglicht den direkten Sprung von einer Kapazität zu den
betroffenen Personen oder zur Disposition.

**Zielgruppe**  
Unterkunftsdisponenten und Hotelverantwortliche.

**Unterstützte Entscheidungen**

- Welches Hotel ist voll, knapp, quotenwidrig oder ohne belastbares Kontingent?
- Wo gibt es im benötigten Zeitraum freie EZ beziehungsweise DZ?
- Ist der Zimmermix noch passend oder muss umverteilt/nachverhandelt werden?
- Welche Personen, Kontingente oder Besonderheiten verursachen den Zustand?

**Zulässige KPIs und Informationen**

In der Hotelarbeitsliste je Hotel:

- operativer Status mit **Ursache** (voll, knapp, Quotenverletzung,
  Kontingent fehlt, stabil), nicht nur Farbe.
- belegte/gesamte Zimmer und prozentuale Auslastung als aktueller Zustand.
- freie EZ und freie DZ im gewählten Zeitraum; Betten nur ergänzend, weil freie
  Betten in einem DZ nicht automatisch ein frei disponierbares Zimmer bedeuten.
- operative Reserve in Zimmern sowie frühester kritischer Tag.
- knappe Kennzeichnung relevanter Besonderheiten.

Im Hoteldetail:

- Zeitraumbezug und tägliche Belegung/Kapazität für die konkrete Planung.
- Zimmermix: Kontingent, belegt, frei und Reserve je Kategorie.
- verletzte Quote mit Soll, Ist, Differenz, betroffener Gruppe und Zeitraum.
- Personen beziehungsweise Zimmereinheiten im Hotel als kompakter Kontext mit
  Übergabe an Zuweisungen; nicht als zweite vollständige Personenliste.
- Hotelstatus, disponierungsrelevante Einschränkungen und operativer Kommentar.
- Ansprechpartner nur dort, wo wegen einer Abweichung Kontakt aufgenommen werden
  muss; die vollständige Kontaktliste bleibt in Listen.

**Ausdrücklich nicht hier**

- Vergleichscharts über alle Hotels, Wachstumsraten, Nationenursachen und
  längerfristige Forecasts.
- globale „Top/Flop“-Rankings ohne unmittelbare Hotelaktion.
- vollständige Kontakt-, Personen- und Exporttabellen.
- allgemeine Aufgaben anderer Bereiche und Importhistorie.

**Stattdessen**  
Vergleiche, Forecast und Optimierung nach **Analytics**; Personen je Hotel,
Kontakte und Kontingentexport nach **Listen**; Personenkorrektur nach
**Athleten**; tatsächliche Umbelegung nach **Zuweisungen**.

**Sinnvolle Deep Links**

- `?hotelId=…`, ergänzt um Zeitraum und optional `inventoryId`
- operative Sichten „Handlungsbedarf“, „> 75 %“, „> 90 %“, „Voll“, „Freie EZ“
  und „Freie DZ“ als adressierbarer Filterzustand
- `/assignments?hotelId=…` zum Belegen oder Umverteilen
- `/lists?kind=hotels&hotelId=…` für die vollständige Belegungsliste
- `/analytics?view=hotels&hotelId=…` für Ursachen und Verlauf

**Bewusst beibehalten**  
Die Standardsicht „Handlungsbedarf“, stabile Risikopriorisierung sowie Filter für
volle Hotels und freie EZ/DZ sind operativ richtig. Ausstattungssuche (Region,
HP, SR) bleibt sekundär kombinierbar. Sie darf die Risikopriorität nicht ersetzen.

### 3.4 Athleten – „Was muss bei dieser Person geklärt werden?“

**Aufgabe**  
Personenbezogene Fallklärung und Pflege des für die Unterbringung relevanten
Aufenthalts. Die Seite ist kein allgemeines Personenregister und keine
Zimmerdisposition.

**Zielgruppe**  
Disponenten, die Änderungen, Datenfehler, Einzelzimmeransprüche oder den Status
einer konkreten Person klären.

**Unterstützte Entscheidungen**

- Ist die Person disponierbar oder blockiert ein Datenproblem?
- Was hat sich an Aufenthalt, Rolle, Zimmerwunsch oder Zimmerpartner geändert?
- Ist ein Einzelzimmer genehmigt, abzulehnen oder noch zu entscheiden?
- Muss zur Korrektur in Import oder zur Unterbringung in Zuweisungen gewechselt
  werden?

**Zulässige KPIs und Informationen**

- Nur fallbezogene Queue-Zähler: offen, neu, Disposition prüfen,
  Stammdaten prüfen, Einzelzimmerentscheidung.
- In der Ergebniszeile: Name, Nation, Funktion/Rolle, Disziplin, Aufenthalt,
  Zuweisungsstatus, Hotel/Zimmertyp sowie sichtbarer Konflikt oder Änderungsgrund.
- Im Detail: FIS-ID und Quelle, Kontaktdaten soweit vorhanden,
  An-/Abreise, Zimmerwunsch, Zimmerpartner, Einzelzimmerstatus, aktuelle
  Unterbringung und relevante Änderungshistorie.
- Klare Trennung zwischen FIS-geführten, lokal editierbaren und abgeleiteten
  Feldern; jeder Konflikt nennt nächsten Schritt und zuständigen Bereich.

**Ausdrücklich nicht hier**

- Hotelkapazitätsvergleich und Kontingentsteuerung.
- allgemeine Nationenstatistik oder Athleten-Gesamtzahl als KPI.
- vollständiger Auditlog, Importworkflow oder druckorientierte Mannschaftsliste.
- direkte Zimmerverwaltung, wenn die Auswirkungen nicht vollständig sichtbar sind.

**Stattdessen**  
Unterbringungsentscheidung nach **Zuweisungen**; Hotelzustand nach **Hotels**;
Trends je Nation nach **Analytics**; Mannschaftslisten/Export nach **Listen**;
Quelldatenentscheidung nach **Import**; Vollhistorie nach **Audit**.

**Sinnvolle Deep Links**

- `?athleteId=…`, `?review=invalid`, `?singleRoomStatus=…`
- `?movement=arrival|departure&date=YYYY-MM-DD`
- `/assignments?athleteId=…`
- `/import?sessionId=…` und `/audit?entityType=athlete&entityId=…`, sobald der
  Auditfilter unterstützt wird

**Bewusst beibehalten**  
Personenorientierte Statusfilter, zusammengefasste Aufenthalts- und
Zimmerpartneränderungen sowie der Wechsel zur Zimmerarbeit in Zuweisungen sind
bereits richtig. FIS-Stammdaten bleiben gegenüber lokal pflegbaren Angaben klar
abgegrenzt.

### 3.5 Analytics – „Warum ist die Lage so und wo können wir optimieren?“

**Aufgabe**  
Erklärungs-, Trend- und Optimierungsraum. Analytics verdichtet Zeiträume und
Gruppen, macht Ursachen sichtbar und übergibt erkannte Einzelfälle an den
operativen Arbeitsplatz. Es ist keine Queue und dort wird nicht disponiert.

**Zielgruppe**  
Leitende Disposition, Kapazitätsplanung und Management für Tagesplanung,
Vorschau und Nachsteuerung.

**Unterstützte Entscheidungen**

- Reicht das Kontingent je Tag, Zimmerart und Szenario?
- Welche Hotels laufen wann voll und warum?
- Welche Nationen, Rollen oder Events verursachen Spitzen?
- Wie entwickelt sich Reserve und welche Quote wird systematisch verfehlt?
- Wo bleiben Zimmer ungenutzt oder lässt sich der Zimmermix verbessern?
- Welche Verhandlung, Umlenkung oder Quotenanpassung hat den größten Effekt?

**Zulässige KPIs und Informationen**

- Kontingent, Bedarf, disponiert, frei und **Reserve als Zeitreihe**, getrennt
  nach Zimmern/Betten und EZ/DZ; Quelle „Live“ versus „Eventplanung“ sichtbar.
- Peak-Tag, erster Unterdeckungstag, Größe und Dauer der Unterdeckung.
- Hotelrisiken mit Auslastungsverlauf, kritischem Datum, Zimmermix und Ursache.
- Bedarf und Zuweisungsquote nach Nation, Rolle/Funktion, Disziplin und Event.
- Quoten: Soll, Ist, Abweichung, Entwicklung und Kapazitätswirkung.
- ungenutzte Kapazität: verfügbare, aber wegen Mix, Zeitraum, Restriktion oder
  Quote nicht nutzbare Zimmer.
- nachvollziehbare Optimierungshinweise mit Annahme und erwartetem Effekt, nicht
  automatisch als Wahrheit dargestellte Empfehlungen.
- globale Filter für Zeitraum, Szenario/Quelle, Zimmerart, Hotel, Nation und
  Disziplin; Definition und Datenstand jeder Kennzahl.

**Ausdrücklich nicht hier**

- einzelne offene Personen als Arbeitswarteschlange.
- Importfreigaben, Einzelzimmergenehmigungen oder direkte Zuweisungsaktionen.
- vollständige Stammdatentabellen und Kontaktlisten.
- heutige Hinweise, die nur wegen ihrer Dringlichkeit gezeigt werden.
- Module „Zuweisungsarbeit“, „Einzelzimmer – offene Entscheidungen“ und
  „operative Konflikte“, sofern sie lediglich die operativen Queues duplizieren.

**Stattdessen**  
Einzelfallarbeit nach **Zuweisungen/Athleten**; heutige Priorität nach
**Übersicht**; Hotelaktion nach **Hotels**; Importentscheidung nach **Import**;
Rohdatenexport nach **Listen**.

**Sinnvolle Deep Links**

- adressierbare Analyseansichten, z. B. `?view=capacity|hotels|nations|quotas`
- Filterparameter für Zeitraum, Quelle, Hotel, Nation, Zimmerart und kritischen
  Tag
- von einer Erkenntnis nach `/hotels?hotelId=…&date=…`,
  `/assignments?hotelId=…&date=…&workflow=open`, `/athletes?…` oder
  `/events?eventId=…`

**Umgesetzte Analysebereiche**
Analytics besteht bewusst nur aus „Bedarf & Kontingente“, „Hotelrisiken“ und
„Nationen & Bedarf“. „Zuweisungsarbeit“, „Einzelzimmer“ und „Operative
Konflikte“ sind keine Analysebereiche: Die zugehörigen Einzelfälle und offenen
Entscheidungen bleiben ausschließlich in Übersicht, Zuweisungen, Hotels und
Athleten. Ein weiterer Analysebereich entsteht erst, wenn eine eigenständige
Managementfrage und belastbare Verlaufs- oder Ursachendaten vorliegen.

### 3.6 Listen – „Welche Daten muss ich nachschlagen, drucken oder exportieren?“

**Aufgabe**  
Stabiles Informationszentrum für Recherche, Nachweis, Druck und Export. Listen
sind schreibgeschützt und bilden den gefilterten Datenstand nachvollziehbar ab.

**Zielgruppe**  
Disposition, Teamleitung, Akkreditierung, Transport, Hotelpartner und weitere
Empfänger operativer Unterlagen.

**Unterstützte Entscheidungen**

- Finde ich eine bestimmte Person, Gruppe, Hotelbelegung oder Kontaktinformation?
- Welche gefilterten Daten müssen verteilt, gedruckt oder als Excel übergeben
  werden?
- Zu welchem operativen Datensatz muss ich für eine Änderung wechseln?

**Zulässige KPIs und Informationen**

- Ergebnisanzahl und bei gruppierten Listen eine sachliche Gruppensumme.
- eine gemeinsame Personenliste mit Gruppierung nach Hotel oder Nation sowie
  Hotelkontakte und Hotelkontingente.
- dichte Tabellen, Suche, Fachfilter, Sortierung, Gruppierung, Summenzeile,
  Druck- und Exportmetadaten (Filter, Datenstand, Erstellungszeitpunkt).
- Deep Link aus jeder geeigneten Zeile; kein Bearbeiten in der Liste.

**Ausdrücklich nicht hier**

- Ampelcockpit, Warnungsqueue, Handlungsempfehlungen oder Priorisierung.
- komplexe KPIs, Quotenbewertung, Trends, Forecasts und Diagramme.
- Inline-Disposition oder Stammdatenpflege.

**Stattdessen**  
Handlungsbedarf nach **Übersicht**; Bearbeitung nach **Zuweisungen, Hotels oder
Athleten**; Analyse nach **Analytics**; Stammdatenpflege nach **Administration**.

**Sinnvolle Deep Links**

- `?kind=people&groupBy=hotel|nation`, `?kind=hotelContacts|contingents` plus
  persistierbare Filter
- Zeilenlinks zu `/athletes?athleteId=…` und `/hotels?hotelId=…`
- Export behält Filter, Sortierung, Gruppierung und Datenstand bei

**Bewusst beibehalten**  
Nur-Lese-Prinzip, Spezialfilter, sortierbare Tabellen, Gruppierungen und
Excel-Export sind bereits optimal abgegrenzt. Hotel und Nation sind alternative
Gruppierungen derselben Personenliste und keine getrennten Listenprodukte. Keine
operativen Warnungen oder Analytics-Widgets ergänzen.

### 3.7 Import – „Was hat sich geändert und was verhindert die Übernahme?“

**Aufgabe**  
Kontrollierter Eingang neuer FIS-Meldedaten. Der Import übersetzt Dateien in
verständliche Änderungen, Blocker und fachliche Entscheidungen.

**Zielgruppe**  
Importberechtigte Disponenten und Freigabeverantwortliche.

**Unterstützte Entscheidungen**

- Ist die Datei technisch und fachlich übernahmefähig?
- Welche Personen oder Zuweisungen ändern sich gegenüber der letzten Version?
- Welche Entscheidung beziehungsweise Korrektur ist vor Freigabe erforderlich?
- Welche bestehenden Dispositionen müssen nach Übernahme geprüft werden?

**Zulässige Informationen**  
Workflowstatus, Version/Quelle, technische Fehler, fachliche Änderungen,
betroffene Datensätze, offene Entscheidungen, Freigabestatus, Importfolge und
kompakte aufklappbare Versionshistorie. Jede Meldung beantwortet „Was ist
passiert?“, „Was ist betroffen?“, „Welche Auswirkung?“ und „Was ist zu tun?“.

**Nicht hier / stattdessen**  
Keine allgemeine Personenpflege (**Athleten**), keine Neudisposition
(**Zuweisungen**), keine globale Importstatistik (**Analytics**, falls später
entscheidungsrelevant), keine vollständige Änderungschronik (**Audit**).

**Deep Links**  
`?sessionId=…&decisionId=…`, betroffener Athlet, betroffene Zuweisung sowie nach
Import direkt `workflow=review`.

**Bewusst beibehalten**  
Die Trennung von technischer Prüfung, Entscheidung, Freigabe und Import sowie die
änderungsorientierte Vorschau sind optimal. Die Historie bleibt eingeklappt.

### 3.8 Events – „Wann entsteht welcher geplante Unterkunftsbedarf?“

**Aufgabe**  
Pflege der planungsrelevanten Veranstaltungszeiträume und Bedarfsannahmen. Events
liefern eine Ursache für den Planbedarf, ersetzen aber keine Kapazitätsanalyse.

**Zielgruppe**  
Planungsverantwortliche und leitende Disposition.

**Unterstützte Entscheidungen**  
Ist Zeitraum und Zimmerbedarf eines Events korrekt? Welche Events überschneiden
sich? Muss eine Annahme aktualisiert werden?

**Zulässige Informationen**  
Disziplin, Gender/Kategorie, Zeitraum, erwarteter Zimmerbedarf, Herkunft und Stand
der Annahme sowie eine gemeinsame kompakte Timeline für Überschneidungen.

**Nicht hier / stattdessen**  
Keine Live-Auslastung, Hoteloptimierung oder operative Personenqueue. Vergleich
von Planbedarf und Kontingent gehört nach **Analytics**; konkrete Teilnehmer nach
**Athleten/Listen**; Zuordnung nach **Zuweisungen**.

**Deep Links**  
`?eventId=…` sowie `/analytics?view=capacity&source=event&eventId=…`.

**Bewusst beibehalten**  
Kompakte Eventliste und gemeinsame Timeline sind für den derzeitigen Datenumfang
ausreichend. Keine erfundene Konfliktlogik ergänzen, solange fachliche Regeln
fehlen.

### 3.9 Aktivitäten/Audit – „Wer hat was wann geändert?“

**Aufgabe**  
Nachvollziehbarkeit und Ursachenklärung nach einer bekannten Änderung. Audit ist
weder Aufgabenliste noch täglicher Newsfeed.

**Zielgruppe**  
Schichtleitung, berechtigte Disponenten, Support und Administration.

**Unterstützte Entscheidungen**  
Ist eine Änderung korrekt und autorisiert? Welcher vorherige Zustand muss für die
Klärung verstanden werden? Welcher Datensatz ist betroffen?

**Zulässige Informationen**  
Zeitpunkt, Benutzer, Aktion, Entität, vorher/nachher beziehungsweise fachliche
Zusammenfassung, Quelle und Deep Link. Filter nach Zeitraum, Benutzer, Aktion und
Entität sowie Export nur für Nachweiszwecke.

**Nicht hier / stattdessen**  
Keine Prioritätslogik oder Konfliktbewertung (**Übersicht**), keine Bearbeitung
(jeweilige Fachseite), keine Trendanalyse (**Analytics**).

**Deep Links**  
`?entityType=…&entityId=…&from=…&to=…` und zurück zum betroffenen Datensatz.

### 3.10 Administration – „Wie wird der Betrieb konfiguriert?“

**Aufgabe**  
Seltene, berechtigungspflichtige Verwaltung von Stammdaten, Benutzern, Rollen,
Zimmerarten, Backups und Testdaten. Administration bleibt visuell und
informationell vom täglichen Operationspfad getrennt.

**Zielgruppe**  
Administratoren und technische Betriebsverantwortliche.

**Unterstützte Entscheidungen**  
Welche Konfiguration muss geändert, gesichert oder wiederhergestellt werden? Wer
darf welche Funktion ausführen?

**Zulässige Informationen**  
Konfigurationsstatus, Validierung, Abhängigkeiten, Berechtigung, letzte Änderung
und sichere Bestätigungs-/Wiederherstellungsinformationen.

**Nicht hier / stattdessen**  
Keine operative Hotel-, Personen- oder Zuweisungsarbeit und keine Lage-KPIs.
Hotelkontingente bleiben im operativen Hotelkontext, soweit sie im Tagesgeschäft
gesteuert werden; technische Grundkonfiguration bleibt administrativ.

**Deep Links**  
Direkte, berechtigungsgeschützte Links zur jeweiligen Verwaltungsfunktion; nach
Erfolg zurück zum fachlichen Ursprung, wenn die Aktion dort begonnen hat.

## 4. KPI-Eigentümerschaft und Wiederverwendung

| Information | Primärer Eigentümer | Zulässige Wiederverwendung |
|---|---|---|
| Personen ohne Zimmer | Zuweisungen | Übersicht als aktuelle Aufgabe; Analytics nur als Verlauf/Quote |
| Zu prüfende Disposition | Zuweisungen | Übersicht als Aufgabe; Import als Folge einer konkreten Session |
| Offene Einzelzimmerentscheidung | Athleten | Übersicht als Aufgabe; Analytics nur Entscheidungsmuster über Zeit |
| Aktuelle Hotelkapazität / freie EZ-DZ | Hotels | Zuweisungen nur passend zum aktiven Fall; Übersicht nur kritische Ausnahme |
| Kapazitäts- und Reserveverlauf | Analytics | Hoteldetail nur für ein Hotel und einen operativen Zeitraum |
| Quotenverletzung | Hotels/Zuweisungen am Entscheidungsort | Übersicht nur akut; Analytics als Muster, Ursache und Verlauf |
| Nationenbedarf | Analytics | Listen als ungegewichtete Recherche-/Exportgruppe |
| Tagesbewegung | Athleten | Übersicht nur heutige Ausnahme/Summe; Listen für Druck/Export |
| Importänderung | Import | Übersicht als offene Folge; Athlet/Zuweisung als fallbezogener Grund |
| Historische Änderung | Audit | Fachseite nur kompakte relevante Historie |

**Darstellungsregel:** Die Übersicht zeigt Zähler plus Dringlichkeit und Aktion,
die Arbeitsseite zeigt konkrete Fälle plus Entscheidungsdaten, Analytics zeigt
Aggregation plus Zeitraum/Ursache, Listen zeigen vollständige Rohdatensätze plus
Filterstand. Damit ist Wiederverwendung funktional und keine bloße Doppelung.

## 5. Verbindlicher Deep-Link-Vertrag

Deep Links sind Teil der Informationsarchitektur, nicht technische Zugabe. Jeder
Link muss die in der Ausgangsansicht versprochene Auswahl reproduzieren.

- **Ressource:** `athleteId`, `hotelId`, `eventId`, `sessionId`, `decisionId` oder
  Schlüssel der Zimmereinheit.
- **Arbeitszustand:** `workflow`, Status oder Konfliktart.
- **Kontext:** Datum/Zeitraum, Zimmerart, Nation, Disziplin und Quelle nur soweit
  für die Entscheidung erforderlich.
- **Erwartung:** Zielseite öffnet den konkreten Datensatz oder eine sichtbar
  vorgefilterte Ergebnisliste; ungültige Parameter erhalten eine verständliche
  Rückmeldung statt stillschweigend in „Alle“ zu fallen.
- **Teilbarkeit:** relevante Analyse- und Listenfilter liegen in der URL; Browser
  Zurück stellt den vorherigen Kontext wieder her.
- **Benennung:** dieselbe Ressource und derselbe Status verwenden seitenübergreifend
  denselben Parameternamen.

## 6. Finale Produktstruktur und Blickführung

### Ebene A – Handeln

1. **Übersicht:** priorisiert und verteilt Arbeit.
2. **Zuweisungen:** entscheidet Unterbringung.
3. **Hotels:** entscheidet Kapazitätsnutzung und Hotelmaßnahmen.
4. **Athleten:** klärt den personenbezogenen Fall.
5. **Import:** entscheidet über neue externe Änderungen.

### Ebene B – Verstehen und Planen

6. **Analytics:** erklärt Ursachen, Trends und Optimierung.
7. **Events:** pflegt den ursächlichen Planbedarf.

### Ebene C – Nachschlagen und Nachweisen

8. **Listen:** recherchiert, druckt und exportiert.
9. **Aktivitäten/Audit:** weist Änderungen nach.

### Ebene D – Verwalten

10. **Administration:** konfiguriert den Betrieb, strikt berechtigungsgeschützt.

Die Navigation muss diese Ebenen erkennbar machen, ohne zusätzliche Zwischen-
Dashboards zu schaffen. Häufigkeit und Entscheidungsnähe bestimmen die Position,
nicht technische Modulgrenzen.

## 7. Verbindlicher Umsetzungsrahmen

Dieses Dokument definiert Verantwortung und Informationsfluss; es ordnet noch
keine vorschnelle Gesamtumsetzung an. Jede spätere UI-Anpassung muss als kleiner,
eigenständig validierbarer Schritt erfolgen. Dabei gilt diese Reihenfolge:

1. Das betroffene gemeinsame Muster und alle Seiten, die es verwenden, ermitteln.
2. KPI- und Statusdefinitionen fachlich vereinheitlichen.
3. Wiederverwendbare gemeinsame Komponenten beziehungsweise Muster anpassen und
   gegen alle betroffenen Seiten prüfen.
4. Deep-Link-Vertrag schließen und automatisiert prüfen.
5. Erst danach eine begrenzte Seitenänderung durchführen und ihre Wirkung im
   vollständigen Workflow validieren.
6. Doppelungen zwischen Übersicht und „Heute“ entfernen; Änderungen nach
   Auswirkung statt Chronologie priorisieren.
7. Analytics konsequent von operativen Queues bereinigen und Quoten-/
   Optimierungsanalyse vervollständigen.
8. Hoteldetail auf Zeitraum, Zimmermix, Quote und Besonderheiten fokussieren.
9. Navigation nach Handeln, Verstehen, Nachschlagen und Verwalten gruppieren.

Eine gemeinsame Verbesserung wird vorgezogen, wenn sie dieselbe
Entscheidungsqualität auf mehreren Seiten herstellt. Sie darf jedoch nicht als
Vorwand für einen großflächigen Umbau dienen: Umfang, betroffene Workflows,
erwarteter operativer Nutzen und Nicht-Ziele werden vor jedem Schritt festgelegt.

Die Validierung umfasst nicht nur Darstellung und technische Funktion. Sie muss
belegen, dass der nächste Schritt eindeutig bleibt, weniger Such- oder
Interpretationsarbeit entsteht und keine neue Informationsdoppelung eingeführt
wurde. Erst danach beginnt der nächste Schritt.

Bis diese Schritte einzeln validiert sind, bleiben die ausdrücklich als optimal
bewerteten Workflows unverändert. Insbesondere werden Zuweisungsqueue,
Importworkflow, Listenprinzip und operative Hotelfilter nicht vorsorglich
redesignt.

## 8. Abnahmekriterien

Die Informationsarchitektur ist umgesetzt, wenn:

- jede Hauptseite ihre Leitfrage in drei bis fünf Sekunden erkennen lässt;
- jede prominente KPI eine Schwelle, einen Zeitbezug und einen nächsten Schritt
  besitzt;
- kein operativer Einzelfall in Analytics bearbeitet wird;
- keine Analyse oder Warnungssteuerung in Listen stattfindet;
- Übersichtselemente direkt im versprochenen Arbeitskontext landen;
- identische Informationen nur mit nachweislich unterschiedlichem
  Entscheidungsnutzen wiederholt werden;
- normale Zustände ruhig bleiben und Konflikte zusätzlich zu Farbe mit Text und
  Status gekennzeichnet sind;
- bewusst unveränderte Bereiche ihre eingespielten Workflows behalten;
- jede UI-Änderung die vier Freigabefragen aus Abschnitt 1.1 nachvollziehbar
  beantwortet;
- gemeinsame Komponenten und Muster vor individuellen Seitenlösungen geprüft
  wurden;
- rein visuelle Änderungen ohne messbaren Workflow- oder Entscheidungsnutzen
  unterbleiben.
