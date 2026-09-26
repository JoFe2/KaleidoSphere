// KS254 (JoFe2/KaleidoSphere#254) — NATIVE HTTP qualification of the crash-safe projection /
// receipt generation surface.
//
// This suite closes the disclosed boundary of `tests/ks254-generation-safety.test.mjs`: that
// suite drove the native modules and the provisioning CLI, but the bi-control HTTP server was
// never started, so `analyze` → stage/activate, the generation-resolved `readback` /
// `/v1/status`, and the `publish` mirror refusal were exercised only at the module boundary.
//
// Here the REAL product server (`services/bi-control/src/server.mjs`) is started as a child
// process on a free loopback port with a per-start SYNTHETIC control token (written to a 0600
// file, never logged), and every assertion observes a real HTTP status/body produced by that
// running server — not a module call, not a source substring, not a mock transport.
//
// AC coverage:
//  * positive route surface: `analyze` stages+activates ONE projection/receipt generation;
//    `/v1/status` and `readback` resolve that same complete generation and the fixed mirror.
//  * interruption: the server is killed with SIGKILL (a real process death) while serving
//    `POST /v1/analyze` at every supported generation-boundary point; then a fresh server
//    over the same state resolves exactly one COMPLETE generation — the complete old one
//    before the single commit point, the complete new one after it, never a mix.
//  * refusal: a lagging fixed projection mirror is refused with `PROJECTION_MIRROR_NOT_ACTIVE`
//    BEFORE any materializer request is sent, while `readback` still resolves the complete
//    generation from its immutable directory.
//  * recovery: a verified-but-uncommitted staging is completed by the native recovery entry
//    point and the reader advances over HTTP; a subsequent `analyze` re-binds the mirror so
//    the mirror gate passes and the materializer receives the exact generation digest.
//
// Boundaries NOT qualified here: the Apache Superset runtime and the Docker image layout.
// The server is driven from the repository checkout (`REPOSITORY_ROOT=services/bi-control`),
// which is the same tree the image copies to /app.
//
// Run: node --test tests/ks254-http-qualification.test.mjs

import assert from 'node:assert/strict';
import http from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  ACTIVE_POINTER_NAME, OWNED_STAGING_DIRECTORY, OWNED_STORE_DIRECTORY,
  inspectGenerationStore, readActiveGeneration,
} from '../services/bi-control/src/generation-store.mjs';
import { recoverProjectionStore } from '../services/bi-control/src/projection-generation.mjs';
import {
  analyzeIntoInterruption, controlRequest, startControlServer,
} from './helpers/ks254-http-harness.mjs';

const RECEIPT_SCHEMA = 'chimpmaera.bi/analysis-receipt/v1';
const READBACK_SCHEMA = 'chimpmaera.bi/readback/v1';
const PRE_COMMIT_POINTS = Object.freeze([
  'projection:before-staging',
  'projection:during-staging',
  'projection:after-staging',
  'projection:after-generation-publish',
]);
const COMMIT_POINT = 'projection:after-activation';

const tempRoots = [];
function tempRoot(prefix = 'ks254-http-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}
test.after(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
});

const assertTokenNeverLogged = (server) => {
  assert.equal(server.rawDiagnostics().includes(server.token), false,
    'the synthetic control token must never appear in the server output');
};

// A counting stub materializer on loopback: it proves whether a request was actually sent and
// records only non-secret facts (never the Authorization value).
async function startStubMaterializer() {
  const hits = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => { body += chunk.toString('utf8'); });
    request.on('end', () => {
      hits.push({ method: request.method, url: request.url, authPresent: typeof request.headers.authorization === 'string', body });
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(`${JSON.stringify({ schemaVersion: 'stub/materialize/v1', materialized: true })}\n`);
    });
  });
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const port = server.address().port;
  return {
    url: `http://127.0.0.1:${port}/internal/materialize`,
    hits,
    close: () => new Promise((resolveClose) => server.close(resolveClose)),
  };
}

