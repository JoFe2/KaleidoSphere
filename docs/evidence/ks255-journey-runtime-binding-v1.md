# KS255 (KS-OPS-03) — current test-root reachability and the minimal runtime dependency closure

Local, isolated synthetic qualification only. No publication, no host/runtime/provider
change, no external business effect, no production or customer data.

## Result / Definition of Done

Current tests and the minimal runtime dependencies are reproducible from a **pinned binding**
without rewriting any frozen proof binding:

- the canonical `npm test` root is **unchanged** (no `package.json` byte moved);
- the runtime dependency **closure is measured** from the tracked suites, not hand-listed;
- the required SQL engine is provisioned from a **real lockfile with sha512 integrity** and a
  **pinned artifact manifest** covering every installed byte;
- a **missing / empty / drifted** binding is **rejected with an exact code**;
- an absent runtime is reported as **UNRESOLVED / SKIP**, never as PASS.

## Pieces

| Piece | Path |
|---|---|
| Declared dependency binding | `dependencies/ks-journey-runtime/package.json` |
| Real lockfile binding (resolved + sha512 integrity) | `dependencies/ks-journey-runtime/package-lock.json` |
| Pinned artifact manifest (entry + full installed closure) | `contracts/dependencies/ks255-journey-runtime-v1.json` |
| Provisioner / measurement entry point | `scripts/provision-ks255-journey-runtime.mjs` |
| Focused suite | `tests/ks255-journey-runtime-binding.test.mjs` |
| Router of the absent-runtime skip path | `scripts/run-connected-net-revenue-journey.mjs` (reused, unmodified) |
| Integrity migration (initial slice) | `scripts/update-ks255-journey-runtime-source-map.mjs` |
| Integrity migration (correction) | `scripts/update-ks255-correction-source-map.mjs` |

Reused, never rebuilt: the canonical topology kernel
(`scripts/check-canonical-test-topology.mjs`), the content-addressed source map, the released
`buildPgliteJourneyDatabase` seam, and the released connected-journey CLI.

## Pinned artifact identity

| Field | Value |
|---|---|
| dependency | `@electric-sql/pglite` |
| version | `0.3.14` (the version the released connected-journey evidence and the CI workflow already pin) |
| npm integrity | `sha512-3DB258dhqdsArOI1fIt7cb9RpUOgcDg5hXWVgVHAeqVQ/qxtFy605QKs4gx6mFq3jWsSPqDN8TgSEsqC3OfV9Q==` |
| entry module | `node_modules/@electric-sql/pglite/dist/index.js` |
| entry sha256 | `03bce0708dbe57ab154c75089ded04c47d0a9e713fe397dee33cd3912101cab5` |
| closure | 323 files |
| closure sha256 | `80a32ce7addd234016e83709518033c789d019eb6af32abc010caeb24b3b331a` |

The closure digest is the sha256 over the codepoint-sorted `path\tsha256` lines of the
installed `node_modules/@electric-sql/pglite` tree; it was verified to reproduce identically
across two independent `npm ci` installs.

## Declared runtime roots (measured, not assumed)

The measurement derives the required suites from the git-tracked `tests/**/*.test.mjs` sources
themselves. Six released suites declare the injected engine:

```
tests/net-revenue-connected-journey.test.mjs
tests/net-revenue-f4-composition.test.mjs
tests/net-revenue-guided-journey.test.mjs
tests/net-revenue-journey.test.mjs
tests/net-revenue-ledger-mapping.test.mjs
tests/result-lineage-readonly.test.mjs
```

They resolve two declared roots for the same pinned closure: the repository-owned
`.ks-journey-runtime` and the declared `/workspace/.ks-journey-runtime` fallback. The
provisioner refuses to guess: an unresolved required suite is `REQUIRED_SUITE_UNRESOLVED`.

The measurement models each suite's OWN ordered candidate list. Four of the six consult the
injected override `process.env.PGLITE_CORE_PATH` first (their executable resolver reads it);
`tests/net-revenue-journey.test.mjs` and `tests/net-revenue-ledger-mapping.test.mjs` read only a
hardcoded declared root and therefore stay honestly `UNRESOLVED` whenever that literal root is
not mounted. Readability and verified closure are reported as **distinct** facts: `RESOLVED`
means the suite would load the byte, `VERIFIED` additionally requires the pinned entry digest
**and** the pinned installed closure. A readable file that is not the pinned artifact is reported
`RESOLVED/UNVERIFIED` and is never credited as the pinned runtime.

## Before / after setup work (recorded on the affected entry point)

