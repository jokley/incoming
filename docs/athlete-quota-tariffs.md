# Personenbezogene Tarifwirkung von Athletenquoten-Genehmigungen

Basis: `main` b62ff73 einschließlich PR340. Keine Produktionszugriffe, Bestandskorrekturen oder Deployments.

## Befund

`athlete_quota.quota_rows()` berechnet Ausnahmeumfänge und bindet Genehmigungen an Event, Nation, Quotenfamilie, Regelrevision und Meldestand. Bisher war `approvedPersonKeys` optional. `validated_extent()` prüfte lediglich die Mengen und zulässige Personenschlüssel. Die Genehmigung war bewusst unabhängig von Unterkunftstarifen.

`accommodation_rates.apply_preview_rates()` übernahm bestehende Tarife oder ausdrückliche manuelle Overrides. `_apply_person_record()` schrieb nur solche Overrides. Daher blieben die Athleten trotz genehmigtem Umfang auf STANDARD. Aus einer alten Mengengenehmigung lässt sich keine sichere kostenpflichtige Personenmenge ableiten.

Das vorhandene Modell enthält keine strukturierten Unterkunftspreise oder berechenbaren Zuschlagsbeträge. `costCoverage` ist Freitext-Evidence, kein ausführbarer Preisvertrag. Es wird kein Betrag daraus geparst oder erfunden.

## Kleinster sicherer Verhaltenszusatz

Die bestehenden Athleten- und EZ-Workflows bleiben getrennt. Im Athletenentscheid wird ausdrücklich gewählt:

- `NONE`: keine automatische Tarifänderung. Dies bleibt der kompatible API-Standard, wenn ein alter Client kein neues Feld sendet.
- `SPECIAL_SELECTED`: ausdrücklich ausgewählte kostenpflichtige Zusatzathleten. Konkrete Personen sind verpflichtend.

Der Dialog erklärt vor dem Speichern Tarifwirkung, Herkunft, manuelle Priorität, überlappende Grenzen, fehlende Preisfestlegung und EZ-Unabhängigkeit. Die Bestätigung verwendet weiterhin denselben geschützten Approval-Endpoint und dieselben Berechtigungen/Transaktionssperren.

### Japan: 40 gesamt, 23 Männer

Grenzen 36 / 20 ergeben `total=4, M=3, F=0`. Die Auswahl umfasst genau **vier unterschiedliche Personen, mindestens drei davon Männer**. Nicht sieben. Allgemein ist die minimale Personenvereinigung `max(total, M + F)`; die explizite Auswahl muss die Geschlechterumfänge abdecken. Niemand wird aufgrund der Importreihenfolge kostenpflichtig ausgewählt.

Teilentscheidungen werden grenzbezogen gebunden (`approvedPersonKeysByBoundary`). Eine Person kann die Gesamt- und eine Geschlechtergrenze abdecken, an derselben Grenze jedoch nur einmal angerechnet werden. Die kumulierte Vereinigung der kostenpflichtigen Personen muss zu den kumulierten kostenpflichtigen Umfängen passen. Beispiel: zuerst Gesamt 2, danach Gesamt 2 / Männer 3; die zweite Auswahl darf eine bereits ausgewählte Person für die andere Grenze enthalten. So bleiben es vier kostenpflichtige Personen statt fünf. Mengen werden weiterhin durch die bestehende Quotenbewertung getrennt genehmigt; keine Quotenformel wird geändert.

Verschiedene Familien können dieselbe ausdrücklich ausgewählte Person enthalten. Ihr personeneigener Tarif wird einmal SPECIAL, nicht pro Familie oder Grenze mehrfach verrechnet. Es wird überhaupt keine Geldabrechnung eingeführt.

## Datenfluss und Herkunft

