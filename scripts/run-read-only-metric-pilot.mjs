#!/usr/bin/env node
// KaleidoSphere #250 (KS-EVO-05) — the ONE runnable LOCAL read-only metric pilot entry point.
//
// The default mode PREPARES the credential-free pilot protocol and executes the SYNTHETIC REHEARSAL on the
// existing installable path. The additive --issue-snapshot mode reads an explicitly
// permission-bound frozen issue-metadata source and performs one fixed-domain computation;
// it does not qualify a complete pilot, business definition or human comprehension.
// See docs/evidence/issue-state-snapshot-v1.md. The default mode does NOT run a real pilot: a context without its own explicit
// read permission stays BLOCKED_EXTERNAL, an AUTHORED_TEST_INPUT explanation stays
// CONTRACT_LEVEL_ONLY, and the rehearsal is never presented as a pilot.
//
//   node scripts/run-read-only-metric-pilot.mjs
//       EOF run: no input at all, nothing read, no fixture adopted.
//
//   node scripts/run-read-only-metric-pilot.mjs --protocol <f> --contexts <f> \
//       --explanations <f> --source-identity <f> --source-rows <f> [--format JSON|TABLE]
//       Every input above is REQUIRED and is NEVER defaulted.
//
//   node scripts/run-read-only-metric-pilot.mjs ... --verify --binding <f>
//       Re-derive the package from the independently retained inputs and require the carried
//       binding to match exactly.
//
//   node scripts/run-read-only-metric-pilot.mjs --negative
//       Execute the bounded negative gates and print each exact rejection code.
//
// This CLI WRITES NOTHING and opens no socket. The default mode connects no real source;
// snapshot mode only reads the caller-named admitted frozen metadata. No credential is
// accepted, and no productive or public effect is produced.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// New scope-specific snapshot mode: never route issue metadata into revenue fixtures.
// Maintainer establishes exact source-owner authority outside the parser. Reader mode
// prints a maintainer envelope; separate worksheet from referenceAnswers before handoff.
if (process.argv.slice(2).some(a => /^--(?:issue-snapshot|issue-permission|issue-capture|reader-task)(?:=|$)/.test(a))) {
  const { runIssueSnapshotCli } = await import('./lib/issue-snapshot-pilot-cli.mjs');
  const result = runIssueSnapshotCli(process.argv.slice(2));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  process.exit(result.outcome === 'DENIED' ? 1 : 0);
}

import {
  PILOT_FORMATS,
  PILOT_INTERNALS,
  buildReadOnlyMetricPilot,
  renderReadOnlyMetricPilot,
  verifyReadOnlyMetricPilot,
} from '../services/bi-control/src/business-bi/read-only-metric-pilot-protocol-v2.mjs';

const FD = 'tests/fixtures/business-bi/ks250-metric-pilot';
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
  const files = {
    protocol: valueOf('--protocol'),
    contexts: valueOf('--contexts'),
    explanations: valueOf('--explanations'),
    sourceIdentity: valueOf('--source-identity'),
    rows: valueOf('--source-rows'),
  };
  const missing = Object.entries(files).filter(([, file]) => file === null).map(([key]) => key);
  if (missing.length > 0) {
    return { denial: { outcome: 'DENIED', code: 'KS250_PILOT_DENIED:INPUT_REQUIRED', missing } };
  }
  return {
    protocol: readJson(files.protocol),
    contexts: readJson(files.contexts),
    explanations: readJson(files.explanations),
    sourceIdentity: readJson(files.sourceIdentity),
    rows: readRows(files.rows),
    now: NOW,
  };
}

function receipt(pilot) {
  return {
    outcome: pilot.outcome,
    protocolId: pilot.protocolId,
    realPilotExecuted: pilot.realPilotExecuted,
    qualifiedContextCount: pilot.qualifiedContextCount,
    blockedContextCount: pilot.blockedContextCount,
    contexts: pilot.contexts.map((entry) => ({
      contextId: entry.contextId,
      permissionState: entry.permissionState,
      realPilotStatus: entry.realPilotStatus,
      blockedCode: entry.blockedCode,
      readiness: entry.readiness,
      rehearsalEvidenceClass: entry.rehearsal.evidenceClass,
    })),
    secondContextReuse: pilot.secondContextReuse.state,
    generalizationClaim: pilot.generalizationClaim,
    credentialsAccepted: pilot.credentialPolicy.credentialsAccepted,
    rowLevelReadPerformed: pilot.dataMinimization.rowLevelReadPerformed,
    bindingDigest: pilot.bindingDigest,
  };
}

