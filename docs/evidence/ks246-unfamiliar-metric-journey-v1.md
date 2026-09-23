# KS246 — unfamiliar synthetic schema: local metric/mapping journey and database execution

Authority: public issue #246 (KS-EVO-01), order `/workspace/AUFTRAG.md`.
Discovery base `860a8624dc0812ea7cbb19a369a8120b415ba0bb`; the corrected AC01/AC02
proposal (`d8f494e9104c84441772303525040d502f956110`, preserved here) is the predecessor of
this slice and is **unchanged**. Both slices are **local-only**: no public state, no HTTP
route, no production, customer or real-source claim, and no public writes.

This revision carries the **parent-directed correction of C1-C3** from
`/workspace/PARENT-COMPOSITION-CORRECTIONS.md`: the CLI no longer supplies the caller's
record-kind decisions (C1) or the source revision (C2) itself, and the composition now
refuses an actual incompatible/unresolved **amount business meaning** through a closed,
source-bound confirmation (C3). The corrected candidate is preserved; the released proposal
and the integration base are untouched by this worker.

## What was built (and reused)

| Piece | Path |
|---|---|
| Executable source fixture (separately identified) | `tests/fixtures/business-bi/ks246-unfamiliar-schema/source-pay-feed-v1.json` |
| Caller record-kind decision input (authored) | `tests/fixtures/business-bi/ks246-unfamiliar-schema/kind-decisions-v1.json` |
| Caller amount business-meaning confirmation (authored, closed, source-bound) | `tests/fixtures/business-bi/ks246-unfamiliar-schema/business-semantics-v1.json` |
| Composition module (layout profile + binding + local DB seam) | `services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs` |
| Runnable CLI journey | `scripts/run-unfamiliar-schema-metric-journey.mjs` |
| Focused suite | `tests/unfamiliar-schema-metric-journey.test.mjs` |
| Source-map migration | `scripts/update-ks246-unfamiliar-schema-source-map.mjs` |

Reused, not duplicated: the reviewed AC03 handoff (`buildMetricHandoff`) is the binding
authority; the released metric core (`compileNetRevenuePlan` / `executeNetRevenuePlan` /
`verifyNetRevenueExecutionReceipt`), the released byte-bound holdout serializer
(`serializeHoldout`) and the released local database seam (`buildPgliteJourneyDatabase`)
are called, never re-implemented. No second metric, currency, date role, validator,
engine or mapping vocabulary is introduced.

## The chain, end to end

1. the reviewed proposal entry point drives the clarification conversation and yields a
   **caller-confirmed** candidate (`CONFIRMED`, `coherent`), or nothing (EOF / partial /
   inconsistent → refused by the reviewed `UNFAMILIAR_HANDOFF_DENIED:*` codes);
2. `buildMetricHandoff` binds that candidate to the released contract digest, the released
   row-role vocabulary and the released record-kind vocabulary;
3. the **frozen, versioned** `unfamiliar-pay-feed-layout-v1` profile declares the
   unfamiliar layout and is admitted only when every role AGREES with the caller's own
   confirmed decision, when the released arithmetic unit/currency hold, and when every
   source column is either a role column or an explicitly classified non-role column;
4. the caller's authored decision input supplies every record-kind value the reviewed
   handoff left **explicitly unresolved** — the reviewed surface never infers a sale, and
   neither does this one: an undecided or contradictory value is DENIED by name. Both this
   input and the source revision below are **required explicitly**: the CLI has no default,
   no fallback and no fixture adoption on the caller path, and a missing one DENIES before
   any database is created, seeded or read;
4b. the caller's **closed, source-bound** confirmation of the admitted amount column's
   business meaning is required: only `NET_SALES_REVENUE` authorizes the released
   net-revenue operation. A confirmed `NOT_NET_SALES_REVENUE` or `UNRESOLVED`, a token
   outside the closed vocabulary, a subject that is not the caller's own confirmed amount
   column, or a stale source revision all DENY — and a free-text business meaning
   **recorded** in the proposal interview that disagrees with the closed confirmation (or is
   `UNRESOLVED`) is preserved as an unresolved/contradictory condition and DENIES pending
   clarification. Numeric holdout equality is never treated as semantic authorization;
5. the unfamiliar relation is seeded into the injected local database
   (a real in-process PGlite in a clean-room; a labelled synthetic adapter otherwise),
   read back through **one confined SELECT** of exactly the role columns, mapped to the
   canonical `{order_id, order_date, record_kind, amount_minor_units}` rows and
   re-serialized to the released holdout bytes;
6. the released core compiles and executes the plan and returns a released execution
   receipt, verified by `verifyNetRevenueExecutionReceipt`.

| Local journey sample | Value |
|---|---|
| current net | `100059` minor units |
| comparison net | `30000` minor units |
| delta | `70059` minor units |
| oracle equality | `EXACT` |
| source rows read | `17` |
| canonical holdout digest | `2d0ba0bb806e73a473688d6137c6182f4233aec1bed92aee708c4a052d327a4d` |

