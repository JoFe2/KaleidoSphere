// R2: authored SYNTHETIC evidence, real control HTTP, existing owner and SQLite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { InMemoryEvidenceStore, sha256Digest } from '../services/bi-control/src/assistant-foundation/core-contracts.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';

const filename = 'agent-process-inbox-v1.sqlite';
const base = JSON.parse(readFileSync(new URL('../services/bi-control/fixtures/assistant-foundation/event-envelope-v1.json', import.meta.url)));
const binding = { scope: { tenantId: 'SYNTHETIC-r2', principalDigest: 'c'.repeat(64), privacyEpoch: 1 },
  sourceId: 'pan548.signed-native-context-outbox/v1', sourceEpoch: 'a'.repeat(64),
  streamId: 'ks324:SYNTHETIC-r2', producer: base.version.producer };
const bindingBytes = value => canonicalJson({ schemaVersion: 'kaleidosphere.agent-process/inbox-binding/v1', binding: value, maxEvents: 128 });
const options = (stateRoot, extra = {}) => ({ agentProcess: { stateRoot, binding, authorizeRead: () => true, maxEvents: 128, ...extra } });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

function sampleEvents() {
  return ['PENDING', 'RESULT_CONFIRMED', 'UNKNOWN'].map((phase, index) => {
    const event = structuredClone(base), taskId = `invocation:SYNTHETIC-${index === 2 ? 'unknown' : 'preview'}`;
    Object.assign(event, { eventType: 'pan.workspace.action.observed', eventId: `ks324:SYNTHETIC-r2-${index}`,
      streamId: binding.streamId, seq: index + 1, correlationId: 'ks324:SYNTHETIC-r2-case',
      causationId: index === 1 ? 'ks324:SYNTHETIC-r2-0' : null });
    event.version.contract = 'workspace-action-observation';
    event.payload = { schemaVersion: 'kaleidosphere.agent-process/action-observation/v1', scope: structuredClone(binding.scope),
      source: { sourceId: binding.sourceId, sourceEpoch: binding.sourceEpoch, eventDigest: sha256Digest({ SYNTHETIC: index }).slice(7), sourceTimeMs: [100, 350, null][index] },
      action: { taskId, stepId: 'step:SYNTHETIC-r2', attempt: 1, capability: 'pan.workspace.view.preview/v1', taskRevision: index === 1 ? 2 : 1 },
      mode: 'PREVIEW', phase, result: index === 1 ? { resultPhase: 'PREVIEW_VALIDATED', proofRef: 'context-proof:' + 'f'.repeat(64), proofKind: 'PAN546_PREVIEW_VALIDATED' } : null,
      readbackRef: index === 1 ? taskId : null, processFacts: 'NOT_OBSERVED', humanFacts: 'NOT_OBSERVED', grantFacts: 'NOT_OBSERVED' };
    event.payloadDigest = sha256Digest(event.payload);
    return event;
  });
}

function fixture(t, label) {
  const root = mkdtempSync(join(tmpdir(), 'ks324-r2-'));
  const stateRoot = join(root, 'inbox');
  mkdirSync(stateRoot, { mode: 0o700 });
  const evidenceRoot = process.env.KS324_R2_EVIDENCE_DIR;
  const evidence = evidenceRoot ? join(evidenceRoot, label) : null;
  if (evidence) mkdirSync(evidence, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, stateRoot, file: join(stateRoot, filename), evidence };
}

