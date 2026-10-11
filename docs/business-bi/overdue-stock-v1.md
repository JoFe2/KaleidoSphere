# Historical overdue receivables stock v1 — original KS317

Bounded OWN SYNTHETIC technical product, not net-revenue renamed, customer data permission,
new BIengine, native UI/voice pairing or production least-privilege role.

Run from the exact repository root:

    node scripts/provision-ks255-journey-runtime.mjs --install --runtime-root .ks-journey-runtime
    node scripts/provision-ks255-journey-runtime.mjs --verify --runtime-root .ks-journey-runtime
    python3 scripts/calculate-overdue-stock-oracle-v1.py --check
    node --test tests/overdue-stock-product-v1.test.mjs
    node scripts/run-overdue-stock-journey-v1.mjs

The existing pinned @electric-sql/pglite@0.3.14 closure supplies the actual local PostgreSQL
engine through the existing net-revenue-journey.mjs connector. No alternative/mock SQL
result, synthetic fallback or absent-runtime skip is provided by this product route.
Fixture seeding is the only local write and is transactionally rolled back on construction
failure; metric execution runs one actual REPEATABLE READ, READ ONLY transaction. Read-only
settings are read inside that transaction. A real production least-privilege principal is
NOT_VERIFIED_NOT_CLAIMED, never inferred from the connection flag or a synthetic scope label.

Existing owners and bounded extensions

- KS237's unchanged net-revenue-ledger-mapping.mjs supplies its existing EUR/minor-unit
  owner vocabulary to the separate stock/event mapper in that SAME business-bi owner package.
  The stock schema is not order/net-revenue rows. Frozen original mapper/plan bytes remain exact.
- KS246's closed source-role/business-meaning discipline is retained: the shipped contract
  explicitly admits OPEN RECEIVABLES STOCK from invoice/payment/credit/cancel histories.
  No arbitrary source, column-label inference, source rights or NET_SALES_REVENUE handoff is
  adopted. Missing units/values/due dates stay UNKNOWN; wrong units/currency are refused.
- The separate fixed stock operation in the EXISTING business-bi owner package uses the
  existing actual PostgreSQL connector and READ ONLY session-proof validator, not a new
  general compiler or arbitrary SQL endpoint. net-revenue-plan.mjs remains byte-identical:
  K01's fixed original plan hash/namespace and all its original guards are NOT relaxed just
  to add a re-export. New stock callers select the explicit versioned stock-operation module.
- KS247 result-lineage-v1.mjs issues the early versioned stock result adapter only for a LIVE
  owner-issued receipt. Cloned or client-rehashed receipts/plans cannot obtain authority.

Definition

The versioned normative contract is contracts/business-bi/v1/overdue-stock.metric-v1.json.
This is invoice BALANCE STOCK at one inclusive valid-time cutoff and one separately bound
inclusive knowledge-time cutoff, not an invoice-date/month COHORT and not Nettoumsatz.
InvoiceDate and DueDate are separate calendar fields. BusinessDate is explicit and separate
from UTC instants. Due on BusinessDate is not overdue; overdue requires DueDate < BusinessDate.
All explicit-offset instants normalize to UTC millisecond ISO BEFORE persistence. Raw offset
text is never a sort key. The declared business calendar is Europe/Berlin.

Eligible payment and credit events aggregate separately per tenant/invoice BEFORE their two
1:n joins to invoice grain. Remaining principal is original - payments - credits; an eligible
cancellation clears the balance. Negative balances are not receivables and are separately
counted/quantified as credit/overpayment balances. No FX conversion is invented.

Backdated correction is applied only when its effective instant <= validCutoff AND its
recorded instant <= knowledgeCutoff. A later knowledge restatement is a new bound plan and
result revision, even at the same valid cutoff and on the same immutable snapshot.

Money starts as nonnegative safe-integer source minor units, normalizes to decimal strings,
and uses PostgreSQL bigint/numeric integer aggregation. Result amounts remain decimal strings,
not floating-point sums or percentages. Ratio carries integer numerator/denominator only;
zero denominator gives null/ZERO_DENOMINATOR, not zero percent.

UNKNOWN is not zero

A source with incomplete required history yields whole-metric UNKNOWN and no asserted
amounts/counts/drilldown. With complete history but an affected invoice's amount/currency/unit
or positive balance's due date missing, the result is PARTIAL: full amount/count/ratio are
null, and explicitly named knownSubset carries only the actually observed scoped subset.
Unknown invoice counts are retained. This cannot become a complete portfolio or source PASS.

Own synthetic scope and identity

The shipped fixture is contracts/business-bi/v1/overdue.synthetic-source-v1.json. It includes
two owned synthetic sites, a distinct foreign-tenant control, partial payments, credits,
cancellation, backdated payment, missing amount/due/unit, and inverted raw-text DST order.
Factory configuration names only the shipped COMPLETE/MISSING_HISTORY snapshot variant and
SITE_A/BOTH own synthetic fixture principal. This is trusted LOCAL TEST/PRODUCT ASSEMBLY, not
a client-selected production identity, credential or real data grant. A SITE_A owner cannot
compile or execute a plan widened to SITE_B or the foreign tenant. No foreign sums/counts or
invoice IDs appear. Drilldown is known-overdue invoice grain, stable ordered, integer limit
1..20, with true authorized total and truncation rather than 1:n event rows.

Owner code pins exact shipped source and metric bytes. Source bytes/digests/SQL passed by a
caller are refused. Actual normalized documents, row keys and snapshot metadata are reread
from the actual database and checked against the private immutable snapshot identity.
A changed source under an old digest is denied; a new caller hash cannot replace that private
identity. Plan identity additionally binds metric version/bytes, mapper/query version,
actual SQL+parameters, source/snapshot/revision, cutoffs, scope and limit. Result revision
binds exact plan and actual result bytes. Retirement rejects pending execution and later
adapter projection. These hashes are content identity; live opaque issuance is authority.

Independent evidence and early consumer handoff

The Python per-invoice scalar oracle reads the original authored fixture, uses aware-datetime
comparisons and arbitrary-size integer arithmetic, and imports NO product mapper/SQL/result.
Its fixed fixture is tests/fixtures/business-bi/overdue-stock-oracle-v1.json. It covers the two
historical cutoffs, equivalent offsets, before/at/after monthly boundary, DST, later knowledge
restatement, one-site scope, genuine zero denominator and a complete nonzero stock result.
Actual product comparisons are separate from those independently computed expected values.

The early adapter schema is kaleidosphere.business-bi/overdue-stock-result-adapter/v1,
issued by buildOverdueStockResultAdapterV1. It preserves exact resultRevision, source/snapshot
and all plan/query/metric/result bindings and UNKNOWN/PARTIAL semantics. Intended consumers
PAN549/KS303 (later PAN607/PAN612) must use a protected owner read, not trust portable JSON as
runtime authority. Future voice/table/chart must reference that SAME result revision, not
recompute, rename or generate a fresh metric from a spoken label. No voice, browser, chart or
table UI implementation/acceptance is claimed by this core metric product. The core does not
wait for their full pairing, a foreign issue CLOSED, or a new human study.

Canonical registration: exactly one source-map.test.mjs imported-parent route; the byte-bound
package.json canonical command is unchanged. Focused product tests alone do not establish
full canonical/CI/merge/release/readback/Original317 CLOSED. Original303 remains OPEN on its
separately proven native PAN profile/analysis lifecycle blocker, with its exact held checkout
and PR314 preserved. Original281/289, source permissions, private/paused projects and the
other owners' files are not altered by this independent increment.
