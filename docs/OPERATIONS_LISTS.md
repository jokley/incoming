# Operations Listen – Informationsarchitektur

## Rollen der Module

Der durchgängige Arbeitsfluss lautet **Dashboard → Analytics → Operations Listen → Athlet → Assignments → Hotels**. Dashboard priorisiert ausschließlich den heutigen Handlungsbedarf, Analytics erklärt Ursachen und Trends, und Operations Listen ist die zentrale read-only Arbeitsoberfläche. Die Personenseite bleibt für Suche und Bearbeitung einer einzelnen Person; Assignments disponiert Zimmer und Hotels steuert Kapazitäten.

## Listenkonzept

Die vorhandene Personenprojektion, Filterleiste, Gruppierung, Sortierung und Exporte werden als gemeinsamer Listenmotor wiederverwendet. Fachliche Ansichten sind gespeicherte Perspektiven auf dieselben Zeilen – keine eigenen Tabellen. Die Navigation gliedert sie in Personen, Bewegungen, Unterkunft, Aufgaben und Hotels. Jede Personenansicht behält Volltextsuche, Mehrfachfilter, Sortierung, Excel, Druck, Summen sowie direkte Übergänge zu Athlet, Assignment und Hotel.

Die Gruppen *Nach Hotel*, *Nach Nation*, *Nach Disziplin* und *Nach Funktion* variieren lediglich den Gruppierungsschlüssel. Bewegungs-, Unterkunfts- und Aufgabenansichten ergänzen einen fachlichen Prädikatfilter. Vorhandene Workflow-Status bleiben dabei autoritativ; Berechnungen und Businesslogik werden nicht verändert.

## Dashboard-Verknüpfung

Operative KPIs und Warnungen öffnen die entsprechende, per URL adressierbare Listenansicht (`/lists?view=…`). Ohne Zimmer, heutige An-/Abreisen, Dispositionsprüfung, Stammdatenprüfung und Einzelzimmer führen damit zuerst in den vollständigen Arbeitskontext. Hotelkritik bleibt bei Hotels; Ursachen- und Risikoanalyse bleibt in Analytics.

## UX-Entscheidungen

* Eine kompakte, dauerhaft sichtbare Bereichsnavigation macht die fachlichen Perspektiven scanbar.
* Ansicht, Filter, Tabelle und Aktionen behalten in jeder Personenperspektive dieselbe Position.
* Die URL identifiziert die Ansicht und ermöglicht verlässliche Schnellzugriffe vom Dashboard.
* Namen, Zimmer und Hotels bleiben direkte, kontextwahrende Übergänge in die jeweils verantwortliche Detailoberfläche.
* Warnfarben kennzeichnen weiterhin Dringlichkeit; die Auswahl der Ansicht ist zusätzlich durch Text und Hervorhebung erkennbar.
