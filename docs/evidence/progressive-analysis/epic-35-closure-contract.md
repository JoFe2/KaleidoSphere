# Epic 35 closure evidence contract

Contract: `epic-35-closure/v1`. Scope: epic #35 (progressive-analysis) closure
evidence.

- Companion schema: `docs/evidence/progressive-analysis/epic-35-closure.schema.json`
- Focused validator and tests: `tests/epic-35-closure-schema.test.mjs`
- Focused verification: `node --test tests/epic-35-closure-schema.test.mjs`

## Scope and non-goals

- Defines the deterministic, fail-closed shape of the closure-evidence record
  that the controller consumes to decide whether epic #35 may be closed.
- Defines no product behavior and implements nothing. It does not implement,
  duplicate, accept, or terminalize child issue #40 work.
- The record is reference-only: identifiers, SHAs, CI run ids, release tags,
  repository-relative evidence paths, reason codes, and explicit nonclaim
  prose. It never embeds source row material, credentials, or query text.
- A completion claim supported only by issue body or comment prose is not
  admissible evidence; each child must carry structured delivery state.

## Record shape and canonical field ordering

Field order is canonical: the code-unit lexicographic order of field names,
applied recursively. The schema declares its `properties` in that same order
(the focused test asserts this for every object level), and the canonical
serialization sorts keys in that same order. Both sides therefore agree on
one ordering.

Top-level fields, in canonical order:

| order | field |
|---|---|
| 1 | `base_sha` |
| 2 | `child_40_foundation` |
| 3 | `children` |
| 4 | `contract_version` |
| 5 | `critical_path` |
| 6 | `epic_issue` |
| 7 | `head_sha` |
| 8 | `nonclaims` |
| 9 | `terminal_hash` |

`children[]` fields, in canonical order: `child_issue`, `ci_decision`,
`closed_rationale`, `depends_on`, `disposition`, `evidence_refs`, `merged_pr`,
`release_decision`.

`merged_pr` fields: `base_ref`, `head_sha`, `merge_sha`, `number`, `protected`.
`ci_decision` fields: `exact_head_conclusion`, `exact_head_run_id`,
`exact_main_conclusion`, `exact_main_run_id`.
`release_decision` fields: `decision`, `tag`, `tag_sha`.
`closed_rationale` fields: `evidence_refs`, `reason_code`.
`child_40_foundation` fields: `breadth_gate` (`evidence_refs`,
`gated_by_child`), `receipt_foundation` (`evidence_refs`,
`gated_by_children`).

Every object in the schema declares `additionalProperties: false`; an unknown
field at any depth is a shape rejection. The schema uses only the supported
keyword subset: `type`, `enum`, `const`, `required`, `properties`,
`additionalProperties` (false only), `items`, `minItems`, `maxItems`,
`uniqueItems`, `pattern`, `minimum`, `maximum`, `minLength`, `maxLength`. The
focused validator rejects any other validation keyword before evaluating any
record.

## Canonical serialization and terminal hash input

- `canonical(x)`: compact JSON serialization of `x` — object keys recursively
  sorted in code-unit lexicographic order, no whitespace, no key reordering.
- **Terminal hash input**: `canonical(record)` with the `terminal_hash` member
  removed.
- `terminal_hash`: the lowercase hex SHA-256 of the UTF-8 bytes of the
  terminal hash input.

The `terminal_hash` binds every other field: any change anywhere in the record
invalidates it. Because the hash input excludes `terminal_hash` itself, the
rule is decidable and self-referential-free.

## Dependency map

Critical path: `#36 -> #37 -> #38 -> #39 -> #40`.

| child | `depends_on` |
|---|---|
| 36 | (none) |
| 37 | 36 |
| 38 | 36, 37 |
| 39 | 36, 37, 38 |
| 40 | 36, 37, 38, 39 |

Rules:

