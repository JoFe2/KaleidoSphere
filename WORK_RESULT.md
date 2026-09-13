# WORK_RESULT — KS150 / PG-KS-03: Deliver the missing PostgreSQL C2 safe-aggregate bytes

## NATIVE POSTMERGE FIX-FORWARD, GENERATION 3 (AC03 falsifier vacuity at `84b0fb42`)

This section records the third bounded postmerge correction. It is additive and preserves every
earlier record, the original issue/thread, every hard AC, and all historical raw evidence.

### Diagnosis of the exact retained blocker

The blocker is a **product-AC defect, not a gate/topology defect**: `PG-KS-03-AC03`'s falsifier is
"digest integrity passes while a wrong business result is accepted", and the committed AC03
RED/GREEN matrix did not actually exercise it. The two compute-sabotage arms (`unknownToZero`,
`semanticMutated`) built in-memory clones of the correct result and asserted only that each clone
`!==` the oracle. A clone that is never submitted to the executor is *trivially* unequal to the
oracle, so both assertions were tautologies: they would keep passing even if the runtime
oracle-equality gate were deleted. The only genuinely driven arm was row substitution, which is
AC02 holdout-digest binding, not the AC03 wrong-business-result falsifier.

The real runtime gate existed (`net-revenue-plan.mjs`, `BUSINESS_BI_ORACLE_MISMATCH`) but was never
reached by any test: the oracle and holdout byte streams are pinned to `ADMITTED_ORACLE_SHA256` /
`ADMITTED_HOLDOUT_SHA256` at compile time, so every semantic mutation collapsed into a digest
denial *before* the oracle-equality gate. Reproduced at the exact candidate: recomputing both clones
from the committed fixtures yields `notEqual === true` for both regardless of any product code.

### Correction (minimal, product-side, fail-closed)

- **`services/bi-control/src/business-bi/net-revenue-plan.mjs`** — added the closed compute
  fault-injection seam `NET_REVENUE_COMPUTE_FAULTS` (`UNKNOWN_TO_ZERO`, `SEMANTIC_SIGN_FLIP`,
  `ROW_SUBSTITUTION_DOUBLE_COUNT`) applied to the **computed** result inside
  `executeNetRevenuePlan`. It is an enumerated registry of deterministic corruptions — never a
  caller-supplied function, never a bypass of the source/digest/scope/receipt gates, and never
  reachable from product configuration, the descriptor, the certificate, or the real read path. An
  unregistered fault is refused with `BUSINESS_BI_EXECUTION_INPUT_DENIED`. The corrupted result
  still flows through the **same** `BUSINESS_BI_ORACLE_MISMATCH` gate.
- **`tests/postgresql-c2-safe-aggregate.test.mjs`** — replaced the tautological clone comparisons
  with arms that **submit** each registered fault to the real executor and assert the real
  `BUSINESS_BI_ORACLE_MISMATCH` denial, plus a genuine GREEN control (the same seam-free call
  completes oracle-exact), plus a fully re-digested wrong receipt rejected by the real
  `BUSINESS_BI_RESULT_SUBSTITUTION_DENIED` gate. Semantic mutation of the ground truth and row
  substitution remain bound to their own digest gates.
- **`scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs`** — re-binds the corrected
  `net-revenue-plan.mjs` (already a registered entry) and is itself re-content-addressed.
- **`SOURCE-MAP.json`** — regenerated with the repository updater (697 entries; only the three
  changed digests move).

### Mutation proof (RED caused by product behavior, not self-comparison)

Disabling the real `BUSINESS_BI_ORACLE_MISMATCH` gate turns the AC03 test RED (20 pass / 1 fail);
disabling `BUSINESS_BI_RESULT_SUBSTITUTION_DENIED` likewise turns it RED. Restored, the focused C2
suite is 21/21 pass. This is the property the previous matrix lacked.

### Certificate and frozen bytes

`node scripts/run-postgresql-c2-safe-aggregate-clean-room.mjs --dry-run` remains **byte-identical**
to the committed `verification/postgresql-c2-safe-aggregate-v1.json` (the seam is not reachable from
the certificate path). Every frozen C1 byte (`3faea403…`, `859970ca…`, `90866c86…`, `05014aaf…`),
the frozen `package.json`, and all canonical test registrations are unchanged.

