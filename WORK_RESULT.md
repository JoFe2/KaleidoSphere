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

## Review correction (blocker)
A review blocker found that the historical C1 evidence had been re-minted despite an explicit
preservation requirement. The minimal correction keeps the selector and its coverage but removes the
side effects that forced the re-mint:

- the seven selector tests were migrated into the existing `tests/runtime-config-canonical-int.test.mjs`
  suite, so `package.json#scripts.test` needed no registration change;
- the newly introduced standalone selector test file was removed after migrating its coverage;
- `package.json`, the BI falsification clean-room script, and the historical C1 evidence file were
  restored byte-for-byte to base (no re-mint); the C1 certificate's `manifestSha256`/`certificateSha256`
  revert to their historical values and remain internally consistent because `package.json` is also restored.

The selector implementation and the additive legacy-identity inventory occurrence are preserved.

## TDD / verification
The seven behavioral assertions (v2 querypack selection, bounded v2 catalog policy equality against the
committed fixture and the v2 pack manifest query ids, exact v1/absent default preservation, fail-closed
on every other value, preserved scope/policy/session/credential restrictions, analyze-profile validation
for both profiles, and postgresql-only scoping) were migrated verbatim into
`tests/runtime-config-canonical-int.test.mjs` and pass there (15/15 in that suite, 8 prior + 7 migrated).

## Files (final, base → corrected)
- `services/bi-control/src/runtime-config.mjs` — selector + fail-closed lookup (kept)
- `tests/runtime-config-canonical-int.test.mjs` — 7 selector tests migrated in (no standalone file)
- `docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json` — one added classified
  occurrence (the bounded catalog-scan-policy schema id now also appears in `runtime-config.mjs`);
  purely additive at its exact sorted position, `baseCommit` untouched (kept)
- `SOURCE-MAP.json` — `tests/runtime-config-canonical-int.test.mjs` re-hashed; `package.json`,
  `scripts/run-business-bi-falsification-clean-room.mjs`, and
  `verification/postgresql/postgresql-c1-evidence-v1.json` restored to their base hashes; the removed
  standalone selector test entry deleted. Every entry still matches on-disk bytes.
- `package.json`, `scripts/run-business-bi-falsification-clean-room.mjs`, and
  `verification/postgresql/postgresql-c1-evidence-v1.json` — byte-equal to base (unchanged)

## Commands and results (actual)
  sha256(package.json) == 2cb58003f79fd891275105484f5eac72753d60e98024a6f4863ee54295f06efd  (== base)
  sha256(scripts/run-business-bi-falsification-clean-room.mjs) == 06c1ef14… (== base)
  sha256(verification/postgresql/postgresql-c1-evidence-v1.json) == 3358208f… (== base)
  git diff base -- <those 3 files> → empty (byte-equal)
  node --test tests/runtime-config-canonical-int.test.mjs → 15/15 pass
  node --test <focused set: runtime-config-canonical-int, postgresql-c1-certification, source-map,
              canonical-test-topology, business-bi-clean-room, legacy-technical-identity-plan>
              → 114/114 pass (exit 0)
  npm run build → "consumer-support-manifest build gate: VERIFIED" (exit 0)
  npm test      → tests 1206, pass 1206, fail 0 (exit 0)
  git diff --check → clean

## Constraints honored
No DB connections, containers, services, credentials, publication, push or issue closure.
No governance changes; no tests removed or weakened (the seven selector assertions are preserved,
relocated into the canonical-int suite). Historical C1 evidence preserved, not re-minted. Local commit only.