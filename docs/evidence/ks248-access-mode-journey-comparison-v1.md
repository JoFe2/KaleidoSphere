# KS248 (KS-EVO-03) — access-mode journey comparison

Synthetic comparison of declared data rights; no real-source or production qualification.

`Result / DoD`: "A small reproducible comparison proves or falsifies correctness and useful
reuse under declared information rights and source/rule changes."

## What this slice adds

| Piece | Path |
|---|---|
| Access-mode comparison module | `services/bi-control/src/business-bi/access-mode-journey-comparison-v1.mjs` |
| Runnable CLI entry point | `scripts/run-access-mode-journey-comparison.mjs` |
| Evaluator-owned frozen cases (NO expectations) | `tests/fixtures/business-bi/ks248-access-modes/cases-v1.json` |
| Independently retained source identity | `tests/fixtures/business-bi/ks248-access-modes/source-identity-v1.json` |
| Blind holdout / public calibration (rights profile A: FX denied, credits permitted) | `holdout-v1.json`, `calibration-v1.json` |
| Blind holdout / public calibration (rights profile B: FX permitted, credits denied) | `holdout-denied-credits-v1.json`, `calibration-denied-credits-v1.json` |
| Rights profiles | `rights-profile-a-v1.json`, `rights-profile-b-v1.json` |
| Focused suite | `tests/access-mode-journey-comparison.test.mjs` |
| Integrity migration (additive, idempotent) | `scripts/update-ks248-access-mode-source-map.mjs` |

Reused, never replaced: the released `compareSegmentsAcrossPeriods` comparison as the
INTEGRATED PATH (its period windows, recognition rule and missing-data semantics are carried
through), the released `canonicalJson`, and the unchanged released synthetic segment fixture as
the full-data source. The #145/#146 oracle and the #237 mapping tests are untouched.

## The comparison as executed

```
node scripts/run-access-mode-journey-comparison.mjs --cases cases-v1.json \
  --holdout holdout-v1.json --calibration calibration-v1.json \
  --source-identity source-identity-v1.json --rights rights-profile-a-v1.json \
  --source-rows tests/fixtures/business-bi/net-revenue-segment-v1.json --format TABLE
  exit 0 — COMPARED; blind holdout: correctAcceptance 3, falseAcceptance 0, falseRefusal 0,
           wrongNumber 0, wrongRefusalReason 0, justifiedAbstention 0, refusalMatch 2;
           public calibration: 0 / 0 / 0; integratedPathDisagreement 0;
           waiting = null, activeHumanOrAgentWork = null, measurableCostMinorUnits = null
same with --rights rights-profile-b-v1.json --holdout holdout-denied-credits-v1.json \
  --calibration calibration-denied-credits-v1.json
  exit 0 — COMPARED; blind holdout: correctAcceptance 1, refusalMatch 4, 0 false acceptance,
           0 false refusal, 0 wrong rejection reason; public calibration 1 accepted, 0 failures
--verify --binding <carried comparison>          exit 0 — verify=VERIFIED code=OK
--negative                                       exit 0 — 20 gates, 0 unexpected
node --test tests/access-mode-journey-comparison.test.mjs
                                                 exit 0 — 22 tests / 22 pass / 0 fail
```

Per-case observation under profile A (`case → observed → verdict`):

```
case:full-net-delta            ACCEPTED               CORRECT_ACCEPTANCE
case:aggregate-net-delta       ACCEPTED               CORRECT_ACCEPTANCE
case:metadata-net-delta        ABSTAINED              REFUSAL_MATCH
case:aggregate-order-status    ABSTAINED              REFUSAL_MATCH
case:full-fx-required          REFUSED_DENIED_FX      REFUSAL_MATCH
case:full-boundary-unspecified ABSTAINED              REFUSAL_MATCH
case:full-segment-net-totals   ACCEPTED               CORRECT_ACCEPTANCE
case:ambiguous-join-net-delta  REFUSED_AMBIGUOUS_JOIN REFUSAL_MATCH
```

Under profile B the credits-requiring cases refuse by name
(`REFUSED_DENIED_CREDITS`), the FX-requiring case is answered, and the case that does not
require credits is answered from a projection that does not read a single credit row — which
is a DIFFERENT number from the credits-permitted profile (45000/66000/21000 versus
50000/72000/22000 minor units). The credits right is enforced by what is READ, never by
reading and then zeroing.

