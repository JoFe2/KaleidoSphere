# VIS-01: one evidence-bound net-revenue visual

## Product boundary

`services/bi-control/src/business-bi/net-revenue-visual-v1.mjs` adds a separate
versioned consumer, not a replacement for C2 or the existing reporting renderer.
`createNetRevenueVisualInputV1({plan, receipt, metricContractBytes, oracleBytes})`
uses `createNetRevenueReadback`, which verifies the existing typed plan, execution
receipt, admitted contract/oracle bytes, output and result identities. It does not
read source rows, perform SQL, or implement the KPI calculator. A digest is an
integrity binding, not proof that PostgreSQL was executed. Keep the actual C2
execution/session evidence alongside these artifacts.

The `kaleidosphere.business-bi/net-revenue-visual-input/v1` envelope includes
metricId, fixed scope/classification, EUR minor-unit scale, both inclusive calendar
periods, coverage/reason, all readback identities, the unchanged C2 result and
retained source nonclaims. The runtime validator is closed to extra keys and
scope changes. Projection output is `kaleidosphere.business-bi/net-revenue-visual/v1`.
The offline projection/HTML helpers validate shape, arithmetic consistency and
result digest, **not source authentication**. The CLI always calls the verified
adapter first; it has no bare-input bypass.

## Run against actual product output

Main/reviewer supplies `plan.json` and `receipt.json` directly from the existing
`runPostgresqlC2SafeAggregate(...)` return (`result.plan`, `result.receipt`) after
its authorized dedicated synthetic PostgreSQL run. Do not construct a COMPLETE
receipt from expected values. Run from repository root with Node 24:

```sh
node scripts/render-net-revenue-visual-v1.mjs \
  --plan plan.json --receipt receipt.json \
  --metric contracts/business-bi/v1/net-revenue.metric.json \
  --oracle tests/fixtures/business-bi/net-revenue-oracle-v1.json \
  --format HTML --period all > net-revenue.html
node scripts/render-net-revenue-visual-v1.mjs \
  --plan plan.json --receipt receipt.json \
  --metric contracts/business-bi/v1/net-revenue.metric.json \
  --oracle tests/fixtures/business-bi/net-revenue-oracle-v1.json \
  --format JSON --period current > net-revenue-current.json
node --test tests/net-revenue-visual-v1.test.mjs tests/evidence-bound-renderer-v1.test.mjs
npm test
```

No credentials, services, network resources or new dependencies are required by
the consumer. HTML is self-contained with script execution disabled. Open it as a
local file. One native radio filter selects both/comparison/current; CSS applies
that same selection to table rows, SVG groups and aggregate details. The scale
stays fixed between filter selections. JSON contains only selected periods;
HTML retains both admitted periods so the reader can change selection offline.
Neither format is a redaction boundary. Native `details` provides one aggregate
drilldown type, not raw-row access. All global UNKNOWN/out-of-scope counterevidence
remains visible, explicitly marked as not filtered.

## Parent-executed qualification (2026-09-15)

Actual C2 output from PostgreSQL 16.10 in the dedicated KS test VM is retained in
`vis01-real-execution/index.json`. The pinned image matches the original C1 profile;
only the admitted public synthetic non-customer fixture was loaded. A real
least-privilege read-only session executed the unchanged C2 read path; an UPDATE
was rejected with SQLSTATE 25006. The plan and execution receipt, three filtered
JSON projections and the generated HTML are retained, not reconstructed from the
oracle. Product head: `092c40de9c2ea9cf860439397a3f119863c152ca`.

Browser readback exercised all three radio selections, asserting matching table,
chart and drilldown visibility, and opened the native details control. The captured
view shows signed credit contributions and persistent global counterevidence.
No browser script or remote resource was loaded. This is a functional browser
inspection, not a human comprehension study. No automatic-chart, template or
multi-dashboard promotion or measured maintenance advantage is claimed.

The disposable PostgreSQL container and temporary password were removed, and the
KS VM was paused again. Independent evidence adjudication and final publication
remain separate delivery gates; the implementation-stage dispositions below are
retained as historical boundaries, not claims that this run happened earlier.

## Original acceptance criteria and evidence disposition

1. **Consume one versioned KPI/result contract with explicit period, units, scope,
   UNKNOWNs and counterevidence.** Implemented envelope and verified C2 adapter.
2. **Treat a deterministic table as the authoritative visual baseline.** Exact
   integer cents, chronological comparison/current order, explicit units and dates.
3. **Render one semantically appropriate chart from the same result bytes.**
   Signed period bars with a zero baseline, exact integer labels and result digest.
   No line interpolation over absent periods, no pie chart for negative credits.
   Pixel geometry alone is approximate; no financial arithmetic uses floats.
4. **Implement one bounded filter and one drilldown to evidence-bound contributing
   rows or aggregates.** Three enumerated period selections; sale, negative credit,
   zero cancellation/count and UNKNOWN aggregates retain result binding.
