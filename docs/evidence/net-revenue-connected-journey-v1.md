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
