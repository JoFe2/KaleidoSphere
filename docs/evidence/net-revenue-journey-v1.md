# Net-revenue user journey v1 (#236)

Task: `JoFe2/KaleidoSphere#236`. Outcome: turn the released net-revenue calculation and
visualization into a documented, runnable local journey.

## What this is

One supported entry point — `node scripts/run-net-revenue-journey.mjs` — composes the
already-released primitives into a single local run:

| Primitive | Source | Role |
| --- | --- | --- |
| `compileNetRevenuePlan` / `executeNetRevenuePlan` | C2 #150 (`net-revenue-plan.mjs`) | metric core (unchanged) |
| `createNetRevenueReadback` / `renderNetRevenueJson` / `renderNetRevenueTable` | C2 (`net-revenue-readback.mjs`) | readback (unchanged) |
| `createNetRevenueVisualInputV1` / `projectNetRevenueVisualV1` / `renderNetRevenueVisualHtmlV1` | VIS-01 #168 (`net-revenue-visual-v1.mjs`) | visual (unchanged) |
| `serializeHoldout` | C2 real-read (`postgresql-safe-analysis.mjs`) | byte-exact holdout re-serialization (unchanged) |
| journey orchestration + local PostgreSQL connector | NEW (`net-revenue-journey.mjs`) | only genuinely new surface |

No metric core, readback, visual, serializer, or contract was reimplemented. The journey
module adds only the local PostgreSQL source connector and the orchestration that binds
the released pieces together.

## Business meaning, period, units, corrections, missing data

- **Question (fixed):** "What was synthetic net revenue in the current period (2026-07)
  versus the comparison period (2026-06), in integer EUR minor units, and what is missing?"
- **Relation:** `synthetic_bi.orders` (synthetic, non-customer; `s-NNN` identifier namespace only).
- **Periods:** current `2026-07-01..2026-07-31` and comparison `2026-06-01..2026-06-30`,
  both inclusive-both-ends. Rows outside both periods are counted as out-of-scope.
- **Units:** EUR, `minorUnitsPerMajorUnit = 100`; all arithmetic is integer minor units,
  floating point forbidden (CANON-2).
- **Corrections:** `record_kind = credit` subtracts its amount; `cancel` contributes 0 and is
  counted; `sale` adds. `credit` amount must be `> 0`, `cancel` exactly `0`.
- **Missing data:** a null `amount_minor_units` or a null `order_date` or kind `unknown`
  routes the row to a first-class UNKNOWN channel (counted and quantified), never zero and
  never silently dropped (CANON-3). Null-date rows are also reported as `unassigned`.

Independent admitted oracle (reconciled below):

| Channel | Value |
| --- | ---: |
| current net (2026-07) | 100059 |
| comparison net (2026-06) | 30000 |
| delta | 70059 |
| UNKNOWN quantified amount | 1977 |
| UNKNOWN unassigned quantified amount | 1200 |
| excluded out-of-scope rows | 3 |

## Runnable entry point

```sh
# canonical (synthetic fallback; no external dependency; byte-bound package.json)
node scripts/run-net-revenue-journey.mjs --format JSON
node scripts/run-net-revenue-journey.mjs --format TABLE
node scripts/run-net-revenue-journey.mjs --format HTML > net-revenue.html

# real local PostgreSQL (injected PGlite; see real-database note below)
node scripts/run-net-revenue-journey.mjs \
  --pglite /workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js \
  --format JSON --negative
```

Exit codes: 0 on success and on business denials reported inside the receipt/JSON body;
1 only on CLI argument/IO/path errors. The CLI writes no public state; `--out` is
restricted to the repository or `/tmp`.

## Normal and negative paths

Normal: the journey returns `oracleEquality: EXACT` and
`reconcilesToIndependentOracle: true`, with `result.deltaMinorUnits = 70059`. JSON/TABLE
renderings are identity-equal; the VIS-01 HTML binds the same result digest and shows the
authoritative table, signed SVG, both periods, UNKNOWN counterevidence, and provenance.

Negative (all deterministic, real local database when `--pglite` is supplied):
- substituted source bytes -> `BUSINESS_BI_HOLDOUT_DIGEST_DENIED`, result `null`;
- a write attempt inside a read-only session -> SQLSTATE `25006`
  `cannot execute UPDATE in a read-only transaction`, zero residue (row unchanged);
- an altered operation id / widened scope -> `BUSINESS_BI_OPERATION_DENIED`;
- a read-only session proof reports `transaction_read_only = on` (inside `BEGIN READ ONLY`).
  It ALSO reports the OBSERVED database role and its actual privileges (in the injected
  single-user PGlite engine this is `postgres` with `rolsuper/rolcreatedb/rolcreaterole`
  true, i.e. `adminCapabilities: true`) — a read-only TRANSACTION is not presented as a
  least-privilege principal, and no such principal is fabricated.

