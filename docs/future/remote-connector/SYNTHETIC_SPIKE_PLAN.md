# Synthetic-only isolated connector/MCP spike plan (FRC.3)

Status: future-only plan artifact for issue #92. This document defines a
bounded, synthetic-only, non-production spike plan for a read-only local
connector surface. It is not a connector or MCP implementation, not an
authorization, and not an execution. The terminal outcomes for this artifact
are exactly `RELEASED` (approved plan artifact) or `REJECTED_WITH_EVIDENCE`
(see Terminal outcomes). No outcome of this artifact authorizes, starts, or
executes a spike.

## Purpose and scope

The spike question: can a read-only local connector surface serve a bounded set
of synthetic records over a localhost-or-disabled isolation boundary, within
fixed timeouts and request/record budgets, produce deterministic success
evidence, and clean up with recorded rollback evidence?

This plan artifact owns:

- the preflight go/no-go gate (including the FRC.0-FRC.2 and authorization
  requirements),
- the synthetic-only definition and allowed fake data,
- the isolated network boundary,
- the bounded execution limits (timeouts, budgets, retries, action set),
- start, NO-GO, stop, success, and cleanup/rollback criteria,
- the evidence and receipt requirements,
- the terminal outcomes and nonclaims.

The following are out of scope for this artifact and remain in their dedicated
tasks: synthetic fixture shape and provenance, executable local guards,
dry-run/readback simulation, the authorization packet, and integration
evidence. This plan names the evidence those tasks must produce; it does not
prescribe their implementations.

## Preflight go/no-go gate

The spike starts only if every gate below passes. The gates fail closed: any
missing, stale, or ambiguous evidence is NO-GO and must not initiate a run. A
NO-GO outcome is recorded with the failed gate ID; it is not retried (see
NEG-05) and is not a request for more access.

| ID | Gate | Pass evidence |
|----|------|---------------|
| G-1 | FRC.0-FRC.2 discovery artifacts are complete, or explicitly scoped down | Recorded completion evidence for FRC.0-FRC.2, or an explicit scope-down record naming which FRC.0-FRC.2 items are descoped and why. Partial or unrecorded scope-downs are NO-GO. |
| G-2 | Separate product authorization | Explicit product authorization for this spike, distinct from security authorization. |
| G-3 | Separate security authorization | Explicit security authorization for this spike, distinct from product authorization. |
| G-4 | Synthetic fixture available locally | A locally present fixture satisfying the Allowed synthetic data section, with recorded provenance and manifest hash. |
| G-5 | Local guards pass offline | The dedicated local-guards result rejecting every forbidden operation in the Negative conditions section, produced offline against the planned action set. |
| G-6 | Dry-run/readback receipt conforms | The dedicated dry-run/readback result producing a schema-conformant receipt with no observed external activation. |

FRC.0-FRC.2 completion, product authorization, and security authorization are
fail-closed preflight evidence, not task dependencies. Their absence is
NO-GO; it never becomes a reason to begin a partial run.

A spike is worth running (go) only when all of G-1 through G-6 pass and the
question cannot be answered by an existing local receipt. If the existing local
stack already answers the question, the correct outcome is NO-GO (do not run),
not a reduced or re-scoped run.

## Synthetic-only definition

A synthetic-only spike, under this plan, satisfies all of the following. Any
violation is a stop trigger after start and a NO-GO condition before start:

- uses only generated or hand-authored fictitious records (Allowed synthetic
  data),
- runs only inside the localhost-or-disabled isolation boundary (Isolation
  boundary),
- runs within the bounded execution limits (Bounded execution),
- activates no external service, public listener, hosted endpoint, cloud
  deployment, or external network dependency,
- makes no persistent or default-runtime changes,
- uses no secrets, live credentials, customer data, or provider payloads.

The phrase "synthetic-only" is not a label; it is the conjunction of these
conditions. A run that cannot verify all of them is not synthetic-only.

## Allowed synthetic data

Allowed:

- generated or hand-authored fictitious records only,
- fictitious identifiers of the form `SYN-<collection>-<ordinal>`,
- fictitious names and labels drawn from a closed, documented list,
- deterministic numeric fields (sequence numbers, bounded integers, counts).

Concrete limits:

- at most 10 collections,
- at most 50 records per collection (at most 500 records total),
- at most 10 fields per record,
- at most 256 bytes per field,
- fixed seed or fully hand-authored content: repeated runs over the same
  fixture must produce byte-identical readback.

Prohibited (NEG-03, fail closed):

- customer data or customer identifiers,
- provider payloads or provider-issued tokens,
- secrets, passwords, or live credentials of any kind,
- source-row material from any real database,
- values derived from the local environment (hostnames, paths, user data,
  environment variables).

If a fixture contains a prohibited item, that item is removed and the fixture
manifest is re-derived; a fixture that cannot be purified is NO-GO.

