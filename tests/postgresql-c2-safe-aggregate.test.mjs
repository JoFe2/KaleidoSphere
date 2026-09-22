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
//          mutation of the ground truth is rejected by the oracle digest gate, and each
//          compute sabotage (UNKNOWN-to-zero, sign-flipping, double-count) is SUBMITTED
//          to the real executor and rejected by the real BUSINESS_BI_ORACLE_MISMATCH
//          gate, while a fully re-digested wrong result is rejected by the real
//          BUSINESS_BI_RESULT_SUBSTITUTION_DENIED gate. The compute arms are driven
//          through the product's closed fault seam (NET_REVENUE_COMPUTE_FAULTS), not by
//          comparing un-submitted in-memory clones, so deleting the product gate turns
//          the matrix RED.
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
import {rmSync} from 'node:fs';
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import test from 'node:test';

import {
  ADMITTED_HOLDOUT_SHA256,
  ADMITTED_METRIC_CONTRACT_SHA256,
  ADMITTED_ORACLE_SHA256,
  NET_REVENUE_COMPUTE_FAULTS,
  NET_REVENUE_OPERATION_ID,
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
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
// Fully re-digest a receipt so its own integrity hashes are recomputed: this is the
// "digest integrity holds but the business result is wrong" shape the AC03 falsifier
// must reject. The re-digested receipt is still refused by the real oracle gate.
const readdressReceipt = (receipt) => {
  receipt.resultSha256 = fileSha256(Buffer.from(canonicalJson(receipt.result)));
  receipt.outputSha256 = fileSha256(Buffer.from(canonicalJson(receipt.output)));
  const {receiptSha256: _discarded, ...body} = receipt;
  receipt.receiptSha256 = identitySha256(body);
  return receipt;
};

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

  // RED (compute tampering, driven through the REAL product gate): each sabotage is
  // submitted to the actual executor and must fail closed with the real
  // BUSINESS_BI_ORACLE_MISMATCH code. Comparing in-memory clones was vacuous — a clone
  // never submitted to the executor is trivially unequal to the oracle and would keep
  // passing even if the runtime oracle-equality gate were deleted. The seam therefore
  // corrupts the COMPUTED result inside executeNetRevenuePlan and the failure must come
  // from the product's own gate.
  const sabotageCodes = [];
  for (const fault of NET_REVENUE_COMPUTE_FAULTS) {
    let drivenCode = null;
    let thrown = null;
    try {
      await executeNetRevenuePlan({
        plan: probePlan,
        metricContractBytes,
        oracleBytes,
        read: syntheticRead(holdoutBytes),
        computeFault: fault,
      });
    } catch (error) {
      thrown = error;
      drivenCode = error.code ?? error.message;
    }
    assert.ok(thrown, `${fault} is rejected by the real executor, never accepted`);
    assert.equal(drivenCode, 'BUSINESS_BI_ORACLE_MISMATCH', `${fault} fails closed at the real runtime oracle-equality gate`);
    sabotageCodes.push(drivenCode);
  }
  // The matrix is genuinely RED and non-vacuous: an un-faulted execution of the exact
  // same seam-free call SUCCEEDS (GREEN), so the denial is caused by the injected wrong
  // business result and not by the probe shape.
  const greenProbe = await executeNetRevenuePlan({
    plan: probePlan,
    metricContractBytes,
    oracleBytes,
    read: syntheticRead(holdoutBytes),
  });
  assert.equal(greenProbe.execution.state, 'COMPLETE', 'GREEN control: the un-faulted execution completes');
  assert.equal(greenProbe.oracleEquality, 'EXACT', 'GREEN control: the un-faulted execution is oracle-exact');
  assert.equal(sabotageCodes.length, NET_REVENUE_COMPUTE_FAULTS.length);
  // The faults are a closed, enumerated registry: nothing outside it can be injected, and
  // an unknown fault is refused before any execution.
  let unknownFaultCode = null;
  try {
    await executeNetRevenuePlan({
      plan: probePlan,
      metricContractBytes,
      oracleBytes,
      read: syntheticRead(holdoutBytes),
      computeFault: 'NOT_A_REGISTERED_FAULT',
    });
  } catch (error) {
    unknownFaultCode = error.code ?? error.message;
  }
  assert.equal(unknownFaultCode, 'BUSINESS_BI_EXECUTION_INPUT_DENIED', 'the fault seam is closed: an unregistered fault is refused');

  // RED (result substitution at the receipt gate): a wrong-but-well-formed COMPLETE
  // receipt whose own digests are fully recomputed is still rejected by the real
  // BUSINESS_BI_RESULT_SUBSTITUTION_DENIED gate. Digest integrity therefore does NOT
  // rescue a wrong business result.
  const forgedReceipt = cloneJson(greenProbe);
  forgedReceipt.result.periods.current.netMinorUnits += 1;
  forgedReceipt.result.deltaMinorUnits += 1;
  forgedReceipt.output.rows[0].current_net_minor_units += 1;
  forgedReceipt.output.rows[0].delta_minor_units += 1;
  readdressReceipt(forgedReceipt);
  assert.notEqual(canonicalJson(forgedReceipt), canonicalJson(greenProbe), 'the forged receipt is genuinely different');
  assert.equal(forgedReceipt.resultSha256, fileSha256(Buffer.from(canonicalJson(forgedReceipt.result))), 'the forged result digest is fully recomputed (digest integrity holds)');
  assert.equal(forgedReceipt.receiptSha256, identitySha256((() => { const {receiptSha256: _r, ...rest} = forgedReceipt; return rest; })()), 'the forged receipt self-digest is fully recomputed');
  let substitutionCode = null;
  try {
    verifyNetRevenueExecutionReceipt({
      plan: probePlan,
      receipt: forgedReceipt,
      metricContractBytes,
      oracleBytes,
    });
  } catch (error) {
    substitutionCode = error.code ?? error.message;
  }
  assert.equal(substitutionCode, 'BUSINESS_BI_RESULT_SUBSTITUTION_DENIED', 'a re-digested wrong result is rejected by the real receipt-substitution gate');
  // The GREEN receipt still verifies, so the substitution gate specifically discriminates.
  verifyNetRevenueExecutionReceipt({
    plan: probePlan,
    receipt: greenProbe,
    metricContractBytes,
    oracleBytes,
  });
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
// The repository permits squash merges only, so the tested head was integrated as a
// single squash commit and its commit object no longer exists on Main. Equivalence is
// established by independently checkable content-level provenance (the squash commit's
// parent is exactly the recorded tested-head parent, and every byte the real run bound
// is byte-identical on Main), never by an unverifiable ancestor claim.
const C2_INTEGRATED_COMMIT = '33beed8f387216a73621e1ff1cb0354612fad0e1';
const C2_INTEGRATED_PARENT = 'e5edb163319598397ba7b7b223d2cd33d5b6b307';
const C2_INTEGRATED_MERGE_MODE = 'SQUASH';
const C2_ANCESTRY_DISPOSITION = 'REPLACED_BY_SQUASH';
// Every product/config/fixture/contract/certificate byte the tested run bound. The C2
// bytes are delivered by the C2 squash integration; the C1 substrate and admitted BI
// fixtures pre-exist it and must be byte-unchanged. None of these may appear in any
// post-integration bounded correction.
const C2_DELIVERED_BINDING_PATHS = [
  'services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs',
  'contracts/connectors/postgresql/c2-safe-aggregate-v1.json',
  'verification/postgresql-c2-safe-aggregate-v1.json',
  'scripts/run-postgresql-c2-safe-aggregate-clean-room.mjs',
];
const C2_PREEXISTING_BINDING_PATHS = [
  'contracts/connectors/postgresql/c1-profile-v1.json',
  'verification/postgresql/postgresql-c1-evidence-v1.json',
  'tests/fixtures/business-bi/net-revenue-holdout-v1.json',
  'tests/fixtures/business-bi/net-revenue-oracle-v1.json',
  'contracts/business-bi/v1/net-revenue.metric.json',
];
const C2_TESTED_BINDING_PATHS = [...C2_DELIVERED_BINDING_PATHS, ...C2_PREEXISTING_BINDING_PATHS];
const C2_RAW_EVIDENCE_PRIMARY_PATH = '.ks150-c2-real-cleanroom-primary-evidence.json';
const C2_RAW_EVIDENCE_POST_RESTORE_PATH = '.ks150-c2-real-cleanroom-post-restore-evidence.json';
const C2_RAW_EVIDENCE_SHA256 = 'b3c10b112edf72bbf6241691d686cc2adc7e4380e3a9a238618ac0f3dd9ca382';
const C2_REAL_CLEANROOM_PROVENANCE_PATH = 'verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json';
const C2_REAL_CLEANROOM_PROVENANCE_IDENTITY_SHA256 = '342ac1d037834e1b70aa22be9273d89097205acac4d9027a3168421783a9416d';
const C2_REAL_CLEANROOM_READBACK_PATH = 'docs/evidence/postgresql-c2-real-cleanroom/README.md';
const C2_REAL_CLEANROOM_READBACK_SHA256 = 'b2739ec7391c2a2233be22e764150597b08bf614119569b968fb549fa1d1dca3';
const C2_REAL_CLEANROOM_CERTIFICATE_RAW_SHA = '1d1ca03819f659cffc014d38b29b4cbab5890197a960a69ed003bb98b6affc7c';
const C2_REAL_CLEANROOM_CERTIFICATE_IDENTITY_SHA = 'ea335bbc0d0d18dd145420e733954bd57b6877aedce8739b17f97a407f634e76';
// Independently fixed historical endpoint: 4bf5575 delivered the actual C2 correction;
// c61d6b6 only appended WORK_RESULT.md. Never derive this endpoint from HEAD or provenance.
const C2_CORRECTION_COMMIT = '4bf55758904f04369afb74b6d185a511f731c71d';
// This allowlist governs only integration -> correction, not unrelated future work.
const ALLOWED_C2_CORRECTION_PATHS = new Set([
  // Bounded integration-infrastructure correction: the workflow must check out full
  // history so this integration-provenance test can resolve the recorded tested-head
  // base and the squash-integration commit and diff their trees; its changed bytes are
  // exactly bound to one identity hash.
  '.github/workflows/ci.yml',
  '.ks150-c2-real-cleanroom-post-restore-evidence.json',
  '.ks150-c2-real-cleanroom-primary-evidence.json',
  'SOURCE-MAP.json',
  'SOURCE-MAP.md',
  'WORK_RESULT.md',
  'docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json',
  'docs/evidence/postgresql-c2-real-cleanroom/README.md',
  'scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs',
  'tests/canonical-test-topology.test.mjs',
  'tests/postgresql-c1-certification.test.mjs',
  'tests/postgresql-c2-safe-aggregate.test.mjs',
  'verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json',
  // AC03 falsifier correction (generation 3): this product module gains the closed
  // compute fault seam so a wrong-but-well-formed COMPLETE result is submitted to the
  // real oracle/substitution gates. The change is additive and preserves every digest
  // the real VM clean room bound (the certificate and the plan/operation digests are
  // byte-identical), which the accompanying assertions below verify rather than assume.
  'services/bi-control/src/business-bi/net-revenue-plan.mjs',
]);

const assertC2CorrectionScope = ({cwd = root, integrated = C2_INTEGRATED_COMMIT,
  correction = C2_CORRECTION_COMMIT, head = 'HEAD',
  boundPaths = [...C2_TESTED_BINDING_PATHS, 'package.json']} = {}) => {
  const ancestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], {cwd}).status === 0;
  assert.ok(ancestor(integrated, correction), 'C2 integration must be an ancestor of the correction');
  assert.ok(ancestor(correction, head), 'C2 correction must be an ancestor of current HEAD');
  const historicalChanges = runGit(cwd, 'diff', '--name-only', integrated, correction).split('\n').filter(Boolean);
  assert.ok(historicalChanges.every((file) => ALLOWED_C2_CORRECTION_PATHS.has(file)),
    `changed files outside the bounded correction: ${historicalChanges.join(', ')}`);
  // Bound bytes remain protected through current HEAD, not just through the correction.
  const changed = runGit(cwd, 'diff', '--name-only', integrated, head).split('\n').filter(Boolean);
  for (const bound of boundPaths) {
    assert.ok(!changed.includes(bound), `${bound} is byte-identical since the squash integration`);
  }
  return changed;
};

