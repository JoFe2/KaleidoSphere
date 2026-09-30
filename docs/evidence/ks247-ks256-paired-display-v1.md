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

At the retained corrected-producer checkpoint, AC01 was partial: source identity and
separate producer status were observed locally; target identity/scope/progress remained
UNKNOWN and denominator/quarantine NOT_OBSERVED. That checkpoint did not include target
observation or independent delivery. The following bounded successor addresses the local
synthetic target gap; it does not rewrite those historical evidence classes.

## Observed synthetic receipt target (KS-OPS-04 AC01–AC03)

The same CLI additionally accepts `--target-snapshot <directory> --target-revision
synthetic-target-r1` (or `synthetic-target-r2`). Omission preserves the original UNKNOWN
path. The directory is a caller-provisioned, generic synthetic receipt target, not an
installation, service, transfer execution or production environment. No customer or host
access is needed or claimed. The five owned artifacts are metric-contract, read-task,
read-result, result-lineage and qualification, each with a `.json` suffix. Their expected
bytes are derived from the just-executed qualified read, never from target-supplied hashes.
`target.json` has the exact closed shape returned by `syntheticTargetMarker(read, revision)`;
`syntheticTargetArtifacts(read)` supplies explicit sample bytes for separate local setup.
The test provisioner demonstrates this setup from an actual released SQL read. The display
itself never provisions or changes target bytes and accepts no write/approval action.

AC01: the full actual-entry case reads five exact artifacts and displays both source and
synthetic target identities, owned scope/owner, denominator 5, verified count 5, fraction 1,
empty quarantine and NONE_OPEN. Its mixed case reads a mismatch (PARTIAL/quarantined),
observes a missing file (OBSERVED_ABSENT), encounters denied permissions (DENIED) and refuses
a symlink (UNKNOWN). Only the remaining exact artifact counts. The fraction is unknown,
not a fabricated zero or success. Each unresolved item carries TARGET_CONTRACT_OWNER.
The denominator is the fixed versioned receipt-artifact contract, not the old authored
board denominator or a transfer-completion claim. Arbitrary input text and paths are never
copied to output. Unexpected identity fields, including raw-person-shaped fields, refuse.

AC02: tests exercise both v1 and corrected v3 source reads. Target source and requested
revision must match the fresh qualification; stale revision or substituted source refuses.
All five files and the identity marker are read twice to refuse an unstable snapshot.
This bounded stability check is not an atomic filesystem snapshot. An optional
`--target-observation-sha256 <previously-retained-digest>` requires the newly observed
complete status binding to match that independent retained observation. Changing target
bytes cannot reuse a previous complete receipt: it either displays a new explicit
PARTIAL/UNKNOWN/DENIED/OBSERVED_ABSENT state or refuses the carried digest. Currentness
means the requested revision at this local read, not a wall-clock or remote attestation.

AC03: UPDATE, RESTORE and MIGRATE flags refuse through the actual CLI before producer or
target execution. The positive display has READ_ONLY with all mutation rights NOT_GRANTED.
Tests compare target file bytes before/after the positive execution. The producer lifecycle
plane remains separate and never becomes evidence for this target or metric source.

Reproduction (Node 24, pinned PGlite 0.3.14 and clean exact public producer checkouts):

    PAN_PUBLIC_CHECKOUT=<status-checkout> \
    KS256_STATUS_PRODUCER_CHECKOUT=<status-checkout> \
    KS247_PRODUCER_CHECKOUT=<v1-read-checkout> \
    KS247_PAN486_PRODUCER_CHECKOUT=<v3-read-checkout> \
    KS247_PGLITE_PATH=<pinned-runtime>/dist/index.js \
    node --test tests/ks256-paired-status.test.mjs \
      tests/public-producer-status-crossing.test.mjs \
      tests/project-lifecycle-transfer-status.test.mjs

The named AC01–03 actual-entry test provisions only newly authored generic synthetic
snapshots from actual child outputs, then exercises this CLI for both sources. It is public
calibration, not blind evaluation. Canonical CI includes the real-file helper boundary;
the public counterpart legs are explicit opt-ins and must be separately executed for
acceptance. Independent review, exact-head CI, release and readback are separate delivery
records, not claims established by this document. No broader operational rights are added.
