# K03 actual native PAN520 pair — additive to accepted invoice-date examples

Frozen producer: JoFe2/PANSPHAIRA commit cf199bbd35706bdeadb04679af7354c94caf482a, tree e8e75614ffb8f1d71a6715413386bfd5619e1c3e. Main's candidate-only public integration branch makes this exact source fetchable without authentication; no PAN merge, release or CLOSED prerequisite is implied. The native contract SHA256 is fcff403d002b1b877a895e0c8c1b4c9532e9785acdc300310e997fe76835f85e.

The consumer verifies the actual Git HEAD/tree, clean tracked source and the committed 23-file native import/built-contract closure before import, planning and use. It invokes the actual native capturePan520ProjectionPlan/executePan520ProjectionRead seam. The native read checks the current source grain and durable STOP/REVOKE controls at use. Source metadata, cloned plans/handles, caller roles, SQL, credentials and approval claims are not authority. Only disposable COMMON-TRADE-01 O2C is admitted; this does not admit procurement/K04, other sources, raw documents or productive writes.

From the KS checkout, with an exact built public producer checkout and an existing authorized disposable COMMON native root:

    node scripts/run-pan520-o2c-consumer.mjs --pan-source-root "$PAN520_SOURCE" --native-root "$COMMON_NATIVE_ROOT" --period-start 2026-06-01 --period-end 2026-08-01 --view all

Views: all, table, chart (real standalone SVG), drilldown (scoped fact/snapshot lineage only), export (real CSV). Every invocation performs a fresh actual native opaque read. The JSON, chart data/bars, permitted fact lineage and CSV reconcile to the same native facts. REVOKE after a successful planned read refuses every subsequent materialization with null views and no partial success. The historical direct read is not replaced.

Actual native source facts: the current DRAFT order-source value is 100000 EUR minor units, not accepted intake or billed net. Eight timely units over ten give 80% quantity dispatch timeliness. After the actual late remaining two units, the native original-dispatch position OTIF is false/0%. An incomplete native position may remain UNAVAILABLE; customer receipt remains unavailable without its own evidence/promise. Native operational date and explicitly mapped COMMON reference time are not business-acceptance events.

Native outbound bills/monthly bill totals and business acceptance are absent. These remain UNAVAILABLE with their producer reasons and null values, never 0, 500/700, 800/100, or an invented 1000 accepted intake. An as-of historical read also retains unavailable price-valid-time history. Requested period is disclosed separately: this P06 source snapshot has no period-start filter and is not a complete invoice-date-period aggregate. No unsupported period or document grain is invented.

The accepted local invoice-date core, original 500/700 example, separate COMMON 800/100 mappings, and their reviews remain unchanged. This native crossing separately addresses the real P06 path required by original #285 AC4; it does not replace AC1/AC5 fixtures or claim a second context/vendor permission.

    KS285_PAN520_SOURCE="$PAN520_SOURCE" node --test tests/pan520-o2c-pair.test.mjs

The exact native pair suite is canonically imported once through tests/source-map.test.mjs, with the frozen package manifest unchanged. Required CI fetches the exact public commit, verifies HEAD/tree, runs npm ci --ignore-scripts and a fresh build, executes the real native pair from KS cwd, and exports the verified root for the canonical tests. No stub, skip fallback, private path, credential or CLOSED gate is used.

Focused local/native pair evidence is not final release acceptance. Exact final canonical/hosted CI, original criteria acceptance, merge/Main CI, a new functional release and anonymous exact downloaded-product execution remain the delivery contract.
