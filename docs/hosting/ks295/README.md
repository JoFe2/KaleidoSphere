# KS-H05: native Entwicklungsintegration

Kandidatenstatus: eigene native KS-Persistenz, gemeinsamer Broker, geschlossene
servereigene Templates und opt-in authentifizierter Produktpfad ausgeführt.
Der native Collector-/Template-/Budget-Paartest und die optionale isolierte
Dockerdistribution sind getrennte Nachweise. Keine produktive Aktivierungs-
freigabe; dieser Kandidatenstand allein ist kein vollständiger Lieferabschluss.

## Unveränderte gemeinsame Quelle

Der importierte Entwicklungsdescriptor liegt unter
`contracts/dependencies/pan529-runtime-budget-development-v1.json`.
Seine SHA-256 ist
`4f8ed30d2446639fa4f3b28589a8c9ef362ca8b1083f702fabcc40d22b887255`.
Descriptorcommit: `28e72f72493e814582208cd9ab871ccba1f8a3f7`.
Sourcecommit: `6be212953b2cb52f46347e10132d13b95f881f29`.
Sourcetree: `3b8d7b6b5f29fe4b0736a00d3db5dd380bfefcef`.

Der Owner hält einen unveränderten exakten Checkout mit tatsächlich gebauter
Contractausgabe. Der Loader qualifiziert 11 Sourceclosure-Dateien, 159
kompilierte Contractdateien und 537 bereits in der H01-Dependencybindung
bytegebundene Ajv-/Transitivdateien. Er importiert eine private Kopie der
reinen Contracts, nie einen racebaren Caller-Modulpfad. Keine automatische
Netzwerkakquisition, neue Sourceberechtigung oder Runtimefreigabe.

`nativeStoreBinding` im PAN-Descriptor gilt ausschließlich für den PAN-Owner.
Der KS-Loader importiert nicht `createResourceBudgetStoreV1`. Die KS-Datei
`ks295-resource-budget.sqlite` gehört zur eigenen Persistenzimplementierung
`h05-native-resource-store.mjs`. Sie baut ihre eigenen Beobachtungsreceipts
mit unveränderter `makeCcpCostBudgetV1`-Semantik und den Identitäten
`repository:kaleidosphere`, `ledger:ks295-native`,
`contribution:ks295-runtime`. Kein Umbenennen eines PAN-Receipts und keine
unabhängige Runtimequalifikation aus diesen Metadaten.

## Ausgeführter lokaler Produktpfad

Die vorhandene bi-control-Authentisierung schützt auch:

- `POST /v1/runtime/model-probe`: canonical model request, unveränderter
  gemeinsamer Broker, echter lokaler synthetischer HTTP-Provider, eigene
  persistente Reservierung und geprüfte native Wire-Usage.
- `GET /v1/runtime/budget`: eigene CCP-Budgetbeobachtungen, kein Grant.
- `GET /v1/runtime/template`: gehaltene servereigene gemeinsame Vorlage.
- `POST /v1/runtime/plan`: geschlossene Auswahl, verständlicher Diff, kein
  Ledger, Provideraufruf, Effekt oder Grant. Vor templategebundenen Proben
  ist der exakt gehaltene Plan erforderlich; nach Neustart erneut planen.

`KS_H05_OWNER_CONTEXT_ROOT` wählt ausschließlich eine private Ownerdirectory
mit `operator-held-context.json`. Nur validierte gehaltene H01-Metadaten,
keine Client-READY-Aussage. UID-/Modus-/Dateityp-/No-follow-/Frameprüfungen
schützen diesen Offlinekanal. Die Bindung erteilt keine neue Zielqualifikation.
Die unveränderte gemeinsame Ressourcenklasse begrenzt Request- und Reservelimits;
Schema-/Command-/URL-/SQL-/Rights-/Policyextras scheitern vor Deferred-Startup.

Default: deaktiviert. Aktivierung dieses Entwicklungs-Probewegs erfordert
`KS_H05_NATIVE_PROBE_OPT_IN=true` und `CONTROL_BIND_ADDRESS=127.0.0.1`.
Nur ein lokaler synthetischer Provider; keine Paid-Provider-Credentials.
Die expliziten Ownerparameter sind `KS_H05_PAN_SOURCE_ROOT`,
`KS_H05_NATIVE_STATE_ROOT`, `KS_H05_SYNTHETIC_BASE_URL`,
`KS_H05_MODEL_UNITS` und `KS_H05_RUNTIME_UNITS`.
Sie sind keine Client-/Agentenfelder. Der State-Root muss dem laufenden
Owner gehören und privat sein. Die Limits sind positive begrenzte
Integer-Einheiten; keine geschäftliche Preislogik.

Die optionale Distribution verwendet `services/bi-control/Dockerfile.h05-native`;
das bestehende Default-Dockerfile bleibt unverändert. Gepinnte Node-24.14.0-
Base, exakte bereits gebaute PAN529-/PAN526-Buildcontexts, UID10001 und eigene
KS-Statevolume. SDK-/SQLiteprüfung und authentifizierte Produktprobe wurden
im tatsächlich gebauten Image ausgeführt: network none, read-only Root,
cap-drop ALL, no-new-privileges, private UID10001-Tmpfs. Der unabhängige
Imageprobe-Readback bindet dieselben Image-, Script- und Specdigests.