### Gate result at this candidate

`npm test`: 1249 tests, 1247 pass, 2 fail. Both failures are **pre-existing host-tooling gaps**,
reproduced unchanged on the pristine stashed tree: `tests/security.test.mjs` needs `python3`
(absent), and `tests/release/validate-k4c-codex-plugin.test.mjs` needs an external plugin-creator
validator binary (absent → `ENOENT`). Neither is touched by, nor related to, this correction.


## NATIVE POSTMERGE FIX-FORWARD, GENERATION 2 (fresh PR-CI failure at `880d250b`)

This section records the second bounded postmerge correction. The generation-1 fix-forward (below)
correctly replaced an unsatisfiable ancestor claim, but its replacement check carried a NEW defect
that only a PR checkout host exposes. This section is additive and preserves every earlier record.

### Diagnosis of the exact fresh failed log

- Fresh failure: PR #232, CI run `34766568769` (job `103748479382`), head
  `880d250bcc5cd9c7152800b06ee715aa559544b3`, stage PR-CI `npm test`, conclusion `failure`.
  Retained log `/mnt/data2/ai/minimal-qwen-queue/fresh-state/gate-logs/ci-failure-f1375099433d...`
  (untrusted evidence): exactly one failing test, `tests/postgresql-c2-safe-aggregate.test.mjs:606` —
  `AssertionError: the tested head is not resolvable on Main: ancestry was replaced by squash`,
  `actual: true, expected: false`.
- That line was generation 1's "independent check 2", which asserted the tested-head commit object
  must NOT resolve. **Whether an object resolves is a property of the host, not of the repository.**
  GitHub's PR checkout (`actions/checkout@v4`, `fetch-depth: 0`) fetches the PR head ref and therefore
  RETAINS `28b50870...`, so `git rev-parse 28b50870...^{commit}` succeeds there; a clone that never
  fetched that ref does not have the object and the same call throws. The assertion therefore passed
  in the worker VM and failed on CI — a host-dependent flake.
- The check was also vacuous in the other direction: object absence proves nothing about whether the
  delivered bytes equal the tested bytes, so passing locally carried no real assurance.
- Independently reproduced both ways in this session: a real retained-head topology makes the old
  assertion fail, and a real dropped-object topology makes it pass, with no other difference.

### Correction (bounded, additive, no AC weakened)

- `tests/postgresql-c2-safe-aggregate.test.mjs`: check 2 is replaced by a host-independent form. A
  true existence probe (`git cat-file -e <sha>^{commit}`, which exits non-zero only when the object is
  genuinely absent) decides whether the tested-head object is retrievable. WHEN it is present — the
  real CI checkout — the recorded tested-head commit, tree, parent, and subject are verified against
  the actual object (strictly more verification). Whether or not it is present, only host-independent
  facts are asserted: the integrated squash commit's parent equals the recorded tested-head parent,
  the tested head is NOT an ancestor of HEAD (stable under the squash-only policy), and the delivered
  bytes are content-equivalent to the tested bindings. Absence is never asserted and presence is never
  required. The two other `--is-ancestor`/`merge-base` call sites were switched to the same stable
  probe so no check depends on the tested-head object existing.
- New regression tests (the positive/negative pair for this fix): two tests build the squash-only
  topology as REAL repositories — one retaining the tested-head object (CI host) and one with it
  deterministically dropped (clone host) — and prove the corrected check yields the same verdict on
  each. A third negative test builds a genuine ancestor-preserving merge topology and proves the check
  detects it as preserved, so the disposition is falsifiable rather than vacuously true.
- `verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json`: `ancestryNote` no longer
  claims the tested-head object "no longer exists … cannot be resolved". It now states that object
  retrievability is incidental and must not be asserted either way, and names the host-independent
  facts the gate actually checks. Self-digest recomputed to
  `2cea3db5b723b1b1fedc6527472006916177182820eea990b8d9694ded5ad2e5`.
