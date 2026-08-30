# KS93 remote-connector decision contract

## Fixed outcome and authority

The released #89-#92 evidence selects terminal `REJECTED_WITH_EVIDENCE` and execution `NO_GO` (`REJECT` in the machine verdict). `FUTURE_BACKLOG` requirements remain documentation. Internal validation is reported only as `VALIDATED`; it must never be called capability `RELEASED`.

The evidence index contains exactly `FRC.0` through `FRC.3`, each with release/main provenance, repository-relative path, exact current-checkout SHA-256, exact anchor, and claim references. Validation uses current-checkout bytes and requires neither `.git` nor intermediate history.

## Decision precedence

1. Malformed shape, drifted bytes, unresolved citation, forbidden evidence value, or false authority field: `INVALID_PACKAGE`.
2. Any evidence-backed assessment failure or prohibited scope: `REJECTED_WITH_EVIDENCE` / `REJECT` / execution `NO_GO`.
3. Missing or inconclusive evidence: `REJECTED_WITH_EVIDENCE` / `NO-GO`.
4. A hypothetical complete positive package could only be a decision input; it could never authorize implementation or delivery.

## Required dimensions

The package explicitly records feasibility, risks, costs, compliance gaps, support burden, rollback, affected scope, owner, reasons, and supersession. Released citations are authoritative; caller-authored summaries and expected values are not.

## Firewall

Every implementation child requires separate explicit Jo, Product, and Security authorization bound to that one immutable child. Discovery, endpoint creation, External API v2 widening, credentials or customer data, caller-authored authority, deployment readiness, compliance readiness, and production readiness cannot grant or substitute authority. Missing, stale, ambiguous, reused, or conflicting records deny the child.
