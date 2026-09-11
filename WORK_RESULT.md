# WORK_RESULT — KS149 / PG-KS-02: Certify PostgreSQL C1 on the regular Analyze-to-Readback product path

This file is the delivery record for the NEW, ordinary, credential-free worker attempt on
JoFe2/KaleidoSphere issue #149 (PG-KS-02). It supersedes the prior `WORK_RESULT.md` in this
working tree, which was the record of a predecessor delivery and is treated as untrusted
historical material, not as evidence of this attempt.

## Boundary (credential-free worker)

This worker does not hold credentials, does not access a real database, does not publish a
port, does not run Docker or any other external system, and does not invent a live result. The
live C1 matrix is *built*, not *executed*, here: the parent live operator owns the running
isolated PostgreSQL 16.x server and executes it. A missing live result is recorded below as an
unresolved, parent-owned prerequisite and is **never marked PASS**. There is **no source-only
C1 PASS**: the full issue remains subject to AC01–AC04.

## Provenance and history invariants

- `LAUNCH_BASE = a4f874ac06894bc7a90a4d7b810c13b81d1a3632` (recorded in `/tmp/ks149-launch-base.txt`).
- Only the scoped public ref `refs/heads/ks149-source/retained-0727e734` was fetched
  anonymously; commit `0727e734a73a709215167e288caa75dbd5b28682` verified and normally merged.
- Merge commit `e4ec9df1f1933df3505d7558d00ff44cd6f3b9fa` (parent work is committed on top of it).
- Verified: both `LAUNCH_BASE` and the retained SHA are ancestors of the delivered head
  (`git merge-base --is-ancestor` → YES for each).
- No rebase, reset, amend, squash, cherry-pick, source substitution, or selector rebuild. Merge
  conflicts were resolved as the semantic union of both sides; derived integrity (SOURCE-MAP) was
  regenerated with repository tools only.

## Product work delivered (clean, committed)

1. **Regular PostgreSQL product deployment / configuration + file-secret wiring.** The regular
   product path for `BI_ENGINE=postgresql` is now fully wired end-to-end in the shipped
   deployment:
   - `compose.yaml` — `bi-control` now receives the `POSTGRESQL_*` runtime block (host, port,
     database, user, exact `POSTGRESQL_SCHEMAS` scope, `POSTGRESQL_SSL`, connect/query timeouts,
     `POSTGRESQL_STRUCTURE_QUERY_PACK=v2`, and `POSTGRESQL_PASSWORD_FILE=/run/secrets/postgresql_password`)
     and declares `postgresql_password` in its `secrets:` list and in the top-level `secrets:` map
     (file-backed, `.secrets/postgresql_password`), mirroring the existing MSSQL/Oracle pattern.
   - `.env.example` — documents the `postgresql` engine choice, the `POSTGRESQL_*` defaults with
     `POSTGRESQL_STRUCTURE_QUERY_PACK=v2` (the certified C1 structure scan), and the
     `.secrets/postgresql_password` secret-file convention.
   - `bin/bi` — `setup` now creates `.secrets/postgresql_password` (mode 0600). The
     `./bin/bi analyze` entrypoint is preserved unchanged.
   - `package.json` is **not** modified (frozen): the byte-bound C1 certificate pins
     `release.manifestSha256 == sha256(package.json)`, so the new runner is invoked directly, not
     via a new `package.json` script.

2. **C1 live positive/negative matrix runner (parent-executable).**
   - `scripts/run-postgresql-c1-live-matrix.mjs` — drives the *regular* product path through the
     repository's own modules: `buildLiveProfile` (exact v2 structure query pack) →
     `runAnalyzeProfile` (descriptor-bound dispatch, product secret binding enforced) →
     `renderAnalyzeEvidence` → `buildStructureMapOutputs`. It provisions a disposable clean room
     (two throwaway databases `ks149_c1`/`ks149_c1_denied`, two throwaway least-privilege roles
     `ks149_scan`/`ks149_denied`, schema `ks149_app`) on the operator's server, runs the AC01/AC02/AC03
     matrix, tears the clean room down, verifies the teardown in-process, privacy-scans every emitted
     artifact for credential/DSN leakage, and only then writes the evidence file and human readback.
     Any assertion failure tears the clean room down and exits non-zero **without** writing evidence.
   - `scripts/run-postgresql-c1-live-matrix.sh` — parent-executable wrapper that validates the
     environment contract (host exactly `127.0.0.1`, in-range non-reserved port, owner password
     file mode 0600), runs `npm --prefix services/bi-control ci --ignore-scripts`, and runs the
     `.mjs` runner. It creates/destroys **no** Docker container, network, or volume (the parent owns
     the running isolated PG16.x server).
   - The runner writes `verification/postgresql/postgresql-c1-live-matrix-v1.json` and
     `docs/evidence/postgresql-c1-live-matrix/README.md` **only** on a fully successful parent-executed
     live run. It never relabels the frozen source-local C1 certificate
     (`verification/postgresql/postgresql-c1-evidence-v1.json`).

