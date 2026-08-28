# M3 evidence-bound renderer v1

Status: bounded local differentiator for issue #66. This slice adds exactly one
allowlisted, read-only renderer for already verified report or coverage-view
projections. It does not add a source, credential, network, browser, dispatch, or
arbitrary-code authority.

## File-level provenance decision

`services/bi-control/src/reporting/evidence-bound-renderer-v1.mjs` and
`tests/evidence-bound-renderer-v1.test.mjs` are repository-authored clean-room
files for KaleidoSphere. No renderer, chart, export, provider, browser, Superset,
Hermes, DSH, or third-party runtime source was copied. The implementation uses
only the existing local canonical-identity primitive and the existing local report
validator; the coverage-view boundary is independently restricted to the published
coverage-view projection shape and digests. The source-map entries for
these two files and this decision record are ordinary repository-authored hashes;
there are no derived or copied files in this slice.

## Input boundary

The renderer accepts only a projection carrying its completed identity digests:

- an `evidence-bound-report-spec/v1` projection with both `datasetSha256` and
  `specSha256`; or
- an `evidence-bound-coverage-view/v1` projection with `datasetSha256` and
  `viewSha256`.

A raw report spec is rejected. The projection validators are run before any
export is built, and the renderer constructs an isolated deeply frozen result.
The optional closed input form is exactly `{projection, rendererKind,
exportFormat}`. The only accepted values are `TABLE` and `JSON`; renderer and
format selection are not extensible.

## Deterministic bounded export

The one renderer emits a compact UTF-8 JSON export containing the verified
report-compatible dataset, a fixed title, source kind/schema, and the exact
source evidence bindings. It performs no formatting callbacks, templates,
expressions, SQL, HTML, URL handling, chart evaluation, or code evaluation.
Object keys are canonicalized, arrays retain projection order, and the export is
limited to 262,144 UTF-8 bytes. The result records:

- the input `datasetSha256`;
- the report `specSha256` or coverage `viewSha256` (the other field is `null`);
- `exportSha256` over the exact UTF-8 JSON text; and
- `renderSha256` over the complete renderer result excluding that digest field.

Rebuilding from the same bound projection therefore yields byte-identical
export text and identical dataset/spec/view/render digests. Verification rebuilds
the result and rejects a re-digested substitution rather than trusting caller
supplied render metadata.

## Replay and security boundary

`verifyEvidenceBoundRendererReplayV1` verifies the renderer result and recomputes
the caller-supplied receipt and snapshot identities against the projection's
opaque bindings. It does not locate evidence, fetch anything, establish
freshness, prevent replay, or grant a source authority. A separate lifecycle or
storage adapter would be required for retrieval and policy.

The module has no I/O, network access, timers, registration, subprocess,
credential handling, source connection, mutation, raw-row transport, SQL,
executable expression, URL, browser, or arbitrary-code authority. Closed-surface
checks reject unsupported renderer/format values, specification injection,
credentials, source connections, network/URL/SQL-shaped values, executable
expressions, accessors, proxies, symbols, hidden properties, custom prototypes,
cycles, and oversized exports. The renderer's authority is read-only data
projection only.

A valid render proves only that this bounded JSON representation was derived from
an accepted verified projection. It does not prove source authenticity,
semantic or business truth, visual correctness, authorization, freshness, or
replay prevention.

## Unload and rollback

The renderer is pure and stateless. It creates no registrations, timers, files,
connections, caches, globals, or external state, so unload leaves zero residue.
Rollback is local: revert this module, its focused test, this decision record,
and their source-map entries. No provider, source, credential, report store,
Superset, browser, or DSH teardown is required.