// Never open the source for forensic SQL: even a probe must not initialize it.
// Freeze exact main/sidecar bytes first, then inspect a disposable private copy.
function snapshot(f, label) {
  const files = Object.fromEntries(readdirSync(f.stateRoot).sort().map(name => {
    const bytes = readFileSync(join(f.stateRoot, name)), stat = lstatSync(join(f.stateRoot, name));
    if (f.evidence) writeFileSync(join(f.evidence, `${label}-${name}`), bytes, { mode: 0o600 });
    return [name, { size: bytes.length, sha256: sha256(bytes), bytes: bytes.toString('base64'),
      mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }];
  }));
  let sql = null;
  if (files[filename]) {
    const copy = mkdtempSync(join(tmpdir(), 'ks324-r2-inspect-'));
    let db;
    try {
      for (const [name, file] of Object.entries(files)) writeFileSync(join(copy, name), Buffer.from(file.bytes, 'base64'), { mode: 0o600 });
      db = new DatabaseSync(join(copy, filename), { readOnly: true });
      const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
      const has = name => schema.some(row => row.type === 'table' && row.name === name);
      sql = { schema,
        settings: has('process_inbox_settings') ? db.prepare('SELECT * FROM process_inbox_settings ORDER BY id').all() : null,
        events: has('process_inbox_events') ? db.prepare('SELECT event_id,seq,hex(bytes) AS bytes,raw_sha256 FROM process_inbox_events ORDER BY seq').all() : null };
    } catch (error) { sql = { error: error.code, message: error.message }; }
    finally { db?.close(); rmSync(copy, { recursive: true, force: true }); }
  }
  const result = { files, sql };
  if (f.evidence) writeFileSync(join(f.evidence, `${label}.json`), JSON.stringify(result, null, 2));
  return result;
}

function saveResult(f, result) {
  if (f.evidence) writeFileSync(join(f.evidence, 'http.json'), JSON.stringify(result, null, 2));
}

