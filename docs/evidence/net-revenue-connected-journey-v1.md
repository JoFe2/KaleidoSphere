# KS236 -> KS237 -> KS238 — connected authorized local user journey (v1)

Status: LOCAL CANDIDATE. Not released, not published. Review and public delivery are owned
by Hermes `e2e345eb187a`.

## What this closes

The three released stages each proved a boundary in isolation:

| Stage | Released surface | What it proved alone |
| --- | --- | --- |
| KS236 | `net-revenue-journey.mjs` (#236) | a plan can be executed against a source and reconciled to an independently admitted oracle |
| KS237 | `net-revenue-ledger-mapping.mjs` (#237) | two frozen, version-distinct profiles map two source layouts to the same canonical rows |
| KS238 | `net-revenue-segment-comparison.mjs`, `net-revenue-f4-composition.mjs` (#238) | period/segment comparison reconciled to independent expected values, with explicit nonclaims |

What none of them proved is the **connection**: that one authorized local user can walk the
three in order over the *same* source, with each handoff checked, and that the terminal
handoff to PSAi hits the released fail-closed ingestion boundary rather than a private
shortcut.

## Delivered shape

    KS236 (plan/execute/reconcile to oracle)
      -> KS237 (bind both frozen profiles, hand off the projection)
        -> KS238 (period+segment comparison, nonclaims carried)
          -> PSAI (release-registry boundary; HELD profile DENIED)

Entry points:

- module: `services/bi-control/src/business-bi/net-revenue-connected-journey.mjs`
- CLI:    `scripts/run-connected-net-revenue-journey.mjs [--pglite <abs dist/index.js>] [--negative] [--format JSON] [--out <path>]`

## Evidence produced by real execution

Executed twice — once through the labelled synthetic fallback and once against a **real
local synthetic PostgreSQL source** (PGlite injected, rows seeded by genuine SQL and read
back by SQL, never handed to the composer as an in-memory array):

    SYNTHETIC_FALLBACK : allStagesReconciled=true  stages KS236|KS237|KS238|PSAI reconciled
                         connectedDigest 34678c96...f131ee9
    REAL_POSTGRESQL    : allStagesReconciled=true  connectedDigest 6bc4ba49...ff2f19
                         ks237 kernelDigest   d8e25e3c...a62446b4
                         ks238 comparisonDigest 5a82dce2...7f6543c0

Note the two `connectedDigest` values differ by design: the receipt binds its own
`sourceMode`, because the mode is a fact about how the source was read and must not be
laundered out of the receipt. The **semantic** claim is the stronger, mode-independent one,
and the suite pins it separately: the KS238 `comparisonDigest` is byte-identical across
source modes **and** across both released layouts — test *"the KS238 comparison is
byte-identical across source modes and across both layouts"* asserts exactly that. The
domain core is transport-neutral; only the receipt differs.

## Independent expected values

Every published number is reconciled against values computed by hand from the released
fixture row data — not read back out of the modules under test. The derivation is written
into the suite as comments so a reviewer can check the arithmetic without re-running
anything. For the July-vs-June window:

- June sales 30000 + 20000 = 50000; June credits 5000 => net 45000
- July sales 45000 + 15000 + 12000 = 72000; July credits 6000 => net 66000
- deltas: net 21000, sale 22000; one out-of-scope row (2026-05-30) excluded
- UNKNOWN stays per-period: the 900 sits in June's unknown channel, July's is unquantified

That last point is a correction the suite caught: an early hand-derivation mis-attributed
the June unknown row to July, and the test failed with `0 !== 900`. The expectation was
fixed to match the data, not the code — which is the correct direction of repair.

## Positive and negative coverage

Positive: ordered stage progression with per-handoff reconciliation; both frozen profiles
bound to the same kernel row count; comparison reconciled to hand-derived values; real-DB
run; cross-mode/cross-layout byte identity; receipt stability/digestibility.

Negative (fail-closed, each with its own code, none collapsed into a generic failure):

- `CONNECTED_KS237_KERNEL_DIVERGENCE` — a profile that drops rows is never reported as bound
- `CONNECTED_KS238_EXPECTATION_DENIED` — a mutated source that changes net revenue stops the chain
- `XRA_KS01_RELEASE_HELD` — the honest HELD PSAi profile is DENIED by the released boundary
- `XRA_KS01_PROVENANCE_FORGERY_DENIED` — a *forged* "RELEASED" provenance is denied by the
  provenance gate, and deliberately carries a **different** code from the honest denial:
  fabricating closure evidence is not equivalent to an unclosed dependency
- `CONNECTED_CLI_OUT_PATH_DENIED` — `/tmpfoo` lookalike prefix rejected

## Integrity migration

Registering a new suite trips the repository's own self-policing gates, which is the point:

- `tests/canonical-test-topology.test.mjs` failed closed with the orphan-suite diagnostic
  the moment the suite was `git add`ed — proving the gate is live, not decorative.
- migration: the connected suite rides the existing imported-parent route in
  `tests/source-map.test.mjs` (no `package.json` mutation, no second direct root, so the
  topology kernel's exactly-one-route invariant still holds); the connected module, CLI,
  suite and this document are added to the frozen `businessBiFiles` content-addressed
  allowlist.

## Nonclaims

- This is a LOCAL candidate. No public write, no README redesign, no release.
- Passing proofs here do not claim production/host compatibility.
- Order intake and open-order balance remain explicitly unsupported (`null`), inherited
  from the released #238 limit — the connected journey does not invent them.
- No causal attribution, gross-only segments, as-of limits: carried from the released
  report, not restated as new claims.

---

# Package 2 — the PSAi handoff's normal path, substitution, and expiry

Status: LOCAL CANDIDATE, same commit series as above. Not released, not published.

## The gap this closes

Package 1 exercised the PSAi handoff only in its denial shape, and the stage hard-wired its
expectation to `DENIED`:

    expected: { state: 'DENIED', code: 'XRA_KS01_RELEASE_HELD', boundaryRespected: true }

That made the **normal, admitted** handoff unrepresentable — the successful path could never
be tested, and "boundaryRespected" silently meant "was denied". The order requires the actual
entrypoint be exercised for normal paths, not only rejection. Fixed by deriving the expected
outcome from the declared provenance instead:

    const expectedState = provenanceStatus === 'HELD' ? 'DENIED' : 'CANDIDATE';
    const boundaryRespected = result.state === expectedState;

A HELD profile that is admitted, and a release-attested profile that is denied, are now BOTH
correctly reported as boundary violations.

## Evidence from real execution

Driving a genuine admission through the released ingestion boundary with a synthetic
dependency-injection registry (not a mock of the pipeline — the pipeline itself runs):

    state: CANDIDATE | code: null | expected: CANDIDATE | respected: true
    authorityFree: true
    candidate state: CANDIDATE
    pansphairaHead: {"status":"RELEASED","commitOid":"6d7a7b43f2e16ff088afd409e601520cace23c4b"}
    coverage: {"relation":"OBSERVED","fields":"OBSERVED","periodWindow":"OBSERVED",
               "periodEvaluability":"OBSERVED","unknownChannel":"OBSERVED","releaseEvidence":"OBSERVED"}

`releaseEvidence` flips HELD -> OBSERVED only because a RELEASED entry actually matched the
profile digest — evidence, not assertion. Admission is still **not authority**: the candidate
carries `promote/mutate/execute/publish: false` and empty capabilities/effects.

## New negatives, each with its own distinct code

- `XRA_KS01_PROFILE_DIGEST_MISMATCH_DENIED` — a release-attested profile whose BYTES are
  substituted (one extra column) is denied rather than silently re-attested. This is a
  different fact from the HELD denial, and the registry-has-a-released-entry branch proves it.
- `XRA_KS01_PROVENANCE_FORGERY_DENIED` — provenance that **expires after load**: the profile
  keeps its attested edge while the registry entry reverts to HELD, so the withdrawn
  release can no longer admit anything.
- `LEDGER_KIND_DENIED:undefined` — a real **source substitution** between the two released
  layouts. Serving the v2 rows to the v1 kernel profile is rejected by the released mapping
  profile DIRECTLY (v2 carries `entry_kind`, not the `posting_type` the v1 profile requires),
  so the substitution never reaches the comparison. Stronger than a late divergence check.

## A HELD dependency is a complete run, not a partial one

    allStagesReconciled: true   dependencyClosed: false   psai.code: XRA_KS01_RELEASE_HELD

Both fields are reported so a reviewer can tell "the chain ran and every handoff behaved as
its provenance entitled" from "the dependency is closed". Only the latter requires real public
closure of XRA-PS-01; conflating them would misreport an honest open dependency as unfinished
technical work.

## Reuse, not duplication

The order forbids a duplicate order module. The null order-intake / open-order claims are
inherited from the released #238 comparison, whose own nonclaims already state that
`orderIntake` and `openOrder*` are unsupported (no intake-event or historical status/as-of
source) and that observed open sale rows describe in-window rows only, never a period-end
balance. PANSPHAIRA's real frozen sales-governance candidate (`src/cscl-10/sales-candidate.mjs`)
covers order lifecycle/events but is `NON_AUTHORITATIVE_CANDIDATE_FROZEN` and carries
`NO_HOLDOUT_SEMANTICS_CLAIM` — so an order-intake figure would be an unsupported historical
order-book claim. This package reuses those definitions and adds none.

## Verified

`node --test tests/net-revenue-connected-journey.test.mjs` — 19 tests, 19 pass.
`tests/source-map.test.mjs` + `tests/canonical-test-topology.test.mjs` — 150 pass.
