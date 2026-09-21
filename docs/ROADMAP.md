# Roadmap

This roadmap describes capability stages in product language. It is not a
delivery promise, release schedule, or production compatibility claim.

## Released capability stages

### Portable local stack

The repository provides a standalone Docker Compose stack with KaleidoSphere,
bi-control, Apache Superset, local runtime directories, file secrets, tests, and
release archive checks.

### Oracle runtime foundation

Oracle metadata analysis runs through `node-oracledb` Thin mode with scoped
read-only principals, identity and rights preflight, bounded timeouts, and
evidence that source rows are not sampled.

### Oracle technical inventory

Oracle inventory expanded from structural metadata to technical metadata such
as comments hashes, constraints, indexes, partitions, LOBs, tablespaces,
statistics freshness, stored logic metadata, scheduler metadata, materialized
view refresh, and credential-free DB-link metadata.

### Local technical catalog and Q&A

Analysis receipts can be ingested into a versioned local SQLite catalog.
Deterministic search and bounded Q&A answer from the local catalog with receipt,
snapshot, scope, and coverage provenance. Fixed managed Superset technical
overview dashboards read only local projection tables.

### Guided BI requirements discovery

Discovery sessions collect audience role, business questions, KPI candidates,
dimensions, time grain, filters/segments, drilldowns, freshness needs,
access/confidentiality, open assumptions, confirmation state, and exportable
Markdown/JSON briefs. Suggestions are catalog-bound and do not create Superset
assets.

### Superset runtime fingerprint

The current stack can collect a read-only Apache Superset 6.1.0 runtime
fingerprint with sanitized target identity, OpenAPI canonical SHA-256,
feature-flag capability status, provenance, freshness policy, compatibility
verdict, limitations, and nonclaims. A fail-closed planning gate blocks future
write/import/export/promotion planning when fingerprint evidence is missing,
stale, incompatible, target-mismatched, or drifted.

### Review-only promotion ZIP contract

The repository can build, inspect, and preflight deterministic review-only ZIP
artifacts under `chimpmaera.bi/superset-promotion-bundle/v1`. Bundles bind a
confirmed Discovery brief, catalog provenance and coverage, a compatible fresh
Superset fingerprint, stable UUID review assets, per-file hashes, disclosure,
limitations, and nonclaims. This stage does not import or mutate Superset.

### PostgreSQL profiling and relationship evidence

The bounded PostgreSQL path adds explicit null/distinct count profiling and
single-column relationship-candidate evaluation. Only versioned aggregate
templates execute against allowlisted columns in read-only sessions. Observed,
computed, and inferred facts remain separate; candidates and the rule plan are
review-required proposals with no DDL or execution authority. Two digest-pinned
local PostgreSQL 16.10 runs provide byte-identical Evidence Store/report
readback without source-row material.

### MSSQL/Oracle safe-analysis parity

Four symmetric semantic methods provide bounded column summaries, quality
indicators, temporal coverage and relationship overlap under the progressive
controller. Exact pair targets debit both object budgets; advanced dispatch also
requires the persisted table/hypothesis reservation. Canonical evidence separates
observed aggregates, computed metrics, proposal-only inference and counterevidence.
Privilege/capability failures stay explicit and never become an absence claim.
Oracle native SQL Boolean columns remain explicitly unsupported rather than being
guessed from numeric conventions.

### Proposal-only roles, clusters and extended diff

Issue #39 is implemented as a local deterministic projection over the #36-#38
contracts. Closed technical role proposals, connected-component clusters and a
six-surface hash-chained diff retain support and counterevidence. Observed
removal is distinct from denied, unsupported or unknown visibility. This does
not activate an external runtime, infer a domain model or promote business truth.

### Portable net-revenue user journey

Issue #236/#237/#238 compose the released PostgreSQL C2 net-revenue calculation
and the VIS-01 visual into a documented, runnable local journey
(`node scripts/run-net-revenue-journey.mjs`) that runs normal and negative paths
against a real local read-only PostgreSQL source (injected PGlite in an isolated
runtime, never a package-manifest dependency) and reconciles every rendering to the
independent oracle. A second semantic synthetic layout maps to the same unchanged
metric core through two frozen versioned mapping profiles that reject ambiguous or
wrong units and unsupported role bindings fail-closed. A bounded period/segment
comparison separates order intake and open orders (a status dimension) from net
revenue, with credits/cancellations/unknowns preserved and segment totals labelled
gross-only. No causal attribution, second order-management module, or broader
chart/template/dashboard platform is claimed (the #167 promotion gate is NOT_PROMOTED);
human reader-comprehension evidence remains recorded separately and is never fabricated.

A positive local F4 composition (`node scripts/run-net-revenue-f4-composition.mjs`)
closes the previously-unimplemented #237 to #238 CLI path: a real local read-only source
is mapped through both frozen mapping profiles and compared period/segment, with the
negative source/unit/mapping paths denied fail-closed through the same entry point and
the #238 PANSPHAIRA provenance kept HELD.

## Candidate next capabilities

These are candidates for later reviewed work. They are not implemented claims:

- Human-approved materialization from a confirmed brief into Superset assets.
- Deeper Superset-native dependency-graph validation for dataset/chart/dashboard
  and native/cross-filter references before any later import path.
- Additional clean-room and public-rendering validation for documentation and
  release assets.
- Clearer product packaging and repo metadata after protected review.
- A reviewed harness adapter and thin Superset overlay using the M6-00 event,
  capability, approval, and reversible `ui-action/v1` contracts.
- A BI-Control persistent revision workflow with preview/diff, trusted visual
  approval, apply, readback, and rollback. Voice-only approval stays excluded.

## Explicit non-goals today

- Free-form SQL generation or SQL Lab enablement.
- Source-row sampling/persistence, business-row export, or model access to source rows.
- Automatic foreign-key creation or activation from relationship candidates.
- Dynamic Superset dataset/chart/dashboard generation without a reviewed
  promotion contract.
- Superset import or promotion execution from the current review-only bundle.
- Direct Superset-to-source Oracle or MSSQL credentials.
- Production, customer, SSO, HA, Kubernetes, or managed multi-tenant operation.
- DeepSeek Harness/Cordis integration, runtime plugin installation/HMR,
  arbitrary MCP servers, direct DOM/JavaScript agent control, or voice-only
  approval of persistent changes.