## Isolation boundary

- Network: localhost only, or disabled. There is no public bind and no hosted
  endpoint (NEG-02). Any planned command that binds a non-localhost interface,
  listens for non-localhost peers, or requires an external host is a NO-GO
  condition before start and an immediate stop trigger after start. There is no
  "temporary public bind" variant.
- The spike process and any local helper run inside one disposable execution
  directory. No writes occur outside that directory except the single sealed
  receipt file.
- No persistent or default-runtime changes: the default runtime, compose stack,
  service configuration, credentials, remotes, providers, services, CI
  authority, and spill configuration are all unchanged by a spike run.
- No cloud deployment and no hosted endpoint of any kind.
- After cleanup, the filesystem must match the pre-spike state except for the
  sealed receipt file (Cleanup and rollback).

## Bounded execution

Concrete limits. Stricter values are allowed; looser values are NO-GO.

- Per-command timeout: 30 seconds.
- Total spike session: 10 minutes.
- Request budget: at most 20 synthetic requests per run, at most 50 requests
  for the whole spike.
- Record budget: at most 100 records read per request; the whole fixture is at
  most 500 records.
- Retries: at most 1 retry for a local read failure. Zero retries for any
  boundary, authorization, budget, or fixture-provenance failure. An open-ended
  or blind retry loop is a stop trigger (NEG-05).
- Action set (NEG-04): read-only synthetic actions only — enumerate
  collections, read a record, count records. Mutation-capable actions
  (create, update, delete, grant, deploy, publish, send, or any write to a
  system outside the execution directory) are prohibited. If the planned
  surface exposes a mutation-capable action, the preflight is NO-GO; if one is
  called during a run, the run stops immediately.

## Start criteria

A run starts only when all of the following hold simultaneously:

1. Preflight gates G-1 through G-6 are all PASS with recorded evidence.
2. The fixture is present locally, within the Allowed synthetic data limits,
   and has a recorded manifest hash.
3. The isolation boundary is verifiably localhost-or-disabled.
4. Timeouts and budgets are set to the values in Bounded execution (or
   stricter).
5. An authorized actor (per G-2 and G-3) explicitly starts the run. No timer,
   script, CI step, or automated follow-on may start it.
6. The execution directory is fresh and a pre-spike state snapshot (hash
   manifest of the relevant paths) is recorded.

If any condition is false before start, the outcome is NO-GO with the failing
item recorded. If it becomes false after start, the outcome is immediate stop.

## NO-GO conditions

NO-GO is a terminal preflight outcome: it does not initiate a run, is not
retried, and is recorded with the failed gate or condition ID. Beyond the
gates G-1 through G-6, the following are explicit NO-GO conditions:

- NEG-01: any live credential requirement (provider token, real database
  credential, personal or service secret) is NO-GO. The spike is not
  re-designed around credential injection.
- NEG-02: any public bind or hosted endpoint in the plan is NO-GO. There is no
  temporary, scoped, or exception public bind.
- NEG-03: any customer data or provider payload in the fixture or plan is
  NO-GO.
- NEG-04: any mutation-capable connector action in the planned surface is
  NO-GO.
- NEG-05: any open-ended or blind retry loop is NO-GO.

## Stop criteria (immediate)

After start, the run stops immediately on any of the following. Stop is then
followed by cleanup and a recorded receipt. Stop is not a failure of the plan;
it is the plan operating as designed.

- any timeout or budget in Bounded execution is exceeded,
- a prohibited data item, credential, bind, or mutation is observed or
  attempted (NEG-01 through NEG-04),
- a retry beyond the bound in Bounded execution (NEG-05),
- a fixture provenance mismatch: any readback differs from the fixture
  manifest hash,
- any write outside the execution directory and the sealed receipt file,
- any external activation: a service start, a bind beyond localhost, or spike
  network egress,
- any loss of isolation: a process escaping the execution directory, or
  environment leakage into the run.

The receipt records which trigger fired. Multiple triggers may fire; the first
trigger determines the stop.

## Success criteria

A run succeeds only when all of the following hold:

1. every requested read completed within the per-command timeout and request
   budget,
2. every readback matched the fixture manifest hash over the declared field
   set (byte-identical),
3. only read-only synthetic actions were exposed and called; no
   mutation-capable action was exposed or called,
4. no boundary violation was observed (localhost-or-disabled throughout),
5. no prohibited data or credential was present (NEG-01, NEG-02, NEG-03
   clean),
6. cleanup completed and cleanup evidence was recorded (Cleanup and rollback).

Success evidence is a sealed local receipt containing: the preflight gate
evidence references (G-1 through G-6), the fixture manifest hash, per-request
budget accounting, boundary evidence, stop-trigger status (none), cleanup
evidence, and a terminal outcome field. A receipt without any of these fields
is not success evidence.

