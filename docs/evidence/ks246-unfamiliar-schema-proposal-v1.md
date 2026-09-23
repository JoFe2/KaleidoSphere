# KS246 — unfamiliar synthetic schema proposal and clarification (local evidence)

Authority: public issue #246 (KS-EVO-01), order `/workspace/AUFTRAG.md`.
Base `860a8624dc0812ea7cbb19a369a8120b415ba0bb`. This is a **local-only** library/CLI
slice: no public state, no HTTP route, no SQL execution, no production or customer claim.

## What was built (and reused)

| Piece | Path |
|---|---|
| Frozen synthetic unfamiliar schema (metadata only) | `tests/fixtures/business-bi/ks246-unfamiliar-schema/metadata-v1.json` |
| Bounded aggregate evidence (counts only) | `tests/fixtures/business-bi/ks246-unfamiliar-schema/aggregate-profile-v1.json` |
| Proposal + clarification module | `services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs` |
| Local CLI | `scripts/run-unfamiliar-schema-proposal.mjs` |
| Focused suite | `tests/unfamiliar-schema-proposal.test.mjs` |
| Source-map migration | `scripts/update-ks246-unfamiliar-schema-source-map.mjs` |

Reused, not duplicated: the released metric core's frozen operation request
(`NET_REVENUE_OPERATION_REQUEST` from `net-revenue-plan.mjs`) and the released metric
contract (`contracts/business-bi/v1/net-revenue.metric.json`) are READ as the single
authority for the canonical row roles and the closed record-kind vocabulary. No second
metric, currency, date role or mapping engine is introduced.

## Acceptance mapping

| AC | Status here | Exact local evidence |
|---|---|---|
| KS-EVO-01-AC01 | DEMONSTRATED | Frozen synthetic unfamiliar schema loads through `BOUNDED_METADATA_ONLY` + `BOUNDED_AGGREGATE_ONLY`; the candidate separates `observed` / `computed` / `inferred` / `confirmed` layers and names grain, units, period, relationships and unresolved meaning. |
| KS-EVO-01-AC02 | DEMONSTRATED | Named rules detect ambiguous join/fan-out, misleading names (same-type scale conflict and amount-like non-numeric name), units, multi-value currency, ambiguous period, credit and cancellation semantics and missing definitions; the surface asks closed-domain clarification questions and never answers them itself. |
| KS-EVO-01-AC03 | PARTIAL (local support only) | A CONFIRMED candidate is bound to its source revision + caller decisions and handed to the released metric entry point by name (`compileNetRevenuePlan`), with roles/kinds read from the released core. The shared task handle is **NOT integrated** (`sharedTaskHandle: NOT_INTEGRATED`); the owning contract is separately owned. |
| KS-EVO-01-AC04 | PARTIAL (local counterparts only) | Bounded local positives (confirmed candidate + handoff) and negatives (row material, SQL, credentials, wrong classification/access mode, out-of-domain answers, unconfirmed handoff, non-released unit/currency/kind) are executed. Full admitted-metric execution, arbitrary-SQL authority questions and order-intake inference remain open. |
| KS-EVO-01-AC05 | NOT CLAIMED | Parent-owned: independent review, canonical CI, current-Main integration, merge, release and public readback. |

## Exact local execution (commands, exits, counts)

```
node scripts/run-unfamiliar-schema-proposal.mjs               # exit 0 — EOF run: PROPOSED, 21 questions, 0 confirmed, blockingConfirmed=false
node scripts/run-unfamiliar-schema-proposal.mjs --negative    # exit 0 — 8 gates, each with its exact denial code
node scripts/run-unfamiliar-schema-proposal.mjs --answers <file> --handoff   # exit 0 — CONFIRMED candidate + AC03 local handoff
node --test tests/unfamiliar-schema-proposal.test.mjs         # exit 0 — 25 tests, 25 pass, 0 fail
node scripts/check-canonical-test-topology.mjs                # exit 0
node scripts/build-consumer-support-manifest.mjs --check      # exit 0 — VERIFIED
npm run dist:agent-skill                                      # exit 0
npm test                                                      # exit 0 — 1434 tests, 1419 pass, 0 fail, 15 skipped
```

