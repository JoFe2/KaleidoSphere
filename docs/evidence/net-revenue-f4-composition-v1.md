# Positive local F4 composition v1 (#238)

Task: `JoFe2/KaleidoSphere#238`. This closes the previously-unimplemented positive local
composition: a real local source read through the #237 mapping-profile boundary into the
#238 period/segment comparison, exposed as one usable documented CLI entry point.

## What this is

One supported entry point — `node scripts/run-net-revenue-f4-composition.mjs` — composes
the candidate #237 mapping profiles and the candidate #238 comparison into a single run over
a local PostgreSQL database seeded with synthetic fixture rows (injected in-process
PGlite in an isolated runtime, never a `package.json` dependency). Seeding writes to
that local database; the subsequent SELECT is not proof of enforced read-only access:

| Primitive | Source | Role |
| --- | --- | --- |
| `mapLedgerRowsToCanonical` + frozen `LEDGER_MAPPING_PROFILES` | #237 (`net-revenue-ledger-mapping.mjs`) | kernel mapping boundary (unchanged) |
| `compareSegmentsAcrossPeriods` / `buildSegmentComparisonReport` | #238 (`net-revenue-segment-comparison.mjs`) | comparison surface (unchanged) |
| `serializeHoldout` | C2 (`postgresql-safe-analysis.mjs`) | byte-exact kernel serialization (unchanged) |
| source relation + orchestration | NEW (`net-revenue-f4-composition.mjs`) | only genuinely new surface |

No metric core, profile validator, recognition rule, or comparison arithmetic was
reimplemented. The new module adds only the source relation that carries BOTH the ledger
kernel columns (so the frozen #237 profile decodes it) and the #238 `status`/`segment`
business extension, plus the orchestration that binds them.

## The boundary that is actually crossed

The frozen #237 profiles declare a CLOSED kernel of four roles (`id`/`date`/`kind`/
`amount`) plus a dropped non-metric column; they know nothing about `status` or `segment`.
The #238 comparison requires exactly those two extra dimensions. The composition therefore:

1. reads the real source rows (real SQL `SELECT ... ORDER BY row_key`);
2. projects each row to the frozen profile's exact kernel columns and maps through the
   frozen profile, getting the canonical `{order_id, order_date, record_kind,
   amount_minor_units}` rows;
3. attaches `status`/`segment` read from the SAME real source rows (never invented);
4. feeds the #238 comparison and builds the report.

The `status`/`segment` extension is declared separately and is NOT a profile role; the
ledger-v2 dropped column (named `segment` in the frozen profile, holding a ledger stream
value) is kept distinct from the business `segment` dimension by naming the source column
`ledger_stream` and renaming only at the profile handoff.

## Independent expected values (reconciled)

Both `ledger-v1` and `ledger-v2` produce byte-identical digests and reconcile to the #238
independent values over the same 12 rows:

| Measure | 2026-06 | 2026-07 | delta |
| --- | ---: | ---: | ---: |
| gross sale value (NOT intake) | 50000 | 72000 | +22000 |
| net revenue | 45000 | 66000 | +21000 |
| segments (GROSS): direct / partner | 30000 / 20000 | 57000 / 15000 | |
| unknown (quantified / unquantified) | 900 / 0 | 0 / 1 | |
| out-of-scope excluded | | | 1 |

`orderIntake` and `openOrder*` remain unsupported (`null`); this composition does not
invent intake-event or historical status/as-of semantics.

## Runnable entry point

```sh
# canonical (synthetic fallback; no external dependency; byte-bound package.json)
node scripts/run-net-revenue-f4-composition.mjs --layout both
node scripts/run-net-revenue-f4-composition.mjs --layout ledger-v1 --negative

# real local PostgreSQL (injected PGlite; see real-database note below)
node scripts/run-net-revenue-f4-composition.mjs \
  --pglite /workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js \
  --layout both --negative
```

Exit code 0 on success and on business denials reported inside the JSON body; 1 only on
CLI argument/IO/path errors. `--out` is restricted to the repository or `/tmp`. No public
writes, no HTTP publish path.

## Normal and negative paths

Normal: `ledger-v1` and `ledger-v2` both map through their frozen profiles and produce
`comparison.delta.netRevenue = 21000` with identical kernel and comparison digests.

CLI `--negative` invokes the mapping/comparison boundary directly on fixture rows;
these negative cases do NOT pass through database seeding or SELECT, even when
`sourceMode` is `REAL_POSTGRESQL`. That field describes the positive path's engine,
not the negative evidence's execution path. The direct boundary cases deny:
- wrong source/layout (the other layout fed under the declared profile) -> `LEDGER_KIND_DENIED:undefined`;
- wrong mapping (an unrecognised posting/entry kind) -> `LEDGER_KIND_DENIED:not_a_kind`;
- wrong unit, ambiguous scale -> `LEDGER_UNIT_SCALE_AMBIGUOUS`;
- wrong unit, contradictory scale -> `LEDGER_UNIT_SCALE_MISMATCH`;
- UNKNOWN / missing-data semantics are PRESERVED (not errors): the null-amount current
  row is an unquantified UNKNOWN and the quantified comparison row stays at 900.

## Honest provenance (never fabricated)

The DI source is synthetic and is marked `SYNTHETIC` in every report. The #238 source
provenance stays `HELD` (no PANSPHAIRA release, null release fields) — this composition
crosses the adapter/profile boundary, it does NOT admit a production source or invent a
PANSPHAIRA release. Real PANSPHAIRA provenance/compatibility and the HELD production
profile are never activated here.

## Verification

```sh
node --test tests/net-revenue-f4-composition.test.mjs
node --test tests/net-revenue-ledger-mapping.test.mjs tests/net-revenue-segment-comparison.test.mjs
npm test
```