// Synthetic git history only: no fixture contents or historical evidence are copied.
test('C2 provenance accepts an unrelated descendant after the fixed correction endpoint', async (t) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ks150-correction-scope-'));
  t.after(() => rmSync(dir, {recursive: true, force: true}));
  runGit(dir, 'init', '-q');
  runGit(dir, 'config', 'user.email', 'gate@localhost');
  runGit(dir, 'config', 'user.name', 'gate');
  runGit(dir, 'config', 'commit.gpgsign', 'false');
  const commit = async (file, bytes) => {
    await writeFile(path.join(dir, file), bytes);
    runGit(dir, 'add', file);
    runGit(dir, 'commit', '-q', '-m', file);
    return runGit(dir, 'rev-parse', 'HEAD');
  };
  const integrated = await commit('bound-c2.txt', 'frozen synthetic binding\n');
  const correction = await commit('WORK_RESULT.md', 'synthetic correction\n');
  await commit('unrelated-feature.txt', 'unrelated descendant\n');
  const options = {cwd: dir, integrated, correction, boundPaths: ['bound-c2.txt']};
  assert.doesNotThrow(() => assertC2CorrectionScope(options));
  await t.test('bound C2 modifications after correction still fail closed', async () => {
    await commit('bound-c2.txt', 'tampered synthetic binding\n');
    assert.throws(() => assertC2CorrectionScope(options), /bound-c2\.txt is byte-identical/);
    await commit('bound-c2.txt', 'frozen synthetic binding\n');
    assert.doesNotThrow(() => assertC2CorrectionScope(options));
  });
  await t.test('historical out-of-scope changes fail even when reverted at HEAD', async () => {
    const outOfScopeCorrection = runGit(dir, 'rev-parse', 'HEAD');
    runGit(dir, 'rm', '-q', 'unrelated-feature.txt');
    runGit(dir, 'commit', '-q', '-m', 'remove unrelated synthetic path');
    assert.throws(() => assertC2CorrectionScope({...options, correction: outOfScopeCorrection}),
      /changed files outside the bounded correction:.*unrelated-feature\.txt/);
    assert.doesNotThrow(() => assertC2CorrectionScope(options));
  });
  await t.test('correction ancestry must reach current HEAD', () => {
    assert.throws(() => assertC2CorrectionScope({...options, head: integrated}),
      /correction must be an ancestor of current HEAD/);
    assert.throws(() => assertC2CorrectionScope({...options, integrated: 'HEAD'}),
      /integration must be an ancestor of the correction/);
  });
});

