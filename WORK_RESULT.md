# WORK_RESULT — POSTGRESQL_STRUCTURE_QUERY_PACK selector

## Change
Added an optional `POSTGRESQL_STRUCTURE_QUERY_PACK` selector to `buildLiveProfile`
(`services/bi-control/src/runtime-config.mjs`), postgresql engine only:

- absent or exact `v1` → historical v1 structure scan, profile byte-identical to before (no `catalogScan` key)
- exact `v2` → selects the existing v2 index querypack (`queryPack: {version: "v2"}`) and its existing
  bounded catalog policy (the committed v2 structure fixture's `catalogScan` block: 7 allowed query ids,
  maxQueries 7, maxRowsPerQuery 64, maxTotalRows 256)
- any other supplied value (case variants, whitespace, non-string, empty, prototype-polluted keys) fails
  closed with `CONFIG_POSTGRESQL_STRUCTURE_QUERY_PACK_INVALID`

Exact-match Map lookup over `v1`/`v2` only. mssql and oracle branches untouched (still historical v1);
profile schema, scope/auth/session restrictions and the existing v2 querypack unchanged (not rebuilt).

## TDD
RED (pre-fix, test at its pre-rename path):
  node --test tests/postgresql-structure-query-pack-selector.test.mjs
  → 4 pass / 3 fail — v2 selection still returned v1 with no catalogScan; invalid values were accepted
GREEN (post-fix, after rename to the codepoint-legal slot):
  node --test tests/postgresql-v2-structure-query-pack-selector.test.mjs
  → 7/7 pass

## Files
- `services/bi-control/src/runtime-config.mjs` — selector + fail-closed lookup
- `tests/postgresql-v2-structure-query-pack-selector.test.mjs` — new, 7 behavioral tests
- `package.json` — canonical `scripts.test` registration at its codepoint slot
- `scripts/run-business-bi-falsification-clean-room.mjs` — matching frozen-preimage strip for the new
  registration (BI-KS-03 immutable preimage stays replayable)
- `verification/postgresql/postgresql-c1-evidence-v1.json` — re-minted via
  `node scripts/run-postgresql-c1-clean-room.mjs`; diff shows only `manifestSha256`
  (`2cb58003…` → `dd60b126…`) and the derived `certificateSha256` (`58ca14a8…` → `693c693c…`);
  all other bindings and all four nonclaims byte-stable; `realDisprovablePostgresql` remains
  `BLOCKED_EXTERNAL` — synthetic source wiring only, NOT real DB certification
- `SOURCE-MAP.json` — content-map entries re-hashed for the files above, the new test file, and the inventory
- `docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json` — one added classified
  occurrence (the bounded catalog-scan-policy schema id now also appears in `runtime-config.mjs`);
  purely additive at its exact sorted position, `baseCommit` untouched

## Commands and results (actual)
  node --test tests/postgresql-v2-structure-query-pack-selector.test.mjs   → 7/7 pass
  node --test <focused set: selector, postgresql-c1-certification, source-map,
              canonical-test-topology, business-bi-clean-room,
              runtime-config-canonical-int, legacy-technical-identity-plan> → 114/114 pass
  npm run build → "consumer-support-manifest build gate: VERIFIED" (exit 0)
  npm test      → tests 1206, pass 1206, fail 0 (exit 0)
  git diff --check → clean

## Constraints honored
No DB connections, containers, services, credentials, publication, push or issue closure.
No governance changes; no tests removed or weakened. Local commit only.