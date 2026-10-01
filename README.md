# KaleidoSphere

<img src="https://raw.githubusercontent.com/JoFe2/KaleidoSphere/6c52fe412f62b4197979c4139575043ec75ec192/services/bi-agent/assets/kaleidosphere-logo.png" alt="KaleidoSphere logo" width="96" height="96">

## Adapt your analysis. Keep control of the meaning.

**Multi-perspective Business & Decision Intelligence.**

A dashboard can show a number without explaining which data, definitions or assumptions produced it. When a business question or data structure changes, that missing context makes the result difficult to check and reuse.

KaleidoSphere brings database discovery, defined metrics and inspectable results together. Explore what a source contains, clarify the question, and follow a supported metric through its table, chart and contributing aggregates. Keep the source context and known gaps alongside the answer.

It is the analytics and Decision Intelligence system in the **PANSPHAIRA ecosystem**. Its direction is adaptable analysis: reuse checked building blocks as questions and sources evolve, rather than treating every dashboard as an isolated project.

**Available today:** read-only metadata discovery and released, explicitly scoped metric journeys with synthetic data. Real-context pilots and broader automatic adaptation are separate development goals, not established production capabilities.

[Explore the examples](#what-you-can-explore) · [Start locally](#start-locally) · [How it fits together](#how-it-fits-together) · [Releases](https://github.com/JoFe2/KaleidoSphere/releases)

## From a question to a result you can inspect

1. **Define the question.** Discover the source structure and clarify the metric, period, units and permitted scope.
2. **Check the result.** Inspect the calculation and its evidence. Keep missing coverage and contradictory evidence visible.
3. **Assess reuse.** Compare a supported mapping or handoff before adopting it for another declared context.

```text
Business question + permitted sources
                 |
       Read-only discovery
                 |
       Local evidence catalog
                 |
    Defined metric + checked result
                 |
       Table / chart / details
                 |
          Review and reuse
```

This is the architectural reading order. The examples below have their own supported inputs and proof boundaries; the diagram does not imply a universal end-to-end integration.

## What you can explore

### Understand a database before designing a dashboard

Inspect **Oracle or Microsoft SQL Server metadata** with a read-only account. Explore table sizes, dependencies, stored logic and coverage, then use guided discovery to prepare a BI requirements brief with source context.

**Status:** documented runtime functionality, with a synthetic fixture for the default local introduction.

[Technical catalog](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/M3_LOCAL_TECHNICAL_CATALOG.md) · [Guided BI discovery](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/M4_GUIDED_BI_DISCOVERY.md)

### Explain the number behind a chart

Follow a **net-revenue result** through its table, chart, period filter and contributing aggregates. See the declared units and calculation context instead of treating the visualization as the whole explanation.

**Status:** released visualization evidence from real PostgreSQL execution with synthetic, non-customer data.

[Visualization and reproduction](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/vis01-net-revenue.md)

### Compare a metric across two declared data layouts

Use frozen mappings for **two ledger layouts**, then compare periods and segments through a local SQL engine. The example shows a concrete route to reuse without claiming that arbitrary schemas are interchangeable.

**Status:** released local synthetic tooling. The connected demonstration keeps its holdout and comparison fixtures separate; it is not one continuous business-data lineage.

[Metric composition](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/net-revenue-f4-composition-v1.md) · [Connected demonstration](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/net-revenue-connected-journey-v1.md)

### Inspect a cross-system handoff before relying on it

Keep task identity, source revision and result evidence together. Inspect a paired read and compare an explicitly supplied **synthetic target-status snapshot** with qualified source bytes.

**Status:** released fixed-source synthetic tooling. Reading target status does not install or transfer anything to that target.

[Paired display and boundaries](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/ks247-ks256-paired-display-v1.md)

### Learn where a reuse assumption breaks

Compare access modes against a fixed task reference. Full-data output matches that reference; paired metadata-only and aggregate modes do not pass the benchmark and remain unsupported.

**Status:** released comparison tooling with an explicitly failed benchmark—not a claim that those access modes work.

[Comparison results and reproduction](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/ks248-paired-access-evaluation-v2.md)

## How it fits together

- **Source discovery** reads permitted metadata and records what was—and was not—observed.
- **The local catalog** keeps source identity, coverage and technical context available for inspection.
- **Declared metric paths** connect supported inputs, calculations and checks.
- **Tables, charts and the local Superset stack** provide the supported views, not an unrestricted dashboard generator.
- **Thin agent interfaces** help operate defined actions. They do not receive database credentials, free-form SQL privileges or new permissions simply because a prompt requests them.

People choose the question and access scope. Permissions and review determine what may be reused or promoted; model output is not authorization.

[Architecture](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/ARCHITECTURE.md) · [Security model](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/SECURITY.md) · [Detailed capability inventory](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/README.md#current-capabilities-and-boundaries)

## Start locally

The default metadata introduction uses a deterministic synthetic fixture: **no external database or API key is required**.

Host prerequisites: **Node.js 24**, **curl**, Docker Engine with Compose v2, OpenSSL, and available localhost ports `18088` and `18790`.

```bash
git clone https://github.com/JoFe2/KaleidoSphere.git
cd KaleidoSphere
cp .env.example .env
./bin/bi setup
./bin/bi up
./bin/bi status
./bin/bi analyze
./bin/bi ask "Largest tables by size"
```

Open the local KaleidoSphere UI at `http://127.0.0.1:18790`. The documented configuration explains Superset access and local credentials. Shut down the stack with `./bin/bi down` when finished.

The metric demonstrations are separate entry points with their own pinned runtimes and explicit inputs; they are not additional default Compose database engines.

[Local configuration](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/CONFIGURATION.md) · [Run a metric journey](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/net-revenue-journey-v1.md)

## One skill source, explicit host boundaries

The canonical AgentSkill provides instructions for six defined API actions: **status, discovery, analyze, plan, preview and readback**. Host-specific views reuse that source without adding credentials or mutation authority.

Distribution archives for ClawHub/OpenClaw/Hermes, Codex and Claude Code are available through the project's releases. Archive availability is not proof of a current marketplace listing or successful execution in every host. Thin packages accompany the licensed source archive; retain its Apache-2.0 license and NOTICE.

[Distribution assets](https://github.com/JoFe2/KaleidoSphere/releases) · [Recorded host and publication boundaries](https://github.com/JoFe2/KaleidoSphere/issues/73#issuecomment-5910521259)

## What comes next

The direction is broader source coverage, more reusable analytical building blocks and clearer visual composition. Real-context pilots must establish practical value and operating limits with separately authorized sources and actual observations.

Reader comprehension, pilot evidence and marketplace approval are distinct acceptance steps. Automated tests do not replace them.

[Roadmap](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/ROADMAP.md) · [Reader exercise](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/docs/evidence/ks236-reader-task-protocol-v1.md) · [Pilot scope](https://github.com/JoFe2/KaleidoSphere/issues/250)

## Source, evidence and contribution

The examples above link to a fixed source revision so their evidence remains inspectable. Use the release page for the artifact and checksum contract of the version you download. Repository, runtime component, External API and Superset versions are separate identities.

[Releases](https://github.com/JoFe2/KaleidoSphere/releases) · [License](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/LICENSE) · [Source provenance](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/SOURCE-MAP.md) · [Development and verification](https://github.com/JoFe2/KaleidoSphere/blob/6c52fe412f62b4197979c4139575043ec75ec192/README.md#development-and-verification)
