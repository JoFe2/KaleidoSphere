import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  NO_GO,
  OUTCOME,
  RECEIPT_SCHEMA,
  runDryRun,
} from '../scripts/dry-run-synthetic-connector-spike.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCRIPT = fileURLToPath(new URL('../scripts/dry-run-synthetic-connector-spike.mjs', import.meta.url));
const FIXTURE = fileURLToPath(new URL('../docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json', import.meta.url));

function runCli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('finite simulated sequence produces local read-only receipt with cleanup and readback evidence', async () => {
  const result = await runDryRun({ fixturePath: FIXTURE, simulate: true, authorizationEvidence: true });

  assert.equal(result.schemaVersion, RECEIPT_SCHEMA);
  assert.equal(result.outcome, OUTCOME);
  assert.equal(result.classification, 'LOCAL_DRY_RUN');
  assert.equal(result.simulated, true);
  assert.equal(result.connectorExecuted, false);
  assert.equal(result.mcpExecuted, false);
  assert.equal(result.networkAccessed, false);
  assert.equal(result.spikeAuthorized, false);
  assert.deepEqual(result.simulatedActions.map(({ action }) => action), [
    'enumerate_collections', 'count_records', 'read_record',
  ]);
  assert.deepEqual(result.simulatedActions.map(({ mutates, external }) => ({ mutates, external })), [
    { mutates: false, external: false },
    { mutates: false, external: false },
    { mutates: false, external: false },
  ]);
  assert.equal(result.preflight.status, 'NO-GO');
  assert.equal(result.preflight.decision, 'NO_GO');
  assert.deepEqual(result.preflight.gates.map(({ status }) => status), Array(6).fill('NOT_GRANTED'));
  assert.equal(result.preflight.callerAuthoredAuthorityAccepted, false);
  assert.deepEqual(result.preflight.internalValidation, {
    plan: 'RELEASED', fixture: 'RELEASED', authorizesSpike: false,
  });
  assert.equal(result.boundedReadOnly.requestBudget.used, 3);
  assert.equal(result.boundedReadOnly.retryBudget.used, 0);
  assert.equal(result.boundedReadOnly.mutationCount, 0);
  assert.deepEqual(result.stop, { status: 'NOT_TRIGGERED', trigger: null });
  assert.equal(result.cleanup.status, 'PASS');
  assert.equal(result.cleanup.filesystemRestored, true);
  assert.equal(result.readback.manifestMatch, true);
  assert.equal(result.readback.byteIdentical, true);
  assert.equal(result.receiptIntegrity.finite, true);
  assert.equal(result.receiptIntegrity.externalEvidence, false);
});

test('required CLI invocation emits one successful local receipt', async () => {
  const result = await runCli(['--fixture', 'docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json', '--simulate']);
  assert.equal(result.code, 0, result.stderr);
  const receipt = JSON.parse(result.stdout);
  assert.equal(receipt.outcome, OUTCOME);
  assert.equal(receipt.simulated, true);
  assert.equal(receipt.cleanup.status, 'PASS');
  assert.equal(receipt.readback.manifestMatch, true);
});

test('absent authorization is NO-GO and creates no simulated action receipt', async () => {
  const result = await runDryRun({ fixturePath: FIXTURE, simulate: true, authorizationEvidence: false });
  assert.equal(result.outcome, NO_GO);
  assert.ok(result.reasonCodes.includes('AUTH-ABSENT'));
  assert.equal(result.simulatedActionReceipt, null);
  assert.equal(result.simulated, false);
});

test('absent predecessor evidence is NO-GO and creates no simulated action receipt', async () => {
  const result = await runDryRun({ fixturePath: FIXTURE, simulate: true, authorizationEvidence: true, predecessorEvidence: false });
  assert.equal(result.outcome, NO_GO);
  assert.ok(result.reasonCodes.includes('PREFLIGHT-NO-GO'));
  assert.equal(result.simulatedActionReceipt, null);
});

for (const [input, reasonCode] of [
  ['network', 'NEG-02'],
  ['public-bind', 'NEG-02'],
  ['hosted-endpoint', 'NEG-02'],
  ['credentials', 'NEG-01'],
  ['customer-payload', 'NEG-03'],
  ['mutation', 'NEG-04'],
  ['unbounded-retry', 'NEG-05'],
]) {
  test(`prohibited ${input} input is rejected before simulation`, async () => {
    const result = await runDryRun({
      fixturePath: FIXTURE,
      simulate: true,
      authorizationEvidence: true,
      prohibitedInputs: [input],
    });
    assert.equal(result.outcome, NO_GO);
    assert.ok(result.reasonCodes.includes(reasonCode));
    assert.equal(result.simulatedActionReceipt, null);
    assert.equal(result.simulated, false);
  });
}

test('schema-valid fixtures missing required simulation data fail closed structurally', async () => {
  const source = JSON.parse(await readFile(FIXTURE, 'utf8'));
  const cases = [
    ['catalog collection', (copy) => { copy.fixture.collections = copy.fixture.collections.filter(({ id }) => id !== 'catalog'); }],
    ['telemetry collection', (copy) => { copy.fixture.collections = copy.fixture.collections.filter(({ id }) => id !== 'telemetry'); }],
    ['first catalog record', (copy) => { copy.fixture.collections.find(({ id }) => id === 'catalog').records = []; }],
  ];

  const directory = await mkdtemp(join(tmpdir(), 'ks92-incomplete-fixture-'));
  try {
    for (const [missing, mutate] of cases) {
      const copy = structuredClone(source);
      mutate(copy);
      const canonical = stableJsonForTest(copy.fixture.collections);
      copy.manifest.sha256 = `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
      const path = join(directory, `${missing.replaceAll(' ', '-')}.json`);
      await writeFile(path, `${JSON.stringify(copy, null, 2)}\n`);

      const receipt = await runDryRun({ fixturePath: path, simulate: true, authorizationEvidence: true });
      assert.equal(receipt.outcome, NO_GO, missing);
      assert.equal(receipt.simulated, false, missing);
      assert.equal(receipt.simulatedActionReceipt, null, missing);
      assert.ok(receipt.reasonCodes.includes('FIXTURE-SIMULATION-SHAPE'), missing);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

function stableJsonForTest(value) {
  if (Array.isArray(value)) return `[${value.map(stableJsonForTest).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJsonForTest(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

test('missing or malformed fixture fails closed before simulation', async () => {
  const result = await runDryRun({ fixturePath: 'docs/future/remote-connector/fixtures/does-not-exist.json', simulate: true, authorizationEvidence: true });
  assert.equal(result.outcome, NO_GO);
  assert.equal(result.simulatedActionReceipt, null);
});

test('CLI without explicit simulation is non-zero and has no action receipt', async () => {
  const result = await runCli(['--fixture', 'docs/future/remote-connector/fixtures/synthetic-connector-fixture-v1.json']);
  assert.equal(result.code, 2);
  const noGo = JSON.parse(result.stdout);
  assert.equal(noGo.outcome, NO_GO);
  assert.equal(noGo.simulatedActionReceipt, null);
});

assert.ok((await readFile(FIXTURE, 'utf8')).includes('HAND_AUTHORED_SYNTHETIC'));