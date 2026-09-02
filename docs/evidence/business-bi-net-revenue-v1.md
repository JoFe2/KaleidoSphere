# BI-KS-03 net-revenue clean-room falsification v1

Task: `PORTFOLIO-KS147-FALSIFICATION`

## Bounded public claim

Exactly one admitted-holdout metric, synthetic net-revenue v1, passed the local
clean-room falsification. This is a non-production, synthetic-only claim. It is
not a claim for a second metric, general BI, customer data, a live source,
Superset, a dashboard, publication, release, issue closure, or Queue closure.

Counts are intentionally reported in separate namespaces:

- 3/3 satisfied criteria.
- 1 delivered local evidence package.
- 0 published packages.
- 1 admitted synthetic holdout metric; 0 production metrics.

## Frozen clean-room identities

The product under test is exact KaleidoSphere Main/release commit
`764d0f7a1bad9e8e407b96e1b2340baa1e001af6`, tree
`e5c6b82aba35a0f760a497c78cf4826dfbb3d104`. Local `main` and `origin/main`
must remain at that commit. The accepted falsification candidate is exact commit
`2d99fff473c60d9c271aa2dad85329a9cc6d40ca`, tree
`4fbea5e80e57493c0c14f552b30682324f10fcff`: exactly one child commit with only
the four evidence paths listed below. The integration head is exactly one
mechanical child of that accepted candidate. A dirty index/worktree, another
parent, moved Main ref, extra commit, deletion, or unclassified path is denied.

| Identity | Frozen value |
| --- | --- |
| synthetic input | `sha256:2d0ba0bb806e73a473688d6137c6182f4233aec1bed92aee708c4a052d327a4d` |
| metric contract | `sha256:455f735e55f03155c657dc963656ed01363e546345824dfea66b883c287d9d70` |
| compiled plan | `sha256:90bca7ef18339928f1dd70bcfc5288e853045bd5f08776c700a7c863ec4526a8` |
| independent oracle bytes | `sha256:ce0c135351a8179f08cfca77b91a9624f2f6a7e16fd81cda8c3aba780f4a9164` |
| independent oracle calculator | `sha256:2aac1ef285ac0e8637786507dd7d03fd0bcf0e4bc0ebe8e875085071bb3a17b5` |
| exact result | `sha256:ab756c46131ab8d1be491b5ef7f082587fc1475a7fff4f20443966e97cbe02fc` |
| COMPLETE coverage | `sha256:aae3a6a637b58cb5eb340bebcbaa5f75ae333cade1a6438b548ebeaee7e55338` |
| normalized Node environment | `sha256:ae82ec35cbb149f52da9d6a2cf281ec8f2412c0a87015c545a5393b494627575` |
| isolated run evidence | `sha256:35e5f4210a7f7bfb35e3f446a8342ebc8cf4a65f155d8d4a164e4ca3933110f4` |
| checked verification | `sha256:24e753c8c4e50121f8fb561f5253c27cd8ea5f63b81783b1c7e9249b4b8ac637` |

The environment identity fixes Node `v24.19.0`, modules ABI `137`, Linux x64,
little-endian byte order, the package bytes, and the canonical-JSON
implementation bytes. The oracle calculator identity binds the inline
calculator in `tests/business-bi-metric-oracle.test.mjs`; its oracle metadata
records zero production-analysis imports. The exact release package bytes are
reconstructed only by removing the one canonical clean-room test registration
from the integrated package and must equal the frozen Main digest. This keeps
source-archive verification independent of local Git object availability.

## Falsification sequence

Every denial is run twice and compared byte-for-byte before final GREEN. Each
denial has `ordinaryAnswer: null`, `result: null`, and
`successfulOrdinaryAnswer: false`.