const git = (...args) => execFileSync('git', [...args], {cwd: root, encoding: 'utf8'}).trim();
// True existence probe for a commit object: `git cat-file -e <sha>^{commit}` exits
// non-zero when the object is genuinely absent and exits zero when it exists. This is
// deliberately NOT `git rev-parse <sha>` (which echoes any syntactically valid 40-hex
// string with exit 0 even when no such object exists, so it can never prove presence)
// and NOT a bare try/catch around `rev-parse` (whose outcome depends on whether the
// host happened to retain the object, which is exactly the flake this test must not
// reproduce).
const hasCommit = (sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {cwd: root}).status === 0;
// Ancestry probe. `merge-base --is-ancestor` reports reachability from the commit graph
// and needs only the ancestor object when it is present; a non-zero exit is the stable
// "not an ancestor" answer under the squash-only policy.
const isAncestor = (maybeAncestor, descendant) =>
  spawnSync('git', ['merge-base', '--is-ancestor', maybeAncestor, descendant], {cwd: root}).status === 0;

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
  // Squash-integration equivalence (the repository permits squash merges only, so the
  // tested head's ancestry was REPLACED, not preserved). The check is content-level and
  // independently verifiable from tracked source alone; it never asserts an ancestor
  // relation the merge policy cannot satisfy.
  assert.equal(provBody.integration.recordKind, 'SQUASH_INTEGRATION_EQUIVALENCE');
  assert.equal(provBody.integration.repositoryMergePolicy, 'SQUASH_ONLY');
  assert.equal(provBody.integration.mergeMode, C2_INTEGRATED_MERGE_MODE);
  assert.equal(provBody.integration.ancestryDisposition, C2_ANCESTRY_DISPOSITION);
  assert.equal(provBody.integration.testedHead, C2_TESTED_HEAD);
  assert.equal(provBody.integration.testedHeadParent, C2_TESTED_HEAD_PARENT);
  assert.equal(provBody.integration.testedHeadTree, C2_TESTED_HEAD_TREE);
  assert.equal(provBody.integration.testedHeadSubject, C2_TESTED_HEAD_SUBJECT);
  assert.equal(provBody.integration.integratedCommit, C2_INTEGRATED_COMMIT);
  assert.equal(provBody.integration.integratedCommitParent, C2_INTEGRATED_PARENT);
  // Independent check 1 — the integrated squash commit is the exact recorded commit and
  // its parent is exactly the recorded tested-head parent (the base the tested head was
  // built on). This is a real, resolvable git fact, not a self-attested hash.
  assert.equal(git('rev-parse', `${C2_INTEGRATED_COMMIT}^{commit}`), C2_INTEGRATED_COMMIT);
  assert.equal(git('rev-parse', `${C2_INTEGRATED_COMMIT}^`), C2_TESTED_HEAD_PARENT);
  assert.equal(git('rev-parse', `${C2_INTEGRATED_COMMIT}^{tree}`), provBody.integration.integratedCommitTree);
  // Independent check 2 — evidence equivalence is asserted on facts that hold on EVERY
  // host, never on the incidental presence or absence of one loose object.
  //
  // An earlier correction asserted that the tested head must NOT resolve. That is a
  // host-dependent expectation, not a repository fact: GitHub's pull-request checkout
  // (actions/checkout@v4, fetch-depth: 0) fetches the PR head ref, so the exact tested
  // head object IS retained there and resolves, while a clone that never fetched that
  // ref does not have it. The assertion therefore failed on CI while passing locally —
  // a flake, and a vacuous one: object absence proves nothing about whether the
  // delivered bytes equal the tested bytes.
  //
  // The stable, host-independent facts are: the integrated squash commit and its parent
  // are real commits reachable on Main; the integrated parent is exactly the recorded
  // tested-head parent (so the squash was applied onto precisely the base the tested
  // head was built on); and the delivered content is byte-equivalent to the tested
  // bindings. Presence is verified when available, never required, and never asserted
  // either way.
  if (hasCommit(C2_TESTED_HEAD)) {
    // On a host that retained the tested head (the real CI checkout), the recorded
    // identities must match the actual object — strictly more verification, not less.
    assert.equal(git('rev-parse', `${C2_TESTED_HEAD}^{commit}`), C2_TESTED_HEAD);
    assert.equal(git('rev-parse', `${C2_TESTED_HEAD}^{tree}`), C2_TESTED_HEAD_TREE);
    assert.equal(git('rev-parse', `${C2_TESTED_HEAD}^`), C2_TESTED_HEAD_PARENT);
    assert.equal(git('log', '-1', '--format=%s', C2_TESTED_HEAD), C2_TESTED_HEAD_SUBJECT);
  }
  // Whatever the tested-head object's availability, the ancestry disposition is stable:
  // ancestry was REPLACED by the squash, so the tested head is not an ancestor of HEAD.
  assert.equal(isAncestor(C2_TESTED_HEAD, 'HEAD'), false, 'the tested head is not an ancestor of HEAD under the squash-only policy');
  // Independent check 3 — content equivalence, measured against the two git facts that
  // actually exist on Main (the recorded tested-head base and the squash integration),
  // never against the unresolvable tested head.
  //
  // (3a) Every byte the tested run bound is delivered by the squash integration itself:
  // each binding path differs from the recorded base because the integration introduced
  // it. This proves the binding bytes are the delivered C2 source, not pre-existing or
  // absent bytes.
  const deliveredByIntegration = git('diff', '--name-only', C2_TESTED_HEAD_PARENT, C2_INTEGRATED_COMMIT).split('\n').filter(Boolean);
  for (const bound of C2_DELIVERED_BINDING_PATHS) {
    assert.ok(
      deliveredByIntegration.includes(bound),
      `${bound} is delivered by the C2 squash integration`,
    );
  }
  // (3a') Every pre-existing bound byte (the frozen C1 substrate and the admitted BI
  // fixtures) is NOT touched by the C2 integration: the C2 work layers on them additively.
  for (const bound of C2_PREEXISTING_BINDING_PATHS) {
    assert.ok(
      !deliveredByIntegration.includes(bound),
      `${bound} pre-exists the C2 integration and is not modified by it`,
    );
  }
  // (3b) The historical correction alone is allowlisted. Its fixed endpoint must
  // descend from integration and remain an ancestor of HEAD; every bound path and
  // package.json must still be byte-identical from integration through current HEAD.
  assertC2CorrectionScope();
  // Preserve the historical full-history correction exactly. The current workflow
  // adds pinned PGlite connected and guided journey tests without relaxing retained gates.
  assert.equal(
    fileSha256(Buffer.from(`${git('show', `${C2_CORRECTION_COMMIT}:.github/workflows/ci.yml`)}\n`)),
    '92cb8d81f7b751eb9c9fe80bbc263072f67291185548aebac79c411345677eb9',
  );
  assert.equal(
    fileSha256(await readFile(path.join(root, '.github/workflows/ci.yml'))),
    'e80a398ac72a59f159ffdd5f1e3cbef35a7c7d3041b637d3ce4b101c01dd0837',
  );
  // (3c) The delivered product bytes carry exactly the digests the tested run bound.
  assert.equal(fileSha256(await readFile(profilePath)), C1_PROFILE_SHA256);
  assert.equal(fileSha256(await readFile(c1CertPath)), C1_CERTIFICATE_SHA256);
  assert.equal(fileSha256(await readFile(metricPath)), ADMITTED_METRIC_CONTRACT_SHA256);
  assert.equal(fileSha256(await readFile(holdoutPath)), ADMITTED_HOLDOUT_SHA256);
  assert.equal(fileSha256(await readFile(oraclePath)), ADMITTED_ORACLE_SHA256);
  // The generation-3 AC03 correction touches the net-revenue plan MODULE's source, so its
  // justification must be checked, not assumed: the real VM run bound the plan and
  // operation DIGESTS, and those are re-derived here from the corrected module. If the
  // correction had changed any bound product behavior, these digests would move and the
  // real-run evidence would no longer describe this source.
  const {compileNetRevenuePlan, createNetRevenueOperationRequest} = await import('../services/bi-control/src/business-bi/net-revenue-plan.mjs');
  const rederivedPlan = compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes: await readFile(metricPath),
    oracleBytes: await readFile(oraclePath),
  });
  assert.equal(rederivedPlan.planSha256, provBody.bindings.planSha256, 'the corrected module still derives the plan digest the real run bound');
  assert.equal(rederivedPlan.bindings.operationSha256, provBody.bindings.operationSha256, 'the corrected module still derives the operation digest the real run bound');
  // The provenance binds the committed deterministic C2 certificate and the real
  // execution record to the same certified C1 substrate and admitted inputs.
  assert.equal(provBody.certificate.path, 'verification/postgresql-c2-safe-aggregate-v1.json');  assert.equal(provBody.certificate.sha256, C2_REAL_CLEANROOM_CERTIFICATE_RAW_SHA);
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

