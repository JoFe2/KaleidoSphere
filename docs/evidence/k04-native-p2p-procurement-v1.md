# K04 procurement quantity / price / time — exact public synthetic routes

This adds only the #286 business increment. No invoice matcher, productive writes,
source-use authority, portable role or raw invoice-document rights are invented.
The existing K03/O2C source and all original/historical proof pins are preserved.

## Exact independently specified reference

Original #286 and frozen COMMON-TRADE-01 specify PO-01 /line1, ARTICLE-A /WH-01,
EUR /STK: ten at62 rather than60 EUR,20 EUR variance, eight timely of ten
accepted. The reused native PAN516/ERV input emits one invoice grain62000 versus
expected60000 EUR-minor. Two receipts are aggregated before that invoice grain;
the invoice amount is not multiplied. Receipt-assigned promise revision1 remains
in time evidence when the supplier later confirms another promise/price revision.

## Execute the product

    node scripts/run-procurement-analysis.mjs --fixture COMMON-TRADE-01
    node scripts/run-procurement-analysis.mjs --fixture COMMON-TRADE-01 --view chart
    node scripts/run-procurement-analysis.mjs --fixture COMMON-TRADE-01 --view export

The first route reads only the exact bundled SHA256-pinned reference. It declares
NOT_EXECUTED_LOCAL_COMMON_REFERENCE_ONLY, not real producer pairing. Aggregate-only
permission never exposes chart/drilldown/export surfaces. Files/parents are opened
nonblocking/no-follow via pinned Linux directory descriptors; nonregular, symlinked,
changed, oversized and path-traversal sources are refused. Caller roles are not flags.

For the actually qualified public producer and a disposable COMMON-only native root:

    node scripts/run-procurement-analysis.mjs --producer-source /qualified/public/pan-checkout --native-root /disposable/common-root

The producer is provisioned separately, not bundled: public Git commit
cf199bbd35706bdeadb04679af7354c94caf482a, tree
e8e75614ffb8f1d71a6715413386bfd5619e1c3e, exact23-file native runtime/contract
closure and built-contract pin in contracts/dependencies/pan520-p2p-source-v1.json.
Read/build qualification is not arbitrary native root/source permission. The API
load/capture/read path requires real producer checks plus source-owned WeakMap
handles. No provider double, fixture invoice fallback or counterpart CLOSED gate.

## Executed boundaries

The focused five-suite owner run:44PASS/0FAIL/0SKIP, including eight actual native
pair/CLI cases. It executes complete quantity/price/time and the real CLI CSV;
unknown native confirmation preserves accepted10 while invoice/price/time facts
remain unavailable. Cutoff to June25 keeps accepted8/onTime8 but price UNKNOWN
because native invoice business date is absent. Source/control/request-bound plans
read current facts, not an old snapshot; actual read-time revoke denies all surfaces.
Foreign PO/unit/currency/SQL/caller roles and forged/cloned handles are denied.

Local negative tests additionally refuse invoice fanout/duplicate receipts,
unsafe/negative/fractional numerics, executable getters/proxies, foreign composite
scope, malformed dates/offsets and microsecond late receipts. A timeless ledger or
missing accepted/promise timestamp leaves time UNKNOWN, not zero-late; known
quantities still work. Table/chart/CSV/drilldown share exact rows, separate STK and
EUR_MINOR scales, null unknown cells and no raw-invoice access. Formatting-only
views explicitly cannot turn pair/rights metadata into native source authority.

Required CI provisions the same public producer with credentials cleared and runs
all five suites; canonical parent registration executes each suite once. These are
owner technical execution claims, not fabricated independent review, hosted CI,
release or whole-issue acceptance. The autonomous delivery authorization requires
those exact later CI/merge/release/anonymous product gates before closure; Main's
independent post-check is nonblocking. No source, publisher or human-reading gate
is inferred from the public fixture.
