# PR 2: Sportliche Startplatzregeln konfigurieren

Basis: main e470d2c510f897427962c894e34d2cf283f40fb0 einschließlich #355.
Nur Konfiguration. sport_entry_plausibility.py bleibt unverändert; kein Rollout,
keine Migration, keine automatische Übernahme/Änderung produktiver WM-Regeln.

## Bestehender Lebenszyklus

Das bestehende quota_rules_json behält seine Unterkunftsstruktur und schemaVersion 1.
Optional kommt sportEntryRules mit eigenem schemaVersion 1 hinzu. Alte Konfigurationen
werden beim Lesen weder ergänzt noch normalisiert. Auch der FIS-Standardvorschlag
enthält keine Sportregeln. Die Oberfläche legt den Abschnitt erst bei einer
bewussten Eingabe an; das Laden allein speichert oder aktiviert nichts.

Entwurf speichern, Erstfixierung, Vorher/Nachher, begründete Revision, ausdrückliche
Aktivierung, Audit und append-only EventQuotaRevision werden wiederverwendet. Es
gibt keine neue API, Tabelle, Revisionsverwaltung oder dauerhafte Entwurfsablage.
Der vorhandene Bestands-Preflight prüft weiterhin unveränderte Unterkunftsstandards
und vorhandene Genehmigungsblockaden; die Sportkonfiguration gehört nicht zum
Unterkunfts-Standardvergleich. Der Schutz aus #355 bleibt an denselben Aufrufstellen.

## Kleiner Konfigurationsvertrag

sportEntryRules enthält ausschließlich:

- enabled: eventweite Aktivierung der KONFIGURATION; hier noch ohne Auswertungswirkung.
- titleEdition: ausdrücklich gewählte Championship-Bezeichnung und Titeljahr oder null.
- competitions: competitionId, enabled, regularLimit, titleReferences und poolId.
- pools: eindeutige lokale Bezeichnung und eigenes reguläres Limit.

Männer/Frauen behalten eigene Competition-IDs und Limits. Nicht konfigurierte
Wettbewerbe erhalten keine Regel und kein Standardlimit. Ein deaktivierter Eintrag
kann ohne gesetztes Limit als Entwurf gespeichert werden; aktive Regeln benötigen
ganze Zahlen von 0 bis 10000. Teamwettbewerbe sind nicht konfigurierbar und werden
im Editor als „Team-Startrecht nicht geprüft“ angezeigt.

Competition-IDs müssen aktiv zum ausgewählten Event gemappt sein. Doppelte Regeln,
unbekannte Parameter, unbekannte Pools und widersprüchliche Mitglieder werden
abgelehnt. Poolmitglieder ergeben sich ausschließlich aus den poolId-Verweisen:
mindestens zwei Wettbewerbe derselben Sportart und desselben Geschlechts. Keine
zweite Mitgliederliste, keine Summierung und keine Poolberechnung in diesem PR.
Die endgültige FIS-Zuteilung kann durch diese Konfiguration nicht bestätigt werden.

## Titelgrundlage ohne EZ-Nebenwirkungen

Die Auswahl verwendet die vorhandenen zentralen WorldChampion-Referenzen; es werden
keine neuen Titel angelegt oder Anerkennungen/EZ-Ausnahmen geändert. Sporttitel sind
nicht vom vorhandenen EZ-entitlement_enabled abhängig. Nur aktive Einzeltitel mit
HTTPS-Quellenangabe werden angeboten. Die Quelle muss administrativ ausdrücklich
als geprüft bestätigt werden; das ist ein Konfigurationsfeld im vorhandenen
Fixierungsablauf, keine neue Genehmigung und keine automatische Quellenverifikation.

Der Snapshot enthält Titel-ID, FIS-Code, Nation, Geschlecht, Einzeltiteltyp,
Disziplin, Event Group, Championship, Jahr, Quelle und die Quellenbestätigung.
Der Server vergleicht diese Angaben mit der vorhandenen Referenz. Geänderte,
inaktive oder inzwischen als Teamtitel geführte Referenzen müssen vor einer neuen
Fixierung/Revision bewusst neu ausgewählt werden. Historische Snapshots bleiben
unverändert. Die relevante vorherige WM wird explizit gewählt, niemals per
„Eventjahr minus zwei“ oder anhand der letzten vorhandenen Liste erraten.

Für den exakten Titel-Wettbewerbsbezug fehlte bisher eine ID-Verbindung. Eine kleine
Katalog-Metadatenzuordnung verknüpft die 26 bekannten Einzelidentitäten mit den
vorhandenen Titel-Disziplincodes. Sie verwendet vollständige eindeutige globale
Katalogcodes sowie Sport/Geschlecht/Event Group, keine Anzeigenamen, Fragmente oder
Codex-Präfixe. Die gespeicherten Eventregeln selbst verwenden nur Competition-IDs.
Damit werden SS→BA, MO→DM und Snowboard→Freeski nicht als Titelübertragung akzeptiert.
Für unbekannte Katalogidentitäten sind Limits weiterhin konfigurierbar, Titelrechte
werden ohne nachgewiesenen Identitätsbezug nicht angeboten. Keine neue Startregel.

## Oberfläche und Abnahme

Der bestehende EventQuotaRulesEditor erhält eine kompakte Tabelle; Pooldefinitionen
und Titelquellen bleiben im selben Abschnitt. Die vorhandene Bestätigung wird
wiederverwendet. Vergleich und Fixierung zeigen die gespeicherten Sportparameter.
Eine reine Sportrevision behauptet keine Unterkunfts-Neubewertung. Eventwechsel
verwerfen verspätete Ladeantworten; Mobil kann nur die Tabelle horizontal scrollen.

Backend-HTTP-Tests: Entwurf/Fixierung/Revision/Audit, 31 Katalogeinträge einschließlich
26 Titelidentitäten, verschiedene Geschlechterlimits, deaktivierte Regeln, Team-
Ausschluss, Poolfehler, falsche Titel/Quellen/Editionen, Revalidierung bei Fixierung,
Event-Isolation und keine automatische Übernahme. Sieben anonymisierte Referenznationen
beweisen bei echten API-Sportrevisionen unveränderte Unterkunfts-Digests, Revisionen,
Fixierungsmetadaten, gespeicherte Previews, Fingerprints, Genehmigungen und Tarife;
identische Reimporte bleiben ohne neue Pflichtentscheidung möglich.

Frontendtests, Typecheck und Build; Desktop/Mobil mit anonymisierten simulierten APIs:
Quellenbestätigung, Limits, Pools, gespeicherter Entwurf, gesperrte fixierte Regeln,
Vorher/Nachher, Aktivierung einer Revision und unabhängiges zweites Event. Die
fachlichen Nachweise stammen aus den Backend-HTTP-Tests gegen isoliertes PostgreSQL.
Keine Originalmeldungen oder Browserfixtures werden veröffentlicht.

Nach diesem PR anhalten. Keine Umstellung der sportlichen Prüfung (PR 3), keine
neuen Freestyle-/Freeski-/Cross-Bewertungen und keine produktive Aktivierung.