if (args.length === 0) {
  process.stdout.write('mode=eof pilot=null realPilotExecuted=false\n');
  process.stdout.write('PILOT-DENIED KS250_PILOT_DENIED:INPUT_REQUIRED missing=protocol,contexts,explanations,sourceIdentity,rows\n');
  process.exit(0);
}

if (has('--negative')) {
  const base = {
    protocol: readJson(`${FD}/protocol-v1.json`),
    contexts: readJson(`${FD}/contexts-authorized-rehearsal-v1.json`),
    explanations: readJson(`${FD}/explanations-v1.json`),
    sourceIdentity: readJson(`${FD}/source-identity-v1.json`),
    rows: readRows(ROWS_PATH),
    now: NOW,
  };
  const gates = [];
  const addGate = (name, expected, run) => gates.push({ name, expected, run });

  addGate('eof-input-required', 'KS250_PILOT_DENIED:INPUT_REQUIRED',
    () => buildReadOnlyMetricPilot({ now: NOW }));
  addGate('protocol-malformed', 'KS250_PILOT_DENIED:PROTOCOL_MALFORMED', () => {
    const protocol = clone(base.protocol);
    protocol.dataMinimization = { ...protocol.dataMinimization };
    delete protocol.digest;
    return buildReadOnlyMetricPilot({ ...base, protocol });
  });
  addGate('protocol-digest-not-re-derived', 'KS250_PILOT_DENIED:PROTOCOL_MALFORMED', () => {
    const protocol = clone(base.protocol);
    protocol.credentialPolicy = { credentialFree: false, allowedAuthentication: ['BASIC'] };
    return buildReadOnlyMetricPilot({ ...base, protocol });
  });
  addGate('protocol-contract-substituted', 'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH', () => {
    const protocol = clone(base.protocol);
    protocol.metric.contractSha256 = createHash('sha256').update('substituted metric contract').digest('hex');
    const { digest: _ignored, ...body } = protocol;
    protocol.digest = PILOT_INTERNALS.sha256(body);
    return buildReadOnlyMetricPilot({ ...base, protocol });
  });
  addGate('protocol-forbids-row-level', 'KS250_PILOT_DENIED:PROTOCOL_FORBIDS_ROW_LEVEL', () => {
    const protocol = clone(base.protocol);
    protocol.dataMinimization.rowLevelPermitted = true;
    const { digest: _ignored, ...body } = protocol;
    protocol.digest = PILOT_INTERNALS.sha256(body);
    return buildReadOnlyMetricPilot({ ...base, protocol });
  });
  addGate('credential-field-present', 'KS250_PILOT_DENIED:CREDENTIAL_FIELD_PRESENT', () => {
    const contexts = clone(base.contexts);
    contexts.contexts[0].connectionString = 'host=example;user=reader';
    return buildReadOnlyMetricPilot({ ...base, contexts });
  });
  addGate('raw-person-payload-included', 'KS250_PILOT_DENIED:RAW_PERSON_PAYLOAD_INCLUDED', () => {
    const explanations = clone(base.explanations);
    explanations.explanations[0].readerName = 'Jane Doe';
    return buildReadOnlyMetricPilot({ ...base, explanations });
  });
  addGate('contexts-malformed-granted-without-identity', 'KS250_PILOT_DENIED:CONTEXTS_MALFORMED', () => {
    const contexts = clone(base.contexts);
    contexts.contexts[0].permission = { state: 'GRANTED', permissionId: null, grantedAt: null, scopeNote: null };
    return buildReadOnlyMetricPilot({ ...base, contexts });
  });
  addGate('explanations-malformed-timing', 'KS250_PILOT_DENIED:EXPLANATIONS_MALFORMED', () => {
    const explanations = clone(base.explanations);
    explanations.explanations[0].timings.setupMs = -1;
    return buildReadOnlyMetricPilot({ ...base, explanations });
  });
  addGate('simulated-reader-answer', 'KS250_PILOT_DENIED:SIMULATED_READER_ANSWER', () => {
    const explanations = clone(base.explanations);
    explanations.explanations[0].answerSource = 'SIMULATED';
    return buildReadOnlyMetricPilot({ ...base, explanations });
  });
  addGate('default-no-permission-blocked-external', 'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING', () => {
    const pilot = buildReadOnlyMetricPilot({
      ...base,
      contexts: readJson(`${FD}/contexts-v1.json`),
      explanations: readJson(`${FD}/explanations-empty-v1.json`),
    });
    return { outcome: pilot.outcome, code: pilot.contexts[0].blockedCode, realPilotExecuted: pilot.realPilotExecuted };
  });
  addGate('default-no-permission-rehearsal-is-not-a-pilot', 'true', () => {
    const pilot = buildReadOnlyMetricPilot({
      ...base,
      contexts: readJson(`${FD}/contexts-v1.json`),
      explanations: readJson(`${FD}/explanations-empty-v1.json`),
    });
    return { code: String(pilot.contexts.every((entry) => entry.rehearsal.realPilot === false
      && entry.rehearsal.callableAsRealPilot === false
      && entry.rehearsal.evidenceClass === 'SYNTHETIC_REHEARSAL')), realPilotExecuted: pilot.realPilotExecuted };
  });
  addGate('reader-explanation-for-ungranted-context', 'KS250_PILOT_DENIED:READER_EXPLANATION_FOR_UNGRANTED_CONTEXT', () => {
    const contexts = readJson(`${FD}/contexts-authorized-rehearsal-v1.json`);
    contexts.contexts[1].permission = { state: 'MISSING', permissionId: null, grantedAt: null, scopeNote: null };
    return buildReadOnlyMetricPilot({ ...base, contexts });
  });
  addGate('context-identity-substituted-one-cent', 'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED', () => {
    const rows = clone(base.rows);
    rows[0].amount_minor_units += 1;
    return buildReadOnlyMetricPilot({ ...base, rows });
  });
  addGate('source-identity-not-credential-free', 'KS250_PILOT_DENIED:CONTEXTS_MALFORMED', () => {
    const sourceIdentity = { ...base.sourceIdentity, retainedCredentialFree: false };
    return buildReadOnlyMetricPilot({ ...base, sourceIdentity });
  });
  addGate('format-unsupported', 'KS250_PILOT_DENIED:FORMAT_UNSUPPORTED', () => {
    const pilot = buildReadOnlyMetricPilot({ ...base });
    return renderReadOnlyMetricPilot(pilot, 'CSV');
  });
  addGate('verify-input-required', 'KS250_PILOT_DENIED:INPUT_REQUIRED',
    () => verifyReadOnlyMetricPilot({ ...base, pilot: {}, bindingDigest: 'not-a-digest' }));
  addGate('verify-substituted-rehearsal-source', 'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED', () => {
    const pilot = buildReadOnlyMetricPilot({ ...base });
    const rows = clone(base.rows);
    rows[0].amount_minor_units += 1;
    return verifyReadOnlyMetricPilot({ ...base, rows, pilot, bindingDigest: pilot.bindingDigest });
  });
  addGate('verify-resealed-pilot', 'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH', () => {
    const pilot = buildReadOnlyMetricPilot({ ...base });
    const resealed = clone(pilot);
    resealed.binding.realPilotExecuted = true;
    return verifyReadOnlyMetricPilot({ ...base, pilot: resealed, bindingDigest: pilot.bindingDigest });
  });

  addGate('synthetic-human-label-not-real-pilot', 'true', () => {
    const explanations = clone(base.explanations);
    for (const e of explanations.explanations) e.declarationClass = 'HUMAN_READING';
    const pilot = buildReadOnlyMetricPilot({ ...base, explanations });
    return { code: String(pilot.realPilotExecuted === false && pilot.qualifiedContextCount === 0
      && pilot.contexts.every(c => c.explanation.humanComprehensionEvidence === false)) };
  });
  addGate('first-context-unpermitted', 'KS250_PILOT_BLOCKED_EXTERNAL:FIRST_CONTEXT_NOT_PERMITTED', () => {
    const contexts = clone(base.contexts);
    contexts.contexts[0].permission = { state: 'MISSING', permissionId: null, grantedAt: null, scopeNote: null };
    const explanations = clone(base.explanations);
    explanations.explanations = [explanations.explanations[1]];
    const pilot = buildReadOnlyMetricPilot({ ...base, contexts, explanations });
    return { code: pilot.secondContextReuse.code };
  });
  addGate('unobserved-effort-remains-unknown', 'true', () => {
    const pilot = buildReadOnlyMetricPilot(base);
    return { code: String(pilot.secondContextReuse.additionalMappingCodeLines === null
      && pilot.secondContextReuse.specialCaseCount === null
      && pilot.secondContextReuse.unmeasuredEffortReason.startsWith('UNKNOWN:')) };
  });
  addGate('verify-visible-payload-forgery', 'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH', () => {
    const pilot = buildReadOnlyMetricPilot(base);
    const forged = clone(pilot); forged.realPilotExecuted = true;
    return verifyReadOnlyMetricPilot({ ...base, pilot: forged, bindingDigest: pilot.bindingDigest });
  });
  addGate('context-source-identity-substituted', 'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED', () => {
    const contexts = clone(base.contexts);
    contexts.contexts[1].sourceIdentity.sourceBytesSha256 = createHash('sha256').update('other bytes').digest('hex');
    return buildReadOnlyMetricPilot({ ...base, contexts });
  });

  let failures = 0;
  for (const gate of gates) {
    let observed;
    try { observed = gate.run(); } catch (error) { observed = { code: `THREW:${String(error?.message ?? error)}` }; }
    const ok = observed?.code === gate.expected;
    if (!ok) failures += 1;
    process.stdout.write(`gate=${gate.name.padEnd(46)} expected=${gate.expected} observed=${observed?.code} ${ok ? 'OK' : 'UNEXPECTEDLY_ACCEPTED'}\n`);
  }
  process.stdout.write(`negative gates: ${gates.length} executed, ${failures} unexpected\n`);
  process.exit(failures === 0 ? 0 : 1);
}

