# Bounded public-only paired read and lifecycle display candidate

The opt-in KS247 CLI now qualifies the released PAN metric-read result against its verified
KS247 lineage and independently supplied metric-contract bytes, returning a separate
`pairedQualification`. The original lineage authority fields remain unchanged. Wrong
period/unit/source/contract, missing completed read, false effect and promoted causal or
completion claims refuse instead of being labelled verified. The default unpaired path
still has no qualification.

The opt-in KS256 display executes the pinned PAN461/PAN471 crossing separately from the
pinned PAN metric-read / actual local synthetic SQL path. It shows verified source identity,
question, periods, units and a producer binding digest. The authored KS project board's
13-item denominator does NOT become an observed target denominator: target identity,
owned target scope, progress and quarantine remain UNKNOWN or NOT_OBSERVED. No effect
journal or migration authority is created.

Local tests: `KS247_PRODUCER_CHECKOUT=<clean pinned PAN v6> KS247_PGLITE_PATH=<pinned
local runtime> KS256_STATUS_PRODUCER_CHECKOUT=<clean pinned PAN ac42e9d> node --test
tests/synthetic-metric-paired-read.test.mjs tests/ks256-paired-status.test.mjs`.
The CLI script `scripts/run-ks256-paired-status.mjs` requires three explicit paths. Its
positive path ran the actual local synthetic SQL read and actual PAN source crossing.
Pure projection tests are helper-only and cannot certify the runtime. No external source,
target or customer is observed. PAN453/454 OS isolation and genuine runtime gates remain
separate. Independent focused review, canonical CI, release and public readback are
not claimed by this local candidate.

An additional KS246 paired caller-decision negative replaces the confirmed credit rule with a contradictory sale rule through the real CLI: the released journey refuses `KIND_DECISION_CONFLICT:credit` with zero verified numbers and no paired qualification; unchanged decisions reach the SQL read. This is one fixed-source rule case, not a general decision ontology or whole AC03 closure.


## Corrected producer successor (public calibration, not a blind case)

The same display entry point additionally accepts `--source-variant v3` after the three
required paths. It selects the already released second-source decisions, semantics and
independent expectation, then executes KS247 against exact PAN486 Main
`da92e10d8751f99b4103dfaa14bc5e5eb732e9dd`. The default v1 path and the exact PAN461/PAN471
status pin `ac42e9d9fa5d6ef471d634159eb5a316464e425e` are unchanged. No new source or metric
is admitted. A previous producer checkout with v3 is denied rather than silently downgraded.

The projection re-derives the released task/result qualification, the complete lineage
digest and the status crossing digest before display. The safe producer lifecycle and
capability fields are visible in a separately labelled observation plane, explicitly NOT
applicable to the metric source or an unobserved target. UNKNOWN and unavailable producer
states are not converted into success; the original authored project board remains separate.
These checks validate the immediate outputs of the executed child entry points. They are
not authentication of caller-minted JSON, a real host probe or target-owner approval.

Run the existing focused suite with `KS247_PAN486_PRODUCER_CHECKOUT` set in addition to
the v1 and status checkout paths above. It covers both actual SQL paths, old producer
substitution, malformed/action flags, and mutations of actual child outputs (question,
period, number, revision and status digest). The last class is helper-level post-read
consistency testing and is not presented as another producer execution.

AC01 remains partial: source identity and separate producer status are observed locally;
target identity/scope/progress remain UNKNOWN and denominator/quarantine NOT_OBSERVED.
The target contract owner must supply independently qualified target evidence. AC02/AC03
have local projection/denial evidence only; independent Main acceptance and delivery remain
required. No issue closure, production, effect or new blind evaluation is claimed.