5. **Independently reconcile table value, chart value and drilldown totals against
   the KPI oracle.** NOT CLAIMED by the implementer. Development tests demonstrate
   consistency and tamper denials; they are not the independent oracle evaluation.
   Reviewer must compare each selected `table[].netMinorUnits`, `chart.values[]`,
   `drilldown[].totalMinorUnits` and signed contribution sum with independent oracle
   period values from actual C2 execution. Repeat both filters; independently check
   global/period UNKNOWN channels and cancellations. Check parsed HTML values too,
   not only model JSON. Preserve actual execution evidence and hashes.
6. **Preserve credits, cancellations, missing periods and unknown amounts rather
   than silently dropping them.** Credits subtract; cancellation count remains;
   zero-row periods show MISSING/null visual values while retaining the contract's
   aggregate zero in drilldown. Unavailable execution states show no numeric bars.
   UNKNOWN counts, quantified amounts, unquantified counts and unassigned/null-date
   channel remain separate. Partial numeric net is explicitly not complete revenue.
7. **Display provenance and unsupported/partial states without implying a stronger
   result.** Execution state is distinct from semantic PARTIAL; reasons, scope,
   hashes and unchanged source nonclaims are displayed. Historical source nonclaims
   are labeled as such, not silently rewritten into new capability authorization.
8. **Compare the existing renderer and one reuse-oriented OSS route; selection is
   an outcome.** Bounded decision below. No wider visual platform authorization.

The named prerequisite remains PostgreSQL C2 #150 (including its independently
verified released successor), **or** explicitly equivalent publicly closed
real-source KPI proof. No customer-data requirement is added to the authorized
real PostgreSQL synthetic clean-room route. Historical C1/C2 certificates and
BLOCKED_EXTERNAL fields are unchanged. Main owns prerequisite verification,
independent AC5 reconciliation, review, release and closure.

## Bounded technology choice

Inspected actual local source:
`services/bi-control/src/reporting/evidence-bound-renderer-v1.mjs` exports only
TABLE/JSON, verifies report/coverage bindings, bounds exports to 262144 bytes and
denies other renderer kinds. Its contract must not be widened for this slice.
The existing `net-revenue-readback.mjs` likewise explicitly supports TABLE/JSON.
Reuse its verifier and keep those paths byte-unchanged; add a separate fixed
HTML/SVG consumer rather than relaxing their allowlists.

OSS alternative inspected: [Vega-Lite bar documentation](https://vega.github.io/vega-lite/docs/bar.html)
(retrieved and read from a local documentation cache during implementation).
The documented single-view spec has `data`, `mark: "bar"`, `encoding`; its bar
properties document horizontal/vertical orientation and fixed pixel width/height.
This supports evaluating an explicit non-stacked period bar route. No Vega-Lite
runtime was installed or executed. Filter accessibility, null handling, cent-exact
labels, rendering stability, payload size and maintenance cost in this repository
are **untested**, not assumed from its documentation. No dependency download was
needed. The inspected documentation is upstream, not a pinned dependency version.

**Selection:** retain C2 verification plus a small fixed native HTML table/SVG bar
renderer. Two fixed periods, no expressions, no browser script, no remote resources
and no chart dependency are enough for this slice. This reduces the immediate
integration surface; it is not measured proof of lower lifetime maintenance cost.
Revisit reuse only after reader comprehension and measured maintenance justify it.

## Source-local test result

Node v24.19.0: canonical `npm test` passed 1256 tests before commit. Re-running
on the committed VIS-01 head returned **1255 passed, 1 failed**, no skips. The sole
failure is the historical C2 registration test at
`tests/postgresql-c2-safe-aggregate.test.mjs:757`: it compares every path changed
since C2 integration to a correction-only allowlist through **HEAD**, so any new
committed VIS-01 path fails `changed files outside the bounded correction`.
This was not hidden by a precommit-only report. The C2 verifier, certificates and
historical tests were left unchanged; main/independent review must resolve this
historical-interval versus future-product-registration gate before delivery.
Focused VIS-01, legacy renderer and canonical topology run passed 76 tests.
The suite is registered through `tests/source-map.test.mjs` with its intentional
edge in the topology gate, preserving `package.json` byte-for-byte. An initial
direct package registration correctly tripped historical manifest-bound gates;
it was replaced by this existing imported-suite convention, not by changing C1/C2
certificates or weakening their checks. RED runs observed missing projection,
filter, missing-state/validation, HTML, adapter, CLI and source-registration behavior
before their corresponding implementations. These are local software test results,
not AC5 independent acceptance or actual PostgreSQL visualization execution proof.

## Verification limits / promotion gate

Tests use a clearly labeled public development aggregate with negative revenue,
credits, cancellations and all UNKNOWN channels; it is not a database execution.
The adapter/CLI test runs a real C2 non-success receipt path without source rows.
No sealed holdout file was inspected to develop this visual. The existing C2
verifier consumes its admitted oracle bytes, unchanged. Positive actual PostgreSQL
execution and independent oracle reconciliation are pending parent/reviewer work.
Browser interaction, reader comprehension and maintenance cost are not yet measured.
Visual templates, automatic chart selection and multi-dashboard composition remain
unadmitted until correctness, comprehension and maintenance are measured positively.
