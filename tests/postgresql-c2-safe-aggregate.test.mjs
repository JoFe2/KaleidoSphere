// PostgreSQL C2 safe-aggregate (KaleidoSphere issue #150 / PG-KS-03) — the focused
// positive/negative gate for the separately-versioned C2 capability layered on the
// certified C1 PostgreSQL profile.
//
//   AC01 — capability-manifest / runtime parity: the closed contract names exactly one
//          supported operation (bi-ks-01-net-revenue/v1), its declared operation is
//          canonical-equal to the runtime's frozen operation request, every other method
//          is UNSUPPORTED, and the closed set and bindings match the admitted fixtures
//          and the frozen C1 substrate.
//   AC02 — the regular product path reproduces the committed certificate digests through
//          the net-revenue typed plan (digest-bound closed read surface) with the C1
//          substrate re-asserted (no bypass of the C1 identity/scope); the fail-closed
//          dispatch / auth / scope / policy / typed-plan probes return the truthful codes.
//   AC03 — exact equality with the independent BI oracle plus a sabotage RED/GREEN
//          matrix: row substitution is rejected by the holdout digest gate, a semantic
//          mutation of the ground truth is rejected by the oracle digest gate, and an
//          UNKNOWN-to-zero or sign-flipping compute can never satisfy the oracle-equality
//          gate (the correct result is the only one that equals the oracle).
//   AC04 — the separately-versioned certificate binds the tested product / release /
//          contract / fixtures and records BLOCKED_EXTERNAL real-PG non-claims; the
//          certificate-lifecycle regression pins the frozen C1 bytes (profile,
//          certificate, live matrix, its provenance, and its human readback)
//          byte-identical, so C2 issuance/revocation never rewrites the C1 substrate.
//
// It performs no external command, network, or live-database operation beyond re-reading
// the committed bytes and re-running the source-local clean-room dry-run with an emptied
// PATH; the real-disposable-PostgreSQL clean-room is recorded in the certificate as
// BLOCKED_EXTERNAL non-claims.

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import test from 'node:test';

import {
  ADMITTED_HOLDOUT_SHA256,
  ADMITTED_METRIC_CONTRACT_SHA256,
  ADMITTED_ORACLE_SHA256,
  NET_REVENUE_OPERATION_ID,
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
} from '../services/bi-control/src/business-bi/net-revenue-plan.mjs';
import {
  C1_CERTIFICATE_IDENTITY_SHA256,
  C1_CERTIFICATE_PATH,
  C1_CERTIFICATE_SHA256,
  C1_LIVE_MATRIX_PATH,
  C1_LIVE_MATRIX_PROVENANCE_IDENTITY_SHA256,
  C1_LIVE_MATRIX_PROVENANCE_PATH,
  C1_LIVE_MATRIX_PROVENANCE_RAW_SHA256,
  C1_LIVE_MATRIX_READBACK_PATH,
  C1_LIVE_MATRIX_READBACK_SHA256,
  C1_LIVE_MATRIX_SHA256,
  C1_PROFILE_PATH,
  C1_PROFILE_SHA256,
  C2_CERTIFICATE_PATH,
  C2_CONTRACT_PATH,
  C2_EVIDENCE_SCHEMA,
  C2_FAIL_CLOSED,
  HOLDOUT_FIXTURE_PATH,
  METRIC_CONTRACT_PATH,
  ORACLE_FIXTURE_PATH,
  bindToC1Profile,
  runPostgresqlC2FailClosedProbes,
  runPostgresqlC2SafeAggregate,
  serializeHoldout,
  validatePostgresqlC2Contract,
  verifyHoldoutSerializerBinding,
} from '../services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs';
import {identitySha256} from '../services/bi-control/src/db-analyzer/core.mjs';
import {selectProductDescriptor} from '../services/bi-control/src/runtime-config.mjs';
import {canonicalJson} from '../services/bi-control/src/canonical-json.js';

const root = path.resolve(import.meta.dirname, '..');
const script = path.join(root, 'scripts', 'run-postgresql-c2-safe-aggregate-clean-room.mjs');
const committedPath = path.join(root, C2_CERTIFICATE_PATH);
const contractPath = path.join(root, C2_CONTRACT_PATH);
const profilePath = path.join(root, C1_PROFILE_PATH);
const c1CertPath = path.join(root, C1_CERTIFICATE_PATH);
const metricPath = path.join(root, METRIC_CONTRACT_PATH);
const holdoutPath = path.join(root, HOLDOUT_FIXTURE_PATH);
const oraclePath = path.join(root, ORACLE_FIXTURE_PATH);
const packagePath = path.join(root, 'package.json');

const fileSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const HEX = /^[a-f0-9]{64}$/;
const NO_EXTERNAL_ROUTE = /node:child_process|node:https|node:http|node:net|require\s*\(|fetch\s*\(|spawn\s*\(|execFile\s*\(/;

// The exact truthful fail-closed codes the C2 dispatch / auth / scope / policy /
// typed-plan boundaries produce. A denial that coerces to a success or a different code
// is a falsification.
const EXPECTED_FAIL_CLOSED = C2_FAIL_CLOSED;

const runScript = (args, options = {}) => spawnSync(process.execPath, [script, ...args], {cwd: root, encoding: 'utf8', ...options});
const parseStdout = (result) => {
  assert.equal(result.status, 0, `clean-room failed: ${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
};
const throws = (fn) => {
  let threw = false;
  try {
    fn();
  } catch {
    threw = true;
  }
  assert.ok(threw, 'expected fail-closed');
};
const cloneJson = (value) => JSON.parse(JSON.stringify(value));

// Load the committed inputs once (the regular product path and the fail-closed probes
// share the same bound fixtures and frozen C1 substrate).
const readInputs = () => Promise.all([
  readFile(contractPath, 'utf8').then((s) => JSON.parse(s)),
  readFile(profilePath),
  readFile(c1CertPath),
  readFile(metricPath),
  readFile(oraclePath),
  readFile(holdoutPath),
]);

// The synthetic source-local read: the closed, digest-bound read the real clean-room
// performs against real PG (the same read surface; only the transport differs).
const syntheticRead = (holdoutBytes) => async () => {
  const fixture = JSON.parse(holdoutBytes.toString('utf8'));
  return {
    state: 'COMPLETE',
    reasonCode: null,
    bytes: holdoutBytes,
    evidence: {
      accessMode: 'READ_ONLY',
      mutationCount: 0,
      bounded: true,
      relation: 'synthetic_bi.orders',
      rowsRead: fixture.rows.length,
    },
  };
};

test('the committed C2 certificate is the exact deterministic output of the regular clean-room', async () => {
  // Run twice with an emptied PATH to prove the boundary is local-only (no external
  // binary route is taken to reproduce the certificate).
  const first = runScript(['--dry-run'], {env: {...process.env, PATH: ''}});
  const second = runScript(['--dry-run'], {env: {...process.env, PATH: ''}});
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.equal(first.stdout, second.stdout, 'certificate is byte-stable across runs');
  const committed = await readFile(committedPath, 'utf8');
  assert.equal(committed, first.stdout, 'committed certificate is the exact clean-room output');
  const evidence = parseStdout(first);
  assert.equal(evidence.schemaVersion, C2_EVIDENCE_SCHEMA);
  const {certificateSha256, ...body} = evidence;
  assert.match(certificateSha256, HEX);
  assert.equal(identitySha256(body), certificateSha256, 'certificateSha256 is the identity hash of the body');
});

test('the regular C2 safe-aggregate product path reproduces the certificate digests with no C1 bypass', async () => {
  const [contract, profileBytes, certBytes, metricContractBytes, oracleBytes, holdoutBytes] = await readInputs();
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));
  const result = await runPostgresqlC2SafeAggregate({
    contract,
    profileBytes,
    certBytes,
    metricContractBytes,
    oracleBytes,
    read: syntheticRead(holdoutBytes),
  });
  // The regular product path (descriptor route + typed plan), not a bespoke bypass.
  assert.equal(result.productPath.mode, 'SYNTHETIC');
  assert.equal(result.productPath.dispatch, 'REGULAR');
  assert.equal(result.productPath.engine, 'postgresql');
  assert.equal(result.productPath.regularPath.dispatch, 'REGULAR');
  assert.equal(result.productPath.regularPath.executorBinding, committed.productDescriptor.executor);
  assert.equal(result.productPath.regularPath.capability, committed.productDescriptor.capability);
  assert.equal(result.productPath.regularPath.productSecretBindingEnforced, true);
  // AC02: the typed-plan digest binding is intact and the receipt is oracle-exact.
  assert.match(result.plan.planSha256, HEX);
  assert.equal(result.plan.planSha256, committed.typedPlan.planSha256);
  assert.equal(result.plan.bounds.inputRowBudget, 17);
  assert.equal(result.plan.bounds.inputByteBudget, 4096);
  assert.equal(result.plan.bounds.outputRowBudget, 1);
  assert.equal(result.plan.bounds.timeoutMs, 100);
  assert.equal(result.receipt.execution.state, 'COMPLETE');
  assert.equal(result.receipt.execution.reasonCode, null);
  assert.equal(result.receipt.execution.readOnlyEvidence, 'VERIFIED');
  assert.equal(result.receipt.execution.bounded, true);
  assert.equal(result.receipt.execution.timeoutAware, true);
  assert.equal(result.receipt.execution.cancelAware, true);
  assert.equal(result.receipt.execution.rowsRead, 17);
  assert.equal(result.receipt.oracleEquality, 'EXACT');
  assert.equal(result.receipt.resultSha256, committed.execution.resultSha256);
  assert.equal(result.receipt.outputSha256, committed.execution.outputSha256);
  assert.equal(result.receipt.receiptSha256, committed.execution.receiptSha256);
  // No bypass of the C1 identity/scope: the frozen C1 substrate is re-asserted by digest.
  assert.equal(result.profileBinding.c1ProfileSha256, C1_PROFILE_SHA256);
  assert.equal(result.profileBinding.c1CertificateSha256, C1_CERTIFICATE_SHA256);
  assert.equal(result.profileBinding.c1FrozenState, 'BLOCKED_EXTERNAL');
  assert.equal(result.profileBinding.c1DeclaresC2NonCapability, true);
});

test('the certificate binds only the tested product, release, contract, and fixtures', async () => {
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));
  const pkg = JSON.parse((await readFile(packagePath, 'utf8')));
  // The tested product descriptor route.
  const descriptor = selectProductDescriptor('postgresql');
  assert.equal(committed.productDescriptor.engine, descriptor.engine);
  assert.equal(committed.productDescriptor.executor, descriptor.components.executor);
  assert.equal(committed.productDescriptor.capability, descriptor.components.capability);
  assert.equal(committed.productDescriptor.evidence, descriptor.components.evidence);
  assert.equal(committed.productDescriptor.secretEnv, descriptor.secret.env);
  assert.equal(committed.productDescriptor.secretFileVariable, descriptor.secret.fileVariable);
  // AC01: the closed contract names exactly one supported operation and matches the runtime.
  assert.equal(committed.contract.supportedOperation, NET_REVENUE_OPERATION_ID);
  assert.equal(committed.contract.closedSet, true);
  assert.equal(committed.contract.manifestRuntimeParity, true);
  assert.match(committed.contract.operationSha256, HEX);
  // The Main release manifest.
  assert.equal(committed.release.version, pkg.version);
  // The fixture bindings match the actual bound files AND the admitted digests.
  assert.equal(committed.bindings.metricContractSha256, fileSha256(await readFile(metricPath)));
  assert.equal(committed.bindings.holdoutSha256, fileSha256(await readFile(holdoutPath)));
  assert.equal(committed.bindings.oracleSha256, fileSha256(await readFile(oraclePath)));
  assert.equal(committed.bindings.metricContractSha256, ADMITTED_METRIC_CONTRACT_SHA256);
  assert.equal(committed.bindings.holdoutSha256, ADMITTED_HOLDOUT_SHA256);
  assert.equal(committed.bindings.oracleSha256, ADMITTED_ORACLE_SHA256);
  // The C1 substrate binding matches the actual frozen C1 files.
  assert.equal(committed.boundTo.c1ProfileSha256, fileSha256(await readFile(profilePath)));
  assert.equal(committed.boundTo.c1CertificateSha256, fileSha256(await readFile(c1CertPath)));
});

test('the fail-closed dispatch/auth/scope/policy/typed-plan probes return the truthful codes', async () => {
  const [contract, profileBytes, certBytes, metricContractBytes, oracleBytes, holdoutBytes] = await readInputs();
  const failClosed = await runPostgresqlC2FailClosedProbes({
    contract,
    profileBytes,
    certBytes,
    metricContractBytes,
    oracleBytes,
    holdoutBytes,
  });
  for (const [probe, expected] of Object.entries(EXPECTED_FAIL_CLOSED)) {
    assert.equal(failClosed[probe], expected, `probe ${probe}`);
  }
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));
  assert.deepEqual(committed.failClosed, C2_FAIL_CLOSED, 'committed fail-closed codes match the module constants');
});

test('the AC01 contract fails closed on scope, parity, and binding drift', async () => {
  const contract = JSON.parse(await readFile(contractPath, 'utf8'));
  assert.doesNotThrow(() => validatePostgresqlC2Contract(contract), 'the committed contract is valid');
  const clone = (fn) => {
    const c = cloneJson(contract);
    fn(c);
    return c;
  };
  // Exactly one SUPPORTED operation; a second supported op breaks the closed set.
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    c.operations['bi-ks-01-gross-revenue/v1'] = {status: 'SUPPORTED', operation: c.operations[NET_REVENUE_OPERATION_ID].operation};
  })));
  // Renaming the supported op breaks the single-operation gate.
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    const op = c.operations[NET_REVENUE_OPERATION_ID];
    delete c.operations[NET_REVENUE_OPERATION_ID];
    c.operations['bi-ks-01-renamed/v1'] = op;
  })));
  // Manifest <-> runtime parity: a scope / relation / currency / period change breaks parity.
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    c.operations[NET_REVENUE_OPERATION_ID].operation.source.relation = 'public.orders';
  })));
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    c.operations[NET_REVENUE_OPERATION_ID].operation.source.currency.code = 'USD';
  })));
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    c.operations[NET_REVENUE_OPERATION_ID].operation.source.periods[0].boundary = 'half-open';
  })));
  // A binding must match the admitted digest.
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    c.bindings.holdout.sha256 = '0'.repeat(64);
  })));
  // The C1 substrate binding must match the frozen C1 profile.
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    c.boundTo.c1Profile.sha256 = '0'.repeat(64);
  })));
  // An unsupported entry cannot equal the supported op or be marked supported.
  throws(() => validatePostgresqlC2Contract(clone((c) => {
    c.unsupportedOperations.push({id: NET_REVENUE_OPERATION_ID, status: 'UNSUPPORTED'});
  })));
});

test('the holdout serializer reproduces the committed holdout bytes exactly (AC01/AC02 digest binding)', async () => {
  const holdoutBytes = await readFile(holdoutPath);
  assert.equal(verifyHoldoutSerializerBinding(holdoutBytes), true);
  const fixture = JSON.parse(holdoutBytes.toString('utf8'));
  assert.equal(fileSha256(serializeHoldout(fixture.rows)), ADMITTED_HOLDOUT_SHA256);
  // A single field change to any row breaks the binding (the digest gate rejects it).
  const mutated = cloneJson(fixture);
  mutated.rows[0].amount_minor_units = mutated.rows[0].amount_minor_units + 1;
  assert.notEqual(fileSha256(serializeHoldout(mutated.rows)), ADMITTED_HOLDOUT_SHA256, 'row mutation changes the holdout digest');
});

test('the clean-room fails closed when a bound C1 substrate or holdout digest drifts', async () => {
  const profile = JSON.parse(await readFile(profilePath, 'utf8'));
  const holdout = JSON.parse(await readFile(holdoutPath, 'utf8'));
  const tmp = await mkdtemp(path.join(tmpdir(), 'ks150-c2-tamper-'));
  // A substituted C1 profile is refused (no bypass of the C1 identity/scope).
  profile.issue = 'TAMPERED';
  const badProfile = path.join(tmp, 'bad-profile.json');
  await writeFile(badProfile, `${JSON.stringify(profile, null, 2)}\n`);
  const profileResult = runScript(['--dry-run', '--profile', badProfile]);
  assert.notEqual(profileResult.status, 0, `substituted C1 profile must be refused: ${profileResult.stdout}\n${profileResult.stderr}`);
  // A substituted holdout is refused (the committed holdout digest is the binding).
  const badHoldout = path.join(tmp, 'bad-holdout.json');
  holdout.rows[0].amount_minor_units = 1;
  await writeFile(badHoldout, `${JSON.stringify(holdout, null, 2)}\n`);
  const holdoutResult = runScript(['--dry-run', '--holdout', badHoldout]);
  assert.notEqual(holdoutResult.status, 0, `substituted holdout must be refused: ${holdoutResult.stdout}\n${holdoutResult.stderr}`);
});

test('the clean-room is source-local: no process, network, or live-database route', async () => {
  const source = await readFile(script, 'utf8');
  assert.doesNotMatch(source, NO_EXTERNAL_ROUTE, 'clean-room takes no external process/network/DB route');
  assert.match(source, /postgresql-safe-analysis\.mjs/);
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));
  assert.equal(committed.realDisprovablePostgresql.state, 'BLOCKED_EXTERNAL');
});

test('AC03: the product path is oracle-exact and the sabotage matrix fails closed', async () => {
  const [contract, profileBytes, certBytes, metricContractBytes, oracleBytes, holdoutBytes] = await readInputs();
  const oracle = JSON.parse(oracleBytes.toString('utf8'));
  const fixture = JSON.parse(holdoutBytes.toString('utf8'));
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));

  // GREEN: the regular product path is oracle-exact and reproduces the committed digest.
  const result = await runPostgresqlC2SafeAggregate({
    contract,
    profileBytes,
    certBytes,
    metricContractBytes,
    oracleBytes,
    read: syntheticRead(holdoutBytes),
  });
  assert.equal(result.receipt.oracleEquality, 'EXACT');
  assert.equal(canonicalJson(result.receipt.result), canonicalJson(oracle.expected), 'GREEN: the result equals the independent oracle exactly');
  assert.equal(result.receipt.resultSha256, committed.execution.resultSha256);
  const correct = result.receipt.result;
  // The correct result quantifies UNKNOWN distinctly (never zeroed, never dropped):
  // the oracle's unknown channel is non-trivial and net excludes the unknown amounts.
  assert.equal(correct.unknown.count, 4);
  assert.equal(correct.unknown.quantifiedAmountMinorUnits, 1977);
  assert.equal(correct.periods.current.netMinorUnits, 100059);
  assert.equal(correct.periods.current.saleMinorUnits, 141293);
  assert.equal(correct.periods.current.creditMinorUnits, 41234);
  assert.equal(correct.periods.current.netMinorUnits, correct.periods.current.saleMinorUnits - correct.periods.current.creditMinorUnits);

  // RED (source tampering): row substitution is rejected by the holdout digest gate.
  const substitutedRows = cloneJson(fixture.rows);
  substitutedRows[8].amount_minor_units = 1; // s-009 substituted
  const substitutedBytes = serializeHoldout(substitutedRows);
  assert.notEqual(fileSha256(substitutedBytes), ADMITTED_HOLDOUT_SHA256, 'row substitution changes the holdout digest');
  const probePlan = compileNetRevenuePlan({request: createNetRevenueOperationRequest(), metricContractBytes, oracleBytes});
  const substitutedReceipt = await executeNetRevenuePlan({
    plan: probePlan,
    metricContractBytes,
    oracleBytes,
    read: async () => ({
      state: 'COMPLETE',
      reasonCode: null,
      bytes: substitutedBytes,
      evidence: {
        accessMode: 'READ_ONLY',
        mutationCount: 0,
        bounded: true,
        relation: 'synthetic_bi.orders',
        rowsRead: substitutedRows.length,
      },
    }),
  });
  assert.equal(substitutedReceipt.execution.state, 'DENIED');
  assert.equal(substitutedReceipt.execution.reasonCode, 'BUSINESS_BI_HOLDOUT_DIGEST_DENIED', 'row substitution fails closed at the holdout digest gate');

  // RED (ground-truth tampering): a semantic mutation of the oracle (net = sale + credit)
  // changes its bytes and is rejected by the oracle digest gate at compile time.
  const tamperedOracle = cloneJson(oracle);
  tamperedOracle.expected.periods.current.netMinorUnits =
    tamperedOracle.expected.periods.current.saleMinorUnits + tamperedOracle.expected.periods.current.creditMinorUnits;
  const tamperedOracleBytes = Buffer.from(JSON.stringify(tamperedOracle), 'utf8');
  assert.notEqual(fileSha256(tamperedOracleBytes), ADMITTED_ORACLE_SHA256, 'semantic mutation changes the oracle digest');
  let semanticCompileCode = null;
  try {
    compileNetRevenuePlan({request: createNetRevenueOperationRequest(), metricContractBytes, oracleBytes: tamperedOracleBytes});
  } catch (error) {
    semanticCompileCode = error.code ?? error.message;
  }
  assert.equal(semanticCompileCode, 'BUSINESS_BI_ORACLE_DIGEST_DENIED', 'semantic mutation of the ground truth fails closed at the oracle digest gate');

  // RED (compute tampering): an UNKNOWN-to-zero or sign-flipping compute could never
  // satisfy the oracle-equality gate (canonicalJson(result) !== canonicalJson(oracle.expected))
  // that runs on every COMPLETE execution; the correct result is the only one that matches.
  const unknownToZero = cloneJson(correct);
  unknownToZero.unknown = {count: 0, quantifiedAmountMinorUnits: 0, unquantifiedCount: 0, unassigned: {count: 0, quantifiedAmountMinorUnits: 0, unquantifiedCount: 0}};
  unknownToZero.periods.current.unknown = {count: 0, quantifiedAmountMinorUnits: 0, unquantifiedCount: 0};
  unknownToZero.periods.comparison.unknown = {count: 0, quantifiedAmountMinorUnits: 0, unquantifiedCount: 0};
  assert.notEqual(canonicalJson(unknownToZero), canonicalJson(oracle.expected), 'UNKNOWN-to-zero deviates from the oracle (oracle-equality gate would reject)');

  const semanticMutated = cloneJson(correct);
  for (const key of ['current', 'comparison']) {
    semanticMutated.periods[key].netMinorUnits = semanticMutated.periods[key].saleMinorUnits + semanticMutated.periods[key].creditMinorUnits;
  }
  semanticMutated.deltaMinorUnits = semanticMutated.periods.current.netMinorUnits - semanticMutated.periods.comparison.netMinorUnits;
  assert.notEqual(canonicalJson(semanticMutated), canonicalJson(oracle.expected), 'sign-flipping compute deviates from the oracle (oracle-equality gate would reject)');
  // Both sabotages also deviate from the CORRECT result (the gate discriminates).
  assert.notEqual(canonicalJson(unknownToZero), canonicalJson(correct));
  assert.notEqual(canonicalJson(semanticMutated), canonicalJson(correct));
});

test('the certificate preserves BLOCKED_EXTERNAL real-PG non-claims and does not over-claim', async () => {
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));
  const real = committed.realDisprovablePostgresql;
  assert.equal(real.state, 'BLOCKED_EXTERNAL');
  assert.equal(real.ac01VerifiedLeastPrivilegePrincipal, 'BLOCKED_EXTERNAL');
  assert.equal(real.ac02RealSourcePositiveRun, 'BLOCKED_EXTERNAL');
  assert.equal(real.ac03RealNegativeMatrix, 'BLOCKED_EXTERNAL');
  assert.ok(Array.isArray(committed.nonClaims) && committed.nonClaims.length >= 4, 'non-claims are recorded');
  const joined = committed.nonClaims.join('\n').toLowerCase();
  for (const phrase of ['no arbitrary sql', 'blocked_external', 'production', 'scale', 'all-versions']) {
    assert.ok(joined.includes(phrase), `non-claims must cover: ${phrase}`);
  }
});

test('AC04: C2 issuance never modifies the frozen C1 bytes (certificate-lifecycle regression)', async () => {
  // The frozen C1 substrate stays byte-identical to the recorded digests.
  const profileBytes = await readFile(profilePath);
  const c1CertBytes = await readFile(c1CertPath);
  const liveMatrixBytes = await readFile(path.join(root, C1_LIVE_MATRIX_PATH));
  const provenanceBytes = await readFile(path.join(root, C1_LIVE_MATRIX_PROVENANCE_PATH));
  const readbackBytes = await readFile(path.join(root, C1_LIVE_MATRIX_READBACK_PATH));
  assert.equal(fileSha256(profileBytes), C1_PROFILE_SHA256, 'C1 profile is byte-identical');
  assert.equal(fileSha256(c1CertBytes), C1_CERTIFICATE_SHA256, 'C1 certificate is byte-identical');
  assert.equal(fileSha256(liveMatrixBytes), C1_LIVE_MATRIX_SHA256, 'C1 live matrix is byte-identical');
  assert.equal(fileSha256(provenanceBytes), C1_LIVE_MATRIX_PROVENANCE_RAW_SHA256, 'C1 live-matrix provenance is byte-identical');
  assert.equal(fileSha256(readbackBytes), C1_LIVE_MATRIX_READBACK_SHA256, 'C1 live-matrix readback is byte-identical');
  // The frozen C1 certificate keeps its own self-digest and BLOCKED_EXTERNAL state.
  const c1Cert = JSON.parse(c1CertBytes.toString('utf8'));
  assert.equal(c1Cert.certificateSha256, C1_CERTIFICATE_IDENTITY_SHA256, 'C1 certificate self-digest is intact');
  const {certificateSha256: _c1Id, ...c1CertBody} = c1Cert;
  assert.equal(identitySha256(c1CertBody), C1_CERTIFICATE_IDENTITY_SHA256, 'C1 certificate identity re-derives');
  assert.equal(c1Cert.realDisprovablePostgresql.state, 'BLOCKED_EXTERNAL', 'C1 certificate still records BLOCKED_EXTERNAL');
  // The provenance record keeps its own self-digest.
  const provenance = JSON.parse(provenanceBytes.toString('utf8'));
  assert.equal(provenance.provenanceSha256, C1_LIVE_MATRIX_PROVENANCE_IDENTITY_SHA256, 'provenance self-digest is intact');
  const {provenanceSha256: _provId, ...provBody} = provenance;
  assert.equal(identitySha256(provBody), C1_LIVE_MATRIX_PROVENANCE_IDENTITY_SHA256, 'provenance identity re-derives');
  // The C2 certificate records the C1 lifecycle with every frozen digest and the
  // byte-unchanged flag (the C2 cert is the separately-versioned artifact; the C1 bytes
  // it references are not rewritten).
  const committed = JSON.parse(await readFile(committedPath, 'utf8'));
  const lifecycle = committed.c1Lifecycle;
  assert.equal(lifecycle.c1ProfileSha256, C1_PROFILE_SHA256);
  assert.equal(lifecycle.c1CertificateSha256, C1_CERTIFICATE_SHA256);
  assert.equal(lifecycle.c1CertificateIdentitySha256, C1_CERTIFICATE_IDENTITY_SHA256);
  assert.equal(lifecycle.c1LiveMatrixSha256, C1_LIVE_MATRIX_SHA256);
  assert.equal(lifecycle.c1LiveMatrixProvenanceRawSha256, C1_LIVE_MATRIX_PROVENANCE_RAW_SHA256);
  assert.equal(lifecycle.c1LiveMatrixProvenanceIdentitySha256, C1_LIVE_MATRIX_PROVENANCE_IDENTITY_SHA256);
  assert.equal(lifecycle.c1LiveMatrixReadbackSha256, C1_LIVE_MATRIX_READBACK_SHA256);
  assert.equal(lifecycle.c1FrozenBytesUnchanged, true);
});

test('the C2 substrate binding refuses a substituted frozen C1 profile or certificate', async () => {
  const profileBytes = await readFile(profilePath);
  const certBytes = await readFile(c1CertPath);
  assert.doesNotThrow(() => bindToC1Profile({profileBytes, certBytes}), 'the committed C1 substrate binds');
  // A substituted profile or certificate (a single changed byte) is refused (no C1
  // bypass). The raw-digest check precedes any JSON parse, so a byte flip is the
  // minimal, guaranteed substrate substitution.
  const tamperedProfile = Buffer.concat([profileBytes.subarray(0, profileBytes.length - 1), Buffer.from('X')]);
  const tamperedCert = Buffer.concat([certBytes.subarray(0, certBytes.length - 1), Buffer.from('X')]);
  assert.notEqual(fileSha256(tamperedProfile), C1_PROFILE_SHA256, 'profile substitution diverges from the frozen digest');
  assert.notEqual(fileSha256(tamperedCert), C1_CERTIFICATE_SHA256, 'certificate substitution diverges from the frozen digest');
  throws(() => bindToC1Profile({profileBytes: tamperedProfile, certBytes}));
  throws(() => bindToC1Profile({profileBytes, certBytes: tamperedCert}));
});

// ---------------------------------------------------------------------------
// Real clean-room registration (this correction). The 2026-09-12 dedicated-VM
// execution at the tested head is registered byte-for-byte as tracked evidence
// and bound to the tested source, the certified C1 substrate, and the committed
// deterministic C2 certificate. The registration never rewrites the committed
// certificate or the frozen C1 bytes; the later real-run provenance is kept
// separate from the source-local certificate mint.
// ---------------------------------------------------------------------------

const C2_TESTED_HEAD = '28b50870d2ab360ebce76d524ab2636254382c22';
const C2_TESTED_HEAD_PARENT = 'e5edb163319598397ba7b7b223d2cd33d5b6b307';
const C2_TESTED_HEAD_TREE = '6f995105138bab7c633a24c56a5cfd2bb21d849d';
const C2_TESTED_HEAD_SUBJECT = 'PostgreSQL C2 safe-aggregate contract, typed-plan execution, and certificate (#150)';
const C2_RAW_EVIDENCE_PRIMARY_PATH = '.ks150-c2-real-cleanroom-primary-evidence.json';
const C2_RAW_EVIDENCE_POST_RESTORE_PATH = '.ks150-c2-real-cleanroom-post-restore-evidence.json';
const C2_RAW_EVIDENCE_SHA256 = 'b3c10b112edf72bbf6241691d686cc2adc7e4380e3a9a238618ac0f3dd9ca382';
const C2_REAL_CLEANROOM_PROVENANCE_PATH = 'verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json';
const C2_REAL_CLEANROOM_PROVENANCE_IDENTITY_SHA256 = '4686d5e91a2dff5fd1e94efb137d4691cdba10eff0be61a5c2c5e0f3e56686c0';
const C2_REAL_CLEANROOM_READBACK_PATH = 'docs/evidence/postgresql-c2-real-cleanroom/README.md';
const C2_REAL_CLEANROOM_READBACK_SHA256 = '43d1f7e774bd0fa3acd991ab1cae7c0129bf4cb82aaa37c125958d15b6bf7dd6';
const C2_REAL_CLEANROOM_CERTIFICATE_RAW_SHA = '630096d44765665b6aa13d6d99f897c80dc2b011e6cfe9cd7efd027a25147e3b';
const C2_REAL_CLEANROOM_CERTIFICATE_IDENTITY_SHA = '959874725fd49aebd5d3b72a029f87e2ac0e46afd1e256f4a8dc14244f9cc496';
// Correction-only paths: if a product/config/fixture/test byte changed after the
// tested head outside this bounded correction, the registration does not hold.
const ALLOWED_SINCE_TESTED_HEAD = new Set([
  '.ks150-c2-real-cleanroom-post-restore-evidence.json',
  '.ks150-c2-real-cleanroom-primary-evidence.json',
  'SOURCE-MAP.json',
  'SOURCE-MAP.md',
  'WORK_RESULT.md',
  'docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json',
  'docs/evidence/postgresql-c2-real-cleanroom/README.md',
  'scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs',
  'tests/postgresql-c2-safe-aggregate.test.mjs',
  'verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json',
]);

const git = (...args) => execFileSync('git', [...args], {cwd: root, encoding: 'utf8'}).trim();

test('the real clean-room evidence is registered byte-for-byte and bound to the tested head (AC02/AC03 registration)', async () => {
  const provenanceBytes = await readFile(path.join(root, C2_REAL_CLEANROOM_PROVENANCE_PATH), 'utf8');
  const provenance = JSON.parse(provenanceBytes);
  assert.equal(provenance.schemaVersion, 'kaleidosphere.db/postgresql-c2-real-cleanroom-provenance/v1');
  assert.equal(provenance.issue, 'PG-KS-03');
  assert.equal(provenance.publicIssue, 'JoFe2/KaleidoSphere#150');
  // The provenance self-digest is the identity hash of its own body.
  const {provenanceSha256: _self, ...provBody} = provenance;
  assert.equal(provenance.provenanceSha256, C2_REAL_CLEANROOM_PROVENANCE_IDENTITY_SHA256);
  assert.equal(identitySha256(provBody), C2_REAL_CLEANROOM_PROVENANCE_IDENTITY_SHA256);
  // The registered raw evidence bytes exist at their recorded paths and digests.
  for (const artifact of provBody.artifacts) {
    const raw = await readFile(path.join(root, artifact.path));
    assert.equal(fileSha256(raw), artifact.sha256, `${artifact.path} matches its recorded digest`);
  }
  const primary = await readFile(path.join(root, C2_RAW_EVIDENCE_PRIMARY_PATH));
  const postRestore = await readFile(path.join(root, C2_RAW_EVIDENCE_POST_RESTORE_PATH));
  assert.equal(primary.equals(postRestore), true, 'both retained files are the byte-identical record of the byte-reproducible real run');
  assert.equal(fileSha256(primary), C2_RAW_EVIDENCE_SHA256);
  // The tested head is the exact retained commit and is an ancestor of HEAD.
  assert.equal(git('rev-parse', `${C2_TESTED_HEAD}^{commit}`), C2_TESTED_HEAD);
  assert.equal(git('rev-parse', `${C2_TESTED_HEAD}^{tree}`), C2_TESTED_HEAD_TREE);
  assert.equal(git('rev-parse', `${C2_TESTED_HEAD}^`), C2_TESTED_HEAD_PARENT);
  assert.equal(git('log', '-1', '--format=%s', C2_TESTED_HEAD), C2_TESTED_HEAD_SUBJECT);
  git('merge-base', '--is-ancestor', C2_TESTED_HEAD, 'HEAD');
  // No product/config/fixture/certificate byte changed after the tested head.
  const changed = git('diff', '--name-only', C2_TESTED_HEAD, 'HEAD').split('\n').filter(Boolean);
  assert.ok(
    changed.every((file) => ALLOWED_SINCE_TESTED_HEAD.has(file)),
    `changed files outside the bounded correction: ${changed.join(', ')}`,
  );
  for (const bounded of [
    'services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs',
    'contracts/connectors/postgresql/c2-safe-aggregate-v1.json',
    'verification/postgresql-c2-safe-aggregate-v1.json',
    'scripts/run-postgresql-c2-safe-aggregate-clean-room.mjs',
    'package.json',
    'contracts/connectors/postgresql/c1-profile-v1.json',
    'verification/postgresql/postgresql-c1-evidence-v1.json',
  ]) {
    assert.ok(!changed.includes(bounded), `${bounded} is byte-identical since the tested head`);
  }
  // The provenance binds the committed deterministic C2 certificate and the real
  // execution record to the same certified C1 substrate and admitted inputs.
  assert.equal(provBody.certificate.path, 'verification/postgresql-c2-safe-aggregate-v1.json');
  assert.equal(provBody.certificate.sha256, C2_REAL_CLEANROOM_CERTIFICATE_RAW_SHA);
  assert.equal(provBody.certificate.certificateSha256, C2_REAL_CLEANROOM_CERTIFICATE_IDENTITY_SHA);
  assert.equal(fileSha256(await readFile(committedPath)), C2_REAL_CLEANROOM_CERTIFICATE_RAW_SHA);
  assert.equal(provBody.bindings.c1ProfileSha256, C1_PROFILE_SHA256);
  assert.equal(provBody.bindings.c1CertificateSha256, C1_CERTIFICATE_SHA256);
  assert.equal(provBody.bindings.metricContractSha256, ADMITTED_METRIC_CONTRACT_SHA256);
  assert.equal(provBody.bindings.holdoutSha256, ADMITTED_HOLDOUT_SHA256);
  assert.equal(provBody.bindings.oracleSha256, ADMITTED_ORACLE_SHA256);
  assert.equal(provBody.execution.state, 'COMPLETE');
  assert.equal(provBody.execution.oracleEquality, 'EXACT');
  assert.deepEqual(provBody.execution.failClosed, C2_FAIL_CLOSED);
  assert.equal(provBody.execution.sessionProof.transactionReadOnly, 'on');
  assert.equal(provBody.execution.sessionProof.defaultTransactionReadOnly, 'on');
  assert.equal(provBody.execution.sessionProof.adminCapabilities, false);
});

test('the real clean-room readback evidence path is readable and binds the same bytes', async () => {
  const readback = await readFile(path.join(root, C2_REAL_CLEANROOM_READBACK_PATH), 'utf8');
  assert.equal(fileSha256(Buffer.from(readback, 'utf8')), C2_REAL_CLEANROOM_READBACK_SHA256);
  for (const needle of [
    C2_RAW_EVIDENCE_PRIMARY_PATH,
    C2_RAW_EVIDENCE_POST_RESTORE_PATH,
    C2_RAW_EVIDENCE_SHA256,
    C2_TESTED_HEAD,
    'bi-ks-01-net-revenue/v1',
    'DB_ANALYZE_CREDENTIAL_MISSING',
    'BUSINESS_BI_READ_ONLY_EVIDENCE_DENIED',
    'DB_ANALYZE_PRINCIPAL_NOT_READ_ONLY',
  ]) {
    assert.ok(readback.includes(needle), `readback names ${needle}`);
  }
  assert.ok(!readback.includes('CM_POSTGRESQL_PASSWORD'), 'readback does not reproduce credential material');
});

test('C2 real clean-room registration never rewrites the committed certificate or the frozen C1 bytes', async () => {
  // The committed certificate stays the exact deterministic source-local mint.
  const first = runScript(['--dry-run'], {env: {...process.env, PATH: ''}});
  const committed = await readFile(committedPath, 'utf8');
  assert.equal(committed, first.stdout, 'the C2 certificate is unchanged and byte-stable');
  assert.equal(
    JSON.parse(committed).realDisprovablePostgresql.state,
    'BLOCKED_EXTERNAL',
    "the certificate's own recorded real-PG state is not relabelled by the registration",
  );
});