Die portable Probe liegt in `scripts/hosting/h05-native-image-product.mjs`.
Sie liest die gehaltenen privaten Owner-Metadaten auf stdin, erzeugt nur einen
flüchtigen synthetischen Authcanary und testet im isolierten Image. Sie ist
kein Datenerzeuger, keine neue Target-Readiness und keine Paid-Providerprobe.
Das bestehende Owner-Metadateninput wird nicht im öffentlichen Paket abgelegt.

## Nachgewiesene Lebenszyklusgrenzen

Vor dem Provideraufruf ist `UNKNOWN_USAGE` dauerhaft persistiert.
Identische gleichzeitige Requests teilen eine Dispatchausführung; eine
geänderte Requestbindung wird abgelehnt. Ein frischer Prozess darf eine
ungeklärte Operation nicht nochmals senden. Reserven bleiben gehalten;
Nullwerte in ungeklärten Consumption-Spalten sind kein Beweis von Nullusage.

Abgerechnet werden nur die tatsächlich beobachteten Integer-Wirewerte nach
gemeinsamer Responseprüfung. Modelltext wie APPROVED, claimed usage zero,
Policyänderung oder Freigabe ist keine Autorität. Owner-Completion- und
Settlementfähigkeiten werden nicht als Agenten-/HTTP-API exportiert.
Ein erledigter Replay liefert die ursprüngliche native Accountingbindung
als `SETTLED_REPLAY`, keinen neu erzeugten Modellantworttext und keinen
weiteren Provideraufruf.

Der ursprüngliche Producer-RED für `structuredOutput:null` ist erhalten.
Ein tatsächlicher fehlerhafter Adaptationspfad wird in diesem Consumer vor
Reservierung/Dispatch fail-closed abgelehnt; dies ist keine PAN-Producerfix-
oder allgemeine Nullformat-Supportbehauptung.

## Ausgeführte Prüfung und verbleibende Liefergates

`KS_H05_PAN_SOURCE_ROOT` verweist für die echten Tests auf den qualifizierten
exakten, tatsächlich gebauten PAN-Checkout. Keine Policy-/Budget-/SQLite-
Mocks; Providerantworten sind ausdrücklich synthetisch.

Die vollständige fokussierte Native-/Template-/H01-Kontext-/HTTP-/Specialist-
Regression vor CI-Registrierung: 56 PASS, 0 FAIL, 0 SKIP. Der exakte neue
CI-Akquisitionsshell wurde separat lokal ausgeführt: 21 PASS, 0 FAIL, 0 SKIP,
alle elf H05-Suites, öffentliches exaktes Git/build und keine Skipoption.
Dies ist noch keine gehostete CI. Unterschiedliche Primitive-, Export-,
Service-, Collector- und Image-Scopes werden nicht zu einer erfundenen
Gesamtabnahme addiert.

Tatsächlicher Produktserver: unauthorized 401 ohne Provider-POST; erster
SETTLED und 100 spätere identische HTTP-Replays bleiben ein Provider-POST;
Schema-/Rights-/Policyextras werden ohne zusätzliche Reservierung abgelehnt.
100 parallele unterschiedliche HTTP-Reservierungen: 10 angenommen,
90 budgetbedingt abgelehnt, 10 tatsächliche lokale Provider-POSTs.
Direkter SQLite-Readback vor Antworten: 10 UNKNOWN, gehalten 640/10;
nach geprüfter Completion: 10 SETTLED, verbraucht 20/10.
Ein echter Controlprozessneustart hält missing-usage 64/1 ohne Redispatch.

Der frische native Collector-Paartest bindet tatsächliche Zielidentität,
Readiness `state: READY`, servereigene Vorlage und native KS-Reservierung:
ein Provider-POST, direkter SQLite-Readback eine Zeile mit Modellverbrauch5
und Laufzeitverbrauch1, Replay ohne neuen POST, Businessreadback unverändert.
Das separate Image-E2E mit bestehenden Owner-Metadaten beobachtet zwei POSTs,
SETTLED-Verbrauch5/1 und eine UNKNOWN-Reserve64/1. Nach echtem Prozessneustart
bleibt UNKNOWN unverändert und redispatcht nicht. Dies ist ausdrücklich
keine neue physische Target-Readiness aus den Owner-Metadaten.

Der ursprüngliche Service100-RED am 10s-Harnessdeadline enthält zehn POSTs
und 86 richtige Budgetdenials, nicht Null-Dispatch oder beobachtete
Überziehung. Eine separate Timingprobe beobachtete die vollständige
10/90-Barriere nach12086ms und alle Antworten nach12159ms; die unveränderte
20s-Requestgrenze,100Attempts und Pre-response-SQL640/10 bleiben erhalten.
Der Test beobachtet die Barriere nun innerhalb dieser bestehenden Grenze.
Originale Fehlercaptures bleiben erhalten, Guards/Limits unverändert.

Für den Lieferabschluss müssen vollständige Canonical-/Pflicht-CI-/SHA-PR-/
Merge-/neue Release-/anonyme exakte Artefaktprodukt-Readback-/Closuregates
zusätzlich erfüllt sein. Kein Main-Freigabe- oder reciprocal CLOSED-Wartegate.
