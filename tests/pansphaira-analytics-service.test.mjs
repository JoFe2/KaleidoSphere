// XRA-KS-01 — focused service-boundary tests for the PANSPHAIRA projection
// ingestion slice.
//
// AC01  a real local service boundary ingests the exact projection profile;
//       no direct PANSPHAIRA function import and no dryRun bridge (process and
//       network clean room, with request/response and head digests).
// AC02  exactly one predeclared typed analysis produces observed/computed
//       claims, coverage, counterevidence, and an authority-free candidate;
//       deterministic result with independent oracle readback.
// AC03  forged edge, substituted projection, missing evidence, UNKNOWN
//       collapse, timeout, and unsupported profile all fail closed.
// AC04  the candidate binds both repo heads, both projection/analysis
//       contracts, the input, the result, and the service environment; any
//       substitution of a bound component is denied.
//
// The live release registry stays HELD: XRA-PS-01 is not publicly closed, the
// exact released PANSPHAIRA projection is not registered or ingested, and the
// live service boundary never produces a candidate. The synthetic DI registry
// exercises the deterministic machinery only and is labeled as such.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import {
  ANALYSIS_ID,
  ANALYSIS_VERSION,
  COVERAGE_ASPECT_KEYS,
  COVERAGE_STATUSES,
  COUNTEREVIDENCE_CLAIM_IDS,
  COUNTEREVIDENCE_STATUSES,
} from '../services/bi-agent/src/pansphaira-analytics/analysis.mjs';
import {
  AUTHORITY_FREE,
  CANDIDATE_STATE,
  CANDIDATE_SCHEMA,
  verifyAuthorityFreeCandidate,
} from '../services/bi-agent/src/pansphaira-analytics/candidate.mjs';
import {
  ADVERSARIAL_CASE_IDS,
  EXPECTED_DENIAL_CODES,
  PIPELINE_ADVERSARIAL_CASE_IDS,
  buildSyntheticDiRegistry,
  createCleanRoomContext,
  loadFrozenInputs,
  oracleComputedClaims,
  runAdversarialCase,
  runPositiveRun,
} from '../scripts/run-pansphaira-analytics-service-clean-room.mjs';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const FIXTURE_PATH = 'tests/pansphaira-analytics-synthetic-profile-v1.json';
const SERVICE_MODULE_PATHS = Object.freeze([
  'services/bi-agent/src/pansphaira-analytics/server.mjs',
  'services/bi-agent/src/pansphaira-analytics/pipeline.mjs',
  'services/bi-agent/src/pansphaira-analytics/analysis.mjs',
  'services/bi-agent/src/pansphaira-analytics/candidate.mjs',
  'services/bi-agent/src/pansphaira-analytics/profile-contract.mjs',
]);

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

function gitHead(ref) {
  const result = spawnSync('git', ['rev-parse', ref], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, ref);
  return result.stdout.trim();
}

function importSpecifiers(source) {
  const specifiers = [];
  for (const match of source.matchAll(/^\s*import\s[^;'"]*?from\s+['"]([^'"]+)['"]/gm)) specifiers.push(match[1]);
  for (const match of source.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specifiers.push(match[1]);
  return specifiers;
}

async function freePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once('error', reject).listen(0, '127.0.0.1', resolve));
  const {port} = listener.address();
  await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  return port;
}

function startServer(port) {
  const child = spawn(process.execPath, [path.join(root, 'services/bi-agent/src/pansphaira-analytics/server.mjs')], {
    cwd: root,
    env: {...process.env, PORT: String(port)},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return child;
}

async function waitForServer(port, child) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`service exited ${child.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/healthz`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('service did not become ready');
}

function stopServer(child) {
  if (child.exitCode === null) {
    child.kill('SIGTERM');
    return new Promise((resolve) => child.once('exit', resolve));
  }
  return Promise.resolve();
}

function postProjection(port, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/pansphaira-analytics/projection',
        method: 'POST',
        headers: {'content-length': Buffer.byteLength(body)},
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

// Headers only, body never sent: the server request deadline must fire.
function openStalledProjection(port) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/pansphaira-analytics/projection',
        method: 'POST',
        headers: {'content-length': '8192'},
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
      },
    );
    request.once('error', reject);
    request.end();
  });
}

// Bounded watchdog over the awaited HTTP response itself; it is not polling.
function withDeadline(promise, milliseconds, label) {
  let timer;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label)), milliseconds);
  });
  return Promise.race([promise, guard]).finally(() => clearTimeout(timer));
}

function canonicalProfileBytes(variant) {
  return Buffer.from(canonicalJson(structuredClone(variant)));
}