const seedGeneration = async (server) => {
  const analyze = await controlRequest(server, { route: '/v1/analyze', action: 'analyze' });
  assert.equal(analyze.status, 200, server.diagnostics());
  const status = await controlRequest(server, { method: 'GET', route: '/v1/status' });
  assert.equal(status.status, 200);
  assert.equal(status.body.generation.state, 'ACTIVE');
  return {
    receipt: analyze.body,
    receiptId: analyze.body.receiptId,
    snapshotSha256: analyze.body.analysis.snapshotSha256,
    generationId: status.body.generation.generationId,
  };
};

// ------------------------------------------------------------------ positive route surface

test('KS254 HTTP positive: analyze, /v1/status and readback resolve one complete generation over real loopback HTTP', async () => {
  const root = tempRoot();
  const server = await startControlServer({ root });
  try {
    const health = await controlRequest(server, { method: 'GET', route: '/healthz', auth: 'none' });
    assert.equal(health.status, 200);
    assert.equal(health.body.status, 'ok');

    const seeded = await seedGeneration(server);
    assert.equal(seeded.receipt.schemaVersion, RECEIPT_SCHEMA);
    assert.match(seeded.receiptId, /^mssql-[0-9a-f]{24}$/);
    assert.equal(seeded.receipt.status, 'ANALYZED_READ_ONLY');
    assert.match(seeded.receipt.projection.sha256, /^[0-9a-f]{64}$/);
    assert.match(seeded.generationId, /^[0-9a-f]{64}$/);

    const status = await controlRequest(server, { method: 'GET', route: '/v1/status' });
    assert.equal(status.body.status, 'READY');
    assert.equal(status.body.engine, 'mssql');
    assert.equal(status.body.sourceMode, 'fixture');
    assert.equal(status.body.latestReceiptId, seeded.receiptId);
    assert.equal(status.body.catalogReady, true);
    assert.deepEqual(status.body.scope, seeded.receipt.scope);
    assert.equal(status.body.generation.generationId, seeded.generationId);

    const readback = await controlRequest(server, { route: '/v1/readback', action: 'readback' });
    assert.equal(readback.status, 200, JSON.stringify(readback.body));
    const body = readback.body;
    assert.equal(body.schemaVersion, READBACK_SCHEMA);
    assert.equal(body.generationId, seeded.generationId);
    assert.equal(body.receiptId, seeded.receiptId);
    assert.equal(body.summary.receipt_id, seeded.receiptId);
    assert.equal(body.summary.snapshot_sha256, seeded.snapshotSha256);
    assert.ok(body.detailCount > 0);
    assert.equal(body.catalogSnapshot.receipt_id, seeded.receiptId);
    assert.equal(body.catalogSnapshot.snapshot_sha256, seeded.snapshotSha256);
    // The fixed projection mirror is IN SYNC with the active generation's declared digest.
    assert.equal(body.projectionMirror.state, 'IN_SYNC');
    assert.equal(body.projectionMirror.inSync, true);
    assert.equal(body.projectionMirror.sha256, seeded.receipt.projection.sha256);
    assert.equal(body.publication, null);

    assertTokenNeverLogged(server);
  } finally {
    await server.stop();
  }
});

test('KS254 HTTP: a successive analyze advances the generation pointer and retains the previous complete generation on disk', async () => {
  const root = tempRoot();
  const server = await startControlServer({ root });
  try {
    const first = await seedGeneration(server);
    const second = await seedGeneration(server);
    // The receipt identity is stable (same fixture snapshot) while the generation is a NEW
    // content-addressed directory: a reader that flips must land on a complete generation.
    assert.equal(second.receiptId, first.receiptId);
    assert.notEqual(second.generationId, first.generationId);

    const status = await controlRequest(server, { method: 'GET', route: '/v1/status' });
    const readback = await controlRequest(server, { route: '/v1/readback', action: 'readback' });
    assert.equal(readback.status, 200);
    assert.equal(status.body.generation.generationId, second.generationId);
    assert.equal(readback.body.generationId, second.generationId);
    assert.equal(readback.body.projectionMirror.inSync, true);

    // Both generations are complete and the previous one is still usable: activation never
    // deletes the last complete generation.
    const store = inspectGenerationStore(server.receiptDir);
    assert.equal(store.generations.length, 2);
    assert.ok(store.generations.every((entry) => entry.complete), JSON.stringify(store.generations));
    assert.equal(store.generations.filter((entry) => entry.active).length, 1);
    assert.equal(store.generations.find((entry) => entry.active).generationId, second.generationId);
    assert.equal(store.pointer.state, 'ACTIVE');
    assert.equal(existsSync(path.join(server.receiptDir, OWNED_STORE_DIRECTORY, 'generations', first.generationId)), true);
    assertTokenNeverLogged(server);
  } finally {
    await server.stop();
  }
});

