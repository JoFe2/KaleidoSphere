# Source archive privacy boundary

Functional source/tooling archives retain the KS256 CLI, implementation, public synthetic
fixtures and tests. Four inherited environment-bound files are deliberately excluded by
`.gitattributes` `export-ignore`:

- `WORK_RESULT.md`
- `closure-audits/PORTFOLIO-KS143-ROOT-QS/exact-head-local-gate-receipt.json`
- `docs/evidence/m6-03-bi-specialist/qwen-conformance-manifest.json`
- `scripts/run-qwen-conformance-evidence.mjs`

Their repository bytes and recorded historical identities are unchanged. The exclusion is
not redaction or rewriting of an old receipt, and no historic execution is reclassified.
Those source files remain in Git as already published provenance; a new archive does not
re-export their environment-specific paths. No evidence is invented to replace them.

`SOURCE-MAP.json` remains the complete repository integrity index, including the identities
of the two excluded files it already indexes. A release verifier must distinguish the four
explicit archive exclusions from a missing required product file. Every included member
must match its tagged Git blob, and every included indexed file must match its digest.
The archive is not a substitute for the full Git history required by provenance tests.

The existing `scripts/build-release.mjs` Git-checkout path honors export-ignore via
`git archive`. Delivery uses that path at the exact merged commit; no dirty or non-Git
fallback archive is accepted for this delivery. Before publication, inspect the actual
archive for the exclusions and required functional paths; after publication anonymously
read back the exact tag and both archive/checksum assets and compare their contents.

Evidence remains bounded: source/tooling is not an installable target, runtime activation,
marketplace approval, a real-source pilot or human comprehension evidence.
