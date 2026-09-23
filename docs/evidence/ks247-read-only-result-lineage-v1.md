# KS247 — read-only result lineage on the existing CLI/TABLE/HTML read path

Authority: public issue #247 (KS-EVO-02), order `/workspace/result-lineage/AUFTRAG.md`.
Current authenticated Main `58b3d30d98f5379e07c68110d7a58d11f7858161`; the retained accepted
KS246 candidate is consumed UNCHANGED as `dependency/ks246` =
`37cf8718edb8aa25d86a42dac3c81a3faf94d6eb`.

This slice is **local-only and read-only**: no public state, no HTTP route, no production,
customer or real-source claim, no public writes, and no writes of any kind — the CLI prints
to stdout.  The separately owned PAN452 read-purpose binding stays **NOT_INTEGRATED**, and
no positive integration is invented.  AC05 is parent-owned and open.

This revision is independent work on the retained KS246 composition.  No KS246 byte changed,
the previous candidate (`/workspace/KaleidoSphere` at `0b6c764`) and the parent integration
checkout (`/workspace/integration/KaleidoSphere` at `37cf871`) are untouched, and no existing
candidate was reset.

## What was built (and reused)

| Piece | Path |
|---|---|
| Read-only result-lineage module (separation + independent comparison + renderings) | `services/bi-control/src/business-bi/result-lineage-v1.mjs` |
| Runnable CLI entry point on the existing read path | `scripts/run-result-lineage-journey.mjs` |
| INDEPENDENTLY MAINTAINED expectation (authored, versioned) | `tests/fixtures/business-bi/ks247-result-lineage/independent-expectation-v1.json` |
| Authored free-form explanation (text only) | `tests/fixtures/business-bi/ks247-result-lineage/explanation-v1.json` |
| Separately confirmed effect status (read-only: no effects) | `tests/fixtures/business-bi/ks247-result-lineage/effect-status-v1.json` |
| Focused suite | `tests/result-lineage-readonly.test.mjs` |
| Source-map migration | `scripts/update-ks247-result-lineage-source-map.mjs` |

Reused, never duplicated: the retained KS246 journey (`runUnfamiliarMetricJourney`) is the
only path to a read result, and its released metric core, confined SELECT, byte-bound holdout
confinement and PGlite seam are called, not re-implemented.  No second metric, engine,
arithmetic, mapping vocabulary, dashboard or BI frontend was introduced.

## The separation this slice adds

The retained journey returns a released result and a released receipt.  This slice says
WHICH part of that output a reader may treat as verified, and refuses to let a caller move a
fact from one class to another:

| Class | Where it comes from | What a reader may do with it |
|---|---|---|
| `VERIFIED_NUMBER` (24) | the released receipt's own result, compared path-for-path with the independently maintained expectation | treat as verified; it matched the maintained pin |
| `EXPLANATION` (3) | authored free text; **text only**, no numeric field | read as interpretation; never verified |
| `UNAVAILABLE_FACT` (4) | facts the released contract/surface does not carry (`order_intake`, `gross_margin`, `customer_segment_attribution`, `causal_reason_for_delta`) | treat as absent; never rendered as a number |
| `COMPLETION` | the released receipt's own execution state | treat as the completion; never a caller assertion |
| `SYNTHETIC_EFFECT` | only from a SEPARATELY CONFIRMED effect status | read as a separately confirmed status; never inferred from a successful read |

The read-only journey declares **no** effect journal
(`effectJournal: NOT_INVENTED_READ_ONLY_JOURNEY`).  A non-complete read keeps a valid
completion with `complete: false`, zero verified numbers and all 24 maintained expectations
presented as unavailable — an empty verified section, never a fabricated zero.

## Acceptance mapping

