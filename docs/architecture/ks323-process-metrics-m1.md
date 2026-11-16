# KS323 M1 — bounded read-only process metrics

`InMemoryEvidenceStore.processMetrics({ requiredThroughSequence: n })` reads only the existing opted-in durable process inbox. The argument is optional (default `null` minimum); an explicit request must have exactly this field, null or a safe integer 0–128. It is a minimum-prefix precondition, not a historical slice, source-head attestation, clock grant or authorization. A request for zero still reads the current entire committed prefix. The default in-memory owner is not extended into a metrics/source authority.

The owner uses its existing authorized `durableEvents` path, including decode, binding and contiguous-prefix checks, and checks current permission again before returning. No metrics cache, SQL query added by the reducer, new table/registry, write, replay, outbox or effect is produced. Reopen and exact byte redelivery retain the same input facts. Revocation throws the existing denial, never a successful zero/UNKNOWN result.

## Input and lineage

`input` identifies the full immutable host binding (tenant/principal/privacy epoch, source ID/epoch, producer identity and stream), the committed sequence reached, minimum requested sequence, accepted event IDs and a digest over the canonical accepted envelopes plus binding/request. This is not the raw-byte import hash. `sourceHead` is always `NOT_ATTESTED`: a locally contiguous prefix does not prove that no newer source events exist.

When the requested prefix is not present, both counts have `value: null`, `status: UNKNOWN`; durations are UNKNOWN with `REQUIRED_PREFIX_MISSING`. A rejected GAP is never silently treated as an imported end event. With no minimum request, results are explicitly counts over the observed committed prefix, not global process totals.

Each number carries a formula, unit, input-state digest, event-ID sources and exclusions/reasons. Output contains identifiers and calculation lineage, not event payloads or business data. Host binding and caller digests do not authenticate a remote PAN producer. Remote source loading/pair remains NOT_RUN/BLOCKED.

## Logical action and repeated observations

Within one bound owner the logical key is `(taskId, stepId)`; its reported key digest also includes the complete source/scope/producer/stream binding. Capability, mode and correlation must agree. It cannot join another epoch/stream/tenant. Task revision and the `attempt` bit are not new logical actions or retry IDs.

Inspection of the pinned PAN invocation owner shows `attempt: row ? 1 : 0`; it is not a retry counter. A repeated source fact (`source.eventDigest` with identical complete payload) does not become a new owner outcome when polled later. Contradictory payloads under the same source-fact digest, inconsistent action identity or regressing revisions are excluded explicitly. A late observation of an old confirmed fact cannot resurrect success after a newer UNKNOWN fact.

## Three bounded metrics

1. `confirmedResults`, unit `RESULT_COUNT`: one per logical action whose latest distinct non-render owner fact is `RESULT_CONFIRMED`, attempt 1, with the existing contract-required proof/readback fields and `readbackRef === taskId`. Existing envelope validation enforces mode/capability/result/proof-kind consistency and a positive task revision. Preview validation and document acceptance are recorded owner results, not business mutations or physical display sight. The calculator does not independently fetch or reverify PAN proofs; the result states this nonclaim.
2. `unknownOutcomes`, unit `OUTCOME_COUNT`: one per logical action whose latest distinct non-render owner fact is explicitly UNKNOWN and attempt 1. It is never success. Unattempted/merely proposed/pending records do not invent an attempted UNKNOWN outcome. This is the current outcome at the accepted input state, not a count of every historical UNKNOWN log record.
3. `actionDurations.values`, unit `MILLISECOND`: per logical action, `RESULT_CONFIRMED.sourceTimeMs - PENDING.sourceTimeMs`, only for one unambiguous source fact at each endpoint, same action lineage, direct causation from the confirmation to a recorded PENDING observation, attempt 1 and increasing recorded owner revision. The values are reported **PENDING-to-confirmation source-append spans**, not independently attested execution start/end, wall-clock latency, human handling time or physical process duration. PENDING is not promoted to attested dispatch.

`PAN597_DOCUMENT_RENDERED` observations are excluded. They neither create a confirmed result nor replace a previously recorded acceptance endpoint. SIMULATION/REPLAY modes and missing confirmation proof/readback are rejected by the unchanged input contract. Re-query/redelivery executes nothing and is not additional business success.

## Unavailable durations and exclusions

Missing start, null owner time, reversed owner time, unmatched direct cause, missing/unmatched owner revision, multiple distinct endpoint facts, UNKNOWN outcome, missing required prefix, conflicting source facts, mismatched action lineage, unattempted records or render-only observations produce `value: null`, `status: UNKNOWN`, a specific reason and event-ID exclusions. No ingestion/envelope timestamp, Date.now, renderer timing, source-ID string or wall-clock fallback is used. Equal genuinely paired supplied timestamps may produce an observed zero; missing timestamps never do.

The deliberately conservative M1 does not infer an indirect causal path or choose an arbitrary earliest/latest timestamp among ambiguous endpoints. It does not add clocks, contracts, costs, autonomy/quotas, dashboards, UI, approval/workflow engines or production qualification. Process/human/grant facts remain NOT_OBSERVED.

## Synthetic acceptance sets

All new test fixtures are explicitly SYNTHETIC. Their expectations were fixed before implementation:

- Positive durable set: 2 confirmed logical owner results, 1 UNKNOWN outcome; reported source spans 450 ms (1000→1450) and 600 ms (2000→2600), UNKNOWN for the unconfirmed action. Repeated confirmed/UNKNOWN observations and a later document-render marker add no outcomes or time. Actual import ACKs, COMMIT, close/reopen, authorized query and identical redelivery are exercised.
- Negative set: 1 recorded confirmation whose time is unavailable, 1 explicit UNKNOWN; unmatched readback, render-only and unattempted facts are excluded. Every duration is UNKNOWN, never zero.
- Additional owner-backed tests cover endpoint conflicts/order/revision/causation, genuine zero, GAP/minimum-prefix/reopen/fill, source-fact re-observation, current/final-read revocation, foreign bindings/source epochs, request accessors and unchanged default-memory/R1 behavior.

These demonstrate a synthetic backend calculation over real SQLite persistence. They are not a PAN runtime export, independent source/clock attestation, production metric or whole-issue completion. Independent exact-head review and required CI remain integration gates.
