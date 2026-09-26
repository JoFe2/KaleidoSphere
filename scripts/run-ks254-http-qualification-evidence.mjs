#!/usr/bin/env node
/**
 * KS254 (#254) — native HTTP qualification evidence runner.
 *
 * Drives the REAL bi-control server (`services/bi-control/src/server.mjs`) over loopback HTTP
 * and records, outside the repository, what each route actually answered: `analyze`, the
 * generation-resolved `/v1/status` and `readback`, the exact route-specific negatives, the
 * `PROJECTION_MIRROR_NOT_ACTIVE` publish refusal, and a REAL SIGKILL of the server while it
 * serves `POST /v1/analyze` at every supported generation-boundary point, followed by the
 * observed readback and a recovery.
 *
 * The control token is SYNTHETIC and generated per server start; it is never written to
 * stdout/stderr and the emitted document is scanned for the token canary before it is written.
 * Nothing here grants activation or publication authority — it only reports observed answers.
 *
 * Usage:
 *   node scripts/run-ks254-http-qualification-evidence.mjs --out <file.json>
 */
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { BI_CONTROL_ROOT, CONTROL_SERVER_ENTRY, REPO_ROOT, analyzeIntoInterruption, controlRequest, startControlServer } from '../tests/helpers/ks254-http-harness.mjs';
import { inspectGenerationStore } from '../services/bi-control/src/generation-store.mjs';
import { recoverProjectionStore } from '../services/bi-control/src/projection-generation.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex === -1 ? null : path.resolve(args[outIndex + 1] ?? '');
if (out === null) {
  process.stderr.write('KS254-HTTP-EVIDENCE-DENIED pass --out <file.json>\n');
  process.exit(2);
}

const roots = [];
const tokens = [];
const records = [];
const tempRoot = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'ks254-http-evidence-'));
  roots.push(root);
  return root;
};

// Every server start mints its own synthetic token; keep them so the final document can be
// scanned for the canary, but never echo one.
const start = async (options = {}) => {
  const server = await startControlServer({ ...options, token: randomBytes(24).toString('hex') });
  tokens.push(server.token);
  return server;
};

const record = (entry) => { records.push(entry); return entry; };

const serverCommand = (server) => [
  `node ${path.relative(REPO_ROOT, CONTROL_SERVER_ENTRY)}`,
  `PORT=${server.port}`,
  `RECEIPT_DIR=<tmp>/receipts`,
  `PROJECTION_DB=<tmp>/projection/analytics.db`,
  `REPOSITORY_ROOT=${path.relative(REPO_ROOT, BI_CONTROL_ROOT)}`,
  'BI_ENGINE=mssql',
  'BI_SOURCE_MODE=fixture',
  'CONTROL_TOKEN_FILE=<tmp>/control-token (0600, synthetic, never logged)',
].join(' ');

const exchange = async (server, what, request) => {
  const response = await controlRequest(server, request);
  return record({
    what,
    method: request.method ?? 'POST',
    route: request.route,
    authorization: request.auth === 'none' ? 'ABSENT' : request.auth === 'wrong' ? 'WRONG_TOKEN' : 'BEARER_SYNTHETIC',
    httpStatus: response.status,
    code: response.body?.code ?? null,
    serverCommand: serverCommand(server),
  });
};

