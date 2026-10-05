# Saved O2C investigation profiles v1

This optional local CLI saves recipes around the existing invoice-date O2C entry. It does not replace the metric engine, introduce a dashboard platform, connect another source, or grant rights. The first family is limited to the existing bundled synthetic O2C fixtures and their documented mappings. It is not the second approved business context required by KS250.

## Run and replay

Use the declared Node.js 24 runtime on Linux. Store paths must be absolute, have no empty/dot/traversal/control-character components, and contain real directories rather than symlinks. Create a task-owned store; never repurpose another owner's directory.

```sh
STORE="$(node --input-type=module -e 'import {mkdtempSync} from "node:fs"; import {tmpdir} from "node:os"; import {join} from "node:path"; console.log(mkdtempSync(join(tmpdir(),"ks-o2c-profile-")))')"
node scripts/run-o2c-investigation-profile.mjs \
  --fixture COMMON-TRADE-01 --period-start 2026-06-01 --period-end 2026-08-01 \
  --profile-save monthly --store "$STORE"
node scripts/run-o2c-investigation-profile.mjs --profile-read monthly --store "$STORE"
```

`--profile-save` creates immutable v1. `--profile-read` reruns the existing cold CLI against the current executor-owned fixture grant and exact source bytes. It never returns a cached business result. The recipe binds fixture identity, source revision and SHA-256, inclusive/exclusive period, mapping, actual semantic definition labels and the implementation-definition fingerprint. Recipes contain no calculated rows, passwords or access tokens.

The default `--view all` JSON contains the existing table, SVG and CSV, each with the same complete `investigation.resultReference`. The SVG also carries that reference as an attribute/metadata and visibly labels profile/version, period, source revision, mapping, freshness and the missing usability observation. The CSV begins with a `# investigation` metadata line followed by the existing CSV header and data rows; consumers must skip the comment line. Supported saved-recipe views are `all`, `aggregate` and `drilldown`. Raw-only `chart`/`export` protocols are explicitly refused by this JSON entry; use the SVG/CSV fields in the default bundle. Existing one-off raw chart/export commands remain unchanged.

Freshness `FRESH_BOUND_EXECUTION` means a newly executed run matched the saved binding. It does not mean that a historical synthetic snapshot is current production business data. Hashes and saved recipes are integrity/context evidence, not authority. Fixture grants remain the authority for these bounded local operations; caller role strings and model output grant nothing.

## Explicit revisions and comparisons

Read mode accepts only profile identity, optional exact `--profile-version`, and store. Supplied period, fixture, mapping, view or expected-version overrides are rejected with `K08_PROFILE_READ_OPTIONS_DENIED`, even when they happen to match. Duplicate CLI options are rejected instead of silently choosing the last value.

```sh
node scripts/run-o2c-investigation-profile.mjs \
  --profile-revise monthly --expected-version 1 \
  --period-start 2026-07-01 --period-end 2026-08-01 --store "$STORE"
node scripts/run-o2c-investigation-profile.mjs \
  --profile-compare monthly --compare-with monthly \
  --left-version 1 --right-version 2 --store "$STORE"
```

A revision requires the exact active predecessor version. It creates a new exclusive version file linked to the predecessor digest, preserves the old bytes and atomically replaces the head pointer. Concurrent revisions cannot both publish the same successor. An explicit historical read/comparison verifies its chain back from the active head; version tokens with leading zeroes or outside that chain are refused. A valid unchanged replay retains its result reference. A new version has a distinct version-bound result reference, even when its business inputs are otherwise identical.

Comparison is deliberately metadata-only. It names changed `SOURCE`, `PERIOD`, `MAPPING` and `SEMANTIC_DEFINITION` dimensions, includes the actual saved semantic labels and implementation fingerprint, and attempts fresh bound observations. An invalidated side has a reason and no fresh result reference. `numericComparisonAllowed` is false and `numericDelta` is null: it does not directly subtract incompatible business numbers or introduce a new comparison metric. Equal-looking totals from the snake/camel fixture mappings are still separately identified source/mapping observations, not a second business context.

## Invalidation, rights and fallback

A changed source revision/digest or definition binding invalidates replay. Definition files are bounded regular-file reads with pinned no-follow directory descriptors; the exact raw-byte fingerprint is checked before and after real core execution. A before/after definition mismatch prevents profile activation. This detects the exercised definition drift, including actual child self-mutation; it is not an OS-level immutable execution sandbox and does not claim detection of a transient edit restored before the final check. The current fixture grant is checked again on every run: withdrawing an operation invalidates affected repetitions before any result is returned. A stored aggregate cannot acquire an unauthorized drilldown by read overrides or explicit revision. Denials include an invalidation reason, null views and `partialSuccess: false`.

Set the operator environment `KS_O2C_PROFILES_DISABLED=1` to disable this optional storage/replay/comparison entry. The existing `scripts/run-invoice-date-o2c.mjs` one-off route remains available. This is a per-process operator setting, not a new source permission or global configuration change.

Local stores use private directory/file modes and descriptor-pinned bounded regular-file reads; symlinks, FIFOs and oversized metadata are refused. Supported mutations never overwrite a version. Failed candidates do not replace the qualified head. There is no crash/power-loss durability or automatic repair claim; an interrupted local write can leave unactivated metadata that an owner must inspect without deleting foreign resources.

## Missing human evidence

`humanUsability: NOT_OBSERVED` and `humanUsabilityTechnicalHold: false` explicitly report the missing human-usability observation. Native technical tests and a desktop inspection of an actual CLI-produced SVG are not a human investigation study, full-app/browser qualification, mobile acceptance or evidence of reduced human effort. No such study is introduced as a technical delivery hold.

## Executable checks and evidence boundaries

```sh
node --test tests/o2c-investigation-profile-product.test.mjs tests/o2c-investigation-profile-ci-binding.test.mjs
npm test
```

The actual cold-CLI suite covers unchanged replay, a new source snapshot, explicit period revisions, source/mapping/semantic comparisons, bound SVG/CSV bytes, operation withdrawal, unsupported drilldown, immutable generations, concurrent revision, special files, literal paths, duplicate/read-option denials, definition changes during execution and the operator-disabled fallback. The source-binding suite keeps both suites reachable exactly once through the existing canonical parent without modifying the frozen package command or the existing O2C implementation. The common fixture independently yields June EUR 800 and July EUR 100; the changed private synthetic snapshot is checked against an independently computed document oracle.

Evidence scopes remain separate: development execution/review, limited desktop SVG inspection, a frozen tested commit/tree, required hosted CI, merge identity, public release assets and anonymous downloaded-product verification. Development success or an archive alone is not release/whole-issue acceptance. No external vendor, real target, new data authority, or human-usability acceptance is inferred.
