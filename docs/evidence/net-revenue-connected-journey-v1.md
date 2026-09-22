# Connected net-revenue synthetic runner — KS236 / KS237 / KS238

## Scope and proof class

This increment provides a **noninteractive local synthetic demonstration**, not an
observed user decision or a complete business-data lineage. Publication is established
by the release containing this document, not by the existence of this file. Issues
236–238 retain their separate acceptance gates; human comprehension is outstanding.

The runner reuses the released calculation/readback and VIS-01 presentation, two
versioned ledger mappings, the bounded period/segment comparison, and the PSAi
release-registry ingestion boundary. It uses one injected database instance but
**separate holdout and F4 fixture relations**. KS236's result does not feed KS237;
KS237's mapped projection feeds KS238. PSAi receives a fixed declared source profile,
not the computed KS238 output. This is an executable composition demonstration,
not one end-to-end dataset or production integration.

## Run the actual entry point

Use Node 24. Install the explicitly versioned embedded PostgreSQL driver outside the
checkout, then run the same entry point as CI:

```sh
npm install --prefix /tmp/ks-connected-runtime --ignore-scripts --no-audit --no-fund @electric-sql/pglite@0.3.14
node scripts/run-connected-net-revenue-journey.mjs --pglite /tmp/ks-connected-runtime/node_modules/@electric-sql/pglite/dist/index.js --negative
```

Without `--pglite` the result is explicitly labelled `SYNTHETIC_FALLBACK`; it is not
real-database evidence. With the driver, fixtures are seeded and read by SQL in
embedded PGlite (`REAL_POSTGRESQL`), not a production PostgreSQL deployment.
`--out` accepts a local file under the checkout or `/tmp`; static symlink components
and prefix lookalikes are denied. Concurrent parent-path replacement is not certified.
The runner does not read stdin: EOF, yes and no are not consent or comprehension.

The JSON exposes `ks236.presentation` with readback, table, chart HTML and details;
`ks237.layouts`; `ks238` period/segment results; and separate PSAi boundary state.
The [reader-task protocol](ks236-reader-task-protocol-v1.md) prepares a local human
exercise. It does not supply answers or establish that a reader completed it.

## Claim-to-proof contract

| Claim | Proof and identity | Limit |
| --- | --- | --- |
| Released calculation and presentation are reused | `runConnectedJourney` calls the existing journey; suite checks readback/table identity and holdout values | KS236 uses a separate holdout from the F4 comparison |
| Two layouts reuse one core | frozen ledger-v1/v2 mappings, equal kernel count and comparison digest; real SQL tests | two synthetic schemas, not two ERP qualifications |
| Comparison reconciles | fixed declared expectations for net, sale, credit and excluded rows; tests independently assert additional fixture fields | not every output field is runtime-pinned to a constant |
| Stage failure stops downstream work | symmetric-row-removal regression rejects `CONNECTED_KS237_EXPECTATION_DENIED` | no authority inferred from a successful stage |
| Real CLI negative reaches the intended gate | fresh database per attempt; exact `CONNECTED_PSAI_BOUNDARY_DENIED:XRA_KS01_PROVENANCE_FORGERY_DENIED` required | unrelated SQL errors are failures, not negative evidence |
| PSAi release boundary is respected | actual registry returns `DENIED` / `XRA_KS01_RELEASE_HELD` | no usable positive PSAi admission from the real registry |
| Injected admitted-path mechanics work | suite uses an explicitly synthetic release-registry counterpart, yielding authority-free `CANDIDATE` | not upstream public release evidence or promotion authority |

The connected receipt binds source mode. Comparison identity across modes/layouts is
asserted separately; different connected digests must not be interpreted as different
business semantics. `allStagesReconciled=true` with `dependencyClosed=false` means the
expected HELD rejection behaved correctly, not that the upstream dependency is complete.

## Independent expected values and semantic limits

The F4 fixture comparison uses June sales 50000 minus credits 5000 = net 45000;
July sales 72000 minus credits 6000 = net 66000; net delta 21000 and sale delta 22000.
An out-of-window row is excluded. Unknowns remain separately reported (June's known
unknown amount is 900; July includes an unquantified unknown). Runtime reconciliation
checks only its declared fields; unchanged-fixture assertions cover additional values.

The separate KS236 holdout produces July net 100059 (141293 minus 41234), June net
30000 (35500 minus 5500), and delta 70059. These numbers must not be conflated with
F4 totals. Values are minor currency units; chart metadata states EUR/100 and carries
coverage, counterevidence, drilldown and nonclaims.

Order intake and historical open-order balance remain unsupported. Existing PANSPHAIRA
source definitions are reused, not a second order-management module. Comparison of
periods and segments does not establish causes. Synthetic profile substitution, expired
provenance after load, wrong layout and ambiguous/missing semantics are negative paths,
not evidence of customer-system qualification.

## Review, tests and canonical reachability

Focused independent review reproduced two defects: database reuse masked the real CLI
negative with a duplicate-key error, and an unreconciled KS237 stage continued. Both
have explicit parent corrections and regression tests. The connected suite is reached
exactly once through `tests/source-map.test.mjs` in the canonical `npm test` lifecycle.
Source-map and topology registrations bind the new files. CI additionally provisions the
pinned external PGlite runtime and executes the connected suite and real CLI negative
at the candidate checkout, rather than claiming fallback tests as SQL evidence.

## Promotion assessment

**NOT_PROMOTED** under #167. Neither automated tests nor the synthetic admitted-registry
counterpart establish human comprehension, public upstream dependency closure, customer
readiness, a generic dashboard generator or broader visual composition authority.
The real PSAi registry remains HELD. Human reader evidence remains unrecorded. These
limits survive publication of this bounded technical increment.
