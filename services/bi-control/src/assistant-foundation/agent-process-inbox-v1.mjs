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

// KS323: reduction of this owner's already validated, authorized committed prefix.
// No external source authentication, clock attestation, execution or business effect.
function processMetrics(binding, events, requiredThroughSequence) {
  const digest = value => `sha256:${hash(canonicalJson(value))}`;
  const throughSequence = events.at(-1)?.seq ?? 0;
  const complete = requiredThroughSequence === null || throughSequence >= requiredThroughSequence;
  const inputStateDigest = digest({ binding, requiredThroughSequence, events });
  const input = { binding: structuredClone(binding), throughSequence, requiredThroughSequence,
    status: complete ? 'COMMITTED_PREFIX' : 'INCOMPLETE_PREFIX', sourceHead: 'NOT_ATTESTED',
    inputStateDigest, eventIds: events.map(event => event.eventId) };
  const count = (formula, unit) => ({ formula, unit, inputStateDigest, status: complete ? 'OBSERVED_PREFIX' : 'UNKNOWN',
    value: complete ? 0 : null, sources: [], exclusions: [] });
  const confirmedResults = count('COUNT_DISTINCT(taskId,stepId) WHERE latest distinct non-render owner fact has matching proof and task readback', 'RESULT_COUNT');
  const unknownOutcomes = count('COUNT_DISTINCT(taskId,stepId) WHERE latest distinct non-render owner fact is UNKNOWN and attempt=1', 'OUTCOME_COUNT');
  const groups = new Map(), sourceFacts = new Map(), conflicts = new Set();
  for (const event of events) {
    const p = event.payload, key = canonicalJson([p.action.taskId, p.action.stepId]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(event);
    const signature = canonicalJson(p), prior = sourceFacts.get(p.source.eventDigest);
    if (prior !== undefined && prior !== signature) conflicts.add(p.source.eventDigest);
    sourceFacts.set(p.source.eventDigest, signature);
  }
  const values = [];
  for (const group of groups.values()) {
    const { taskId, stepId } = group[0].payload.action;
    const actionKeyDigest = digest({ binding, taskId, stepId });
    const observations = group.filter(event => event.payload.result?.proofKind !== 'PAN597_DOCUMENT_RENDERED');
    const facts = new Map();
    for (const event of observations) if (!facts.has(event.payload.source.eventDigest)) facts.set(event.payload.source.eventDigest, event);
    const usable = [...facts.values()]; // A repeated old fact cannot become a new owner outcome.
    const last = usable.at(-1), p = last?.payload;
    const identities = new Set(observations.map(event => canonicalJson([event.correlationId, event.payload.mode, event.payload.action.capability])));
    const terminalPhases = new Map();
    let priorRevision = 0, revisionRegression = false, revisionOutcomeConflict = false;
    for (const event of usable) if (event.payload.action.taskRevision !== null) {
      if (event.payload.action.taskRevision < priorRevision) revisionRegression = true;
      priorRevision = event.payload.action.taskRevision;
      const phase = event.payload.phase;
      if (event.payload.action.attempt === 1 && (phase === 'UNKNOWN' || phase === 'RESULT_CONFIRMED')) {
        const prior = terminalPhases.get(priorRevision);
        if (prior !== undefined && prior !== phase) revisionOutcomeConflict = true;
        terminalPhases.set(priorRevision, phase);
      }
    }
    let reason = !complete ? 'REQUIRED_PREFIX_MISSING'
      : group.some(event => conflicts.has(event.payload.source.eventDigest)) ? 'SOURCE_FACT_CONFLICT'
      : identities.size > 1 ? 'ACTION_LINEAGE_UNMATCHED'
      : revisionRegression ? 'OWNER_REVISION_REGRESSION'
      : revisionOutcomeConflict ? 'OWNER_REVISION_OUTCOME_CONFLICT'
      : !last ? 'RENDER_ONLY'
      : p.action.attempt !== 1 ? 'NOT_ATTEMPTED'
      : p.phase === 'UNKNOWN' ? 'OUTCOME_UNKNOWN'
      : p.phase !== 'RESULT_CONFIRMED' ? 'OUTCOME_NOT_RECORDED'
      : p.readbackRef !== p.action.taskId ? 'READBACK_UNMATCHED' : null;
    const sources = group.map(event => event.eventId);
    for (const [metric, included, excludedReason] of [
      [confirmedResults, reason === null, reason],
      [unknownOutcomes, reason === 'OUTCOME_UNKNOWN', reason ?? 'RESULT_CONFIRMED'],
    ]) {
      if (included) { metric.value++; metric.sources.push(last.eventId); }
      else metric.exclusions.push({ actionKeyDigest, reason: excludedReason, sources });
      const ignored = group.filter(event => event !== last).map(event => event.eventId);
      if (included && ignored.length) metric.exclusions.push({ actionKeyDigest, reason: 'NON_CURRENT_OBSERVATIONS_NOT_ADDITIONAL_OUTCOMES', sources: ignored });
    }
    const span = { actionKeyDigest, taskId, stepId, inputStateDigest, unit: 'MILLISECOND',
      status: 'UNKNOWN', value: null, reason, sources, startEventId: null, endEventId: null,
      sourceStartTimeMs: null, sourceEndTimeMs: null };
    if (reason === null) {
      const starts = usable.filter(event => event.payload.phase === 'PENDING');
      const ends = usable.filter(event => event.payload.phase === 'RESULT_CONFIRMED');
      const startFacts = new Set(starts.map(event => event.payload.source.eventDigest));
      const endFacts = new Set(ends.map(event => event.payload.source.eventDigest));
      const end = ends[0], startObservations = observations.filter(event => event.payload.phase === 'PENDING');
      const start = startObservations.find(event => event.eventId === end.causationId) ?? starts[0];
      const startIds = new Set(startObservations.map(event => event.eventId));
      reason = !starts.length ? 'START_NOT_RECORDED'
        : startFacts.size !== 1 || endFacts.size !== 1 ? 'AMBIGUOUS_OWNER_ENDPOINTS'
        : start.payload.action.attempt !== 1 || start.payload.action.taskRevision === null
          || end.payload.action.taskRevision <= start.payload.action.taskRevision ? 'OWNER_REVISION_UNMATCHED'
        : ends.some(event => !startIds.has(event.causationId)) ? 'UNMATCHED_OWNER_ENDPOINTS'
        : start.payload.source.sourceTimeMs === null || end.payload.source.sourceTimeMs === null ? 'OWNER_TIME_UNAVAILABLE'
        : end.payload.source.sourceTimeMs < start.payload.source.sourceTimeMs ? 'OWNER_TIME_REVERSED' : null;
      span.reason = reason;
      if (reason === null) Object.assign(span, { status: 'OBSERVED_SOURCE_SPAN',
        value: end.payload.source.sourceTimeMs - start.payload.source.sourceTimeMs,
        sources: [start.eventId, end.eventId], startEventId: start.eventId, endEventId: end.eventId,
        sourceStartTimeMs: start.payload.source.sourceTimeMs, sourceEndTimeMs: end.payload.source.sourceTimeMs });
    }
    values.push(span);
  }
  return { schemaVersion: 'kaleidosphere.agent-process/metrics/v1', input, confirmedResults, unknownOutcomes,
    actionDurations: { formula: 'RESULT_CONFIRMED.sourceTimeMs - directly causal PENDING.sourceTimeMs; one unambiguous owner fact per endpoint',
      unit: 'MILLISECOND', inputStateDigest, endpointSemantics: 'REPORTED_PENDING_TO_CONFIRMED_SOURCE_SPAN_NOT_EXECUTION_LATENCY', values,
      exclusions: values.filter(span => span.reason !== null).map(({ actionKeyDigest, reason, sources }) => ({ actionKeyDigest, reason, sources })) },
    nonclaims: ['HOST_BINDING_NOT_REMOTE_PROVENANCE', 'RECORDED_PROOF_AND_READBACK_REFS_NOT_REVERIFIED_PAN',
      'NO_BUSINESS_EFFECT_RENDER_SIMULATION_OR_REPLAY_SUCCESS', 'NO_HUMAN_GRANT_OR_PROCESS_FACTS', 'NO_INDEPENDENT_CLOCK_ATTESTATION'] };
}

// Internal backing factory: validation stays owned by core-contracts.mjs.
export function createAgentProcessEvidenceBackingV1(options, assertEnvelope, eventType) {
  const readOnly = Object.hasOwn(options ?? {}, 'readOnly');
  exact(options, ['stateRoot', 'binding', 'authorizeRead', 'maxEvents', ...(readOnly ? ['readOnly'] : [])]);
  if (readOnly && options.readOnly !== true) fail('PROCESS_CONFIG_DENIED');
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
  if (!readOnly) mkdirSync(root, { recursive: true, mode: 0o700 });
  const directory = lstatSync(root);
  if (!directory.isDirectory() || directory.isSymbolicLink() || directory.uid !== process.getuid?.() || (directory.mode & 0o077) !== 0) fail('PROCESS_OWNED_ROOT_DENIED');
  const file = join(root, 'agent-process-inbox-v1.sqlite');
  let fd;
  try {
    if (readOnly) fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    else {
      try { fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); }
      catch (error) { if (error.code !== 'EEXIST') throw error; fd = openSync(file, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
    }
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0) fail('PROCESS_OWNED_FILE_DENIED');
  } finally { if (fd !== undefined) closeSync(fd); }
  // Node 24's real SQLite readOnly flag prevents creation and database writes.
  // Do not use immutable: an active owner's committed WAL must remain visible.
  const db = new DatabaseSync(file, { readOnly });
  const settingsSchema = 'process_inbox_settings(id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL) STRICT';
  const eventsSchema = 'process_inbox_events(event_id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE CHECK(seq>0), bytes BLOB NOT NULL, raw_sha256 TEXT NOT NULL) STRICT';
  const assertBinding = () => {
    if (db.prepare('SELECT binding FROM process_inbox_settings WHERE id=1').get()?.binding !== bindingBytes) fail('PROCESS_BINDING_DRIFT_DENIED');
  };
  const transaction = body => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = body(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    if (readOnly) {
      authorize();
      assertBinding();
      // Prove this existing owner's complete schema, never repair a partial one.
      for (const [name, schema] of [['process_inbox_settings', settingsSchema], ['process_inbox_events', eventsSchema]]) {
        if (db.prepare('SELECT sql FROM sqlite_schema WHERE type=\'table\' AND name=?').get(name)?.sql !== `CREATE TABLE ${schema}`) fail('PROCESS_EXISTING_SCHEMA_DENIED');
      }
      authorize();
      assertBinding();
    } else {
      db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS ${settingsSchema};
        CREATE TABLE IF NOT EXISTS ${eventsSchema};`);
      transaction(() => {
        db.prepare('INSERT OR IGNORE INTO process_inbox_settings VALUES(1,?)').run(bindingBytes);
        assertBinding();
      });
    }
  } catch (error) { db.close(); throw error; }
  let closed = false;
  const current = () => { if (closed) fail('PROCESS_STORE_CLOSED'); authorize(); if (readOnly) assertBinding(); };
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
    current();
    return result;
  };
  const importBytes = bytes => {
    if (readOnly) fail('PROCESS_READ_ONLY_DENIED');
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
    processMetrics(requiredThroughSequence) {
      const result = processMetrics(binding, events(), requiredThroughSequence);
      current(); // Recheck current permission before returning; never a metrics cache.
      return result;
    },
    close() { if (!closed) { db.close(); closed = true; } } });
}