test('AC01: the service boundary is a real local process with no PANSPHAIRA import and no dryRun bridge', async (t) => {
  // (a) Source self-scan: no PANSPHAIRA module/function import, no dryRun
  // bridge, and no outbound network client in any service module.
  for (const relativePath of SERVICE_MODULE_PATHS) {
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    for (const specifier of importSpecifiers(source)) {
      assert.doesNotMatch(specifier, /pansphaira/i, `${relativePath} imports ${specifier}`);
      assert.doesNotMatch(specifier, /dry[-_]?run/i, `${relativePath} imports ${specifier}`);
    }
    assert.doesNotMatch(source, /node:https|fetch\s*\(|https\.request|http\.request/, relativePath);
  }

  const inputs = loadFrozenInputs();
  const fixture = JSON.parse(inputs.fixtureBytes.toString('utf8'));
  const fixtureShaBefore = sha256hex(inputs.fixtureBytes);

  const port = await freePort();
  const child = startServer(port);
  t.after(() => stopServer(child));
  await waitForServer(port, child);

  // (b) The live service is bound to the exact repository identity at startup
  // and to the real HELD release registry.
  const headsResponse = await fetch(`http://127.0.0.1:${port}/v1/pansphaira-analytics/heads`);
  assert.equal(headsResponse.status, 200);
  const heads = await headsResponse.json();
  assert.equal(heads.issue, 'XRA-KS-01');
  assert.deepEqual(heads.kaleidosphereHead, {commitOid: gitHead('HEAD'), treeOid: gitHead('HEAD^{tree}')});
  assert.deepEqual(heads.releaseRegistry, {status: 'HELD', entryCount: 1, releasedEntryCount: 0});

  // (c) Against the real HELD registry the boundary denies every variant and
  // never returns a candidate: held profiles are release-held, and the
  // released variant is a forged edge (its synthetic evidence is not
  // attested by any RELEASED entry).
  const held = await postProjection(port, canonicalProfileBytes(fixture.heldProfile));
  assert.equal(held.status, 400);
  assert.equal(held.body.code, EXPECTED_DENIAL_CODES.RELEASE_HELD);
  const released = await postProjection(port, canonicalProfileBytes(fixture.releasedVariant));
  assert.equal(released.status, 400);
  assert.equal(released.body.code, 'XRA_KS01_PROVENANCE_FORGERY_DENIED');
  for (const {body} of [held, released]) {
    assert.equal(body.status, 'DENIED');
    assert.equal(body.candidate, null);
    assert.equal(body.ordinaryAnswer, null);
    assert.equal(body.successfulOrdinaryAnswer, false);
  }

  // (d) Transport and routing gates fail closed at the boundary.
  const oversize = await postProjection(port, Buffer.alloc(16385, 0x7b));
  assert.equal(oversize.status, 400);
  assert.equal(oversize.body.code, 'XRA_KS01_REQUEST_SIZE_DENIED');
  const misrouted = await fetch(`http://127.0.0.1:${port}/v1/pansphaira-analytics/projection`);
  assert.equal(misrouted.status, 400);
  assert.equal((await misrouted.json()).code, 'XRA_KS01_ROUTE_DENIED');

  // (e) The canonical fixture inputs are never mutated by the boundary.
  assert.equal(sha256hex(readFileSync(path.join(root, FIXTURE_PATH))), fixtureShaBefore);
});

test('AC02: one predeclared analysis yields a deterministic authority-free candidate with EXACT oracle readback', () => {
  const analysisContract = JSON.parse(readFileSync(path.join(root, 'contracts/pansphaira-analytics/v1/analysis.v1.json'), 'utf8'));
  assert.equal(analysisContract.schemaVersion, 'kaleidosphere.pansphaira-analytics/analysis-contract/v1');
  assert.equal(analysisContract.analysis.count, 1);
  assert.equal(analysisContract.analysis.id, ANALYSIS_ID);
  assert.equal(analysisContract.analysis.version, ANALYSIS_VERSION);

  const inputs = loadFrozenInputs();
  const fixture = JSON.parse(inputs.fixtureBytes.toString('utf8'));
  const contextLike = createCleanRoomContext(inputs);
  const first = runPositiveRun(inputs, contextLike);
  const second = runPositiveRun(inputs, contextLike);
  assert.equal(first.evidenceSha256, second.evidenceSha256, 'positive runs are not deterministic');
  assert.equal(first.oracleEquality, 'EXACT');
  const oracle = oracleComputedClaims(fixture.releasedVariant);
  assert.equal(canonicalJson(first.result.candidate.claims.computed), canonicalJson(oracle));

  const candidate = first.result.candidate;
  assert.equal(candidate.state, CANDIDATE_STATE);
  assert.equal(candidate.schemaVersion, CANDIDATE_SCHEMA);
  assert.equal(candidate.analysis.id, ANALYSIS_ID);
  assert.equal(candidate.analysis.version, ANALYSIS_VERSION);
  assert.deepEqual(candidate.authority, structuredClone(AUTHORITY_FREE));
  assert.equal(candidate.nonclaims.length, 4);
  assert(candidate.nonclaims.some((line) => line.startsWith('No autonomous promotion')));

  // The result digest covers claims, coverage, and counterevidence only, and
  // the candidate never carries a digest of itself.
  assert.equal(
    candidate.resultSha256,
    sha256hex(canonicalJson({claims: candidate.claims, coverage: candidate.coverage, counterevidence: candidate.counterevidence})),
  );
  assert.notEqual(sha256hex(canonicalJson(candidate)), candidate.resultSha256);

  // Observed claims echo the exact fixture.
  assert.deepEqual(candidate.claims.observed.fieldNames, ['order_id', 'order_date', 'amount_minor_units', 'record_kind']);
  assert.deepEqual(candidate.claims.observed.periodWindow, {start: '2026-06-01', end: '2026-07-31'});
  assert.equal(candidate.claims.observed.sourceRelation, 'xra_projection_orders');
  assert.equal(candidate.claims.observed.provenanceStatus, 'RELEASED');
  assert.equal(candidate.claims.computed.periodDays, 61);

  // Coverage keeps UNKNOWN as a first-class status and reports every
  // predeclared aspect; counterevidence is present for every predeclared
  // claim id (never omitted).
  for (const aspect of COVERAGE_ASPECT_KEYS) {
    assert(COVERAGE_STATUSES.includes(candidate.coverage[aspect]), aspect);
  }
  assert.equal(candidate.coverage.releaseEvidence, 'OBSERVED');
  assert.deepEqual(candidate.counterevidence.map((entry) => entry.claim).sort(), [...COUNTEREVIDENCE_CLAIM_IDS].sort());
  for (const entry of candidate.counterevidence) {
    assert(COUNTEREVIDENCE_STATUSES.includes(entry.status), entry.claim);
  }
});

test('AC03: forged edge, substituted projection, missing evidence, UNKNOWN collapse, and unsupported profile fail closed', () => {
  assert.deepEqual([...ADVERSARIAL_CASE_IDS], [...PIPELINE_ADVERSARIAL_CASE_IDS, 'TIMEOUT']);

  const inputs = loadFrozenInputs();
  const contextLike = createCleanRoomContext(inputs);
  for (const caseId of PIPELINE_ADVERSARIAL_CASE_IDS) {
    const firstDenial = runAdversarialCase(caseId, inputs, contextLike);
    const secondDenial = runAdversarialCase(caseId, inputs, contextLike);
    assert.equal(firstDenial.state, 'DENIED', caseId);
    assert.equal(firstDenial.code, EXPECTED_DENIAL_CODES[caseId], caseId);
    assert.equal(firstDenial.candidate, null, caseId);
    assert.equal(firstDenial.ordinaryAnswer, null, caseId);
    assert.equal(firstDenial.successfulOrdinaryAnswer, false, caseId);
    const {denialSha256, ...rest} = firstDenial;
    assert.equal(denialSha256, sha256hex(canonicalJson(rest)), `${caseId} denial digest`);
    assert.equal(canonicalJson(firstDenial), canonicalJson(secondDenial), `${caseId} determinism`);
  }
});

test('AC03: timeout fails closed at the service boundary without mutating inputs', async (t) => {
  const inputs = loadFrozenInputs();
  const fixtureShaBefore = sha256hex(inputs.fixtureBytes);

  const port = await freePort();
  const child = startServer(port);
  t.after(() => stopServer(child));
  await waitForServer(port, child);

  const response = await withDeadline(openStalledProjection(port), 5000, 'XRA_KS01_TIMEOUT_NOT_OBSERVED');
  assert.equal(response.status, 400);
  assert.equal(response.body.code, EXPECTED_DENIAL_CODES.TIMEOUT);
  assert.equal(response.body.candidate, null);
  assert.equal(response.body.ordinaryAnswer, null);
  assert.equal(response.body.successfulOrdinaryAnswer, false);
  assert.equal(sha256hex(readFileSync(path.join(root, FIXTURE_PATH))), fixtureShaBefore);
});

test('AC04: the candidate binds exact heads, contracts, input, result, and environment; every substitution is denied', () => {
  const inputs = loadFrozenInputs();
  const fixture = JSON.parse(inputs.fixtureBytes.toString('utf8'));
  const contextLike = createCleanRoomContext(inputs);
  const {result} = runPositiveRun(inputs, contextLike);
  const candidate = result.candidate;

  const materials = {
    profileBytes: canonicalProfileBytes(fixture.releasedVariant),
    projectionContractBytes: contextLike.projectionContractBytes,
    analysisContractBytes: contextLike.analysisContractBytes,
    registry: buildSyntheticDiRegistry(canonicalProfileBytes(fixture.releasedVariant), fixture),
    heads: contextLike.heads,
    environment: contextLike.environment,
    environmentSha256: contextLike.environmentSha256,
  };
  assert.deepEqual(verifyAuthorityFreeCandidate(candidate, materials), {state: 'VERIFIED'});

  // Bindings equal the independently resolved repository heads and the exact
  // frozen input/contract/environment digests.
  assert.deepEqual(candidate.bindings.kaleidosphereHead, {commitOid: gitHead('HEAD'), treeOid: gitHead('HEAD^{tree}')});
  assert.equal(candidate.bindings.pansphairaHead.status, 'RELEASED');
  assert.equal(candidate.bindings.pansphairaHead.commitOid, fixture.releasedVariant.provenance.pansphairaHeadCommit);
  assert.equal(candidate.bindings.projectionProfileSha256, result.requestSha256);
  assert.equal(candidate.bindings.projectionContractSha256, sha256hex(contextLike.projectionContractBytes));
  assert.equal(candidate.bindings.analysisContractSha256, sha256hex(contextLike.analysisContractBytes));
  assert.equal(candidate.bindings.environmentSha256, contextLike.environmentSha256);

  const tamperCases = [
    ['kaleidosphere head commit', (value) => { value.bindings.kaleidosphereHead.commitOid = '0'.repeat(40); }],
    ['kaleidosphere head tree', (value) => { value.bindings.kaleidosphereHead.treeOid = '0'.repeat(40); }],
    ['pansphaira head commit', (value) => { value.bindings.pansphairaHead.commitOid = '0'.repeat(40); }],
    ['projection profile digest', (value) => { value.bindings.projectionProfileSha256 = sha256hex('substituted-input'); }],
    ['projection contract digest', (value) => { value.bindings.projectionContractSha256 = sha256hex('substituted-contract'); }],
    ['analysis contract digest', (value) => { value.bindings.analysisContractSha256 = sha256hex('substituted-contract'); }],
    ['environment digest', (value) => { value.bindings.environmentSha256 = sha256hex('substituted-environment'); }],
    ['result digest', (value) => { value.resultSha256 = sha256hex('substituted-result'); }],
    ['computed claim', (value) => { value.claims.computed.fieldCount += 1; }],
    ['counterevidence omission', (value) => { value.counterevidence = value.counterevidence.slice(0, -1); }],
    ['authority promotion', (value) => { value.authority.promote = true; }],
    ['state escalation', (value) => { value.state = 'PROMOTED'; }],
  ];
  for (const [label, mutate] of tamperCases) {
    const tampered = structuredClone(candidate);
    mutate(tampered);
    assert.throws(
      () => verifyAuthorityFreeCandidate(tampered, materials),
      /XRA_KS01_CANDIDATE_[A-Z_]+_DENIED/,
      label,
    );
  }
});

test('clean-room runner: deterministic evidence, EXACT oracle readback, real registry HELD', () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/run-pansphaira-analytics-service-clean-room.mjs')],
    {cwd: root, encoding: 'utf8', timeout: 60000},
  );
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);
  assert.equal(evidence.issue, 'XRA-KS-01');
  assert.equal(evidence.analysis.count, 1);
  assert.equal(evidence.realRegistry.status, 'HELD');
  assert.equal(evidence.realRegistry.entryCount, 1);
  assert.equal(evidence.realRegistry.releasedEntryCount, 0);
  assert.equal(evidence.realRegistry.heldProfileDenial.code, 'XRA_KS01_RELEASE_HELD');
  assert.match(evidence.realRegistry.heldProfileDenial.denialSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.realRegistry.releasedVariantDenial.code, 'XRA_KS01_PROVENANCE_FORGERY_DENIED');
  assert.match(evidence.realRegistry.releasedVariantDenial.denialSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.positive.oracleEquality, 'EXACT');
  assert.equal(evidence.positive.verifierState, 'VERIFIED');
  assert.equal(evidence.positive.admission, 'SYNTHETIC_DI_REGISTRY_ONLY');
  const pipelineCases = evidence.adversarial.filter((row) => row.status === 'PASS');
  assert.equal(pipelineCases.length, PIPELINE_ADVERSARIAL_CASE_IDS.length);
  for (const row of pipelineCases) assert.equal(row.code, EXPECTED_DENIAL_CODES[row.id], row.id);
  const timeoutRow = evidence.adversarial.find((row) => row.id === 'TIMEOUT');
  assert.equal(timeoutRow.status, 'SERVICE_BOUNDARY_ONLY');

  // Cross-process determinism: the in-process positive evidence digest equals
  // the standalone runner's.
  const inputs = loadFrozenInputs();
  const contextLike = createCleanRoomContext(inputs);
  assert.equal(runPositiveRun(inputs, contextLike).evidenceSha256, evidence.positive.evidenceSha256);

  const caseResult = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/run-pansphaira-analytics-service-clean-room.mjs'), '--case', 'FORGED_EDGE'],
    {cwd: root, encoding: 'utf8', timeout: 60000},
  );
  assert.equal(caseResult.status, 2);
  assert.equal(JSON.parse(caseResult.stdout).code, EXPECTED_DENIAL_CODES.FORGED_EDGE);
});