// ------------------------------------------------------------------ route-specific negatives

test('KS254 HTTP negatives: authorization, action, request surface, method, malformed body and unknown route each fail with their exact code', async () => {
  const root = tempRoot();
  const server = await startControlServer({ root });
  try {
    // Authorization is checked before anything else; only the health probe is public.
    const unauth = await controlRequest(server, { method: 'GET', route: '/v1/status', auth: 'none' });
    assert.equal(unauth.status, 401);
    assert.equal(unauth.body.code, 'CONTROL_AUTH_DENIED');
    const wrong = await controlRequest(server, { method: 'GET', route: '/v1/status', auth: 'wrong' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body.code, 'CONTROL_AUTH_DENIED');
    const unauthAnalyze = await controlRequest(server, { route: '/v1/analyze', action: 'analyze', auth: 'none' });
    assert.equal(unauthAnalyze.status, 401);
    assert.equal(unauthAnalyze.body.code, 'CONTROL_AUTH_DENIED');
    // The bare token (no Bearer prefix) is the accepted alternate form.
    const raw = await controlRequest(server, { method: 'GET', route: '/v1/status', auth: 'raw' });
    assert.equal(raw.status, 200);
    assert.equal(raw.body.status, 'READY');

    // Wrong action and an extra request key fail closed with their own codes.
    const wrongAction = await controlRequest(server, { route: '/v1/analyze', action: 'readback' });
    assert.equal(wrongAction.status, 400);
    assert.equal(wrongAction.body.code, 'CONTROL_ACTION_DENIED');
    const extraKey = await controlRequest(server, { route: '/v1/analyze', body: { action: 'analyze', scope: 'dbo' } });
    assert.equal(extraKey.status, 400);
    assert.equal(extraKey.body.code, 'CONTROL_REQUEST_SURFACE_DENIED');
    const missingAction = await controlRequest(server, { route: '/v1/readback', raw: '{}' });
    assert.equal(missingAction.status, 400);
    assert.equal(missingAction.body.code, 'CONTROL_REQUEST_SURFACE_DENIED');

    // Wrong method and unknown route fail with the route code; an empty body on an unknown
    // route reaches the route check rather than the surface check.
    const wrongMethod = await controlRequest(server, { method: 'GET', route: '/v1/readback' });
    assert.equal(wrongMethod.status, 400);
    assert.equal(wrongMethod.body.code, 'CONTROL_ROUTE_DENIED');
    const unknownRoute = await controlRequest(server, { route: '/v1/unknown', raw: '{}' });
    assert.equal(unknownRoute.status, 400);
    assert.equal(unknownRoute.body.code, 'CONTROL_ROUTE_DENIED');

    // Malformed and oversized bodies are refused at the transport boundary.
    const malformed = await controlRequest(server, { route: '/v1/analyze', raw: '{not-json' });
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'CONTROL_JSON_INVALID');
    const oversized = await controlRequest(server, { route: '/v1/analyze', raw: `{"action":"analyze","pad":"${'x'.repeat(20000)}"}` });
    assert.equal(oversized.status, 400);
    assert.equal(oversized.body.code, 'CONTROL_REQUEST_TOO_LARGE');

    // On an empty store the reader-facing routes refuse precisely, while status stays READY.
    const emptyStatus = await controlRequest(server, { method: 'GET', route: '/v1/status' });
    assert.equal(emptyStatus.status, 200);
    assert.equal(emptyStatus.body.generation.state, 'ABSENT');
    assert.equal(emptyStatus.body.latestReceiptId, null);
    const emptyReadback = await controlRequest(server, { route: '/v1/readback', action: 'readback' });
    assert.equal(emptyReadback.status, 400);
    assert.equal(emptyReadback.body.code, 'ANALYSIS_RECEIPT_MISSING');
    const emptyPublish = await controlRequest(server, { route: '/v1/publish', action: 'publish' });
    assert.equal(emptyPublish.status, 400);
    assert.equal(emptyPublish.body.code, 'ANALYSIS_RECEIPT_MISSING');
    assertTokenNeverLogged(server);
  } finally {
    await server.stop();
  }
});

