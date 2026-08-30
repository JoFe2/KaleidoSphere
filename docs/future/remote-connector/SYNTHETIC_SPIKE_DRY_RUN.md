# Synthetic connector spike dry-run/readback harness

Status: local, deterministic, future-only simulation for issue #92. This
artifact is not a connector, MCP service, spike runner, authorization, or
production evidence. It performs no network I/O, starts no process, opens no
listener, and writes no receipt file. The receipt printed by the command is
an in-memory local simulation result.

## Scope and isolation

The harness consumes only the committed static fixture
`fixtures/synthetic-connector-fixture-v1.json` and validates it with the
offline plan/fixture contract validator. It does not import a connector or MCP
client. The simulated action set is exactly:

- `enumerate_collections`;
- `count_records`; and
- `read_record`.

Every simulated action is marked `mutates: false` and `external: false`. The
receipt explicitly records `connectorExecuted: false`, `mcpExecuted: false`,
`networkAccessed: false`, and `spikeAuthorized: false`. No environment value,
credential, customer payload, provider payload, public bind, hosted endpoint,
mutation action, or unbounded retry is accepted as an input.

The positive sequence is finite: three requests, zero retries, one record read,
and no more than the plan's 20-request, 100-record-per-request, 30-second
command, and 10-minute session bounds. Readback re-derives the canonical
`fixture.collections` digest and compares it with the fixture manifest. The
result is therefore a local receipt, not evidence that an adapter or spike was
run.

## Use

Run from the repository root:

```bash
node scripts/dry-run-synthetic-connector-spike.mjs \
  --fixture docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json \
  --simulate
```

Exit 0 means the **internal fixture simulation** produced
`outcome: "SIMULATED_SUCCESS"`; it does not mean execution eligibility passed.
The receipt always records preflight `decision: "NO_GO"` and G-1 through G-6 as
`NOT_GRANTED` for this discovery package because FRC.0-FRC.2, distinct product
and security authorization, and worth-running authority are absent. Passing
plan/fixture checks appear only under `preflight.internalValidation` and cannot
grant authority.

The JSON output contains one finite local receipt with `preflight`,
`boundedReadOnly`, `stop`, `cleanup`, and `readback` evidence. Cleanup is still
represented even though simulation creates no isolated resource:
`isolatedResourcesCreated` and `deletedPaths` are empty,
`filesystemRestored` is true, and the evidence states that no connector,
service, process, listener, or temporary resource was created.

A structural NO_GO is non-zero (exit 2), has `outcome: "NO_GO"`, includes
`networkAccessed: false` and `spikeAuthorized: false`, and has
`simulatedActionReceipt: null`. No action is simulated after a failed internal
input check. `--simulate` is consent for this local fixture exercise only; it is
not product/security/worth-running authority, and caller-authored authority is
never accepted. Supplying `--no-authorization` or
`--no-predecessor-evidence` demonstrates fail-closed local-input handling:

```bash
node scripts/dry-run-synthetic-connector-spike.mjs \
  --fixture docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json \
  --simulate --no-authorization

node scripts/dry-run-synthetic-connector-spike.mjs \
  --fixture docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json \
  --simulate --no-predecessor-evidence
```

The following inputs are rejected before fixture reads or simulated actions:
`--network`, `--public-bind`, `--hosted-endpoint`, `--credentials`,
`--customer-payload`, `--mutation`, and `--unbounded-retry`. A malformed,
missing, tampered, non-synthetic, or contract-invalid fixture also fails
closed. There is no retry path for any of these failures.

## Spike plan and go/no-go

The authoritative future execution criteria remain in
`SYNTHETIC_SPIKE_PLAN.md`:

1. Preflight: require explicit local simulation authorization, validated
   predecessor plan/fixture evidence, and the fixture's manifest match.
2. Bounded read-only sequence: enumerate, count, and read one known synthetic
   record entirely in memory.
3. Stop: record `NOT_TRIGGERED` for the positive dry run. A real future run
   must stop immediately on a timeout, budget breach, prohibited input,
   mutation, retry overflow, manifest mismatch, external activation, or loss
   of isolation.
4. Cleanup/rollback: a future authorized run must delete every isolated
   resource it created, restore the pre-spike state, and record the deleted
   paths plus post-state match evidence. Cleanup evidence is mandatory for
   success. The dry run records that there were no resources to delete.
5. Readback: require byte-identical canonical fixture content and record the
   manifest comparison.

A future spike is worth running only if all plan gates G-1 through G-6 pass,
separate product and security authorization exists, synthetic-only isolation
is independently verified, and the existing local receipt does not already
answer the spike question. Otherwise the decision is NO-GO; do not start a
partial or reduced run. This harness cannot turn a NO-GO into authorization.

## Verification

The focused contract test and required command are:

```bash
node --test tests/dry-run-synthetic-connector-spike.test.mjs
node scripts/dry-run-synthetic-connector-spike.mjs --fixture docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json --simulate
```

The harness is intentionally separate from any authorized future runner. No
future authorization, cleanup evidence, or receipt from this simulation may be
represented as a connector/MCP execution result.