// ---------------------------------------------------------------------------
// Squash-integration topology and tamper tests (native postmerge fix-forward).
//
// The repository permits squash merges only, so the exact-head-reviewed candidate was
// integrated as one squash commit and the tested head's ancestry was REPLACED. These
// tests supply independently checkable equivalent provenance and prove, positively and
// negatively, that a forged ancestor/topology/tamper claim cannot pass.
// ---------------------------------------------------------------------------

test('the squash integration topology is positively proven from tracked git facts', async () => {
  const provenanceBytes = await readFile(path.join(root, C2_REAL_CLEANROOM_PROVENANCE_PATH), 'utf8');
  const provenance = JSON.parse(provenanceBytes);
  const {provenanceSha256: _self, ...provBody} = provenance;
  // The integrated squash commit's parent is exactly the recorded tested-head parent.
  assert.equal(git('rev-parse', `${provBody.integration.integratedCommit}^`), provBody.integration.testedHeadParent);
  // The recorded parent is a genuine reachable ancestor of HEAD. This is checked with
  // the stable probe, which reports the same true/false outcome on every host and does
  // not depend on whether the (separate, squash-replaced) tested-head object exists.
  assert.equal(isAncestor(provBody.integration.testedHeadParent, 'HEAD'), true, 'the recorded tested-head parent is an ancestor of HEAD');
  // Every bound byte path is tracked at the integrated commit (it is real delivered source).
  for (const bound of C2_TESTED_BINDING_PATHS) {
    const tracked = git('ls-files', '--error-unmatch', bound);
    assert.equal(tracked, bound, `${bound} is tracked on Main`);
  }
  // The integrated commit has exactly one parent (a squash, not a merge commit).
  assert.equal(git('rev-list', '--parents', '-n', '1', provBody.integration.integratedCommit).split(' ').length, 2);
});