3. **Source-map content addressing.**
   - `scripts/update-ks149-pg-c1-live-matrix-source-map.mjs` — delivery-specific updater (repo
     convention; mirrors `scripts/update-m6-05-source-map.mjs`) that content-addresses the two runner
     files and itself, and re-hashes the changed regular-product wiring (`compose.yaml`, `bin/bi`).
   - `SOURCE-MAP.json` — 683 entries after the update (was 680), `localeCompare`-sorted, atomic
     temp+rename write. The two live evidence artifacts are deliberately **not** added (they do not
     exist until the parent runs the matrix). `.env.example` remains intentionally outside the
     curated map (pre-existing convention; it is one of the 78 tracked-but-map-absent files).
   - The frozen source-local C1 certificate bytes are unchanged (still bound in the map and matching
     disk; the full re-hash scan reports 0 stale).

## Actual commands and results (this session)

- `node --check scripts/run-postgresql-c1-live-matrix.mjs` → SYNTAX_OK
- `bash -n scripts/run-postgresql-c1-live-matrix.sh` → SYNTAX_OK
- `scripts/run-postgresql-c1-live-matrix.sh` with missing required env → `KS149_ERROR`, **exit 1**
  (no DB, no Docker, no secret read)
- `scripts/run-postgresql-c1-live-matrix.sh` with `KS149_PG_HOST=10.0.0.5` → `KS149_ERROR: …loopback-only`,
  **exit 1**
- Source-local AC03 fail-closed cells re-executed DB-free (pure functions, no secrets/DB), all exact:
  - stale descriptor → `DB_ANALYZE_DESCRIPTOR_STALE`
  - scope substitution → `DB_ANALYZE_SCOPE_OVERRIDE_DENIED`
  - cross-engine secret substitution → `DB_ANALYZE_SECRET_BINDING_MISMATCH`
  - no broadened dispatch (mutation) → `DB_QUERY_MUTATION_DENIED`, dispatches 0
  - no broadened dispatch (raw row) → `DB_QUERY_ROW_SOURCE_DENIED`, dispatches 0
- `node scripts/update-ks149-pg-c1-live-matrix-source-map.mjs` → "5 authored files, 683 total entries"
- Full SOURCE-MAP re-hash scan → entries 683, **stale 0**, missing 0, `localeCompare`-sorted
- `node --test tests/source-map.test.mjs` → **16/16 pass**, fail 0
- `npm run build` → "consumer-support-manifest build gate: VERIFIED" (exit 0)
- `node --test` PostgreSQL C1 family (9 suites: adapter, c1-certification, e2e,
  product-dispatch, structure-scan, wave2 profile/profile-canonical-number/relationships/workflow)
  → **57/57 pass**, fail 0
- `npm test` → **tests 1217, pass 1217, fail 0** (exit 0)
  — recorded at the pre-commit working tree in which the live-matrix runner was still
  untracked; it does **not** reproduce at the committed `1caeb99` bytes. Superseded by
  the "Correction — committed-candidate integrity" section below.
- `git merge-base --is-ancestor a4f874a… HEAD` → YES; `git merge-base --is-ancestor 0727e734… HEAD` → YES

File digests (sha256) recorded for the new/changed files at this working-tree state:
```
628cf6a1ca150c7c836a37e1427b72bf0cc6c44073dfac41ff84e2600d6fffa4  scripts/run-postgresql-c1-live-matrix.mjs
29b0c549f700f93ce6ea2f0c9d63987568f714d963a3618d1d4f6957a1e5253d  scripts/run-postgresql-c1-live-matrix.sh
5c501447beced57fcca2abd6e8d68c9c3a84b68ed47f00d4d4b745debd3b92cd  scripts/update-ks149-pg-c1-live-matrix-source-map.mjs
f702c7ed62edabc33b814a89043c92f5e631b5f1014b0f98b81b830467620356  compose.yaml
9d80f54f23e93b3453269fcb238af31250aac424ef999086ff5b6511a6a5270a  bin/bi
d800239f528f31b8c4ff6a7840a0de8dcd8c24aa820da6b0d63f07051f76eca1  .env.example
7938cee1a3fc814a5c89b7007804442aeb9b9e65c31ef3f0ad5ebaa263e54256  SOURCE-MAP.json
```

## Correction — committed-candidate integrity (this correction session)

The candidate committed at `1caeb99d55d2186d0a52d7759cdb2a9d44bc0438` failed one canonical
gate, and its recorded receipt did not reproduce at the committed bytes. Both facts are
recorded honestly here. The correction is derived-integrity regeneration only: no product,
test, certificate, or audit bytes were changed; `package.json` is unchanged; no test was
weakened; no history was rewritten (the correction is a normal new commit on top of
`1caeb99`; no rebase, reset, amend, squash, or cherry-pick).

**What failed at `1caeb99` (reproduced before correcting):**

