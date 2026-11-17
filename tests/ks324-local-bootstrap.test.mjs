// SYNTHETIC single-host product bootstrap: real owner, SQLite and unmodified
// server entrypoints. No preload, fetch replacement, DNS alias or fake replies.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { InMemoryEvidenceStore, sha256Digest } from '../services/bi-control/src/assistant-foundation/core-contracts.mjs';

const repo = resolve(import.meta.dirname, '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const agentScript = 'services/bi-agent/src/server.mjs';
const controlScript = 'services/bi-control/src/server.mjs';

async function unusedPort() {
  const server = createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function productEnv() {
  // Deliberate allowlist: in particular no NODE_OPTIONS, NODE_PATH, test
  // transport, proxy, inherited tenant binding or optional runtime activation.
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGCONT');
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}

async function ready(origin, child, prefix = '') {
  for (let i = 0; i < 100; i++) {
    assert.equal(child.exitCode, null, 'Product exited before readiness; see child log');
    try { if ((await fetch(origin + prefix + '/healthz')).ok) return; } catch {}
    await delay(30);
  }
  throw Error('Product readiness timeout: ' + origin);
}

function jsonRequest(url, body = { phase: 'ALL' }, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch (error) { reject(error); }
      });
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end(JSON.stringify(body));
  });
}

function sqlReadback(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const rows = db.prepare('SELECT event_id, seq, bytes, raw_sha256 FROM process_inbox_events ORDER BY seq').all();
    for (const row of rows) assert.equal(hash(row.bytes), row.raw_sha256);
    return {
      schema: db.prepare('SELECT name, sql FROM sqlite_schema ORDER BY name').all(),
      settings: db.prepare('SELECT * FROM process_inbox_settings ORDER BY id').all(),
      rows: rows.map(row => ({ ...row, bytes: Buffer.from(row.bytes).toString('utf8') })),
      events: rows.map(row => JSON.parse(Buffer.from(row.bytes).toString('utf8'))),
    };
  } finally { db.close(); }
}

