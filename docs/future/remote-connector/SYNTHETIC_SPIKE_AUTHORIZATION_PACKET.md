# Unsigned synthetic spike authorization and go/no-go packet

- Issue/slice: `#92` / `FRC.3`
- Immutable package base: `664447988841eed2f9023f29ab7ba7025562e524`
- Historical artifact provenance: `33998d49d61eb191113d7d853187b4cb5e1d1fb6` (provenance only; it need not exist in local history)
- Signature status: `UNSIGNED`
- Authority requested/granted: `NONE` / `NONE`
- Current execution decision: `NO_GO`
- Discovery-package terminal outcome: `REJECTED_WITH_EVIDENCE`
- Decision owner: final issue #92 delivery owner

This packet records an honest fail-closed discovery result. It is not an
execution authorization, controller receipt, closure-audit receipt, production
release, or claim that preflight evidence is complete. This worker does not own
closure-audit scope and creates no controller receipt. The final issue #92
delivery owner owns any later closure evidence.

## Current prerequisite decision

Internal plan, fixture, validator, focused-test, and finite local-simulation
checks are separate from execution eligibility. They may pass without granting
any of G-1 through G-6. The current gate state is:

| Gate | State | Reason |
|------|-------|--------|
| G-1 | `NOT_GRANTED` | `FRC.0-EVIDENCE-ABSENT`, `FRC.1-EVIDENCE-ABSENT`, `FRC.2-EVIDENCE-ABSENT` |
| G-2 | `NOT_GRANTED` | `PRODUCT-AUTHORIZATION-ABSENT` |
| G-3 | `NOT_GRANTED` | `SECURITY-AUTHORIZATION-ABSENT` |
| G-4 | `NOT_GRANTED` | The local fixture is internally valid, but that is not run eligibility. |
| G-5 | `NOT_GRANTED` | Focused tests are internal validation, not execution authority. |
| G-6 | `NOT_GRANTED` | A local simulation receipt cannot authorize the run it describes. |

Worth-running authority is also absent:
`WORTH-RUNNING-EVIDENCE-ABSENT`. Therefore the affected scope—issue #92 FRC.3
synthetic spike execution eligibility—remains `NO_GO`, and the discovery package
is terminally `REJECTED_WITH_EVIDENCE`.

No caller-authored authority flag, boolean, fixture field, command-line option,
summary, or expected value can grant or substitute product, security, discovery,
or worth-running authority.

## Package-byte binding

Run:

```text
node scripts/readback-synthetic-spike-plan-package.mjs
```

The v2 readback receipt binds issue 92, base
`664447988841eed2f9023f29ab7ba7025562e524`, all 14 reconciled
repository-relative paths, each path's actual current-checkout SHA-256 bytes,
and a deterministic aggregate package digest over the ordered
`[{path,sha256}]` binding. It does not rely on `.git`, require historical head
`33998d49d61eb191113d7d853187b4cb5e1d1fb6`, or claim a future integration SHA.
Missing, stale, substituted, unreadable, or duplicated package bytes fail
closed structurally.

## Mandatory negative boundary

Each condition is unconditional `NO_GO`, with no execution and no blind retry:

- `NEG-01`: live credential, provider token, database credential, or secret;
- `NEG-02`: public bind, hosted/public endpoint, external host, required egress,
  or deployment;
- `NEG-03`: customer/provider data, real source row, customer identifier, or
  environment-derived fixture value;
- `NEG-04`: mutation-capable action or write outside the bounded disposable
  directory and sealed receipt;
- `NEG-05`: open-ended, blind, or boundary-failure retry;
- caller-authored or self-issued authority;
- any deployment, compliance, customer-valid, or production-readiness claim;
- stale, substituted, incomplete, or digest-mismatched package bytes.

## Decision, affected scope, and supersession

The final issue #92 delivery owner may supersede this `NO_GO` only by binding all
of the following to the complete then-current package:

1. independently issued FRC.0-FRC.2 completion or exact scope-down evidence;
2. distinct, unexpired product and security authorizations;
3. an independently owned worth-running decision naming a residual question;
4. passing internal validation and final-owner canonical integration checks; and
5. a distinct explicit start by the authorized actor.

Supersession is not automatic and cannot be authored by a caller to this
fixture or harness. Until every condition holds simultaneously, do not start a
connector, MCP service, process, listener, endpoint, deployment, release, CI
job, GitHub action, or retry loop.

## Nonclaims

This package claims no connector implementation or execution, MCP listing,
public endpoint, credential use, customer/provider-data behavior, mutation,
deployment, compliance readiness, production readiness, release, PR, merge,
issue closure, closure-audit/controller receipt, or future commit/SHA. Internal
validation demonstrates only a bounded synthetic planning fixture and its
fail-closed evidence structure.