1. `validated_extent()` prüft weiterhin Ausnahmeumfang und Kandidaten; zusätzliche Tarifvalidierung prüft die ausdrückliche Auswahl und deren Gender-Evidence aus dem aktuellen serverseitigen Prüfstand.
2. `bind_tariff_selection()` bindet die Teilentscheidung an die noch nicht verwendeten Grenzen und prüft die gemeinsame Personenvereinigung. Eine gebündelte Abfrage, kein Kandidaten-N+1.
3. Das bestehende `ImportApproval.quota_details_json` speichert Tarifwirkung und Grenzbezug. `approved_person_keys_json` enthält die explizite Auswahl. Keine zweite Approval-Tabelle.
4. `project_preview()` nutzt ausschließlich die bereits geladenen, anwendbaren und nicht supersedierten Athletenquoten-Genehmigungen. `project_tariffs()` leitet SPECIAL nur für ausdrücklich ausgewählte Personen ab. Ungültige personenbezogene Evidence blockiert die Prüfung.
5. Die Personen-Importvorschau zeigt Sondertarif, Ursache, Genehmigungsnummern und „Preisliche Festlegung offen“. Alte mengenbezogene Genehmigungen erhalten einen einmaligen Hinweis; keine massenhaften Personenzuweisungen.
6. Der vorhandene Änderungsplan erfasst die Tarifänderungen. Confirm berechnet erneut serverseitig, prüft Plan und Evidence und speichert erst dann den Tarif auf `Athlete` mit Quelle `APPROVAL` und `accommodation_rate_approval_id`. ImportSessionEvent dokumentiert die Übernahme.
7. `rate_projection()` gibt die Genehmigungsreferenz in den bestehenden Personen-DTOs mit aus. Bei mehreren anwendbaren Genehmigungen zeigt die Vorschau alle IDs. Persistiert wird eine deterministische primäre Referenz; sämtliche Einzelgenehmigungen und Grenzzuordnungen bleiben in der bestehenden Historie erhalten.

## Manuelle Entscheidungen, Historie und Reimport

- MANUAL hat immer Vorrang, einschließlich bewusst manuellem STANDARD. Die Vorschau erklärt den Konflikt zur vorgesehenen Genehmigungswirkung; sie überschreibt die Entscheidung nicht. Eine abweichende Preisvereinbarung muss der Operator ausdrücklich klären.
- Eine neue manuelle Tarifentscheidung entfernt die aktive automatische Referenz; die Genehmigung und historische Import-/Audit-Evidence bleiben erhalten.
- Alte Genehmigungen ohne `tariffEffect` bleiben reine Evidence. Ein gezieltes Überarbeiten erzeugt über den bestehenden Mechanismus eine neue Genehmigung/Reviewversion. Der historische Datensatz bleibt unverändert.
- Eine Genehmigung allein schreibt keine bereits importierten Personen um. Auch eine ausdrücklich revidierte Tarifwirkung wird erst beim geprüften Confirm übernommen.
- Identischer Reimport erhält die anwendbare Auswahl und Herkunft. Geänderter Meldestand oder Regeln erben keine neue Quotengenehmigung. Bereits gespeicherter SPECIAL wird aus Bestandsschutz nicht automatisch zurückgesetzt; die Vorschau verlangt Prüfung seiner Anwendbarkeit im neuen Meldestand. Das ist keine Weitergabe alter Quotenfreigabe.
- Event-/Nationen-/Familien-/Roster-/Regelrevision-Scope bleibt maßgeblich. Eine Genehmigung in Event A erzeugt keinen Tarif in Event B.
- NO_ROOM, countsAsSingle, EZ-Status und APPROVED_EXTRA werden nicht geändert. Die vorhandene Mehrpreisanzeige folgt weiterhin SPECIAL_RATE bzw. genehmigter EZ-Mehrpreis; bei NO_ROOM bleibt Mehrpreis nicht anwendbar.

## Migration 20261026_01

Nur `athlete` wird erweitert:

- nullable Fremdschlüssel `accommodation_rate_approval_id` auf bestehendes `import_approval`, mit Index;
- Erweiterung des vorhandenen Quellen-Checks um `APPROVAL` (passt in bestehendes String(10)).

Keine Daten-Updates oder Backfills. Alle bestehenden Kategorien, Quellen, IDs, Genehmigungen und operativen Daten bleiben erhalten. Kein DEFAULT wird in APPROVAL umgewandelt. Der Downgrade bricht ab, sobald neue Herkunft oder Referenzen verwendet wurden; er entfernt dann keine Evidence.

**Noch nicht produktiv ausgeführt.** Vor Deployment: Backup und Restoreprobe, offene Reviews dokumentieren, Schema zuerst kontrolliert migrieren, dann kompatible Anwendung starten. Neue FK-Spalte und zusätzliche Review-Evidence verändern den Schema-/Prüfstand: offene Altprüfungen nötigenfalls ausdrücklich erneut prüfen und freigeben; keine Stale-Prüfung abschalten und keine automatische Freigabe. Bei Rückfall neue Herkunft/Referenzen behalten; kein destruktiver Downgrade nach Nutzung, sondern Betrieb kontrolliert sperren und korrigierte Anwendung bereitstellen.

