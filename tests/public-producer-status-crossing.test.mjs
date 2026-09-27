import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { crossPublicProducerStatus, PUBLIC_PAN_MAIN } from '../services/bi-control/src/business-bi/public-producer-status-crossing-v1.mjs';

const pan = process.env.PAN_PUBLIC_CHECKOUT;
const ksRoot = path.resolve(new URL('..', import.meta.url).pathname);
const fd = 'tests/fixtures/business-bi/ks256-lifecycle-transfer-status/';
const ksJson = (rel) => JSON.parse(readFileSync(path.join(ksRoot, rel)));
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const fixtureProject = () => ({ declaredProject: ksJson(fd + 'project-declaration-v1.json'),
  observedScope: ksJson(fd + 'observed-scope-v1.json'), transfer: ksJson(fd + 'transfer-v1.json'),
  quarantine: ksJson(fd + 'quarantine-v1.json'), lifecycleObservation: ksJson(fd + 'lifecycle-observation-v1.json'),
  retainedComparisonRows: ksJson('tests/fixtures/business-bi/net-revenue-segment-v1.json').rows,
  evidenceRevision: 'ks256-status-observation-v1', now: '2026-09-23T00:00:00.000Z', repoRoot: ksRoot });

test('fail-closed without explicit public source identity, byte inputs, and write authority', () => {
  assert.equal(crossPublicProducerStatus().code, 'PUBLIC_PRODUCER_INPUT_REQUIRED');
  assert.equal(crossPublicProducerStatus({ panMain: PUBLIC_PAN_MAIN, pan461: {}, pan471: {},
    lifecycle: {}, capability: {}, project: fixtureProject() }).code, 'PUBLIC_PRODUCER_INPUT_REQUIRED');
});

// Actual public PAN producer calls, not mocks. This opt-in suite is run by the
// delivery owner against a separately selected, exact, clean public checkout;
// ordinary KS CI does not pretend that the external checkout is bundled.
test('exact public PAN461/PAN471 crossing, byte-bound rebind and denial cases', { skip: !pan }, async () => {
  assert.equal(execFileSync('git', ['-C', pan, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), PUBLIC_PAN_MAIN);
  assert.equal(execFileSync('git', ['-C', pan, 'status', '--porcelain'], { encoding: 'utf8' }).trim(), '');
  const read = (rel) => readFileSync(path.join(pan, rel));
  const pan461 = await import(pathToFileURL(path.join(pan, 'src/pan461/lifecycle-inventory.mjs')).href);
  const pan471 = await import(pathToFileURL(path.join(pan, 'src/pan471/capability-inventory.mjs')).href);
  const declaredRelease = pan461.makeDeclaredRelease(JSON.parse(read('tests/fixtures/pan461/declared-release-content-v1.json')));
  const lifecycle = { declaredRelease, observed: read('tests/fixtures/pan461/observed-running-v1.json'),
    persistentStores: JSON.parse(read('tests/fixtures/pan461/stores-v1.json')),
    keyRefs: JSON.parse(read('tests/fixtures/pan461/key-refs-v1.json')),
    artifacts: JSON.parse(read('tests/fixtures/pan461/artifacts-v1.json')),
    now: '2026-09-23T10:00:00Z' };
  const capability = { contract: JSON.parse(read('tests/fixtures/erp-read/contract-v1.json')),
    sourceBytes: read('tests/fixtures/erp-read/supported-export-v1.json'), now: '2026-08-10T08:30:00Z' };
  const base = { panMain: PUBLIC_PAN_MAIN, pan461, pan471, lifecycle, capability, project: fixtureProject() };
  const result = crossPublicProducerStatus(base);
  assert.equal(result.outcome, 'PROJECTED', JSON.stringify(result));
  assert.equal(result.producerStatus.lifecycle.state, 'RUNNING');
  assert.equal(result.producerStatus.lifecycle.observedBytesSha256, hash(lifecycle.observed));
  assert.equal(result.producerStatus.capabilities.sourceBytesSha256, hash(capability.sourceBytes));
  assert.equal(result.producerStatus.capabilities.coverage.find(c => c.kind === 'ERP_ORDER_CREATE').availability, 'UNAVAILABLE');
  assert.equal(result.ksBoard.executionFacets.producerCrossing, 'NOT_EXECUTED'); // baseline is not rewritten
  assert.equal(result.producerStatus.promotedToKsLifecycle, false);
  assert.equal(result.ksBoard.authority.writeAuthority, 'NOT_GRANTED');
  assert.equal(result.mutationCount, 0);
  const originalL = pan461.createPan461LifecycleInventory(lifecycle);
  const originalC = pan471.createPan471CapabilityInventory(capability);
  const changedL = Buffer.from(lifecycle.observed.toString().replace('RUNNING', 'STOPPED'));
  assert.notEqual(hash(changedL), hash(lifecycle.observed));
  assert.equal(crossPublicProducerStatus({ ...base, lifecycle: { ...lifecycle, observed: changedL },
    carriedLifecycle: { binding: originalL.binding, bindingDigest: originalL.bindingDigest } }).code, 'PAN461_REBIND_SERIALIZED_BINDING_MISMATCH');
  const changedC = read('tests/fixtures/erp-read/matched-export-v1.json');
  assert.notEqual(hash(changedC), hash(capability.sourceBytes));
  assert.equal(crossPublicProducerStatus({ ...base, capability: { ...capability, sourceBytes: changedC },
    carriedCapability: { binding: originalC.binding, bindingDigest: originalC.bindingDigest } }).code, 'PAN471_REBIND_SERIALIZED_BINDING_MISMATCH');
  const forged = structuredClone(originalC.binding);
  forged.sourceIdentity.sourceBytesSha256 = '0'.repeat(64);
  assert.equal(crossPublicProducerStatus({ ...base, carriedCapability: {
    binding: forged, bindingDigest: hash(JSON.stringify(forged)) } }).code, 'PAN471_REBIND_SERIALIZED_BINDING_MISMATCH');
  assert.equal(crossPublicProducerStatus({ ...base, project: { ...base.project,
    evidenceRevision: 'stale-revision' } }).code, 'KS256_PROJECT_STATUS_EVIDENCE_REVISION_STALE');
  assert.equal(crossPublicProducerStatus({ ...base, project: { ...base.project,
    requestedAction: 'MIGRATE' } }).code, 'PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED');
  assert.equal(crossPublicProducerStatus({ ...base, panMain: '0'.repeat(40) }).code, 'PUBLIC_PRODUCER_INPUT_REQUIRED');
});

test('runnable entry point refuses missing checkout; executes exact public producer source when supplied', { skip: !pan }, () => {
  const script = path.join(ksRoot, 'scripts/run-ks256-public-producer-crossing.mjs');
  const missing = spawnSync(process.execPath, [script], { encoding: 'utf8', cwd: ksRoot });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).code, 'PUBLIC_PRODUCER_CHECKOUT_REQUIRED');
  const run = spawnSync(process.execPath, [script, '--pan-checkout', pan], { encoding: 'utf8', cwd: ksRoot });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const board = JSON.parse(run.stdout);
  assert.equal(board.producerCrossing, 'EXECUTED_AND_REBOUND_LOCAL_SYNTHETIC');
  assert.equal(board.producerStatus.panMain, PUBLIC_PAN_MAIN);
  assert.equal(board.ksStatus.lifecycleBasis, 'AUTHORED_BOUND_LIFECYCLE_OBSERVATION');
  assert.equal(board.ksStatus.authority.writeAuthority, 'NOT_GRANTED');
  assert.match(board.crossingBindingDigest, /^[a-f0-9]{64}$/);
});
