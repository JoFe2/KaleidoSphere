# KS169 Run Generation Isolation Evidence

Recorded: 2026-09-07

## Scope

KS169 refines M4 Guided BI Discovery so that a Discovery session is bound to an
**immutable run generation** rather than to whatever catalog snapshot is active at
the time of each action. A run generation is one ingested `catalog_snapshots` row,
identified by `(snapshot_sha256, receipt_id, engine, database)`. Once a session starts,
its pinned generation is authoritative for that session for its lifetime; publishing a
newer generation makes the older one *stale* but does not invalidate it.

Implemented scope:

- `latest` is a **checked pointer**: it still selects the newest generation for new
  sessions and reports currency, but it is no longer the sole authoritative state for a
  session already bound to its own generation.
- Each Discovery response exposes a `runGeneration` block
  (`generationId`, `snapshotSha256`, `receiptId`, `engine`, `database`, `current`) and a
  `catalogSnapshotCurrent` boolean, making the pinned generation and its currency visible.
- Per-action integrity check: `answer`, `revise`, `confirm`, `export`, `status`, and
  `resume` resolve the session's **pinned** generation from `catalog_snapshots` and require
  it to be present and identity-intact. It need not be the active/latest generation.
- Stale-generation readback: a session pinned to an older, intact generation can be
  read back (status/resume) and advanced (answer/confirm/export) after a newer generation
  is published; it reports `current: false`.

This is a requirements-brief refinement, not a materialization increment. It introduces no
distributed scheduler, customer data, external credentials, productive Superset effects, or
new state outside the existing projection SQLite database.

## Safety Properties

- A session is bound to the immutable run generation it started from. That generation's
  identity (`receipt_id`, `engine`, `database_name`) is re-verified against
  `catalog_snapshots` on every action, so a pinned generation that is removed or tampered
  with fails closed with `DISCOVERY_CATALOG_SNAPSHOT_MISMATCH`.
- A stale-but-intact generation is isolated and durable: operations succeed against it and
  report `current: false`; the newer generation's content never leaks into the older
  session's brief.
- Session separation by `sessionId` and idempotent start are preserved.
- Export still requires explicit confirmation and does not create Superset datasets,
  charts, dashboards, SQL, source queries, source-row samples, or semantic models.

## Local Proof

Focused command:

```bash
node --test tests/discovery.test.mjs tests/discovery-revision-safeint.test.mjs tests/discovery-run-generations.test.mjs
```

Observed result:

- `tests/discovery-run-generations.test.mjs` (new, 5 tests):
  - **Sequential runs** stay bound to one immutable run generation across
    start/answer/confirm/export (`runGeneration.generationId` is stable and `current: true`).
  - **Barrier-controlled overlap** isolates two in-progress sessions on a shared generation
    across a barrier at which a newer generation is published: both remain operable against
    their own pinned generation, report it as stale, stay isolated from one another, and a
    new session pins the newer generation as its own distinct generation.
  - **Crash/restart**: durable session state and the pinned generation binding read back
    unchanged across a dropped/reopened projection database handle; the pinned (now stale)
    generation is still operable after restart.
  - **Stale-generation readback**: an older isolated generation stays fully readable and
    exportable after a newer generation is published, isolated from the newer content.
  - **Fail-closed**: a pinned generation that is removed or identity-tampered denies
    status/answer/export with `DISCOVERY_CATALOG_SNAPSHOT_MISMATCH`.
- Existing M4 Discovery and KS #73 safeint Discovery tests pass unchanged, except that the
  two probes that previously asserted a *stale-but-intact* generation must fail now assert
  the fail-closed behavior for a *removed* pinned generation (a genuine integrity violation),
  since a stale-but-intact generation is now a valid isolated readback.

## Relationship To M4 Evidence

This refines the M4 safety property that a session is "bound to the catalog snapshot active
at start." The binding is unchanged; the authority model changes: the session's own pinned
generation is authoritative for its state, and `latest` is demoted to a checked pointer for
currency. See `M4_GUIDED_BI_DISCOVERY.md` for the original scope.

## Nonclaims

KS169 does not infer business semantics, generate BI objects, add scheduling, or change the
M5 materialization boundary. Dynamic BI object generation still belongs to M5 and must start
from a confirmed M4 brief plus a separate materialization gate.