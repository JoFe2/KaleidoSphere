# KS248: corrected rights/checker and paired access evaluation v2

Classification: local synthetic comparison tooling. A completed comparison may falsify
reuse; it does not implement missing capabilities. No external data or effect authority.

## Review corrections

The retained v1 segment comparison and fixed-domain paired subset remain distinct datasets.
A focused review found ordinary engineering defects, not external permission gates:

- Full-data candidate execution now refuses `rowLevel=DENIED` before projection. The
  projection helper independently refuses that combination. Permitted aggregates still work
  in the segment harness. This is a declared synthetic restriction, not DB privileges: the
  trusted evaluator reads/hashes fixtures separately from candidate projection.
- FX permission no longer impersonates capability. Denied FX stays `REFUSED_DENIED_FX`;
  permitted-but-unimplemented conversion is `REFUSED_UNSUPPORTED_FX`, with no number.
  The historically incorrect calibration is preserved in `calibration-denied-credits-v1.json`;
  a separately frozen v2 calibration expects unsupported conversion. The old expectation
  now fails verification, rather than being silently rewritten as historical success.
- A refusal OR abstention against an accepted independent expectation is `FALSE_REFUSAL`.
  Both calibration and holdout mismatches fail verification, including false refusals.
- Clarification and correction work are unobserved (`null` with reasons). Counts of
  abstention/boundary outcomes and failed expectations are explicitly named proxies, not
  recorded human/agent interactions. Waiting, active work and cost remain unknown.
- Exclusive-boundary rules are explicitly unsupported by this released comparison path;
  they no longer produce silently inclusive aggregate values. Implementing another rule is
  not required to record this limit. Integer reference checks still distinguish rules.

The six correction regressions were first exercised against the unchanged implementation
and failed, then passed after the corrections. Retained RED/GREEN controls remain active.

Report migration: the stable module path now emits
`kaleidosphere.business-bi/access-mode-journey-comparison/v2`. Changed outcome vocabulary,
unknown interaction metrics and stricter verdict checks are explicit. Carried v1 bindings
do not silently acquire v2 verification: rerun from retained inputs. Old evidence remains
historical; fallback is non-execution/refusal, not re-enabling the defective permission path.

## One actual paired task, not pooled unrelated successes

Run from a clean Git checkout using the pinned producer and verified PGlite closure:

    node scripts/run-ks248-paired-access-evaluation.mjs \
      --producer-checkout <absolute-pinned-PAN-v1-checkout> \
      --pglite <absolute-pinned-PGlite-entry>

The evaluator binds the actual consumer commit/tree and frozen input digests. Producer:
`d8e78430e66a6d1b623fde26a3018089652d2112`; source revision:
`synthetic-unfamiliar-source-v1`; source digest:
`56724bfa95e66d8b61a837e82098aeee67ad430434794da944d033d61dd9737e`.
The question, metric, task reference, layout, periods, integer EUR units and inclusive rule
are held constant for all three requested access modes. Full-data execution must actually
reach the producer-bound SQL/lineage path with 24 verified numbers and no effect authority.

`access-cases-v2.json` contains no expected result. Calibration and holdout live in separate
files; the trusted evaluator, never candidate argv, reads those expectations. The reference
is a separate integer fold over the frozen source; credits subtract, cancellations and
UNKNOWN do not enter net, null-date/null-amount and out-of-window rows do not become zero
contributions. Public evaluator-owned fixtures are not third-party or private blind data.

The reference can answer the numeric question from permitted period aggregates or full
rows, and must abstain on metadata. The existing paired candidate accepts full data but
rejects metadata/aggregate flags as `KS247_PAIRED_CLI_SCOPE_DENIED`. Therefore:

- The full-data result is scored against independently retained period nets/delta.
- Aggregate rejection is a false refusal versus the competent reference, not evidence of
  an implemented permitted-aggregate mode.
- Metadata scope rejection is a wrong refusal reason versus the reference's justified
  numeric abstention, not a successful metadata reasoning capability.
- Restricted-mode candidate setup preloads local fixtures before flag rejection. This
  evaluation is NOT an input-isolation/data-privilege proof. `dataRightsQualification` is
  `NOT_ESTABLISHED`; no false “no data was read” claim is made.

The report keeps reference and integrated metrics separate within each population. A valid
run exits 0 because the comparison executed; `benchmark: FAIL` and
`outcome: EVALUATED_WITH_FALSIFIED_REUSE` state the actual capability result. The tests
require that negative finding rather than hiding it behind a green harness. No work/wait/
cost values are inferred from test duration. No effect scenario is included or required.

## Original criteria and scope

AC01: frozen evaluator-owned cases and disjoint expectations; exact execution identities.
AC02: corrected segment mode/rights/FX/credits/boundary/join checks plus honest fixed-task
paired mode attempts. Paired aggregate/metadata support is falsified, not implemented.
AC03: retained source/rule mutations, binding re-verification and real producer read;
conditional effect trigger absent. No varied-source adaptation claim.
AC04: competent independent reference versus actual paired output, explicit failure counts,
unknown unobserved interaction/work/cost. Separate segment results are never pooled.
AC05: requires independent finding verification and the existing CI/merge/release/readback
pipeline. This document is not an acceptance or publication receipt.

## Actual crossings and absent triggers

For the original starting Canon map: CM-CAN-01/04 apply to the authority-free evaluator,
explicit runtime/source scope and unchanged read-only producer task; permission is not
conversion capability. CM-CAN-10 applies to producer/result binding and the required later
publication readback; CM-CAN-11 to exact denials rather than accepting contradictory
expectations or missing capability. CM-CAN-16/17 apply to version-bound claims, preserved
historical calibration and explicit correction semantics, not fabricated readiness.
CM-CAN-27 applies to result-only observations and minimized public evidence, not raw source
or caller paths. No productive effect, customer/tenant
crossing, activation, marketplace submission or human observation occurs. Other laws remain
unassessed here rather than silently declared inapplicable. #236/#167 human/promotion gates
and #250 real-source permissions are not altered.

## Registered verification

Both extended suites retain their existing canonical import registration. CI additionally
fetches the exact public producer without persisted credentials and executes the paired
suite and actual evaluator with the pinned runtime; optional local omission is not used as
paired evidence. Tests exercise one-cent/reference-rule mismatch and unsupported-mode
classification, while the retained paired suite exercises source drift before SQL claims.
