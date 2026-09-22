# KS236 (#KPI-USER-01) — reader-task protocol

Status: LOCAL CANDIDATE. The protocol is prepared and runnable. **No human comprehension
evidence exists yet.** This document must never be read as a passed comprehension gate.

## What KS236 acceptance requires

> Document a short reader-task protocol and record actual comprehension evidence separately
> from browser/agent tests. Do not fabricate human responses or claim the broader #167
> promotion gate passed from automated tests.

## Why an emitter, not a result

An automated run cannot produce comprehension evidence: only a human can. So this protocol
ships the blank form rather than any answer. The emitter writes the comprehension record with
`readerIdentity`, `readAt` and every answer set to `null`, and the suite asserts that
blankness — a filled record can only come from a real reader editing the file.

The **reference answers are graded-only**: they are written into the same JSON but are never
shown to the reader, so the task measures comprehension instead of copying.

## Run it

    node scripts/emit-ks236-reader-task.mjs --out /tmp/ks236-reader-task.json
    # or over the real local PostgreSQL source:
    node scripts/emit-ks236-reader-task.mjs \
      --pglite /workspace/.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js \
      --out /tmp/ks236-reader-task.json

The worksheet's figures come from a real connected-journey execution, so the reader reads the
same numbers the journey publishes (current 2026-07 = 66000 cents, comparison 2026-06 = 45000
cents, delta = 21000 cents, in integer EUR cents).

## The task (short, ~5 minutes)

The reader is given ONLY `worksheet.readerFacing` and is asked to answer in their own words:

| ID | Prompt | Measures |
| --- | --- | --- |
| T1 | What does this metric measure, and in which unit? | meaning + units |
| T2 | Which period is current, which comparison, with date ranges? | period |
| T3 | State the delta; is it a causal claim? | arithmetic vs causal |
| T4 | Name every null field and what the null means. | honest missing data |
| T5 | How are UNKNOWN rows treated? | unknown channel |
| T6 | Do cancel rows contribute to net, and why? | corrections |
| T7 | Does this support a period-end open-order balance claim? | nonclaim recognition |

## Recording evidence (a real reader only)

1. Run the emitter; open the JSON file.
2. Fill `comprehensionRecord.readerIdentity` with who actually read it, and `readAt` with an
   ISO timestamp.
3. Fill each `answers.<ID>` in the reader's own words. Leave a task `null` if it was not
   understood — an honest gap is evidence; a fabricated answer is not.
4. Return the file unedited otherwise.

Scoring is not automated and not part of this protocol: a human reviewer compares the answers
against `referenceAnswers` and records the outcome. T3, T4 and T7 are the discriminating
items — they separate reading the numbers from understanding the nonclaims.

## Explicit nonclaims

- No comprehension result exists until a real reader fills the form. This protocol cannot and
  does not claim the #167 promotion gate passed.
- No browser/agent test is substituted for human comprehension.
- The synthetic figures are non-customer bytes; nothing here implies production readiness.