| AC | Status here | Exact local evidence |
|---|---|---|
| KS-EVO-02-AC02 | DEMONSTRATED LOCALLY | Every verified number is compared with the independently maintained expectation; the expectation is itself checked against this suite's own loop and against the released hand-derived oracle.  A substituted source is refused **even when the caller declares it recomputed its own digest** (`KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED`).  Wrong number / unit / period, a substituted contract, stale evidence and non-current evidence each have their own code, and the claim's OWN material identities are compared with the actual observed read, so a claim attributed to another source revision (`EVIDENCE_SOURCE_REVISION_STALE`) or resting on a result digest the read did not produce (`EVIDENCE_RESULT_DIGEST_MISMATCH`) is refused by name. |
| KS-EVO-02-AC03 | DEMONSTRATED LOCALLY | Verified numbers, free-form explanation, unavailable facts and completion are four separate sections with their own line classes; an explanation carries no numeric field and is rendered `UNVERIFIED`, and marking an explanation / causal / completion assertion as verified is refused by name. |
| KS-EVO-02-AC04 | DEMONSTRATED LOCALLY for the read-only journey | Completion is the released receipt's state; no effect journal is invented; a synthetic effect shown without a separately confirmed status is refused (`FABRICATED_EFFECT_JOURNAL`), and an effect-status input claiming mutation authority is refused (`READ_ONLY_EFFECT_CLAIM_DENIED`).  Source/journey promotion boundaries are preserved and stated.  On a refusal the CLI summary preserves the OBSERVED execution/completion (`executed`, `observedCompletion`) separately from the verification status (`verification.status: REFUSED`, `lineage: null`), so a completed read whose rendering was refused is never falsely reported as unexecuted. |
| KS-EVO-02-AC01 | NOT_INTEGRATED (parent-owned) | The shared PAN452 read-purpose contract binding is separately Qwen-owned and not accepted.  This slice does not design, stub, mint or duplicate its handles; it states `NOT_INTEGRATED` and reports the exact seam to the parent. |
| KS-EVO-02-AC05 | NOT CLAIMED | Parent `e2e345eb187a` owns independent review, canonical CI, current-Main integration, merge, release and public readback. |

## Exact local execution (commands, exits, counts)

```
node scripts/run-result-lineage-journey.mjs
    # exit 0 — EOF: proposal not confirmed, lineage=null, executed=false
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> \
    --explanation <file> --effect-status <file> --format JSON
    # exit 0 — COMPLETE_READ_ONLY_OBSERVATION, 24/24 verified numbers, 4 unavailable facts,
    #          3 explanations, completion COMPLETE (released state), oracleEquality EXACT,
    #          effectJournal NOT_INVENTED_READ_ONLY_JOURNEY
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> --format TABLE
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> --format HTML
    # exit 0 — the same lineage rendered as TABLE / HTML, with a trailing machine receipt
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> \
    --pglite /tmp/ks246-pglite/node_modules/@electric-sql/pglite/dist/index.js --format TABLE
    # exit 0 — the same separation over a REAL in-process PGlite read (REAL_POSTGRESQL)
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --business-semantics <file> --source-revision <rev>
    # exit 0 — journeyDenial KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> \
    --source <resealed file>
    # exit 0 — journeyDenial KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT,
    #          lineage=null, no number presented as verified
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> \
    --evidence-claim <claim with ONLY sourceRevision = synthetic-unfamiliar-v1>
    # exit 0 — journeyDenial KS247_LINEAGE_DENIED:EVIDENCE_SOURCE_REVISION_STALE,
    #          lineage=null, executed=true, observedCompletion.complete=true, 0 verified numbers
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> \
    --evidence-claim <claim with ONLY resultSha256 = 64 zeros>
    # exit 0 — journeyDenial KS247_LINEAGE_DENIED:EVIDENCE_RESULT_DIGEST_MISMATCH, same shape
node scripts/run-result-lineage-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev> \
    --expectation <maintained expectation with deltaMinorUnits=1>
    # exit 0 — journeyDenial KS247_LINEAGE_DENIED:WRONG_NUMBER, lineage=null,
    #          executed=true and observedCompletion {state: COMPLETE, complete: true};
    #          verification {status: REFUSED, verifiedNumberCount: 0}
node scripts/run-result-lineage-journey.mjs --negative
    # exit 0 — 24 gates, each printing its exact rejection code
node --test tests/result-lineage-readonly.test.mjs   # 26 tests
node --test tests/canonical-test-topology.test.mjs
node --test tests/source-map.test.mjs
node scripts/build-consumer-support-manifest.mjs --check
npm test
```

