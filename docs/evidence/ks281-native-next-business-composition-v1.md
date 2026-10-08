# KS281: one native client activation over existing first-wave and Next scopes

## Delivered surface and scope

`services/bi-control/src/business-bi/business-epic-composition-v1.mjs` exports `createBusinessEpicCompositionV1`. It directly executes the released first-wave consumer, actual relational Core worker, bounded read-only HTTP executor and saved O2C investigation reader. This is executed product composition, not collation of child PASS files.

The owner supplies exactly `firstWave`, `relationalProfile`, `apiProfile` and `savedInvestigation`. Inputs are captured synchronously as bounded descriptor-safe plain data before source awaits; nested accessors, proxies, cycles, sparse/named-field arrays, nonfinite values and caller-supplied authority fields are refused. A Core PREVIEW_ONLY profile is not approval for a complete client activation. Existing source-executor approval, credential, endpoint, schema, native identity and fixture-owner checks remain unchanged.

`read()` returns one recursively immutable qualified receipt only after every existing component succeeds and the first-wave/native source is checked at the final use site. The components keep their own source contracts and identities. The receipt explicitly declares `MULTIPLE_EXISTING_APPROVED_SCOPES_NOT_ONE_DATASET` and `atomicCrossSourceTransaction:false`: this is one client activation, not one shared production dataset or a database transaction spanning sources.

A refusal returns no component subset and preserves the prior qualified client generation. `close()` retires the owned client lifetime, propagates cancellation to actual Core/HTTP execution and prevents late activation. A later read supersedes an older pending read; an older HTTP snapshot cannot replace the newer whole-client generation. Unexpected errors are not silently rewritten as success.

`resultDigest` includes complete fresh execution observations. `stateDigest` excludes only the actual relational worker PID from semantic client identity. An unchanged business state retains its version while each execution still reports its own real worker PID and cleanup facts; an earlier worker receipt is never described as fresh.

## Reproducible actual product tests

The required `tests/ks281-native-next-composition.test.mjs` executes with the immutable public PAN520 source, a fresh READY owned synthetic MariaDB fixture, the verified optional SQLAlchemy runtime, the existing locked DuckDB runtime and an actual bounded loopback HTTP server. Missing required runtime/source inputs are failures, not replacement mocks or skips.

The 15 cases cover:

- One complete native activation: first-wave aggregate 100059, intentionally UNAVAILABLE native billing, actual MariaDB Decimal sum and zero checked-out connections/disposed pool, three authorized GET pages with a duplicate and missing fields, fresh saved O2C recipe, independent June/July table values and matching chart/CSV.
- Preview-only approval, nested accessor, extra caller role, malformed sparse scope and unselected vendor refusals.
- Constructor-time capture of all nested inputs and immutable returned receipts; repeated actual workers preserve semantic client version without reusing PID observations.
- Actual HTTP 429, changing response snapshot, native revocation during the HTTP await, owned live Core schema drift and corrupted saved recipe. The entire new candidate is refused, no partial result activates, prior generation is held and disposable fixture changes are restored.
- Actual live HTTP socket cancellation on client retirement and a withheld older valid HTTP snapshot arriving after a newer whole-client activation. Both lifetime/ordering regressions were RED before their use-site guards and GREEN afterward.

The fixture and tests create only disposable owned synthetic state. Native source rows and saved recipe bytes are read back unchanged on the happy path; no credential escapes through the qualified receipt. Original first-wave native/mapping/view tests remain separate required executions, not added to the 15-case count.

## Original epic criteria and retained boundaries

1. All child original criteria: remains OPEN because original KS289 AC4 needs the separately authorized real external target, access and minimized data. The local synthetic HTTP route is not vendor qualification or permission to acquire another source.
2. Connected native run: covered for the existing independently authorized first-wave/Core/local-API/saved-profile scopes by the actual coordinator and suite above. Required CI and a new exact release/readback must bind the delivered bytes; local GREEN alone is not release acceptance.
3. Combined authority/identity/state/refusal/rollback: covered by the actual combined negative cases and prior-generation hold, with no source mutation or partial activation claim.
4. Public documentation: this document separates the qualified local scopes, UNAVAILABLE facts and absent extensions. The published first-wave predecessor remains separately attributable.
5. Own technical verification/release attribution: unchanged accepted component reviews are retained by exact bytes; the new delta receives the focused self-check authorized by Jo38572, current required CI, SHA-bound merge and anonymous exact downloaded-product execution. No additional implementer, replacement reviewer or Main-preapproval gate is introduced. Main's later independent findings remain correction work, not an invented approval result.

The broader epic remains OPEN until all explicitly included children and original own criteria are satisfied. No new dashboard foundation, arbitrary agent SQL, production business state, manufacturer parity, blind holdout, human-effort acceptance or new source/Marketplace rights are claimed.
