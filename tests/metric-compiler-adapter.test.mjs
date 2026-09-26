// KaleidoSphere #249 (KS-EVO-04) — focused acceptance suite for the bounded metric-compiler
// adapter and its executable ADOPT-OR-REJECT decision.
//
// BOUNDARY DISCLOSURE: no external component is installed, executed or assumed compatible. The
// external alternatives are rejected on observed cost and on unverifiable compatibility, and a
// rejection is a decision with evidence — never an implemented capability.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  ADAPTER_DENIAL_CODES_V1,
  ADAPTER_FORMATS,
  ADAPTER_INTERNALS,
  ADAPTER_NONCLAIMS_V1,
  APPLICABILITY_V1,
  CHANNEL_KINDS_V1,
  DIALECT_REFUSALS_V1,
  METRIC_IR_SCHEMA,
  SUPPORTED_DIALECTS_V1,
  compileMetricAdapter,
  emitMetricIr,
  parseMetricIr,
  renderMetricAdapter,
  verifyMetricAdapter,
} from '../services/bi-control/src/business-bi/metric-compiler-adapter-v1.mjs';
import { PERIODS, canonicalJson } from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';

const FD = 'tests/fixtures/business-bi/ks249-metric-compiler';
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const ROWS_PATH = 'tests/fixtures/business-bi/net-revenue-segment-v1.json';
const MODULE_PATH = 'services/bi-control/src/business-bi/metric-compiler-adapter-v1.mjs';
const NOW = '2026-09-23T00:00:00.000Z';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const rowsFixture = () => readJson(ROWS_PATH).rows;
const sha = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value)), 'utf8').digest('hex');
const bytesSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contractBytes = () => readFileSync(CONTRACT_PATH);
const pin = () => readJson(`${FD}/contract-pin-v1.json`);

