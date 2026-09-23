// KaleidoSphere #250 (KS-EVO-05) — focused acceptance suite for the credential-free read-only
// metric pilot protocol and its synthetic rehearsal.
//
// BOUNDARY DISCLOSURE: this slice PREPARES a protocol and REHEARSES it on the existing
// installable path. No real source is connected or read, no real permission exists locally and
// no human reader answer is manufactured. `realPilotExecuted` is asserted to be false everywhere
// in this suite, and a rehearsal is asserted to be uncallable as a real pilot.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  DECLARATION_CLASSES_V1,
  EVIDENCE_CLASSES_V1,
  FIELD_KINDS_V1,
  PERMISSION_STATES_V1,
  PILOT_FORMATS,
  PILOT_INTERNALS,
  TIMING_KEYS_V1,
  buildReadOnlyMetricPilot,
  renderReadOnlyMetricPilot,
  verifyReadOnlyMetricPilot,
} from '../services/bi-control/src/business-bi/read-only-metric-pilot-protocol-v1.mjs';

const FD = 'tests/fixtures/business-bi/ks250-metric-pilot';
const ROWS_PATH = 'tests/fixtures/business-bi/net-revenue-segment-v1.json';
const CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
const NOW = '2026-09-23T00:00:00.000Z';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const rowsFixture = () => readJson(ROWS_PATH).rows;
const bytesSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const resealProtocol = (protocol) => {
  const { digest: _ignored, ...body } = protocol;
  return { ...body, digest: PILOT_INTERNALS.sha256(body) };
};

function pilot(overrides = {}) {
  return buildReadOnlyMetricPilot({
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: readJson(`${FD}/contexts-v1.json`),
    explanations: readJson(`${FD}/explanations-empty-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`),
    rows: rowsFixture(),
    now: NOW,
    ...overrides,
  });
}