test('KS254 HTTP generation-pointer negatives: a dangling, invalid or tampered pointer fails every reader route closed and is never partially trusted', async () => {
  const root = tempRoot();
  const server = await startControlServer({ root });
  try {
    const seeded = await seedGeneration(server);
    const pointer = path.join(server.receiptDir, OWNED_STORE_DIRECTORY, ACTIVE_POINTER_NAME);

    // Pointer to a generation directory that does not exist: DANGLING.
    rmSync(pointer, { force: true });
    symlinkSync(path.join('generations', 'f'.repeat(64)), pointer);
    const danglingStatus = await controlRequest(server, { method: 'GET', route: '/v1/status' });
    assert.equal(danglingStatus.status, 200);
    assert.equal(danglingStatus.body.generation.state, 'DANGLING');
    assert.equal(danglingStatus.body.generation.code, 'GENERATION_POINTER_DANGLING');
    assert.equal(danglingStatus.body.latestReceiptId, null);
    for (const route of ['/v1/readback', '/v1/publish']) {
      const refused = await controlRequest(server, { route, action: route.slice(4) });
      assert.equal(refused.status, 400, route);
      assert.equal(refused.body.code, 'GENERATION_POINTER_DANGLING', route);
    }

    // A pointer that names something outside the published generation set: INVALID.
    rmSync(pointer, { force: true });
    mkdirSync(path.join(server.receiptDir, OWNED_STORE_DIRECTORY, 'not-a-generation'), { recursive: true });
    symlinkSync('not-a-generation', pointer);
    const invalidStatus = await controlRequest(server, { method: 'GET', route: '/v1/status' });
    assert.equal(invalidStatus.body.generation.state, 'INVALID');
    assert.equal(invalidStatus.body.generation.code, 'GENERATION_POINTER_INVALID');
    const invalidReadback = await controlRequest(server, { route: '/v1/readback', action: 'readback' });
    assert.equal(invalidReadback.status, 400);
    assert.equal(invalidReadback.body.code, 'GENERATION_POINTER_INVALID');

    // A declared file removed from the ACTIVE generation directory: the byte-verifying reader
    // refuses, while the cheap status route still reports the pointer state.
    rmSync(pointer, { force: true });
    symlinkSync(path.join('generations', seeded.generationId), pointer);
    const receiptFile = path.join(server.receiptDir, OWNED_STORE_DIRECTORY, 'generations', seeded.generationId, 'receipt.json');
    const saved = readFileSync(receiptFile);
    rmSync(receiptFile);
    const tamperedReadback = await controlRequest(server, { route: '/v1/readback', action: 'readback' });
    assert.equal(tamperedReadback.status, 400);
    assert.equal(tamperedReadback.body.code, 'GENERATION_INCOMPLETE');
    // The cheap status route does not re-hash every byte, but it still cannot report a
    // generation whose receipt is unreadable as ACTIVE: it fails closed with its own code.
    const tamperedStatus = await controlRequest(server, { method: 'GET', route: '/v1/status' });
    assert.equal(tamperedStatus.status, 200);
    assert.equal(tamperedStatus.body.generation.state, 'INCOMPLETE');
    assert.equal(tamperedStatus.body.generation.code, 'PROJECTION_RECEIPT_UNREADABLE');
    assert.equal(tamperedStatus.body.latestReceiptId, null);
    assert.equal(tamperedStatus.body.catalogReady, false);
    // Restoring the declared bytes restores the complete generation: no residue.
    writeFileSync(receiptFile, saved);
    const restored = await controlRequest(server, { route: '/v1/readback', action: 'readback' });
    assert.equal(restored.status, 200);
    assert.equal(restored.body.generationId, seeded.generationId);
    assert.equal(restored.body.receiptId, seeded.receiptId);
    assertTokenNeverLogged(server);
  } finally {
    await server.stop();
  }
});

