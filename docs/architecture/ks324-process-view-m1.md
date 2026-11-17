# KS324 M1: eine lesende Vorgangsansicht

## Tatsächlicher Produktpfad

Der bestehende lokale/self-hosted `bi-agent` bietet unter `/process-view` die
direkt aufrufbare Vanilla-HTML-Ansicht mit Logo, Farben und Layout dieses
vorhandenen UI-Pfads; keine neue UI-/Browser-/Runtime-Abhängigkeit. Die eingefrorenen
Bytes und cookie-freie Formularlogik der bisherigen Startseite bleiben unverändert;
kein Aufweichen des bestehenden H02-HTML-/CSRF-Guards für einen neuen Navigationslink.

Lesekette: Browser `POST /api/process-view` → bestehender Agent mit seinem
serverseitigen Control-Credential → `POST /v1/process-view/read` am bestehenden
`bi-control` → bestehender `InMemoryEvidenceStore` mit persistenter SQLite-Inbox,
`durableEvents()` und `processMetrics()`. Kein zweiter Speicher oder Produzent.

Der Hostoperator kann am Control-Prozess ausdrücklich
`KS324_PROCESS_INBOX_CONFIG_FILE` auf eine vorhandene private Ownerkonfiguration
setzen. Deren geschlossenes Objekt enthält nur `stateRoot`, die tatsächliche
bestehende `binding` und `maxEvents` (gleich den vorhandenen Owneroptionen).
`CONTROL_BIND_ADDRESS=127.0.0.1` ist für diesen Anschluss erforderlich.
Keine Bindung aus Browserflags, Abfrageparametern, Rollen oder Testdaten ableiten.
Die vorhandene Bindung muss dem bereits gespeicherten Inboxowner entsprechen;
eine fehlende Datei wird nicht als Ersatzinbox angelegt.

Für den tatsächlich nativen Single-Host-Start erhält nur der Agent-Prozess
`KS324_PROCESS_VIEW_CONTROL_PORT=<Control-Port>`. Der streng kanonische
Dezimalport 1..65535 wählt ausschließlich `127.0.0.1` und den festen bestehenden
Readendpoint; kein Client-URL/Host/Scope und keine allgemeine Proxyfunktion.
`CONTROL_BASE_URL=http://bi-control:18089` bleibt für die bisherigen Pfade exakt
verpflichtend. Die neue Option verändert weder Chat/Analyse/Discovery noch deren
Routepin. Ohne diese Option bleibt das bisherige Ziel unverändert; eine native
Host-DNS-Auflösung von `bi-control` wird NICHT vorausgesetzt oder eingerichtet.
Der alte transportadaptierte Browserlauf beweist nur Funktion, nicht Produktstart.
Die neuen Bootstrap-Tests und der ergänzende Browserlauf starten den Produktpfad
mit der expliziten lokalen Option ohne Fetchremapping/Preloader/Hostalias.

Beispiel nach Setzen eigener absoluter Variablen `REPO`, `OWNED_RUN`,
`OWNER_CONFIG`, `TOKEN_FILE`, `NODE` und freier `CONTROL_PORT`/`AGENT_PORT`:

```sh
# Control, eigenes Terminal; vorhandener Token und bereits initialisierter Owner.
env PORT="$CONTROL_PORT" CONTROL_BIND_ADDRESS=127.0.0.1 \
  CONTROL_TOKEN_FILE="$TOKEN_FILE" KS324_PROCESS_INBOX_CONFIG_FILE="$OWNER_CONFIG" \
  RECEIPT_DIR="$OWNED_RUN/receipts" PROJECTION_DB="$OWNED_RUN/projection.sqlite" \
  REPOSITORY_ROOT="$REPO/services/bi-control" BI_FIXTURE_DIR="$REPO/services/bi-control/fixtures" \
  BI_ENGINE=mssql BI_SOURCE_MODE=fixture KS_H03_STARTER_OPT_IN=false KS_H05_NATIVE_PROBE_OPT_IN=false \
  "$NODE" "$REPO/services/bi-control/src/server.mjs"
# Agent, zweites eigenes Terminal; anschließend http://127.0.0.1:<AGENT_PORT>/process-view.
env PORT="$AGENT_PORT" CONTROL_TOKEN_FILE="$TOKEN_FILE" \
  CONTROL_BASE_URL=http://bi-control:18089 KS324_PROCESS_VIEW_CONTROL_PORT="$CONTROL_PORT" \
  AGENT_ROUTE_PREFIX= LLM_MODE=stub KS_H03_STARTER_OPT_IN=false \
  "$NODE" "$REPO/services/bi-agent/src/server.mjs"
```

Am erreichbaren Control ergibt ein fehlender expliziter Owneranschluss UNCONFIGURED;
fehlende Konfiguration/Inbox ergibt MISSING. Das Produkt importiert oder befüllt
nichts automatisch. Der Präsentationsread öffnet den existierenden Owner zwingend
mit der einschränkenden Hostoption `readOnly: true`: kein mkdir, keine SQLite-
Initialisierung/Migration oder neue Binding, keine schreibende Transaktion.
Fehlende, leere, partielle, beschädigte und fremd gebundene Stores werden ohne
Schema-/Binding-/Datenänderung verweigert, statt neue EMPTY-Nullzahlen zu erzeugen.
Der bewusste bisherige Import-/Initialisierungsdefault bleibt unverändert;
Readonly-Append/Import wird verweigert. Aktuelle Leserechte und gespeicherte Bindung
werden erneut geprüft, tatsächliche WAL-COMMITs bleiben sichtbar (kein immutable-
Snapshottrick). SQLite kann bei gültigen WAL-Lesern Koordinations-SHM anlegen oder
Readmarks ändern; das ist keine behauptete Nulländerung aller Dateisystembytes.
Die uninitialisierten negativen Fälle bleiben vollständig unverändert.