// ============================================================================
// KS151-NATIVE-PROJECTION-01 — separately versioned native PAN nodes/edges
// projection slice on the existing XRA-KS-01 service.
//
// NATIVE-AC01 a real local service boundary ingests the exact released native
//               projection through canonical transport; the raw artifact
//               digest, the canonical transport digest, and the projection
//               body digest are three separate verified bindings; no
//               PANSPHAIRA import and no dryRun bridge; service-absent
//               falsifier.
// NATIVE-AC02  exactly one predeclared edge-evidence coverage analysis
//               produces observed/computed claims, coverage, counterevidence,
//               and a separately versioned authority-free candidate with
//               EXACT oracle readback.
// NATIVE-AC03  forged edge, substituted projection, missing evidence, UNKNOWN
//               collapse, timeout, unsupported profile, re-digested forgery,
//               and authority widening all fail closed: denied, never
//               coerced, never an ordinary candidate.
// NATIVE-AC04  the native candidate binds both repo heads, both contracts,
//               the input, the result, the trusted release sidecar, and the
//               service environment; every substitution is denied.
//
// The trusted release sidecar pins the independently released public
// synthetic native producer (PAN343 release 2026_09_05_v1,
// PUBLIC_SYNTHETIC_NON_CUSTOMER, not productive evidence) and is visibly
// test-only: it does not admit the production XRA-PS-01 compatibility pair,
// is not public closure evidence for XRA-PS-01, and does not close issue151.

const NATIVE_FIXTURE_PATH = 'tests/pansphaira-analytics-native-released-fixture.json';
const NATIVE_RECEIPT_FIXTURE_PATH = 'tests/pansphaira-analytics-native-source-receipt.json';
const NATIVE_PROJECTION_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/native-projection.v1.json';
const NATIVE_ANALYSIS_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/edge-evidence-analysis.v1.json';
const NATIVE_RELEASE_SIDECAR_PATH = 'contracts/pansphaira-analytics/v1/native-release-registry.v1.json';
// Exact controller-observed public release/source receipt bytes (public
// synthetic source only), trailing newline preserved. Its genuine 64-hex
// SHA256 is the actual receipt hash; the legacy v1 slot carried a 40-hex git
// commit in this field, which is malformed and no longer accepted.
function nativeReceiptBytes() {
  return readFileSync(path.join(root, NATIVE_RECEIPT_FIXTURE_PATH));
}
// Source-qualified on PANSPHAIRA Main 988395110a9189d1b8cd4ee98184ed5c1d77a15d
// (the later byte-equivalent head); the named release 2026_09_05_v1 resolved
// 7f662672bfc45087342f23e5c589d43598f5c20d. Pinned independently of any
// caller-recomputed hash; the receipt digest is verified over the raw receipt
// bytes.
const NATIVE_TRUSTED = Object.freeze({
  releaseId: 'pan343-2026-09-05-v1',
  releaseTag: '2026_09_05_v1',
  releaseCommit: '7f662672bfc45087342f23e5c589d43598f5c20d',
  pansphairaHeadCommit: '988395110a9189d1b8cd4ee98184ed5c1d77a15d',
  releaseReceiptSha256: 'bd485d4525cfce9b843de54b2fb6e30e30e560857e6f06faa0f494f65dddb1c6',
  sourceFileIdentity: Object.freeze({
    path: 'tests/fixtures/cks-analytics/projection-v1.json',
    sha256: '22f34bf33874a42cde5a5a23a2242935e8b2b145aa8e2364a5aef26b8ec3e6e8',
  }),
  rawArtifactSha256: '22f34bf33874a42cde5a5a23a2242935e8b2b145aa8e2364a5aef26b8ec3e6e8',
  canonicalTransportSha256: '91c26eb69860767ec2898a48676caaeb52c808de284bb0fbfbe8a986d30ad19c',
  projectionBodyDigest: 'cc5f6cc9591ccf4b6b3c4b9f954aa9da09695b784d7abaa585c082aea195ef1b',
  sourceContractSha256: 'd2995f7e8ed46031902d09a5138202a489834d4a018646c50920a482bbf7da44',
  dataClass: 'PUBLIC_SYNTHETIC_NON_CUSTOMER',
});
const NATIVE_SERVICE_MODULE_PATHS = Object.freeze([
  'services/bi-agent/src/pansphaira-analytics/server.mjs',
  'services/bi-agent/src/pansphaira-analytics/native-pipeline.mjs',
  'services/bi-agent/src/pansphaira-analytics/native-analysis.mjs',
  'services/bi-agent/src/pansphaira-analytics/native-candidate.mjs',
  'services/bi-agent/src/pansphaira-analytics/native-contract.mjs',
]);

function postNativeProjection(port, body) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/pansphaira-analytics/native-projection',
        method: 'POST',
        headers: {'content-length': Buffer.byteLength(body)},
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
      },
    );
    request.once('error', reject);
    request.end(body);
  });
}

// Headers only, body never sent: the shared server request deadline must fire.
function openStalledNativeProjection(port) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/v1/pansphaira-analytics/native-projection',
        method: 'POST',
        headers: {'content-length': '8192'},
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => resolve({status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8'))}));
      },
    );
    request.once('error', reject);
    request.end();
  });
}

// Canonical transport bytes of the exact released native fixture: canonical
// JSON of the parsed released artifact (the boundary wire form).
function nativeCanonicalTransportBytes() {
  const raw = readFileSync(path.join(root, NATIVE_FIXTURE_PATH));
  return Buffer.from(canonicalJson(structuredClone(JSON.parse(raw.toString('utf8')))));
}