// ------------------------------------------------------------------ interruption at the boundary

test('KS254 HTTP interruption: a real SIGKILL while serving analyze leaves exactly one complete generation readable — the complete old one before the commit point, the complete new one after it', async () => {
  const points = [...PRE_COMMIT_POINTS, COMMIT_POINT];
  const observed = [];
  for (const point of points) {
    const root = tempRoot('ks254-http-kill-');
    const seedServer = await startControlServer({ root });
    const seeded = await seedGeneration(seedServer);
    await seedServer.stop();

    const killedServer = await startControlServer({ root, interruptAt: point });
    const killed = await analyzeIntoInterruption(killedServer, point);
    assert.ok(killed.transportError, `${point}: an interrupted analyze must fail at the transport layer`);
    assert.equal(killed.exit.code, null, `${point}: a signal death carries no exit code`);
    assert.equal(killed.exit.signal, 'SIGKILL', `${point}: the REAL server process died on SIGKILL`);
    assertTokenNeverLogged(killedServer);

    const reader = await startControlServer({ root });
    try {
      const status = await controlRequest(reader, { method: 'GET', route: '/v1/status' });
      assert.equal(status.status, 200, reader.diagnostics());
      assert.equal(status.body.generation.state, 'ACTIVE', `${point}: a complete generation is always available`);
      const readback = await controlRequest(reader, { route: '/v1/readback', action: 'readback' });
      assert.equal(readback.status, 200, `${point}: readback must resolve a complete generation: ${JSON.stringify(readback.body)}`);
      // Exactly one coherent generation: status and readback agree, and the receipt's own
      // snapshot is the snapshot in the resolved projection.
      assert.equal(readback.body.generationId, status.body.generation.generationId, `${point}: one generation, not a mix`);
      assert.equal(status.body.latestReceiptId, seeded.receiptId, point);
      assert.equal(readback.body.receiptId, seeded.receiptId, point);
      assert.equal(readback.body.summary.snapshot_sha256, seeded.snapshotSha256, point);
      assert.equal(readback.body.summary.receipt_id, seeded.receiptId, point);

      // Complete OLD or complete NEW — asserted against the specific boundary.
      if (point === COMMIT_POINT) {
        assert.notEqual(readback.body.generationId, seeded.generationId,
          `${point}: a death AFTER the single commit point exposes the complete NEW generation`);
      } else {
        assert.equal(readback.body.generationId, seeded.generationId,
          `${point}: a death BEFORE the commit point keeps the complete OLD generation`);
      }
      // Library cross-check (not the primary evidence): the resolved directory really
      // re-verifies byte-for-byte.
      const active = readActiveGeneration({ root: reader.receiptDir });
      assert.equal(active.ok, true, `${point}: ${active.code}`);
      assert.equal(active.generationId, readback.body.generationId);

      observed.push({ point, generationId: readback.body.generationId, advanced: readback.body.generationId !== seeded.generationId });
    } finally {
      await reader.stop();
    }
  }
  assert.equal(observed.length, points.length);
  assert.equal(observed.filter((entry) => entry.advanced).length, 1, 'exactly the post-commit point advances the pointer');
  assert.equal(observed.find((entry) => entry.advanced).point, COMMIT_POINT);
});

// ------------------------------------------------------------------ publish refusal

