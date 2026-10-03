# K01: eng begrenzte Hosted-Runner-Qualifikation

## Beobachteter Fehler, keine Ursachenbehauptung aus Vermutung

Der reale PR297-Diagnoselauf 37122069850 für Commit `e174048a90f3dd97067836b9d2df8fba4b9c6cc4` läuft auf Ubuntu 24.04.5, Image 20260927.320.1, Node 24.21.0 und Bubblewrap 0.9.0-1ubuntu0.3. Vor jedem Candidate-Lauf scheitert der Namespaceaufbau mit `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`, Status1, kein Signal. Das ist ein beobachteter Fehler des privaten Loopback-Bootstraps, kein falscher Zahlenoutput und kein abgeschlossener K01-PASS.

Der gleiche 0.9.0-Binary wurde task-privat aus dem gegen den Ubuntu-Paketindex digestgeprüften Paket ausgepackt und auf dem lokalen qualifizierten Kernel mit dem unveränderten Sandboxkommando erfolgreich ausgeführt. Das grenzt einen generellen 0.9.0-Flag-/Binaryfehler aus; die konkrete Hosted-Kernel-/AppArmor-Umgebung bleibt zu qualifizieren. Kein Paket wurde auf dem Nutzerhost installiert und keine dortige Policy geändert.

## Enger Setup-Delta, nicht neue Datenberechtigung

Ubuntu vermittelt user-namespace-Operationen zusätzlich über AppArmor.[6] Das AppArmor-v4.0.1-Upstream-Muster für Bubblewrap erlaubt die zum Bootstrap benötigten Fähigkeiten und stapelt anschließend ein Profil ohne Fähigkeiten auf sämtliche Kinder.[5] Die hier verwendete repository-eigene Policy übernimmt dieses Muster mit zwei eindeutigen Namen, ohne `flags=(unconfined)`, ohne lokale Include-Erweiterungen und ohne Änderung anderer Profile. `audit deny capability` gilt für das gestapelte Kindprofil.[5]

Die beiden Profile werden ausschließlich im flüchtigen GitHub-hosted-Linux-CI-Job geladen. Der Job verweigert Self-hosted-Ausführung dieses Setups, liest die drei relevanten vorhandenen Kernel-Schalter vor/nach dem Laden und verlangt Bytegleichheit ihrer Werte sowie den Enforce-Modus beider eigenen Profile. Kein Sysctl wird geschrieben, AppArmor wird nicht deaktiviert und kein anderer Profilbestand neu geladen.

Die eigentliche Produkt-Sandbox und ihre freigegebenen Dateien bleiben unverändert: `--unshare-all`, private PID/Net/IPC/User-Namensräume, read-only Mounts, leere Umgebung, ausschließlich genehmigtes Aggregat-stdin. Es gibt weder `--share-net` noch eine Variante ohne Isolation. MAC-Erlaubnisse ersetzen keine Linux-Fähigkeiten im Host-Namensraum und keine Dataset-/Operation-/Werte-/Callerberechtigung; die Candidate-Kinder sind gerade von Fähigkeiten ausgeschlossen. Die vorhandenen tatsächlichen Raw-/Oracle-/Fallback-Lese-Gegenfälle und Capability-Denials bleiben Pflichtprüfungen.

Diese Datei ist ausdrücklich keine Installationsanweisung für Nutzer-, Self-hosted- oder Produktionssysteme. Außerhalb qualifizierter vorhandener Namensräume bleibt das Produkt fail-closed. Ein Loader-PASS oder Offline-Parser-PASS allein ist keine Laufzeitqualifikation: erforderlich bleiben echter Hosted-Candidate, die registrierten positiven/negativen Suitefälle, vollständige CI, Merge, Release und anonyme Produktausführung. Das historische KS248-NO_GO bleibt unverändert, ebenso alle Nichtbehauptungen zu Human-Effort, nativen Modellen, Plattformannahme und echten neuen Privatquellen.

Die Policy ist eine eigene CI-Konfiguration nach dem dokumentierten Upstream-Design, keine Übernahme zusätzlicher lokaler/site-spezifischer Berechtigungsfragmente.

## Sources

[5] https://gitlab.com/apparmor/apparmor/-/raw/v4.0.1/profiles/apparmor/profiles/extras/bwrap-userns-restrict — apparmor-upstream-bwrap-v4
[6] https://discourse.ubuntu.com/t/understanding-apparmor-user-namespace-restriction/58007 — ubuntu-userns-official