function baseInputs(overrides = {}) {
  return {
    contractBytes: contractBytes(),
    pinnedContractSha256: pin().pinnedContractSha256,
    dialect: pin().dialect,
    channels: readJson(`${FD}/channels-v1.json`).channels,
    applicability: readJson(`${FD}/applicability-v1.json`).applicability,
    evidenceRevision: pin().evidenceRevision,
    currentEvidenceRevision: pin().evidenceRevision,
    referenceRows: rowsFixture(),
    now: NOW,
    ...overrides,
  };
}
const compile = (overrides = {}) => compileMetricAdapter(baseInputs(overrides));
const resealedContract = (mutate) => {
  const contract = clone(readJson(CONTRACT_PATH));
  mutate(contract);
  const bytes = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`);
  return { bytes, pinned: bytesSha256(bytes) };
};

// ---------------------------------------------------------------------------
// AC01 — one demonstrated need, appropriate alternatives, a pinned version and license/dependency
// set.
// ---------------------------------------------------------------------------
test('KS249 AC01: the decision addresses ONE demonstrated need and pins version, license and dependency set for every candidate', () => {
  const decision = readJson(`${FD}/adopt-or-reject-decision-v1.json`);
  assert.match(decision.demonstratedNeed, /^metric compilation:/);
  assert.equal(decision.candidates.length, 3);
  const byId = Object.fromEntries(decision.candidates.map((entry) => [entry.candidateId, entry]));
  const adopted = byId['in-repo-bounded-metric-ir-adapter'];
  assert.equal(adopted.verdict, 'ADOPT');
  assert.equal(adopted.version, 'kaleidosphere-metric-ir/v1');
  assert.equal(adopted.dependencySet.newRuntimeDependencies, 0);
  for (const id of ['cubejs-server', 'malloy']) {
    const rejected = byId[id];
    assert.equal(rejected.kind, 'EXTERNAL_COMPONENT');
    assert.equal(rejected.verdict, 'REJECT');
    assert.ok(/^\d+\.\d+\.\d+$/.test(rejected.version), `${id} has no pinned version`);
    assert.ok(['Apache-2.0', 'MIT'].includes(rejected.license), `${id} has no observed license`);
    assert.ok(rejected.dependencySet.directDependencies > 0);
    assert.equal(rejected.vendorCompatibilityActuallyTested, false,
      `${id} claims tested vendor compatibility without an executed comparison`);
  }
  assert.equal(decision.verdict.startsWith('ADOPT the in-repo bounded metric-IR adapter'), true);
});

test('KS249 AC01: the decision numbers are the OBSERVED registry numbers and no license or version is invented', () => {
  const observations = readJson(`${FD}/registry-observations-v1.json`);
  const decision = readJson(`${FD}/adopt-or-reject-decision-v1.json`);
  assert.equal(decision.observationsDigest, observations.digest, 'the decision is not bound to the observation file');
  const { digest: _digest, ...observationBody } = observations;
  assert.equal(sha(observationBody), observations.digest, 'the observation digest does not re-derive');
  assert.equal(decision.observability.observedMetadataFile, 'registry-observations-v1.json');
  const observed = Object.fromEntries(observations.alternatives.map((entry) => [entry.package, entry]));
  for (const candidate of decision.candidates.filter((entry) => entry.kind === 'EXTERNAL_COMPONENT')) {
    const fact = observed[candidate.package];
    assert.equal(candidate.version, fact.distTagLatest, `${candidate.package} version differs from the observation`);
    assert.equal(candidate.license, fact.license, `${candidate.package} license differs from the observation`);
    assert.equal(candidate.dependencySet.directDependencies, fact.directDependencyCount);
    assert.equal(candidate.dependencySet.unpackedSizeBytes, fact.unpackedSizeBytes);
    assert.equal(fact.httpStatus, 200);
  }
});

// ---------------------------------------------------------------------------
// AC02 — mapped through the existing bounded contracts; no channel collapsed.
// ---------------------------------------------------------------------------
test('KS249 AC02: the compiled plan preserves UNKNOWN, DENIED, observed ABSENCE and VALUE as first-class channels', () => {
  const compiled = compile();
  assert.equal(compiled.outcome, 'COMPILED');
  const kinds = new Set(compiled.plan.channels.map((entry) => entry.kind));
  assert.ok(kinds.has('VALUE'));
  assert.ok(kinds.has('UNKNOWN'));
  assert.ok(kinds.has('DENIED'));
  for (const kind of kinds) assert.ok(CHANNEL_KINDS_V1.includes(kind));

  const unknown = compiled.plan.channels.find((entry) => entry.kind === 'UNKNOWN');
  const rows = rowsFixture();
  const expectedUnknown = rows.filter((row) => row.record_kind === 'unknown'
    || row.amount_minor_units === null || row.order_date === null);
  assert.equal(unknown.count, expectedUnknown.length);
  assert.equal(unknown.amountMinorUnits, expectedUnknown.reduce((sum, row) => sum
    + (Number.isInteger(row.amount_minor_units) ? row.amount_minor_units : 0), 0));
  assert.equal(unknown.count > 0, true, 'the UNKNOWN channel was collapsed to an empty value');

  const denied = compiled.plan.channels.find((entry) => entry.kind === 'DENIED');
  assert.ok(typeof denied.reason === 'string' && denied.reason.length > 0);
  for (const channel of compiled.plan.channels) {
    const hasDetail = Object.hasOwn(channel, 'count') || Object.hasOwn(channel, 'reason') || Object.hasOwn(channel, 'period');
    assert.equal(hasDetail, true, `${channel.channelId} was collapsed to an empty value`);
  }
  assert.match(compiled.plan.channelCollapsePolicy, /never collapsed to an empty value/);
});

test('KS249 AC02: an observed ABSENCE in a period is carried as OBSERVED_ABSENT with its reason, never as a missing key', () => {
  // Only current-window rows: the comparison window becomes an observed absence.
  const rows = rowsFixture().filter((row) => row.order_date !== null && row.order_date >= PERIODS.current.start);
  const compiled = compile({ referenceRows: rows });
  assert.equal(compiled.outcome, 'COMPILED');
  const absent = compiled.plan.channels.filter((entry) => entry.kind === 'OBSERVED_ABSENT');
  assert.equal(absent.length, 1, 'the empty comparison window was not carried as an observed absence');
  assert.equal(absent[0].period, 'comparison');
  assert.match(absent[0].reason, /no sale or credit row falls inside the 'comparison' window/);
  assert.equal(compiled.plan.channels.length > 3, true);
});

test('KS249 AC02: the evidence revision and the applicability record survive compilation without collapsing', () => {
  const compiled = compile();
  const plan = compiled.plan;
  assert.equal(plan.evidenceRevision, 'ks249-compiler-observation-v1');
  assert.equal(plan.evidenceRevision === '', false);
  assert.equal(plan.laws.length, 9);
  const canon8 = plan.laws.find((law) => law.lawId === 'CANON-8');
  assert.equal(canon8.applicability, 'NOT_APPLICABLE');
  assert.ok(canon8.admissionBasis.length > 0);
  const declaredOnly = plan.laws.find((law) => law.lawId === 'CANON-99');
  assert.equal(declaredOnly.applicability, 'UNASSESSED', 'an unassessed law was silently marked not-applicable');
  assert.equal(declaredOnly.declaredOutsideContract, true);
  assert.equal(plan.applicabilityCrossCheck.unassessedLaws.includes('CANON-99'), true);
  assert.deepEqual(plan.applicabilityCrossCheck.lawIdsInContractButNotDeclared, []);
  assert.equal(plan.applicabilityCrossCheck.lawIdsDeclaredButNotInContract.includes('CANON-99'), true);
  for (const law of plan.laws) assert.ok(APPLICABILITY_V1.includes(law.applicability));
});

// ---------------------------------------------------------------------------
// AC03 — actual dialects, numerical semantics, lossless bounded round-trip and source drift.
// ---------------------------------------------------------------------------
test('KS249 AC03: exactly one dialect compiles; every other dialect is refused by name with its recorded reason', () => {
  assert.deepEqual([...SUPPORTED_DIALECTS_V1], ['kaleidosphere-metric-ir/v1']);
  assert.equal(compile().plan.dialect, 'kaleidosphere-metric-ir/v1');
  for (const entry of DIALECT_REFUSALS_V1) {
    const refused = compile({ dialect: entry.dialect });
    assert.equal(refused.code, 'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT');
    assert.equal(refused.reason, entry.reason);
    assert.deepEqual(refused.supportedDialects, [...SUPPORTED_DIALECTS_V1]);
  }
  const unknown = compile({ dialect: 'dsl:something-else' });
  assert.equal(unknown.code, 'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT');
  assert.match(unknown.reason, /untested vendor compatibility is not assumed/);
});

test('KS249 AC03: numerical semantics are tested — integer minor units only, floating point and overflow refused', () => {
  const compiled = compile();
  assert.equal(compiled.plan.arithmetic.floatingPoint, 'forbidden');
  assert.equal(compiled.plan.arithmetic.unit, 'integer minor units (cents)');
  assert.equal(compiled.plan.currency.minorUnitsPerMajorUnit, 100);
  assert.equal(compiled.plan.currency.code, 'EUR');
  assert.equal(Number.isInteger(compiled.plan.currency.minorUnitsPerMajorUnit), true);

  const nonInteger = resealedContract((contract) => { contract.currency.minorUnitsPerMajorUnit = 100.5; });
  const refusedFloat = compile({ contractBytes: nonInteger.bytes, pinnedContractSha256: nonInteger.pinned });
  assert.equal(refusedFloat.code, 'KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT');
  assert.equal(refusedFloat.value, 100.5);

  const overflow = resealedContract((contract) => { contract.currency.minorUnitsPerMajorUnit = Number.MAX_SAFE_INTEGER + 2; });
  const refusedOverflow = compile({ contractBytes: overflow.bytes, pinnedContractSha256: overflow.pinned });
  assert.ok(['KS249_COMPILER_DENIED:REFUSED_OVERFLOW', 'KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT']
    .includes(refusedOverflow.code));

  const floatingAllowed = resealedContract((contract) => { contract.arithmetic.floatingPoint = 'permitted'; });
  assert.equal(compile({ contractBytes: floatingAllowed.bytes, pinnedContractSha256: floatingAllowed.pinned }).code,
    'KS249_COMPILER_DENIED:CONTRACT_MALFORMED');
});

test('KS249 AC03: the bounded import/export round-trip is lossless, and the compiled semantics match the released read path', () => {
  const compiled = compile();
  const emitted = emitMetricIr(compiled.plan);
  const reparsed = parseMetricIr(emitted);
  assert.equal(reparsed.outcome, 'PARSED');
  assert.equal(sha(reparsed.plan), compiled.plan.planDigest);
  assert.equal(compiled.plan.roundTripDigest, compiled.plan.planDigest);
  assert.equal(parseMetricIr('not json').code, 'KS249_COMPILER_DENIED:CONTRACT_MALFORMED');
  assert.equal(parseMetricIr('{"schemaVersion":"other"}').code, 'KS249_COMPILER_DENIED:CONTRACT_MALFORMED');

  // The compiled plan reproduces the released read path's declared periods, order-date role and
  // currency — the plan is contract-driven, and the contract agrees with the released module.
  assert.equal(compiled.plan.periods.current.start, PERIODS.current.start);
  assert.equal(compiled.plan.periods.current.end, PERIODS.current.end);
  assert.equal(compiled.plan.periods.comparison.start, PERIODS.comparison.start);
  assert.equal(compiled.plan.periods.comparison.end, PERIODS.comparison.end);
  assert.equal(compiled.plan.periods.current.boundary, 'inclusive-both-ends');
  assert.equal(compiled.plan.orderDateRole.column, 'order_date');
  assert.equal(compiled.plan.relation.name, 'synthetic_bi.orders');
});

test('KS249 AC03: source drift is detected against the pinned contract and never silently recompiled', () => {
  assert.equal(pin().pinnedContractSha256, bytesSha256(contractBytes()));
  const oneCent = resealedContract((contract) => { contract.currency.minorUnitsPerMajorUnit = 101; });
  const drifted = compile({ contractBytes: oneCent.bytes });
  assert.equal(drifted.code, 'KS249_COMPILER_DENIED:DRIFT_DETECTED');
  assert.equal(drifted.declared, pin().pinnedContractSha256);
  assert.equal(drifted.observed, oneCent.pinned);
  const resealed = compile({ contractBytes: oneCent.bytes, pinnedContractSha256: oneCent.pinned });
  assert.equal(resealed.outcome, 'COMPILED', 'a re-pinned contract should compile (the pin is an explicit authority)');
  const ruleChange = resealedContract((contract) => { contract.recordRules.cancel.contribution = 'amount_minor_units added to the period net total'; });
  assert.equal(compile({ contractBytes: ruleChange.bytes }).code, 'KS249_COMPILER_DENIED:DRIFT_DETECTED');
  assert.match(compile().plan.sourceDrift.policy, /never silently recompiled/);
});

// ---------------------------------------------------------------------------
// AC04 — integration/maintenance cost, positive and falsifying cases, rollback/migration.
// ---------------------------------------------------------------------------
test('KS249 AC04: the adopted adapter adds no runtime dependency, and its cost, positive cases, falsifying cases and rollback are recorded', () => {
  const decision = readJson(`${FD}/adopt-or-reject-decision-v1.json`);
  assert.ok(decision.positiveCases.length >= 4);
  assert.ok(decision.falsifyingCases.length >= 4);
  assert.match(decision.falsifyingCases.join(' '), /one-cent contract change is DRIFT_DETECTED/);
  assert.match(decision.rollbackAndMigration.rollback, /plain revert/);
  assert.match(decision.rollbackAndMigration.migrationToAnExternalCompiler, /deferred, not preapproved/);
  assert.equal(decision.observability.boundByDigest, true);
  assert.ok(decision.nonclaims.some((entry) => /not a claim that the rejected component is defective/.test(entry)));

  // The dependency claim is checked against the source: only node: builtins and in-repo modules.
  const source = readFileSync(MODULE_PATH, 'utf8');
  const specifiers = [...source.matchAll(/from '([^']+)'/g)].map((match) => match[1]);
  assert.ok(specifiers.length >= 2);
  for (const specifier of specifiers) {
    assert.equal(specifier.startsWith('node:') || specifier.startsWith('./'), true,
      `the adapter imports the external specifier ${specifier}`);
  }
  const packageJson = readJson('package.json');
  assert.equal(Object.keys(packageJson.dependencies ?? {}).some((name) => /cubejs|malloy/.test(name)), false);
  assert.ok(ADAPTER_NONCLAIMS_V1.some((entry) => /No vendor adoption/.test(entry)));
});

// ---------------------------------------------------------------------------
// The checker, rendering and the CLI.
// ---------------------------------------------------------------------------
test('KS249: the checker re-derives the carried plan exactly and refuses substitution, drift and a resealed plan', () => {
  const compiled = compile();
  const verified = verifyMetricAdapter({ ...baseInputs(), plan: compiled.plan, bindingDigest: compiled.plan.bindingDigest });
  assert.equal(verified.outcome, 'VERIFIED');
  assert.equal(verified.planDigest, compiled.plan.planDigest);

  const rows = rowsFixture();
  rows[0].amount_minor_units += 1;
  assert.equal(verifyMetricAdapter({ ...baseInputs(), referenceRows: rows, plan: compiled.plan, bindingDigest: compiled.plan.bindingDigest }).outcome,
    'VERIFIED', 'a source change is a different compilation, not a digest forgery');

  const resealed = clone(compiled.plan);
  resealed.channels = resealed.channels.filter((entry) => entry.kind === 'VALUE');
  assert.equal(verifyMetricAdapter({ ...baseInputs(), plan: resealed, bindingDigest: compiled.plan.bindingDigest }).code,
    'KS249_COMPILER_DENIED:SERIALIZED_EVIDENCE_MISMATCH');

  const staleRevision = verifyMetricAdapter({
    ...baseInputs({ evidenceRevision: 'ks249-compiler-observation-v0' }),
    plan: compiled.plan, bindingDigest: compiled.plan.bindingDigest,
  });
  assert.equal(staleRevision.code, 'KS249_COMPILER_DENIED:EVIDENCE_REVISION_STALE');
  assert.equal(verifyMetricAdapter({ ...baseInputs(), plan: compiled.plan, bindingDigest: 'x'.repeat(64) }).code,
    'KS249_COMPILER_DENIED:SERIALIZED_BINDING_MISMATCH');
});

test('KS249: JSON, IR and TABLE render the plan; an unsupported format is refused; every declared denial code is reachable', () => {
  const compiled = compile();
  for (const format of ADAPTER_FORMATS) {
    const rendered = renderMetricAdapter(compiled, format);
    assert.equal(rendered.outcome, 'RENDERED');
    assert.ok(rendered.text.length > 0);
  }
  assert.match(renderMetricAdapter(compiled, 'TABLE').text, /drift=false/);
  assert.equal(renderMetricAdapter(compiled, 'CSV').code, 'KS249_COMPILER_DENIED:FORMAT_UNSUPPORTED');
  const reachable = new Set(['INPUT_REQUIRED', 'CONTRACT_UNREADABLE', 'CONTRACT_MALFORMED', 'DRIFT_DETECTED',
    'UNSUPPORTED_DIALECT', 'REFUSED_FLOATING_POINT', 'REFUSED_OVERFLOW', 'EVIDENCE_REVISION_STALE',
    'CHANNEL_COLLAPSED', 'CHANNEL_MALFORMED', 'ROUND_TRIP_LOSSY', 'SERIALIZED_BINDING_MISMATCH',
    'SERIALIZED_BINDING_MALFORMED', 'SERIALIZED_EVIDENCE_MISMATCH', 'FORMAT_UNSUPPORTED', 'PROJECTION_FAILED']);
  for (const code of ADAPTER_DENIAL_CODES_V1) {
    assert.equal(reachable.has(code.replace('KS249_COMPILER_DENIED:', '')), true, `${code} is not accounted for`);
  }
  assert.equal(compiled.plan.schemaVersion, METRIC_IR_SCHEMA);
});

const CLI = 'scripts/run-metric-compiler-adapter.mjs';
const runCli = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const cliArgs = () => ['--contract', CONTRACT_PATH, '--pin', `${FD}/contract-pin-v1.json`,
  '--channels', `${FD}/channels-v1.json`, '--applicability', `${FD}/applicability-v1.json`, '--rows', ROWS_PATH];

test('KS249 CLI: EOF compiles nothing, the real run compiles, --verify re-derives and no implicit default is adopted', () => {
  const eof = runCli([]);
  assert.match(eof, /mode=eof plan=null compiled=false newRuntimeDependencies=0/);
  assert.match(eof, /COMPILER-DENIED KS249_COMPILER_DENIED:INPUT_REQUIRED missing=contract,pin,channels,applicability,rows/);

  const out = runCli([...cliArgs(), '--format', 'TABLE']);
  assert.match(out, /metricId=bi-ks-01-net-revenue dialect=kaleidosphere-metric-ir\/v1/);
  assert.match(out, /channel:unknown\s+UNKNOWN\s+count=2 amount=900/);
  assert.match(out, /channel:denied:customer-detail\s+DENIED/);
  assert.match(out, /"roundTripLossless":true/);
  assert.match(out, /"newRuntimeDependencies":0/);
  assert.match(out, /"unassessedLaws":\["CANON-99"\]/);

  const partial = runCli(['--contract', CONTRACT_PATH]);
  assert.match(partial, /missing=pin,channels,applicability,rows/);
  const unsupported = runCli([...cliArgs(), '--dialect', 'sql:postgres']);
  assert.match(unsupported, /COMPILER-DENIED KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT/);

  const scratch = mkdtempSync(path.join(tmpdir(), 'ks249-plan-'));
  try {
    const compiledOut = runCli([...cliArgs(), '--format', 'JSON']);
    const plan = JSON.parse(compiledOut.slice(0, compiledOut.indexOf('\nCOMPILER-RECEIPT')));
    const bindingFile = path.join(scratch, 'plan.json');
    writeFileSync(bindingFile, JSON.stringify(plan, null, 2));
    const verified = runCli([...cliArgs(), '--verify', '--binding', bindingFile]);
    assert.match(verified, /verify=VERIFIED code=OK/);
    assert.ok(verified.includes(plan.planDigest));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  const negative = runCli(['--negative']);
  assert.match(negative, /negative gates: 19 executed, 0 unexpected/);
  assert.equal(negative.includes('UNEXPECTEDLY_ACCEPTED'), false);
});

// ---------------------------------------------------------------------------
// RED/GREEN.
// ---------------------------------------------------------------------------
const MODULE_SRC = MODULE_PATH;
const MODULE_DIR = path.dirname(MODULE_SRC);
const moduleUrl = (relative) => pathToFileURL(path.resolve(process.cwd(), relative)).href;

async function driveVariant(name, mutate, drive) {
  const variantPath = `${MODULE_DIR}/.ks249-variant-${name}.mjs`;
  const original = readFileSync(MODULE_SRC, 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, `variant ${name} did not change the source`);
  writeFileSync(variantPath, mutated);
  try {
    const variant = await import(moduleUrl(variantPath));
    try { return { threw: null, value: drive(variant) }; }
    catch (error) { return { threw: String(error?.message ?? error), value: null }; }
  } finally {
    rmSync(variantPath, { force: true });
    assert.equal(existsSync(variantPath), false, `variant ${name} was left on disk`);
  }
}

test('KS249 RED/GREEN: without the drift check a one-cent contract change is compiled on the variant', async () => {
  const oneCent = resealedContract((contract) => { contract.currency.minorUnitsPerMajorUnit = 101; });
  const red = await driveVariant(
    'no-drift-check',
    (source) => source.replace(
      '    if (observedContractSha256 !== pinnedContractSha256) {',
      '    if (false && observedContractSha256 !== pinnedContractSha256) {'),
    (variant) => variant.compileMetricAdapter(baseInputs({ contractBytes: oneCent.bytes })),
  );
  assert.equal(red.threw, null);
  assert.equal(red.value.outcome, 'COMPILED');
  assert.notEqual(red.value.code, 'KS249_COMPILER_DENIED:DRIFT_DETECTED');
  assert.equal(compile({ contractBytes: oneCent.bytes }).code, 'KS249_COMPILER_DENIED:DRIFT_DETECTED');
});

test('KS249 RED/GREEN: without the dialect gate an unsupported dialect is compiled on the variant', async () => {
  const red = await driveVariant(
    'no-dialect-gate',
    (source) => source.replace(
      '    if (!inSet(SUPPORTED_DIALECTS_V1, dialect)) {',
      '    if (false && !inSet(SUPPORTED_DIALECTS_V1, dialect)) {'),
    (variant) => variant.compileMetricAdapter(baseInputs({ dialect: 'sql:postgres' })),
  );
  assert.equal(red.threw, null);
  assert.equal(red.value.outcome, 'COMPILED');
  assert.equal(red.value.plan.dialect, 'sql:postgres');
  assert.equal(compile({ dialect: 'sql:postgres' }).code, 'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT');
});

test('KS249 RED/GREEN: without the numeric-semantics check a floating-point contract is compiled on the variant', async () => {
  const floating = resealedContract((contract) => { contract.currency.minorUnitsPerMajorUnit = 100.5; });
  const red = await driveVariant(
    'no-numeric-semantics',
    (source) => source
      .replace(
        '      if (!Number.isInteger(literal.value)) {',
        '      if (false && !Number.isInteger(literal.value)) {')
      .replace(
        '      if (!Number.isSafeInteger(literal.value)) {',
        '      if (false && !Number.isSafeInteger(literal.value)) {')
      .replace(
        '    if (!Number.isInteger(contract.currency.minorUnitsPerMajorUnit) || contract.currency.minorUnitsPerMajorUnit < 1) {',
        '    if (false) {'),
    (variant) => variant.compileMetricAdapter(baseInputs({ contractBytes: floating.bytes, pinnedContractSha256: floating.pinned })),
  );
  assert.equal(red.threw, null);
  assert.notEqual(red.value.code, 'KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT');
  assert.equal(red.value.outcome, 'COMPILED');
  assert.equal(compile({ contractBytes: floating.bytes, pinnedContractSha256: floating.pinned }).code,
    'KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT');
});

test('KS249 RED/GREEN: without the collapse guard a channel without detail is carried on the variant', async () => {
  const red = await driveVariant(
    'no-collapse-guard',
    (source) => source.replace(
      '    if (collapsed.length > 0) {',
      '    if (false && collapsed.length > 0) {'),
    (variant) => variant.compileMetricAdapter(baseInputs({
      channels: [{ channelId: 'channel:denied:bare', kind: 'DENIED', reason: null }],
    })),
  );
  assert.equal(red.threw, null);
  assert.notEqual(red.value.code, 'KS249_COMPILER_DENIED:CHANNEL_COLLAPSED');
  assert.equal(compile({ channels: [{ channelId: 'channel:denied:bare', kind: 'DENIED', reason: null }] }).code,
    'KS249_COMPILER_DENIED:CHANNEL_MALFORMED');
});

test('KS249 RED/GREEN: a CLI that IMPLICITLY defaults --pin is RED through the real entry point', () => {
  const variantCli = 'scripts/.ks249-variant-cli-implicit-pin.mjs';
  const original = readFileSync(CLI, 'utf8');
  const mutated = original.replace(
    "    contract: valueOf('--contract'), pin, channels: valueOf('--channels'),",
    "    contract: valueOf('--contract'), pin: pin ?? `${FD}/contract-pin-v1.json`, channels: valueOf('--channels'),");
  assert.notEqual(mutated, original, 'the CLI variant did not change the source');
  writeFileSync(variantCli, mutated);
  try {
    const out = execFileSync(process.execPath, [variantCli, '--contract', CONTRACT_PATH], { encoding: 'utf8' });
    assert.match(out, /COMPILER-DENIED KS249_COMPILER_DENIED:INPUT_REQUIRED/);
    assert.equal(/missing=[^\n]*pin/.test(out), false,
      'the broken CLI still reported the implicitly defaulted pin input as missing');
  } finally {
    rmSync(variantCli, { force: true });
    assert.equal(existsSync(variantCli), false);
  }
  assert.match(runCli(['--contract', CONTRACT_PATH]), /missing=pin,channels,applicability,rows/);
});