Negative gate codes as executed (`--negative`):

```
binding-source-digest-not-current=KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED
wrong-number=KS247_LINEAGE_DENIED:WRONG_NUMBER
wrong-unit=KS247_LINEAGE_DENIED:WRONG_UNIT
wrong-period=KS247_LINEAGE_DENIED:WRONG_PERIOD
source-substitution-with-recomputed-digest=KS247_LINEAGE_DENIED:SOURCE_SUBSTITUTED
stale-evidence=KS247_LINEAGE_DENIED:STALE_EVIDENCE
evidence-not-current=KS247_LINEAGE_DENIED:EVIDENCE_NOT_CURRENT
evidence-claim-source-revision-stale=KS247_LINEAGE_DENIED:EVIDENCE_SOURCE_REVISION_STALE
evidence-claim-result-digest-mismatch=KS247_LINEAGE_DENIED:EVIDENCE_RESULT_DIGEST_MISMATCH
contract-substituted=KS247_LINEAGE_DENIED:CONTRACT_SUBSTITUTED
source-revision-stale=KS247_LINEAGE_DENIED:SOURCE_REVISION_STALE
resealed-source-refused-by-released-confinement=KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT
causal-assertion-presented-as-verified=KS247_LINEAGE_DENIED:UNSUPPORTED_CAUSAL_ASSERTION
completion-assertion-presented-as-verified=KS247_LINEAGE_DENIED:UNSUPPORTED_COMPLETION_ASSERTION
explanation-presented-as-verified=KS247_LINEAGE_DENIED:EXPLANATION_PRESENTED_AS_VERIFIED
unavailable-fact-asserted=KS247_LINEAGE_DENIED:UNAVAILABLE_FACT_ASSERTED
explanation-numeric-payload=KS247_EXPLANATION_DENIED:ASSERTION
fabricated-effect-journal=KS247_LINEAGE_DENIED:FABRICATED_EFFECT_JOURNAL
effect-status-not-separately-confirmed=KS247_EFFECT_STATUS_DENIED:EFFECT_STATUS_NOT_SEPARATELY_CONFIRMED
read-only-effect-claim=KS247_EFFECT_STATUS_DENIED:READ_ONLY_EFFECT_CLAIM_DENIED
missing-evidence-claim=KS247_LINEAGE_DENIED:MISSING_EVIDENCE_CLAIM
missing-independent-expectation=KS247_LINEAGE_DENIED:MISSING_INDEPENDENT_EXPECTATION
render-format=KS247_LINEAGE_DENIED:RENDER_FORMAT
lineage-substitution=KS247_LINEAGE_DENIED:LINEAGE_SUBSTITUTION
```

## The independent expectation, and why the comparison is a comparison

The expectation fixture pins the source byte digest, the canonical holdout digest, the row
count, the arithmetic unit, both period windows and 24 exact integers.  Its independence is
checked three ways in the focused suite:

1. this suite's own loop over the frozen source fixture derives the money aggregates
   (sale / credit / cancel per window and the delta) and must agree with the fixture;
2. every one of the 24 pins maps path-for-path onto the released hand-derived oracle fixture
   (`tests/fixtures/business-bi/net-revenue-oracle-v1.json`), whose own independent inline
   calculator lives in `tests/business-bi-metric-oracle.test.mjs`;
3. the two pinned digests are content-addressed by the suite from the frozen fixtures.

A caller-declared `recomputedByCaller: true` is recorded in the lineage and in
`separation.callerRecomputedDigestIsNotAuthority`; it is never a substitute for the pin.
The RED/GREEN pair proves the guard is the reason the negative holds: a disposable variant
that replaces the pin with self-consistency ACCEPTS the substituted source, and a disposable
variant with the verified-marking gate removed accepts a causal assertion marked as verified.
The real module refuses both with their exact codes.

## Canonical registration and integrity migration

The suite is canonically reachable but is deliberately NOT a direct `package.json#scripts.test`
root: the canonical command is byte-bound to the released C1 certificate's live `package.json`
digest, so a new root would break that frozen binding.  The suite therefore rides the
established imported-parent route in `tests/source-map.test.mjs`, declared to the topology
kernel in `tests/canonical-test-topology.test.mjs`, preserving the
exactly-one-route-per-suite invariant.  No `package.json` byte changed.  The whole slice is
content-addressed in `SOURCE-MAP.json` by `scripts/update-ks247-result-lineage-source-map.mjs`.

