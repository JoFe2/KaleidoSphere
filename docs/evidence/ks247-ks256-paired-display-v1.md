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
