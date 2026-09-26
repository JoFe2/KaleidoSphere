# KS256 (KS-OPS-04) — read-only project lifecycle and transfer status

Local-synthetic, read-only status projection; no real-source or production qualification.

## What this slice delivers

`Result / DoD`: "Expose bounded read-only status, coverage and deviations using existing
verified result/receipt surfaces."

| Piece | Path |
|---|---|
| Read-only status module | `services/bi-control/src/business-bi/project-lifecycle-transfer-status-v1.mjs` |
| Runnable CLI entry point | `scripts/run-project-lifecycle-transfer-status.mjs` |
| Authored declaration (identity, owned scope, denominator) | `tests/fixtures/business-bi/ks256-lifecycle-transfer-status/project-declaration-v1.json` |
| Authored observed scope, evidence revision v1 | `tests/fixtures/business-bi/ks256-lifecycle-transfer-status/observed-scope-v1.json` |
| Authored observed scope, evidence revision v2 (the source change) | `tests/fixtures/business-bi/ks256-lifecycle-transfer-status/observed-scope-v2.json` |
| Authored transfer declaration (source archive + target) | `tests/fixtures/business-bi/ks256-lifecycle-transfer-status/transfer-v1.json` |
| Authored quarantine inventory | `tests/fixtures/business-bi/ks256-lifecycle-transfer-status/quarantine-v1.json` |
| Authored lifecycle observation (running / partial) | `tests/fixtures/business-bi/ks256-lifecycle-transfer-status/lifecycle-observation-v1.json`, `lifecycle-observation-partial-v1.json` |
| Focused suite | `tests/project-lifecycle-transfer-status.test.mjs` |
| Integrity migration (additive) | `scripts/update-ks256-lifecycle-transfer-status-source-map.mjs` |

Reused, never rebuilt: the released `composeReleasedNetRevenueComparison` /
`attestReleasedNetRevenueComparison` read path and its private execution provenance, the
released `canonicalJson` canonicalisation, and the released synthetic segment fixture
`tests/fixtures/business-bi/net-revenue-segment-v1.json` (unchanged) as both the declared
SOURCE_ARCHIVE bytes and the separately retained comparison rows. No second metric, engine,
dashboard, catalog or status framework was introduced.

## Producer dependencies

The PAN461/PAN471 producer contracts are not imported or qualified by this synthetic projection.
Borrowed as VOCABULARY and as an authority model, never as a copied implementation: the
lifecycle states and the closed decision table, the generation MATCHED / DRIFTED / UNAVAILABLE
axis, SOURCE_ARCHIVE-is-never-an-installable-target, the secret-VALUE refusal with a reference
marker, the content-bound rebind after serialization, and the availability vocabulary that
keeps DENIED / PARTIAL / UNKNOWN / observed absence distinct. Imports outside this slice remain
dependencies and were not invented here.

## Executed evidence

```
node scripts/run-project-lifecycle-transfer-status.mjs
    exit 0 — EOF: mode=eof status=null executed=false mutationCount=0 authority=READ_ONLY,
             STATUS-DENIED PROJECT_STATUS_INPUT_REQUIRED missing=<seven required inputs>
node scripts/run-project-lifecycle-transfer-status.mjs --declaration <f> --observed-scope <v1> \
     --transfer <f> --quarantine <f> --lifecycle <f> --retained-rows <released segment fixture> \
     --evidence-revision ks256-status-observation-v1 --format TABLE
    exit 0 — PROJECTED; lifecycle RUNNING; denominator 13; observedCompletedCount null;
             fraction null with NON_AVAILABLE_SCOPE_ITEMS:... named; coverage states
             AVAILABLE / DENIED / OBSERVED_ABSENT / PARTIAL; readback AVAILABLE (OK,
             IN_PROCESS_RELEASED_COMPOSITION); authority READ_ONLY / NOT_GRANTED /
             mutationCount 0; sourceArchiveObservedSha256 == sourceArchiveOnDiskSha256
same invocation with --observed-scope <v2> --evidence-revision ks256-status-observation-v2
    exit 0 — PROJECTED; observedCompletedCount 9 of 13; fraction 0.6923076923076923;
             coverage AVAILABLE / PARTIAL; bindingDigest differs from the v1 board
same invocation with --lifecycle lifecycle-observation-partial-v1.json
    exit 0 — PROJECTED; lifecycle PARTIALLY_INSTALLED (no version inferred)
--request-action MIGRATE
    exit 0 — STATUS-DENIED PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED requestedAction=MIGRATE
             executed=false mutationCount=0
--rebind --carried-binding <carried status>
    exit 0 — rebind=REBOUND code=OK at the exact carried bindingDigest
--negative
    exit 0 — 30 gates, each printing its exact intended rejection code; 0 unexpected
node --test tests/project-lifecycle-transfer-status.test.mjs
    exit 0 — 27 tests / 27 pass / 0 fail
```