- `node --test tests/legacy-technical-identity-plan.test.mjs` → **3 pass / 1 fail**
  (AssertionError deepStrictEqual on "tracked legacy technical identities exactly match the
  classified inventory").
- Full `npm test` → **tests 1217, pass 1216, fail 1** (the same canonical test).
- Root cause: the candidate added the tracked file `scripts/run-postgresql-c1-live-matrix.mjs`,
  which carries the password environment identity twice, while
  `docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json` had been
  updated for only the earlier single schema-identity occurrence (live scan 1035 vs
  inventory 1033).
- Consequence: the receipt line above (`npm test → tests 1217, pass 1217, fail 0`)
  describes a state that is not the delivered bytes. It is superseded below by results
  that reproduce at the corrected HEAD.

**Correction (minimal, repository conventions only):**

1. Re-ran the canonical inventory scan exactly as defined by the frozen test
   `tests/legacy-technical-identity-plan.test.mjs` (same exclusions, same patterns, same
   git-tracked file source, same codepoint sort) against the committed tree. The frozen
   `schemaVersion` and `baseCommit` anchors were preserved unchanged. The scan added
   exactly the two missing environment occurrences for
   `scripts/run-postgresql-c1-live-matrix.mjs` (1033 → 1035) and removed none; the
   regeneration tool refuses to run if the scan would remove any occurrence.
2. Rebound the inventory's content-addressed entry in `SOURCE-MAP.json` to the regenerated
   bytes, following the repository updater convention (raw-bytes sha256, files table still
   `localeCompare`-sorted, atomic unique-temp + rename write). All other `SOURCE-MAP.json`
   anchors (`sourceCommit`, `oracleSourceCommit`, `releasePathClasses`, the other 682 file
   hashes) are byte-identical; the files entry count stays 683.
3. `WORK_RESULT.md` corrected as described here. No push, no API mutation, no queue write.

**Actual commands and results (correction session, post-correction tree):**

- [regenerate inventory via the canonical scan] → occurrences **1035** (was 1033), added 2,
  removed 0; baseCommit preserved (`a709582278c0d5bc35c09cd2f89808b6b1d242d6`)
- [rebind the inventory entry in `SOURCE-MAP.json`] → previous `d19ec197…aaf8a`, current
  `3c137d5c…d0fc`; files entries 683 (unchanged), anchors preserved, localeCompare-sorted
- `node --test tests/legacy-technical-identity-plan.test.mjs` → **4/4 pass**, fail 0
- `node --test tests/source-map.test.mjs` → **16/16 pass**, fail 0
- Full `npm test` → **tests 1217, pass 1217, fail 0** (exit 0) — now reproduces at the
  corrected bytes
- `npm run build` → "consumer-support-manifest build gate: VERIFIED" (exit 0)
- `git diff --check` → clean
- Ancestry (read-only `git merge-base --is-ancestor`): `1caeb99d55d2186d0a52d7759cdb2a9d44bc0438`
  → YES; `0727e734a73a709215167e288caa75dbd5b28682` → YES; LAUNCH_BASE `a4f874a…` → YES

File digests (sha256) of the corrected files at this working-tree state (superseding the
`SOURCE-MAP.json` digest `7938cee1…7666` in the block above; all other digests in that
block remain valid):
```
3c137d5c2f2e46479f8eb4a17712ab16b258e7aaa9ab7d9f895fcc8ecb5fd0fc  docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json
fff7aa0238a4f272a0757853da0378b94f1af3dd36440a436d57c85c507f7666  SOURCE-MAP.json
```

The live matrix prerequisite below is unchanged by this correction: still parent-owned,
still not executed, and still never marked PASS.

## Unresolved prerequisite (parent-owned) — NOT executed, NOT PASS

The **live** C1 execution is not performed by this credential-free worker and has not been
performed at all yet. The remaining AC01–AC03 *live* proof (real disposable clean-room connect +
role readback + denied write probe; exact-profile real-source positive run + authoritative readback;
real negative matrix with post-cancel health / no-follower) is a **parent-owned prerequisite**:

- The parent live operator owns a running, isolated PostgreSQL 16.x server bound to `127.0.0.1`.
- Resume trigger: the parent runs
  `scripts/run-postgresql-c1-live-matrix.sh` with the contract environment
  (`KS149_PG_HOST=127.0.0.1`, `KS149_PG_PORT=<port>`,
  `KS149_PG_OWNER_PASSWORD_FILE=<mode-0600 file>`, optional `KS149_PG_OWNER_USER` /
  `KS149_PG_ADMIN_DATABASE`). The runner then provisions the clean room, runs the matrix, tears it
  down, and writes the live evidence artifacts only on full success.
- Until that live run succeeds, AC01–AC04 remain open and the issue is **not** certified. The missing
  live result is identified here and is **never** marked PASS. The source-local certificate and the
  source-local test/gate results above do not, by themselves, certify C1.

## Constraints honored

No push, no API mutation, no model-authored approvals or receipts, no queue writes, no test
weakening, no scope change, and no delivery claim in this record. No KS150/C2, customer/production,
HA/scale, or untested auth/version claims. No secrets in this record (the runner's canary
credentials are random, used only in-memory against the parent's server, and never written to the
repository). Local commit only.