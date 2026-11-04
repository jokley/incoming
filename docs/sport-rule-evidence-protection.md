# PR 1: Unterkunftsevidenz vor reinen Sportrevisionen schützen

Basis: main e118f9e60370c267524b918a878bf42c0c7d9234, einschließlich #353/#354.
Keine Sportkonfiguration, keine Aktivierung, keine Migration und keine Datenübernahme.

## Ursache und kleinster Eingriff

Die bestehende Evidenz verwendet den gesamten Regel-JSON und die globale Revision.
Auch Fixierungszeit/-benutzer und der rohe Eventdatensatz gehören zum Import-State.
Nur einen JSON-Schlüssel aus einem Digest auszunehmen schützt weder EZ- noch
Familienquotengenehmigungen oder bereits geprüfte Change Plans vollständig.

Eine zusätzliche lesende Funktion im bestehenden quota_rules.py verwendet die
vorhandenen unveränderlichen EventQuotaRevision-Snapshots. Sie geht nur über
aufeinanderfolgende Revisionen zurück, deren Unterkunftsparameter und WM-Kennzeichen
identisch sind und bei denen der reservierte Bereich sportEntryRules beteiligt ist.
Am ersten tatsächlichen Unterkunftsunterschied endet die Suche. Ein späteres
Zurückstellen eines Unterkunftslimits darf keine alte Genehmigung wiederbeleben.

Die bisherige Unterkunftsrevision liefert ihren originalen JSON-Text, ihre Revision
und ihre Fixierungsmetadaten. Legacy-JSON wird weder normalisiert noch gespeichert.
Die Funktion verändert keine ORM-Objekte. Die vollständige administrative Revision,
Regelhistorie, Sperren und Audit bleiben unverändert. Unvollständige erforderliche
Sport-Revisionshistorie wird nicht durch ein geratenes altes Kontingent ersetzt.
Andere unbekannte Regelparameter werden nicht ausgeblendet.

## Begrenzte Aufrufstellen

- quota_rules: operative Unterkunftsregeln; administrative Gesamtprojektion unverändert.
- athlete_quota, quota_history, excel_import: derselbe bisherige Revisionsbezug für
  Familienquoten- und EZ-Evidenz; keine Änderung der Berechnungen oder Entscheider.
- imports/workflow und app: Review-Schutz, Anzeige veralteter Regeln und bestehender
  Recheck-Versionsvergleich verwenden die wirksame Unterkunftsrevision.
- imports/change_plan: nur vier Unterkunfts-Regelfelder der Eventzeile werden lesend
  aus der wirksamen Revision bezogen. Alle anderen Event-/Titel-/Personen-/Buchungs-
  Fakten bleiben geschützt. Die Eventzeile stammt weiterhin aus frischem Raw SQL;
  ein veraltetes ORM-Objekt darf echte Änderungen nicht verbergen.
- routes/events und quota_overview: operative Quotenansichten zeigen denselben Bezug.

Kein neuer Dienst, keine Tabelle, keine zweite Revisionierung, kein Frontendumbau.
Bei Revision 1 ohne Erweiterung entsteht keine zusätzliche Historienabfrage. Weitere
Revisionen werden je Request und unverändertem Regeldatensatz einmal aufgelöst;
keine SQL-Abfragen pro Person. Keine globale oder requestübergreifende Ablage.

## Abgrenzung zu PR 2/3

Der bestehende strikte Admin-Validator akzeptiert sportEntryRules weiterhin nicht.
Es gibt weder Schreib-API, Sporteditor, neuen Entwurfsstatus noch neue Sportlogik.
Die WM-2027-Prüfung samt Titeldatei und Wettbewerbsumfang bleibt unverändert.

Die später zulässige Erweiterung darf ausschließlich im reservierten Teil stehen;
das vorhandene Unterkunftsschema einschließlich schemaVersion bleibt unverändert.
Eine Änderung dieses Schemas oder des WM-Kennzeichens ist keine reine Sportrevision.
PR 2 muss die Sportparameter eigenständig validieren und unveränderliche vollständige
Snapshots über den bestehenden Aktivierungsablauf erstellen. PR 1 erlaubt dies noch
nicht. PR 3 darf diese Regeln erst danach lesen. Keine produktive Aktivierung.

## Reproduzierbare Tests

Neue Tests simulieren ausschließlich in der geschützten lokalen Testdatenbank
zukünftige Sportrevisionen mit Testplatzhaltern. Sie umgehen dafür ausdrücklich nur
innerhalb des Fixtures den weiterhin ablehnenden Admin-Validator; kein produktiver
Code kann diese Konfiguration über die bestehende API aktivieren.

Sieben anonymisierte Originalreferenzfälle: ITA/NZL/ISR/JPN/GER/KOR/USA, zusätzlich
historische Unterkunftsrevision 2 bei ISR/JPN. Explizit geprüfter Ausgangssnapshot,
zwei Sportrevisionen, unveränderte operative Quotenantworten, ursprüngliche Digests,
Revisionsbezüge, Fixierungsmetadaten, vollständiger State-Fingerprint, Eingabe-
Fingerprint, Approval-Evidenz, gespeicherte Versionen, Tarife und Buchungen.
Identischer Upload/Confirm ohne neue Pflichtentscheidung; vorhandene normale
Übernahme-Evidenz beim Reimport bleibt als solche nachvollziehbar.

Gegenproben: echte Familienlimit-/Officials-/EZ-Änderung bleibt reviewpflichtig,
Sportänderung nach echter Unterkunftsrevision referenziert diese neuere Grundlage,
Entfernen des reservierten Teils, WM-Kennzeichenwechsel, geschützte Historie,
Event-Isolation und frische SQL-Fakten trotz veraltetem ORM-Objekt.

Bestehende Freeze-, Genehmigungs-, Reimport-, Projektions-, Sport- und SQL-Budgettests
werden mitgeprüft. Frontendtests, Typecheck, Build und Browser-Smoke der unveränderten
CAN-/GER-/ITA-Ansichten auf Desktop/Mobil ergänzen die Backend-HTTP-Tests. Die Browser-
Fixtures sind anonymisiert und verwenden simulierte APIs; die fachlichen Nachweise
stammen aus den echten Backend-HTTP-Tests gegen die isolierte PostgreSQL-Datenbank.

Originalmeldungen werden nicht veröffentlicht. Keine produktiven Daten geändert.
Nach diesem PR anhalten: PR 2 und PR 3 sind nicht implementiert.