test('a forged ancestor-preserving or tampered topology claim fails closed', async () => {
  const provenancePathAbs = path.join(root, C2_REAL_CLEANROOM_PROVENANCE_PATH);
  const original = await readFile(provenancePathAbs, 'utf8');
  const parse = () => JSON.parse(original);
  // A tampered provenance body no longer re-derives its pinned self-digest.
  const tamperedBody = parse();
  tamperedBody.integration.testedHeadParent = '0'.repeat(40);
  const {provenanceSha256: _drop, ...tamperedRest} = tamperedBody;
  assert.notEqual(
    identitySha256(tamperedRest),
    tamperedBody.provenanceSha256,
    'a substituted tested-head parent breaks the provenance self-digest',
  );
  // A forged "ancestor-preserving" claim is refused: the recorded policy is squash-only
  // and the tested head is genuinely not an ancestor of HEAD (checked with the stable
  // probe, independent of whether the tested-head object happens to be retained), so the
  // ancestor assertion cannot hold.
  const forged = parse();
  forged.integration.mergeMode = 'MERGE_COMMIT';
  forged.integration.ancestryDisposition = 'PRESERVED';
  assert.notEqual(forged.integration.mergeMode, C2_INTEGRATED_MERGE_MODE, 'merge mode is squash, not a merge commit');
  assert.notEqual(forged.integration.ancestryDisposition, C2_ANCESTRY_DISPOSITION, 'ancestry was replaced, not preserved');
  const forgedAncestorHolds = isAncestor(C2_TESTED_HEAD, 'HEAD');
  assert.equal(forgedAncestorHolds, false, 'an ancestor-preserving claim is falsified by the real repository state');
  // A substituted squash commit identity fails closed against the recorded commit.
  const wrongCommit = parse();
  wrongCommit.integration.integratedCommit = 'f'.repeat(40);
  assert.notEqual(wrongCommit.integration.integratedCommit, C2_INTEGRATED_COMMIT);
  throws(() => git('rev-parse', `${wrongCommit.integration.integratedCommit}^{commit}`));
  // The working-tree provenance is unchanged by these in-memory tamper probes.
  assert.equal(await readFile(provenancePathAbs, 'utf8'), original, 'tamper probes never rewrite tracked bytes');
});

