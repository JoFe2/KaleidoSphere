# KS250 (KS-EVO-05) — credential-free read-only metric pilot protocol and synthetic rehearsal

LOCAL / SYNTHETIC / READ-ONLY. Nothing here connects to a real source, reads a real record,
carries a credential or claims a real pilot. Every number below was produced by the commands in
this record, run on this checkout.

## What this slice establishes locally

- The frozen credential-free pilot protocol (versioned, digest-bound, closed vocabulary,
  `credentialFree: true`, `allowedAuthentication: ['NONE']`, `rowLevelPermitted: false`).
- Data minimization (allowed/forbidden field kinds) and the source/identity/permission contract.
- The metric-definition confirmation: the module re-digests the released metric contract
  `contracts/business-bi/v1/net-revenue.metric.json` from disk and refuses a substituted digest.
- The synthetic rehearsal on the EXISTING installable path: the released
  `compareSegmentsAcrossPeriods` read path over the released synthetic rows, labelled
  `SYNTHETIC_REHEARSAL`, `realPilot: false`, `callableAsRealPilot: false`.
- The permission gate: a context without its own explicit permission record stays
  `BLOCKED_EXTERNAL:KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING`; a revoked permission stays
  `...:PERMISSION_REVOKED`; a granted permission without a declared human reading stays
  `CONTRACT_LEVEL_ONLY`.
- The reader-explanation contract: a `SIMULATED` answer is refused, an explanation for an
  ungranted context is refused, and a missing explanation is never inferred.
- The measured-time contract: an unmeasured duration stays `null` with an
  `UNKNOWN: not measured for ...` reason and is never a zero.
- Reuse in a second context: the second context needs its own permission; without a declared
  human reading on the second context the reuse state is `CONTRACT_LEVEL_ONLY`, never a reuse
  finding; `generalizationClaim` is `NOT_PERMITTED`.

## Headline state (the honest local result)

`realPilotExecuted=false`, `qualifiedContextCount=0`, `blockedContextCount=2`,
`secondContextReuse=BLOCKED_EXTERNAL`, `generalizationClaim=NOT_PERMITTED`,
`credentialsAccepted=false`, `rowLevelReadPerformed=false`.

## Named partial boundary (NOT done here, and not claimed)

- **BLOCKED_EXTERNAL — real read-only pilot.** No real source permission exists locally, so no
  real context was connected, read, or qualified. AC03/AC04's real-pilot legs remain external.
- **BLOCKED_EXTERNAL — human reader explanations.** No human reader exists locally, so no
  human-comprehension evidence exists. The suite exercises the contract with explicitly labelled
  `AUTHORED_TEST_INPUT` declarations, which are asserted to be uncallable as human evidence
  (`humanComprehensionEvidence: false`). No simulated or invented human answer appears anywhere
  in this slice.
- **UNKNOWN — measured times.** setup, clarification, correction and maintenance times are all
  unmeasured → `null` with an explicit UNKNOWN reason.
- **UNKNOWN — second-context reuse.** No real second context was approved or read, so no
  comparative finding exists; the sanitized comparative publication leg is NOT attempted.
- `countsAsPilotEvidence` stays false; no small-pilot generalization is made.

## Tests actually run

- `npm test` (full repository suite, 1524 tests) — see `evidence/npm-test.log`.
- `node --test tests/read-only-metric-pilot.test.mjs` — 20 tests, 0 failures. Payload: 29,211 bytes.
  The suite covers AC01–AC04, the reading/checker surfaces, JSON/TABLE rendering, the real
  CLI end-to-end (EOF, honest default, authorized rehearsal, `--verify`) and five RED/GREEN
  boundary pairs driven against broken disposable variants.
- `node scripts/run-read-only-metric-pilot.mjs --negative` — 19 gates, 0 unexpected.
- `node --test tests/source-map.test.mjs tests/canonical-test-topology.test.mjs` — the tracking
  and exactly-one-route invariants hold with the new suite riding the imported-parent route.