```
# BEFORE — no runtime root mounted (a fresh runtime-less checkout)
node --test tests/net-revenue-connected-journey.test.mjs \
          tests/net-revenue-guided-journey.test.mjs \
          tests/result-lineage-readonly.test.mjs \
          tests/net-revenue-f4-composition.test.mjs \
          tests/net-revenue-ledger-mapping.test.mjs \
          tests/net-revenue-journey.test.mjs
  exit 0 — 108 tests, 92 pass, 0 fail, 16 SKIPPED (all "runtime unavailable")

# SETUP — install the pinned closure into the declared roots
node scripts/provision-ks255-journey-runtime.mjs --install
  PROVISIONED root=.ks-journey-runtime            entry=03bce0708dbe closure=80a32ce7addd files=323
  PROVISIONED root=/workspace/.ks-journey-runtime entry=03bce0708dbe closure=80a32ce7addd files=323

# AFTER — the same six suites, same test root, same registrations
node --test <same six suites>
  exit 0 — 108 tests, 108 pass, 0 fail, 0 SKIPPED
```

Preserved suite reachability (canonical `npm test`): topology kernel
`violations=0`, every tracked suite exactly one route, and no runtime-requiring suite
promoted to a second direct root. The canonical command bytes are unchanged.

## Targeted correction (KS255 residual)

Three independently verified residuals were corrected through the real entry points.

1. **Measurement ignored the environment-selected override.** With the verified installed runtime
   outside both literal roots and `PGLITE_CORE_PATH` pointed at its entry, the six released suites
   really execute (`108 tests, 106 pass, 2 SKIP`) while the measurement reported **all six**
   unresolved. Measurement now resolves each suite's own ordered candidate list:

   ```
   PGLITE_CORE_PATH=<external-root>/node_modules/@electric-sql/pglite/dist/index.js      node scripts/provision-ks255-journey-runtime.mjs --measure --json
     -> 4 suites RESOLVED/VERIFIED via the override; 2 suites UNRESOLVED (hardcoded literal root)
   node scripts/provision-ks255-journey-runtime.mjs --measure --require-resolved
     -> PROVISION-DENIED REQUIRED_SUITE_UNRESOLVED: tests/net-revenue-journey.test.mjs,tests/net-revenue-ledger-mapping.test.mjs
   ```

   The two suites that read only a hardcoded declared root keep their **precise honest failure**;
   the RED/GREEN distinction is between a suite that *actually reads* the override and one that
   only *declares* it (or mentions it in a comment).

2. **Current CI now consumes the committed locked provisioning and executes every required SQL
   suite.** The workflow provisions from the committed lockfile + pinned manifest, verifies the
   installed closure byte-for-byte, refuses an unresolved/unverified required suite, and then
   executes `net-revenue-journey` and `net-revenue-ledger-mapping` (which read only the declared
   `/workspace/.ks-journey-runtime` fallback) together with the other four required suites.
   `KS255_PINNED_SPECIFIER` states the specifier the workflow provisions, and the provisioner
   refuses a declaration that disagrees with the pin.

3. **Focused-test portability and readable-but-unpinned runtimes.** The default verifier demanded
   every DECLARED root, so an explicitly installed repository runtime failed on the absent
   `/workspace` fallback (`10 pass / 1 fail`). Verification is now qualified to the roots an
   invocation actually intends, while an intended root that is genuinely absent is still refused
   explicitly (`RUNTIME_ROOT_MISSING`). `RESOLVED` (readable) and `VERIFIED` (pinned entry digest
   **and** pinned closure) are distinct: a readable nonsense `index.js` is reported
   `RESOLVED/UNVERIFIED` and `--require-verified` refuses it (`REQUIRED_SUITE_UNVERIFIED`).

## Every criterion mapped to its observed evidence