async function startControl(t, f) {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const token = randomBytes(32).toString('hex'), tokenFile = join(f.root, 'control-token');
  const configFile = join(f.root, 'owner.json');
  writeFileSync(tokenFile, token, { mode: 0o600 });
  writeFileSync(configFile, JSON.stringify({ stateRoot: f.stateRoot, binding, maxEvents: 128 }), { mode: 0o600 });
  const env = { ...process.env, PORT: String(port), CONTROL_BIND_ADDRESS: '127.0.0.1', CONTROL_TOKEN_FILE: tokenFile,
    KS324_PROCESS_INBOX_CONFIG_FILE: configFile, RECEIPT_DIR: join(f.root, 'receipts'), PROJECTION_DB: join(f.root, 'projection.sqlite'),
    REPOSITORY_ROOT: resolve('services/bi-control'), BI_FIXTURE_DIR: resolve('services/bi-control/fixtures'),
    BI_ENGINE: 'mssql', BI_SOURCE_MODE: 'fixture', KS_H03_STARTER_OPT_IN: 'false', KS_H05_NATIVE_PROBE_OPT_IN: 'false' };
  delete env.NODE_OPTIONS;
  delete env.KS324_TEST_CONTROL_BASE;
  const child = spawn(process.execPath, ['services/bi-control/src/server.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout.on('data', bytes => { log += bytes; });
  child.stderr.on('data', bytes => { log += bytes; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      await exited;
      clearTimeout(timer);
    }
    rmSync(tokenFile, { force: true });
    if (f.evidence) writeFileSync(join(f.evidence, 'control.log'), log);
  });
  const url = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw Error(`Control exited: ${log}`);
    try { ready = (await fetch(url + '/healthz')).ok; } catch {}
    if (ready) break;
    await pause(30);
  }
  assert.ok(ready, 'real control must become ready');
  return { tokenFile, async request(body = { phase: 'ALL' }, auth = true) {
    const response = await fetch(url + '/v1/process-view/read', { method: 'POST', headers: {
      'content-type': 'application/json', ...(auth ? { authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  } };
}

function prepare(f, kind) {
  if (kind === 'missing') return;
  if (kind === 'zero-byte') { writeFileSync(f.file, '', { mode: 0o600 }); return; }
  if (kind === 'corrupt') { writeFileSync(f.file, 'SYNTHETIC not a SQLite database', { mode: 0o600 }); return; }
  writeFileSync(f.file, '', { mode: 0o600 });
  const db = new DatabaseSync(f.file);
  try {
    if (kind === 'empty-sqlite') { db.exec('VACUUM'); return; }
    db.exec('CREATE TABLE process_inbox_settings(id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL) STRICT');
    if (kind === 'partial-foreign-binding') {
      const foreign = structuredClone(binding); foreign.scope.tenantId = 'SYNTHETIC-foreign';
      db.prepare('INSERT INTO process_inbox_settings VALUES(1,?)').run(bindingBytes(foreign));
    }
    if (kind === 'partial-matching-binding') db.prepare('INSERT INTO process_inbox_settings VALUES(1,?)').run(bindingBytes(binding));
  } finally { db.close(); }
}

for (const kind of ['missing', 'zero-byte', 'empty-sqlite', 'partial-settings', 'partial-foreign-binding', 'partial-matching-binding', 'corrupt']) {
  test(`KS324 R2 real HTTP refuses ${kind} without initializing bytes/schema/settings/events`, async t => {
    const f = fixture(t, kind); prepare(f, kind);
    const control = await startControl(t, f), before = snapshot(f, 'before');
    const response = await control.request(), after = snapshot(f, 'after');
    saveResult(f, response);
    // Assert actual effects before response semantics: the d8 RED is real mutation.
    assert.deepEqual(after, before, `${kind}: the read must preserve exact DB/sidecar bytes and SQL state`);
    if (kind === 'missing') {
      assert.deepEqual(response, { status: 200, body: { state: 'MISSING', code: 'PROCESS_VIEW_INBOX_MISSING', rows: [], metrics: null } });
    } else {
      assert.equal(response.status, 400);
      assert.equal(response.body.status, 'DENIED');
      assert.equal(response.body.metrics, undefined);
      assert.equal(response.body.rows, undefined);
      if (kind === 'partial-foreign-binding') assert.equal(response.body.code, 'PROCESS_BINDING_DRIFT_DENIED');
    }
  });
}

for (const seeded of [false, true]) {
  test(`KS324 R2 explicit initialized ${seeded ? 'CURRENT COMMIT/reopen/duplicate/metrics/filter' : 'EMPTY'} remains honest and read-only over HTTP`, async t => {
    const f = fixture(t, seeded ? 'current' : 'empty'), events = seeded ? sampleEvents() : [];
    const writer = new InMemoryEvidenceStore(options(f.stateRoot));
    for (const event of events) assert.equal(writer.importBytes(Buffer.from(JSON.stringify(event))).status, 'IMPORTED');
    writer.close();
    const control = await startControl(t, f), before = snapshot(f, 'before');
    const all = await control.request(), filtered = await control.request({ phase: 'UNKNOWN' });
    saveResult(f, { all, filtered });
    assert.equal(all.status, 200); assert.equal(all.body.state, seeded ? 'CURRENT' : 'EMPTY');
    assert.deepEqual(all.body.rows.map(row => row.eventId), events.map(event => event.eventId));
    assert.equal(all.body.metrics.input.status, 'COMMITTED_PREFIX');
    assert.equal(all.body.metrics.confirmedResults.value, seeded ? 1 : 0);
    assert.equal(all.body.metrics.unknownOutcomes.value, seeded ? 1 : 0);
    assert.equal(all.body.metrics.input.sourceHead, 'NOT_ATTESTED');
    assert.equal(filtered.status, 200);
    assert.deepEqual(filtered.body.rows.map(row => row.eventId), events.slice(2).map(event => event.eventId));
    assert.equal(filtered.body.inputStateDigest, all.body.inputStateDigest);
    if (seeded) assert.equal(all.body.metrics.actionDurations.values[0].value, 250);
    const after = snapshot(f, 'after');
    // SQLite may create transient WAL/SHM coordination files for a read-only handle;
    // persistent DB bytes and SQL content must not change.
    assert.deepEqual(after.files[filename], before.files[filename]);
    assert.deepEqual(after.sql, before.sql);
    const reopened = new InMemoryEvidenceStore(options(f.stateRoot));
    try {
      assert.deepEqual(reopened.durableEvents(), events);
      for (const event of events) assert.equal(reopened.importBytes(Buffer.from(JSON.stringify(event))).status, 'DUPLICATE');
      assert.deepEqual(reopened.processMetrics(), all.body.metrics);
    } finally { reopened.close(); }
  });
}

test('KS324 R2 current control auth denies before opening invalid or valid owners, including credential retirement', async t => {
  const f = fixture(t, 'http-auth'); prepare(f, 'zero-byte');
  const control = await startControl(t, f), before = snapshot(f, 'before');
  assert.deepEqual(await control.request({ phase: 'ALL' }, false), { status: 401, body: { status: 'DENIED', code: 'CONTROL_AUTH_DENIED' } });
  assert.deepEqual(snapshot(f, 'after-unauthenticated'), before);
  rmSync(f.file);
  const owner = new InMemoryEvidenceStore(options(f.stateRoot)); owner.close();
  const valid = snapshot(f, 'valid-before');
  rmSync(control.tokenFile);
  assert.deepEqual(await control.request(), { status: 401, body: { status: 'DENIED', code: 'CONTROL_AUTH_DENIED' } });
  assert.deepEqual(snapshot(f, 'valid-after'), valid);
});

test('KS324 R2 existing-only owner mode denies all mutations and rechecks authorization at read/return', t => {
  const f = fixture(t, 'owner-read-only'), events = sampleEvents();
  const writer = new InMemoryEvidenceStore(options(f.stateRoot));
  writer.append(events[0]); writer.close();
  let allowed = true, checks = 0, denyAt = Infinity;
  const reader = new InMemoryEvidenceStore(options(f.stateRoot, { readOnly: true, authorizeRead: () => allowed && ++checks !== denyAt }));
  t.after(() => reader.close());
  const before = snapshot(f, 'before');
  assert.deepEqual(reader.durableEvents(), events.slice(0, 1));
  assert.throws(() => reader.importBytes(Buffer.from(JSON.stringify(events[1]))), /PROCESS_READ_ONLY_DENIED/);
  assert.throws(() => reader.importBytes(Buffer.from(JSON.stringify(events[0]))), /PROCESS_READ_ONLY_DENIED/);
  assert.throws(() => reader.append(events[1]), /PROCESS_READ_ONLY_DENIED/);
  allowed = false;
  for (const read of [() => reader.durableEvents(), () => reader.liveEvents(), () => reader.processMetrics()]) assert.throws(read, /PROCESS_CURRENT_SCOPE_DENIED/);
  assert.throws(() => new InMemoryEvidenceStore(options(f.stateRoot, { readOnly: true, authorizeRead: () => false })), /PROCESS_CURRENT_SCOPE_DENIED/);
  allowed = true;
  for (const [read, lastCheck] of [[() => reader.durableEvents(), 2], [() => reader.processMetrics(), 3]]) {
    for (let check = 1; check <= lastCheck; check++) {
      checks = 0; denyAt = check;
      assert.throws(read, /PROCESS_CURRENT_SCOPE_DENIED/, 'deny at every owner read/return authorization boundary');
    }
  }
  denyAt = Infinity;
  assert.deepEqual(snapshot(f, 'after'), before);
  reader.close();
  assert.throws(() => reader.durableEvents(), /PROCESS_STORE_CLOSED/);
});

test('KS324 R2 existing-only owner cannot create a missing root/file or widen config', t => {
  const f = fixture(t, 'owner-missing');
  for (const stateRoot of [f.stateRoot, join(f.root, 'absent-root')]) {
    assert.throws(() => new InMemoryEvidenceStore(options(stateRoot, { readOnly: true })), /ENOENT/);
    assert.equal(existsSync(join(stateRoot, filename)), false);
  }
  assert.equal(existsSync(join(f.root, 'absent-root')), false);
  for (const readOnly of [false, 'true', null]) assert.throws(() => new InMemoryEvidenceStore(options(f.stateRoot, { readOnly })), /PROCESS_CONFIG_DENIED/);
});

test('KS324 R2 read-only owner sees real live WAL commits and denies subsequent stored binding drift', async t => {
  const f = fixture(t, 'live-wal-binding'), events = sampleEvents();
  const writer = new InMemoryEvidenceStore(options(f.stateRoot));
  t.after(() => writer.close());
  writer.append(events[0]);
  const reader = new InMemoryEvidenceStore(options(f.stateRoot, { readOnly: true }));
  t.after(() => reader.close());
  const control = await startControl(t, f);
  assert.equal(reader.durableEvents().length, 1);
  for (const event of events.slice(1)) assert.equal(writer.importBytes(Buffer.from(JSON.stringify(event))).status, 'IMPORTED');
  const before = snapshot(f, 'before');
  assert.ok(before.files[filename + '-wal'].size > 0, 'COMMIT is in a real live WAL, not only the main file');
  const response = await control.request(); saveResult(f, response);
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.rows.map(row => row.eventId), events.map(event => event.eventId));
  assert.deepEqual(reader.durableEvents(), events);
  assert.equal(reader.processMetrics().confirmedResults.value, 1);
  const after = snapshot(f, 'after');
  for (const name of [filename, filename + '-wal']) assert.deepEqual(after.files[name], before.files[name]);
  assert.deepEqual(after.sql, before.sql);
  const db = new DatabaseSync(f.file);
  try {
    const foreign = structuredClone(binding); foreign.scope.privacyEpoch++;
    db.prepare('UPDATE process_inbox_settings SET binding=? WHERE id=1').run(bindingBytes(foreign));
    const drifted = snapshot(f, 'drifted-before');
    for (const read of [() => reader.durableEvents(), () => reader.liveEvents(), () => reader.processMetrics()]) assert.throws(read, /PROCESS_BINDING_DRIFT_DENIED/);
    assert.deepEqual(await control.request(), { status: 400, body: { status: 'DENIED', code: 'PROCESS_BINDING_DRIFT_DENIED' } });
    const denied = snapshot(f, 'drifted-after');
    // WAL readers can update SHM read marks, but never main/WAL content or SQL.
    for (const name of [filename, filename + '-wal']) assert.deepEqual(denied.files[name], drifted.files[name]);
    assert.deepEqual(denied.sql, drifted.sql);
  } finally { db.close(); }
});

test('KS324 R2 existing-only constructor denies final authorization failure and read reuses stored evidence validation', async t => {
  const f = fixture(t, 'owner-validation'), [event] = sampleEvents();
  const writer = new InMemoryEvidenceStore(options(f.stateRoot)); writer.append(event); writer.close();
  for (const denyAt of [2, 3]) {
    let checks = 0;
    assert.throws(() => new InMemoryEvidenceStore(options(f.stateRoot, { readOnly: true, authorizeRead: () => ++checks !== denyAt })), /PROCESS_CURRENT_SCOPE_DENIED/);
  }
  const db = new DatabaseSync(f.file);
  try { db.prepare('UPDATE process_inbox_events SET raw_sha256=?').run('0'.repeat(64)); }
  finally { db.close(); }
  const control = await startControl(t, f), before = snapshot(f, 'before');
  const response = await control.request(); saveResult(f, response);
  assert.deepEqual(response, { status: 400, body: { status: 'DENIED', code: 'PROCESS_STORED_EVIDENCE_DENIED' } });
  const after = snapshot(f, 'after');
  assert.deepEqual(after.files[filename], before.files[filename]);
  assert.deepEqual(after.sql, before.sql);
});
