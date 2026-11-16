// KS322: opt-in backing for the existing evidence owner, not an event bus or
// a PAN producer. Trusted host configuration and current authorization are
// required; payload/artifact digests alone authenticate no external source.
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../canonical-json.js';

const fail = code => { const error = new Error(code); error.code = code; throw error; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('PROCESS_CONFIG_DENIED');
  const ds = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(ds).length !== keys.length || keys.some(key => !Object.hasOwn(ds, key))
    || Reflect.ownKeys(ds).some(key => typeof key !== 'string' || !ds[key].enumerable || !('value' in ds[key]))) fail('PROCESS_CONFIG_DENIED');
}

// Internal backing factory: validation stays owned by core-contracts.mjs.
export function createAgentProcessEvidenceBackingV1(options, assertEnvelope, eventType) {
  exact(options, ['stateRoot', 'binding', 'authorizeRead', 'maxEvents']);
  exact(options.binding, ['scope', 'sourceId', 'sourceEpoch', 'streamId', 'producer']);
  exact(options.binding.scope, ['tenantId', 'principalDigest', 'privacyEpoch']);
  exact(options.binding.producer, ['id', 'version', 'artifactDigest']);
  const { scope, producer } = options.binding;
  if (!id(scope.tenantId) || !hex(scope.principalDigest) || !Number.isSafeInteger(scope.privacyEpoch) || scope.privacyEpoch < 1
    || options.binding.sourceId !== 'pan548.signed-native-context-outbox/v1' || !hex(options.binding.sourceEpoch)
    || !id(options.binding.streamId) || !id(producer.id) || typeof producer.version !== 'string'
    || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(producer.version)
    || typeof producer.artifactDigest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(producer.artifactDigest)
    || typeof options.authorizeRead !== 'function' || !Number.isSafeInteger(options.maxEvents) || options.maxEvents < 1 || options.maxEvents > 128) fail('PROCESS_CONFIG_DENIED');
  const binding = structuredClone(options.binding), maxEvents = options.maxEvents, authorizeRead = options.authorizeRead;
  const bindingBytes = canonicalJson({ schemaVersion: 'kaleidosphere.agent-process/inbox-binding/v1', binding, maxEvents });
  const authorize = () => { if (authorizeRead(structuredClone(binding)) !== true) fail('PROCESS_CURRENT_SCOPE_DENIED'); };
  authorize();
  const root = options.stateRoot;
  if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root || /[\x00-\x1f\x7f]/.test(root)) fail('PROCESS_OWNED_ROOT_DENIED');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) fail('PROCESS_OWNED_ROOT_DENIED');
  const file = join(root, 'agent-process-inbox-v1.sqlite');
  let fd;
  try {
    try { fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); }
    catch (error) { if (error.code !== 'EEXIST') throw error; fd = openSync(file, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) fail('PROCESS_OWNED_FILE_DENIED');
  } finally { if (fd !== undefined) closeSync(fd); }
  const db = new DatabaseSync(file);
  const transaction = body => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = body(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
      CREATE TABLE IF NOT EXISTS process_inbox_settings(id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL) STRICT;
      CREATE TABLE IF NOT EXISTS process_inbox_events(event_id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE CHECK(seq>0), bytes BLOB NOT NULL, raw_sha256 TEXT NOT NULL) STRICT;`);
    transaction(() => {
      db.prepare('INSERT OR IGNORE INTO process_inbox_settings VALUES(1,?)').run(bindingBytes);
      if (db.prepare('SELECT binding FROM process_inbox_settings WHERE id=1').get().binding !== bindingBytes) fail('PROCESS_BINDING_DRIFT_DENIED');
    });
  } catch (error) { db.close(); throw error; }
  let closed = false;
  const current = () => { if (closed) fail('PROCESS_STORE_CLOSED'); authorize(); };
  const decode = bytes => {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > 65536) fail('PROCESS_BYTES_DENIED');
    const raw = Buffer.from(bytes);
    let text, event;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw); event = JSON.parse(text); }
    catch { fail('PROCESS_BYTES_DENIED'); }
    if (!raw.equals(Buffer.from(text))) fail('PROCESS_BYTES_DENIED');
    assertEnvelope(event);
    const p = event.payload;
    if (event.eventType !== eventType || event.streamId !== binding.streamId || canonicalJson(event.version.producer) !== canonicalJson(binding.producer)
      || canonicalJson(p.scope) !== canonicalJson(binding.scope) || p.source.sourceId !== binding.sourceId || p.source.sourceEpoch !== binding.sourceEpoch) fail('PROCESS_SOURCE_SCOPE_DENIED');
    return { raw, event };
  };
  const events = () => {
    current();
    const rows = db.prepare('SELECT * FROM process_inbox_events ORDER BY seq').all();
    const result = rows.map((row, index) => {
      const { raw, event } = decode(row.bytes);
      if (hash(raw) !== row.raw_sha256 || event.eventId !== row.event_id || event.seq !== row.seq || row.seq !== index + 1) fail('PROCESS_STORED_EVIDENCE_DENIED');
      return event;
    });
    authorize();
    return result;
  };
  const importBytes = bytes => {
    current();
    const { raw, event } = decode(bytes);
    return transaction(() => {
      authorize();
      const count = db.prepare('SELECT count(*) AS n FROM process_inbox_events').get().n;
      const prior = db.prepare('SELECT * FROM process_inbox_events WHERE event_id=?').get(event.eventId);
      if (prior) {
        if (!raw.equals(Buffer.from(prior.bytes))) fail('PROCESS_ID_COLLISION_DENIED');
        if (hash(prior.bytes) !== prior.raw_sha256) fail('PROCESS_STORED_EVIDENCE_DENIED');
        return { status: 'DUPLICATE', persisted: true, event, count, rawSha256: prior.raw_sha256 };
      }
      if (event.seq <= count) fail('PROCESS_SEQUENCE_COLLISION_DENIED');
      if (event.seq > count + 1) return { status: 'GAP', persisted: false, count, expectedSequence: count + 1, receivedSequence: event.seq };
      if (count >= maxEvents) fail('PROCESS_CAPACITY_DENIED');
      if (event.causationId) {
        const row = db.prepare('SELECT bytes FROM process_inbox_events WHERE event_id=?').get(event.causationId);
        if (!row) fail('EVENT_CAUSATION_UNKNOWN');
        if (decode(row.bytes).event.correlationId !== event.correlationId) fail('EVENT_CORRELATION_MISMATCH');
      }
      db.prepare('INSERT INTO process_inbox_events VALUES(?,?,?,?)').run(event.eventId, event.seq, raw, hash(raw));
      return { status: 'IMPORTED', persisted: true, event, count: count + 1, rawSha256: hash(raw) };
    }); // No acknowledgement can escape before SQLite COMMIT has succeeded.
  };
  return Object.freeze({ importBytes, durableEvents: events,
    close() { if (!closed) { db.close(); closed = true; } } });
}
