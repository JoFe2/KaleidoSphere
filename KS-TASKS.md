# KS236-238 tasks — F4 positive local composition

Owner gate: `/workspace/.deepseek-domain-owner` == `deepseek-domain` (verified).

## Done (this work)

- [x] F4 positive local composition implemented as the previously-missing "#237 -> #238"
      CLI path. New surface: `services/bi-control/src/business-bi/net-revenue-f4-composition.mjs`
      + `scripts/run-net-revenue-f4-composition.mjs` + fixtures
      (`net-revenue-f4-composition-v1/v2.json`) + `tests/net-revenue-f4-composition.test.mjs`.
- [x] Reads a REAL local PostgreSQL source (injected PGlite) whose ledger kernel maps
      through the FROZEN #237 profiles (`ledger-mapping-v1`/`v2`) and whose #238
      `status`/`segment` extension (declared separately, read from the same source rows,
      never invented) feeds the #238 comparison.
- [x] Both REAL local PGlite mappings reproduce byte-identical kernel + comparison digests
      and reconcile to the #238 independent values (delta net revenue 21000).
- [x] Negative paths through the SAME entry point: wrong source/layout
      (`LEDGER_KIND_DENIED:undefined`), wrong mapping (`LEDGER_KIND_DENIED:not_a_kind`),
      wrong unit ambiguous (`LEDGER_UNIT_SCALE_AMBIGUOUS`), wrong unit scale
      (`LEDGER_UNIT_SCALE_MISMATCH`). UNKNOWN/missing-data preserved (unquantified UNKNOWN,
      not coerced).
- [x] Registered in SOURCE-MAP.json (`scripts/update-f4-composition-source-map.mjs`),
      `tests/source-map.test.mjs`, `tests/canonical-test-topology.test.mjs`; README + ROADMAP
      updated. Full `npm test` green (1304 passing).
- [x] F3 keep: intake / open-orders remain unsupported (`null`). No intake-event or
      historical status/as-of semantics invented.

## Still open (exact remaining acceptance boundaries — parent-owned)

- [ ] Human reader-comprehension evidence: the `Reader-task protocol` items in
      `docs/evidence/net-revenue-f4-composition-v1.md` (and the #236/#238 reader tasks)
      have NOT been executed by a human. Machine evidence only; human evidence stays open.
- [ ] Real PANSPHAIRA provenance/compatibility: NOT claimed and NOT activatable here. The
      #238 source stays `HELD` (null release fields). The HELD production profile is never
      unlocked by this work.
- [ ] Public delivery / merge / release / push: NOT performed. Hermes owns targeted
      acceptance, integration and public delivery.

## Non-goals honoured (unchanged)

- No parallel framework; reuses #237 profiles + #238 comparison + C2 serializer.
- No public writes, no push/merge/release, no other workspaces, no provider/runtime or
  historical queue changes.
- Synthetic DI source explicitly marked `SYNTHETIC`; ingestion stays `XRA_KS01_RELEASE_HELD`.
- intake/open-order order-key figures remain unsupported while real semantics are absent.
