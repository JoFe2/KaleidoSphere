# Synthetic spike-plan package closure checklist

Scope: local discovery-package readback for issue `#92` / `FRC.3` at immutable
base `664447988841eed2f9023f29ab7ba7025562e524`.

## Current disposition

- [x] Discovery package: `REJECTED_WITH_EVIDENCE`.
- [x] Execution decision: `NO_GO`.
- [x] Decision owner: final issue #92 delivery owner.
- [x] Affected scope: issue #92 FRC.3 execution eligibility.
- [x] FRC.0-FRC.2, product authorization, security authorization, and
  worth-running authority are absent; G-1 through G-6 are `NOT_GRANTED`.
- [x] Internal plan/fixture/test/simulation validation is kept separate and does
  not grant execution authority.

## Worker boundary

This correction worker creates no controller receipt and does not own
closure-audit scope. The final issue #92 delivery owner owns canonical test and
source registration, exact-head evidence, PR/CI, merge, release, anonymous
readback, issue closure, and queue reconciliation. The four focused test files
remain ready for that owner's canonical registration; this worker does not edit
`package.json` or `SOURCE-MAP.json`.

## Local readback

Run from the package checkout:

```text
node scripts/readback-synthetic-spike-plan-package.mjs
```

Confirm that the receipt:

- binds issue 92 and base `664447988841eed2f9023f29ab7ba7025562e524`;
- lists all 14 reconciled paths and each path's actual SHA-256 bytes;
- produces a deterministic aggregate package digest;
- treats historical head `33998d49d61eb191113d7d853187b4cb5e1d1fb6`
  only as provenance, does not require it in `.git`, and claims no future
  integration SHA;
- reports internal package validation separately from the terminal
  `REJECTED_WITH_EVIDENCE` / `NO_GO` decision; and
- rejects missing, stale, substituted, unreadable, or duplicated bytes.

## Focused verification for this worker

Use active Node 24 and invoke subprocesses through `process.execPath` in tests:

```text
node --test tests/future/remote-connector/92/synthetic-spike-plan.test.mjs \
  tests/validate-synthetic-connector-spike-plan.test.mjs \
  tests/dry-run-synthetic-connector-spike.test.mjs \
  tests/readback-synthetic-spike-plan-package.test.mjs
git diff --check
```

The readback test also copies the complete package to a temporary directory
without `.git` and runs it there. No intermediate history is required.

## Supersession and later cleanup

Only the final issue #92 delivery owner may supersede this decision, after
independent, complete, current-package-bound FRC.0-FRC.2 evidence, distinct
product/security authorization, worth-running authority, canonical checks, and
an explicit authorized start all exist. A caller-authored authority value is
never accepted.

If such a later run is separately authorized, it must delete every isolated
resource it created and record cleanup evidence. It must stop on the first live
credential, public bind/endpoint, customer/provider data, mutation-capable
action, open-ended retry, boundary breach, or stale package byte.

## Nonclaims retained

- No connector implementation or execution.
- No MCP listing or public endpoint.
- No customer/provider-data or credential behavior.
- No mutation-capable action or deployment.
- No production readiness or compliance readiness.
- No authorization, start, release, PR, merge, issue closure, controller
  receipt, or closure-audit receipt; no future integration SHA is claimed.
