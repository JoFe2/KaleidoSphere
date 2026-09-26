#!/usr/bin/env node
// KaleidoSphere #249 (KS-EVO-04) — the ONE runnable LOCAL metric-compiler adapter entry point.
//
// It compiles the RELEASED metric contract into the bounded metric IR, preserves every bounded
// channel, refuses every unsupported dialect by name and detects source drift against the pinned
// contract digest. It installs nothing, adopts no vendor component, opens no socket and writes
// no artifact.
//
//   node scripts/run-metric-compiler-adapter.mjs
//       EOF run: no input at all, nothing read, no fixture adopted.
//
//   node scripts/run-metric-compiler-adapter.mjs --contract <f> --pin <f> --channels <f> \
//       --applicability <f> --rows <f> [--dialect <d>] [--format JSON|IR|TABLE]
//       Every listed input is REQUIRED and is NEVER defaulted.
//
//   node scripts/run-metric-compiler-adapter.mjs ... --verify --binding <f>
//   node scripts/run-metric-compiler-adapter.mjs --negative
//
// This CLI WRITES NOTHING.

import { readFileSync } from 'node:fs';

import {
  ADAPTER_FORMATS,
  ADAPTER_INTERNALS,
  compileMetricAdapter,
  renderMetricAdapter,
  verifyMetricAdapter,
} from '../services/bi-control/src/business-bi/metric-compiler-adapter-v1.mjs';

const FD = 'tests/fixtures/business-bi/ks249-metric-compiler';
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const ROWS_PATH = 'tests/fixtures/business-bi/net-revenue-segment-v1.json';
const NOW = '2026-09-23T00:00:00.000Z';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
};
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readRows = (file) => {
  const parsed = readJson(file);
  return Array.isArray(parsed) ? parsed : parsed.rows;
};
const clone = (value) => JSON.parse(JSON.stringify(value));

function inputsFromArgs() {
  const pin = valueOf('--pin');
  const files = {
    contract: valueOf('--contract'), pin, channels: valueOf('--channels'),
    applicability: valueOf('--applicability'), rows: valueOf('--rows'),
  };
  const missing = Object.entries(files).filter(([, file]) => file === null).map(([key]) => key);
  if (missing.length > 0) {
    return { denial: { outcome: 'DENIED', code: 'KS249_COMPILER_DENIED:INPUT_REQUIRED', missing } };
  }
  const pinDoc = readJson(pin);
  return {
    contractBytes: readFileSync(files.contract),
    pinnedContractSha256: pinDoc.pinnedContractSha256,
    dialect: valueOf('--dialect') ?? pinDoc.dialect,
    channels: readJson(files.channels).channels,
    applicability: readJson(files.applicability).applicability,
    evidenceRevision: pinDoc.evidenceRevision,
    currentEvidenceRevision: pinDoc.evidenceRevision,
    referenceRows: readRows(files.rows),
    now: NOW,
  };
}

function receipt(plan) {
  return {
    outcome: 'COMPILED',
    metricId: plan.metricId,
    dialect: plan.dialect,
    evidenceRevision: plan.evidenceRevision,
    channels: plan.channels.map((entry) => ({ channelId: entry.channelId, kind: entry.kind })),
    channelKinds: [...new Set(plan.channels.map((entry) => entry.kind))].sort(),
    laws: plan.laws.length,
    unassessedLaws: plan.applicabilityCrossCheck.unassessedLaws,
    drift: plan.sourceDrift.detected,
    planDigest: plan.planDigest,
    roundTripDigest: plan.roundTripDigest,
    roundTripLossless: plan.planDigest === plan.roundTripDigest,
    bindingDigest: plan.bindingDigest,
    newRuntimeDependencies: 0,
  };
}