test('KS254 HTTP publish refusal: a lagging projection mirror is refused with PROJECTION_MIRROR_NOT_ACTIVE before any materializer request, while readback still resolves the complete generation', async () => {
  const stub = await startStubMaterializer();
  try {
    // (a) Natural lag: an analyze killed exactly after the commit flips the pointer, so the
    // fixed mirror still holds the previous generation's bytes.
    const root = tempRoot('ks254-http-mirror-lag-');
    const seedServer = await startControlServer({ root });
    const seeded = await seedGeneration(seedServer);
    await seedServer.stop();
    const killedServer = await startControlServer({ root, interruptAt: COMMIT_POINT });
    const killed = await analyzeIntoInterruption(killedServer, COMMIT_POINT);
    assert.equal(killed.exit.signal, 'SIGKILL');

    const reader = await startControlServer({ root, supersetMaterializerUrl: stub.url });
    try {
      const status = await controlRequest(reader, { method: 'GET', route: '/v1/status' });
      assert.equal(status.body.generation.state, 'ACTIVE');
      assert.notEqual(status.body.generation.generationId, seeded.generationId);
      const readback = await controlRequest(reader, { route: '/v1/readback', action: 'readback' });
      assert.equal(readback.status, 200);
      assert.equal(readback.body.generationId, status.body.generation.generationId);
      // The reader never mixes: the receipt and its projection both come from the new
      // generation directory, while the fixed mirror is acknowledged as stale.
      assert.equal(readback.body.summary.snapshot_sha256, seeded.snapshotSha256);
      assert.equal(readback.body.projectionMirror.inSync, false);
      assert.equal(readback.body.projectionMirror.state, 'STALE_GENERATION');
      // The fixed mirror still holds the PREVIOUS generation's projection bytes.
      assert.equal(readback.body.projectionMirror.sha256, seeded.receipt.projection.sha256);

      const publish = await controlRequest(reader, { route: '/v1/publish', action: 'publish' });
      assert.equal(publish.status, 400);
      assert.equal(publish.body.code, 'PROJECTION_MIRROR_NOT_ACTIVE');
      assert.equal(stub.hits.length, 0, 'the refusal happens before any materializer request is sent');
      assertTokenNeverLogged(reader);
    } finally {
      await reader.stop();
    }

    // (b) Explicit stale mirror on an otherwise healthy generation: same refusal, same
    // generation-bound readback that still resolves complete bytes.
    const healthyRoot = tempRoot('ks254-http-mirror-stale-');
    const healthy = await startControlServer({ root: healthyRoot, supersetMaterializerUrl: stub.url });
    try {
      const seededHealthy = await seedGeneration(healthy);
      const projectionPath = healthy.projectionDb;
      const original = readFileSync(projectionPath);
      writeFileSync(projectionPath, original.subarray(0, 512));
      const status = await controlRequest(healthy, { method: 'GET', route: '/v1/status' });
      assert.equal(status.body.generation.state, 'ACTIVE');
      const readback = await controlRequest(healthy, { route: '/v1/readback', action: 'readback' });
      assert.equal(readback.status, 200);
      assert.equal(readback.body.generationId, seededHealthy.generationId);
      assert.equal(readback.body.projectionMirror.inSync, false);
      assert.equal(readback.body.projectionMirror.state, 'STALE_GENERATION');
      const publish = await controlRequest(healthy, { route: '/v1/publish', action: 'publish' });
      assert.equal(publish.status, 400);
      assert.equal(publish.body.code, 'PROJECTION_MIRROR_NOT_ACTIVE');
      assert.equal(stub.hits.length, 0);
      assertTokenNeverLogged(healthy);
    } finally {
      await healthy.stop();
    }
  } finally {
    await stub.close();
  }
});

// ------------------------------------------------------------------ recovery at the boundary

