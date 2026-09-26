# KS249 (KS-EVO-04) — one bounded metric-compiler adapter, resolved by an executable adopt-or-reject decision

LOCAL / SYNTHETIC / READ-ONLY. Nothing here installs, executes or assumes an external component.
Every number below came from the commands in this record on this checkout.

## The demonstrated need (AC01)

Exactly one concrete reuse gap: the released metric contract
(`contracts/business-bi/v1/net-revenue.metric.json`) exists as a versioned document, but nothing
executable compiles it into a bounded, channel-preserving plan for the released read path. No
catalog platform and no second dashboard engine is added.

Alternatives compared, with observed (not invented) metadata from the public npm registry read
locally, and each pinned to one version and license:

    @cubejs-backend/server 1.7.43  Apache-2.0  19 direct dependencies   95,908 B unpacked  REJECT
    @malloydata/malloy     0.0.434 MIT         10 direct dependencies  4,116,990 B unpacked  REJECT
    in-repo bounded metric-IR adapter  kaleidosphere-metric-ir/v1  0 new runtime dependencies  ADOPT

Both external components were NEVER installed and NEVER executed here, so their compatibility is
unverified and is not assumed; they are rejected on observed cost and unverifiable compatibility
for this scope. A rejection is a decision with evidence, not an implemented capability, and not a
claim that either component is defective.

## What was built and actually executed

- `services/bi-control/src/business-bi/metric-compiler-adapter-v1.mjs` — compiles the released
  contract into `kaleidosphere-metric-ir/v1`: closed contract shape, self-re-derived contract
  digest, drift detection against the pinned digest, one supported dialect with every other
  dialect refused by name, integer-only numeric semantics, channel preservation (UNKNOWN, DENIED,
  observed ABSENCE, VALUE), the evidence revision and the applicability record, plus a lossless
  bounded round-trip and a re-derivable binding with a checker.
- `scripts/run-metric-compiler-adapter.mjs` — the ONE runnable entry point: EOF run, `--verify`,
  `--negative`, `--format JSON|IR|TABLE`. It writes nothing and imports nothing external.
- `tests/metric-compiler-adapter.test.mjs` — 18 focused tests, 0 failures; AC01–AC04, the
  checker/rendering surfaces, the real CLI end-to-end and five RED/GREEN boundary pairs.
- Authored fixtures under `tests/fixtures/business-bi/ks249-metric-compiler/`, including the
  registry observation file the decision is digest-bound to.

## Observed compile result (real output)

`metricId=bi-ks-01-net-revenue`, dialect `kaleidosphere-metric-ir/v1`, revision
`ks249-compiler-observation-v1`, `drift=false`, `roundTripLossless=true`,
`newRuntimeDependencies=0`, channels `VALUE` (both periods), `UNKNOWN` (count 2, amount 900),
`DENIED` (row-level customer detail with its reason), laws 9 with `CANON-99` preserved as
`UNASSESSED`, 4 nonclaims.

## Tests actually run

- `npm test` (full repository suite, 1522 tests) — see `evidence/npm-test.log`.
- `node --test tests/metric-compiler-adapter.test.mjs` → 18 tests, 0 failures.
- `node scripts/run-metric-compiler-adapter.mjs --negative` → 19 gates, 0 unexpected.
- `node --test tests/source-map.test.mjs tests/canonical-test-topology.test.mjs` → tracking and
  exactly-one-route invariants hold.

## Named partial boundary (NOT done, NOT claimed)

- **Not verified: external component compatibility.** No fair executed comparison against Cube.js
  or Malloy was performed; both were rejected without execution, and no vendor compatibility,
  dialect support or numeric equivalence is asserted for either.
- **External: AC05.** Independent focused review, current-Main integration, exact-head merge,
  functional release classification and public readback are not performed here.
- **UNKNOWN: generalized compiler scope.** Exactly one dialect and one metric are compiled; a
  catalog/lineage import or a multi-dialect compiler remains unassessed.