- `docs/evidence/postgresql-c2-real-cleanroom/README.md`: records the host-independence correction and
  why the earlier "must not resolve" expectation failed on CI. New sha256
  `b2739ec7391c2a2233be22e764150597b08bf614119569b968fb549fa1d1dca3`.
- `SOURCE-MAP.json` regenerated with the repository tool
  `scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs`.
- Untouched: the C2 certificate `630096d4...`, every frozen C1 byte (`3faea403...`, `859970ca...`,
  `90866c86...`, `05014aaf...`), `package.json`, the C2 contract, the typed-plan module, the
  clean-room runner, and both retained raw evidence files. No test deleted, skipped, or weakened; the
  squash-only merge policy is unchanged.

### Commands and actual results

- Failing assertion independently reproduced on a retained-head topology; passing on a dropped-object
  topology (same code, only the host's object availability differs).
- GREEN focused: `node --test tests/postgresql-c2-safe-aggregate.test.mjs` -> **21 pass, 0 fail**.
- GREEN focused regression set:
  `node --test tests/source-map.test.mjs tests/canonical-test-topology.test.mjs tests/legacy-technical-identity-plan.test.mjs tests/postgresql-c1-certification.test.mjs tests/postgresql-c2-safe-aggregate.test.mjs`
  -> **136 pass, 0 fail**.
- Full canonical `npm test` in this VM -> **1249 tests, 1247 pass, 2 fail**; both failures are the
  pre-existing python3-absent environment cases (`tests/security.test.mjs`,
  `tests/release/validate-k4c-codex-plugin.test.mjs`), reproduced identically on unmodified `33beed8`.
  The generation-1 ancestry failure is gone.

## NATIVE POSTMERGE FIX-FORWARD (retained Main failure `bd39872a645605d5`)

This section is the record of the bounded postmerge fix-forward for the retained Main test failure.
It is additive: the original C2 delivery record (below) and every historical identity it carries are
preserved byte-for-byte in git history and are not rewritten.

### Diagnosis of the exact retained failed log

- Retained failure: `JoFe2-KaleidoSphere-150-postmerge-bd39872a645605d5`, stage `MAIN_TEST`,
  observed Main `33beed8f387216a73621e1ff1cb0354612fad0e1`, merge PR #231, reviewed head
  `4efa0f141590cf2e53c1e2a4771c15af79fbccde`, merge tree `fc545b02461fab5b4e251268755a4f7bdbf136ca`.
- Retained log (untrusted evidence, `/postmerge-evidence/7068a763...`): exactly one failing test —
  `tests/postgresql-c2-safe-aggregate.test.mjs:530` —
  `Error: Command failed: git merge-base --is-ancestor 28b50870d2ab360ebce76d524ab2636254382c22 HEAD`.
  The other 1240 tests passed; only this historical-ancestry assertion failed.
- Root cause (independently reproduced in this fresh clone): `28b50870...` is the **PR #231 head**
  commit. The repository permits squash merges only, so PR #231 was integrated as the single squash
  commit `33beed8` on Main. The tested head commit object was therefore discarded and does not exist
  in the clone (`git cat-file -t 28b50870...` -> `fatal: could not get object info`). The test's
  `--is-ancestor` assertion is **unsatisfiable under the repository's own squash-only merge policy**.
  The `fetch-depth: 0` CI "fix" in the same commit could not help: full-history checkout still cannot
  resolve an object GitHub never retained.
- This is a genuine **provenance-contract defect**, not a product defect: all C2 product bytes and
  all other C2/C1 AC gates were already green. The correct correction is to replace the unverifiable
  ancestor claim with independently checkable equivalent provenance, and to add positive/negative
  topology/tamper tests — never to delete, skip, or weaken the test, and never to change the merge
  policy or promise an ancestor-preserving merge.

### Correction (bounded, additive, no AC weakened)

- `verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json`: adds an explicit
  `integration` block (`recordKind: SQUASH_INTEGRATION_EQUIVALENCE`, `repositoryMergePolicy:
  SQUASH_ONLY`, `mergeMode: SQUASH`, `ancestryDisposition: REPLACED_BY_SQUASH`, the integrated
  commit `33beed8`, its parent `e5edb16`, the tested-head identities, and the equivalence/non-claim
  statement). The tested head `28b50870`, its tree `6f995105`, its parent, and its subject are
  preserved as recorded historical identities. The self-digest is recomputed
  (`1a25dc56d387e074d3c2e84611d8717cc59063fa529ac0b9adc6ee004f1e14eb`). `testedSourceVersusCandidate`
  now states the content-equivalence basis instead of an ancestor claim.
- `tests/postgresql-c2-safe-aggregate.test.mjs`: replaces the unsatisfiable `--is-ancestor` assertion
  with three independent checks that ARE resolvable on Main: (1) the integrated squash commit's parent
  is exactly the recorded tested-head parent; (2) the tested head is genuinely absent (ancestry was
  replaced) — asserted as a falsifiable expectation; (3) content equivalence — the C2 binding bytes are
  delivered by the squash integration, every pre-existing C1/fixture byte is untouched by it, nothing
  after the integration changes a bound byte outside the registration allowlist, and the delivered
  bytes carry exactly the digests the tested run bound. Adds three new tests: a positive squash
  topology proof, a negative forged-ancestor/tamper fail-closed test, and a readback/provenance
  disposition test. The C2 certificate (`630096d4...`), the frozen C1 bytes, and `package.json` are
  never touched.
- `docs/evidence/postgresql-c2-real-cleanroom/README.md`: records the squash ancestry disposition and
  the merge policy; its former "is an ancestor of the correction head" sentence is replaced (sha pin
  updated to `b9f5138f34201f61580f39f129d5feb14f7a882796c5a1c38053844bfac0a06e`).
- `.github/workflows/ci.yml`: comment corrected to state the true reason full history is needed; the
  `fetch-depth: 0` setting is retained. Content address updated in `SOURCE-MAP.json`.
- `SOURCE-MAP.md` / `SOURCE-MAP.json`: narrative and content addresses updated for the changed bytes.

### Commands and actual results

- RED reproduced locally: `node --test tests/postgresql-c2-safe-aggregate.test.mjs` -> 14 pass, 1 fail
  (`git merge-base --is-ancestor 28b50870... HEAD`).
- GREEN focused, local: `node --test tests/postgresql-c2-safe-aggregate.test.mjs` -> **18 pass, 0 fail**.
- GREEN focused regression set, local:
  `node --test tests/source-map.test.mjs tests/canonical-test-topology.test.mjs tests/legacy-technical-identity-plan.test.mjs tests/postgresql-c2-safe-aggregate.test.mjs tests/postgresql-c1-certification.test.mjs`
  -> **130 pass, 0 fail**.
- GREEN full canonical suite in the dedicated qwen-test VM (python3 + Docker present, real `.git`
  streamed verbatim): the exact `package.json#scripts.test` command -> **1246 pass, 0 fail**.
- Local sandbox note: two failures remain locally that are **environment-only and pre-existing**
  (`tests/security.test.mjs` needs `python3`; `tests/release/validate-k4c-codex-plugin.test.mjs` needs
  an unavailable infrastructure fixture). Both were confirmed failing on unmodified `33beed8` by
  stashing this change, and both pass in the qwen-test VM (13/13 in that pair; and the full 1246/1246
  above). They are not product defects and are not caused by this change.
- Frozen-byte non-regression: C1 profile `3faea403...`, C1 certificate `859970ca...`, C1 live matrix
  `90866c86...`, C1 live-matrix provenance identity `05014aaf...`, and the C2 certificate
  `630096d4...` all re-verified byte-identical; `git diff` on every frozen C1/C2 path is empty.

### Unresolved gates (owner/controller-owned — NOT PASS)

The retained failure is fixed and the canonical suite is green in the real test VM, but the full
delivery chain remains **NOT DELIVERED** and is owned by the controller/fresh reviewer:
live revalidation, exactly one independent exact-head review and one final owner, current-Main
integration and Root-QS, exact PR-head CI, SHA-bound squash merge, exact Main CI, release/no-release
receipt, controller-owned anonymous readback, public issue close, and Queue DONE. No public write,
push, credential use, or issue closure was performed by this worker, and no public receipt is claimed.

---

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
source-local and, truthfully, records the certificate's own snapshot of the moment of its
deterministic mint as `BLOCKED_EXTERNAL` (it is not a fabricated PASS and it was never relabelled).
It was NOT modified by this session. The real state of the AC02/AC03 clean-room work is evidenced
separately, truthfully and additively, by the retained 2026-09-12 dedicated-VM run bytes
(`.ks150-c2-real-cleanroom-primary-evidence.json` and
`.ks150-c2-real-cleanroom-post-restore-evidence.json`, both sha `b3c10b11...`) and by the separately
committed real-run provenance record
`verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json`, which binds those
original bytes to the tested source and the certified C1 substrate without rewriting any historical
certificate bytes.

In addition, under the current operator authorization (Qwen administers the dedicated Linux test
VM as root, without per-action parent approval; this supersedes the older parent-only TEST-EXECUTION
instruction, while leaving the product acceptance criteria and public-publication ownership
unchanged), the AC02/AC03 real positive/negative clean room was subsequently EXECUTED in that VM
(see the "Real VM clean room" section) against a newly created disposable loopback-only PostgreSQL
with synthetic non-customer data, and torn down with verified, ownership-scoped zero residue. That
execution produced real, reproducible evidence and did NOT modify the committed source-local
certificate, the frozen C1 bytes, or `package.json`. This candidate binds that real evidence to the
tested source itself (the provenance record and the human readback at
`docs/evidence/postgresql-c2-real-cleanroom/README.md`); the unbounded public delivery-chain steps
(exact PR-head/Main CI, SHA-bound merge, release/no-release receipt, controller-owned anonymous
readback, public issue close) remain the parent/owner's steps. There is no source-only C2 PASS, and
this record does not claim the delivery as delivered.

The AC03 test suite IS tracked and registered: it is committed byte-for-byte on this candidate, and
its canonical route in the frozen `package.json` topology is the exactly-one static import route
through its certified C1/C2 lifecycle sibling gate
(`tests/postgresql-c1-certification.test.mjs`), recognized additively by the CI-TOPOLOGY gate as the
second intentional imported-parent route. The frozen manifest bytes themselves — and hence the C1
`manifestSha256` binding, the committed deterministic C2 certificate, and the frozen C1 bytes — are
unchanged.

## Provenance and history invariants

- Launch head = current Main `e5edb16` (clean tree). No rebase, reset, amend, squash, or source
  substitution; the C2 commit lands on top of it.
- The committed AC03 suite enters the canonical graph through its certified C1/C2 lifecycle sibling
  gate (`tests/postgresql-c1-certification.test.mjs`), so canonical reachability stays exactly-one
  route without touching the frozen `package.json`, the frozen C1 bytes, or the committed
  deterministic C2 certificate.

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

Demonstrated RED -> GREEN by direct execution: the AC03 suite is written against the absent
module/certificate and passes only after the C2 bytes are in place (12 tests in the first coding
attempt; 15 tests after this registration correction).

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
  The retained real-run bytes are committed and bound to the tested source by the real-run
  provenance record; the deterministic source-local certificate keeps its historical
  `BLOCKED_EXTERNAL` cells truthfully (they describe its own mint moment and are never relabelled).
- **AC03 — oracle equality + sabotage RED/GREEN matrix.** DONE (12/12 by direct execution in the
  first attempt, 15/15 after the registration extension; exact equality also proven `EXACT` in the
  real VM clean room; the suite is tracked and canonically registered). Exact equality with the
  independent BI oracle is proven both source-locally and against the real read (`oracleEquality =
  EXACT`; the real-read result matched the committed oracle byte-for-byte on every period field),
  and the sabotage matrix fails closed: row substitution, semantic oracle mutation, and
  UNKNOWN-to-zero each fail closed to a distinct denial.
- **AC04 — separately-versioned certificate + C1 lifecycle regression.** DONE (source-local
  certificate minted, byte-stable and self-digested; the public delivery chain is PENDING the
  controller gates). The certificate is separately versioned, self-digested, and byte-stable; the
  lifecycle regression proves C2 revocation never modifies or rewrites the frozen C1 bytes.

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
   (repository convention; mirrors the KS228/KS149 updater). It content-addresses the C2 bytes, the
   committed AC03 suite, the two retained real clean-room evidence files, the real-run provenance
   record, the human readback path, the two canonical-route gate suites, the re-frozen inventory,
   and itself.
6. `tests/postgresql-c2-safe-aggregate.test.mjs` — the tracked canonical AC03 suite, extended in
   this correction (regression tests that bind the retained entirely, byte-identical real clean-room
   evidence to the tested head, the certified C1 substrate, and the committed certificate, and that
   prove the registration never rewrites the certificate or the frozen C1 bytes).
7. `verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json` and
   `docs/evidence/postgresql-c2-real-cleanroom/README.md` — the truthful binding/readback of the
   original 2026-09-12 dedicated-VM run bytes to the tested source, the certified C1 substrate, and
   the admitted fixture digests. The two original raw evidence files
   (`.ks150-c2-real-cleanroom-primary-evidence.json` and
   `.ks150-c2-real-cleanroom-post-restore-evidence.json`, both sha `b3c10b11...`) are committed
   byte-for-byte; their historical results are preserved, not deleted, replaced or relabelled.

## Additive inventory re-freeze (sanctioned pattern, 0 removed)

The frozen identity-inventory gate scans every tracked file. The C2 module and certificate carry the
PostgreSQL credential env name. Following the sanctioned additive re-freeze pattern established by
the C1 delivery, the canonical scan was re-run additively: preserving the frozen `schemaVersion` and
`baseCommit` anchors, verifying **0 removed**, then re-binding the inventory. First attempt:
`1040 -> 1043 (added 3, removed 0)`. This registration correction re-ran the canonical additive
scan at the correction head: `1043 -> 1046 (added 3, removed 0)` — the three additional occurrences
are the credential env names in the committed AC03 suite and in the two retained evidence files. No
frozen anchor changed, no occurrence was removed; this is a classification update, not a governance
weakening.

## Actual commands and results (previous session, recorded)

- Additive re-freeze (throwaway, untracked): `identity inventory: 1040 -> 1043 (added 3, removed 0)`
- `node scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs` ->
  `KS150 C2 source map updated: 6 authored files, 692 total entries`
- `node --test tests/legacy-technical-identity-plan.test.mjs tests/source-map.test.mjs
  tests/postgresql-c1-certification.test.mjs tests/postgresql-c2-safe-aggregate.test.mjs` ->
  **tests 45, pass 45, fail 0** (focused gates)
- `node --test tests/postgresql-c2-safe-aggregate.test.mjs` -> **tests 12, pass 12, fail 0**
  (AC03 suite, direct execution)
- `npm test` -> **tests 1228, pass 1228, fail 0** (canonical suite)
- Certificate self-digest via the shared identity hash: stored `95987472...` == derived
  `95987472...` (MATCH)
- Clean-room `--dry-run` byte-stability: dry-run sha `630096d4...` == committed cert sha `630096d4...`

## Actual commands and results (this registration-correction session, retained candidate at exact head `bfb06d32423d5bbada10863bbd9d2240200d92bb`)

- `node scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs` ->
  `KS150 C2 source map updated: 14 authored files, 697 total entries` (run again after the two
  canonical-route gate suites were extended)
- `node --test tests/postgresql-c2-safe-aggregate.test.mjs` -> **tests 15, pass 15, fail 0**
  (AC03 suite incl. the three registration tests, direct execution)
- `node --test tests/postgresql-c2-safe-aggregate.test.mjs tests/postgresql-c1-certification.test.mjs
  tests/source-map.test.mjs` -> **tests 59, pass 59, fail 0**
- `node --test tests/canonical-test-topology.test.mjs` -> **tests 61, pass 61, fail 0**
- `node --test tests/source-map.test.mjs tests/postgresql-c1-certification.test.mjs
  tests/canonical-test-topology.test.mjs tests/legacy-technical-identity-plan.test.mjs
  tests/postgresql-structure-scan.test.mjs` -> focused-integrity gate re-run after re-freezing
- `npm test` (canonical full suite) -> **tests 1243, pass 1241, fail 2**; both failures are
  environmental, not product: `tests/security.test.mjs` "shell and Python runtime sources parse"
  and `tests/release/validate-k4c-codex-plugin.test.mjs` "validator nonzero result is fail-closed",
  each failing only with `spawnSync ENOENT` for guest-side capabilities (`python3` binary, k4c
  `plugin-creator` validator binary) that this retention host does not have. The same two tests
  pass unchanged wherever those binaries exist (previous session: full suite 1228/1228 pass).
- Frozen bytes verified unchanged (sha256, first 16 hex chars; same values as recorded above).

### Real VM clean room (executed in the previous session, bytes committed here)

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
- Raw evidence recorded locally and committed byte-for-byte on this candidate (first commit
  `bfb06d3`): `.ks150-c2-real-cleanroom-primary-evidence.json` and
  `.ks150-c2-real-cleanroom-post-restore-evidence.json` (both sha `b3c10b11…`).

## Real VM clean room (AC02 / AC03) — executed in the dedicated test VM, actual outputs

Under the operator authorization, the AC02/AC03 real positive/negative clean room was EXECUTED in
Qwen's dedicated Linux test VM (root) against a newly created disposable loopback-only PostgreSQL
with synthetic non-customer data. The tested source head is the C2 commit
`28b50870d2ab360ebce76d524ab2636254382c22`, streamed to the guest verbatim via `tar` (no source
substitution). The committed source-local certificate was NOT modified: it keeps its historical
`BLOCKED_EXTERNAL` cells (its own mint snapshot) and is never relabelled; the real state of the
clean-room work is bound to the tested source additively by the separately committed real-run
provenance record and the human readback. The frozen C1 bytes and `package.json` were NOT touched by
the run.

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
and committed byte-for-byte on this candidate (first commit `bfb06d3`): the two raw files
`.ks150-c2-real-cleanroom-primary-evidence.json` and `.ks150-c2-real-cleanroom-post-restore-evidence.json`
(both sha `b3c10b11…`; identical because the post-restore real read is byte-reproducible). The
evidence file digest is the verifiable anchor for this record; the module's own digest bindings
above match the committed fixtures.

**Ownership-scoped zero-residue teardown (verified):** container `ks150-c2-pg` stopped + removed;
the run's exact-digest image (`94f23d40…`) and data volume (`8619b8bc…`) removed; all transient
`/root` artifacts (password file, seed SQL, live profile, backup, drivers, evidence) removed;
`docker ps` empty; `:5432` listener gone. Pre-existing VM artifacts (resident `postgres:16` image
`f1c3376c…`, pre-existing volume `e1ee81c7…`) were LEFT UNTOUCHED.

## Unresolved gates (external / controller-owned — NOT PASS)

1. **AC02/AC03 — real clean-room evidence: committed and bound; publication PENDING.** The real
   positive/negative clean room was executed in the dedicated test VM and its raw evidence is
   committed byte-for-byte on this candidate, bound to the tested head by the real-run provenance
   record. What remains is the unbounded public step (not performed here and not a promise that
   completes this candidate by itself): the controller-owned serialized GitHub publication and
   anonymous readback, plus the delivery chain in gate 2. No `BLOCKED_EXTERNAL` cell was relabelled
   and no PASS was minted locally.
2. **AC04 unbounded public delivery chain.** PENDING: live revalidation, focused gates, exactly one
   independent review (owned by the fresh independent reviewer) and one final owner, current-Main
   integration and Root-QS, exact PR-head CI and SHA-bound merge, exact Main CI and
   release/no-release receipt, controller-owned anonymous readback, public issue close, and Queue
   DONE. These are owned by the controller/parent and are not performed by this worker (no push, no
   public mutation, no issue closure).

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
- Nonclaims preserved: no general analytics suite, no free SQL, no inference that C1 implies C2,
  no other PostgreSQL profile, no production/customer/HA/scale/all-versions claim.