All seven caller inputs (`--declaration`, `--observed-scope`, `--transfer`, `--quarantine`,
`--lifecycle`, `--retained-rows`, `--evidence-revision`) are REQUIRED and have no default and no
fixture fallback: a missing one is refused before any file is opened. A caller that wants a
fixture must name it.

### Negative gates as executed (`--negative`, 30 gates)

`eof-input-required`, `missing-evidence-revision` = `PROJECT_STATUS_INPUT_REQUIRED`;
`declaration-malformed` = `PROJECT_STATUS_DECLARATION_MALFORMED`;
`observed-scope-malformed-state`, `fabricated-count-on-denied` =
`PROJECT_STATUS_OBSERVED_SCOPE_MALFORMED`; `observed-scope-digest-mismatch` =
`PROJECT_STATUS_OBSERVED_SCOPE_DIGEST_MISMATCH`; `stale-evidence-revision` =
`PROJECT_STATUS_EVIDENCE_REVISION_STALE`; `transfer-malformed` =
`PROJECT_STATUS_TRANSFER_MALFORMED`; `source-archive-unreadable` =
`PROJECT_STATUS_SOURCE_ARCHIVE_UNREADABLE`; `source-archive-bytes-mismatch` =
`PROJECT_STATUS_SOURCE_ARCHIVE_BYTES_MISMATCH`; `source-archive-role-invalid` =
`PROJECT_STATUS_SOURCE_ARCHIVE_ROLE_INVALID`; `quarantine-malformed` =
`PROJECT_STATUS_QUARANTINE_MALFORMED`; `secret-value-included` =
`PROJECT_STATUS_SECRET_VALUE_INCLUDED`; `raw-person-payload-included` =
`PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED`; `write-authority-update|restore|migrate|
approve_transfer|execute` = `PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED`;
`unknown-authority-action` = `PROJECT_STATUS_UNKNOWN_AUTHORITY_ACTION`;
`released-readback-not-an-array` = `PROJECT_STATUS_RELEASED_READBACK_INPUT_REQUIRED`;
`released-readback-malformed-rows` = `NET_REVENUE_COMPOSITION_REFUSED` (the released module's
own code, preserved); `rebind-substituted-retained-rows`,
`rebind-substituted-evidence-revision` = `PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH`;
`rebind-stale-evidence-revision` = `PROJECT_STATUS_EVIDENCE_REVISION_STALE`;
`rebind-resealed-observed-scope` = `PROJECT_STATUS_OBSERVED_SCOPE_DIGEST_MISMATCH`;
`rebind-carried-binding-malformed` = `PROJECT_STATUS_SERIALIZED_BINDING_MALFORMED`;
`rebind-carried-status-binding-swapped` = `PROJECT_STATUS_SERIALIZED_EVIDENCE_MISMATCH`;
`projection-failed-throwing-input` = `PROJECT_STATUS_PROJECTION_FAILED`;
`rendered-format-unsupported` = `PROJECT_STATUS_FORMAT_UNSUPPORTED`.

## Acceptance mapping