const loaded = inputsFromArgs();
if (loaded.denial) {
  process.stdout.write(`PILOT-DENIED ${loaded.denial.code} missing=${(loaded.denial.missing ?? []).join(',')}\n`);
  process.exit(0);
}

if (has('--verify')) {
  const bindingFile = valueOf('--binding');
  if (bindingFile === null) {
    process.stdout.write('PILOT-DENIED KS250_PILOT_DENIED:INPUT_REQUIRED missing=binding\n');
    process.exit(0);
  }
  const carried = readJson(bindingFile);
  const verified = verifyReadOnlyMetricPilot({ ...loaded, pilot: carried, bindingDigest: carried.bindingDigest });
  process.stdout.write(`verify=${verified.outcome} code=${verified.code} bindingDigest=${verified.bindingDigest ?? null}\n`);
  process.exit(0);
}

const format = valueOf('--format') ?? 'JSON';
if (!PILOT_FORMATS.includes(format)) {
  process.stdout.write(`PILOT-DENIED KS250_PILOT_DENIED:FORMAT_UNSUPPORTED format=${format}\n`);
  process.exit(0);
}

const pilot = buildReadOnlyMetricPilot(loaded);
if (pilot.outcome !== 'PREPARED') {
  process.stdout.write(`PILOT-DENIED ${pilot.code} ${JSON.stringify(pilot.missing ?? pilot.detail ?? {})}\n`);
  process.exit(0);
}
const rendered = renderReadOnlyMetricPilot(pilot, format);
process.stdout.write(rendered.text);
process.stdout.write(`PILOT-RECEIPT ${JSON.stringify(receipt(pilot))}\n`);
