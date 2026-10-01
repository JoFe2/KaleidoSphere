# KS236 — reader task v2 and local receipt boundary

This is a correction to the runnable reader instrument, not a reader result. #236 and
#167 remain open for their own original criteria. Every emitter-created identity,
timestamp, source-mode response, note and T1–T7 answer remains null.

## Active instrument and frozen history

`node scripts/emit-ks236-reader-task.mjs` emits schema
`kaleidosphere.business-bi/ks236-reader-task/v2`. The visible result now includes
`openOrderCount` alongside `orderIntake` and `openOrderValue`; all three are null.
The T4 grading reference no longer expects a field absent from the reader's view.
The figures are produced by the unchanged connected journey over synthetic data.
With `--pglite`, that journey uses an injected local PostgreSQL engine; without it,
`SYNTHETIC_FALLBACK` is explicit. Neither execution records human comprehension.

The exact earlier emitter is retained as `emit-ks236-reader-task-v1.mjs`, with its
original protocol and figures/fixtures byte-preserved. It is historical replay only,
not the current worksheet or an approved output boundary. Its T4 projection is known
to omit `openOrderCount`; do not use it to qualify a new reader observation.
`ks236-reader-task-v1-frozen.json` records the version binding and hashes.

## Prepare and separate the handoff

Use a task-owned directory under your configured temporary root or this checkout.
For example, from the repository root:

    mkdir -p .ks236-reader-task
    node scripts/emit-ks236-reader-task.mjs --out .ks236-reader-task/maintainer.json

For the real local PostgreSQL path, add `--pglite` with the absolute path of the
separately installed PGlite `dist/index.js`. Do not change the package manifest or
connect a customer/production source.

The maintainer JSON contains both the worksheet and the grading reference. It is
NOT the reader handoff. Prepare the reader-only and grader-only files:

    node --input-type=module -e 'import {readFileSync,writeFileSync} from "node:fs"; const p=".ks236-reader-task/"; const e=JSON.parse(readFileSync(p+"maintainer.json","utf8")); writeFileSync(p+"reader.json",JSON.stringify({schemaVersion:e.worksheet.schemaVersion,provenance:e.worksheet.provenance,readerFacing:e.worksheet.readerFacing,comprehensionRecord:e.worksheet.comprehensionRecord},null,2)+"\n"); writeFileSync(p+"grading.json",JSON.stringify(e.referenceAnswers,null,2)+"\n");'

Give ONLY `reader.json` to a consenting real reader. Do not expose the combined
maintainer envelope or `grading.json`, provide answers, or coach the interpretation.
Ask for their own T1–T7 wording, actual identity/time and observed source mode. An
honest null, mistake or misunderstanding is valid evidence, not a reason to fill in
an answer. Keep identity and raw responses internal unless separately authorized.
A separate human assessor compares the returned answers with the grading reference,
records understanding and gaps, and distinguishes actual observation from automated
execution. Report only consented, sanitized findings. No filled response is supplied
or implied by this correction. The broader #167 usefulness/maintenance gate remains
independent.

## Receipt confinement

The active base, F4, connected, guided and reader CLIs share a narrow output helper.
`--out` permits exactly the checkout or `os.tmpdir()` for that process. A configured
TMPDIR replaces an implicit system temporary root; it does not add a second root.
Exact root+separator matching denies sibling prefixes. Component `lstat` rejects
existing/dangling leaf and ancestor symlinks, including links with in-root targets.
The final open uses `O_NOFOLLOW`; ordinary new and overwritten regular receipts work.
Directories and special files are refused. No protection against hostile concurrent
ancestor replacement or general filesystem-authority framework is claimed.

The ROADMAP now distinguishes the already released guided surface
(`2026_09_22_v2`) and retained F4 seed/read negatives from missing real reader evidence.
README and released calculation/readback/visualization are not replaced.

## Checks

    node --test tests/ks236-reader-task-v2.test.mjs
    node --test tests/net-revenue-connected-journey.test.mjs tests/net-revenue-guided-journey.test.mjs tests/net-revenue-f4-composition.test.mjs tests/net-revenue-journey.test.mjs

The new suite has one canonical import route via `tests/source-map.test.mjs`.
Tests are machine evidence for blankness, grading/view consistency and deterministic
output confinement only. Actual human responses remain a separate external gate.