function runNegative() {
  const base = {
    contractBytes: readFileSync(CONTRACT_PATH),
    pinnedContractSha256: readJson(`${FD}/contract-pin-v1.json`).pinnedContractSha256,
    dialect: 'kaleidosphere-metric-ir/v1',
    channels: readJson(`${FD}/channels-v1.json`).channels,
    applicability: readJson(`${FD}/applicability-v1.json`).applicability,
    evidenceRevision: readJson(`${FD}/contract-pin-v1.json`).evidenceRevision,
    currentEvidenceRevision: readJson(`${FD}/contract-pin-v1.json`).evidenceRevision,
    referenceRows: readRows(ROWS_PATH),
    now: NOW,
  };
  const gates = [];
  const addGate = (name, expected, run) => gates.push({ name, expected, run });
  const resealContract = (mutate) => {
    const contract = clone(readJson(CONTRACT_PATH));
    mutate(contract);
    const bytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`);
    return { bytes, pinned: ADAPTER_INTERNALS.bytesSha256(bytes) };
  };

  addGate('eof-input-required', 'KS249_COMPILER_DENIED:INPUT_REQUIRED', () => compileMetricAdapter({ now: NOW }));
  addGate('drift-one-cent', 'KS249_COMPILER_DENIED:DRIFT_DETECTED', () => {
    const contract = clone(readJson(CONTRACT_PATH));
    contract.currency.minorUnitsPerMajorUnit = 101;
    return compileMetricAdapter({ ...base, contractBytes: Buffer.from(`${JSON.stringify(contract, null, 2)}\n`) });
  });
  addGate('drift-rule-change', 'KS249_COMPILER_DENIED:DRIFT_DETECTED', () => {
    const contract = clone(readJson(CONTRACT_PATH));
    contract.recordRules.credit.contribution = 'amount_minor_units added to the period net total';
    return compileMetricAdapter({ ...base, contractBytes: Buffer.from(`${JSON.stringify(contract, null, 2)}\n`) });
  });
  addGate('unsupported-dialect-sql', 'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT',
    () => compileMetricAdapter({ ...base, dialect: 'sql:postgres' }));
  addGate('unsupported-dialect-malloy', 'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT',
    () => compileMetricAdapter({ ...base, dialect: 'malloy' }));
  addGate('unsupported-dialect-unknown', 'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT',
    () => compileMetricAdapter({ ...base, dialect: 'dsl:something-else' }));
  addGate('floating-point-literal', 'KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT', () => {
    const resealed = resealContract((contract) => { contract.currency.minorUnitsPerMajorUnit = 100.5; });
    return compileMetricAdapter({ ...base, contractBytes: resealed.bytes, pinnedContractSha256: resealed.pinned });
  });
  addGate('contract-malformed-unknown-key', 'KS249_COMPILER_DENIED:CONTRACT_MALFORMED', () => {
    const resealed = resealContract((contract) => { contract.vendor = 'cubejs'; });
    return compileMetricAdapter({ ...base, contractBytes: resealed.bytes, pinnedContractSha256: resealed.pinned });
  });
  addGate('contract-malformed-floating-point-allowed', 'KS249_COMPILER_DENIED:CONTRACT_MALFORMED', () => {
    const resealed = resealContract((contract) => { contract.arithmetic.floatingPoint = 'permitted'; });
    return compileMetricAdapter({ ...base, contractBytes: resealed.bytes, pinnedContractSha256: resealed.pinned });
  });
  addGate('channel-malformed-denied-without-reason', 'KS249_COMPILER_DENIED:CHANNEL_MALFORMED',
    () => compileMetricAdapter({ ...base, channels: [{ channelId: 'channel:denied:x', kind: 'DENIED', reason: null }] }));
  addGate('channel-malformed-unknown-kind', 'KS249_COMPILER_DENIED:CHANNEL_MALFORMED',
    () => compileMetricAdapter({ ...base, channels: [{ channelId: 'channel:x', kind: 'PROBABLY_ZERO', reason: null }] }));
  addGate('applicability-malformed', 'KS249_COMPILER_DENIED:CHANNEL_MALFORMED',
    () => compileMetricAdapter({ ...base, applicability: [{ lawId: 'CANON-1', applicability: 'MAYBE' }] }));
  addGate('evidence-revision-stale', 'KS249_COMPILER_DENIED:EVIDENCE_REVISION_STALE',
    () => compileMetricAdapter({ ...base, evidenceRevision: 'ks249-compiler-observation-v0' }));
  addGate('contract-unreadable', 'KS249_COMPILER_DENIED:CONTRACT_UNREADABLE',
    () => compileMetricAdapter({ ...base, contractBytes: 12345 }));
  addGate('format-unsupported', 'KS249_COMPILER_DENIED:FORMAT_UNSUPPORTED', () => {
    const compiled = compileMetricAdapter(base);
    return renderMetricAdapter(compiled, 'CSV');
  });
  addGate('verify-binding-malformed', 'KS249_COMPILER_DENIED:SERIALIZED_BINDING_MALFORMED', () => {
    const compiled = compileMetricAdapter(base);
    return verifyMetricAdapter({ ...base, plan: compiled.plan, bindingDigest: 'not-a-digest' });
  });
  addGate('verify-drift-after-adoption', 'KS249_COMPILER_DENIED:DRIFT_DETECTED', () => {
    const compiled = compileMetricAdapter(base);
    const contract = clone(readJson(CONTRACT_PATH));
    contract.currency.minorUnitsPerMajorUnit = 99;
    return verifyMetricAdapter({
      ...base, contractBytes: Buffer.from(`${JSON.stringify(contract, null, 2)}\n`),
      plan: compiled.plan, bindingDigest: compiled.plan.bindingDigest,
    });
  });
  addGate('verify-dialect-substitution', 'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT', () => {
    const compiled = compileMetricAdapter(base);
    return verifyMetricAdapter({ ...base, dialect: 'sql:postgres', plan: compiled.plan, bindingDigest: compiled.plan.bindingDigest });
  });
  addGate('verify-resealed-plan', 'KS249_COMPILER_DENIED:SERIALIZED_EVIDENCE_MISMATCH', () => {
    const compiled = compileMetricAdapter(base);
    const resealed = clone(compiled.plan);
    resealed.channels = resealed.channels.filter((entry) => entry.kind === 'VALUE');
    return verifyMetricAdapter({ ...base, plan: resealed, bindingDigest: compiled.plan.bindingDigest });
  });

  let failures = 0;
  for (const gate of gates) {
    let observed;
    try { observed = gate.run(); } catch (error) { observed = { code: `THREW:${String(error?.message ?? error)}` }; }
    const ok = observed?.code === gate.expected;
    if (!ok) failures += 1;
    process.stdout.write(`gate=${gate.name.padEnd(42)} expected=${gate.expected} observed=${observed?.code} ${ok ? 'OK' : 'UNEXPECTEDLY_ACCEPTED'}\n`);
  }
  process.stdout.write(`negative gates: ${gates.length} executed, ${failures} unexpected\n`);
  process.exit(0);
}

if (args.length === 0) {
  process.stdout.write('mode=eof plan=null compiled=false newRuntimeDependencies=0\n');
  process.stdout.write('COMPILER-DENIED KS249_COMPILER_DENIED:INPUT_REQUIRED missing=contract,pin,channels,applicability,rows\n');
  process.exit(0);
}
if (has('--negative')) runNegative();

const loaded = inputsFromArgs();
if (loaded.denial) {
  process.stdout.write(`COMPILER-DENIED ${loaded.denial.code} missing=${(loaded.denial.missing ?? []).join(',')}\n`);
  process.exit(0);
}

if (has('--verify')) {
  const bindingFile = valueOf('--binding');
  if (bindingFile === null) {
    process.stdout.write('COMPILER-DENIED KS249_COMPILER_DENIED:INPUT_REQUIRED missing=binding\n');
    process.exit(0);
  }
  const carried = readJson(bindingFile);
  const verified = verifyMetricAdapter({ ...loaded, plan: carried, bindingDigest: carried.bindingDigest });
  process.stdout.write(`verify=${verified.outcome} code=${verified.code} planDigest=${verified.planDigest ?? null}\n`);
  process.exit(0);
}

const format = valueOf('--format') ?? 'TABLE';
if (!ADAPTER_FORMATS.includes(format)) {
  process.stdout.write(`COMPILER-DENIED KS249_COMPILER_DENIED:FORMAT_UNSUPPORTED format=${format}\n`);
  process.exit(0);
}
const compiled = compileMetricAdapter(loaded);
if (compiled.outcome !== 'COMPILED') {
  process.stdout.write(`COMPILER-DENIED ${compiled.code} ${JSON.stringify(compiled.missing ?? compiled.reason ?? compiled.detail ?? {})}\n`);
  process.exit(0);
}
const rendered = renderMetricAdapter(compiled, format);
process.stdout.write(rendered.text);
process.stdout.write(`COMPILER-RECEIPT ${JSON.stringify(receipt(compiled.plan))}\n`);
