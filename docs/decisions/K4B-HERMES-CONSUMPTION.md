# K4b Safe Local Hermes Consumption Proof

## Decision

K4b proves that Hermes can consume the generated single-source KaleidoSphere skill view without a second maintained copy. `scripts/verify-hermes-consumption.mjs` builds the distribution from `agent-skills/kaleidosphere` with the existing K4 builder, then stages the generated ClawHub/OpenClaw/Hermes view (`dist/agent-skill-distribution/clawhub/kaleidosphere`) into a temporary Hermes-style skills directory (`<workspace>/hermes/skills/kaleidosphere`), mirroring the documented `~/.hermes/skills/kaleidosphere` target without touching any real home directory. The proof writes only inside its temporary workspace.

## Evidence

- `npm run test:hermes-consumption` runs `tests/hermes-consumption.test.mjs`.
- The verifier stages the generated view, validates exact bytes and SHA256 digests, executes the closed request validator from the staged copy, and snapshots digest and size of the closed input set before and after the run.

## Gates

- Exact file set and byte/digest equality from the canonical single source through the generated host view to the staged Hermes view, including the generated `references/portable-companion-v1.json` binding.
- The closed request validator is executed from the staged copy, not the repository copy: the allowed `status` request validates as `read-only`, and widening requests (`apply`, and a `plan` request smuggling SQL) fail closed with a non-zero exit.
- Zero source mutation: the before/after snapshots of the closed input set (canonical skill, host contracts, Portable Companion and External API v2 sources, package version, builder and verifier scripts) are identical.
- Temporary local paths only: all writes stay under the temporary workspace, and emitted output (verifier stdout and the written `hermes-consumption-proof.json` evidence) records relative paths and digests only, never host-specific absolute paths.
- Deterministic output: two fresh runs produce byte-identical verifier output.

## Non-Claims

- No ClawHub publication, authentication, or marketplace listing or approval claim.
- No external dispatch, transport activation, or Hermes runtime execution claim; this is local runtime/package consumption evidence only.
- No production readiness or host runtime compatibility claim.
- The canonical single-source skill bytes are unchanged by the proof.