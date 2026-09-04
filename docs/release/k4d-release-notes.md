# KaleidoSphere 0.26.0 release notes

## Summary

This packet documents the skills-only KaleidoSphere Claude Code distribution at
version `0.26.0`. The release surface is the generated plugin manifest plus the
canonical `kaleidosphere` AgentSkill and its declared reference and validation
files.

## Evidence-bound changes

- Added a deterministic repository-generator check for the plugin manifest and
  canonical skill bytes.
- Added a fail-closed skills-only scan for prohibited package content,
  undeclared dependencies, executable payloads, symlinks, secrets, and license
  drift.
- Added an isolated Claude Code transcript contract covering install,
  discovery, declared-skill use, undeclared-skill denial, removal, and
  zero-residue readback.
- Added a reviewer matrix with six positive cases and three negative cases.

## Receipt binding

- Package version: `0.26.0`
- Package SHA-256 digest: `a9dfd0e40633c13ab7b04f15bdbfd8d5fa579453717272a9542a87567b13a255`
- Plugin manifest SHA-256 digest: `b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d`
- Manifest validation receipt: `generated/claude/receipts/manifest-validation-receipt-v1.json`
- Security receipt: `generated/claude/receipts/skills-only-security-license-receipt-v1.json`
- Isolated E2E receipt: `generated/claude/receipts/claude-isolated-e2e-v1.json`
- Reviewer case matrix: `tests/fixtures/release/k4d-reviewer-test-cases-v1.json`

The package digest is the deterministic digest recorded by all receipts. A
reviewer must inspect the digest before treating the package contents as the
release candidate under review.

## Reviewer boundary

The reviewer may validate, install, discover, use, inspect, remove, and read
back the package in an isolated boundary. Any failed assertion is a rejection;
there is no marketplace submission in this packet.

No marketplace submission has been performed. These notes do not claim
marketplace presence, approval, publication, runtime compatibility, production
readiness, deployment, or customer-data fitness.