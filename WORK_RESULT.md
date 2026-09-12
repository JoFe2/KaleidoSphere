# WORK_RESULT — KS150 / PG-KS-03: Deliver the missing PostgreSQL C2 safe-aggregate bytes

This file is the delivery record for the worker attempt on JoFe2/KaleidoSphere issue #150 (PG-KS-03):
deliver the missing PostgreSQL C2 safe-aggregate capability on current Main, within the recorded
KS150 scope, without weakening any original PG-KS-03 acceptance criterion. It supersedes the prior
`WORK_RESULT.md` in this working tree, which was the record of the predecessor C1 (#149 / PG-KS-02)
delivery and is treated as untrusted historical material, not as evidence of this attempt. The prior
C1 record remains recoverable from git history (commits `e5edb16` and `648e0dc`).

## Boundary (source-local product + authorized real clean room)

The C2 product bytes are source-local and were proven source-locally: the regular product path is
exercised against the deterministic committed holdout and the exact independent BI oracle. The
separately-versioned certificate is the canonical AC04 deliverable; its committed form is
source-local and records the real, live, disprovable PostgreSQL clean room as a recorded
`BLOCKED_EXTERNAL` prerequisite (it byte-binds the AC03 test and is never a fabricated PASS). It was
NOT modified by this session.

In addition, under the current operator authorization (Qwen administers the dedicated Linux test
VM as root, without per-action parent approval; this supersedes the older parent-only TEST-EXECUTION
instruction, while leaving the product acceptance criteria and public-publication ownership
unchanged), the AC02/AC03 real positive/negative clean room was subsequently EXECUTED in that VM
(see the "Real VM clean room" section) against a newly created disposable loopback-only PostgreSQL
with synthetic non-customer data, and torn down with verified, ownership-scoped zero residue. That
execution produced real, reproducible evidence and did NOT modify the committed source-local
certificate, the frozen C1 bytes, or `package.json`. The canonical certificate re-mint that
incorporates this real evidence, and the full delivery chain (review, integration, CI, merge, issue
close), remain the parent/owner's steps. There is no source-only C2 PASS, and this record does not
claim the delivery as delivered.

The AC03 test suite is proven by direct execution and is deliberately NOT registered in the frozen
`package.json` (the C1 certificate byte-binds that manifest; a new canonical suite would change its
sha and break the frozen C1 certification gate). The canonical `npm test` total is therefore
unchanged.

## Provenance and history invariants

- Launch head = current Main `e5edb16` (clean tree). No rebase, reset, amend, squash, or source
  substitution; the C2 commit lands on top of it.
- No new canonical test-suite registration (frozen `package.json`); the AC03 suite is proven by
  direct execution and left untracked.

## RED — the missing behavior, demonstrated before the fix

At the launch head the entire C2 capability was absent (verified with `git cat-file -e`):
```
ABSENT at e5edb16: contracts/connectors/postgresql/c2-safe-aggregate-v1.json
ABSENT at e5edb16: services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs
ABSENT at e5edb16: verification/postgresql-c2-safe-aggregate-v1.json
ABSENT at e5edb16: scripts/run-postgresql-c2-safe-aggregate-clean-room.mjs
ABSENT at e5edb16: scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs
```
and the frozen C1 certificate explicitly declared `c2` a NON-capability and recorded
`realDisprovablePostgresql.state = BLOCKED_EXTERNAL`.

Demonstrated RED -> GREEN by direct execution: the AC03 suite (12 tests) is written against the
absent module/certificate and passes 12/12 only after the C2 bytes are in place.

## Acceptance criteria (PG-KS-03) and status

- **AC01 — versioned C2 safe-aggregate contract.** DONE. The contract names exactly one net-revenue
  aggregate operation (`bi-ks-01-net-revenue/v1`) with its exact supported semantics — relation
  `synthetic_bi.orders`, `ORDER_DATE` date role, inclusive-both-ends period boundaries, and closed
  digest-bound output columns — and marks every other method UNSUPPORTED under a closed set. It binds
  the certified C1 profile and the frozen C1 certificate, and is enforced by a capability-manifest /
  runtime parity test (the AC03 suite plus the existing safe-analysis method-parity suite).
- **AC02 — typed-plan execution.** DONE (source-locally proven AND proven by the real VM clean room
  executed this session — see "Real VM clean room"). The module runs through the regular product
  path against the certified C1 profile (frozen certificate `859970ca...` / profile `3faea403...`)
  under the same read-only least-privilege principal, budget, timeout, cancel, and evidence
  controls, with typed-plan digest binding and a seven-code fail-closed set. In the real clean room
  the product path ran LIVE (`productPath.mode = LIVE`, `runtimeValidation = RUNTIME_VALIDATED`),
  the real `SELECT` re-serialized to exactly the admitted holdout, and the receipt was `COMPLETE`.
  The canonical certificate re-mint that records this real evidence is the parent/owner's step
  (PENDING); the committed source-local certificate stays `BLOCKED_EXTERNAL`.
- **AC03 — oracle equality + sabotage RED/GREEN matrix.** DONE (12/12 by direct execution; exact
  equality also proven `EXACT` in the real VM clean room; canonical registration BLOCKED by the
  frozen manifest). Exact equality with the independent BI oracle is proven both source-locally and
  against the real read (`oracleEquality = EXACT`; the real-read result matched the committed oracle
  byte-for-byte on every period field), and the sabotage matrix fails closed: row substitution,
  semantic oracle mutation, and UNKNOWN-to-zero each fail closed to a distinct denial.
- **AC04 — separately-versioned certificate + C1 lifecycle regression.** DONE (source-local cert
  minted; the full delivery chain is PENDING the external clean room). The certificate is separately
  versioned, self-digested, and byte-stable; the lifecycle regression proves C2 revocation never
  modifies or rewrites the frozen C1 bytes.

## Product work delivered (clean, committed)

1. `contracts/connectors/postgresql/c2-safe-aggregate-v1.json` — AC01: exactly one SUPPORTED
   net-revenue aggregate operation and six UNSUPPORTED methods under a closed set; binds the C1
   profile and the frozen C1 certificate; binds the metric/holdout/oracle digests.
2. `services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs` — AC02: the typed-plan
   execution module. Exports the seven fail-closed codes, the C1/C2 path and frozen-sha constants,
   holdout serialization plus serializer-binding verification, contract validation, C1 profile
   binding, credential-route and read-only-principal assertions, the safe-aggregate runner, the
   fail-closed probes, the real-read and session-proof builders, and the certificate builder
   (self-digested via the shared identity hash).
3. `scripts/run-postgresql-c2-safe-aggregate-clean-room.mjs` — the source-local clean-room runner
   (`--dry-run`, `--profile`, `--holdout`); its `--dry-run` output is byte-identical to the committed
   certificate; it is source-local (no external route).
4. `verification/postgresql-c2-safe-aggregate-v1.json` — AC04: the separately-versioned certificate
   (self-digested; binds the tested product/release/contract/fixtures; records the execution, the
   seven fail-closed codes, the `BLOCKED_EXTERNAL` non-claims, and the frozen C1 lifecycle bytes).
5. `scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs` — the pure source-map updater
   (repository convention; mirrors the KS228/KS149 updater). It content-addresses the four C2 bytes
   plus the re-frozen inventory and itself.

## Additive inventory re-freeze (sanctioned pattern, 0 removed)

The frozen identity-inventory gate scans every tracked file. The C2 module and certificate carry the
PostgreSQL credential env name. Following the sanctioned additive re-freeze pattern established by
the C1 delivery, the canonical scan was re-run additively: preserving the frozen `schemaVersion` and
`baseCommit` anchors, verifying **0 removed**, then re-binding the inventory. Result:
`1040 -> 1043 (added 3, removed 0)` — the three additive occurrences are the credential env names in
the C2 module (two) and the certificate (one). No frozen anchor changed, no occurrence was removed;
this is a classification update, not a governance weakening. The re-freeze scan was performed by an
untracked throwaway so its own scan-logic bytes could not self-classify into the inventory.

## Actual commands and results (this session)

- Additive re-freeze (throwaway, untracked): `identity inventory: 1040 -> 1043 (added 3, removed 0)`
- `node scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs` ->
  `KS150 C2 source map updated: 6 authored files, 692 total entries`
- `node --test tests/legacy-technical-identity-plan.test.mjs tests/source-map.test.mjs
  tests/postgresql-c1-certification.test.mjs tests/postgresql-c2-safe-aggregate.test.mjs` ->
  **tests 45, pass 45, fail 0** (focused gates)
- `node --test tests/postgresql-c2-safe-aggregate.test.mjs` -> **tests 12, pass 12, fail 0**
  (AC03 suite, direct execution)
- `npm test` -> **tests 1228, pass 1228, fail 0** (canonical suite, unchanged total)
- Certificate self-digest via the shared identity hash: stored `95987472...` == derived
  `95987472...` (MATCH)
- Clean-room `--dry-run` byte-stability: dry-run sha `630096d4...` == committed cert sha `630096d4...`

### Real VM clean room (executed this session)

- `docker run` a disposable container from the exact C1-declared digest image
  `postgres@sha256:94f23d40…` (PG 16.10), loopback `127.0.0.1:5432`, db `ks_fixture`, SCRAM; apply
  the 17-row holdout + the read-only least-privilege role (`__PGPASS__` substituted from a 0600
  file).
- Streamed the tested head `28b5087…` to the guest verbatim (`tar`), ran the regular product path
  against the live profile + real secret: receipt `state = COMPLETE`, `rowsRead = 17`,
  `bindings.holdoutSha256 = 2d0ba0bb…` (== committed holdout), `oracleEquality = EXACT`
  (`current.netMinorUnits 100059`, `comparison.netMinorUnits 30000`), session proof
  `transactionReadOnly=on / defaultTransactionReadOnly=on / adminCapabilities=false`, all 7
  fail-closed codes fired.
- Backup/restore/rollback: `pg_dump --no-owner --no-privileges -t synthetic_bi.orders` (sha
  `8b7de3b6…`) -> `DROP TABLE` + re-apply -> row count 17 before/after; re-ran the real read post
  restore (still `COMPLETE` / `EXACT`); read-only `UPDATE` denied
  (`cannot execute UPDATE in a read-only transaction`), count stayed 17.
- Zero-residue teardown: container + run's image (`94f23d40…`) + run's volume (`8619b8bc…`) + all
  `/root` artifacts removed; `docker ps` empty, `:5432` gone; pre-existing `postgres:16`
  (`f1c3376c…`) and pre-existing volume (`e1ee81c7…`) left untouched.
- Raw evidence recorded locally (untracked): `.ks150-c2-real-cleanroom-primary-evidence.json` and
  `.ks150-c2-real-cleanroom-post-restore-evidence.json` (both sha `b3c10b11…`).

Frozen bytes verified unchanged (sha256, first 16 hex chars):
```
3faea403a4e81732  contracts/connectors/postgresql/c1-profile-v1.json
859970ca6e4ac23b  verification/postgresql/postgresql-c1-evidence-v1.json
90866c86b344c204  verification/postgresql/postgresql-c1-live-matrix-v1.json
40b6d1ae6a249b51  verification/postgresql/postgresql-c1-live-matrix-provenance-v1.json
9b524b4d3ed6a1ee  docs/evidence/postgresql-c1-live-matrix/README.md
5f8eac55337f60e5  package.json
630096d44765665b  verification/postgresql-c2-safe-aggregate-v1.json
```

## Real VM clean room (AC02 / AC03) — executed in the dedicated test VM, actual outputs

Under the operator authorization, the AC02/AC03 real positive/negative clean room was EXECUTED in
Qwen's dedicated Linux test VM (root) against a newly created disposable loopback-only PostgreSQL
with synthetic non-customer data. The tested source head is the C2 commit
`28b50870d2ab360ebce76d524ab2636254382c22`, streamed to the guest verbatim via `tar` (no source
substitution). The committed source-local certificate was NOT modified (it stays `BLOCKED_EXTERNAL`
and byte-binds the AC03 test); this section records the real execution evidence the parent/owner
incorporates when they re-mint the canonical certificate (a delivery-chain step, not performed
here). The frozen C1 bytes and `package.json` were NOT touched by the run.

**Substrate (exact, matching the certified C1 profile `3faea403…`):** image
`docker.io/library/postgres@sha256:94f23d40…` (PostgreSQL 16.10), loopback-only
`127.0.0.1:5432`, database `ks_fixture`, SCRAM-SHA-256. Read-only least-privilege principal
`kaleidosphere_read_only_analyzer` (`NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
NOBYPASSRLS`; `default_transaction_read_only = on`; `GRANT CONNECT` on `ks_fixture`; `GRANT USAGE`
on `synthetic_bi`; `GRANT SELECT` on `synthetic_bi.orders` only). The 17-row fixture is the committed
net-revenue holdout (SYNTHETIC_NON_CUSTOMER_BYTES).

**Positive proof** (regular product path; `productPath.mode = LIVE`,
`runtimeValidation = RUNTIME_VALIDATED`; `descriptor = postgresql.run-queries / postgresql.read-only
session / preflight.coverage-ledger`):
- The real `SELECT … FROM synthetic_bi.orders ORDER BY order_id LIMIT $1` (17 rows, `BEGIN READ
  ONLY`, `rowBudget 17` / `byteBudget 4096`) re-serialized to EXACTLY the admitted holdout:
  `bindings.holdoutSha256 = 2d0ba0bb806e73a473688d6137c6182f4233aec1bed92aee708c4a052d327a4d`
  (== committed `net-revenue-holdout-v1.json` sha `2d0ba0bb…`); receipt `state = COMPLETE`,
  `reasonCode = null`, `rowsRead = 17`.
- The computed net-revenue result matched the independent BI oracle EXACTLY (`oracleEquality =
  EXACT`; `bindings.oracleSha256 = ce0c1353…` == committed `net-revenue-oracle-v1.json`):
  `current.netMinorUnits 100059`, `comparison.netMinorUnits 30000`, `deltaMinorUnits 70059`,
  `excludedOutOfScopeCount 3`, `current.saleMinorUnits 141293`, `comparison.saleMinorUnits 35500`.
- Typed-plan digest binding: `planSha256 90bca7ef1833…`, `operationSha256 1a538833c6cd…`,
  `metricContractSha256 455f735e55f0…`, `holdoutSha256 2d0ba0bb…`, `oracleSha256 ce0c1353…`.
- Evidence controls held: `accessMode READ_ONLY`, `mutationAuthority false`,
  `readOnlyEvidence VERIFIED`, `bounded true`, `timeoutAware true`, `cancelAware true`.
- Session proof: `transactionReadOnly = on`, `defaultTransactionReadOnly = on`,
  `adminCapabilities = false`.
- Frozen-substrate check: `c1ProfileMatchesFrozen = true`, `c1CertificateMatchesFrozen = true`
  (profile `3faea403…`, certificate `859970ca…`).

**Negative proof** (all seven fail-closed probes fired to the expected distinct denial codes):
`badSecret -> DB_ANALYZE_CREDENTIAL_MISSING`, `scopeSubstitution -> BUSINESS_BI_OPERATION_DENIED`,
`crossEngineSecretSubstitution -> DB_ANALYZE_SECRET_BINDING_MISMATCH`,
`staleDescriptor -> DB_ANALYZE_DESCRIPTOR_STALE`, `rawRowSource -> BUSINESS_BI_SOURCE_SCOPE_DENIED`,
`mutationStatement -> BUSINESS_BI_READ_ONLY_EVIDENCE_DENIED`,
`readOnlySessionViolation -> DB_ANALYZE_PRINCIPAL_NOT_READ_ONLY`.

**Recovery proof (backup / restore / rollback):** `pg_dump --no-owner --no-privileges -t
synthetic_bi.orders` (67 lines, sha `8b7de3b6…`), then `DROP TABLE` + re-apply; row count 17 before
and after restore. Re-ran the real read through the regular product path after restore: receipt
`state = COMPLETE`, `oracleEquality = EXACT`, identical net-revenue result (byte-reproducible across
the restore cycle). The read-only principal's mutation attempt was denied in-transaction
(`ERROR: cannot execute UPDATE in a read-only transaction`); row count stayed 17 (no mutation
residue).

**Real-clean-room capture (tied to tested head `28b5087…`):** the full raw evidence was recorded
locally as untracked scratch files `.ks150-c2-real-cleanroom-primary-evidence.json` and
`.ks150-c2-real-cleanroom-post-restore-evidence.json` (both sha `b3c10b11…`; identical because the
post-restore real read is byte-reproducible). The evidence file digest is the verifiable anchor for
this record; the module's own digest bindings above match the committed fixtures.

**Ownership-scoped zero-residue teardown (verified):** container `ks150-c2-pg` stopped + removed;
the run's exact-digest image (`94f23d40…`) and data volume (`8619b8bc…`) removed; all transient
`/root` artifacts (password file, seed SQL, live profile, backup, drivers, evidence) removed;
`docker ps` empty; `:5432` listener gone. Pre-existing VM artifacts (resident `postgres:16` image
`f1c3376c…`, pre-existing volume `e1ee81c7…`) were LEFT UNTOUCHED.

## Unresolved gates (external / parent-owned — NOT PASS)

1. **AC03 canonical-suite registration.** BLOCKED by the frozen `package.json` topology: the C1
   certification gate byte-pins `package.json`, and the C1 machinery live-binds its `manifestSha256`
   to the working manifest; registering a new canonical suite would change the manifest sha and
   re-mint the frozen C1 certificate. The AC03 suite is therefore proven by direct execution and
   left untracked. This is a topology constraint, not a weakened gate.
2. **AC02/AC03 real live clean room — EXECUTED (real evidence recorded); canonical re-mint
   PENDING.** The real positive/negative clean room (newly created disposable loopback-only
   PostgreSQL, SCRAM, read-only least-privilege principal, backup/restore/rollback,
   ownership-scoped zero-residue teardown) was EXECUTED in the dedicated test VM this session and
   produced the real evidence recorded in the "Real VM clean room" section. What remains is the
   parent/owner's step: re-minting the canonical separately-versioned certificate to incorporate
   this real evidence (the committed source-local certificate stays `BLOCKED_EXTERNAL` and
   byte-binds the AC03 test until that re-mint; it is never a fabricated PASS), plus the delivery
   chain in gate 3.
3. **AC04 full delivery chain.** PENDING: live revalidation, focused gates, one independent review
   and one final owner, current-Main integration and Root-QS, exact PR-head CI and SHA-bound merge,
   exact Main CI and release/no-release receipt, controller-owned anonymous readback, public issue
   close, and Queue DONE. These are owned by the parent/owner and are not performed by this
   source-local worker (no push, no public mutation, no issue closure).

## Constraints honored

- No push, no public mutation, no credential exposure, no issue closure. The only external system
  used was Qwen's dedicated test VM, under the explicit operator authorization (scope-bound to that
  test system; the host and unrelated systems were not touched). It was torn down to verified
  zero residue.
- No test or governance weakening: the frozen C1 bytes, the frozen `package.json`, and all canonical
  gates are unchanged; the additive inventory re-freeze removed 0 occurrences; the committed
  source-local certificate was NOT modified.
- No fabricated receipts or secret exposure; no `BLOCKED_EXTERNAL` cell is relabeled PASS; the real
  clean-room evidence is real and reproducible (captured sha `b3c10b11…`), not a relabel.
- Non-claims preserved: no general analytics suite, no free SQL, no inference that C1 implies C2,
  no other PostgreSQL profile, no production/customer/HA/scale/all-versions claim.