test('the readback evidence and provenance both record the squash ancestry disposition', async () => {
  const provenance = JSON.parse(await readFile(path.join(root, C2_REAL_CLEANROOM_PROVENANCE_PATH), 'utf8'));
  const readback = await readFile(path.join(root, C2_REAL_CLEANROOM_READBACK_PATH), 'utf8');
  assert.equal(provenance.integration.ancestryDisposition, 'REPLACED_BY_SQUASH');
  assert.equal(provenance.integration.mergeMode, 'SQUASH');
  assert.ok(readback.includes('REPLACED_BY_SQUASH'), 'the human readback records the squash ancestry disposition');
  assert.ok(readback.includes('SQUASH_ONLY'), 'the human readback names the repository merge policy');
  assert.ok(
    !/is an ancestor of the correction head/.test(readback),
    'the readback no longer asserts an unverifiable ancestor relation',
  );
});

// ---------------------------------------------------------------------------
// Host-independence regression for the squash-integration provenance check.
//
// The retained CI failure was a host-dependent expectation: the check asserted that the
// tested head must NOT resolve. GitHub's PR checkout retains the PR-head object (so it
// resolves) while a squash-only clone without that ref does not (so it does not). The
// verdict flipped with the host, so the gate passed locally and failed on CI.
//
// These two tests build both topologies as REAL git repositories and prove the corrected
// check returns the same verdict on each: presence is verified when available and never
// required, absence is never asserted, and the stable ancestry/content facts hold either
// way. They are the positive/negative pair for the fix itself.
// ---------------------------------------------------------------------------

