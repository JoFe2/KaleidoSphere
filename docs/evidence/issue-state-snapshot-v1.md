# Fixed-domain issue-state snapshot computation (#250)

The existing installable entry point `scripts/run-read-only-metric-pilot.mjs`
now has one additive `--issue-snapshot` mode. The old default remains the
accepted synthetic revenue preparation; frozen v1 and active v2 are preserved.
Issue metadata is never renamed into revenue, sales or monetary fixtures.
This is no connector platform, generic query engine or second dashboard.

## Defined metric and limits

`contracts/business-bi/v1/captured-open-issues.metric.json` defines the count
of distinct supplied issues whose captured state is OPEN, unit = issues.
The population is the whole validated, explicitly permission-bound frozen
issue snapshot, excluding PRs. Closed count and total are reconciliation
figures, not throughput, value, productivity or historical-balance metrics.
The exact raw source bytes and typed permission/capture are bound into the
product result. Source rows/IDs and credentials are not rendered.

A non-atomic multi-page capture is an interval of per-row observations.
The computation does not reconstruct earlier states or assert live freshness,
atomicity, issue-age trends, historical period-end balances or business value.
`independentBusinessDefinitionConfirmed`, `humanComprehensionObserved`,
`realPilotQualified`, `secondContextExecuted` and
`sourceAuthenticityVerifiedByProduct` always remain false. The parser is not
an authority service: a self-authored typed grant or matching hash does not
prove source authenticity, source-owner consent or independent signoff.
The maintainer must establish actual owner authority before providing inputs.
First-source permission never admits the separately approved second context.
No new restricted-mode reuse capability is inferred from #248's negative test.

## Inputs and actual entry point

All three inputs are mandatory, credential-free files:

    node scripts/run-read-only-metric-pilot.mjs \
      --issue-snapshot /authorized/input.json \
      --issue-permission /authorized/permission.json \
      --issue-capture /authorized/capture.json

The snapshot is exactly `{repositoryId, issues}` with rows containing only
`id, number, state, createdAt, updatedAt, closedAt`. Closed-world validation
rejects content, authors, tokens, unknown state, duplicate ID/number, unsafe
numeric IDs, invalid/impossible/future timestamps, mismatched identity/digest,
permission scope, atomic claims, incomplete/changing-total pagination and
permission later than the source capture. All timestamps are explicit zones.
An OPEN issue's optional prior close time is not transition-history evidence.
A close timestamp later than the independently exposed update timestamp (but
not later than capture end) is retained and reported as a timestamp caveat;
it never silently excludes a row or repairs source bytes. No ordering of
GitHub metadata into an event log is assumed.

Typed permission v1 contains: `schemaVersion, contextId, repositoryId,
sourceBytesSha256, access=READ_ONLY_FROZEN_SNAPSHOT, allowedFields,
grantId, grantedAt, secondContextApproved=false`. `grantId` is the retained
owner-permission digest, not an authenticity claim. Typed capture v1 contains
`schemaVersion, sourceBytesSha256, startedAt, finishedAt, atomic=false, pages`;
each page has `rows, totalCount, hasNextPage`. A complete capture may have
zero issues. Canonical timestamps preserve original strings in the output.
No source API request, credential discovery, SQL, config update or file write
is performed by this CLI mode. Unknown/duplicate/mixed flags fail closed with
nonzero exit. Denials do not echo private file paths or payloads.

`--verify --binding /authorized/result.json` rederives the entire result from
the independently retained original inputs. A forged or self-resealed result
is not accepted. Digest consistency is not external authenticity evidence.

## Reader protocol and effort

`--reader-task` prepares #236's existing v2 worksheet/blank record protocol,
with five domain-appropriate tasks on number/unit, source, time boundary,
unknowns and limits. It prints a maintainer envelope containing `worksheet`
and a separate `referenceAnswers`. Give only `worksheet` to the uncoached
reader; never give the combined envelope. Every human identity/time/answer
is null. The source result binding and actually computed figures are reused.
This artifact does not replace the separate original #236/#167 acceptance.

Unknown human setup/clarification/correction/maintenance effort remains null,
not zero. Actual automated command timings may be recorded privately with
exact start/end/elapsed and classification as machine execution, never human
effort. Independent business definition confirmation, actual reader responses,
second-context mapping/effort/comparison and disclosure remain separate gates.
Real internal source rows, grants, human identity and feedback are excluded
from public source archives, tests, notes and release artifacts. Public tests
use authored synthetic issue rows solely to exercise this fixed-domain path.

## Tests and incremental delivery

`tests/issue-state-snapshot-metric.test.mjs` is registered exactly once through
`tests/source-map.test.mjs`, preserving the frozen canonical package command.
It exercises counts against authored independent expectations, permitted
counterparts, named exact denials, retained-input verification and CLI/reader
behavior. Review is one narrow independent review of this new candidate;
unchanged accepted runtime, reader-v2, synthetic-pilot, host and release
proofs are reused. Applicable canonical CI, exact-head merge and functional
release/public readback still gate delivery. No original issue closure or
broader promotion follows from this computation increment alone.
