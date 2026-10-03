# K03 — additive invoice-date / original-dispatch profile

Scope: KaleidoSphere issue #285 and the exact public COMMON-TRADE-01 revision 1 in PANSPHAIRA issue #520. This additive entry does not import, modify or reinterpret the accepted ORDER_DATE metric, its plan, or the legacy order-source contract.

## Actual entry and results

Node 24 on Linux. Run from the released repository root:

    node scripts/run-invoice-date-o2c.mjs --fixture KS-ORIGINAL-500-700 --period-start 2026-06-01 --period-end 2026-08-01
    node scripts/run-invoice-date-o2c.mjs --fixture COMMON-TRADE-01 --mapping common-snake-reference/v1 --period-start 2026-06-01 --period-end 2026-08-01
    node scripts/run-invoice-date-o2c.mjs --fixture COMMON-TRADE-01 --mapping ks-camel-fixture/v1 --period-start 2026-06-01 --period-end 2026-08-01

The distinct KS original yields June/July billed net 500/700 EUR. Both COMMON naming/shape mappings yield 800/100 EUR. Each yields separately 1000 EUR order intake, 80% quantity dispatch timeliness and 0% position dispatch OTIF after the late remaining two units. Missing customer-receipt evidence remains UNKNOWN; dispatch is never customer receipt. Mapping equivalence is not a second vendor or approved context.

`--view aggregate|chart|drilldown|export|all` selects the output. Chart is actual standalone SVG, export actual CSV stdout, not a write permission or a simulated file. Table, signed document drilldown, SVG data values and CSV rows derive from the same validated snapshot; credits use their own invoice date. The rendered caption keeps currency/date semantics and the non-order-intake statement visible.

## Boundaries and negative execution

Period start is inclusive and end exclusive. Order acceptance uses the declared business timezone. Dispatched quantity/open quantity are observed before the same exclusive cutoff for orders accepted in the period. Original promise revision 1 must be evidenced: later-only/truncated history and a renegotiated scalar cannot improve past OTIF. The bounded EUR/STK profile refuses overshipment rather than returning negative open quantity or an above-100 percentage.

Only ISSUED invoice/credit documents are billed. Composite order/document/shipment keys must be unique and scoped. Credits reference an issued invoice at the same order position. Absolute minor money is safe-integer validated and summed with BigInt; missing/invalid invoice date, calendar normalization, offset-less event time, mixed scope/currency/unit and overflow fail closed. Receipt/return join fan-out cannot increase billed net. Normalizers retain explicit foreign warehouse/item/unit and order-position facts rather than silently inheriting the local scope.

The CLI does not accept caller roles, free source paths or universal mapping claims. A trusted bundled synthetic-fixture grant separately controls aggregate/chart/drilldown/export; revoked operation rights refuse before opening source data. Source digests and declared IDs/revisions are checked. Catalog and source reads are bounded regular-file reads; Linux parent directory descriptors are pinned with O_NOFOLLOW, and FIFO, symlink, absolute/traversing path, replaced parent and byte-drift inputs refuse without partial outputs. This is not a general host filesystem sandbox or arbitrary connector admission.

Run all four actual source/CLI suites:

    node --test tests/invoice-date-o2c-journey.test.mjs tests/invoice-date-o2c-negatives.test.mjs tests/invoice-date-o2c-views.test.mjs tests/invoice-date-o2c-boundary.test.mjs

They are canonically reachable exactly once through the unchanged source-map parent and explicitly executed in required hosted CI. Historical suites/skips and accepted release evidence remain separate; local tests do not imply hosted CI or delivery acceptance.

## Producer qualification and nonclaims

The public synthetic fixture path is executable; it is not a PAN P06 producer run. At this candidate, `producerPairing` deliberately remains `NOT_EXECUTED_LOCAL_FIXTURE_ONLY`. Actual producer execution requires the precise existing PAN owner's immutable executable P06 candidate, its field/snapshot/grant identity and a separately pinned positive/negative pairing receipt. Neither a schema match, old ORDER_DATE producer, metadata-only profile nor PAN CLOSED substitutes for that run.

Independent exact-delta acceptance, required CI, merge, functional release and anonymous product readback remain delivery gates. Issue #285 stays OPEN until all non-waived original criteria, including genuine P06 execution, are met. No private-source permission, #250 second context, human study, Marketplace acceptance or empirical business benefit is asserted. Rollback disables only this new O2C entry; the old operation remains unchanged.

Primary authority: https://github.com/JoFe2/KaleidoSphere/issues/285 and https://github.com/JoFe2/PANSPHAIRA/issues/520. Exact external receipts and renderer probes are retained in private delivery custody, not converted to fabricated public PASS records.
