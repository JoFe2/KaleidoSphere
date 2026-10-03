# K01 — begrenzter erlaubter Aggregat-Nachfolger (#283)

Der alte KS248-Paarvergleich bleibt unverändert `EVALUATED_WITH_FALSIFIED_REUSE`/NO_GO: Die freigegebene Aggregataufgabe wurde dort `UNSUPPORTED_MODE`/`KS247_PAIRED_CLI_SCOPE_DENIED` statt berechnet. K01 ersetzt weder diesen Gegenbeleg noch den Voll-Daten-Paarpfad. Das ist ein neuer, auf eine ausdrücklich synthetische Quelle und genau eine Aufgabe begrenzter Produktausführungspfad.

## Tatsächlicher Einstieg

Voraussetzung: qualifizierter Linux-Host mit Node 24 und `/usr/bin/bwrap`, verfügbare User-/Mount-/PID-/Netzwerk-Namespaces. Fehler beim Aufbau führen zu DENIED; kein Skip und kein unisolierter Fallback. CI führt diesen Pfad zwingend aus. Die getrennte ursprüngliche PGlite-Rootbindung wird nicht verändert; der Aggregat-Candidate benötigt und sieht keine Datenbankengine.

    node scripts/run-permitted-aggregate-journey.mjs \
      --input examples/business-bi/k01-permitted-period-aggregates-v1.json

Das öffentlich synthetische Beispielpaket wurde aus `source-pay-feed-v1.json` vorbereitet. Die operatorseitige immutable Freigabe bindet die gesamte kanonische Aggregatform, nicht nur selbstbehauptete Quellmetadaten: SHA256 `123eaf9ae8d773dbef5272443226abfa3dd8b7627b12242c0c070c7739a9c75b`. Quelle `synth_x.pay_feed`, Revision `synthetic-unfamiliar-source-v1`, Source-SHA256 `56724bfa95e66d8b61a837e82098aeee67ad430434794da944d033d61dd9737e`; Operation `bi-ks-01-net-revenue/v1`, EUR-Minorunits, INCLUDE_BOUNDARY_DATES, Juni/Juli 2026. Es ist kein allgemeiner Upload-/Signatur-/Quellenfreigabedienst und keine Autorität für andere Quellen oder Aufgaben.

Der Candidate rechnet die beiden Nettoperioden und ihr Delta ausschließlich aus den erlaubten Verkaufs-/Gutschriftaggregaten. Test/Oracle berechnen unabhängig direkt aus der eingefrorenen Rohfixture. Der reale Sollabgleich liefert 30000 / 100059 / 70059 Minorunits; UNKNOWN-Zeilen werden separat erhalten und nicht als Null oder Fachbestätigung ausgegeben. Zahlen stimmen nur für diese gebundene Aufgabe, nicht für ein neues Geschäftsmodell oder beliebige Mandanten.

## Informationsgrenze und Verweigerung

Der vertrauenswürdige Einstieg prüft angeforderte Modi vor dem Öffnen des Aggregatinputs. Input wird über genau einen nichtfolgenden/nichtblockierenden regulären Filedeskriptor gelesen, auf 16 KiB begrenzt und gegen den festen operatorseitigen Aggregatdigest geprüft. Kein Caller-Rollenfeld kann neue Autorität erzeugen.

Der Candidate ist ein anderer tatsächlicher Prozess mit leerer privater Mountnamespace, ausschließlich read-only Codeclosure und zulässigem Aggregat auf stdin. Checkout, Fixtures, Erwartung/Oracle, Home, Credentials und Legacy-Vollpfad werden nicht eingeblendet. Der tatsächlich verwendete Node-Binärpfad wird separat read-only als `/runtime/node` gebunden, auch bei Hosted-Runnern außerhalb `/usr`. Eigene PID-/Netznamespace, bereinigte Umgebung, neue Session, die-with-parent und read-only Root sind explizit gesetzt. Bubblewrap ist ein Namespace-Werkzeug, kein fertiges universelles Sicherheitsprofil; die Schutzbehauptung hängt am konkreten Launcher und seinen echten Gegenproben.[1]