const runGit = (cwd, ...args) => execFileSync('git', [...args], {cwd, encoding: 'utf8'}).trim();

// Build a real repo with the squash-only topology, optionally retaining the pre-squash
// commit object (the CI case) or leaving it unreachable (the local-clone case). The
// candidate commit is created with `commit-tree` so that, when not retained, it never
// becomes reachable through any ref and can be dropped deterministically — exactly the
// state a clone that never fetched the PR head ref is in. The squash integration carries
// the registration correction on top of the candidate tree, so it is a genuinely
// distinct commit object (a real squash commit never equals its source commit).
const buildSquashTopology = async ({retainTestedHead}) => {
  const dir = await mkdtemp(path.join(tmpdir(), 'ks150-squash-topology-'));
  runGit(dir, 'init', '-q');
  runGit(dir, 'config', 'user.email', 'gate@localhost');
  runGit(dir, 'config', 'user.name', 'gate');
  runGit(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(dir, 'base.txt'), 'base\n', 'utf8');
  runGit(dir, 'add', 'base.txt');
  runGit(dir, 'commit', '-q', '-m', 'base');
  const base = runGit(dir, 'rev-parse', 'HEAD');
  // The exact-head-reviewed candidate (the "tested head") and its tree. `commit-tree`
  // creates the object without ever pointing a ref at it.
  await writeFile(path.join(dir, 'c2.json'), '{}\n', 'utf8');
  runGit(dir, 'add', 'c2.json');
  const candidateTree = runGit(dir, 'write-tree');
  const testedHead = runGit(dir, 'commit-tree', candidateTree, '-p', base, '-m', 'PostgreSQL C2 (#150)');
  // Squash-only integration: one new commit on top of `base` carrying the candidate tree
  // plus the later bounded registration correction, so it has its own distinct tree.
  await writeFile(path.join(dir, 'registration.json'), '{"registered":true}\n', 'utf8');
  runGit(dir, 'add', 'registration.json');
  const integratedTree = runGit(dir, 'write-tree');
  const integrated = runGit(dir, 'commit-tree', integratedTree, '-p', base, '-m', 'PostgreSQL C2 (#150) with registration');
  runGit(dir, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  runGit(dir, 'update-ref', 'refs/heads/main', integrated);
  runGit(dir, 'branch', '-D', 'master');
  runGit(dir, 'checkout-index', '-a', '-f');
  if (!retainTestedHead) {
    // Drop the candidate object exactly, as a clone that never fetched the PR ref. The
    // object is written loose (it was never committed through a ref), so removing its
    // loose file is a deterministic absence — no reliance on `gc` grace-period
    // heuristics, which would otherwise keep a freshly created object around.
    runGit(dir, 'reflog', 'expire', '--expire=now', '--all');
    rmSync(path.join(dir, '.git', 'objects', testedHead.slice(0, 2), testedHead.slice(2)), {force: true});
  }
  return {dir, base, testedHead, testedHeadTree: candidateTree, integrated, integratedTree};
};

// The corrected check, expressed exactly as the production test uses it. It must never
// require absence and never require presence.
const squashVerdict = (dir, {testedHead, base, integrated}) => {
  const probe = (sha) => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], {cwd: dir}).status === 0;
  const ancestor = (a, b) => spawnSync('git', ['merge-base', '--is-ancestor', a, b], {cwd: dir}).status === 0;
  return {
    integratedParentIsRecordedBase: runGit(dir, 'rev-parse', `${integrated}^`) === base,
    testedHeadRetained: probe(testedHead),
    testedHeadIsAncestor: ancestor(testedHead, 'HEAD'),
  };
};