async function stubMaterializer() {
  const hits = [];
  const sockets = new Set();
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk.toString('utf8'); });
    request.on('end', () => {
      hits.push({ method: request.method, url: request.url, authPresent: typeof request.headers.authorization === 'string', body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({ schemaVersion: 'stub/materialize/v1', materialized: true })}\n`);
    });
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  return {
    url: `http://127.0.0.1:${server.address().port}/internal/materialize`,
    hits,
    close: () => new Promise((resolveClose) => { for (const socket of sockets) socket.destroy(); server.close(resolveClose); }),
  };
}

const gitHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
const gitClean = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim() === '';

// ---------------------------------------------------------------- positive surface
const positiveRoot = tempRoot();
const positive = await start({ root: positiveRoot });
const health = await controlRequest(positive, { method: 'GET', route: '/healthz', auth: 'none' });
record({ what: 'public health probe', method: 'GET', route: '/healthz', authorization: 'ABSENT', httpStatus: health.status, code: null, serverCommand: serverCommand(positive) });
await exchange(positive, 'status of an empty store', { method: 'GET', route: '/v1/status' });
const analyzeResponse = await controlRequest(positive, { route: '/v1/analyze', action: 'analyze' });
const analyzeBody = analyzeResponse.body;
record({ what: 'analyze: stage + activate one projection/receipt generation', method: 'POST', route: '/v1/analyze', authorization: 'BEARER_SYNTHETIC', httpStatus: analyzeResponse.status, code: null, serverCommand: serverCommand(positive) });
record({ what: 'analyze receipt identity', receiptId: analyzeBody.receiptId, schemaVersion: analyzeBody.schemaVersion, status: analyzeBody.status, engine: analyzeBody.engine, sourceMode: analyzeBody.sourceMode, snapshotSha256: analyzeBody.analysis.snapshotSha256, projectionSha256: analyzeBody.projection.sha256 });
const statusAfter = await controlRequest(positive, { method: 'GET', route: '/v1/status' });
record({ what: 'status after analyze', httpStatus: statusAfter.status, ready: statusAfter.body.status, latestReceiptId: statusAfter.body.latestReceiptId, generation: statusAfter.body.generation, catalogReady: statusAfter.body.catalogReady });
const readbackAfter = await controlRequest(positive, { route: '/v1/readback', action: 'readback' });
record({ what: 'readback after analyze', httpStatus: readbackAfter.status, generationId: readbackAfter.body.generationId, receiptId: readbackAfter.body.receiptId, snapshotSha256: readbackAfter.body.summary.snapshot_sha256, detailCount: readbackAfter.body.detailCount, projectionMirror: readbackAfter.body.projectionMirror?.state, mirrorInSync: readbackAfter.body.projectionMirror?.inSync });
await positive.stop();

// ---------------------------------------------------------------- route-specific negatives
const negativeRoot = tempRoot();
const negative = await start({ root: negativeRoot });
for (const [what, request] of [
  ['unauthenticated status', { method: 'GET', route: '/v1/status', auth: 'none' }],
  ['wrong-token status', { method: 'GET', route: '/v1/status', auth: 'wrong' }],
  ['wrong action', { route: '/v1/analyze', action: 'readback' }],
  ['extra request key', { route: '/v1/analyze', body: { action: 'analyze', scope: 'dbo' } }],
  ['missing request key', { route: '/v1/readback', raw: '{}' }],
  ['wrong method', { method: 'GET', route: '/v1/readback' }],
  ['unknown route', { route: '/v1/unknown', raw: '{}' }],
  ['malformed body', { route: '/v1/analyze', raw: '{not-json' }],
  ['oversized body', { route: '/v1/analyze', raw: `{"action":"analyze","pad":"${'x'.repeat(20000)}"}` }],
  ['readback on an empty store', { route: '/v1/readback', action: 'readback' }],
  ['publish on an empty store', { route: '/v1/publish', action: 'publish' }],
]) {
  await exchange(negative, what, request);
}
await negative.stop();

// ---------------------------------------------------------------- publish refusal + recovery
const stub = await stubMaterializer();
try {
  // (a) Natural lag: the server is killed with SIGKILL exactly after the single commit point
  // while it serves analyze, so the pointer names the complete NEW generation while the fixed
  // mirror still holds the OLD generation's bytes.
  const refusalRoot = tempRoot();
  const seed = await start({ root: refusalRoot });
  const seedBody = (await controlRequest(seed, { route: '/v1/analyze', action: 'analyze' })).body;
  await seed.stop();
  const refusalInterrupted = await start({ root: refusalRoot, interruptAt: 'projection:after-activation' });
  const interruptedExit = await analyzeIntoInterruption(refusalInterrupted, 'projection:after-activation');
  record({ what: 'refusal leg: server killed while serving analyze at projection:after-activation', transportFailed: interruptedExit.transportError !== null, exitCode: interruptedExit.exit.code, signal: interruptedExit.exit.signal });
  const refused = await start({ root: refusalRoot, supersetMaterializerUrl: stub.url });
  const state = await controlRequest(refused, { method: 'GET', route: '/v1/status' });
  const before = await controlRequest(refused, { route: '/v1/readback', action: 'readback' });
  const publish = await exchange(refused, 'publish with a lagging projection mirror', { route: '/v1/publish', action: 'publish' });
  record({
    what: 'publish refusal observed state',
    generationState: state.body.generation.state,
    generationId: before.body.generationId,
    readbackHttpStatus: before.status,
    mirrorState: before.body.projectionMirror.state,
    mirrorInSync: before.body.projectionMirror.inSync,
    declaredProjectionSha256OfPreviousGeneration: seedBody.projection.sha256,
    mirrorSha256: before.body.projectionMirror.sha256,
    materializerRequestsBeforeRefusal: stub.hits.length,
    refusalCode: publish.code,
  });
  await refused.stop();

  // (b) Explicit stale-mirror counterexample on an otherwise healthy generation.
  const staleRoot = tempRoot();
  const healthy = await start({ root: staleRoot, supersetMaterializerUrl: stub.url });
  const healthySeed = (await controlRequest(healthy, { route: '/v1/analyze', action: 'analyze' })).body;
  writeFileSync(healthy.projectionDb, readFileSync(healthy.projectionDb).subarray(0, 512));
  const stalePublish = await exchange(healthy, 'publish with a truncated fixed mirror', { route: '/v1/publish', action: 'publish' });
  const staleReadback = await controlRequest(healthy, { route: '/v1/readback', action: 'readback' });
  record({ what: 'stale-mirror counterexample', readbackHttpStatus: staleReadback.status, generationId: staleReadback.body.generationId, mirrorState: staleReadback.body.projectionMirror.state, mirrorInSync: staleReadback.body.projectionMirror.inSync, declaredProjectionSha256: healthySeed.projection.sha256, mirrorSha256: staleReadback.body.projectionMirror.sha256, refusalCode: stalePublish.code, materializerRequests: stub.hits.length });
  await healthy.stop();

  // Recovery at the boundary: a verified-but-uncommitted staging completed, read over HTTP,
  // then published to the materializer with the exact committed generation digest.
  const recoveryRoot = tempRoot();
  const recoverySeed = await start({ root: recoveryRoot });
  const recoverySeedBody = (await controlRequest(recoverySeed, { route: '/v1/analyze', action: 'analyze' })).body;
  const recoverySeedStatus = await controlRequest(recoverySeed, { method: 'GET', route: '/v1/status' });
  const oldGenerationId = recoverySeedStatus.body.generation.generationId;
  await recoverySeed.stop();
  const interrupted = await start({ root: recoveryRoot, interruptAt: 'projection:after-staging' });
  const killed = await analyzeIntoInterruption(interrupted, 'projection:after-staging');
  record({ what: 'recovery leg: server killed while serving analyze at projection:after-staging', transportFailed: killed.transportError !== null, exitCode: killed.exit.code, signal: killed.exit.signal, stagingLeftover: inspectGenerationStore(recoverySeed.receiptDir).staging.length });
  const recoveryReader = await start({ root: recoveryRoot, supersetMaterializerUrl: stub.url });
  const beforeRecovery = await controlRequest(recoveryReader, { route: '/v1/readback', action: 'readback' });
  const recovered = recoverProjectionStore({ receiptDir: recoveryReader.receiptDir, projectionDb: recoveryReader.projectionDb });
  const afterRecovery = await controlRequest(recoveryReader, { route: '/v1/readback', action: 'readback' });
  const publishAfter = await exchange(recoveryReader, 'publish after recovery: mirror gate passes', { route: '/v1/publish', action: 'publish' });
  const hit = stub.hits[stub.hits.length - 1];
  const sent = hit ? JSON.parse(hit.body) : null;
  record({
    what: 'recovery observed state',
    oldGenerationId,
    beforeRecoveryGenerationId: beforeRecovery.body.generationId,
    activated: recovered.activated.length,
    discarded: recovered.discarded.length,
    activeGenerationId: recovered.active.generationId,
    afterRecoveryGenerationId: afterRecovery.body.generationId,
    afterRecoveryMirrorInSync: afterRecovery.body.projectionMirror.inSync,
    publishHttpStatus: publishAfter.httpStatus,
    materializerRequests: stub.hits.length,
    materializerReceiptId: sent?.receiptId ?? null,
    materializerProjectionSha256MatchesCommitted: sent?.projectionSha256 === recovered.active.receipt.projection.sha256,
    materializerSnapshotMatches: sent?.snapshotSha256 === recoverySeedBody.analysis.snapshotSha256,
    materializerAuthPresent: hit?.authPresent ?? null,
  });
  await recoveryReader.stop();
} finally {
  await stub.close();
}

// ---------------------------------------------------------------- interruption at every boundary
const interruptionPoints = [
  'projection:before-staging',
  'projection:during-staging',
  'projection:after-staging',
  'projection:after-generation-publish',
  'projection:after-activation',
];
const interruptions = [];
for (const point of interruptionPoints) {
  const root = tempRoot();
  const seedServer = await start({ root });
  const seededBody = (await controlRequest(seedServer, { route: '/v1/analyze', action: 'analyze' })).body;
  const seededStatus = await controlRequest(seedServer, { method: 'GET', route: '/v1/status' });
  const oldGenerationId = seededStatus.body.generation.generationId;
  await seedServer.stop();

  const killedServer = await start({ root, interruptAt: point });
  const killed = await analyzeIntoInterruption(killedServer, point);
  const reader = await start({ root });
  try {
    const status = await controlRequest(reader, { method: 'GET', route: '/v1/status' });
    const readback = await controlRequest(reader, { route: '/v1/readback', action: 'readback' });
    interruptions.push({
      point,
      transportFailed: killed.transportError !== null,
      exitCode: killed.exit.code,
      signal: killed.exit.signal,
      statusHttpStatus: status.status,
      generationState: status.body.generation.state,
      generationId: status.body.generation.generationId,
      latestReceiptId: status.body.latestReceiptId,
      readbackHttpStatus: readback.status,
      readbackGenerationId: readback.body.generationId,
      readbackReceiptId: readback.body.receiptId,
      readbackSnapshotSha256: readback.body.summary.snapshot_sha256,
      oneCoherentGeneration: status.body.generation.generationId === readback.body.generationId
        && readback.body.summary.snapshot_sha256 === seededBody.analysis.snapshotSha256,
      advancedToNewGeneration: readback.body.generationId !== oldGenerationId,
      oldGenerationId,
    });
  } finally {
    await reader.stop();
  }
}

const document = {
  schemaVersion: 'chimpmaera.bi/ks254-http-qualification-evidence/v1',
  issue: 'JoFe2/KaleidoSphere#254',
  parentEpic: 'JoFe2/KaleidoSphere#252',
  contract: {
    server: 'services/bi-control/src/server.mjs',
    harness: 'tests/helpers/ks254-http-harness.mjs',
    suite: 'tests/ks254-http-qualification.test.mjs',
  },
  environment: {
    node: process.version,
    platform: process.platform,
    gitHead,
    worktreeClean: gitClean,
    transport: 'loopback HTTP (127.0.0.1) to the real product server child process',
    controlToken: 'SYNTHETIC per-start, 0600 token file, never logged',
    repositoryLayout: 'REPOSITORY_ROOT=services/bi-control (the tree the image copies to /app)',
    supersetRuntimeExecuted: false,
    storagePowerLossQualified: false,
  },
  positiveSurface: {
    analyzeReceipt: records.find((entry) => entry.what === 'analyze receipt identity') ?? null,
    statusAfterAnalyze: records.find((entry) => entry.what === 'status after analyze') ?? null,
    readbackAfterAnalyze: records.find((entry) => entry.what === 'readback after analyze') ?? null,
  },
  routeNegatives: records.filter((entry) => entry.what.match(/^(unauthenticated|wrong-token|wrong action|extra request|missing request|wrong method|unknown route|malformed body|oversized body|readback on|publish on)/)),
  publishRefusal: records.find((entry) => entry.what === 'publish refusal observed state') ?? null,
  staleMirrorCounterexample: records.find((entry) => entry.what === 'stale-mirror counterexample') ?? null,
  recovery: records.find((entry) => entry.what === 'recovery observed state') ?? null,
  recoveryInterruption: records.find((entry) => entry.what.startsWith('recovery leg:')) ?? null,
  interruptions,
  records,
  nonClaims: [
    'Process-death (SIGKILL) interruption only; storage power loss and fsync durability are NOT qualified.',
    'The Apache Superset runtime and the Docker image layout were not executed; only the repository-layout server was driven over loopback HTTP.',
    'No publication, activation, merge, release or issue mutation is performed or claimed.',
  ],
};

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const canaryMatches = tokens.reduce((count, token) => count + serialized.split(token).length - 1, 0);
if (canaryMatches !== 0) {
  process.stderr.write('KS254-HTTP-EVIDENCE-DENIED synthetic control token found in the document\n');
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  process.exit(3);
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, serialized);
for (const root of roots) rmSync(root, { recursive: true, force: true });
process.stdout.write(`KS254-HTTP-EVIDENCE-WRITTEN servers=${tokens.length} records=${records.length} interruptions=${interruptions.length} interruptedDeaths=${interruptions.filter((entry) => entry.signal === 'SIGKILL').length} tokenCanaryMatches=${canaryMatches} out=${out}\n`);
process.stdout.write(`KS254-HTTP-EVIDENCE-SURFACE status=${document.positiveSurface.statusAfterAnalyze?.generation?.state} readbackGeneration=${document.positiveSurface.readbackAfterAnalyze?.generationId?.slice(0, 12)} mirror=${document.positiveSurface.readbackAfterAnalyze?.projectionMirror}\n`);
process.stdout.write(`KS254-HTTP-EVIDENCE-REFUSAL code=${document.publishRefusal?.refusalCode} materializerRequests=${document.publishRefusal?.materializerRequestsBeforeRefusal} staleMirrorCode=${document.staleMirrorCounterexample?.refusalCode} recoveryMirrorInSync=${document.recovery?.afterRecoveryMirrorInSync}\n`);
// The evidence is fully written and every child server has been stopped; exit explicitly so a
// lingering loopback socket cannot keep the one-shot runner alive.
process.exit(0);
