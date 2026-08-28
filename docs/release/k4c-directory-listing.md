# KaleidoSphere Codex directory listing

## Claims

- Claim: KaleidoSphere is distributed as a skills-only Codex plugin.
- Claim: The package version is `0.24.0`.
- Claim: The package declares the `kaleidosphere` skill at `skills/kaleidosphere/SKILL.md`.
- Claim: The skill accepts only `status`, `discovery`, `analyze`, `plan`, `preview`, and `readback` actions.
- Claim: When no trusted KaleidoSphere transport is configured, the skill returns `WAITING_EXTERNAL` after local validation.
- Claim: The package SHA-256 digest is `9482367f2c671665651ed1ec55f6aa852bacfc151a36f14eb9807afbf3c185f4`.
- Claim: The plugin manifest SHA-256 digest is `beb78cef8fbedb1817fbf3fc61c96177a7e1a7e28b910838b7bf5070eb47fc75`.

## Description

KaleidoSphere is a bounded business-intelligence AgentSkill for status, discovery,
analyze, plan, preview, and readback requests under a closed, authority-free
contract. It validates requests locally, preserves evidence boundaries, and
stops when the host has not supplied a trusted transport.

The package contains the plugin manifest and the declared KaleidoSphere skill
files only. It does not add commands, apps, hooks, MCP configuration, or package
dependencies.

## Evidence binding

- Package: `packages/codex/kaleidosphere`
- Version: `0.24.0`
- License: `Apache-2.0`
- Package digest: `9482367f2c671665651ed1ec55f6aa852bacfc151a36f14eb9807afbf3c185f4`
- Manifest digest: `beb78cef8fbedb1817fbf3fc61c96177a7e1a7e28b910838b7bf5070eb47fc75`
- Receipt: `verification/k4c/security-license-receipt-v1.json`
- Receipt: `verification/k4c/codex-isolated-e2e-v1.json`

## Claim boundary

This copy describes repository evidence only. No portal form has been submitted
and no marketplace presence, approval, publication, runtime compatibility,
production readiness, deployment, or customer-data fitness is claimed.