test('the corrected squash check is host-independent when the tested head is retained (CI host)', async () => {
  const repo = await buildSquashTopology({retainTestedHead: true});
  const verdict = squashVerdict(repo.dir, repo);
  // The CI host retains the object, so the OLD check (assert absence) would have failed.
  assert.equal(verdict.testedHeadRetained, true, 'this topology retains the tested-head object');
  // The corrected check still yields the stable conclusion on this host.
  assert.equal(verdict.integratedParentIsRecordedBase, true);
  assert.equal(verdict.testedHeadIsAncestor, false, 'the tested head is still not an ancestor under squash-only');
});

test('the corrected squash check is host-independent when the tested head is absent (clone host)', async () => {
  const repo = await buildSquashTopology({retainTestedHead: false});
  const verdict = squashVerdict(repo.dir, repo);
  assert.equal(verdict.testedHeadRetained, false, 'this topology does not retain the tested-head object');
  assert.equal(verdict.integratedParentIsRecordedBase, true);
  assert.equal(verdict.testedHeadIsAncestor, false, 'the tested head is not an ancestor under squash-only');
});

test('the corrected squash check rejects a genuinely ancestor-preserving topology (negative)', async () => {
  // A real merge-style topology that DOES preserve the tested head as an ancestor must be
  // detected as preserved, so the check is falsifiable and not vacuously true.
  const dir = await mkdtemp(path.join(tmpdir(), 'ks150-merge-topology-'));
  runGit(dir, 'init', '-q');
  runGit(dir, 'config', 'user.email', 'gate@localhost');
  runGit(dir, 'config', 'user.name', 'gate');
  runGit(dir, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(dir, 'base.txt'), 'base\n', 'utf8');
  runGit(dir, 'add', 'base.txt');
  runGit(dir, 'commit', '-q', '-m', 'base');
  const base = runGit(dir, 'rev-parse', 'HEAD');
  runGit(dir, 'checkout', '-q', '-b', 'feature');
  await writeFile(path.join(dir, 'c2.json'), '{}\n', 'utf8');
  runGit(dir, 'add', 'c2.json');
  runGit(dir, 'commit', '-q', '-m', 'PostgreSQL C2 (#150)');
  const testedHead = runGit(dir, 'rev-parse', 'HEAD');
  runGit(dir, 'checkout', '-q', '-B', 'main', base);
  runGit(dir, 'merge', '-q', '--no-ff', '-m', 'integration', 'feature');
  const integrated = runGit(dir, 'rev-parse', 'HEAD');
  const verdict = squashVerdict(dir, {testedHead, base, integrated});
  assert.equal(verdict.testedHeadRetained, true);
  assert.equal(verdict.testedHeadIsAncestor, true, 'an ancestor-preserving integration is detected as preserved');
  // The recorded squash disposition is therefore FALSIFIED by this real topology.
  assert.notEqual(verdict.testedHeadIsAncestor, C2_ANCESTRY_DISPOSITION === 'REPLACED_BY_SQUASH' ? false : true);
});