async function startLocalProduct({ localPort = true, outputRoot } = {}) {
  const parent = outputRoot ?? process.env.KS324_R1_EVIDENCE_ROOT ?? tmpdir();
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, 'ks324-r1-SYNTHETIC-'));
  const stateRoot = join(root, 'inbox');
  const base = JSON.parse(readFileSync(join(repo, 'services/bi-control/fixtures/assistant-foundation/event-envelope-v1.json'), 'utf8'));
  const binding = { scope: { tenantId: 'SYNTHETIC-local', principalDigest: 'c'.repeat(64), privacyEpoch: 1 },
    sourceId: 'pan548.signed-native-context-outbox/v1', sourceEpoch: 'a'.repeat(64), streamId: 'ks324:SYNTHETIC-stream', producer: base.version.producer };
  const owner = new InMemoryEvidenceStore({ agentProcess: { stateRoot, binding, authorizeRead: () => true, maxEvents: 128 } });
  const make = (id, seq, task, phase, revision, time, cause = null) => {
    const event = structuredClone(base);
    Object.assign(event, { eventType: 'pan.workspace.action.observed', eventId: 'ks324:SYNTHETIC-' + id, streamId: binding.streamId,
      seq, correlationId: 'ks324:SYNTHETIC-case', causationId: cause ? 'ks324:SYNTHETIC-' + cause : null });
    event.version.contract = 'workspace-action-observation';
    event.payload = { schemaVersion: 'kaleidosphere.agent-process/action-observation/v1', scope: structuredClone(binding.scope),
      source: { sourceId: binding.sourceId, sourceEpoch: binding.sourceEpoch, eventDigest: sha256Digest({ SYNTHETIC: id }).slice(7), sourceTimeMs: time },
      action: { taskId: 'invocation:SYNTHETIC-' + task, stepId: 'step:SYNTHETIC-' + task, attempt: 1,
        capability: 'pan.workspace.view.preview/v1', taskRevision: revision }, mode: 'PREVIEW', phase,
      result: phase === 'RESULT_CONFIRMED' ? { resultPhase: 'PREVIEW_VALIDATED', proofRef: 'context-proof:' + 'f'.repeat(64), proofKind: 'PAN546_PREVIEW_VALIDATED' } : null,
      readbackRef: phase === 'RESULT_CONFIRMED' ? 'invocation:SYNTHETIC-' + task : null,
      processFacts: 'NOT_OBSERVED', humanFacts: 'NOT_OBSERVED', grantFacts: 'NOT_OBSERVED' };
    event.payloadDigest = sha256Digest(event.payload);
    return event;
  };
  const events = [make('pending', 1, 'preview', 'PENDING', 1, 100), make('confirmed', 2, 'preview', 'RESULT_CONFIRMED', 2, 350, 'pending'),
    make('unknown', 3, 'readback', 'UNKNOWN', 1, null)];
  let acks;
  try { acks = events.map(event => owner.importBytes(Buffer.from(JSON.stringify(event)))); }
  finally { owner.close(); } // No live fixture owner can supply an in-memory response.
  assert.ok(acks.every(ack => ack.status === 'IMPORTED' && ack.persisted));
  const database = join(stateRoot, 'agent-process-inbox-v1.sqlite');
  const before = sqlReadback(database);
  assert.deepEqual(before.events, events);
  const token = randomBytes(32).toString('hex'), tokenFile = join(root, 'SYNTHETIC-control-token'), configFile = join(root, 'process-owner.json');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  writeFileSync(configFile, JSON.stringify({ stateRoot, binding, maxEvents: 128 }), { mode: 0o600 });
  const controlPort = await unusedPort(), control = 'http://127.0.0.1:' + controlPort;
  const children = [], logs = [], launches = [], errors = new WeakMap();
  const launch = (name, script, overrides) => {
    const env = { ...productEnv(), ...overrides };
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.KS324_TEST_CONTROL_BASE, undefined);
    const log = createWriteStream(join(root, name + '.log'), { flags: 'wx' });
    const child = spawn(process.execPath, [script], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    errors.set(child, '');
    child.stderr.on('data', bytes => errors.set(child, errors.get(child) + bytes.toString('utf8')));
    children.push(child); logs.push(log);
    launches.push({ name, pid: child.pid, executable: process.execPath, argv: [script], cwd: repo, env });
    return child;
  };
  const common = { CONTROL_TOKEN_FILE: tokenFile, RECEIPT_DIR: join(root, 'receipts'), PROJECTION_DB: join(root, 'projection.sqlite'),
    REPOSITORY_ROOT: join(repo, 'services/bi-control'), BI_FIXTURE_DIR: join(repo, 'services/bi-control/fixtures'),
    BI_ENGINE: 'mssql', BI_SOURCE_MODE: 'fixture', CONTROL_BIND_ADDRESS: '127.0.0.1', KS_H03_STARTER_OPT_IN: 'false', KS_H05_NATIVE_PROBE_OPT_IN: 'false' };
  const backend = launch('control', controlScript, { ...common, PORT: String(controlPort), KS324_PROCESS_INBOX_CONFIG_FILE: configFile });
  const startAgent = async (overrides = {}, wait = true) => {
    const agentPort = await unusedPort(), origin = 'http://127.0.0.1:' + agentPort;
    const env = { ...common, PORT: String(agentPort), CONTROL_BASE_URL: 'http://bi-control:18089', AGENT_ROUTE_PREFIX: '',
      ...(localPort ? { KS324_PROCESS_VIEW_CONTROL_PORT: String(controlPort) } : {}), ...overrides };
    for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key];
    const child = launch('agent-' + children.length, agentScript, env);
    if (wait) await ready(origin, child, env.AGENT_ROUTE_PREFIX);
    return { child, origin, port: agentPort, stderr: () => errors.get(child) };
  };
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.all(children.map(stop));
    await Promise.all(logs.map(log => new Promise(resolve => log.end(resolve))));
    rmSync(tokenFile, { force: true });
    writeFileSync(join(root, 'launches.json'), JSON.stringify({ launches, exits: children.map(child => ({ pid: child.pid, code: child.exitCode, signal: child.signalCode })), tokenRemoved: !existsSync(tokenFile) }, null, 2) + '\n');
    if (!outputRoot && !process.env.KS324_R1_EVIDENCE_ROOT) rmSync(root, { recursive: true, force: true });
  };
  try {
    await ready(control, backend);
    const agent = await startAgent();
    return { root, database, before, events, acks, tokenFile, control, controlPort, backend, ...agent, startAgent, close,
      request: (body, headers) => jsonRequest(agent.origin + '/api/process-view', body, headers),
      direct: body => jsonRequest(control + '/v1/process-view/read', body, { authorization: 'Bearer ' + token }) };
  } catch (error) { await close(); throw error; }
}

