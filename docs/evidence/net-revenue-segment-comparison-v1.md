# Period/segment comparison v1 (#238)

Issue: JoFe2/KaleidoSphere#238. Smallest useful increment after the #236 journey and
#237 second-layout reuse proof.

## The one concrete question

For the current period 2026-07 vs comparison 2026-06 (inclusive both ends), what is
synthetic (a) net revenue, (b) order intake (gross sale value), and (c) open orders, per
supported segment (direct | partner) — with credits, cancellations and unknowns preserved
and never coerced into revenue?

## Independent expected values (reconciled)

| Measure | 2026-06 | 2026-07 | delta |
| --- | ---: | ---: | ---: |
| order intake (gross sale) | 50000 | 72000 | +22000 |
| credits | 5000 | 6000 | |
| net revenue | 45000 | 66000 | +21000 |
| open orders (count / value) | 0 / 0 | 2 / 27000 | |
| segments: direct | 30000 | 57000 | |
| segments: partner | 20000 | 15000 | |
| unknown (count / quantified) | 1 / 900 | 1 / 0 | |
| cancellations | 1 | 1 | |
| out-of-scope excluded | | | 1 |

`netRevenue = saleValue - creditValue` (the released C2 definition). `orderIntake` is
gross sale value BEFORE credits/cancellations — the two are explicitly reported
separately so intake is never conflated with net. Open orders are a status dimension
(open SALE rows only); credits/cancels/unknowns are record kinds, never orders.

## What is reused vs new

Reused (declared, not executed — PANSPHAIRA untouched): the PANSPHAIRA
`projection-profile/v1` source definition — `xra_projection_orders` with fields
`order_id INT64`, `order_date DATE` (nullable), `amount_minor_units DECIMAL(12,2)`
(nullable), `record_kind TEXT`; `periodWindow` 2026-06-01..2026-07-31;
`unknownHandling SEPARATE_CHANNEL`; `arithmeticUnit INTEGER_MINOR_UNITS`.

New (this module only): the bounded `status` (open|closed|cancelled) and `segment`
(direct|partner) dimensions, and the comparison/split surface.

Not new: this is NOT a second order-management module, NOT a generic chart/template
dashboard, NOT causal attribution. Deltas are arithmetic over the same rows.

## #167 promotion assessment

Status: NOT_PROMOTED. The localized increments (#236 journey, #237 second-layout
mapping, #238 period/segment comparison) each reconcile to independent expected values
and pass the canonical test graph. Broader visual composition (generic chart/template/
dashboard expansion) remains gated behind the #167 promotion gate and is not claimed
from these automated tests.

## Verification

```sh
node --test tests/net-revenue-segment-comparison.test.mjs
node --test tests/net-revenue-journey.test.mjs tests/net-revenue-ledger-mapping.test.mjs
npm test
```
