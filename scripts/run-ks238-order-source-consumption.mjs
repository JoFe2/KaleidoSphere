#!/usr/bin/env node
// KaleidoSphere #238 — receiving-side order/source consumption CLI.
//
// One documented entry point that consumes the ACTUAL PINNED PAN order/source handoff,
// runs the bounded SUPPORTED CURRENT-ORDER comparison, and reports the explicit
// missing history/unit/revenue semantics SEPARATELY from net revenue.
//
//   node scripts/run-ks238-order-source-consumption.mjs [--format JSON]
//        [--out <path>] [--negative]
//
//   --negative runs the EXACT negative paths (substituted producer module, stale decision
//   time, wrong source label, tampered carried payload, unsupported-status folding, and a
//   merged order+revenue attempt) and requires every one of them to be REFUSED. A
//   negative run that any path accepts exits non-zero.
//
// No credentials, no network, no mutation, no publish path, and no public write. The only
// optional write is a local JSON receipt under the repository or /tmp.

import { realpath, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';

import {
  PAN_ORDER_SOURCE_DEPENDENCY,
  createRetainedSourceAuthority,
  consumeOrderSourceHandoff,
  compareSupportedCurrentOrders,
  buildOrderSourceConsumptionReport,
  buildOrderVsRevenueSeparation,
  assertOrderSourceConsumptionSelfChecks,
} from '../services/bi-control/src/business-bi/order-source-consumption.mjs';

const root = path.resolve(import.meta.dirname, '..');
const SOURCE_BYTES = 'tests/fixtures/business-bi/ks238-order-source/erp-supported-export-v1.json';
const CONTRACT = 'tests/fixtures/business-bi/ks238-order-source/erp-read-contract-v1.json';
const SOURCE_LABEL = 'LOCAL_SYNTHETIC_ERP_ORDER_SOURCE_V1';
// The released export is valid 2026-08-10T08:00:00Z .. 09:00:00Z.
const NOW = '2026-08-10T08:30:00Z';
const PRODUCER_REPO = path.resolve(root, '..', 'PANSPHAIRA-source');

// Same confinement contract as the released #240 CLI: no symlink component, no prefix
// lookalike, and the write target must live inside the repository or /tmp.
async function assertAllowedOutputPath(out) {
  const resolved = path.resolve(out);
  const prefixes = [root, '/tmp'];
  const matchedNorm = prefixes.map((p) => (p.endsWith(path.sep) ? p.slice(0, -1) : p))
    .find((norm) => resolved === norm || resolved.startsWith(`${norm}${path.sep}`));
  if (!matchedNorm) throw new Error('KS238_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  const realRoot = await realpath(matchedNorm)
    .then((rp) => (rp.endsWith(path.sep) ? rp.slice(0, -1) : rp)).catch(() => null);
  if (realRoot === null) throw new Error('KS238_CLI_OUT_PATH_DENIED: --out must be inside the repository or /tmp');
  const rel = resolved.slice(matchedNorm.length).split(path.sep).filter((c) => c !== '' && c !== '.');
  let walked = realRoot;
  for (const comp of rel) {
    const candidate = path.join(walked, comp);
    let st;
    try { st = await lstat(candidate); } catch { break; }
    if (st.isSymbolicLink()) throw new Error('KS238_CLI_OUT_PATH_DENIED: --out must not contain a symlink');
    walked = candidate;
  }
  return resolved;
}

const retained = (overrides = {}) => {
  const result = createRetainedSourceAuthority({
    sourceBytesFile: SOURCE_BYTES,
    contractFile: CONTRACT,
    sourceLabel: SOURCE_LABEL,
    now: NOW,
    repoRoot: root,
    ...overrides,
  });
  if (!result.ok) throw new Error(`RETAINED_AUTHORITY_FAILED: ${result.code}`);
  return result.authority;
};

// The INTERMEDIATE TESTED HANDOFF: a normal run produces the consumed handoff, and that
// handoff is handed to the comparison stage as a serialized payload. The next stage
// rebinds it against the retained authority rather than trusting it.
async function intermediateTestedHandoff(authority) {
  const consumed = await consumeOrderSourceHandoff({
    retainedAuthority: authority, repoRoot: root, producerRepoRoot: PRODUCER_REPO,
  });
  if (consumed.outcome !== 'CONSUMED') {
    throw new Error(`INTERMEDIATE_HANDOFF_NOT_CONSUMED: ${consumed.code}`);
  }
  const rebound = await consumeOrderSourceHandoff({
    retainedAuthority: authority,
    handoffPayload: { binding: consumed.handoff.binding, bindingDigest: consumed.handoff.bindingDigest },
    repoRoot: root,
    producerRepoRoot: PRODUCER_REPO,
  });
  if (rebound.outcome !== 'CONSUMED' || rebound.rebind?.outcome !== 'REBOUND') {
    throw new Error(`INTERMEDIATE_HANDOFF_REBIND_FAILED: ${rebound.code}`);
  }
  return { consumed, rebound };
}

async function runNormal({ netRevenueComparison = null } = {}) {
  const authority = retained();
  const { consumed, rebound } = await intermediateTestedHandoff(authority);
  const comparison = compareSupportedCurrentOrders({ consumption: consumed });
  const separation = buildOrderVsRevenueSeparation({
    currentOrderComparison: comparison, netRevenueReport: netRevenueComparison,
  });
  const report = buildOrderSourceConsumptionReport({
    consumption: consumed, netRevenueComparison, generatedAt: NOW,
  });
  assertOrderSourceConsumptionSelfChecks({
    report, consumption: consumed,
    moduleSourceText: readFileSync(
      path.join(root, 'services/bi-control/src/business-bi/order-source-consumption.mjs'), 'utf8'),
  });
  return {
    stage: 'NORMAL',
    outcome: 'CONSUMED',
    dependency: {
      parentCandidateCommit: PAN_ORDER_SOURCE_DEPENDENCY.parentCandidateCommit,
      moduleSha256: consumed.module.moduleSha256,
      commitBinding: consumed.module.commitBinding,
    },
    intermediateHandoff: {
      created: consumed.handoff.bindingDigest,
      rebound: rebound.rebind.bindingDigest,
      reboundAgainstRetainedAuthority: rebound.rebind.payloadReboundAgainstRetainedAuthority,
    },
    currentOrderComparison: comparison,
    separation,
    missingSemantics: report.missingSemantics,
    selfChecks: 'ALL_GREEN',
    digest: report.digest,
  };
}

// ------------------------------------------------ the EXACT negative paths

async function runNegative() {
  const results = [];
  const record = (id, refused, detail) => results.push({ id, refused, detail });
  const authority = retained();

  // N1 — a substituted producer module is denied on its bytes, before import.
  {
    const dir = mkdtempSync(path.join(os.tmpdir(), 'ks238-neg-'));
    const fake = path.join(dir, 'order-source-handoff.mjs');
    writeFileSync(fake, 'export const createKs238OrderSourceHandoff = () => ({ outcome: "ADAPTED", bindingDigest: "forged" });\n');
    const result = await consumeOrderSourceHandoff({
      retainedAuthority: authority, repoRoot: root, explicitModulePath: fake,
    });
    record('N1_SUBSTITUTED_PRODUCER_DENIED',
      result.outcome !== 'CONSUMED' && result.code === 'PAN_ORDER_SOURCE_MODULE_INTEGRITY_DENIED',
      { outcome: result.outcome, code: result.code, state: result.state });
  }

  // N2 — a stale decision time is refused, never silently re-dated.
  {
    const stale = retained({ now: '2026-08-10T09:00:01Z' });
    const result = await consumeOrderSourceHandoff({ retainedAuthority: stale, repoRoot: root });
    record('N2_STALE_DECISION_TIME_DENIED',
      result.outcome === 'DENIED' && result.code === 'SOURCE_STALE',
      { outcome: result.outcome, code: result.code });
  }

  // N3 — a wrong source label is refused before any composition.
  {
    const wrong = retained({ sourceLabel: 'PROVIDER_ATTESTED' });
    const result = await consumeOrderSourceHandoff({ retainedAuthority: wrong, repoRoot: root });
    record('N3_WRONG_SOURCE_LABEL_DENIED',
      result.outcome === 'DENIED' && result.code === 'SOURCE_LABEL_DENIED',
      { outcome: result.outcome, code: result.code });
  }

  // N4 — a tampered carried payload cannot rebind against the retained authority.
  {
    const { consumed } = await intermediateTestedHandoff(authority);
    const tampered = JSON.parse(JSON.stringify(consumed.handoff.binding));
    tampered.supported.statusCounts.OPEN = 99;
    const result = await consumeOrderSourceHandoff({
      retainedAuthority: authority,
      handoffPayload: { binding: tampered, bindingDigest: consumed.handoff.bindingDigest },
      repoRoot: root, producerRepoRoot: PRODUCER_REPO,
    });
    record('N4_TAMPERED_PAYLOAD_REBIND_DENIED',
      result.outcome === 'DENIED', { outcome: result.outcome, code: result.code });
  }

  // N5 — an unsupported status is never folded into a supported bucket.
  {
    const { consumed } = await intermediateTestedHandoff(authority);
    const comparison = compareSupportedCurrentOrders({ consumption: consumed, supportedStatuses: ['CONFIRMED'] });
    const folded = Object.keys(comparison.byStatus).some((s) => !comparison.supportedStatuses.includes(s))
      || comparison.totals.supportedOrderCount !== 0;
    record('N5_UNSUPPORTED_STATUS_NOT_FOLDED',
      folded === false && comparison.excludedUnsupported.every((e) => e.disposition === 'EXCLUDED_UNSUPPORTED'),
      { supportedOrderCount: comparison.totals.supportedOrderCount, excluded: comparison.excludedUnsupported });
  }

  // N6 — a report that attempts to merge order and revenue fails the self-checks.
  {
    const { consumed } = await intermediateTestedHandoff(authority);
    const report = buildOrderSourceConsumptionReport({ consumption: consumed, generatedAt: NOW });
    const merged = JSON.parse(JSON.stringify(report));
    merged.separation.arithmeticPerformedAcrossSides = true;
    let refused = false;
    try {
      assertOrderSourceConsumptionSelfChecks({ report: merged, consumption: consumed });
    } catch (error) {
      refused = error.code === 'ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED';
    }
    record('N6_ORDER_REVENUE_MERGER_REFUSED', refused, { refused });
  }

  // N7 — an unavailable revenue fact cannot be re-declared available.
  {
    const { consumed } = await intermediateTestedHandoff(authority);
    const report = buildOrderSourceConsumptionReport({ consumption: consumed, generatedAt: NOW });
    const forged = JSON.parse(JSON.stringify(report));
    forged.missingSemantics.netRevenue = { state: 'AVAILABLE', reason: null, value: 0 };
    let refused = false;
    try {
      assertOrderSourceConsumptionSelfChecks({ report: forged, consumption: consumed });
    } catch (error) { refused = error.code === 'ORDER_SOURCE_CONSUMPTION_SELF_CHECK_FAILED'; }
    record('N7_UNAVAILABLE_REVENUE_NOT_RE_DECLARED_AVAILABLE', refused, { refused });
  }

  // N8 — a comparison without a consumed handoff refuses to produce orders.
  {
    const denied = compareSupportedCurrentOrders({ consumption: { outcome: 'DENIED', code: 'SOURCE_STALE' } });
    record('N8_COMPARISON_REQUIRES_CONSUMED_HANDOFF',
      denied.outcome === 'UNAVAILABLE' && denied.code === 'CURRENT_ORDER_COMPARISON_REQUIRES_CONSUMED_HANDOFF',
      { outcome: denied.outcome, code: denied.code });
  }

  return {
    stage: 'NEGATIVE',
    allRefused: results.every((r) => r.refused),
    total: results.length,
    refused: results.filter((r) => r.refused).length,
    paths: results,
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      format: { type: 'string', default: 'JSON' },
      out: { type: 'string' },
      negative: { type: 'boolean', default: false },
    },
    allowPositionals: true,
  });

  const payload = values.negative ? await runNegative() : await runNormal();
  const text = JSON.stringify(payload, null, values.format === 'JSON' ? 2 : 0);

  if (values.out) {
    const target = await assertAllowedOutputPath(values.out);
    await writeFile(target, `${text}\n`, { flag: 'w' });
    process.stdout.write(`${JSON.stringify({ wrote: target, stage: payload.stage })}\n`);
  } else {
    process.stdout.write(`${text}\n`);
  }

  if (values.negative && payload.allRefused !== true) process.exit(1);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
});
