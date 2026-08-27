# Progressive Analysis v1 evidence

Issue: #37 and bounded #40 typed-drilldown leaf. Evidence source: deterministic
local synthetic MSSQL fixtures only.

## Proven behavior

- Every dispatch reservation first passes the released v1 breadth, method,
  typed-parameter, scope, run-budget, and object-budget gates.
- Run, table, object, and hypothesis counters are persisted and recomputed from
  reservations. Sequential exhaustion and stale concurrent commits fail before
  dispatch; no debit rollback or refund is accepted.
- Every reservation carries its calculated expected-information-gain inputs,
  rationale, evidence hashes, typed intent, exact candidate hash, and typed
  near-duplicate key. Ranking is deterministic; exact and near duplicates are
  suppressed while materially distinct intents remain eligible.
- Two consecutive no-gain receipts stop the branch. Repeated counterevidence is
  retained with contradiction receipts and also stops at its configured bound.
  Supporting evidence remains candidate evidence and is never promoted to fact.
- JSON restart preserves canonical state/report identity. Successful work is
  reused. Unknown outcomes remain debited and non-retryable; an append-only,
  evidence-bound reconciliation produces the same state before or after restart.
- Negative probes cover forged gain, counter rollback, replay/cross-scope
  binding, raw values, credentials, DDL/free SQL, timeout, cancellation, and
  sealed-record tampering while the full v1 safety tests remain active.
- Four typed drilldown paths are sealed against the existing safe method
  registry: column summary, temporal coverage, relationship overlap, and
  quality indicators. Each decision carries the claim digest, evidence gap,
  typed method intent, expected-gain evidence, remaining budgets, stopping
  rule, and a permanently false dispatch flag.
- Eligibility explicitly records phase, scope/visibility, allowlist,
  privilege/coverage, capability, run/table/hypothesis budget, duplicate,
  timeout, cancellation, and receipt-resume gates. A completed reservation is
  read back as a receipt trace with evidence and retained counterevidence;
  eligibility itself performs no reservation or dispatch.
- Reversed request input order and JSON restart produce the same eligible
  ordering and typed terminal digest. Unsupported capability, invisible
  scope, forged/stale receipt, duplicate reservation, exhausted budget, raw
  value, credential-shaped input, free SQL, and unknown method cases fail
  closed.

## Deterministic fixture hashes

- Sequential terminal report: `27495b93bbbe85ea21d800fb19aaaa4a0e480804490daa17788835032822e0a3`
- JSON-restart terminal report: `27495b93bbbe85ea21d800fb19aaaa4a0e480804490daa17788835032822e0a3`
- One-slot concurrent reservation state: `8cd413ac2c90ee5b415b908d7d58a1713949a88521953a888126b50aa89d73f9`
- Unreconciled unknown-outcome state: `5e6d34d85a3d5b9d34fbac92c113e6789455cb74812557914bc6bb8ea16fb948`
- Typed drilldown terminal eligibility digest: `10e7047a702995d6370438a56a8d29da21f5c86d50edfc8daf6c9658229867df`

Reproduce with:

```sh
KS_PRINT_PROGRESSIVE_ANALYSIS_HASHES=1 npm run test:progressive-analysis
```

## Evidence limits and non-claims

The fixtures do not access a production/customer database, activate a runtime,
or add a dispatch path. They do not claim free model SQL, raw rows, automatic
business truth/remediation, learned semantic equivalence, inferred-FK truth,
universal completeness, unrestricted concurrency, optimal gain, causal truth,
or capability/privilege beyond the manifest-backed safe methods. Remaining
issue criteria are runtime dispatch ownership, production/customer access,
new methods or stronger claims; none may be addressed by bypassing the
eligibility gates.
