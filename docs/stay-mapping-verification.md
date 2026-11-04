# Aufenthaltszuordnung: Diagnose und bestehende Prüfstände

Basis: main ea7004437a636a6a9e8801bcc785fad2cf835f61, inklusive #352.
Kein Zugriff auf die produktive Datenbank. Produktiver Migrationsstand und
vorhandene Verknüpfungen können deshalb hier nicht bestätigt werden.

## Nachgewiesener Datenfluss

Migration 20261028_01 ergänzt eine nullable Referenz ohne Backfill. Ein gemergter
PR bedeutet weder ausgeführte Migration noch befüllte Links. In der isolierten
Testdatenbank ist die Revision ausführbar; ihre Integritätstests bleiben erhalten.

`load_stay_schedule` lädt dieselbe WM und ihre expliziten aktiven Mapping-Links
in einem Bulk-Query. Die zentrale `assess_stay`-Funktion nutzt diese Referenzen
vor dem bisherigen eindeutigen Namensfallback. Fehlende Links bei abweichenden
Namen wie PGS/PSL gegenüber „Parallel“ bleiben bewusst unprüfbar.

`GET /api/import/sessions/<id>` baut `importControl` bei jedem Detailabruf neu auf,
auch für bereits importierte Sessions. Es benötigt keinen erneuten XLSX-Import,
keinen neuen Prüfstand und keine Schreibaktualisierung des gespeicherten Previews.
Nach einer administrativen Änderung die bestehende Nation im Import Center erneut
öffnen (oder Seite neu laden). Eine bereits geöffnete Browseransicht hält ihre
Antwort bis zum nächsten Abruf; es wird kein Polling oder automatischer Recheck
hinzugefügt, der bestehende Reviews verändern könnte.

Personenkachel und bestehende Aufenthaltsfilter verwenden `importControl.people`.
Personen-, Hotel- und Belegungs-GETs rufen dieselbe zentrale Funktion auf; bestehende
Hotel-/Personenexporte übernehmen deren Zahlen. Eine Person bleibt eine Zeile.
Der vorhandene Hotelhinweis erhält lediglich den exakt angeforderten Wortlaut.

## Kleine Darstellungsänderung und sichere Betriebsprüfung

Die vorhandene Mapping-Tabelle zeigt fehlende Links als „Zeitblock zuordnen“.
Der Klick öffnet den vorhandenen Bearbeitungsdialog; kein zusätzlicher Dialog.
Der Hinweis behauptet keine falsche Aufenthaltsüberschreitung. Auch bei brauchbarem
Namensfallback kann ein expliziter Link weiterhin fehlen.

Vor einer produktiven Zuordnung durch die Administration:

1. Im verwendeten Release `flask db current` und `flask db heads` vergleichen;
   20261028_01 muss enthalten sein. Hier wird keine Migration produktiv ausgeführt.
2. In Administration → WM 2027 → Competition Mapping die tatsächlich gemeldeten
   Wettbewerbe kontrollieren. Ein vorhandener Zeitraum allein ersetzt keinen Link.
3. Nur fachlich bestätigte Links im bestehenden Dialog speichern. ISR: weibliche
   PGS- und PSL-Mappings → vorhandener WM-Parallelblock 04.–11.03.2027.
4. ISR-Prüfstand erneut öffnen: zwei betroffene Personen; je 0 davor / 10 danach,
   zulässige An-/Abreise 02.–12.03., tatsächlicher Aufenthalt 04.–22.03.
5. „Aufenthalt außerhalb“ sowie Personen-/Hotelansicht und Export vergleichen.

Keine pauschalen Zuordnungen, keine neue Terminquelle, keine produktiven Writes.
Aktuelle und historische IMPORTED-Sessions werden synthetisch gegen denselben
Mappingwechsel geprüft: gespeicherter Preview, Fingerprint und Genehmigungen
bleiben unverändert; Terminänderung wirkt unmittelbar beim erneuten GET.