if (process.argv[2] === '--serve') {
  // Private browser harness entrypoint; outputs are never a replacement backend.
  const f = await startLocalProduct({ outputRoot: resolve(process.argv[3]), localPort: process.argv[4] !== '--without-option' });
  const info = { root: f.root, origin: f.origin, control: f.control, database: f.database, tokenFile: f.tokenFile,
    agentPid: f.child.pid, controlPid: f.backend.pid,
    acks: f.acks.map(({ status, persisted, count }) => ({ status, persisted, count })), before: f.before };
  writeFileSync(join(f.root, 'product.json'), JSON.stringify(info, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ ...info, before: undefined }));
  const finish = async () => { await f.close(); process.exit(0); };
  process.once('SIGTERM', finish); process.once('SIGINT', finish);
} else {
  test('KS324 R1 direct local product bootstrap reads committed SYNTHETIC owner over real HTTP', async t => {
    const f = await startLocalProduct(); t.after(f.close);
    const direct = await f.direct();
    assert.equal(direct.status, 200); assert.equal(direct.body.state, 'CURRENT');
    const viaAgent = await f.request();
    t.diagnostic(JSON.stringify({ evidence: f.root, control: f.control, origin: f.origin, directStatus: direct.status, agentStatus: viaAgent.status, agentCode: viaAgent.body.code }));
    assert.equal(viaAgent.status, 200);
    assert.deepEqual(viaAgent.body, direct.body);
    const { body } = viaAgent, persisted = f.before.events;
    assert.deepEqual(body.rows.map(row => row.eventId), persisted.map(event => event.eventId));
    assert.equal(body.metrics.confirmedResults.value, persisted.filter(event => event.payload.phase === 'RESULT_CONFIRMED').length);
    assert.equal(body.metrics.unknownOutcomes.value, persisted.filter(event => event.payload.phase === 'UNKNOWN').length);
    assert.equal(body.metrics.actionDurations.values[0].value, persisted[1].payload.source.sourceTimeMs - persisted[0].payload.source.sourceTimeMs);
    assert.equal(body.metrics.actionDurations.values[1].value, null);
    assert.equal(body.metrics.actionDurations.values[1].status, 'UNKNOWN');
    assert.equal(body.inputStateDigest, sha256Digest({ binding: body.input.binding, requiredThroughSequence: null, events: persisted }));
    const filtered = await f.request({ phase: 'UNKNOWN' });
    assert.equal(filtered.status, 200); assert.deepEqual(filtered.body.rows.map(row => row.eventId), [persisted[2].eventId]);
    assert.deepEqual(filtered.body.metrics, body.metrics);
    assert.deepEqual(sqlReadback(f.database), f.before);
  });

  test('KS324 R1 local option rejects noncanonical ports at startup, not on the first read', async t => {
    const f = await startLocalProduct(); t.after(f.close);
    const invalid = ['', '0', '00', '01', '00080', '-1', '+1', ' 80', '80 ', '\t80', '80\n', '80\r', '1.0', '1e2', '0x50',
      '65536', '99999999999999999999', 'NaN', 'Infinity', '１２', '127.0.0.1:80', 'http://127.0.0.1:80', '80/path', '80?x=1', '80#x', '80@other'];
    for (const value of invalid) await t.test(JSON.stringify(value), async () => {
      const { child, stderr } = await f.startAgent({ KS324_PROCESS_VIEW_CONTROL_PORT: value }, false);
      const exited = new Promise(resolve => child.once('exit', resolve));
      const timer = setTimeout(() => stop(child), 3000);
      try { await exited; } finally { clearTimeout(timer); }
      assert.equal(child.exitCode, 1, 'Invalid option must fail closed during startup');
      assert.match(stderr(), /AGENT_PROCESS_CONTROL_PORT_DENIED/);
    });
    for (const value of ['1', '65535']) {
      const agent = await f.startAgent({ KS324_PROCESS_VIEW_CONTROL_PORT: value });
      assert.equal((await fetch(agent.origin + '/healthz')).status, 200);
    }
  });

  test('KS324 R1 global route pin remains exact even with the new local port enabled', async t => {
    const f = await startLocalProduct(); t.after(f.close);
    for (const value of [undefined, '', 'http://127.0.0.1:' + f.controlPort, 'http://localhost:18089', 'http://bi-control:18089/', 'https://bi-control:18089', 'HTTP://bi-control:18089', ' http://bi-control:18089']) {
      const { child, stderr } = await f.startAgent({ CONTROL_BASE_URL: value }, false);
      const exited = new Promise(resolve => child.once('exit', resolve));
      const timer = setTimeout(() => stop(child), 3000);
      try { await exited; } finally { clearTimeout(timer); }
      assert.equal(child.exitCode, 1);
      assert.match(stderr(), /AGENT_CONTROL_ROUTE_DENIED/);
    }
    const source = readFileSync(join(repo, agentScript), 'utf8');
    assert.ok(source.includes("if (controlBase !== 'http://bi-control:18089') throw new Error('AGENT_CONTROL_ROUTE_DENIED');"));
    for (const name of ['control', 'controlJson']) {
      const fn = source.slice(source.indexOf('async function ' + name + '(')).split('\n}\n')[0];
      assert.ok(fn.includes('fetch(`${controlBase}${path}`'));
      assert.equal(fn.includes('processViewControl'), false);
      assert.equal(fn.includes('KS324_PROCESS_VIEW_CONTROL_PORT'), false);
    }
  });

  test('KS324 R1 direct port retains actual local, Host, Origin, Fetch-Site, scope and prefix denials', async t => {
    const f = await startLocalProduct(); t.after(f.close);
    for (const headers of [{ host: 'SYNTHETIC-foreign.invalid:' + f.port }, { origin: 'http://SYNTHETIC-foreign.invalid' },
      { origin: f.origin + '/' }, { 'sec-fetch-site': 'cross-site' }, { 'sec-fetch-site': 'same-site' }]) {
      assert.deepEqual(await f.request({ phase: 'ALL' }, headers), { status: 400, body: { status: 'DENIED', code: 'AGENT_PROCESS_ORIGIN_DENIED' } });
    }
    for (const headers of [{ origin: f.origin, 'sec-fetch-site': 'same-origin' }, { 'sec-fetch-site': 'none' }]) assert.equal((await f.request({ phase: 'ALL' }, headers)).status, 200);
    const address = Object.values(networkInterfaces()).flat().find(item => item.family === 'IPv4' && !item.internal)?.address;
    assert.ok(address, 'A real nonloopback interface is required for this boundary probe');
    const nonlocal = await jsonRequest('http://' + address + ':' + f.port + '/api/process-view', { phase: 'ALL' }, { host: '127.0.0.1:' + f.port });
    assert.deepEqual(nonlocal, { status: 400, body: { status: 'DENIED', code: 'AGENT_PROCESS_LOCAL_ONLY' } });
    for (const key of ['scope', 'tenant', 'tenantId', 'principal', 'role', 'sourceEpoch', 'url', 'host', 'path', 'controlPort', 'KS324_PROCESS_VIEW_CONTROL_PORT']) {
      const denied = await f.request({ phase: 'ALL', [key]: key === 'scope' ? { tenantId: 'SYNTHETIC-foreign' } : f.control });
      assert.deepEqual(denied, { status: 400, body: { status: 'DENIED', code: 'CONTROL_REQUEST_SURFACE_DENIED' } });
    }
    const prefixed = await f.startAgent({ AGENT_ROUTE_PREFIX: '/t/SYNTHETIC'.toLowerCase() });
    const denied = await jsonRequest(prefixed.origin + '/t/synthetic/api/process-view');
    assert.deepEqual(denied, { status: 400, body: { status: 'DENIED', code: 'AGENT_PROCESS_PROTECTED_BINDING_UNAVAILABLE' } });
    assert.deepEqual(sqlReadback(f.database), f.before);
    writeFileSync(f.tokenFile, randomBytes(32).toString('hex'), { mode: 0o600 });
    assert.deepEqual(await f.request(), { status: 400, body: { status: 'DENIED', code: 'CONTROL_AUTH_DENIED' } });
    rmSync(f.tokenFile);
    assert.deepEqual(await f.request(), { status: 400, body: { status: 'DENIED', code: 'AGENT_CONTROL_TOKEN_MISSING' } });
  });
}