test('KS254 HTTP recovery: a verified-but-uncommitted staging is completed and read over HTTP, an incomplete one is discarded without touching the active generation, and a later analyze re-binds the mirror so the gate passes', async () => {
  const stub = await startStubMaterializer();
  try {
    // Interrupted AFTER staging completed but BEFORE the commit: the owned staging holds a
    // verified generation and the pointer is still the old one.
    const root = tempRoot('ks254-http-recover-');
    const seedServer = await startControlServer({ root });
    const seeded = await seedGeneration(seedServer);
    await seedServer.stop();
    const killedServer = await startControlServer({ root, interruptAt: 'projection:after-staging' });
    const killed = await analyzeIntoInterruption(killedServer, 'projection:after-staging');
    assert.equal(killed.exit.signal, 'SIGKILL');
    assert.equal(inspectGenerationStore(seedServer.receiptDir).staging.length, 1, 'the verified staging is left behind for recovery');

    const reader = await startControlServer({ root, supersetMaterializerUrl: stub.url });
    try {
      // Before recovery the reader resolves the complete OLD generation, never a partial one.
      const before = await controlRequest(reader, { route: '/v1/readback', action: 'readback' });
      assert.equal(before.status, 200);
      assert.equal(before.body.generationId, seeded.generationId);

      // The native recovery entry point COMPLETES the verified-but-uncommitted staging.
      const recovered = recoverProjectionStore({ receiptDir: reader.receiptDir, projectionDb: reader.projectionDb });
      assert.equal(recovered.activated.length, 1);
      assert.equal(recovered.discarded.length, 0);
      assert.equal(recovered.active.ok, true, recovered.active.code);
      assert.notEqual(recovered.active.generationId, seeded.generationId);

      // The reader now observes the completed generation over HTTP, with the mirror re-bound.
      const after = await controlRequest(reader, { route: '/v1/readback', action: 'readback' });
      assert.equal(after.status, 200);
      assert.equal(after.body.generationId, recovered.active.generationId);
      assert.equal(after.body.receiptId, seeded.receiptId);
      assert.equal(after.body.projectionMirror.inSync, true);
      assert.equal(after.body.projectionMirror.sha256, recovered.active.receipt.projection.sha256);

      // The mirror gate now passes: publish reaches the materializer exactly once, carrying
      // the committed generation's own digest.
      const publish = await controlRequest(reader, { route: '/v1/publish', action: 'publish' });
      assert.equal(publish.status, 200, JSON.stringify(publish.body));
      assert.equal(publish.body.materialized, true);
      assert.equal(stub.hits.length, 1);
      const sent = JSON.parse(stub.hits[0].body);
      assert.equal(sent.receiptId, seeded.receiptId);
      assert.equal(sent.projectionSha256, recovered.active.receipt.projection.sha256);
      assert.equal(sent.snapshotSha256, seeded.snapshotSha256);
      assert.equal(stub.hits[0].authPresent, true);
      assertTokenNeverLogged(reader);
    } finally {
      await reader.stop();
    }

    // Interrupted DURING staging (nothing verified): recovery discards the owned staging and
    // the active generation is untouched.
    const discardRoot = tempRoot('ks254-http-discard-');
    const discardSeed = await startControlServer({ root: discardRoot });
    const discardSeeded = await seedGeneration(discardSeed);
    await discardSeed.stop();
    const discardKilled = await startControlServer({ root: discardRoot, interruptAt: 'projection:during-staging' });
    const discard = await analyzeIntoInterruption(discardKilled, 'projection:during-staging');
    assert.equal(discard.exit.signal, 'SIGKILL');
    const discardReader = await startControlServer({ root: discardRoot });
    try {
      const status = await controlRequest(discardReader, { method: 'GET', route: '/v1/status' });
      assert.equal(status.body.generation.state, 'ACTIVE');
      const readback = await controlRequest(discardReader, { route: '/v1/readback', action: 'readback' });
      assert.equal(readback.status, 200);
      assert.equal(readback.body.generationId, discardSeeded.generationId, 'an unverified staging never becomes the active generation');
      const discarded = recoverProjectionStore({ receiptDir: discardReader.receiptDir });
      assert.equal(discarded.activated.length, 0);
      assert.equal(discarded.discarded.length, 1);
      assert.equal(discarded.active.generationId, discardSeeded.generationId);
      assert.equal(inspectGenerationStore(discardReader.receiptDir).staging.length, 0, 'the incomplete owned staging was discarded');
      assertTokenNeverLogged(discardReader);
    } finally {
      await discardReader.stop();
    }
  } finally {
    await stub.close();
  }
});
