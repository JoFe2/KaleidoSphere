# Source archive privacy boundary

Functional source/tooling archives retain the KS256 CLI, implementation, public synthetic
fixtures and affected tests. Ten inherited environment-bound files are deliberately excluded by
`.gitattributes` `export-ignore`:

- `WORK_RESULT.md`
- `closure-audits/PORTFOLIO-KS143-ROOT-QS/exact-head-local-gate-receipt.json`
- `docs/evidence/m6-03-bi-specialist/qwen-conformance-manifest.json`
- `scripts/run-qwen-conformance-evidence.mjs`
- `docs/evidence/conveyor/ks76-live-codex-local-readback-v1.json`
- `scripts/release/validate-k4c-codex-plugin.mjs`
- `scripts/run-native-superset-browser-evidence.mjs`
- `scripts/run-visual-browser-evidence.mjs`
- `tests/agent-skill-distribution.test.mjs`
- `tests/fixtures/release/k4c-plugin-creator-transcripts-v1.json`

Their repository bytes and recorded historical identities are unchanged. The exclusion is
not redaction or rewriting of an old receipt, and no historic execution is reclassified.
Those source files remain in Git as already published provenance; a new archive does not
re-export their environment-specific paths. No evidence is invented to replace them.

`SOURCE-MAP.json` remains the complete repository integrity index, including the identities
of the excluded files it already indexes. A release verifier must distinguish the ten
explicit archive exclusions from a missing required product file. Every included member
must match its tagged Git blob, and every included indexed file must match its digest.
The archive is not a substitute for the full Git history required by provenance tests.
Environment-specific browser, model-conformance and marketplace-validation replay harnesses
are not part of this bounded source/tooling archive. Use the full repository for those
historical replay paths. No claim is made that all repository tests run from this archive.

The existing `scripts/build-release.mjs` Git-checkout path honors export-ignore via
`git archive`. Delivery uses that path at the exact merged commit; no dirty or non-Git
fallback archive is accepted for this delivery. Before publication, inspect the actual
archive for the exclusions and required functional paths; after publication anonymously
read back the exact tag and both archive/checksum assets and compare their contents.

Evidence remains bounded: source/tooling is not an installable target, runtime activation,
marketplace approval, a real-source pilot or human comprehension evidence.
