# Period/segment comparison v1 (#238)

Issue: JoFe2/KaleidoSphere#238. Smallest useful increment after the #236 journey and
#237 second-layout reuse proof.

## The one concrete question

For the current period 2026-07 vs comparison 2026-06 (inclusive both ends), what is
synthetic (a) net revenue, (b) gross sale value, and (c) observed open sale rows, per
supported segment (direct | partner) — with credits, cancellations and unknowns preserved
and never coerced into revenue?

## Independent expected values (reconciled)

| Measure | 2026-06 | 2026-07 | delta |
| --- | ---: | ---: | ---: |
| gross sale value (NOT intake) | 50000 | 72000 | +22000 |
| credits | 5000 | 6000 | |
| net revenue | 45000 | 66000 | +21000 |
| observed open sale rows (count / value; NOT as-of balance) | 0 / 0 | 2 / 27000 | |
| segments (GROSS sale): direct | 30000 | 57000 | |
| segments (GROSS sale): partner | 20000 | 15000 | |
| unknown (count / quantified / unquantified) | 1 / 900 / 0 | 1 / 0 / 1 | |
| unknown unassigned (null-date) | 0 | 0 | |
| cancellations | 1 | 1 | |
| out-of-scope excluded | | | 1 |

`netRevenue = saleValue - creditValue` preserves the C2 arithmetic. `orderIntake`
and its delta are unsupported (`null`), because this source has no intake-event
contract. Gross sale values must not impersonate intake. `openOrderCount` and
`openOrderValue` are also unsupported (`null`): no historical status/as-of source
exists. `observedOpenSaleRowCount` and `observedOpenSaleRowValue` count only
quantified sale rows marked open within each date window. Segment totals are gross
sale values, not net contributions; credits are not allocated per segment.

## Missing-data / UNKNOWN semantics (bound to the released C2 core)

The comparison independently implements the released metric core's missing-data rule
(it does not call that core): a row routes to UNKNOWN when its date is null OR its kind is `unknown` OR its
amount is null; a null-date row is a separate UNASSIGNED channel (never "excluded" and
never silently dropped); an invalid calendar date is DENIED, never lexically accepted.
A dated sale with a null amount therefore counts as an unquantified UNKNOWN (never zero);
a null-date sale with an amount enters UNASSIGNED with its amount preserved.

## Recognition rule and open-order as-of limit

`record_kind` and `status` must be a supported, non-contradictory combination: a sale is
recognized only when it is not `cancelled`; a credit must be `closed`; a cancel must be
`cancelled`. A contradictory combination (e.g. a `sale` marked `cancelled`) is rejected
fail-closed. In-window row observations are NOT an as-of snapshot or open-order
balance. An earlier-period open row cannot establish either zero or a nonzero
later-period balance. Actual intake and historical open-order measures remain an
unfulfilled #238 acceptance step, not a capability established by these tests.

## What is reused vs new

Reused (declared, not executed — PANSPHAIRA untouched): the PANSPHAIRA
`projection-profile/v1` field definition — `xra_projection_orders` with fields
`order_id INT64`, `order_date DATE` (nullable), `amount_minor_units DECIMAL(12,2)`
(nullable), `record_kind TEXT`; `periodWindow` 2026-06-01..2026-07-31;
`unknownHandling SEPARATE_CHANNEL`; `arithmeticUnit INTEGER_MINOR_UNITS`.

The declared source is a HELD synthetic counterpart, not the released upstream projection:
its provenance (`status: HELD`, null release fields) is preserved honestly, and it is
validated through the existing profile-contract shape validator. Shape validity does
not attest the field semantics or source-row origin. The focused F4 test now submits
this exact declaration as canonical bytes to the real local ingestion pipeline with
the repository registry: it returns `DENIED / XRA_KS01_RELEASE_HELD`, no candidate,
and no successful ordinary answer. This is a negative admission proof, not a
positive source handoff. Actual source-to-comparison composition and the connected
#237→#238 CLI path remain unimplemented and parent-owned; no release authority is
invented to make the test pass.

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