## Real local database note (honest boundary)

The C2 real clean-room HAS been executed and certified: `docs/evidence/postgresql-c2-real-cleanroom/`
records the released #150 actual LIVE PostgreSQL 16.10 positive/negative clean-room with
independent oracle equality and recovery (machine record at
`.ks150-c2-real-cleanroom-{primary,post-restore}-evidence.json`). That certificate is NOT
reproduced or reopened by this journey; its proof class is preserved unchanged.

What this journey adds is a *portable, runnable local entry point*. The canonical `npm test`
graph is byte-bound (`package.json` has zero dependencies), so the dedicated-vm/docker
PostgreSQL used by the certified clean-room is not replayed from this source tree alone. For
the journey's "real local database" execution I inject PGlite (`@electric-sql/pglite`, a
genuine PostgreSQL engine running in-process) from an external runtime directory — never
from `package.json`. This is REAL PostgreSQL executing REAL SQL (schema `synthetic_bi`, table
`orders`, `SELECT ... ORDER BY order_id`, read-only transaction, rejected UPDATE), reconciled
to the independent oracle.

Two honest caveats, not relabelled:
1. The injected engine is PostgreSQL **18.3** (PGlite 0.5.8); the certified C1 profile is
   PostgreSQL **16.10** (docker digest-pinned). The metric result is version-independent
   (integer arithmetic over the same rows), but this run does **not** claim to satisfy the
   16.10 clean-room acceptance. The BLOCKED_EXTERNAL fields that remain on the source-local
   C1 certificate are historical source-local mint marks and are left untouched; they do not
   contradict the separately-recorded #150 live-run provenance.
2. PGlite is in-process/single-user, not a networked multi-tenant server; this is an
   isolated local test database, which is exactly what the task asks for ("only own test
   container, no docker socket, no host rebuild").

## Reader-task protocol

This is a short protocol a human reader can run to form their own comprehension evidence.
Each item states what the reader does and what the expected observation is. The checkboxes
below record what has ACTUALLY been observed so far (machine evidence) and what remains
for a human reader — nothing below is fabricated.

1. Run `node scripts/run-net-revenue-journey.mjs --format TABLE` and read the two net rows.
   - [x] Machine evidence: table renders, `current_net_minor_units=100059`,
     `comparison_net_minor_units=30000`, `delta_minor_units=70059`.
   - [ ] Human comprehension: reader states in their own words that "current" is the
     comparison period's latest calendar month and what a negative delta would mean.
2. Open `--format HTML` and toggle each period radio; check the UNKNOWN section is still
   visible (not filtered).
   - [x] Machine evidence: browser/agent pass asserts UNKNOWN counterevidence persists across
     the filter (VIS-01 filter behavior), and the HTML includes the exact result digest.
   - [ ] Human comprehension: reader states why UNKNOWN must never read as zero.
3. Run the negative path (`--pglite ... --format JSON --negative`) and confirm the write is
   rejected with SQLSTATE 25006 and the row is unchanged.
   - [x] Machine evidence: `writeRejection.rejected = true`, `residueFree = true` (computed
     from an actual before/after re-read, not hardcoded), s-001 still 10000; the session
     proof reports the observed role privileges truthfully (see negative-path note above).
   - [ ] Human comprehension: reader states why a read-only source must reject a write and
     what "mutationAuthority: false" means in the receipt.

**Honest status:** items 1–3 machine-side are exercised by the automated test
(`tests/net-revenue-journey.test.mjs`) and the CLI runs recorded here. The human reader
cells are OPEN — this protocol does not fabricate a human's answer, and the broader #167
promotion gate is **not** claimed as passed from any automated test.

## Reconcile README/roadmap

`README.md`'s "Local library/contract surfaces" documents the released `bi-ks-01-net-revenue/v1`
local operation AND (since this increment) the documented runnable journey entry point
(`node scripts/run-net-revenue-journey.mjs`) with its real-local-database execution note, so
the shipped-CLI authority is no longer described as absent. `docs/ROADMAP.md` gains a
"Portable net-revenue user journey" capability stage listing the composed journey and the
second-layout mapping. Neither edit changes the released contract, the frozen package
manifest, or any historical proof class: the #150 C2 real clean-room certificate, its
recorded live-run provenance, and the C1 byte identities remain untouched.

## Verification

```sh
node --test tests/net-revenue-journey.test.mjs
node --test tests/business-bi-net-revenue-plan.test.mjs tests/business-bi-clean-room.test.mjs tests/net-revenue-visual-v1.test.mjs
node scripts/run-net-revenue-journey.mjs --format JSON
node scripts/run-net-revenue-journey.mjs --pglite /workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js --format JSON --negative
```