test('NATIVE-AC01: the native boundary is a real local service process that ingests the exact released native projection; no PANSPHAIRA import and no dryRun bridge', async (t) => {
  // (a) Source self-scan: no PANSPHAIRA module/function import, no dryRun
  // bridge, and no outbound network client in any native service module.
  for (const relativePath of NATIVE_SERVICE_MODULE_PATHS) {
    const source = readFileSync(path.join(root, relativePath), 'utf8');
    for (const specifier of importSpecifiers(source)) {
      assert.doesNotMatch(specifier, /pansphaira/i, `${relativePath} imports ${specifier}`);
      assert.doesNotMatch(specifier, /dry[-_]?run/i, `${relativePath} imports ${specifier}`);
    }
    assert.doesNotMatch(source, /node:https|fetch\s*\(|https\.request|http\.request/, relativePath);
  }

  // The separately versioned native contract pins the three distinct digest
  // bindings and its own projection schema.
  const nativeProjectionContract = JSON.parse(readFileSync(path.join(root, NATIVE_PROJECTION_CONTRACT_PATH), 'utf8'));
  assert.equal(nativeProjectionContract.schemaVersion, 'kaleidosphere.pansphaira-analytics/native-projection-contract/v1');
  assert.notEqual(
    nativeProjectionContract.schemaVersion,
    'kaleidosphere.pansphaira-analytics/projection-profile-contract/v1',
    'native contract must be separately versioned from the relational contract',
  );
  assert.equal(nativeProjectionContract.projection.schemaVersion, 'chimpmaera.cks/kaleidosphere-analytics-projection/v1');
  assert.equal(nativeProjectionContract.sourceBinding.contractSha256, NATIVE_TRUSTED.sourceContractSha256);
  assert.equal(nativeProjectionContract.digestBindings.rawArtifactSha256, NATIVE_TRUSTED.rawArtifactSha256);
  assert.equal(nativeProjectionContract.digestBindings.canonicalTransportSha256, NATIVE_TRUSTED.canonicalTransportSha256);
  assert.equal(nativeProjectionContract.digestBindings.projectionBodyDigest, NATIVE_TRUSTED.projectionBodyDigest);

  // The raw released fixture is byte-preserved: its sha256 is the pinned
  // raw artifact digest, verified independently of any caller recomputation.
  const rawFixtureBytes = readFileSync(path.join(root, NATIVE_FIXTURE_PATH));
  const fixtureShaBefore = sha256hex(rawFixtureBytes);
  assert.equal(fixtureShaBefore, NATIVE_TRUSTED.rawArtifactSha256, 'raw released native fixture bytes drifted');
  assert.equal(sha256hex(nativeCanonicalTransportBytes()), NATIVE_TRUSTED.canonicalTransportSha256, 'canonical transport bytes drifted');

  const port = await freePort();
  const child = startServer(port);
  t.after(() => stopServer(child));
  await waitForServer(port, child);
  // Service-absent falsifier: this test only passes against the real local
  // service process; a missing or broken service module cannot satisfy it.
  assert.equal(child.exitCode, null, 'native service process must stay alive');

  // (b) The live service is bound to the exact repository identity at startup
  // and to the real trusted release sidecar (synthetic producer pin).
  const headsResponse = await fetch(`http://127.0.0.1:${port}/v1/pansphaira-analytics/heads`);
  assert.equal(headsResponse.status, 200);
  const heads = await headsResponse.json();
  assert.equal(heads.issue, 'XRA-KS-01');
  assert.deepEqual(heads.kaleidosphereHead, {commitOid: gitHead('HEAD'), treeOid: gitHead('HEAD^{tree}')});
  assert.deepEqual(heads.releaseRegistry, {status: 'HELD', entryCount: 1, releasedEntryCount: 0});
  assert.deepEqual(heads.nativeReleaseRegistry, {status: 'RELEASED', entryCount: 1, releasedEntryCount: 1});

  // (c) The real boundary ingests the exact released native projection through
  // canonical transport and returns one authority-free candidate.
  const candidateResponse = await postNativeProjection(port, nativeCanonicalTransportBytes());
  assert.equal(candidateResponse.status, 200);
  assert.equal(candidateResponse.body.status, 'CANDIDATE');
  const candidate = candidateResponse.body.candidate;
  assert.equal(candidate.state, 'CANDIDATE');
  assert.equal(candidate.schemaVersion, 'kaleidosphere.pansphaira-analytics/native-authority-free-candidate/v1');
  assert.deepEqual(candidate.authority, structuredClone(AUTHORITY_FREE));
  assert.equal(candidate.bindings.pansphairaHead.status, 'RELEASED');
  assert.equal(candidate.bindings.pansphairaHead.commitOid, NATIVE_TRUSTED.pansphairaHeadCommit);
  assert.equal(candidate.bindings.pansphairaHead.releaseTag, NATIVE_TRUSTED.releaseTag);
  assert.equal(candidate.bindings.pansphairaHead.releaseCommit, NATIVE_TRUSTED.releaseCommit);
  assert.notEqual(candidate.bindings.pansphairaHead.releaseCommit, candidate.bindings.pansphairaHead.commitOid, 'named release commit and byte-equivalent head must be distinct');
  assert.deepEqual(candidate.bindings.pansphairaHead.sourceFileIdentity, structuredClone(NATIVE_TRUSTED.sourceFileIdentity));
  assert.equal(candidate.bindings.pansphairaHead.releaseReceiptSha256, NATIVE_TRUSTED.releaseReceiptSha256);
  // The receipt binding is the genuine 64-hex SHA256, not a 40-hex commit.
  assert.match(candidate.bindings.pansphairaHead.releaseReceiptSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(candidate.bindings.pansphairaHead.releaseReceiptSha256, candidate.bindings.pansphairaHead.releaseCommit);
  assert.equal(candidate.bindings.rawArtifactSha256, NATIVE_TRUSTED.rawArtifactSha256);
  assert.equal(candidate.bindings.canonicalTransportSha256, NATIVE_TRUSTED.canonicalTransportSha256);
  assert.equal(candidate.bindings.projectionBodyDigest, NATIVE_TRUSTED.projectionBodyDigest);
  assert.equal(candidateResponse.body.requestSha256, NATIVE_TRUSTED.canonicalTransportSha256);

  // (d) Transport and routing gates fail closed at the native boundary.
  const oversize = await postNativeProjection(port, Buffer.alloc(16385, 0x7b));
  assert.equal(oversize.status, 400);
  assert.equal(oversize.body.code, 'XRA_KS01_REQUEST_SIZE_DENIED');
  const misrouted = await fetch(`http://127.0.0.1:${port}/v1/pansphaira-analytics/native-projection`);
  assert.equal(misrouted.status, 400);
  assert.equal((await misrouted.json()).code, 'XRA_KS01_ROUTE_DENIED');

  // (e) The raw released fixture bytes are never mutated by the boundary.
  assert.equal(sha256hex(readFileSync(path.join(root, NATIVE_FIXTURE_PATH))), fixtureShaBefore);
});

test('NATIVE-AC02: one predeclared native edge-evidence analysis yields a deterministic authority-free candidate with EXACT oracle readback', async () => {
  const [analysisModule, scriptModule] = await Promise.all([
    import('../services/bi-agent/src/pansphaira-analytics/native-analysis.mjs'),
    import('../scripts/run-pansphaira-analytics-service-clean-room.mjs'),
  ]);
  const {
    NATIVE_ANALYSIS_ID,
    NATIVE_ANALYSIS_VERSION,
    NATIVE_COVERAGE_ASPECT_KEYS,
    NATIVE_COVERAGE_STATUSES,
    NATIVE_COUNTEREVIDENCE_CLAIM_IDS,
    NATIVE_COUNTEREVIDENCE_STATUSES,
  } = analysisModule;
  const {createCleanRoomContext, loadFrozenInputs, oracleNativeComputedClaims, runNativePositiveRun} = scriptModule;

  const analysisContract = JSON.parse(readFileSync(path.join(root, NATIVE_ANALYSIS_CONTRACT_PATH), 'utf8'));
  assert.equal(analysisContract.schemaVersion, 'kaleidosphere.pansphaira-analytics/edge-evidence-analysis-contract/v1');
  assert.equal(analysisContract.analysis.count, 1);
  assert.equal(analysisContract.analysis.id, NATIVE_ANALYSIS_ID);
  assert.equal(analysisContract.analysis.version, NATIVE_ANALYSIS_VERSION);

  const inputs = loadFrozenInputs();
  const nativeFixture = JSON.parse(inputs.nativeFixtureBytes.toString('utf8'));
  const contextLike = createCleanRoomContext(inputs);
  const first = runNativePositiveRun(inputs, contextLike);
  const second = runNativePositiveRun(inputs, contextLike);
  assert.equal(first.evidenceSha256, second.evidenceSha256, 'native positive runs are not deterministic');
  assert.equal(first.oracleEquality, 'EXACT');
  const oracle = oracleNativeComputedClaims(nativeFixture);
  assert.equal(canonicalJson(first.result.candidate.claims.computed), canonicalJson(oracle));

  const candidate = first.result.candidate;
  assert.equal(candidate.state, 'CANDIDATE');
  assert.equal(candidate.schemaVersion, 'kaleidosphere.pansphaira-analytics/native-authority-free-candidate/v1');
  assert.equal(candidate.analysis.id, NATIVE_ANALYSIS_ID);
  assert.equal(candidate.analysis.version, NATIVE_ANALYSIS_VERSION);
  assert.deepEqual(candidate.authority, structuredClone(AUTHORITY_FREE));
  assert.equal(candidate.nonclaims.length, 4);
  assert(candidate.nonclaims.some((line) => line.startsWith('No autonomous promotion')));
  assert(candidate.nonclaims.some((line) => line.startsWith('No relation-truth or knowledge-effectiveness claim')));

  // The result digest covers claims, coverage, and counterevidence only, and
  // the candidate never carries a digest of itself.
  assert.equal(
    candidate.resultSha256,
    sha256hex(canonicalJson({claims: candidate.claims, coverage: candidate.coverage, counterevidence: candidate.counterevidence})),
  );
  assert.notEqual(sha256hex(canonicalJson(candidate)), candidate.resultSha256);

  // Observed claims echo the exact released native fixture: no relational
  // fields and no period metadata are invented.
  assert.deepEqual(candidate.claims.observed.nodeIds, ['knowledge-001', 'decision-001']);
  assert.deepEqual(candidate.claims.observed.nodeKinds, ['KNOWLEDGE', 'DECISION']);
  assert.equal(candidate.claims.observed.edgeRelation, 'KNOWLEDGE_USED_BY_DECISION');
  assert.deepEqual(candidate.claims.observed.evidenceRoles, ['KNOWLEDGE_QUALIFICATION', 'RELATION_ASSERTION']);
  assert.equal(candidate.claims.observed.sourceContract, 'pansphaira.fnd-ps-02/owner-edge-evidence-inputs/v2');
  assert.equal(candidate.claims.observed.sourceContractVersion, 'v2');
  assert.equal(candidate.claims.observed.authority, 'NONE');
  assert.equal(candidate.claims.observed.promotion, 'NOT_AUTHORIZED');
  assert.equal(candidate.claims.observed.relationTruth, 'NOT_GRANTED');
  assert.equal(candidate.claims.observed.nonclaimCount, 6);
  assert.equal(candidate.claims.computed.nodeCount, 2);
  assert.equal(candidate.claims.computed.edgeCount, 1);
  assert.equal(candidate.claims.computed.evidenceCount, 2);
  assert.equal(candidate.claims.computed.knowledgeNodeCount, 1);
  assert.equal(candidate.claims.computed.decisionNodeCount, 1);
  assert.equal(candidate.claims.computed.unknownTotal, 0);
  assert.equal(candidate.claims.computed.counterevidenceTotal, 0);
  assert.equal(candidate.claims.computed.frozenReceiptsEstablishingEdge, 2);

  // Coverage keeps UNKNOWN as a first-class status and reports every
  // predeclared aspect; counterevidence is present for every predeclared
  // claim id (never omitted).
  for (const aspect of NATIVE_COVERAGE_ASPECT_KEYS) {
    assert(NATIVE_COVERAGE_STATUSES.includes(candidate.coverage[aspect]), aspect);
  }
  assert.equal(candidate.coverage.nodes, 'OBSERVED');
  assert.equal(candidate.coverage.edges, 'OBSERVED');
  assert.equal(candidate.coverage.evidence, 'OBSERVED');
  assert.equal(candidate.coverage.source, 'OBSERVED');
  assert.equal(candidate.coverage.unknownChannel, 'OBSERVED');
  assert.equal(candidate.coverage.counterevidence, 'OBSERVED');
  assert.deepEqual(candidate.counterevidence.map((entry) => entry.claim).sort(), [...NATIVE_COUNTEREVIDENCE_CLAIM_IDS].sort());
  for (const entry of candidate.counterevidence) {
    assert(NATIVE_COUNTEREVIDENCE_STATUSES.includes(entry.status), entry.claim);
  }
});

test('NATIVE-AC03: forged edge, substituted projection, missing evidence, UNKNOWN collapse, unsupported profile, re-digested forgery, and authority widening fail closed', async () => {
  const [scriptModule] = await Promise.all([
    import('../scripts/run-pansphaira-analytics-service-clean-room.mjs'),
  ]);
  const {
    NATIVE_PIPELINE_ADVERSARIAL_CASE_IDS,
    NATIVE_EXPECTED_DENIAL_CODES,
    buildNativeAdversarialBytes,
    createCleanRoomContext,
    loadFrozenInputs,
    runNativeAdversarialCase,
  } = scriptModule;

  const inputs = loadFrozenInputs();
  const contextLike = createCleanRoomContext(inputs);
  for (const caseId of NATIVE_PIPELINE_ADVERSARIAL_CASE_IDS) {
    const firstDenial = runNativeAdversarialCase(caseId, inputs, contextLike);
    const secondDenial = runNativeAdversarialCase(caseId, inputs, contextLike);
    assert.equal(firstDenial.state, 'DENIED', caseId);
    assert.equal(firstDenial.code, NATIVE_EXPECTED_DENIAL_CODES[caseId], caseId);
    assert.equal(firstDenial.candidate, null, caseId);
    assert.equal(firstDenial.ordinaryAnswer, null, caseId);
    assert.equal(firstDenial.successfulOrdinaryAnswer, false, caseId);
    const {denialSha256, ...rest} = firstDenial;
    assert.equal(denialSha256, sha256hex(canonicalJson(rest)), `${caseId} denial digest`);
    assert.equal(canonicalJson(firstDenial), canonicalJson(secondDenial), `${caseId} determinism`);
  }

  // The re-digested forgery is self-consistent (its projectionDigest matches
  // its own body) yet still denied: caller-recomputed digests are never
  // trusted as source provenance, and malformed widened variants are denied,
  // not coerced.
  const nativeFixture = JSON.parse(inputs.nativeFixtureBytes.toString('utf8'));
  const redigested = JSON.parse(buildNativeAdversarialBytes(nativeFixture).REDIGESTED_FORGERY.toString('utf8'));
  const redigestedBody = {};
  for (const [key, value] of Object.entries(redigested)) if (key !== 'projectionDigest') redigestedBody[key] = value;
  assert.equal(redigested.nodes[0].kind, 'DECISION', 're-digested variant must deviate from the frozen subjects');
  assert.equal(
    redigested.projectionDigest,
    sha256hex(Buffer.from(canonicalJson(redigestedBody))),
    're-digested variant must be self-consistent yet denied',
  );
  assert.equal(runNativeAdversarialCase('REDIGESTED_FORGERY', inputs, contextLike).code, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
});

test('NATIVE-AC03: timeout fails closed at the native service boundary without mutating inputs', async (t) => {
  const inputs = loadFrozenInputs();
  const fixtureShaBefore = sha256hex(inputs.nativeFixtureBytes);

  const port = await freePort();
  const child = startServer(port);
  t.after(() => stopServer(child));
  await waitForServer(port, child);

  const response = await withDeadline(openStalledNativeProjection(port), 5000, 'XRA_KS01_NATIVE_TIMEOUT_NOT_OBSERVED');
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'XRA_KS01_TIMEOUT_DENIED');
  assert.equal(response.body.candidate, null);
  assert.equal(response.body.ordinaryAnswer, null);
  assert.equal(response.body.successfulOrdinaryAnswer, false);
  assert.equal(sha256hex(readFileSync(path.join(root, NATIVE_FIXTURE_PATH))), fixtureShaBefore);
});

test('NATIVE-AC04: the native candidate binds exact heads, contracts, input, result, sidecar, and environment; every substitution is denied', async () => {
  const [scriptModule, candidateModule] = await Promise.all([
    import('../scripts/run-pansphaira-analytics-service-clean-room.mjs'),
    import('../services/bi-agent/src/pansphaira-analytics/native-candidate.mjs'),
  ]);
  const {createCleanRoomContext, loadFrozenInputs, runNativePositiveRun} = scriptModule;
  const {verifyNativeAuthorityFreeCandidate} = candidateModule;

  const inputs = loadFrozenInputs();
  const contextLike = createCleanRoomContext(inputs);
  const {result} = runNativePositiveRun(inputs, contextLike);
  const candidate = result.candidate;

  const materials = {
    projectionBytes: nativeCanonicalTransportBytes(),
    rawArtifactBytes: inputs.nativeFixtureBytes,
    receiptBytes: nativeReceiptBytes(),
    nativeProjectionContractBytes: contextLike.nativeProjectionContractBytes,
    analysisContractBytes: contextLike.nativeAnalysisContractBytes,
    releaseSidecarBytes: contextLike.nativeSidecarBytes,
    sidecarEntry: contextLike.nativeSidecar.entries.find((entry) => entry.status === 'RELEASED'),
    heads: contextLike.heads,
    environment: contextLike.environment,
    environmentSha256: contextLike.environmentSha256,
    trusted: NATIVE_TRUSTED,
  };
  assert.deepEqual(verifyNativeAuthorityFreeCandidate(candidate, materials), {state: 'VERIFIED'});

  // Bindings equal the independently resolved repository heads, the trusted
  // release sidecar entry, and the exact frozen input/contract/environment
  // digests.
  assert.deepEqual(candidate.bindings.kaleidosphereHead, {commitOid: gitHead('HEAD'), treeOid: gitHead('HEAD^{tree}')});
  assert.equal(candidate.bindings.pansphairaHead.status, 'RELEASED');
  assert.equal(candidate.bindings.pansphairaHead.commitOid, NATIVE_TRUSTED.pansphairaHeadCommit);
  assert.equal(candidate.bindings.pansphairaHead.releaseTag, NATIVE_TRUSTED.releaseTag);
  assert.equal(candidate.bindings.pansphairaHead.releaseCommit, NATIVE_TRUSTED.releaseCommit);
  assert.notEqual(candidate.bindings.pansphairaHead.releaseCommit, candidate.bindings.pansphairaHead.commitOid);
  assert.deepEqual(candidate.bindings.pansphairaHead.sourceFileIdentity, structuredClone(NATIVE_TRUSTED.sourceFileIdentity));
  assert.equal(candidate.bindings.pansphairaHead.releaseReceiptSha256, NATIVE_TRUSTED.releaseReceiptSha256);
  assert.equal(candidate.bindings.pansphairaHead.releaseReceiptSha256, sha256hex(nativeReceiptBytes()));
  assert.equal(candidate.bindings.canonicalTransportSha256, result.requestSha256);
  assert.equal(candidate.bindings.canonicalTransportSha256, NATIVE_TRUSTED.canonicalTransportSha256);
  assert.equal(candidate.bindings.rawArtifactSha256, sha256hex(inputs.nativeFixtureBytes));
  assert.equal(candidate.bindings.rawArtifactSha256, NATIVE_TRUSTED.rawArtifactSha256);
  assert.equal(candidate.bindings.projectionBodyDigest, NATIVE_TRUSTED.projectionBodyDigest);
  // The three digest bindings are separate and pairwise distinct.
  assert.notEqual(candidate.bindings.rawArtifactSha256, candidate.bindings.canonicalTransportSha256);
  assert.notEqual(candidate.bindings.canonicalTransportSha256, candidate.bindings.projectionBodyDigest);
  assert.notEqual(candidate.bindings.rawArtifactSha256, candidate.bindings.projectionBodyDigest);
  assert.equal(candidate.bindings.nativeProjectionContractSha256, sha256hex(contextLike.nativeProjectionContractBytes));
  assert.equal(candidate.bindings.analysisContractSha256, sha256hex(contextLike.nativeAnalysisContractBytes));
  assert.equal(candidate.bindings.analysisContractSha256, candidate.analysis.contractSha256);
  assert.equal(candidate.bindings.releaseSidecarSha256, sha256hex(contextLike.nativeSidecarBytes));
  assert.equal(candidate.bindings.environmentSha256, contextLike.environmentSha256);

  const tamperCases = [
    ['kaleidosphere head commit', (value) => { value.bindings.kaleidosphereHead.commitOid = '0'.repeat(40); }],
    ['kaleidosphere head tree', (value) => { value.bindings.kaleidosphereHead.treeOid = '0'.repeat(40); }],
    ['pansphaira head commit', (value) => { value.bindings.pansphairaHead.commitOid = '0'.repeat(40); }],
    ['release receipt', (value) => { value.bindings.pansphairaHead.releaseReceiptSha256 = '0'.repeat(64); }],
    ['release tag (stale candidate)', (value) => { value.bindings.pansphairaHead.releaseTag = '2099_01_01_v9'; }],
    ['release commit (stale candidate)', (value) => { value.bindings.pansphairaHead.releaseCommit = '0'.repeat(40); }],
    ['source file identity', (value) => { value.bindings.pansphairaHead.sourceFileIdentity.sha256 = '0'.repeat(64); }],
    ['raw artifact digest', (value) => { value.bindings.rawArtifactSha256 = sha256hex('substituted-artifact'); }],
    ['canonical transport digest', (value) => { value.bindings.canonicalTransportSha256 = sha256hex('substituted-input'); }],
    ['projection body digest', (value) => { value.bindings.projectionBodyDigest = sha256hex('substituted-body'); }],
    ['native projection contract digest', (value) => { value.bindings.nativeProjectionContractSha256 = sha256hex('substituted-contract'); }],
    ['analysis contract digest', (value) => { value.bindings.analysisContractSha256 = sha256hex('substituted-contract'); }],
    ['release sidecar digest', (value) => { value.bindings.releaseSidecarSha256 = sha256hex('substituted-sidecar'); }],
    ['environment digest', (value) => { value.bindings.environmentSha256 = sha256hex('substituted-environment'); }],
    ['result digest', (value) => { value.resultSha256 = sha256hex('substituted-result'); }],
    ['computed claim', (value) => { value.claims.computed.nodeCount += 1; }],
    ['counterevidence omission', (value) => { value.counterevidence = value.counterevidence.slice(0, -1); }],
    ['authority promotion', (value) => { value.authority.promote = true; }],
    ['state escalation', (value) => { value.state = 'PROMOTED'; }],
  ];
  for (const [label, mutate] of tamperCases) {
    const tampered = structuredClone(candidate);
    mutate(tampered);
    assert.throws(
      () => verifyNativeAuthorityFreeCandidate(tampered, materials),
      /XRA_KS01_NATIVE_CANDIDATE_[A-Z_]+_DENIED/,
      label,
    );
  }
});

test('NATIVE-AC04: the actual loopback-returned candidate binds the complete deterministic result to the independently pinned projection and predeclared analysis; re-digested result substitutions are denied', async (t) => {
  const [scriptModule, candidateModule] = await Promise.all([
    import('../scripts/run-pansphaira-analytics-service-clean-room.mjs'),
    import('../services/bi-agent/src/pansphaira-analytics/native-candidate.mjs'),
  ]);
  const {createCleanRoomContext, loadFrozenInputs, oracleNativeResult} = scriptModule;
  const {verifyNativeAuthorityFreeCandidate} = candidateModule;

  // The actual service-boundary candidate: the exact released canonical
  // transport bytes are sent over loopback to the real local service process,
  // and the wire-returned candidate — not a locally rebuilt candidate labeled
  // as service output — is the candidate under verification.
  const port = await freePort();
  const child = startServer(port);
  t.after(() => stopServer(child));
  await waitForServer(port, child);
  assert.equal(child.exitCode, null, 'native service process must stay alive for the result-binding readback');

  const inputs = loadFrozenInputs();
  const fixtureShaBefore = sha256hex(inputs.nativeFixtureBytes);
  const response = await postNativeProjection(port, nativeCanonicalTransportBytes());
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'CANDIDATE');
  assert.equal(response.body.requestSha256, NATIVE_TRUSTED.canonicalTransportSha256);
  const candidate = response.body.candidate;

  // Separately reconstructed material pins: the trusted release pins are
  // re-derived from the exact controller-observed receipt bytes, the observed
  // byte-equivalent head, and the raw fixture bytes — never copied from the
  // candidate or the verifier.
  const contextLike = createCleanRoomContext(inputs);
  const receiptBytes = nativeReceiptBytes();
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  const nativeFixture = JSON.parse(inputs.nativeFixtureBytes.toString('utf8'));
  const sidecarEntry = contextLike.nativeSidecar.entries.find((entry) => entry.status === 'RELEASED');
  assert.equal(receipt.tag, NATIVE_TRUSTED.releaseTag);
  assert.equal(receipt.resolved_commit, NATIVE_TRUSTED.releaseCommit);
  assert.equal(sha256hex(receiptBytes), NATIVE_TRUSTED.releaseReceiptSha256);
  assert.equal(receipt.sources[0].path, NATIVE_TRUSTED.sourceFileIdentity.path);
  assert.equal(receipt.sources[0].sha256, NATIVE_TRUSTED.sourceFileIdentity.sha256);
  assert.equal(sha256hex(inputs.nativeFixtureBytes), NATIVE_TRUSTED.rawArtifactSha256);
  assert.equal(sha256hex(nativeCanonicalTransportBytes()), NATIVE_TRUSTED.canonicalTransportSha256);
  assert.equal(nativeFixture.projectionDigest, NATIVE_TRUSTED.projectionBodyDigest);
  const materials = {
    projectionBytes: nativeCanonicalTransportBytes(),
    rawArtifactBytes: inputs.nativeFixtureBytes,
    receiptBytes,
    nativeProjectionContractBytes: contextLike.nativeProjectionContractBytes,
    analysisContractBytes: contextLike.nativeAnalysisContractBytes,
    releaseSidecarBytes: contextLike.nativeSidecarBytes,
    sidecarEntry,
    heads: contextLike.heads,
    environment: contextLike.environment,
    environmentSha256: contextLike.environmentSha256,
    trusted: {
      releaseTag: receipt.tag,
      releaseCommit: receipt.resolved_commit,
      pansphairaHeadCommit: NATIVE_TRUSTED.pansphairaHeadCommit,
      releaseReceiptSha256: sha256hex(receiptBytes),
      sourceFileIdentity: {path: receipt.sources[0].path, sha256: receipt.sources[0].sha256},
      rawArtifactSha256: sha256hex(inputs.nativeFixtureBytes),
      canonicalTransportSha256: sha256hex(nativeCanonicalTransportBytes()),
      projectionBodyDigest: nativeFixture.projectionDigest,
    },
  };
  assert.deepEqual(verifyNativeAuthorityFreeCandidate(candidate, materials), {state: 'VERIFIED'});

  // Independent oracle readback: the complete deterministic result (observed
  // and computed claims, coverage, counterevidence, and the result digest)
  // equals the separately reconstructed expected semantics from the canonical
  // authoritative fixture and the pinned release evidence.
  const releaseEvidence = sidecarEntry.status === 'RELEASED'
    ? {status: 'OBSERVED', releasedEntryCount: 1}
    : {status: 'HELD', releasedEntryCount: 0};
  const expected = oracleNativeResult(nativeFixture, releaseEvidence);
  assert.equal(canonicalJson(candidate.claims), canonicalJson(expected.claims));
  assert.equal(canonicalJson(candidate.coverage), canonicalJson(expected.coverage));
  assert.equal(canonicalJson(candidate.counterevidence), canonicalJson(expected.counterevidence));
  assert.equal(candidate.resultSha256, expected.resultSha256);

  // The re-digest recomputes the candidate's own self-digest over the
  // substituted result content — the substitution the legacy self-consistency
  // check accepts. Where the substituted shape is not canonicalizable, a
  // well-formed 64-hex placeholder stands in so the denial must come from the
  // complete result binding, never from a digest mismatch.
  const reDigest = (value) => {
    try {
      value.resultSha256 = sha256hex(canonicalJson({claims: value.claims, coverage: value.coverage, counterevidence: value.counterevidence}));
    } catch {
      value.resultSha256 = '0'.repeat(64);
    }
  };

  // The four valid-shaped re-digested substitutions, each changing one result
  // component (computed, observed, coverage, counterevidence) independently.
  const redigestCases = [
    ['computed.nodeCount', (value) => { value.claims.computed.nodeCount += 1; }],
    ['observed.nodeIds[0]', (value) => { value.claims.observed.nodeIds[0] = 'decision-001'; }],
    ['coverage.source OBSERVED->HELD', (value) => { value.coverage.source = 'HELD'; }],
    ['counterevidence[0].status NONE_FOUND->UNKNOWN', (value) => { value.counterevidence[0].status = 'UNKNOWN'; }],
  ];
  for (const [label, mutate] of redigestCases) {
    const tampered = structuredClone(candidate);
    mutate(tampered);
    reDigest(tampered);
    assert.throws(
      () => verifyNativeAuthorityFreeCandidate(tampered, materials),
      {code: 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'},
      label,
    );
  }

  // Missing/extra result fields and malformed result shapes are a
  // deterministic typed denial, never an uncaught TypeError.
  const malformedCases = [
    ['missing computed field', (value) => { delete value.claims.computed.nodeCount; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['extra computed field', (value) => { value.claims.computed.bogusClaim = 1; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['missing observed field', (value) => { delete value.claims.observed.nodeIds; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['extra coverage aspect', (value) => { value.coverage.bogusAspect = 'OBSERVED'; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['undefined computed leaf', (value) => { value.claims.computed.nodeCount = undefined; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['non-finite computed leaf', (value) => { value.claims.computed.nodeCount = Number.NaN; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['claims not an object', (value) => { value.claims = 'substituted'; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['coverage not an object', (value) => { value.coverage = null; }, 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'],
    ['counterevidence not an array', (value) => { value.counterevidence = {}; }, 'XRA_KS01_NATIVE_CANDIDATE_COUNTEREVIDENCE_DENIED'],
    ['counterevidence null entry', (value) => { value.counterevidence[0] = null; }, 'XRA_KS01_NATIVE_CANDIDATE_COUNTEREVIDENCE_DENIED'],
    ['counterevidence non-object entry', (value) => { value.counterevidence[1] = 42; }, 'XRA_KS01_NATIVE_CANDIDATE_COUNTEREVIDENCE_DENIED'],
    ['counterevidence entry extra field', (value) => { value.counterevidence[0].bogus = true; }, 'XRA_KS01_NATIVE_CANDIDATE_COUNTEREVIDENCE_DENIED'],
    ['counterevidence entry missing field', (value) => { delete value.counterevidence[0].check; }, 'XRA_KS01_NATIVE_CANDIDATE_COUNTEREVIDENCE_DENIED'],
  ];
  for (const [label, mutate, code] of malformedCases) {
    const tampered = structuredClone(candidate);
    mutate(tampered);
    reDigest(tampered);
    assert.throws(
      () => verifyNativeAuthorityFreeCandidate(tampered, materials),
      {code},
      label,
    );
  }

  // A substituted result digest of the wrong length is a typed denial even
  // when the result content is otherwise exact: here the digest itself is the
  // substitution, so no re-digest is applied.
  {
    const tampered = structuredClone(candidate);
    tampered.resultSha256 = 'f'.repeat(40);
    assert.throws(
      () => verifyNativeAuthorityFreeCandidate(tampered, materials),
      {code: 'XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED'},
      'result digest wrong length',
    );
  }

  // The real service producer bytes and the immutable materials are unchanged
  // by the verification.
  assert.equal(sha256hex(readFileSync(path.join(root, NATIVE_FIXTURE_PATH))), fixtureShaBefore);
});

test('NATIVE-AC05: versioned source-only provenance distinguishes the actual receipt SHA256 from the named release commit and denies trusted-source substitution', async (t) => {
  const [pipelineModule, candidateModule, scriptModule] = await Promise.all([
    import('../services/bi-agent/src/pansphaira-analytics/native-pipeline.mjs'),
    import('../services/bi-agent/src/pansphaira-analytics/native-candidate.mjs'),
    import('../scripts/run-pansphaira-analytics-service-clean-room.mjs'),
  ]);
  const {validateNativeSidecar} = pipelineModule;
  const {verifyNativeAuthorityFreeCandidate} = candidateModule;
  const {createCleanRoomContext, loadFrozenInputs, runNativePositiveRun} = scriptModule;

  const realReceipt = nativeReceiptBytes();
  // The genuine receipt is the exact controller-observed public release/source
  // observation: a 64-hex SHA256, never a 40-hex commit OID.
  assert.equal(sha256hex(realReceipt), NATIVE_TRUSTED.releaseReceiptSha256);
  assert.equal(NATIVE_TRUSTED.releaseReceiptSha256.length, 64);

  const realSidecar = JSON.parse(readFileSync(path.join(root, NATIVE_RELEASE_SIDECAR_PATH), 'utf8'));

  // GREEN: the genuine 64-hex receipt and the v2 source-only sidecar validate,
  // and the candidate verifies against independently reconstructed trusted pins.
  assert.doesNotThrow(() => validateNativeSidecar(structuredClone(realSidecar), Buffer.from(realReceipt)));
  const inputs = loadFrozenInputs();
  const contextLike = createCleanRoomContext(inputs);
  const {result} = runNativePositiveRun(inputs, contextLike);
  assert.equal(result.state, 'CANDIDATE');

  const alterReceipt = (mutate) => {
    const doc = JSON.parse(realReceipt.toString('utf8'));
    mutate(doc);
    return Buffer.from(JSON.stringify(doc));
  };
  const other40 = 'f'.repeat(32) + '12345678';

  // (1) Wrong-length token: a 40-hex commit OID in the receipt-SHA256 slot is the
  //     legacy malformed pin; the v2 contract requires a genuine 64-hex digest.
  const wrongLength = structuredClone(realSidecar);
  wrongLength.pinnedSource.releaseReceiptSha256 = NATIVE_TRUSTED.releaseCommit;
  wrongLength.entries[0].releaseReceiptSha256 = NATIVE_TRUSTED.releaseCommit;
  assert.throws(() => validateNativeSidecar(wrongLength, Buffer.from(realReceipt)), {code: 'XRA_KS01_NATIVE_SIDECAR_INVALID'});

  // (2) Named-release/head mismatch: the later byte-equivalent head must be a
  //     distinct commit from the named release's resolved commit.
  const conflated = structuredClone(realSidecar);
  conflated.pinnedSource.pansphairaHeadCommit = conflated.pinnedSource.releaseCommit;
  conflated.entries[0].pansphairaHeadCommit = conflated.entries[0].releaseCommit;
  assert.throws(() => validateNativeSidecar(conflated, Buffer.from(realReceipt)), {code: 'XRA_KS01_NATIVE_SIDECAR_INVALID'});

  // (3) Altered receipt with a recomputed self-hash: the digest now matches the
  //     altered bytes, but the observed resolved commit no longer binds the named
  //     release. A successful (re)digest does not validate a receipt.
  const alteredReceipt = alterReceipt((doc) => { doc.resolved_commit = other40; });
  const alteredSidecar = structuredClone(realSidecar);
  alteredSidecar.pinnedSource.releaseReceiptSha256 = sha256hex(alteredReceipt);
  alteredSidecar.entries[0].releaseReceiptSha256 = sha256hex(alteredReceipt);
  assert.throws(() => validateNativeSidecar(alteredSidecar, alteredReceipt), {code: 'XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED'});

  // (4) Changed source/artifact identity: the observed source file identity no
  //     longer binds the receipt's first source.
  const changedSource = structuredClone(realSidecar);
  changedSource.pinnedSource.sourceFileIdentity.sha256 = sha256hex('substituted-source-file');
  changedSource.entries[0].sourceFileIdentity.sha256 = sha256hex('substituted-source-file');
  assert.throws(() => validateNativeSidecar(changedSource, Buffer.from(realReceipt)), {code: 'XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED'});

  // Verifier-level substitution negatives on the trusted path: the positive
  // candidate verifies, but each substituted binding/material is denied.
  const baseMaterials = {
    projectionBytes: nativeCanonicalTransportBytes(),
    rawArtifactBytes: inputs.nativeFixtureBytes,
    receiptBytes: realReceipt,
    nativeProjectionContractBytes: contextLike.nativeProjectionContractBytes,
    analysisContractBytes: contextLike.nativeAnalysisContractBytes,
    releaseSidecarBytes: contextLike.nativeSidecarBytes,
    sidecarEntry: contextLike.nativeSidecar.entries.find((entry) => entry.status === 'RELEASED'),
    heads: contextLike.heads,
    environment: contextLike.environment,
    environmentSha256: contextLike.environmentSha256,
    trusted: NATIVE_TRUSTED,
  };
  assert.deepEqual(verifyNativeAuthorityFreeCandidate(result.candidate, baseMaterials), {state: 'VERIFIED'});

  // (5) Changed raw artifact bytes (source substitution) are denied on the
  //     trusted path.
  assert.throws(
    () => verifyNativeAuthorityFreeCandidate(result.candidate, {...baseMaterials, rawArtifactBytes: Buffer.from('substituted-artifact-bytes')}),
    {code: 'XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED'},
  );

  // (6) A wrong-length receipt token carried by the candidate is denied: the
  //     re-derived raw-receipt digest is 64-hex and cannot equal a 40-hex OID.
  const staleToken = structuredClone(result.candidate);
  staleToken.bindings.pansphairaHead.releaseReceiptSha256 = NATIVE_TRUSTED.releaseCommit;
  assert.throws(() => verifyNativeAuthorityFreeCandidate(staleToken, baseMaterials), {code: 'XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED'});

  // (7) A stale/substituted candidate binding (wrong named-release commit) is
  //     denied against the independently-pinned trusted provenance.
  const staleCandidate = structuredClone(result.candidate);
  staleCandidate.bindings.pansphairaHead.releaseCommit = other40;
  assert.throws(() => verifyNativeAuthorityFreeCandidate(staleCandidate, baseMaterials), {code: 'XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED'});

  // (8) A recomputed self-hash over altered receipt bytes cannot be laundered:
  //     the observed identity bind denies it even though its digest is valid.
  assert.throws(
    () => verifyNativeAuthorityFreeCandidate(result.candidate, {...baseMaterials, receiptBytes: alteredReceipt}),
    {code: 'XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED'},
  );

  // Loopback readback + service-absent falsifier: the exact released native
  // projection is ingested by the real local service and the candidate's
  // source-only provenance reads back as the genuine 64-hex receipt and the
  // named release commit/head; this cannot be satisfied without the service.
  const port = await freePort();
  const child = startServer(port);
  t.after(() => stopServer(child));
  await waitForServer(port, child);
  assert.equal(child.exitCode, null, 'native service process must stay alive for the loopback readback');
  const response = await postNativeProjection(port, nativeCanonicalTransportBytes());
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'CANDIDATE');
  const head = response.body.candidate.bindings.pansphairaHead;
  assert.equal(head.releaseReceiptSha256, NATIVE_TRUSTED.releaseReceiptSha256);
  assert.match(head.releaseReceiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(head.releaseCommit, NATIVE_TRUSTED.releaseCommit);
  assert.equal(head.commitOid, NATIVE_TRUSTED.pansphairaHeadCommit);
  assert.notEqual(head.releaseCommit, head.commitOid);
  assert.equal(head.releaseTag, NATIVE_TRUSTED.releaseTag);
  assert.deepEqual(head.sourceFileIdentity, structuredClone(NATIVE_TRUSTED.sourceFileIdentity));
});

test('native clean-room runner: deterministic native evidence, EXACT oracle, synthetic sidecar pin, relational registry still HELD', async () => {
  const result = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/run-pansphaira-analytics-service-clean-room.mjs')],
    {cwd: root, encoding: 'utf8', timeout: 60000},
  );
  assert.equal(result.status, 0, result.stderr);
  const evidence = JSON.parse(result.stdout);

  // The relational slice is unchanged: the live release registry stays HELD.
  assert.equal(evidence.realRegistry.status, 'HELD');
  assert.equal(evidence.realRegistry.entryCount, 1);
  assert.equal(evidence.realRegistry.releasedEntryCount, 0);

  const native = evidence.native;
  assert.equal(native.sidecar.status, 'RELEASED');
  assert.equal(native.sidecar.entryCount, 1);
  assert.equal(native.sidecar.releasedEntryCount, 1);
  assert.equal(native.sidecar.synthetic, true);
  assert.equal(native.rawFixtureSha256, NATIVE_TRUSTED.rawArtifactSha256);
  assert.equal(native.digestBindings.rawArtifactSha256, NATIVE_TRUSTED.rawArtifactSha256);
  assert.equal(native.digestBindings.canonicalTransportSha256, NATIVE_TRUSTED.canonicalTransportSha256);
  assert.equal(native.digestBindings.projectionBodyDigest, NATIVE_TRUSTED.projectionBodyDigest);
  assert.equal(native.digestBindings.distinct, true);
  assert.equal(native.positive.oracleEquality, 'EXACT');
  assert.equal(native.positive.verifierState, 'VERIFIED');
  assert.equal(native.positive.admission, 'SYNTHETIC_PRODUCER_SIDECAR_PIN_ONLY');
  assert.match(native.positive.evidenceSha256, /^[a-f0-9]{64}$/);

  const [scriptModule] = await Promise.all([
    import('../scripts/run-pansphaira-analytics-service-clean-room.mjs'),
  ]);
  const {NATIVE_PIPELINE_ADVERSARIAL_CASE_IDS, NATIVE_EXPECTED_DENIAL_CODES, createCleanRoomContext, loadFrozenInputs, runNativePositiveRun} = scriptModule;

  const nativeCases = native.adversarial.filter((row) => row.status === 'PASS');
  assert.equal(nativeCases.length, NATIVE_PIPELINE_ADVERSARIAL_CASE_IDS.length);
  for (const row of nativeCases) assert.equal(row.code, NATIVE_EXPECTED_DENIAL_CODES[row.id], row.id);

  // Cross-process determinism: the in-process native positive evidence digest
  // equals the standalone runner's.
  const inputs = loadFrozenInputs();
  const contextLike = createCleanRoomContext(inputs);
  assert.equal(runNativePositiveRun(inputs, contextLike).evidenceSha256, native.positive.evidenceSha256);

  const caseResult = spawnSync(
    process.execPath,
    [path.join(root, 'scripts/run-pansphaira-analytics-service-clean-room.mjs'), '--case', 'NATIVE_FORGED_EDGE'],
    {cwd: root, encoding: 'utf8', timeout: 60000},
  );
  assert.equal(caseResult.status, 2);
  assert.equal(JSON.parse(caseResult.stdout).code, NATIVE_EXPECTED_DENIAL_CODES.FORGED_EDGE);
});