## Autorität und Grenzen

Dies ist die vorhandene lokale Single-Host-Delegation mit dem vorhandenen
Control-Credential, keine neue Personen-/Session-/Tenant-Authority. Der Backendowner
prüft das aktuell gespeicherte Credential vor jedem Ownerread und vor Rückgabe.
Der Agent hält es ausschließlich serverseitig und prüft es nach dem Backendread
erneut. Clientfelder außer `phase` sind abgewiesen. Der lokale Agent verlangt
Loopback-Peer, lokalen Host und gegebenenfalls dieselbe Origin/Fetch-Site.

Der geschützte H02-/präfixgebundene Mehrbenutzerpfad erhält ausdrücklich KEINE
abgeleitete Leseberechtigung: dessen bisheriger Session-/Routenowner hat keine
Principal→Inbox-Readbindung. Er bleibt unverändert beschränkt; der Adapter lehnt
eine Präfixdelegation mit `AGENT_PROCESS_PROTECTED_BINDING_UNAVAILABLE` ab.
Diese Lieferung behauptet keine neue PAN-Sessionintegration oder Remote-Attestierung.

## Ein Stand, ein Vorgang

Der Readadapter liest bestehende Metriken, gespeicherte Events und erneut Metriken
mit den bestehenden aktuellen Ownerprüfungen. Der tatsächliche Eventsatz samt
voller Ownerbindung muss zu beiden `inputStateDigest` passen, sonst
`PROCESS_VIEW_STALE` ohne Zeilen/Zahlen. Mehrere Korrelationen ergeben ehrlich
UNAVAILABLE statt eines erfundenen zusammengeführten Vorgangs. Der Statusfilter
betrifft nur die Tabelle; sämtliche Zahlen bleiben am selben vollständigen
Eingabestand. Kein neuer Selektions-/Workflowowner.

Zeilen zeigen gespeicherte Beobachtung, Sequenz, Task/Step/Attempt/Ownerrevision,
Modus, Quellfaktdigest, vorhandene Sourcezeit sowie Proof-/Readback-/Kausalreferenzen.
Kein roher Eventpayload. Die drei bestehenden Metriken werden nicht neu berechnet:
aufgezeichnete Bestätigungen, separate UNKNOWN-Ausgänge und berichtete
Source-Append-Spannen. Formel, Einheit, Eingabestand, Quellen und Ausschlüsse sind
aufklappbar. Fehlende Dauer bleibt UNKNOWN, niemals null→0. Die Spanne ist keine
reale Ausführungs-, Menschen- oder Wallclock-Latenz. Sourcehead NOT_ATTESTED und
Prozess-/Human-/Grantfakten NOT_OBSERVED bleiben sichtbar.

## Browserverhalten und Nachweis

Loading/Fehler/Entzug entfernen vorherige Zeilen und Zahlen sofort. Eine
Generationsprüfung verhindert alte Antworten zusätzlich zu AbortController.
Die Tabellenregion ist per Tastatur fokussierbar und auf schmalen Fenstern mit
Pfeiltasten seitlich scrollbar. Native Filter, Fokusrahmen, Skiplink und Live-Status;
kein Lesen/Filtern/Öffnen erzeugt Fach-, Approval-, Grant-, Budget- oder Dispatchwirkung.

Alle neuen Beispieldaten sind ausdrücklich SYNTHETIC und werden ausschließlich
in Tests über den wirklichen bestehenden Import-/Persistenzowner bestätigt.
`tests/helpers/ks324-process-view-fixture.mjs` startet echte KS-Prozesse, kein
Antwortstub. Die kanonisch bereits registrierte `assistant-foundation`-Suite
prüft kohärenten Readback, tatsächliche SQLite-Änderung zwischen Reads, Entzug,
Mehrkorrelationsgrenze und echten HTTP-Pfad einschließlich Fremdscope/Origin.
Die bisherigen Regressionen bleiben unverändert als Dateipräfix erhalten.

Separater echter Browserlauf mit unabhängigem SQLite-/HTTP-Readback, unverändert
verzögerter echter Antwort, aktuellem Credentialentzug, Empty/Unconfigured/Missing,
Tastatur/Fokus und ausgeführtem Axe liegt im ausgeschlossenen lokalen Handoff.
Dieser Browserlauf ist kein neuer CI-Browserclaim. Es gibt keine neue Dependency
oder Änderung der vorgeschriebenen CI-Prüfungen.

Die neue reale PAN-Produzentenanbindung bleibt separat #321 / NOT_RUN. Historische
Belege, Sourcepins, bestehende Sicherheitsowner und Quellen-Nichtbehauptungen
werden nicht umgedeutet; weitere Dashboards und der Rest von #324 sind nicht enthalten.