Negative gate codes as executed: `rows=UNFAMILIAR_SCHEMA_DENIED:ROW_MATERIAL`,
`sql=UNFAMILIAR_SCHEMA_DENIED:SQL_AUTHORITY`, `credentials=UNFAMILIAR_SCHEMA_DENIED:CREDENTIALS`,
`classification=UNFAMILIAR_SCHEMA_METADATA_DENIED:CLASSIFICATION`,
`access-mode=UNFAMILIAR_SCHEMA_METADATA_DENIED:ACCESS_MODE`,
`surface=UNFAMILIAR_SCHEMA_METADATA_DENIED:SURFACE`,
`aggregate-rows=UNFAMILIAR_SCHEMA_DENIED:ROW_MATERIAL`,
`eof-handoff=UNFAMILIAR_HANDOFF_DENIED:UNCONFIRMED_QUESTIONS`.

## Canonical registration and integrity migration

The suite is canonically reachable but is deliberately NOT a direct `package.json#scripts.test`
root: the canonical command is byte-bound to the released C1 certificate's live `package.json`
digest, so a new root would break that frozen binding. The suite therefore rides the established
imported-parent route in `tests/source-map.test.mjs`, declared to the topology kernel in
`tests/canonical-test-topology.test.mjs`, preserving the exactly-one-route-per-suite invariant.
No `package.json` byte changed. The new family is content-addressed in `SOURCE-MAP.json`
(`scripts/update-ks246-unfamiliar-schema-source-map.mjs`).

## Intervals

- implementation interval: fixture + module authoring.
- self-check interval: focused suite, positive counterpart per negative, RED on a disposable
  broken variant (the fan-out rule) and GREEN on the real regression.
- test-wait interval: canonical `npm test`, build/manifest, topology, legacy-identity and C1
  certification gates.
- unknown stays unknown: no external wait is claimed here; AC05 is parent-owned.

Observed ambiguity census on the frozen fixture (rule outcomes, not semantic truth):
`AMBIGUOUS_JOIN_FANOUT 1`, `MISLEADING_NAME 2`, `AMBIGUOUS_UNITS 3`, `AMBIGUOUS_CURRENCY 1`,
`AMBIGUOUS_PERIOD 1`, `CREDIT_SEMANTICS_UNRESOLVED 2`, `CANCEL_SEMANTICS_UNRESOLVED 2`,
`MISSING_DEFINITION 12`.

## Observed / inferred / confirmed separation

- **Observed** — only the fixture's declared metadata and bounded aggregate counts.
- **Computed** — named deterministic rule outcomes (`KS246_R_*`), each with `factSha256`
  and evidence refs; anomalies no rule classifies stay recorded blind spots.
- **Inferred** — proposal-only candidates (`observationKind: INFERRED`,
  `reviewState: REVIEW_REQUIRED`, `executionAuthority: NONE`).
- **Confirmed** — exists only because a caller supplied an answer through the clarification
  entry point. EOF, an empty line and the refusal token `none` stay `ABSENT` / `REFUSED`;
  out-of-domain answers are `REJECTED` with an exact code. No code path supplies an answer.

## Limitations and open items

- One authored synthetic unfamiliar schema is a local proof, **not** a measured blind or
  generalization result, and not a universal schema-understanding engine.
- The metric handoff is a bound proposal, not admission; residual record-kind values stay
  explicitly unresolved and are never silently treated as sales.
- AC03's shared task handle, AC04's full positive/negative execution and AC05's delivery
  remain open and separately owned.
- Human comprehension and any broader promotion claim remain outside this evidence.
