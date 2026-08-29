# KaleidoSphere Codex directory listing

## Claims

- Claim: KaleidoSphere is distributed as a skills-only Codex plugin.
- Claim: The package version is `0.26.0`.
- Claim: The package declares the `kaleidosphere` skill at `skills/kaleidosphere/SKILL.md`.
- Claim: The skill accepts only `status`, `discovery`, `analyze`, `plan`, `preview`, and `readback` actions.
- Claim: When no trusted KaleidoSphere transport is configured, the skill returns `WAITING_EXTERNAL` after local validation.
- Claim: The package SHA-256 digest is `e513393ed4ee72098968be99da34941fd87fc95ea0046c30b73f8378c25d821a`.
- Claim: The plugin manifest SHA-256 digest is `64494f3a2e993ba476834dd49dfb1a1a60cfe8671b8ab6f08eb5f86045873b77`.

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
- Version: `0.26.0`
- License: `Apache-2.0`
- Package digest: `e513393ed4ee72098968be99da34941fd87fc95ea0046c30b73f8378c25d821a`
- Manifest digest: `64494f3a2e993ba476834dd49dfb1a1a60cfe8671b8ab6f08eb5f86045873b77`
- Receipt: `verification/k4c/security-license-receipt-v1.json`
- Receipt: `verification/k4c/codex-isolated-e2e-v1.json`

## Claim boundary

This copy describes repository evidence only. No portal form has been submitted
and no marketplace presence, approval, publication, runtime compatibility,
production readiness, deployment, or customer-data fitness is claimed.
