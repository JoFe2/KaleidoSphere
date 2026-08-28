# M3 evidence-bound report contract v1

Status: bounded local contract slice for issue #66. This commit does not activate
rendering, lifecycle, or any external integration. Local replay verification is
limited to digest-checking caller-supplied receipt and snapshot evidence.

## Boundary

The contract is a transport-neutral report specification containing exactly one
bounded dataset and five opaque evidence bindings:

- `snapshotSha256` binds the source snapshot;
- `receiptSha256` binds the observation receipt;
- `coverageSha256` binds the coverage evidence;
- `capabilitySha256` binds the capability boundary; and
- `resultSha256` binds the result evidence.

The accepted dataset kinds are exactly `METRIC`, `TABLE`, and
`DIFFERENTIATOR_PLACEHOLDER`. A metric is one numeric/typed cell, a table is a
non-empty bounded rectangular table, and the differentiator is only the typed
`DIFFERENTIATOR_PLACEHOLDER` / `UNPOPULATED` marker with no rows or columns.
Column keys are isolated in key-only records and column labels, types, and
nullability are carried in a parallel, equal-width `columnDefinitions` array.
That normalized wire shape lets standard Draft 2020-12 `uniqueItems`, bounded
tuple, and conditional schemas assert the same relationships as the runtime;
none of those relationships depends on an annotation keyword.

Cells are JSON scalar values only. Numeric zero has the canonical wire token
`"0"`; nonzero numeric cells remain JSON numbers. The token preserves zero while
letting the decoded JSON Schema surface distinguish and reject numeric `-0`.
No renderer, transport, source connection,
credential, URL, SQL, executable expression, raw-row field, browser surface, or
arbitrary chart code is part of the schema.

The JSON Schema is the wire/spec boundary. The dependency-free runtime
validator additionally rejects JavaScript proxies, accessors, symbols, hidden
properties, custom prototypes, cycles, non-finite numbers, unsafe strings, and
other non-JSON object surfaces without reading accessor values.

## Limits

- report ID: 3-128 characters;
- report title: 1-256 characters;
- dataset ID: 3-128 characters;
- at most 32 columns;
- at most 1,000 rows;
- at most 32 cells per row;
- column labels and differentiator labels: 1-128 characters;
- cell strings: at most 512 characters.

Metric datasets are exactly one column, one column definition, and one row.
Table datasets have at least one column, one definition, and one row. Definition
and row widths must exactly match the column count. Integers and numeric values
are finite, non-negative-zero, and bounded by safe JavaScript numeric magnitude;
integer columns require safe integers. Numeric `0` is not a valid cell encoding;
the canonical `"0"` token is required instead.

## Digest rules

Canonicalization is UTF-8 JSON with recursively sorted object keys, LF framing,
NFC string normalization, finite-number checks, and `-0` normalization as used
by the repository canonical identity contract. Array order is significant.

`datasetSha256` is the SHA-256 identity of the canonical dataset object only.
`specSha256` is the SHA-256 identity of the canonical five-field report spec
(`schemaVersion`, `reportId`, `title`, `dataset`, and `bindings`) and therefore
includes the dataset and all five exact evidence bindings. Digest fields are
projection outputs and are not recursively included in either identity.

The optional expected-binding argument is an authority-side exact comparison.
Verification rebuilds the projection from the supplied spec and expected
bindings, so stale, missing, cross-scope, substituted, or tampered bindings and
identities fail closed. Replay verification additionally recomputes the supplied
receipt and snapshot identities and compares them with the already-bound
digests. It accepts no source, loader, callback, capability, or external
authority. The module performs no I/O, network access, mutation, registration,
cache, timer, or lifecycle bookkeeping.

## Nonclaims

A valid contract proves only that a bounded report-shaped dataset is
cryptographically bound to the supplied opaque evidence identities. A successful
local replay check proves only that the caller-supplied receipt and snapshot have
those bound identities. It does not prove source authenticity, freshness beyond
the bound snapshot identity, coverage completeness, semantic correctness,
business truth, visual truth, replay prevention across calls, renderer behavior,
or credential/source authorization. The differentiator placeholder makes no
differentiator claim.

## Remaining work

Future slices must separately specify and implement:

1. a renderer/read-only presentation adapter that consumes only this projection;
2. any authority-approved evidence loader above the local replay digest checker;
3. lifecycle/load/unload behavior and residue checks; and
4. any approved source, capability, or transport adapter.

None of those surfaces is present here, and this slice cannot mutate Superset,
DSH, a browser, a source connection, or a report store.

## Rollback

Rollback is local and additive: discard or revert this contract module, schema,
test, and decision record. No external state, provider, credential, route,
service, report, or Superset asset is changed, so no teardown or compensating
mutation is required. This work intentionally does not push, merge, release,
or close issue #66.