## Intervals

- implementation interval: expectation fixture, separation module, CLI, renderings.
- self-check interval: focused suite (positive, one negative per gate with a permitted
  counterpart, the independent-arithmetic and oracle cross-checks, RED/GREEN on four
  disposable broken variants (two module variants and two CLI variants), and the
  real-PGlite leg).
- test-wait interval: canonical `npm test`, build/manifest, topology and source-map gates.
- unknown stays unknown: no external wait is claimed; AC01 and AC05 stay open.

## Focused independent-review corrections (B1/B2)

An independent focused review at `15148c5e99d3efe84d133d036b10779569344e52` found two
blockers; this revision corrects exactly those two seams and preserves the prior candidates
and the accepted behavior.

- **B1 — evidence-claim identity mismatch.** `verifyEvidence` now compares the claim's OWN
  material identities with the ACTUAL observed read and the maintained pin, not merely with
  their well-formedness: a claim that changes ONLY `sourceRevision` (to the stale discovery
  revision `synthetic-unfamiliar-v1`) is refused `KS247_LINEAGE_DENIED:EVIDENCE_SOURCE_REVISION_STALE`,
  and a claim that changes ONLY `resultSha256` (to 64 zeros) is refused
  `KS247_LINEAGE_DENIED:EVIDENCE_RESULT_DIGEST_MISMATCH`.  Both are exact named CLI
  regressions with an unchanged-claim positive counterpart, and both are also bounded
  `--negative` gates.  Before the correction the CLI rendered 24 verified numbers attributed
  to a stale revision and 24 verified numbers under a contradictory result digest; the
  RED/GREEN pair (a disposable CLI variant without the comparison) shows the guard is the
  reason the negative holds.
- **B2 — lost post-read completion state.** The CLI catch no longer overwrites the observed
  execution with `executed: false`.  A read that actually completed and whose rendering was
  then refused keeps `executed: true` and its `observedCompletion` (taken from the released
  receipt), while the verification is reported separately as `REFUSED` with no verified
  number.  EOF and refusals that happen BEFORE any read still report `executed: false` and
  `observedCompletion: null`.  The regression instruments the read (a counting database
  adapter) so `executed: true` is a runtime fact rather than control-flow analysis, and the
  RED/GREEN pair (a disposable CLI variant that resets `executed = false`) reproduces the
  original false erasure.

Every claim in this record is an authored local synthetic observation.  The expectation and
effect-status inputs are authored records, not authenticated independent authority, and no
external effect is claimed to be proven.

## Limitations and open items

- One authored synthetic read-only case is a local proof, **not** a measured blind or
  generalization result.
- The `UNAVAILABLE_FACT` set is a maintained declaration about the released contract and this
  read-only journey; it is not a discovery of every fact the source could someday carry.
- Real-PGlite mode runs only through the injected `--pglite <absolute dist/index.js>` path; the
  dependency is deliberately not added to `package.json`.  In this worker sandbox the runtime
  identity used was `@electric-sql/pglite` at
  `/tmp/ks246-pglite/node_modules/@electric-sql/pglite/dist/index.js` (resolved by the focused
  suite's own candidate list); this is a SANDBOX path and is deliberately never written into
  product bytes.  The parent host did not have this runtime available; its absence there is an
  environment limit, not a product failure.
- The executable source is authored to the admitted holdout semantics because the released
  core is byte-bound to it.  This is a genuine limit of the released confinement, stated here
  rather than worked around.
- The PAN452 read-purpose contract is separately Qwen-owned and **not accepted**:
  `sharedReadPurposeBinding: NOT_INTEGRATED`.  Full AC01 closure requires that exact shared
  contract and is therefore **not claimed**.
- AC05 (independent review, current-Main integration, merge, release, public readback) is
  parent-owned and open.
- Human comprehension and any broader promotion claim remain outside this evidence; a
  rendering is presentation, not a comprehension result.