| Criterion | Evidence |
|---|---|
| KS-OPS-03-AC01 | `this suite is canonically reachable through exactly one imported-parent route…`; `the current test root reaches every tracked suite exactly once`; `immutable historical evidence retains its exact source identity` — the CURRENT CI workflow bytes are bound at `80f81758…` (their current-workflow binding is asserted in `tests/postgresql-c2-safe-aggregate.test.mjs`), the recorded HISTORICAL C2-correction original stays at its immutable `92cb8d81…` digest, every `SOURCE-MAP.json` entry re-hashes to its recorded identity, and the recovered live-matrix originals plus the frozen C1 certificate digest stay exact. |
| KS-OPS-03-AC02 | `the runtime dependency closure is MEASURED from the current test root, not hand-listed`; `measurement credits the environment-selected override only to the suites that ACTUALLY read it, never a declaration`; `a required suite that only reads a hardcoded declared root stays honestly UNRESOLVED when that root is not mounted`; `the resolved pinned artifact is a REAL PostgreSQL engine and the released SQL path runs on it`; `the installed artifact closure is verified byte-for-byte against the pin, for the roots this invocation intends`; `declared-but-unused setup is reported rather than silently removed`. |
| KS-OPS-03-AC03 | `the committed binding lockfile is REAL…`; `a missing or empty runtime binding declaration is REJECTED with an exact code` (`BINDING_MISSING`, `LOCKFILE_EMPTY`, `BINDING_EMPTY`, `LOCKFILE_ENTRY_INTEGRITY_MISSING`); `a binding that drifts from the pin is rejected` (`LOCKFILE_DISAGREES_WITH_MANIFEST`, `WORKFLOW_PIN_DISAGREES_WITH_MANIFEST`); `an unresolvable runtime root is denied` (`RUNTIME_ROOT_MISSING`); the before/after record above distinguishes runtime-unavailable (SKIP) from PASS. |

## Exact rejection codes (fail-closed)

`BINDING_MISSING`, `BINDING_EMPTY`, `LOCKFILE_EMPTY`, `LOCKFILE_ENTRY_MISSING`,
`LOCKFILE_ENTRY_INTEGRITY_MISSING`, `LOCKFILE_ENTRY_RESOLVED_MISSING`,
`LOCKFILE_DISAGREES_WITH_MANIFEST`, `MANIFEST_MISSING`, `WORKFLOW_PIN_MISSING`,
`WORKFLOW_PIN_DISAGREES_WITH_MANIFEST`, `RUNTIME_ROOT_MISSING`, `INSTALLED_ENTRY_MISSING`,
`INSTALLED_ENTRY_DIGEST_MISMATCH`, `INSTALLED_CLOSURE_FILE_COUNT_MISMATCH`,
`INSTALLED_FILE_MISSING`, `INSTALLED_FILE_UNEXPECTED`, `INSTALLED_FILE_DIGEST_MISMATCH`,
`INSTALLED_CLOSURE_DIGEST_MISMATCH`, `REQUIRED_SUITE_UNRESOLVED`, `REQUIRED_SUITE_UNVERIFIED`.

## Boundary disclosures

- `@electric-sql/pglite` is an **in-process synthetic PostgreSQL engine** used only to exercise
  the released SQL adapters locally. It is **not** the released Superset/PostgreSQL deployment
  and is not production or external-environment evidence. Real-environment evidence stays
  separately held exactly as the frozen C1 certificate records it (`BLOCKED_EXTERNAL`).
- The HISTORICAL CI workflow bytes delivered at the recorded C2 correction endpoint are frozen
  at `92cb8d81…` by `tests/postgresql-c2-safe-aggregate.test.mjs` and are never re-minted. The
  authorized correction re-points **current** CI at the committed pinned provisioner and moves
  **only** the current-workflow hash binding (`80f81758…`), which the same test asserts. Nothing
  historical was rewritten.
- The provisioner installs into the repository-owned `.ks-journey-runtime` (git-ignored,
  never committed) and into the suites' declared `/workspace/.ks-journey-runtime` fallback.
  Both are container-local installed-artifact roots; no repository byte depends on them.
- The required-suite derivation is a **conservative declaration scan** of each tracked
  suite's own candidate literals: a suite that merely *mentions* the specifier is counted as
  requiring the runtime (over-counting is safe and self-announcing; it can never under-count a
  suite that really injects the engine). The proof that the pinned artifact really executes the
  SQL path is the **actual engine run and the released CLI run**, not the scan. This slice's own
  suite builds its specifier dynamically precisely so it is not counted.
- Focused boundary probes use disposable synthetic suite sources and disposable binding
  directories under the system temp dir. Those probes are measurement-boundary checks, not
  evidence that the released suites themselves were re-run in a runtime-less environment; the
  runtime-less behaviour of the released suites is the recorded before/after above.

## Non-claims

No rewrite of historical manifests, evidence or frozen proof bindings; no `package.json`
change; no re-minting of the historical CI workflow original; no unpinned or empty lockfile; no fabricated test coverage; no
unmeasured performance claim; no production, publication, push, PR, merge, release or issue
mutation; no private source, credential, real customer data or other-checkout modification; no
host install/runtime/provider change, no extra worker, no model/provider change; native
`goal500` unchanged.