| Criterion | Observed evidence |
|---|---|
| `KS-OPS-04-AC01` source/target identity, owned scope, denominator, progress, unknown outcomes, quarantine and next responsible role, without secret or raw-person payloads | the projection emits `projectIdentity` (id, label, owned scope, evidence revision), `transfer.sourceArchive`/`transfer.target`, `progress` (denominator derived from the declaration, unit verbatim), `scopeCoverage`, `unknownOutcomes` and `quarantine` each with a `nextResponsibleRole`, and `authority`; `secretValuesExported=false`, `rawPersonPayloadsIncluded=false`; injected secret VALUES and raw-person fields are refused by name before any file is opened |
| `KS-OPS-04-AC02` UNKNOWN, DENIED, PARTIAL and observed absence survive a source change; stale or substituted evidence cannot appear current | all four states present on the v1 board; the v2 board re-projects from its own observation with a different binding digest; a stale revision is refused (`EVIDENCE_REVISION_STALE`); a resealed body is refused (`OBSERVED_SCOPE_DIGEST_MISMATCH`); a substituted revision and a ONE-CENT retained-row mutation fail to re-derive the carried binding (`SERIALIZED_BINDING_MISMATCH`); a resealed serialized status is refused (`SERIALIZED_EVIDENCE_MISMATCH`) |
| `KS-OPS-04-AC03` a verified display neither approves nor executes update, restore or migration; ordinary positive projection and denied authority escalation proved | the positive projection grants `displayAuthority=READ_ONLY`, `writeAuthority=NOT_GRANTED`, `approvedActions=[]`, `executes*=false` and `mutationCount=0`, and the suite proves the referenced input bytes are unchanged across the projection; every mutating action is refused by name before anything is read; the verified readback facet is an ACTUAL released execution whose forged label-only form is refused by the released checker |

### RED/GREEN

Five disposable variants, each written to a dot-prefixed scratch path inside the module's
directory, DRIVEN to show the boundary RED on the variant, then removed in a `finally` (asserted
absent afterwards). The candidate is driven on the same input and is GREEN:

1. `no-count-guard` — a re-sealed observed scope in which a `DENIED` item carries a fabricated
   count is ACCEPTED by the variant and refused by the candidate.
2. `no-stale-guard` — a stale evidence revision appears current on the variant and is refused
   by the candidate.
3. `no-escalation-guard` — a `MIGRATE` request is accepted by the variant and refused by the
   candidate.
4. `no-payload-gate` — an injected raw-person payload is not named by the variant and is named
   by the candidate.
5. a CLI variant that IMPLICITLY defaults `--evidence-revision` is driven through the real
   entry point: the variant no longer reports the missing input, while the candidate refuses it.

## Boundary disclosures (never hidden)

- The lifecycle / transfer / quarantine inputs are **authored, bound, LOCAL-SYNTHETIC
  declarations**, not a product execution and not a real host probe. The module states this on
  every output (`executionFacets.authoredAndBound` + `disclosure`).
- The ONLY facet actually EXECUTED is the released comparison attestation
  (`executionFacets.executed`), and the board's verified number exists only because that
  released execution attests. A helper-only or authored-fixture facet must not be read as an
  executed observation.
- The declared SOURCE_ARCHIVE bytes ARE read from the named file by the module itself and by
  the suite independently; the caller's declared digest is never trusted.
- `@electric-sql/pglite` was not used by this slice; no database, socket, SQL or network call is
  made.
- Phases: **UNKNOWN** — not instrumented; no interval is inferred from elapsed commit time.

## Remaining (NOT closed here)

- Independent focused acceptance of this composition, ordered current-Main integration,
  exact-head CI, merge, a correctly classified functional release and public artifact readback:
  **delivery-owner owned**, not claimed here.
- The display grants no write authority and has no approval surface: no update, restore,
  migration or transfer is approved or executed by this slice.
- PAN461/PAN471 remain retained local candidates, not public releases; no cross-repository
  acceptance is implied.

## Non-claims

No production, customer, private-source, credential or raw person payload; no real host probe, runtime activation, model/provider change
; no second dashboard engine, metric semantic, catalog or general-purpose status
framework; no measured performance claim; no human-comprehension or broad-maturity claim.