Reproduzierbare eng begrenzte Negatives:

    node scripts/run-permitted-aggregate-journey.mjs \
      --input /nonexistent-k01-input --access-mode METADATA_ONLY
    node scripts/run-permitted-aggregate-journey.mjs \
      --input examples/business-bi/k01-permitted-period-aggregates-v1.json --drilldown
    node --test tests/permitted-aggregate-journey.test.mjs

Quell-ID, Revision oder Digest passen nicht: `K01_SOURCE_DENIED`; falscher Modus: `K01_PROFILE_DENIED`; manipulierte Aggregatform/-werte, zusätzliche Raw-Felder oder Caller-Rollen: `K01_APPROVED_PACKAGE_DENIED`; unzulässiger Inputtyp/-budget: `K01_INPUT_DENIED`; unbekannte Optionen, Drilldown oder technische Nichtausführung: `K01_ENTRY_DENIED`. Jeder Denial enthält `numbers=null`, weder Callerpfade noch Rohwerte/Subprozessstderr. Ein Denial ist kein berechnetes Ergebnis oder impliziter grant.

Die registrierte Suite öffnet vor ihrer echten Namespaceprobe nachweislich existierende Raw- und Oracle-Dateien im stärker informierten Elternprozess, verweigert im exakt gleichen Launcher deren absolute, `/app`- und `/proc/1/root`-Wege und prüft bereinigte Umgebung. Der echte Candidate läuft zusätzlich positiv mit unabhängiger Zeilenrechnung. Die Suite ist genau einmal über `tests/source-map.test.mjs` unter den unveränderten kanonischen npm-Testroots registriert; das Topologiegate prüft diesen Pfad. Original C2-Whitelist, Metricplan und historischer Evaluator bleiben byteidentisch.

## Originalkriterien und Grenzen

- AC1: Die historische Paar-Baseline Main2677dbe/Tree4cbf9903 mit Producer d8e78430 und unverändert qualifizierter `.ks-journey-runtime` wurde am 3. Oktober 2026 wirklich erneut ausgeführt: EVALUATED_WITH_FALSIFIED_REUSE, Aggregat FALSE_REFUSAL, kompletter Datenpfad separat CORRECT_ACCEPTANCE. Diesen alten Vergleich nicht auf ACCEPTED umschreiben.
- AC2: Neuer echter isolierter Einstieg, vorbereitete erlaubte Aggregatform, drei unabhängig abgeglichene Sollzahlen.
- AC3: Raw-/Oracle-Informationsgrenze durch reale Mount-/PID-Namespace und echte Read-Gegenproben, nicht Berichtsausblendung.
- AC4: Scope, gesamte Quellenidentität, Manipulation/Caller-Rollen und Drilldown fail-closed ohne Rechtserweiterung.

Nicht behauptet: allgemeine Mandantentrennung, beliebige bwrap-/OS-/Nodekombinationen, private/produktive Quelle, neuer PAN-Producervertrag, SQL-Einzelzeilenrechte, freier SQL-Compiler, 24-Zahlen-Vollpaarlauf, Modellantworten oder gemessene Überlegenheit, Human-Effort-Studie, Sourcepermission für KS250, Marketplace-Annahme oder Produktionswirkungen. Diese Dokumentation und lokale Tests ersetzen nicht unabhängige fokussierte Abnahme, Pflicht-CI, Merge, neuen funktionalen Release und anonym ausgeführtes Downloadprodukt; CLOSED gilt erst nach diesen externen Liefergates.

Rückfall: neuen Aggregat-Einstieg nicht verwenden bzw. deaktivieren; letzter qualifizierter Release und historischer negativer Vergleich bleiben erhalten. Keine fremden Testressourcen entfernen.

## Sources

[1] Bubblewrap upstream README, Sandbox security / Usage / Limitations, https://github.com/containers/bubblewrap/blob/main/README.md (abgerufen 3. Oktober 2026).