| Ordinal | Sabotage | Observed fail-closed result |
| ---: | --- | --- |
| 1 | `WRONG_ORACLE` | `BUSINESS_BI_ORACLE_DIGEST_DENIED` |
| 2 | `SUBSTITUTED_METRIC` | `BUSINESS_BI_METRIC_DIGEST_DENIED` |
| 3 | `WIDENED_SCOPE` | `BUSINESS_BI_OPERATION_DENIED` |
| 4 | `UNKNOWN_TO_ZERO` | `BUSINESS_BI_RESULT_SUBSTITUTION_DENIED` |
| 5 | `CANCELLED_ROW_INCLUSION` | `BUSINESS_BI_RESULT_SUBSTITUTION_DENIED` |
| 6 | `DIRTY_OR_UNBOUND_BYTES` | dirty-worktree and holdout-digest component denials |
| 7 | `MOVED_HEAD` | `BUSINESS_BI_CLEAN_ROOM_MOVED_HEAD_DENIED` |
| 8 | `ENVIRONMENT_SUBSTITUTION` | `BUSINESS_BI_CLEAN_ROOM_ENVIRONMENT_DENIED` |
| 9 | `FINAL_GREEN` | one-row `COMPLETE`, oracle equality `EXACT` |

The UNKNOWN sabotage fully re-addresses a forged receipt after replacing the
quantified UNKNOWN amount with zero. The cancelled-row sabotage fully
re-addresses a forged result that adds a cancellation-derived minor unit. Both
are still rejected against the independently bound oracle. The dirty/unbound
case separately proves both dirty-context denial and exact-input-byte denial.

Two positive executions receive fresh byte copies and fresh context copies, so
there is no shared mutable input between them. Their canonical evidence is
3,031 bytes in each run and is byte-identical at the isolated-run digest above.
The admitted result remains exact-cent integer data: comparison net 30,000,
current net 100,059, delta 70,059, aggregate UNKNOWN quantified amount 1,977,
and unassigned UNKNOWN quantified amount 1,200.

## Process and authority boundary

Operating Model v1.1 and decisions D-001 through D-007 remain preserved; no
process variant is introduced. The worker performs no source connection,
credential use, real/customer-data access, network call, write to a source,
push, merge, publication, release, anonymous readback, issue closure, or Queue
mutation.

Exactly one independent integrated review slot is recorded as
`PENDING_CONTROLLER`. Exactly one final owner, Sol, is recorded as
`PENDING_CONTROLLER` for fix-forward through exact PR/Main CI, release,
anonymous readback, issue CLOSED, and Queue DONE. The local GREEN does not claim
that any of those public-closure stages occurred.

The public claim is confined to `README.md`. The four paths below are classified
as evidence in `SOURCE-MAP.json` and are required in the source release archive;
the classes are disjoint and cannot include `SOURCE-MAP.json` or a closure-audit
receipt, preventing a cyclic self-hash. The accepted #146 verification and local
gate receipt remain byte-exact at
`sha256:9a962e48ea2d4252d208a03900a92bb4e0d337b9ae30fc2819b7dcce4ba445e7`
and
`sha256:314459ef8ee132efb924c3aa95767127a94d20d91403747ac443b4706810c918`,
respectively.

The candidate write allowlist is exactly:

- `tests/business-bi-clean-room.test.mjs`
- `scripts/run-business-bi-falsification-clean-room.mjs`
- `verification/business-bi-net-revenue-falsification-v1.json`
- `docs/evidence/business-bi-net-revenue-v1.md`

## Reproduction

From the repository root, on the exact two-commit allowlisted integration head:

```text
node --test tests/business-bi-metric-oracle.test.mjs tests/business-bi-net-revenue-plan.test.mjs tests/business-bi-clean-room.test.mjs
node scripts/run-business-bi-falsification-clean-room.mjs
git diff --check 764d0f7a1bad9e8e407b96e1b2340baa1e001af6...HEAD
```

The runner also accepts `--sabotage <CASE_ID>` and emits a deterministic denial
with exit status 2; it never emits a successful ordinary metric answer for a
sabotage invocation.

Local infrastructure note: an unflagged Node startup in this workspace exited
133/SIGTRAP in V8 `SetPermissions`. Per the task boundary this is infrastructure
evidence, not a product verdict. Local technical checks can use the same frozen
Node `v24.19.0` with `--jitless`; the controller remains responsible for the
authoritative pinned-Node gates.
