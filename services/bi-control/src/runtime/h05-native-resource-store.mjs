import { lstatSync, mkdirSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { getH05SharedRuntimeApisV1 } from './h05-shared-runtime-source.mjs';

// KS-owned native SQLite persistence, not the PAN-owner store and not a
// second budget policy. CCP input/integer/receipt semantics are the unchanged
// qualified shared implementation. Never expose options or capabilities to agents.
export function createH05NativeResourceStoreV1(source, candidate) {
  const shared = getH05SharedRuntimeApisV1(source);
  const { canonicalJson } = shared.canonical;
  const { assertCcpDigestV1, assertCcpSafePositiveIntegerV1, assertCcpSafeUnsignedIntegerV1,
    assertCcpStringV1, ccpStrictDenyV1, readCcpClosedObjectV1, TENANT_ID_PATTERN } = shared.envelope;
  const denied = 'H05_RESOURCE_INPUT_DENIED';
  const closed = (value, keys) => readCcpClosedObjectV1(value, keys, new WeakSet(), denied);
  const unsigned = value => assertCcpSafeUnsignedIntegerV1(value, denied);
  const operationPattern = /^operation:[a-z0-9][a-z0-9._-]{2,63}$/;
  const options = closed(candidate, ['optIn', 'stateRoot', 'tenantId', 'bindingDigest', 'limits']);
  if (options.optIn !== true) ccpStrictDenyV1('H05_RESOURCE_OPT_IN_REQUIRED');
  const limits = closed(options.limits, ['modelUnits', 'runtimeUnits']);
  for (const units of Object.values(limits)) {
    assertCcpSafePositiveIntegerV1(units, denied); if (units > 1_000_000) ccpStrictDenyV1(denied);
  }
  assertCcpStringV1(options.tenantId, TENANT_ID_PATTERN, denied);
  assertCcpDigestV1(options.bindingDigest, denied);
  if (typeof options.stateRoot !== 'string' || !isAbsolute(options.stateRoot)) ccpStrictDenyV1(denied);
  const binding = canonicalJson({ repositoryId: 'repository:kaleidosphere', ledgerId: 'ledger:ks295-native',
    sharedDescriptorSha256: source.descriptorSha256, tenantId: options.tenantId,
    bindingDigest: options.bindingDigest, limits: { ...limits } });
  mkdirSync(options.stateRoot, { recursive: true, mode: 0o700 });
  const root = lstatSync(options.stateRoot);
  if (!root.isDirectory() || root.isSymbolicLink() || (root.mode & 0o077) !== 0 || root.uid !== process.getuid?.())
    ccpStrictDenyV1('H05_RESOURCE_OWNED_ROOT_REQUIRED');
  const file = join(options.stateRoot, 'ks295-resource-budget.sqlite');
  // Create a private regular file before SQLite opens it. O_NONBLOCK keeps
  // adversarial FIFOs from hanging this owner-only constructor.
  let fd;
  try {
    try { fd = openSync(file, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      fd = openSync(file, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    }
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.())
      ccpStrictDenyV1('H05_RESOURCE_OWNED_FILE_REQUIRED');
  } finally { if (fd !== undefined) closeSync(fd); }
  const db = new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=15000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), binding TEXT NOT NULL, completion_key TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reservations (
      operation_id TEXT PRIMARY KEY, request_digest TEXT NOT NULL,
      model_units INTEGER NOT NULL CHECK(typeof(model_units)='integer' AND model_units>=0),
      runtime_units INTEGER NOT NULL CHECK(typeof(runtime_units)='integer' AND runtime_units>=0),
      state TEXT NOT NULL DEFAULT 'RESERVED' CHECK(state IN ('RESERVED','UNKNOWN_USAGE','SETTLED')),
      model_consumed INTEGER NOT NULL DEFAULT 0 CHECK(typeof(model_consumed)='integer' AND model_consumed BETWEEN 0 AND model_units),
      runtime_consumed INTEGER NOT NULL DEFAULT 0 CHECK(typeof(runtime_consumed)='integer' AND runtime_consumed BETWEEN 0 AND runtime_units),
      completion TEXT
    ) STRICT;`);
  const transaction = body => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = body(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  try {
    transaction(() => {
      db.prepare('INSERT OR IGNORE INTO settings(id,binding,completion_key) VALUES(1,?,?)').run(binding, randomBytes(32).toString('hex'));
      if (db.prepare('SELECT binding FROM settings WHERE id=1').get().binding !== binding)
        ccpStrictDenyV1('H05_RESOURCE_BINDING_DRIFT_DENIED');
    });
  } catch (error) { db.close(); throw error; }
  const completionKey = db.prepare('SELECT completion_key FROM settings WHERE id=1').get().completion_key;
  const read = operationId => {
    assertCcpStringV1(operationId, operationPattern, denied);
    const row = db.prepare('SELECT * FROM reservations WHERE operation_id=?').get(operationId);
    return row === undefined ? null : Object.freeze({ ...row });
  };
  const snapshot = () => {
    const totals = db.prepare("SELECT count(*) AS reservations, coalesce(sum(CASE WHEN state='SETTLED' THEN model_consumed ELSE model_units END),0) AS model, coalesce(sum(CASE WHEN state='SETTLED' THEN runtime_consumed ELSE runtime_units END),0) AS runtime, coalesce(sum(model_consumed),0) AS modelConsumed, coalesce(sum(runtime_consumed),0) AS runtimeConsumed FROM reservations").get();
    const receipt = kind => shared.budget.makeCcpCostBudgetV1({
      budgetId: `budget:ks295-${kind}`, ledgerId: 'ledger:ks295-native', repositoryId: 'repository:kaleidosphere',
      contributionId: 'contribution:ks295-runtime', tenantId: options.tenantId,
      logicalAtMs: 0, budgetUnits: limits[`${kind}Units`], committedUnits: totals[kind], consumedUnits: totals[`${kind}Consumed`],
    });
    return Object.freeze({ model: receipt('model'), runtime: receipt('runtime'), reservations: totals.reservations });
  };
  const reserve = candidate => {
    const command = closed(candidate, ['operationId', 'requestDigest', 'modelUnits', 'runtimeUnits']);
    assertCcpStringV1(command.operationId, operationPattern, denied); assertCcpDigestV1(command.requestDigest, denied);
    unsigned(command.modelUnits); unsigned(command.runtimeUnits);
    if (command.modelUnits + command.runtimeUnits === 0) ccpStrictDenyV1(denied);
    return transaction(() => {
      const prior = read(command.operationId);
      if (prior !== null) {
        if (prior.request_digest !== command.requestDigest || prior.model_units !== command.modelUnits || prior.runtime_units !== command.runtimeUnits)
          ccpStrictDenyV1('H05_RESOURCE_RETRY_CONFLICT_DENIED');
        return Object.freeze({ reservation: prior, replayed: true });
      }
      const available = snapshot();
      if (command.modelUnits > available.model.remainingUnits || command.runtimeUnits > available.runtime.remainingUnits)
        ccpStrictDenyV1('H05_RESOURCE_EXHAUSTED_DENIED');
      db.prepare('INSERT INTO reservations(operation_id,request_digest,model_units,runtime_units) VALUES(?,?,?,?)')
        .run(command.operationId, command.requestDigest, command.modelUnits, command.runtimeUnits);
      return Object.freeze({ reservation: read(command.operationId), replayed: false });
    });
  };
  const markUnknownUsage = operationId => transaction(() => {
    const prior = read(operationId);
    if (prior === null) ccpStrictDenyV1('H05_RESOURCE_RESERVATION_REQUIRED_DENIED');
    if (prior.state !== 'RESERVED') return Object.freeze({ reservation: prior, dispatchGranted: false });
    db.prepare("UPDATE reservations SET state='UNKNOWN_USAGE' WHERE operation_id=? AND state='RESERVED'").run(operationId);
    return Object.freeze({ reservation: read(operationId), dispatchGranted: true });
  });
  const completionPayload = candidate => {
    const receipt = closed(candidate, ['operationId', 'requestDigest', 'modelUnits', 'runtimeUnits', 'evidenceDigest']);
    assertCcpStringV1(receipt.operationId, operationPattern, denied);
    assertCcpDigestV1(receipt.requestDigest, denied); assertCcpDigestV1(receipt.evidenceDigest, denied);
    unsigned(receipt.modelUnits); unsigned(receipt.runtimeUnits); return { ...receipt };
  };
  const authenticate = payload => createHmac('sha256', completionKey)
    .update('kaleidosphere.h05.native-completion/v1\0' + binding + '\0' + canonicalJson(payload)).digest('hex');
  // Local owner capability only, invoked by the native trusted completion
  // caller after its actual shared broker response/usage guard, never model text.
  const ownerCompletionEvidence = candidate => {
    const payload = completionPayload(candidate); return Object.freeze({ ...payload, authenticator: authenticate(payload) });
  };
  const settle = candidate => {
    const receipt = closed(candidate, ['operationId', 'requestDigest', 'modelUnits', 'runtimeUnits', 'evidenceDigest', 'authenticator']);
    const { authenticator, ...payload } = receipt; const validated = completionPayload(payload);
    assertCcpDigestV1(authenticator, denied);
    if (!timingSafeEqual(Buffer.from(authenticator, 'hex'), Buffer.from(authenticate(validated), 'hex')))
      ccpStrictDenyV1('H05_RESOURCE_UNTRUSTED_COMPLETION_DENIED');
    const completion = canonicalJson({ ...validated, authenticator });
    return transaction(() => {
      const prior = read(validated.operationId);
      if (prior === null || prior.request_digest !== validated.requestDigest || validated.modelUnits > prior.model_units || validated.runtimeUnits > prior.runtime_units)
        ccpStrictDenyV1('H05_RESOURCE_COMPLETION_BINDING_DENIED');
      if (prior.state === 'SETTLED') {
        if (prior.completion !== completion) ccpStrictDenyV1('H05_RESOURCE_COMPLETION_RETRY_CONFLICT_DENIED'); return prior;
      }
      if (prior.state !== 'UNKNOWN_USAGE') ccpStrictDenyV1('H05_RESOURCE_DISPATCH_REQUIRED_DENIED');
      db.prepare("UPDATE reservations SET state='SETTLED',model_consumed=?,runtime_consumed=?,completion=? WHERE operation_id=? AND state='UNKNOWN_USAGE'")
        .run(validated.modelUnits, validated.runtimeUnits, completion, validated.operationId);
      return read(validated.operationId);
    });
  };
  let isClosed = false;
  return Object.freeze({ reserve, read, snapshot, markUnknownUsage, ownerCompletionEvidence, settle,
    close: () => { if (!isClosed) { db.close(); isClosed = true; } } });
}