The expected integers are **independently specified**: the focused suite derives them with
its own loop over the frozen source fixture, using the released contract's period windows
and the caller's decision input, and only then compares them with the journey's pinned
expectation and with the released independent oracle.

## Provenance: what the counts are, and what they are not

- The discovery fixtures (`metadata-v1.json`, `aggregate-profile-v1.json`, revisions
  `synthetic-unfamiliar-v1`, bounded counts `12 / 5 / 4`) are the **AC01/AC02 observation**
  and are preserved byte-for-byte. Those counts are **authored bounded observations**: this
  slice states, in the fixture, in the journey receipt and in the focused suite, that they
  were **never produced by the executable source fixture or by the local synthetic
  database**.
- The executable source fixture is **separately identified** with its own revision
  `synthetic-unfamiliar-source-v1` and its own `17` authored rows. The journey records both
  revisions and both counts explicitly (`revisionBinding.countProvenance`).
- The executable source is authored to the admitted synthetic holdout semantics because the
  released core is **byte-bound** to that holdout; this is the released confinement, and it
  is disclosed rather than widened.
- `pf_id` is declared in the `s-NNN` synthetic identifier namespace in the executable source
  fixture; the discovery metadata's integer declaration is preserved unchanged, and the
  divergence is disclosed (`columnDisclosure`, and the journey's `disclosures`).
- All fixture and decision values are **declared authored inputs**: no human participation
  is claimed or implied anywhere.

## Acceptance mapping

| AC | Status here | Exact local evidence |
|---|---|---|
| KS-EVO-01-AC03 | DEMONSTRATED LOCALLY (shared handle still open) | The confirmed candidate is bound to the executable source revision, the caller's decisions, the proposal/candidate/clarification digests, the released contract digest and the released row-role/kind vocabulary, and handed to the existing entry point. The profile must AGREE with the caller's confirmed roles (`ROLE_BINDING_NOT_CONFIRMED:*`) and every non-role/date-like column must be classified (`UNCLASSIFIED_SOURCE_COLUMN`, `AMBIGUOUS_DATE_ROLE`). The PAN452 common task handle remains **NOT integrated**. |
| KS-EVO-01-AC04 | DEMONSTRATED LOCALLY for the released confined source | One supported positive example **executes** through the released core and a real local synthetic database read (`COMPLETE`, oracle `EXACT`, delta `70059`), with an independently specified expected result, and exact missing / contradictory / denied information negatives. No arbitrary SQL authority, no implicit approval, no inferred order revenue. |
| KS-EVO-01-AC05 | NOT CLAIMED | Parent-owned: independent review, canonical CI, current-Main integration, merge, release and public readback. |

## Exact local execution (commands, exits, counts)

```
node scripts/run-unfamiliar-schema-metric-journey.mjs
    # exit 0 — EOF: PROPOSED, 0 confirmed, handoffDenial UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS, executed=false
node scripts/run-unfamiliar-schema-metric-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file> --source-revision <rev>
    # exit 0 — CONFIRMED + executed=true, COMPLETE, deltaMinorUnits=70059, oracleEquality=EXACT
node scripts/run-unfamiliar-schema-metric-journey.mjs --answers <file> \
    --business-semantics <file> --source-revision <rev>
    # exit 0 — journeyDenial KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT (C1)
node scripts/run-unfamiliar-schema-metric-journey.mjs --answers <file> \
    --kind-decisions <file> --business-semantics <file>
    # exit 0 — journeyDenial KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING (C2)
node scripts/run-unfamiliar-schema-metric-journey.mjs --answers <file> --kind-decisions <file> \
    --business-semantics <file> --source-revision <rev> --source-revision synthetic-unfamiliar-v1
    # exit 0 — journeyDenial KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE (stale-after-load knowledge refused)
node scripts/run-unfamiliar-schema-metric-journey.mjs --negative
    # exit 0 — 27 gates, each printing its exact rejection code
node --test tests/unfamiliar-schema-metric-journey.test.mjs
node --test tests/unfamiliar-schema-proposal.test.mjs
node --test tests/canonical-test-topology.test.mjs
node --test tests/source-map.test.mjs
node scripts/build-consumer-support-manifest.mjs --check
npm test
```

Negative gate codes as executed (`--negative`):

```
eof-handoff=UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS
unconfirmed-proposal=UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS
unsupported-units=UNFAMILIAR_HANDOFF_DENIED:ARITHMETIC_UNIT_NOT_RELEASED
unsupported-currency=UNFAMILIAR_HANDOFF_DENIED:CURRENCY_NOT_RELEASED
missing-kind-decision-input=KS246_JOURNEY_DENIED:MISSING_KIND_DECISION_INPUT
missing-business-semantic-confirmation=KS246_JOURNEY_DENIED:MISSING_BUSINESS_SEMANTIC_CONFIRMATION
missing-source-revision-binding=KS246_JOURNEY_DENIED:MISSING_SOURCE_REVISION_BINDING
missing-authority=KS246_JOURNEY_DENIED:MISSING_AUTHORITY
incompatible-semantic-goal=KS246_JOURNEY_DENIED:INCOMPATIBLE_SEMANTIC_GOAL
stale-source-revision=KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE
missing-kind-decision=KS246_JOURNEY_DENIED:MISSING_KIND_DECISION:P
kind-decision-conflict=KS246_JOURNEY_DENIED:KIND_DECISION_CONFLICT:credit
unsupported-kind=KS246_JOURNEY_DENIED:UNSUPPORTED_KIND:refund
incompatible-amount-business-meaning=KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING
unresolved-amount-business-meaning=KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING
business-meaning-subject-mismatch=KS246_JOURNEY_DENIED:BUSINESS_MEANING_SUBJECT_NOT_CONFIRMED_AMOUNT
stale-business-semantics-revision=KS246_JOURNEY_DENIED:SOURCE_REVISION_STALE
unknown-amount-business-meaning-token=KS246_BUSINESS_SEMANTICS_DENIED:MEANING
recorded-incompatible-amount-meaning=KS246_JOURNEY_DENIED:INCOMPATIBLE_AMOUNT_BUSINESS_MEANING
recorded-unresolved-amount-meaning=KS246_JOURNEY_DENIED:UNRESOLVED_AMOUNT_BUSINESS_MEANING
wrong-field-binding=KS246_JOURNEY_DENIED:ROLE_BINDING_NOT_CONFIRMED:amountField
resealed-source-substitution=KS246_JOURNEY_DENIED:SOURCE_NOT_COHERENT_WITH_RELEASED_HOLDOUT
substituted-database-rows=KS246_SOURCE_TABLE_SUBSTITUTED
ambiguous-date-role=KS246_JOURNEY_DENIED:AMBIGUOUS_DATE_ROLE
unclassified-source-column=KS246_JOURNEY_DENIED:UNCLASSIFIED_SOURCE_COLUMN
unsupported-source-access-mode=KS246_SOURCE_DENIED:ACCESS_MODE
source-sql-authority=KS246_SOURCE_DENIED:SQL_AUTHORITY
```

## Canonical registration and integrity migration

The suite is canonically reachable but is deliberately NOT a direct `package.json#scripts.test`
root: the canonical command is byte-bound to the released C1 certificate's live `package.json`
digest, so a new root would break that frozen binding. The suite therefore rides the
established imported-parent route in `tests/source-map.test.mjs`, declared to the topology
kernel in `tests/canonical-test-topology.test.mjs`, preserving the
exactly-one-route-per-suite invariant. No `package.json` byte changed. The whole family
(proposal slice + journey slice) is content-addressed in `SOURCE-MAP.json` by
`scripts/update-ks246-unfamiliar-schema-source-map.mjs`.

## Intervals

- implementation interval: layout profile, binding gates, database seam, CLI, fixtures.
- self-check interval: focused suite (positive, one negative per gate, an independent
  expectation, and RED/GREEN on disposable broken variants — the undecided-kind inference,
  the dropped-column forwarding, and, for the C1-C3 correction, three further variants
  driven through the REAL CLI: a CLI that re-adopts the kind-decision fixture, a CLI that
  manufactures the source revision, and a module without the business-meaning gate).
- test-wait interval: canonical `npm test`, build/manifest, topology and source-map gates.
- unknown stays unknown: no external wait is claimed; AC05 is parent-owned.

## Limitations and open items

- One authored synthetic unfamiliar case is a local proof, **not** a measured blind or
  generalization result.
- C1/C2/C3 boundaries: the caller path defaults nothing; the admitted business meaning is a
  closed vocabulary confirmed by the caller and bound to the source revision, not inferred
  from prose. An incompatible or unresolved meaning is preserved and denied pending
  clarification, never silently executed.
- Real-PGlite mode runs only through the injected `--pglite <absolute dist/index.js>` path;
  the live positive in this environment used `@electric-sql/pglite@0.5.8` from a scratch
  runtime outside the repository (the dependency is deliberately not added to
  `package.json`).
- The executable source is authored to the admitted holdout semantics because the released
  core is byte-bound to it. This is a genuine limit of the released confinement, and it is
  stated here rather than worked around.
- The PAN452 common task contract is separately Qwen-owned and **not accepted**: this slice
  neither designs, stubs nor duplicates its handles, and `sharedTaskHandle` stays
  `NOT_INTEGRATED`. Full AC03/AC04 closure requires that exact shared contract composition
  and is therefore **not claimed**.
- AC05 (independent review, current-Main integration, merge, release, public readback) is
  parent-owned and open.
- Human comprehension and any broader promotion claim remain outside this evidence.