function authorizedPilot(overrides = {}) {
  return buildReadOnlyMetricPilot({
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: readJson(`${FD}/contexts-authorized-rehearsal-v1.json`),
    explanations: readJson(`${FD}/explanations-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`),
    rows: rowsFixture(),
    now: NOW,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// AC01 — the credential-free protocol, data minimization, the source/identity/permission
// contract and the synthetic rehearsal on the existing installable path.
// ---------------------------------------------------------------------------
test('KS250 AC01: the frozen protocol is digest-bound, credential-free, field-minimized and forbids row-level reading', () => {
  const protocol = readJson(`${FD}/protocol-v1.json`);
  const { digest, ...body } = protocol;
  assert.equal(PILOT_INTERNALS.sha256(body), digest, 'the protocol digest does not re-derive');
  assert.equal(protocol.credentialPolicy.credentialFree, true);
  assert.deepEqual(protocol.credentialPolicy.allowedAuthentication, ['NONE']);
  assert.equal(protocol.dataMinimization.rowLevelPermitted, false);
  for (const kind of protocol.dataMinimization.allowedFieldKinds) assert.ok(FIELD_KINDS_V1.includes(kind));
  for (const forbidden of ['PERSON', 'CONTACT', 'CREDENTIAL', 'FREE_TEXT']) {
    assert.ok(protocol.dataMinimization.forbiddenFieldKinds.includes(forbidden));
  }
  const result = pilot();
  assert.equal(result.outcome, 'PREPARED');
  assert.equal(result.credentialPolicy.credentialsAccepted, false);
  assert.equal(result.dataMinimization.rowLevelReadPerformed, false);
  const tampered = resealProtocol({ ...clone(protocol), dataMinimization: { ...protocol.dataMinimization, rowLevelPermitted: true } });
  assert.equal(pilot({ protocol: tampered }).code, 'KS250_PILOT_DENIED:PROTOCOL_FORBIDS_ROW_LEVEL');
});

test('KS250 AC01: the metric contract is re-digested by the module itself, and a substituted contract is refused', () => {
  const protocol = readJson(`${FD}/protocol-v1.json`);
  assert.equal(protocol.metric.contractSha256, bytesSha256(readFileSync(CONTRACT_PATH)),
    'the protocol metric contract digest does not match the released metric contract');
  const substituted = resealProtocol({
    ...clone(protocol),
    metric: { ...protocol.metric, contractSha256: bytesSha256('substituted metric contract') },
  });
  const refused = pilot({ protocol: substituted });
  assert.equal(refused.code, 'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH');
  assert.equal(refused.declared, bytesSha256('substituted metric contract'));
  assert.equal(refused.observed, bytesSha256(readFileSync(CONTRACT_PATH)));
});

test('KS250 AC01: a credential field or a raw person payload anywhere in an input is refused, and nothing credential-shaped is exported', () => {
  const contexts = clone(readJson(`${FD}/contexts-v1.json`));
  contexts.contexts[0].connectionString = 'host=example;user=reader';
  assert.equal(pilot({ contexts }).code, 'KS250_PILOT_DENIED:CREDENTIAL_FIELD_PRESENT');
  const contexts2 = clone(readJson(`${FD}/contexts-v1.json`));
  contexts2.contexts[0].accessToken = 'abc';
  assert.equal(pilot({ contexts: contexts2 }).code, 'KS250_PILOT_DENIED:CREDENTIAL_FIELD_PRESENT');
  const explanations = clone(readJson(`${FD}/explanations-v1.json`));
  explanations.explanations[0].readerName = 'Jane Doe';
  assert.equal(pilot({ explanations }).code, 'KS250_PILOT_DENIED:RAW_PERSON_PAYLOAD_INCLUDED');

  const serialized = JSON.stringify(pilot());
  for (const forbidden of ['connectionString', 'accessToken', 'readerName', 'password']) {
    assert.equal(serialized.includes(forbidden), false, `the pilot leaked ${forbidden}`);
  }
});

test('KS250 AC01: the rehearsal runs the released read path and is labelled a synthetic rehearsal, never a pilot', () => {
  const result = pilot();
  assert.equal(result.contexts.length, 2);
  for (const entry of result.contexts) {
    assert.equal(entry.rehearsal.evidenceClass, 'SYNTHETIC_REHEARSAL');
    assert.equal(entry.rehearsal.realPilot, false);
    assert.equal(entry.rehearsal.callableAsRealPilot, false);
    assert.equal(entry.rehearsal.executed, true);
    assert.equal(entry.rehearsal.rowLevelReadPerformed, false);
    assert.equal(entry.rehearsal.rowsRead, rowsFixture().length);
    assert.match(entry.rehearsal.disclosedBoundary, /not a real read-only pilot/i);
  }
  // The rehearsed numbers are the released net over the synthetic rows, derived independently.
  const released = readJson(ROWS_PATH).rows;
  const sale = released.filter((r) => r.record_kind === 'sale' && r.order_date >= '2026-07-01' && r.order_date <= '2026-07-31')
    .reduce((sum, r) => sum + r.amount_minor_units, 0);
  const credit = released.filter((r) => r.record_kind === 'credit' && r.order_date >= '2026-07-01' && r.order_date <= '2026-07-31')
    .reduce((sum, r) => sum + r.amount_minor_units, 0);
  assert.equal(result.contexts[0].rehearsal.numbers.currentNetMinorUnits, sale - credit);
  assert.equal(result.realPilotExecuted, false);
  assert.equal(result.qualifiedContextCount, 0);
  assert.equal(result.blockedContextCount, 2);
});

test('KS250 AC01: every required input has no default and no implicit fixture adoption', () => {
  const required = ['protocol', 'contexts', 'explanations', 'rows', 'sourceIdentity'];
  for (const key of required) {
    const input = {
      protocol: readJson(`${FD}/protocol-v1.json`), contexts: readJson(`${FD}/contexts-v1.json`),
      explanations: readJson(`${FD}/explanations-empty-v1.json`),
      rows: rowsFixture(), sourceIdentity: readJson(`${FD}/source-identity-v1.json`), now: NOW,
    };
    delete input[key];
    const refused = buildReadOnlyMetricPilot(input);
    assert.equal(refused.code, 'KS250_PILOT_DENIED:INPUT_REQUIRED', `${key} was silently defaulted`);
    assert.ok(refused.missing.includes(key));
  }
  assert.equal(buildReadOnlyMetricPilot().code, 'KS250_PILOT_DENIED:INPUT_REQUIRED');
});

// ---------------------------------------------------------------------------
// AC02 — permission is required per real context; lacking it stays BLOCKED_EXTERNAL and the
// rehearsal is never called a real pilot.
// ---------------------------------------------------------------------------
test('KS250 AC02: a context without its own explicit permission stays BLOCKED_EXTERNAL by name', () => {
  const result = pilot();
  for (const entry of result.contexts) {
    assert.equal(entry.permissionState, 'MISSING');
    assert.equal(entry.realPilotStatus, 'BLOCKED_EXTERNAL');
    assert.equal(entry.blockedCode, 'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING');
    assert.match(entry.blockedReason, /a synthetic rehearsal is not a pilot/);
    assert.equal(entry.realPilot, false);
    assert.equal(entry.explanation, null);
    assert.equal(entry.readiness, 'PREPARED_ONLY');
    // The rehearsal still exists for preparation — and it is explicitly not a pilot.
    assert.equal(entry.rehearsal.evidenceClass, 'SYNTHETIC_REHEARSAL');
    assert.equal(entry.rehearsal.callableAsRealPilot, false);
  }
  assert.equal(result.realPilotExecuted, false);
  assert.equal(result.secondContextReuse.state, 'BLOCKED_EXTERNAL');
  assert.equal(result.secondContextReuse.code, 'KS250_PILOT_BLOCKED_EXTERNAL:SECOND_CONTEXT_NOT_PERMITTED');
});

test('KS250 AC02: a REVOKED permission is refused with its own code, and a substituted rehearsal source is refused', () => {
  const contexts = clone(readJson(`${FD}/contexts-v1.json`));
  contexts.contexts[0].permission = { state: 'REVOKED', permissionId: null, grantedAt: null, scopeNote: null };
  const revoked = pilot({ contexts });
  assert.equal(revoked.contexts[0].blockedCode, 'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_REVOKED');
  assert.equal(revoked.realPilotExecuted, false);

  const mutatedRows = rowsFixture();
  mutatedRows[0].amount_minor_units += 1;
  const substituted = pilot({ rows: mutatedRows });
  assert.equal(substituted.code, 'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED');
  const notCredentialFree = pilot({ sourceIdentity: { ...readJson(`${FD}/source-identity-v1.json`), retainedCredentialFree: false } });
  assert.equal(notCredentialFree.code, 'KS250_PILOT_DENIED:CONTEXTS_MALFORMED');
});

test('KS250 AC02: a granted permission still cannot qualify without a declared human reading', () => {
  const result = authorizedPilot();
  for (const entry of result.contexts) {
    assert.equal(entry.permissionState, 'GRANTED');
    assert.equal(entry.realPilotStatus, 'CONTRACT_LEVEL_ONLY');
    assert.equal(entry.realPilot, false);
    assert.equal(entry.evidenceClass, null);
    assert.equal(entry.contractLevelEvidenceClass, 'AUTHORED_TEST_INPUT');
    assert.equal(entry.explanation.humanComprehensionEvidence, false);
    assert.equal(entry.readiness, 'CONTRACT_LEVEL_ONLY');
  }
  assert.equal(result.realPilotExecuted, false);
  assert.equal(result.qualifiedContextCount, 0);
  assert.ok(EVIDENCE_CLASSES_V1.includes('REAL_READ_ONLY_PILOT'));
});

// ---------------------------------------------------------------------------
// AC03 — independent metric confirmation, declared reader explanations only, measured-time
// contract.
// ---------------------------------------------------------------------------
test('KS250 AC03: a SIMULATED reader answer is refused, and an explanation for an ungranted context is refused', () => {
  const simulated = clone(readJson(`${FD}/explanations-v1.json`));
  simulated.explanations[0].answerSource = 'SIMULATED';
  const refused = authorizedPilot({ explanations: simulated });
  assert.equal(refused.code, 'KS250_PILOT_DENIED:SIMULATED_READER_ANSWER');
  assert.equal(refused.contextId, 'context:first-read-only-source');

  const contexts = clone(readJson(`${FD}/contexts-authorized-rehearsal-v1.json`));
  contexts.contexts[1].permission = { state: 'MISSING', permissionId: null, grantedAt: null, scopeNote: null };
  const ungranted = authorizedPilot({ contexts });
  assert.equal(ungranted.code, 'KS250_PILOT_DENIED:READER_EXPLANATION_FOR_UNGRANTED_CONTEXT');
  assert.equal(ungranted.permissionState, 'MISSING');

  // No explanation at all is never inferred: the context stays PREPARED_ONLY.
  const noExplanation = buildReadOnlyMetricPilot({
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: readJson(`${FD}/contexts-authorized-rehearsal-v1.json`),
    explanations: readJson(`${FD}/explanations-empty-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`),
    rows: rowsFixture(),
    now: NOW,
  });
  for (const entry of noExplanation.contexts) {
    assert.equal(entry.readiness, 'PREPARED_ONLY');
    assert.equal(entry.explanation, null);
    assert.match(entry.blockedReason, /no answer is ever inferred/);
  }
  assert.equal(noExplanation.realPilotExecuted, false);
});

test('KS250 AC03: an unmeasured duration stays null with an UNKNOWN reason and is never a zero', () => {
  const result = authorizedPilot();
  for (const entry of result.contexts) {
    for (const key of TIMING_KEYS_V1) {
      assert.equal(entry.timings[key], null, `${key} was invented`);
    }
    assert.deepEqual(entry.unmeasuredTimings, [...TIMING_KEYS_V1]);
    assert.match(entry.unmeasuredTimingReason, /^UNKNOWN: not measured for /);
  }
  // A declared negative duration is refused rather than coerced.
  const bad = clone(readJson(`${FD}/explanations-v1.json`));
  bad.explanations[0].timings.setupMs = -1;
  assert.equal(authorizedPilot({ explanations: bad }).code, 'KS250_PILOT_DENIED:EXPLANATIONS_MALFORMED');
  assert.ok(DECLARATION_CLASSES_V1.includes('HUMAN_READING'));
  assert.ok(PERMISSION_STATES_V1.includes('GRANTED'));
});

// ---------------------------------------------------------------------------
// AC04 — reuse in a second, independently permitted context; no generalization.
// ---------------------------------------------------------------------------
test('KS250 AC04: the second context needs its own permission, and the reuse finding is CONTRACT_LEVEL_ONLY without it', () => {
  const reuse = authorizedPilot().secondContextReuse;
  assert.equal(reuse.state, 'CONTRACT_LEVEL_ONLY');
  assert.equal(reuse.firstContextId, 'context:first-read-only-source');
  assert.equal(reuse.secondContextId, 'context:second-read-only-source');
  assert.match(reuse.reason, /AUTHORED_TEST_INPUT/);
  assert.equal(reuse.comparativeFindings, null);
  assert.equal(reuse.additionalMappingCodeLines, null);

  const blocked = pilot().secondContextReuse;
  assert.equal(blocked.state, 'BLOCKED_EXTERNAL');
  assert.equal(blocked.comparativeFindings, null);
  assert.equal(pilot().generalizationClaim, 'NOT_PERMITTED');

  // A single-context slice is NOT_ATTEMPTED rather than a fabricated reuse result.
  const single = buildReadOnlyMetricPilot({
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: { ...readJson(`${FD}/contexts-v1.json`), contexts: [readJson(`${FD}/contexts-v1.json`).contexts[0]] },
    explanations: readJson(`${FD}/explanations-empty-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`),
    rows: rowsFixture(), now: NOW,
  });
  assert.equal(single.secondContextReuse.state, 'NOT_ATTEMPTED');
  assert.equal(single.generalizationClaim, 'NOT_PERMITTED');
});

// ---------------------------------------------------------------------------
// The checker, rendering and the CLI.
// ---------------------------------------------------------------------------
test('KS250: the checker re-derives the carried binding exactly and refuses a resealed or substituted package', () => {
  const base = {
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: readJson(`${FD}/contexts-authorized-rehearsal-v1.json`),
    explanations: readJson(`${FD}/explanations-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`),
    rows: rowsFixture(), now: NOW,
  };
  const result = buildReadOnlyMetricPilot(base);
  const verified = verifyReadOnlyMetricPilot({ ...base, pilot: result, bindingDigest: result.bindingDigest });
  assert.equal(verified.outcome, 'VERIFIED');
  assert.equal(verified.realPilotExecuted, false);
  assert.equal(verified.qualifiedContextCount, 0);

  const resealed = clone(result);
  resealed.binding.realPilotExecuted = true;
  assert.equal(verifyReadOnlyMetricPilot({ ...base, pilot: resealed, bindingDigest: result.bindingDigest }).code,
    'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH');

  const mutatedRows = rowsFixture();
  mutatedRows[0].amount_minor_units += 1;
  assert.equal(verifyReadOnlyMetricPilot({ ...base, rows: mutatedRows, pilot: result, bindingDigest: result.bindingDigest }).code,
    'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED');

  const regranted = clone(readJson(`${FD}/contexts-v1.json`));
  regranted.contexts[0].permission = {
    state: 'GRANTED', permissionId: 'permission:ks250-late-grant', grantedAt: NOW, scopeNote: 'late grant',
  };
  assert.equal(verifyReadOnlyMetricPilot({ ...base, contexts: regranted, pilot: result, bindingDigest: result.bindingDigest }).code,
    'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED');
});

test('KS250: JSON and TABLE render the package; an unsupported format is refused', () => {
  for (const format of PILOT_FORMATS) {
    const rendered = renderReadOnlyMetricPilot(authorizedPilot(), format);
    assert.equal(rendered.outcome, 'RENDERED');
    assert.ok(rendered.text.includes('CONTRACT_LEVEL_ONLY') || format === 'JSON');
  }
  const table = renderReadOnlyMetricPilot(authorizedPilot(), 'TABLE');
  assert.match(table.text, /realPilotExecuted=false/);
  assert.match(table.text, /generalizationClaim=NOT_PERMITTED/);
  assert.equal(renderReadOnlyMetricPilot(authorizedPilot(), 'CSV').code, 'KS250_PILOT_DENIED:FORMAT_UNSUPPORTED');
});

const CLI = 'scripts/run-read-only-metric-pilot.mjs';
const runCli = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
const cliArgs = (contextsFile, explanationsFile) => [
  '--protocol', `${FD}/protocol-v1.json`, '--contexts', `${FD}/${contextsFile}`,
  '--explanations', `${FD}/${explanationsFile}`, '--source-identity', `${FD}/source-identity-v1.json`,
  '--source-rows', ROWS_PATH,
];

test('KS250 CLI: EOF prepares nothing, and the honest local state is BLOCKED_EXTERNAL with no real pilot', () => {
  const eof = runCli([]);
  assert.match(eof, /mode=eof pilot=null realPilotExecuted=false/);
  assert.match(eof, /PILOT-DENIED KS250_PILOT_DENIED:INPUT_REQUIRED/);
  assert.match(eof, /missing=protocol,contexts,explanations,sourceIdentity,rows/);

  const out = runCli([...cliArgs('contexts-v1.json', 'explanations-empty-v1.json'), '--format', 'TABLE']);
  assert.match(out, /PILOT-RECEIPT \{/);
  assert.match(out, /"realPilotExecuted":false/);
  assert.match(out, /"qualifiedContextCount":0/);
  assert.match(out, /KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING/);
  assert.match(out, /"secondContextReuse":"BLOCKED_EXTERNAL"/);
  assert.match(out, /generalizationClaim=NOT_PERMITTED/);
  assert.match(out, /"credentialsAccepted":false/);
  assert.match(out, /"rowLevelReadPerformed":false/);

  const authorized = runCli([...cliArgs('contexts-authorized-rehearsal-v1.json', 'explanations-v1.json'), '--format', 'TABLE']);
  assert.match(authorized, /"realPilotExecuted":false/);
  assert.match(authorized, /"realPilotStatus":"CONTRACT_LEVEL_ONLY"/);
  assert.match(authorized, /"secondContextReuse":"CONTRACT_LEVEL_ONLY"/);

  const partial = runCli(['--protocol', `${FD}/protocol-v1.json`]);
  assert.match(partial, /missing=contexts,explanations,sourceIdentity,rows/);
});

test('KS250 CLI: --verify re-derives the binding, and the negative gates all report their exact code', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'ks250-binding-'));
  try {
    const out = runCli([...cliArgs('contexts-authorized-rehearsal-v1.json', 'explanations-v1.json')]);
    const result = JSON.parse(out.slice(0, out.indexOf('\nPILOT-RECEIPT')));
    const bindingFile = path.join(scratch, 'binding.json');
    writeFileSync(bindingFile, JSON.stringify(result, null, 2));
    const verified = runCli([...cliArgs('contexts-authorized-rehearsal-v1.json', 'explanations-v1.json'), '--verify', '--binding', bindingFile]);
    assert.match(verified, /verify=VERIFIED code=OK/);
    assert.ok(verified.includes(result.bindingDigest));
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
const MODULE_DIR = path.dirname('services/bi-control/src/business-bi/read-only-metric-pilot-protocol-v1.mjs');
const MODULE_SRC = 'services/bi-control/src/business-bi/read-only-metric-pilot-protocol-v1.mjs';
const moduleUrl = (relative) => pathToFileURL(path.resolve(process.cwd(), relative)).href;

async function driveVariant(name, mutate, drive) {
  const variantPath = `${MODULE_DIR}/.ks250-variant-${name}.mjs`;
  const original = readFileSync(MODULE_SRC, 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, `variant ${name} did not change the source`);
  writeFileSync(variantPath, mutated);
  try {
    const variant = await import(moduleUrl(variantPath));
    try {
      return { threw: null, value: drive(variant) };
    } catch (error) {
      return { threw: String(error?.message ?? error), value: null };
    }
  } finally {
    rmSync(variantPath, { force: true });
    assert.equal(existsSync(variantPath), false, `variant ${name} was left on disk`);
  }
}

test('KS250 RED/GREEN: without the simulated-answer guard a simulated reader answer is accepted on the variant', async () => {
  const explanations = clone(readJson(`${FD}/explanations-v1.json`));
  explanations.explanations[0].answerSource = 'SIMULATED';
  const input = {
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: readJson(`${FD}/contexts-authorized-rehearsal-v1.json`),
    explanations, sourceIdentity: readJson(`${FD}/source-identity-v1.json`), rows: rowsFixture(), now: NOW,
  };
  const red = await driveVariant(
    'no-simulated-guard',
    (source) => source.replace(
      "      if (explanation.answerSource === 'SIMULATED') {",
      "      if (false && explanation.answerSource === 'SIMULATED') {"),
    (variant) => variant.buildReadOnlyMetricPilot(input),
  );
  assert.equal(red.threw, null);
  assert.notEqual(red.value.code, 'KS250_PILOT_DENIED:SIMULATED_READER_ANSWER');
  assert.equal(red.value.outcome, 'PREPARED');
  assert.equal(buildReadOnlyMetricPilot(input).code, 'KS250_PILOT_DENIED:SIMULATED_READER_ANSWER');
});

test('KS250 RED/GREEN: the credential scan supplies the exact diagnosis, and with both the scan and the closed document shape removed the credential is carried', async () => {
  const contexts = clone(readJson(`${FD}/contexts-authorized-rehearsal-v1.json`));
  contexts.connectionString = 'host=example;user=reader';
  const input = {
    protocol: readJson(`${FD}/protocol-v1.json`), contexts,
    explanations: readJson(`${FD}/explanations-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`), rows: rowsFixture(), now: NOW,
  };
  const inputsUnchanged = () => ({
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: { ...clone(readJson(`${FD}/contexts-authorized-rehearsal-v1.json`)), connectionString: 'host=example;user=reader' },
    explanations: readJson(`${FD}/explanations-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`), rows: rowsFixture(), now: NOW,
  });

  // (a) the scan is the FIRST gate: the credential is diagnosed precisely, not as a shape error.
  const variantNoScan = await driveVariant(
    'no-credential-scan',
    (source) => source.replace(
      '      && CREDENTIAL_KEY.test(normalised) && nested !== null && nested !== undefined) {',
      '      && false && nested !== null && nested !== undefined) {'),
    (variant) => variant.buildReadOnlyMetricPilot(input),
  );
  assert.equal(variantNoScan.threw, null);
  assert.notEqual(variantNoScan.value.code, 'KS250_PILOT_DENIED:CREDENTIAL_FIELD_PRESENT');
  assert.equal(variantNoScan.value.code, 'KS250_PILOT_DENIED:CONTEXTS_MALFORMED',
    'without the scan the diagnosis should degrade to the generic shape refusal');
  assert.equal(buildReadOnlyMetricPilot(input).code, 'KS250_PILOT_DENIED:CREDENTIAL_FIELD_PRESENT');

  // (b) with the scan AND the closed document shape removed the credential is silently carried.
  const variantBoth = await driveVariant(
    'no-credential-scan-no-closed-doc',
    (source) => source
      .replace(
        '      && CREDENTIAL_KEY.test(normalised) && nested !== null && nested !== undefined) {',
        '      && false && nested !== null && nested !== undefined) {')
      .replace(
        "  if (!exactKeys(value, ['schemaVersion', 'classification', 'contexts'])) return false;",
        "  if (!exactKeys(value, ['schemaVersion', 'classification', 'contexts']) && false) return false;"),
    (variant) => variant.buildReadOnlyMetricPilot(inputsUnchanged()),
  );
  assert.equal(variantBoth.threw, null);
  assert.equal(variantBoth.value.outcome, 'PREPARED', 'the broken variant did not carry the credential field');
  assert.equal(buildReadOnlyMetricPilot(inputsUnchanged()).code, 'KS250_PILOT_DENIED:CREDENTIAL_FIELD_PRESENT');
});

test('KS250 RED/GREEN: without the metric-contract re-digest a substituted contract is accepted on the variant', async () => {
  const protocol = resealProtocol({
    ...clone(readJson(`${FD}/protocol-v1.json`)),
    metric: { ...readJson(`${FD}/protocol-v1.json`).metric, contractSha256: bytesSha256('substituted metric contract') },
  });
  const input = {
    protocol, contexts: readJson(`${FD}/contexts-v1.json`),
    explanations: readJson(`${FD}/explanations-empty-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`), rows: rowsFixture(), now: NOW,
  };
  const red = await driveVariant(
    'no-contract-redigest',
    (source) => source.replace(
      '    if (bytesSha256(contractBytes) !== protocol.metric.contractSha256) {',
      '    if (false && bytesSha256(contractBytes) !== protocol.metric.contractSha256) {'),
    (variant) => variant.buildReadOnlyMetricPilot(input),
  );
  assert.equal(red.threw, null);
  assert.notEqual(red.value.code, 'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH');
  assert.equal(red.value.outcome, 'PREPARED');
  assert.equal(buildReadOnlyMetricPilot(input).code, 'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH');
});

test('KS250 RED/GREEN: without the permission gate a permission-less context stops being BLOCKED_EXTERNAL on the variant', async () => {
  const input = {
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: readJson(`${FD}/contexts-v1.json`),
    explanations: readJson(`${FD}/explanations-empty-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`), rows: rowsFixture(), now: NOW,
  };
  const red = await driveVariant(
    'no-permission-gate',
    (source) => source.replace(
      "  if (permission.state !== 'GRANTED') {",
      '  if (false) {'),
    (variant) => variant.buildReadOnlyMetricPilot(input),
  );
  const exposed = red.threw === null
    && (red.value.contexts ?? []).some((entry) => entry.blockedCode === 'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING');
  assert.equal(exposed, false, 'the broken variant still reported the missing permission');
  assert.equal(pilot().blockedContextCount, 2);
  assert.equal(pilot().contexts[0].blockedCode, 'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING');
});

test('KS250 RED/GREEN: a CLI that IMPLICITLY defaults --contexts is RED through the real entry point', () => {
  const variantCli = 'scripts/.ks250-variant-cli-implicit-contexts.mjs';
  const original = readFileSync(CLI, 'utf8');
  const mutated = original.replace(
    "    contexts: valueOf('--contexts'),",
    "    contexts: valueOf('--contexts') ?? `${FD}/contexts-v1.json`,");
  assert.notEqual(mutated, original, 'the CLI variant did not change the source');
  writeFileSync(variantCli, mutated);
  try {
    const out = execFileSync(process.execPath, [variantCli, '--protocol', `${FD}/protocol-v1.json`], { encoding: 'utf8' });
    assert.match(out, /PILOT-DENIED KS250_PILOT_DENIED:INPUT_REQUIRED/);
    assert.equal(/missing=[^\n]*contexts/.test(out), false,
      'the broken CLI still reported the implicitly defaulted contexts input as missing');
  } finally {
    rmSync(variantCli, { force: true });
    assert.equal(existsSync(variantCli), false);
  }
  const green = runCli(['--protocol', `${FD}/protocol-v1.json`]);
  assert.match(green, /missing=contexts,explanations,sourceIdentity,rows/);
});
