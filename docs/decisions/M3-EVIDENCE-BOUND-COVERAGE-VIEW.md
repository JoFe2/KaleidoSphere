# M3 evidence-bound coverage view v1

Status: bounded local differentiator for issue #66. This slice adds a deterministic
coverage view over the accepted evidence-bound report contract and immutable,
content-addressed coverage/evidence bindings. It does not activate presentation,
source access, dispatch, or lifecycle behavior.

## Input boundary

`buildEvidenceBoundCoverageViewV1` accepts exactly:

- `report`: an accepted `evidence-bound-report-spec/v1` projection;
- `coverage`: the sealed `progressive-object-coverage/v1` ledger;
- `capability`: a sealed capability binding containing unique capability IDs and
  source-query bindings;
- `result`: a sealed result binding containing the corresponding result states;
- `receipt`: a sealed receipt binding chaining coverage, capability, result, and
  snapshot digests; and
- `snapshot`: a sealed snapshot binding.

The report's five opaque bindings must equal the supplied evidence identities.
Each supplied envelope is self-checked with the repository's canonical SHA-256
identity contract, and scope and cross-envelope digest links are checked before
any view row is produced. No input is modified. The returned value is an
isolated deeply frozen copy.

The coverage ledger remains the source of coverage states. Capability and result
bindings can confirm a state, but cannot upgrade it. Missing capability or result
binding makes the row `UNKNOWN` with `EVIDENCE_BINDING_MISSING`; it is never
reported as complete, absent, or authoritative. A present contradictory
completion claim fails closed. `DENIED`, `UNSUPPORTED`, and `UNKNOWN` remain
explicit states, and every non-complete row is repeated in `blindSpots` with the
same evidence citations.

## Output and determinism

The output is data-only and uses the merged #122 report wire shape. It contains
one non-empty bounded `TABLE` dataset with key-only `columns`, parallel
`columnDefinitions`, and one row per accepted coverage entry, plus bounded
scalar cells, fixed metrics, explicit claims, authority flags, and the following
exact citations on every row:

- `capabilitySha256`;
- `resultSha256`;
- `coverageSha256` and the derived `coverageEntrySha256`;
- `receiptSha256`; and
- `snapshotSha256`.

Rows are canonically ordered by capability ID, source query ID, and coverage-entry
digest. Object-key ordering and the order of capability/result evidence do not
change the output. `datasetSha256` identifies only the report-compatible table;
`viewSha256` identifies the complete view body plus that dataset digest. Rebuild
verification compares the supplied view with a fresh construction, so a
fully re-digested substitution is rejected.

## Replay boundary

`verifyEvidenceBoundCoverageViewReplayV1` verifies the view and then checks that
the read-back sealed receipt and snapshot carry the exact cited digest. It does
not fetch evidence, open a source, prevent replay, or establish freshness. An
external replay/lifecycle adapter remains responsible for locating the receipt
and snapshot and supplying their immutable read-back values.

## Security boundary and nonclaims

The module performs no I/O, network access, timers, registration, SQL, query
execution, source connection, credential handling, browser work, renderer work,
raw-row transport, executable expression evaluation, dispatch, or mutation. Its
`authority` flags are all false. Closed-surface validation rejects credentials,
connections, URLs, SQL-shaped values, renderer/executable fields, unsafe object
shapes, accessors, proxies, symbols, cycles, and unsupported states.

A valid coverage view proves only that bounded data was deterministically derived
from the supplied accepted report and self-consistent evidence identities. It
does not claim source authenticity, freshness, complete coverage, absence,
business truth, semantic correctness, visual truth, authorization, replay
prevention, or renderer correctness. A coverage state is not a business result.
`UNSUPPORTED`, `DENIED`, and `UNKNOWN` are blind spots or non-availability
signals, not absence claims.

## Rollback

Rollback is local and additive: revert the coverage-view module, focused test,
and this decision record. The existing report contract and external state are
unchanged. No provider, source, credential, report store, Superset, DSH, or
browser asset requires teardown or compensating mutation.

## Remaining work

Future bounded slices must separately provide:

1. a read-only renderer that consumes only this projection and cannot access
   credentials or source connections;
2. an integration adapter for receipt/snapshot retrieval and replay policy;
3. lifecycle/load/unload and residue checks around the adapter; and
4. any separately approved source, capability, or transport integration.

This slice intentionally does not add any of those authorities.