## Geänderte Bereiche

- Backend: `accommodation_rates.py`, `athlete_quota.py`, neues `athlete_quota_tariffs.py`, `app.py`, `excel_import.py`, `imports/change_plan.py`, `models.py`, additive Migration und neue Regressionstests.
- Frontend: bestehender `OperationsDecisionDialog` und `DataImport`, kleines `AthleteTariffSelection` samt Provenienzanzeige, bestehender Task-Adapter und DTO-Typen. Historische Kandidaten erhalten ihre Gender-Anzeige aus dem aktuellen Preview, ohne gespeicherte Historie zu ändern.
- Keine Änderung an EZ-Allokation, Quotenformeln, RoomBookings, Coverage, Preisberechnung oder Importidentität.

## Prüfung

Testziel ausschließlich die gesicherte lokale PostgreSQL-Testdatenbank und eine zusätzlich isolierte synthetische Browserdatenbank.

- Vollständiges Backend: **933 Tests und 1.304 Untertests erfolgreich**, keine übersprungenen Tests. Vorhandene reale JPN-Originaldateien wurden den bestehenden Import-/Reimportregressionen über die vorgesehenen Umgebungsvariablen bereitgestellt.
- 15 neue Abnahmefälle: Japan 40/36 und Männer 23/20, korrekte Vier-Personen-Vereinigung, Genderauswahl, Teilgenehmigungen einschließlich grenzübergreifender Überschneidung, Ablehnung aufgeblähter/kumuliert doppelter Auswahl, Confirmblockade bei offenem Rest, Herkunft und Persistenz, manueller STANDARD-Override, historische Evidence, ausdrückliche Revision nach Import, geänderter Meldestand, Event-Isolation, mehrere Familien, NO_ROOM/EZ-Unabhängigkeit, additive PostgreSQL-Migration und geschützter Downgrade.
- Abschließender gezielter Lauf: **18 erfolgreich**, einschließlich der bestehenden Import-Performancebudgets. Preview/Recheck <80 SQL-Statements, Confirm <160 und höchstens sechs Flushes bleiben eingehalten. Keine neuen per-Person-Queries; Tarifprojektion nutzt die ohnehin geladenen Genehmigungen.
- Frontend: **187 erfolgreich**, Typecheck und Produktionsbuild erfolgreich. Ein bestehender Erwartungstext wurde auf die nun ausdrücklich wählbare Tarifwirkung aktualisiert; keine Tests deaktiviert.
- Backup: **32 Tests plus 14 Untertests erfolgreich**, einschließlich Migration-Runtime-Verpackung. Keine Backup-/Restoreaktion gegen Produktion.
- Chromium: echter Upload eines **synthetischen** JPN-Workbookpaars mit 40 Athleten / 23 Männern in eine eigene lokale Testdatenbank, Entscheidung mit vier ausgewählten Personen gespeichert, genau vier SPECIAL-Vorschauzeilen mit Genehmigungsherkunft und offener Preisfestlegung. Desktop und schmaler Entscheidungsdialog geprüft, keine Browserfehler. Die Browserfixture ersetzt nicht die echten JPN-Dateien; diese laufen separat in der Backendregression.
- `git diff --check` erfolgreich.

## Verbleibende Grenzen für die Abnahme

- Keine Geldberechnung oder Rechnungsstellung. SPECIAL ist die bestehende Tarifkategorie; ein konkreter Zuschlag muss fachlich vereinbart werden.
- Alte Mengengenehmigungen werden niemals allein durch diesen Rollout kostenpflichtigen Personen zugeordnet. Für den vorhandenen Japan-Entscheid ist eine ausdrückliche, personenbezogene Revision und anschließend ein überprüfter Import nötig.
- Manuelle Abweichungen bleiben bewusst erhalten. Bereits gespeicherte genehmigte Tarife werden bei geänderter oder zurückgenommener Evidence ebenfalls nicht automatisch zurückgesetzt; der Prüfhinweis verlangt gegebenenfalls eine bewusste manuelle Tarifkorrektur. Historische Preisentscheidungen werden damit nicht stillschweigend widerrufen.
- Bei mehreren Genehmigungen bleibt eine primäre FK-Referenz am Personenstamm; die vollständige Zuordnung ist über Vorschau und unveränderte Approval-Historie nachvollziehbar.
- Produktive Migration, Merge und Deployment wurden nicht ausgeführt.