## Cleanup and rollback

- Cleanup is deterministic and runs at the end of every run, success or stop:
  delete the execution directory, terminate the disposable helper processes,
  and delete every temporary artifact except the sealed receipt file.
- Rollback means restoring the pre-spike state: the post-cleanup filesystem
  hash manifest must match the pre-spike snapshot, except for the sealed
  receipt file.
- Cleanup evidence is a short record of: the deleted paths, the post-state
  manifest hash, and a match/mismatch verdict against the pre-spike snapshot.
- A mismatch is recorded with the diff. It is not silently re-run; the state
  is left for the authorized actor with the recorded evidence. A run whose
  cleanup cannot be verified does not succeed.
- RB-01: every later authorized run deletes the isolated resources it created
  and records cleanup evidence in its receipt. Cleanup evidence is mandatory
  for success, not optional documentation.

## Evidence and receipts

- All evidence is local and sealed: a hash manifest plus an outcome field. No
  evidence is transmitted to any external system, and no receipt is a
  production claim; it is spike evidence only.
- Evidence index format: gate ID maps to an evidence reference (local file
  path plus hash). Empty or missing evidence is a documented NO-GO, never an
  assumption.
- The receipt schema is finalized by the dedicated dry-run/readback task; this
  plan names the required fields (Success criteria) and nothing more.
- A receipt that cannot be re-derived from local files is not valid evidence.

## Terminal outcomes

The terminal outcome of this artifact is exactly one of:

- `RELEASED`: approved plan artifact. The document contains the preflight
  go/no-go gate, the synthetic-only definition, allowed fake data, isolation
  boundary, bounded execution limits, and start, NO-GO, stop, success,
  cleanup/rollback, and evidence sections with concrete limits; every
  mandatory negative condition is an explicit deny/stop condition; and the
  local profile checks pass.
- `REJECTED_WITH_EVIDENCE`: a required section, gate, or check is missing or
  failing, with the evidence recorded.

This artifact does not claim that a spike was authorized, started, or
executed, and it grants no authority. A future authorized actor may run a
spike only after independently satisfying the preflight gates in this plan.

## Nonclaims

- No connector or MCP implementation.
- No MCP listing or public endpoint.
- No production readiness, customer-valid behavior, credential use, or service
  activation.
- No release and no authority expansion.
- No automated follow-on is permitted by this artifact.
- FRC.0-FRC.2 discovery completion, product authorization, and security
  authorization are fail-closed preflight evidence, not task dependencies.

## Current discovery-package decision

The plan contract is internally valid, but the current discovery package is
terminally `REJECTED_WITH_EVIDENCE` and execution is `NO_GO`. G-1 through G-6
are `NOT_GRANTED`: FRC.0-FRC.2 completion/scope-down, distinct product and
security authorization, and independently owned worth-running authority are
absent. Local fixture, validator, focused-test, and simulation checks remain
separate internal validation and do not grant a gate.

Decision owner: the final issue #92 delivery owner. Affected scope: issue #92
FRC.3 execution eligibility only. That owner may supersede this decision only
when independent prerequisite and worth-running records bind the complete
then-current package, canonical checks pass, and a distinct authorized actor
explicitly starts the run. Caller-authored authority, expected values, or
summaries are not evidence.

This worker creates no closure-audit/controller receipt and claims no future
integration commit or SHA. It also claims no deployment or compliance
readiness. Missing, stale, substituted, or incomplete package bytes remain
fail-closed.

## Criterion crosswalk

| Criterion | Section |
|-----------|---------|
| AC-01 (start/stop/rollback) | Start criteria, Stop criteria, Cleanup and rollback |
| AC-03 (go/no-go) | Preflight go/no-go gate, NO-GO conditions |
| DEP-01 (FRC.0-FRC.2 plus separate authorizations) | Preflight go/no-go gate (G-1, G-2, G-3) |
| GATE-01 (synthetic-only, non-production, isolated, bounded) | Synthetic-only definition, Isolation boundary, Bounded execution |
| NEG-01 (live credential fails closed) | NO-GO conditions, Stop criteria |
| NEG-02 (public bind/hosted endpoint fails closed) | NO-GO conditions, Stop criteria, Isolation boundary |
| NEG-03 (customer data/provider payload fails closed) | NO-GO conditions, Allowed synthetic data |
| NEG-04 (mutation-capable action fails closed) | NO-GO conditions, Bounded execution |
| NEG-05 (open-ended retry fails closed) | NO-GO conditions, Bounded execution |
| RB-01 (cleanup evidence for later authorized runs) | Cleanup and rollback |
| NC-01 (no implementation/readiness claims) | Nonclaims |
| TERM-01 (RELEASED or REJECTED_WITH_EVIDENCE) | Terminal outcomes |