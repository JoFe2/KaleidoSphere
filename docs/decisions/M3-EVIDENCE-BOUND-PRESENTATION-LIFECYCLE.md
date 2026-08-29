# M3 evidence-bound presentation lifecycle v1

Status: bounded additive lifecycle around the sealed renderer for issue #66. This
slice owns only presentation state for an already verified report projection. It
does not add a source, credential, network, browser, dispatch, release, issue-close,
or arbitrary-code authority.

## Contract and API

`services/bi-control/src/reporting/evidence-bound-presentation-lifecycle-v1.mjs`
exports `createEvidenceBoundPresentationLifecycleV1()`. The returned frozen
controller exposes only these operations:

- `load(projection, options)` explicitly prepares and loads one sealed renderer
  result. The object form `{projection, rendererKind, exportFormat}` is also
  accepted. A second equivalent load is idempotent; a different loaded input is
  rejected and must use `replace`.
- `unload()` clears the in-memory presentation state and returns the exact
  zero-residue snapshot. Calling it repeatedly is safe and returns the same
  snapshot.
- `replace(projection, options)` (also `hmrReplace`) prepares the candidate before
  swapping it in. A rejected candidate leaves the existing sealed render loaded,
  which is the HMR rollback boundary.
- `replayReadback({receipt, snapshot})` (also `replay`) verifies the loaded render
  against the supplied immutable receipt and snapshot identities. It accepts
  readback data only; there is no reader callback or active evidence lookup.
- `checkpoint()`, `rollback()`, and `status()` expose lifecycle metadata. Rollback
  validates an optional checkpoint and clears the presentation state; it does not
  rewrite or mutate the governed report projection.
- `residueSnapshot()` (also `snapshot`) reports the exact fixed empty sets for
  registrations, listeners, timers, caches, credential handles, and source
  handles. Its `residueSha256` is the canonical digest of that body.

The module has no module-level registry and performs no I/O. The loaded projection
and render are isolated frozen copies. Unload removes the only lifecycle-held
references; the residue snapshot remains byte-identical before load, after unload,
and after HMR replacement.

## Determinism and replay

The lifecycle delegates construction and verification to the governed
`evidence-bound-renderer/v1` contract without changing that contract. For the
same bound projection, dataset, report-spec/view, export, and render digests stay
identical. Replay delegates to `verifyEvidenceBoundRendererReplayV1`, so both the
receipt and snapshot cited by the projection must read back with their exact
canonical identities. A stale readback, a replay after unload, or a changed
projection fails closed.

Replay does not fetch, dispatch, establish freshness, or prevent replay outside
of the supplied digest comparison. The lifecycle never receives credentials,
source handles, registration/listener/timer/cache handles, callbacks, arbitrary
code, or mutation/release/issue-close capabilities. Unknown fields at the load
boundary and malformed evidence/checkpoints are denied.

## HMR and rollback

Replacement is prepare-then-commit. Renderer validation and bounded export
construction complete before lifecycle state changes. Therefore an invalid
replacement cannot partially unload or install state, and the previous render
and its governed digests remain available for replay. Explicit unload is the
teardown operation and is idempotent. Rollback is local and additive: it clears
lifecycle state, preserves all caller-owned raw contracts, and returns the exact
zero-residue snapshot. No provider, report store, source, credential, browser, or
DSH teardown is required.

## Nonclaims

A loaded render proves only that the sealed renderer accepted the projection. It
does not prove source authenticity, semantic or business truth, freshness,
authorization, visual correctness, complete coverage, or replay prevention.
