# KS236-238 handoff — F4 positive local composition

## What landed

The previously-unimplemented positive local F4 composition is now implemented and tested:
a real local source -> frozen #237 mapping profile -> #238 segment comparison, one usable
CLI (`node scripts/run-net-revenue-f4-composition.mjs`). See
`docs/evidence/net-revenue-f4-composition-v1.md`.

Tested green through the ACTUAL entry point (not fixture-digest or shapevalidator alone):

```sh
node --test tests/net-revenue-f4-composition.test.mjs      # 11 pass incl. real PGlite both layouts
node scripts/run-net-revenue-f4-composition.mjs --layout both           # synthetic fallback
node scripts/run-net-revenue-f4-composition.mjs \
  --pglite /workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js \
  --layout both --negative                                     # REAL PostgreSQL, both mappings
npm test                                                     # 1304 pass
```

Verified results:
- both layouts -> identical kernel digest `f827f71a...` and comparison digest `5a82dce2...`;
- comparison delta net revenue 21000 (net 45000 -> 66000), gross sale 50000 -> 72000;
- negatives deny fail-closed through the same path (wrong source/mapping/unit codes above).

## What is preserved / NOT touched

- The #150 C2 metric core, the holdout serializer, and the C2 clean-room records are
  byte-identical (source-map digest pins unchanged).
- #237 frozen profiles (`ledger-mapping-v1/v2`) and their negative gate are reused
  unchanged; #238 comparison reused unchanged.
- package.json unchanged (byte-bound canonical `npm test`; PGlite stays injected).

## What remains open (do not mark complete)

1. Human reader-comprehension evidence — open (machine evidence only).
2. Real PANSPHAIRA provenance / compatibility — NOT claimed; #238 source stays HELD;
   HELD production profile never unlocked.
3. Public delivery: no push/merge/release. Hermes owns acceptance, integration, delivery.

See KS-TASKS.md for the exact acceptance boundaries.
