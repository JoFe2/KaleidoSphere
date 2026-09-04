# KaleidoSphere Claude Code directory listing

## Claims

- Claim: KaleidoSphere is distributed as a skills-only Claude Code plugin.
- Claim: The package version is `0.26.0`.
- Claim: The package declares the `kaleidosphere` skill at `skills/kaleidosphere/SKILL.md`.
- Claim: The skill accepts only `status`, `discovery`, `analyze`, `plan`, `preview`, and `readback` actions.
- Claim: When no trusted KaleidoSphere transport is configured, the skill returns `WAITING_EXTERNAL` after local validation.
- Claim: The package SHA-256 digest is `a9dfd0e40633c13ab7b04f15bdbfd8d5fa579453717272a9542a87567b13a255`.
- Claim: The plugin manifest SHA-256 digest is `b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d`.

## Description

KaleidoSphere is a bounded business-intelligence AgentSkill for status, discovery,
analyze, plan, preview, and readback requests under a closed, authority-free
contract. It validates requests locally, preserves evidence boundaries, and
stops when the host has not supplied a trusted transport.

The package contains the plugin manifest and the declared KaleidoSphere skill
files only. It does not add agents, hooks, MCP configuration, LSP servers,
monitors, settings, or package dependencies.

## Evidence binding

- Package: `generated/claude/kaleidosphere`
- Version: `0.26.0`
- License: `Apache-2.0`
- Package digest: `a9dfd0e40633c13ab7b04f15bdbfd8d5fa579453717272a9542a87567b13a255`
- Manifest digest: `b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d`
- Receipt: `generated/claude/receipts/manifest-validation-receipt-v1.json`
- Receipt: `generated/claude/receipts/skills-only-security-license-receipt-v1.json`
- Receipt: `generated/claude/receipts/claude-isolated-e2e-v1.json`

## Claim boundary

This copy describes repository evidence only.

No marketplace form has been submitted and no marketplace presence, approval,
publication, runtime compatibility, production readiness, deployment, or
customer-data fitness is claimed.