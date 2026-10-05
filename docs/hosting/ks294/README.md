# KS-H03 · bounded synthetic browser starter

This optional KaleidoSphere starter runs two distinct existing product paths:

- Catalog: the actual bundled synthetic MSSQL metadata analysis, persisted local analytical generation, and catalog question for dbo.customers / dbo.orders.
- Metric: the existing granted invoice-date O2C CLI for COMMON-TRADE-01, 2026-06-01 inclusive through 2026-08-01 exclusive. The independently held expected aggregate is 90000 EUR_MINOR; the actual calculation must match it.

No PANSPHAIRA process journey, alternative metric engine, customer database, model invocation, production booking, upload, arbitrary URL or shell endpoint is added.

## Product boundaries

The agent and control default remain unchanged. The optional agent page requires KS_H03_STARTER_OPT_IN=true and an existing protected /t/<tenant> prefix. The actual HTTPS browser ingress is the previously delivered H02 origin/session/CSRF implementation; the browser never sees an internal control token. Both reader and reviewer remain non-admin contexts under that existing boundary.

The optional control additionally requires CONTROL_BIND_ADDRESS=127.0.0.1, BI_SOURCE_MODE=fixture, BI_ENGINE=mssql and these operator-owned bindings:

    KS_H03_PAN_SOURCE_ROOT=<exact existing H05/PAN529 SDK checkout>
    KS_H03_OWNER_ROOT=<private owned directory containing identity.json>
    KS_H03_STATE_ROOT=<private owned starter-state directory>
    KS_H03_TENANT_ID=<same exact bound tenant>
    KS_H03_PRODUCT_ROOT=<actual existing O2C product root>

The owner identity is regular, no-follow, private, UID-owned and bounded. Its exact shared template is requalified at every command. A template describes the runtime and never grants execution rights. Source/runtime/session/budget producer code is reused, not rewritten.

The closed command schema is kaleidosphere/browser-starter-command/v1. Actions are status, run, abort, reset and suggest. Unknown fields, caller roles, expected-value overrides, source/template overrides, uploads and free shell/URL input are denied. The optional helper returns only a STARTER_JOURNEY proposal, dispatchAuthorized:false and modelCalled:false; it does not reserve resources or execute the proposal.

Result fields include the precise held runtime/template identity, expected and observed business values, VALUE_VERIFIED or VALUE_MISMATCH, source/period, bounded evidence, source/admin-right nonclaims, server first-value duration and humanUsability:NOT_OBSERVED. The actual browser records its first DOM-result duration once per run; later status refreshes do not rewrite it. These are technical durations, not participant, human effort or comprehension measurements.

The page uses only the existing fixed same-origin POST target, current owner-issued CSRF companion and credentials:same-origin. An explicit same-origin referrer policy preserves the exact POST Origin while the ingress's strict origin/CSRF checks remain unchanged.

## State and recovery

The private KS-owned SQLite store persists outcome_unknown before dispatch, bounded operation identity, exact request and starter generation. Completed exact replay returns the persisted result; changed requests, replay across reset and exhausted operation capacity cannot dispatch again. A real control interruption/restart retains UNKNOWN instead of treating a missing in-memory operation as successful completion.

Abort binds the exact active operation, sends a real AbortController cancellation and waits for actual child close. abort_requested is an acknowledgment, not terminal aborted. Reset is denied while running, abort_requested or outcome_unknown, or when instance/generation differs. A known terminal own reset clears only the starter result and increments its generation. It does not remove source databases, analytical generations, sessions, runtime budgets, hosted identity, model policy or foreign state.

Operator reacquisition of a restarted native control process must bind its new epoch and use a new valid session. The native probe verifies the old epoch's session is rejected before reading the retained UNKNOWN state. There is no browser login/issuance route or blind force-reset escape hatch.

## Executable checks

The canonical source parent imports the product, served-page and CI-binding suites exactly once without changing the protected package.json or existing workflow:

    node --test tests/h03-starter-product.test.mjs tests/h03-starter-browser-surface.test.mjs tests/h03-starter-ci-binding.test.mjs
    npm test
    node --test tests/net-revenue-connected-journey.test.mjs tests/net-revenue-f4-composition.test.mjs tests/net-revenue-guided-journey.test.mjs tests/net-revenue-journey.test.mjs tests/net-revenue-ledger-mapping.test.mjs tests/result-lineage-readonly.test.mjs

Served HTML/script checks are not real browser acceptance. The separate native reproducer starts two own labeled tenants using the exact retained agent and H05-control image IDs, overlays the actual current source read-only, verifies native Node/entrypoint bytes, creates private test TLS and runs certificate-verifying Firefox through the real protected ingress:

    KS294_OUTPUT=<new private evidence directory>
    KS_H05_PAN_SOURCE_ROOT=<exact already acquired H05/PAN529 source>
    KS293_PAN527_SESSION_SOURCE=<exact already acquired H02/PAN527 session source>
    KS294_BROWSER_WORKSPACE=<locked dependencies/ks293-browser-runtime installation>
    KS294_CERTUTIL=<existing certutil executable>
    python3 scripts/hosting/run-native-starter-browser.py

Set the existing NSS library path only for that process if its private certutil needs it. Firefox must be available at /usr/bin/firefox; its private profile imports only the task's own CA. No system trust or global package configuration is changed. The existing image IDs must already be available; this reproducer does not claim to rebuild or publish a new image.

An anonymously downloaded Git-less source artifact can be exercised with KS294_REPO pointing at that exact extracted root and KS294_SOURCE_COMMIT / KS294_SOURCE_TREE set to its independently verified exact release binding. Both literal SHA values are required. This is operator-side provenance, not caller/browser authority: separate full archive/blob/mode readback remains mandatory. A Git checkout instead requires its exact clean root/HEAD/tree; supplied overrides must match it.

The runner fails on missing native/browser/direct-readback evidence. It emits raw browser responses, source/identity bindings, lifecycle state and owned cleanup. It uses fixed helper operations against only its own labeled resources and private bundled-fixture copies. Failed attempts remain separate and are never counted as PASS. No global cleanup is used.

## Original acceptance / negative matrix

| Original criterion | Actual probe |
| --- | --- |
| AC1 | Certificate-verifying non-admin Firefox loads and operates the actual page and both native product journeys. |
| AC2 | Separate catalog objects and O2C metric, visible source/rights and existing actual engines. |
| AC3 | Exact held template/runtime plus expected/observed values, business status and limited evidence in HTTP, DOM and native state. |
| AC4 | Typed proposal-only helper; upload/shell/URL/role/model-key/control-token extras denied. |
| AC5 | Non-admin actual abort and own reset; first-value durations and repeat-status freeze; humanUsability remains NOT_OBSERVED. |
| AC6 | Actual killed/restarted control preserves UNKNOWN; blind reset denied; exact own-container/network/state cleanup readback. |

The real browser probes admin-route denial, unchecked upload, free shell/URL, foreign-instance reset, UNKNOWN reset and wrong actual business value. The wrong-value probe changes a private bundled invoice amount and its exact fixture grant binding, runs the unchanged real calculation, and verifies HTTP 200 with VALUE_MISMATCH / failed rather than UI success. The interruption probe kills the actual owned control process; it does not submit a fabricated UNKNOWN status.

This technical scope does not establish human usability, arbitrary tenant/provider compatibility, full hosted readiness, live customer data, a newly built OCI image, or deployment/production authority. Original closure still requires exact required CI, SHA-bound merge, new public release, anonymous complete artifact readback and actual downloaded-product execution. Local tests, browser screenshots and an archive alone are not that delivery.