- Parity depth work (#38) must not bypass the controller breadth gate (#36):
  #38 depends on #36, and a merged #38 with a non-merged #36 is rejected.
- Adaptive drilldown (#40) follows the evidence/receipt foundations (#36,
  #37): #40 depends on all of 36-39, and its breadth/receipt foundation fields
  are mandatory.
- A merged child requires every child in its `depends_on` set to be merged.

## Child #40 breadth/receipt foundation

`child_40_foundation.breadth_gate.gated_by_child` must be `36`, and
`child_40_foundation.receipt_foundation.gated_by_children` must be exactly
`[36, 37]` in canonical ascending order, each with at least one evidence ref.
#40 closure evidence must present the foundation; the controller's
authorization of issue #40 alone does not admit it.

## Deterministic rules (fail-closed)

Validation order is fixed; the first failure wins and carries a stable code:

1. **Shape** (`E-SHAPE`) — JSON Schema evaluation over the supported keyword
   subset, including the `additionalProperties: false` closure at every object
   and the content key probe (below). A record with the wrong child count is
   rejected here (`minItems`/`maxItems` = 5).
2. **Content value probes** (`E-CONTENT-CREDENTIAL`, `E-CONTENT-SQL`,
   `E-CONTENT-RAW`) — every string value is scanned: no credential-like
   `word:` / `word=` material, no free-form SQL statement text (statement
   keyword followed by an argument), no `RAW_VALUE:` marker.
3. **R01** (`E-R01`) — `children` is exactly the set `{36, 37, 38, 39, 40}`
   with one entry per issue: missing children, duplicate children, and
   out-of-set entries are all rejected.
4. **R02** (`E-R02`) — every `depends_on` set equals its row in the dependency
   map, and `critical_path` equals `[36, 37, 38, 39, 40]` in that order.
   Invalid dependency order (a bypassing edge or a reordered path) is
   rejected.
5. **R03** (`E-R03`) — a merged child requires every dependency to be merged.
   This is the parity-depth-bypasses-breadth-gate and adaptive-drilldown-
   without-foundation rejection.
6. **R04** (`E-R04`) — exactly one delivery state per child: `merged`
   requires a populated `merged_pr` and `closed_rationale: null`;
   `closed_no_delivery` requires a populated `closed_rationale` and
   `merged_pr: null`. A missing PR-or-rationale is rejected. `merged_pr`
   must have distinct `head_sha` and `merge_sha`, `base_ref: "main"`, and
   `protected: true`.
7. **R05** (`E-R05`) — a merged child requires a populated `ci_decision`
   (exact-head and exact-main pair, both conclusions `success`) and a
   populated `release_decision`; `released` requires non-null `tag` and
   `tag_sha`, `no_release` requires both null. A closed-no-delivery child
   requires both null. A missing CI/release decision is rejected.
8. **R06** (`E-R06`) — the #40 foundation gates hold:
   `gated_by_child` is `36` and `gated_by_children` is exactly `[36, 37]`.
9. **R07** (`E-R07`) — `terminal_hash` equals the SHA-256 of the canonical
   serialization of the record with `terminal_hash` removed.

Content key probe (inside the shape walk, `E-CONTENT-KEY`): any object key
matching a raw-value name (`raw`, `source_row`, `row_material`, `cell_value`,
`business_row`), a credential-like name (`password`, `passwd`, `secret`,
`token`, `api_key`, `access_key`, `credential`, `private_key`), or a free-SQL
name (`sql`) is rejected. Evidence refs additionally cannot contain colons, so
URLs and credential material cannot ride in as refs.

## Fail-closed negative categories

Every category below must reject a record that is otherwise canonical:

| category | rejection |
|---|---|
| missing child (fewer than five) | `E-SHAPE` (`minItems`) |
| duplicate child (more than five, or a repeated issue inside five) | `E-SHAPE` (`maxItems`) / `E-R01` |
| invalid dependency order (wrong edge or reordered critical path) | `E-R02` |
| parity depth bypass of the controller breadth gate | `E-R03` |
| missing PR-or-rationale | `E-R04` |
| missing CI or release decision | `E-R05` |
| missing #40 foundation (block absent, or wrong gates) | `E-SHAPE` (`required`) / `E-R06` |
| raw value field or `RAW_VALUE:` marker | `E-CONTENT-KEY` / `E-CONTENT-RAW` |
| credential-like field or value | `E-CONTENT-KEY` / `E-CONTENT-CREDENTIAL` |
| free-form SQL field or value | `E-CONTENT-KEY` / `E-CONTENT-SQL` |
| terminal hash mismatch | `E-R07` |
| unknown field at any depth | `E-SHAPE` (`additionalProperties`) |

## Fixture and nonclaims

The focused test carries the canonical five-child fixture. All PR numbers, CI
run ids, commit SHAs, and tag anchor SHAs in the fixture are concrete
placeholder values accepted only as fixture values; the fixture's explicit
`nonclaims` state that it claims no live merge, CI, or release state and does
not close epic #35 or any child. The critical path `36 -> 37 -> 38 -> 39 ->
40` and the #40 breadth/receipt foundation are represented in the fixture and
asserted by the tests.

## Slice receipt

- task_id: `CLOSURE-KS35-CURRENT-MAIN-REPLAY-01`
- base_commit_sha: `d6b9adb5be1e475cdba71c548a71fc900aa3fdff`
- origin_main_sha: `d6b9adb5be1e475cdba71c548a71fc900aa3fdff`
- evidence_terminal_hash: `7433474d0964db5baf015461486c4ebf6a0fb26f8fff6a530a40413d82426e1e`
- head_commit_sha: the unique commit in `origin/main..HEAD` whose diff names
  exactly the allowed paths; computed and printed by the focused test at
  verification (the slice commit's own tree SHA is not recordable in this
  file without self-reference, so the head binding is the evidence terminal
  hash above plus the verified slice commit).
- changed_paths: the canonical current-main replay paths and nothing else:
  `SOURCE-MAP.json`, `docs/evidence/conveyor/sol-ks-35-state-reconcile-01.json`,
  `docs/evidence/progressive-analysis/epic-35-close-comment.template.md`,
  `docs/evidence/progressive-analysis/epic-35-closure-contract.md`,
  `docs/evidence/progressive-analysis/epic-35-closure.schema.json`,
  `docs/evidence/progressive-analysis/epic-35-delivery-packet.template.json`,
  `fixtures/evidence/progressive-analysis/epic-35-closure-forged-receipt.json`,
  `fixtures/evidence/progressive-analysis/epic-35-closure-missing-foundation.json`,
  `fixtures/evidence/progressive-analysis/epic-35-closure-valid.json`,
  `fixtures/evidence/progressive-analysis/epic-35-exact-ci-mismatch.json`,
  `fixtures/evidence/progressive-analysis/epic-35-exact-ci-valid.json`,
  `fixtures/evidence/progressive-analysis/epic-35-no-release-valid.json`,
  `fixtures/evidence/progressive-analysis/epic-35-release-readback-valid.json`,
  `package.json`, `scripts/prepare-progressive-analysis-release-readback.mjs`,
  `scripts/verify-progressive-analysis-closure.mjs`,
  `scripts/verify-progressive-analysis-exact-ci.mjs`,
  `tests/epic-35-closure-fixture.test.mjs`,
  `tests/epic-35-closure-schema.test.mjs`,
  `tests/epic-35-delivery-packet.test.mjs`,
  `tests/prepare-progressive-analysis-release-readback.test.mjs`,
  `tests/verify-progressive-analysis-closure.test.mjs`,
  `tests/verify-progressive-analysis-exact-ci.test.mjs`.

Verification:

```sh
node --test tests/epic-35-closure-schema.test.mjs
git diff --check origin/main...HEAD
```