## Acceptance mapping

| Criterion | Observed evidence |
|---|---|
| `KS-EVO-03-AC01` freeze evaluator-owned synthetic cases and exact producer/consumer identities; hidden expectations outside the candidate input; calibrate ≠ blind holdout | the case input is shape-closed against any expectation field; both evidence populations are digest-bound and re-derived; the populations are proved disjoint and reported separately (`PUBLIC_CALIBRATION_AND_BLIND_HOLDOUT_ARE_DISJOINT_POPULATIONS`); a blind case leaking into the calibration set is refused |
| `KS-EVO-03-AC02` metadata-only / permitted aggregates / permitted full data with justified abstention, denied FX, credits, boundary dates, ambiguous joins; one-cent and rule mutations fail the independent checker | all three modes exercised; the metadata-only numeric question ABSTAINS with its named basis; the row-level question abstains from aggregates; `REFUSED_DENIED_FX`, `REFUSED_DENIED_CREDITS`, `ABSTAINED` (unspecified boundary rule) and `REFUSED_AMBIGUOUS_JOIN` each refuse by their own name; a one-cent row mutation is `SOURCE_SUBSTITUTION`; the same mutation with a RESEALED identity is `SERIALIZED_BINDING_MISMATCH`; a one-cent expectation mutation yields `WRONG_NUMBER` and the checker refuses with `BLIND_HOLDOUT_VERDICT_FAILED`; a boundary-rule mutation and a rights mutation are both refused |
| `KS-EVO-03-AC03` source/rule drift, retained applicability and the paired read path; no mock completion | an out-of-window row and a null-amount row are excluded by both paths; a boundary-dated row makes the rule observably matter (1000 minor units) and the released integrated path agrees with the reference on the boundary-inclusive reading; no synthetic EFFECT case exists in this slice, so no mock completion is consumed and no effect/completion status is presented (asserted per result) |
| `KS-EVO-03-AC04` competent deterministic reference versus the integrated path on correctness, false acceptance/refusal, clarification, active work, correction, waiting and cost; missing metrics remain unknown | the reference is an independently shaped fold (explicit boundary rule, its own accumulation) and agrees with the released path on every accepted full-data case in both profiles; correctness / falseAcceptance / falseRefusal / clarificationsRequested / correctionsRequired are integer counts, and `waiting`, `activeHumanOrAgentWork` and `measurableCostMinorUnits` are `null` with `NOT_INSTRUMENTED:` / `NOT_INVENTED:` reasons |
| `KS-EVO-03-AC05` | **NOT CLAIMED — delivery-owner owned** (independent focused review, canonical CI, current-Main integration, exact-head merge, functional release classification, public readback) |

## RED/GREEN

Six disposable variants, each written to a dot-prefixed scratch path inside the module's
directory, DRIVEN to show the boundary RED on the variant, then removed in a `finally` and
asserted absent. The candidate is driven on the same input and is GREEN:

1. `no-credits-refusal` — a blind case becomes a FALSE ACCEPTANCE on the variant (2 false
   acceptances) and none on the candidate.
2. `no-metadata-abstention` — the metadata-only question no longer abstains on the variant.
3. `no-source-identity-check` — a one-cent substitution is not refused on the variant.
4. `no-holdout-digest-check` — a consistently tampered holdout is accepted on the variant.
5. `no-population-separation` — a contaminated population is accepted on the variant.
6. a CLI variant that IMPLICITLY defaults `--rights` is driven through the real entry point:
   the variant no longer reports the missing input, the candidate refuses it.

## Boundary disclosures (never hidden)

- The cases, the calibration set and the blind holdout are **evaluator-owned synthetic
  declarations derived from the independent deterministic reference and then frozen**. They are
  a DECLARED synthetic blind set, not an externally authored or third-party holdout, and the
  access modes are declared synthetic restrictions enforced by this module — not a database
  privilege system.
- No external source, credential, customer or cross-tenant data was accessed; no SQL, socket or
  network call is made.
- The comparison grants no authority and produces no effect; it is not a measured-superiority
  claim and not an independent acceptance.
- Phases/effort: **UNKNOWN** — not instrumented.

## Non-claims

No production, customer, private-source or credential data; no real-environment, runtime or provider/model claim; no second metric
implementation or competing product path; no cross-repository acceptance; no broad-maturity,
human-comprehension or measured-performance claim.
