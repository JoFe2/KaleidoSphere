# KaleidoSphere 0.24.0 release notes

## Summary

This packet documents the skills-only KaleidoSphere Codex distribution at version
`0.24.0`. The release surface is the generated plugin manifest plus the
canonical `kaleidosphere` AgentSkill and its declared reference and validation
files.

## Evidence-bound changes

- Added a deterministic repository-generator check for the plugin manifest and
  canonical skill bytes.
- Added a fail-closed skills-only scan for prohibited package content,
  undeclared dependencies, executable payloads, symlinks, secrets, and license
  drift.
- Added an isolated Codex transcript contract covering install, discovery,
  declared-skill use, undeclared-skill denial, removal, and zero-residue
  readback.
- Added a reviewer matrix with six positive cases and three negative cases.

## Receipt binding

- Package version: `0.24.0`
- Package SHA-256 digest: `9482367f2c671665651ed1ec55f6aa852bacfc151a36f14eb9807afbf3c185f4`
- Plugin manifest SHA-256 digest: `beb78cef8fbedb1817fbf3fc61c96177a7e1a7e28b910838b7bf5070eb47fc75`
- Security receipt: `verification/k4c/security-license-receipt-v1.json`
- Isolated E2E receipt: `verification/k4c/codex-isolated-e2e-v1.json`
- Reviewer case matrix: `docs/release/k4c-reviewer-test-cases-v1.json`

The package digest is the deterministic digest recorded by both receipts. A
reviewer must inspect the digest before treating the package contents as the
release candidate under review.

## Reviewer boundary

The reviewer may validate, install, discover, use, inspect, remove, and read
back the package in an isolated boundary. Any failed assertion is a rejection;
there is no portal submission in this packet.

No portal form has been submitted. These notes do not claim marketplace
presence, approval, publication, runtime compatibility, production readiness,
deployment, or customer-data fitness.
