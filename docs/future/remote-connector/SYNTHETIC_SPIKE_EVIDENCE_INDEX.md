# Synthetic spike evidence index

- Issue: `#92` / `FRC.3`
- Base: `664447988841eed2f9023f29ab7ba7025562e524`
- Historical source head: `33998d49d61eb191113d7d853187b4cb5e1d1fb6`
  (provenance only; not required in current history)
- Decision owner: final issue #92 delivery owner
- Discovery-package outcome: `REJECTED_WITH_EVIDENCE`
- Execution decision: `NO_GO`

## Evidence state

| Evidence | State | Reason/effect |
|----------|-------|---------------|
| Current 14-path package bytes | `PRESENT_INTERNAL` | Bound at read time by per-path actual SHA-256 and deterministic aggregate package digest; grants no authority. |
| Plan and fixture contract | `PRESENT_INTERNAL` | Offline internal validation only. |
| Four focused test files | `PRESENT_UNREGISTERED` | Ready for canonical registration by the final owner; this worker does not edit `package.json` or `SOURCE-MAP.json`. |
| Local finite fixture simulation | `PRESENT_INTERNAL` | No connector/MCP/network execution; preflight remains `NO_GO`. |
| FRC.0 discovery | `ABSENT` | `FRC.0-EVIDENCE-ABSENT`; G-1 `NOT_GRANTED`. |
| FRC.1 discovery | `ABSENT` | `FRC.1-EVIDENCE-ABSENT`; G-1 `NOT_GRANTED`. |
| FRC.2 discovery | `ABSENT` | `FRC.2-EVIDENCE-ABSENT`; G-1 `NOT_GRANTED`. |
| Product authorization | `ABSENT` | `PRODUCT-AUTHORIZATION-ABSENT`; G-2 `NOT_GRANTED`. |
| Security authorization | `ABSENT` | `SECURITY-AUTHORIZATION-ABSENT`; G-3 `NOT_GRANTED`. |
| Worth-running authority | `ABSENT` | `WORTH-RUNNING-EVIDENCE-ABSENT`; execution `NO_GO`. |
| Closure-audit/controller receipt | `NOT_WORKER_SCOPE` | Final issue #92 delivery owner owns it; none is invented here. |

G-4 through G-6 are also `NOT_GRANTED`: locally valid fixture, focused tests,
and simulation receipts are internal checks, not run-eligibility evidence. No
caller-authored boolean, expected value, or summary supplies authority.

## Current-checkout binding

`scripts/readback-synthetic-spike-plan-package.mjs` reads the fixed 14-path list,
computes actual SHA-256 over each file's bytes, and computes the aggregate as
SHA-256 of `JSON.stringify` over the ordered `[{path,sha256}]` list. Its receipt
binds issue 92 and the immutable base above. It makes no future integration SHA
claim and requires no `.git` directory or intermediate commit.

Missing, unreadable, stale, substituted, or duplicated package content fails
closed structurally. Historical source head `33998d...` remains provenance and
is not used as authority for current bytes.

## Negative-gate crosswalk

| ID | Denied condition | Effect |
|----|------------------|--------|
| NEG-01 | live credential, token, database credential, or secret | `NO_GO`; no action |
| NEG-02 | public bind/endpoint, hosted endpoint, external host/egress, deployment | `NO_GO`; no action |
| NEG-03 | customer/provider data, real source row, environment-derived value | `NO_GO`; no action |
| NEG-04 | mutation-capable action or out-of-bound write | `NO_GO`; no action |
| NEG-05 | open-ended, blind, or boundary-failure retry | `NO_GO`; no retry |
| AUTH-NEG | caller-authored/self-issued authority | `NO_GO`; no action |
| READY-NEG | deployment, compliance, customer-valid, or production-readiness claim | rejected as a nonclaim violation |
| BYTES-NEG | stale, substituted, missing, or incomplete package bytes | structured internal validation failure |

## Decision and supersession

The affected scope is only issue #92 FRC.3 execution eligibility. The final
issue #92 delivery owner may supersede the decision only with independently
issued and current-package-bound FRC.0-FRC.2 evidence, distinct product and
security authorization, an independently owned worth-running decision, passing
canonical checks, and a separate explicit start. No condition is inferred or
automated.

## Nonclaims

No connector/MCP implementation or execution, public endpoint, credential use,
customer/provider data result, mutation, deployment, compliance readiness,
production readiness, PR, merge, release, closure, controller receipt, or future
commit/SHA is claimed.
