# KS282 — connected native hosting scope

This epic composes the delivered H01 (#292), protected H02 (#293), browser
starter H03 (#294), closed template/native budget H05 (#295), and portable
local generation/lifecycle H08 (#296). It adds one reproducible connected
observation, not a new deployment service or a collection of child PASS files.

## Actual delivered path

The owned runner starts actual Node 24.14.0 control and agent processes for two
local synthetic tenants, using exact pinned images with read-only current-source
overlays. A real Firefox browser uses verified TLS, protected origin/session
routing and non-admin starter controls. The same tenant-A control container
backs native template/budget observation, browser catalog provenance, H08 CLI
export, failed restores, native control restart onto the restored projection,
scoped tombstone/cleanup and retained-backup reacquisition. Browser origin
receipts, projection generations, native component/owner identities and direct
SQLite readbacks are correlated throughout.

The connected execution contains 25 cases, including wrong-key and wrong-
generation quarantine without activation, protected-source descendant refusal,
wrong-generation tombstone, premature/foreign-resource cleanup refusal, tenant
isolation, caller-role/free-command/free-URL/upload/admin denials, own reset,
actual business-value mismatch and killed-control UNKNOWN recovery. The original
qualified generation and declared backup remain byte-identical after denied
restores and scoped cleanup. A 390px browser observation checks containment; it
is not a human usability study. The frozen first business-value readback is not
promoted to success by status polling.

H05 uses the existing explicitly synthetic local HTTP response fixture, never a
vendor substitute or an assertion of vendor access. Actual native budget state
settles known usage, holds unknown usage across reopen without redispatch and
refuses exhaustion before dispatch. Model text does not grant commands, rights
or zero observed usage. Planning creates no activation authority. This budget
store remains separate from the exported H08 projection; the runner checks its
retention across control restart, not arbitrary-state portability.

## Reproduce the actual native path

Prerequisites: Docker access to the already qualified images
`sha256:b9829bd06c4dcd03b70ae9365058a95fb9fa9ef8cc9bf84f5890e2a02bf04e86`
(control) and
`sha256:8d36d93aa4c04bd1578432744df073a8d7963c415f628d79013cf32df25ed386`
(agent); Node 24.14.0; Python 3; OpenSSL; actual Firefox; the existing isolated
Firefox BiDi dependency workspace and NSS certutil; exact approved PAN529
shared-runtime source and PAN527 protected-session source. Missing prerequisites
are failures, not skipped native passes. Use only task-owned local resources.

From the exact clean source checkout, supply these existing local paths:

    export KS282_REPO="$PWD"
    export KS282_OUTPUT="/your-owned-evidence/new-unique-run"
    export TMPDIR="/your-owned-scratch"
    export KS282_BROWSER_WORKSPACE="/your-existing-locked-browser-workspace"
    export KS282_CERTUTIL="/your-existing-isolated-NSS-tools/bin/certutil"
    export KS_H05_PAN_SOURCE_ROOT="/your-exact-approved-PAN529-checkout"
    export KS293_PAN527_SESSION_SOURCE="/your-exact-approved-PAN527-checkout"
    python3 scripts/hosting/run-native-host-epic.py

When executing an anonymously downloaded extracted source archive, also supply
`KS282_SOURCE_COMMIT` and `KS282_SOURCE_TREE` from its separately verified exact
release/index binding. Those declarations do not themselves prove archive
identity or runtime rights. The native runner emits raw browser/native receipts,
direct state readbacks, the 390px screenshot and connected evidence binding. It
removes only its exact container/network owner labels and private transient
state, then reads back cleanup. Never use a global Docker prune.

## Evidence classes and public limits

The captured fixture in tests is an actual observed development trace, not a
new execution. The fail-closed evidence binder denies detached generation,
browser-origin, owner, phase and cleanup identities; it grants no runtime
authority. Fast binder tests are not a substitute for the native execution.

The independent Main 25-case native observation and its separate five-case
generation/owner/phase/cleanup correction retain their original scopes. Reuse
requires full frozen-source comparison and explicit reviewed deltas. A retained
execution is never labelled a new run. Published release evidence separately
binds the candidate, CI, merge, exact anonymous assets and downloaded product.

No rebuilt-image acceptance, arbitrary tenant/provider compatibility, production
provisioning, paid inference, vendor authentication, marketplace acceptance,
human investigation or external-backup erasure is claimed. Source overlays are
explicit. Backup erasure outside the owned local cleanup remains UNKNOWN.
