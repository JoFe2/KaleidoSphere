// PostgreSQL C2 safe-aggregate typed-plan execution (KaleidoSphere issue #150 / PG-KS-03).
//
// This module layers exactly one net-revenue safe-aggregate operation
// (bi-ks-01-net-revenue/v1) on the certified C1 PostgreSQL profile and runs it
// through the REGULAR product path — the same product-descriptor route
// (postgresql.run-queries / postgresql.read-only-session / preflight.coverage-ledger),
// the same product-secret route (CM_POSTGRESQL_PASSWORD / POSTGRESQL_PASSWORD_FILE),
// the same read-only least-privilege principal, and the same budget/timeout/cancel/
// evidence controls as C1 — with the net-revenue typed plan's digest binding as the
// closed read surface. It never re-enters the C1 structural query pack, never takes a
// free-SQL input, and never widens the C1 scope: the certified C1 profile digest and
// frozen C1 certificate are re-asserted on every run, and C1's own nonCapabilities
// include c2 (so C2 is a separately-versioned capability layered on the C1 substrate,
// not a C1 scope widening or a C1-implies-C2 inference).
//
// The closed read surface is the net-revenue typed plan itself: the holdout bytes the
// source read returns must digest-match the admitted holdout (ADMITTED_HOLDOUT_SHA256),
// the input must stay within the frozen row/byte budget, and the computed result must
// equal the independent oracle byte-for-byte. A data SELECT on synthetic_bi.orders is
// NOT a C1 catalog query (auditCatalogQuery only allows information_schema/pg_catalog
// sources); C2 enforces its own closed, digest-bound query instead. Any substitution,
// mutation, or UNKNOWN-to-zero collapses into a fail-closed reason code.

import { createHash } from 'node:crypto';

import { identitySha256 } from './core.mjs';
import {
  buildPostgresqlConnectionOptions,
  assertPostgresqlReadOnlySession,
} from './postgresql-adapter.mjs';
import { canonicalJson } from '../canonical-json.js';
import {
  ADMITTED_HOLDOUT_SHA256,
  ADMITTED_METRIC_CONTRACT_SHA256,
  ADMITTED_ORACLE_SHA256,
  NET_REVENUE_NONCLAIMS,
  NET_REVENUE_OPERATION_ID,
  NET_REVENUE_OPERATION_REQUEST,
  NET_REVENUE_OUTPUT_COLUMNS,
  compileNetRevenuePlan,
  createNetRevenueOperationRequest,
  executeNetRevenuePlan,
  verifyNetRevenueExecutionReceipt,
} from '../business-bi/net-revenue-plan.mjs';
import {
  assertProductSecretBinding,
  selectProductDescriptor,
} from '../runtime-config.mjs';

// ---- Fail-closed reason codes (C2). The real read path maps to the net-revenue
// typed-plan codes (BUSINESS_BI_*); the descriptor/secret/principal gates map to the
// db-analyzer codes (DB_ANALYZE_*) shared with C1, so the same least-privilege and
// secret-binding controls are proven, not bypassed.
export const C2_FAIL_CLOSED = Object.freeze({
  badSecret: 'DB_ANALYZE_CREDENTIAL_MISSING',
  scopeSubstitution: 'BUSINESS_BI_OPERATION_DENIED',
  crossEngineSecretSubstitution: 'DB_ANALYZE_SECRET_BINDING_MISMATCH',
  staleDescriptor: 'DB_ANALYZE_DESCRIPTOR_STALE',
  rawRowSource: 'BUSINESS_BI_SOURCE_SCOPE_DENIED',
  mutationStatement: 'BUSINESS_BI_READ_ONLY_EVIDENCE_DENIED',
  readOnlySessionViolation: 'DB_ANALYZE_PRINCIPAL_NOT_READ_ONLY',
});

// ---- Paths (source-local).
export const C2_CONTRACT_SCHEMA = 'kaleidosphere.db/postgresql-c2-safe-aggregate/v1';
export const C2_EVIDENCE_SCHEMA = 'kaleidosphere.db/postgresql-c2-evidence/v1';
export const C2_CONTRACT_PATH = 'contracts/connectors/postgresql/c2-safe-aggregate-v1.json';
export const C2_CERTIFICATE_PATH = 'verification/postgresql-c2-safe-aggregate-v1.json';
export const C1_PROFILE_PATH = 'contracts/connectors/postgresql/c1-profile-v1.json';
export const C1_CERTIFICATE_PATH = 'verification/postgresql/postgresql-c1-evidence-v1.json';
export const C1_LIVE_MATRIX_PATH = 'verification/postgresql/postgresql-c1-live-matrix-v1.json';
export const C1_LIVE_MATRIX_PROVENANCE_PATH =
  'verification/postgresql/postgresql-c1-live-matrix-provenance-v1.json';
export const C1_LIVE_MATRIX_READBACK_PATH = 'docs/evidence/postgresql-c1-live-matrix/README.md';
export const METRIC_CONTRACT_PATH = 'contracts/business-bi/v1/net-revenue.metric.json';
export const HOLDOUT_FIXTURE_PATH = 'tests/fixtures/business-bi/net-revenue-holdout-v1.json';
export const ORACLE_FIXTURE_PATH = 'tests/fixtures/business-bi/net-revenue-oracle-v1.json';

// ---- Frozen C1 baseline digests. The AC04 certificate-lifecycle regression re-asserts
// that C2 issuance/revocation never modifies or rewrites these bytes (the profile, the
// frozen source-local certificate, the retained live matrix, its provenance record, and
// its human readback all stay byte-identical).
export const C1_PROFILE_SHA256 =
  '3faea403a4e81732719ef141c9dd4027bb257654126ea65dd57576e558a0c6e1';
export const C1_CERTIFICATE_SHA256 =
  '859970ca6e4ac23b0c2e11da5289b6b2865d4b8643e8c0492998fb608f543bc6';
export const C1_CERTIFICATE_IDENTITY_SHA256 =
  '31e72dbff59103ed5814ea268f909a9bf06b0295f1fdd3078b7f714cfe710868';
export const C1_LIVE_MATRIX_SHA256 =
  '90866c86b344c2043fdd32b3b3728da5c1d5b957dd01119c03c9398a347f3eab';
export const C1_LIVE_MATRIX_PROVENANCE_RAW_SHA256 =
  '40b6d1ae6a249b51d0deb964c37ecbf0fb1e8b16a1703a03ab416b699060c529';
export const C1_LIVE_MATRIX_PROVENANCE_IDENTITY_SHA256 =
  '05014aaf1ec4100aa9b770fc55ab1ca1ed80ce5ca4d1d4ba5f3b9bc5f18da406';
export const C1_LIVE_MATRIX_READBACK_SHA256 =
  '9b524b4d3ed6a1ee771c10b514c23f16db159e986b99b6b035f95c944d10b92f';

// ---- The closed typed-plan read surface (no free SQL). The relation and fields are
// frozen by the net-revenue operation; the SELECT is derived from them, not from input.
const CLOSED_RELATION = 'synthetic_bi.orders';
const CLOSED_FIELD_ORDER = Object.freeze([
  'order_id',
  'order_date',
  'record_kind',
  'amount_minor_units',
]);
const SESSION_PROOF_SQL = [
  "SELECT",
  "  current_setting('transaction_read_only') AS transaction_read_only,",
  "  current_setting('default_transaction_read_only') AS default_transaction_read_only;",
].join('\n');

// ---- Small local helpers (mirror the net-revenue-plan / core conventions).
const rawSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// ---- Byte-exact holdout serialization. Reproducing the committed holdout bytes is the
// source-local RED→GREEN de-risk before any real read: the real clean-room SELECT must
// come back and re-serialize to EXACTLY these bytes (sha256 = ADMITTED_HOLDOUT_SHA256),
// or the holdout digest gate rejects it.
function holdoutField(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  fail('DB_ANALYZE_C2_HOLDOUT_FIELD_DENIED');
}

export function serializeHoldout(rows) {
  if (!Array.isArray(rows) || rows.length === 0) fail('DB_ANALYZE_C2_HOLDOUT_ROWS_DENIED');
  const lines = [
    '{',
    '  "schemaVersion": "kaleidosphere.business-bi/net-revenue-holdout/v1",',
    '  "classification": "SYNTHETIC_NON_CUSTOMER_BYTES",',
    '  "issue": "BI-KS-01",',
    '  "contractPath": "contracts/business-bi/v1/net-revenue.metric.json",',
    '  "relation": "synthetic_bi.orders",',
    '  "currencyCode": "EUR",',
    '  "rowOrder": "frozen; the independent calculator must produce identical results under any row ordering",',
    '  "rows": [',
  ];
  rows.forEach((row, index) => {
    if (!isPlainObject(row)) fail('DB_ANALYZE_C2_HOLDOUT_ROW_DENIED');
    const line = `    { "order_id": ${holdoutField(row.order_id)}, "order_date": ${holdoutField(row.order_date)}, "record_kind": ${holdoutField(row.record_kind)}, "amount_minor_units": ${holdoutField(row.amount_minor_units)} }`;
    lines.push(index < rows.length - 1 ? `${line},` : line);
  });
  lines.push('  ]', '}');
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

// Source-local proof that the serializer reproduces the committed holdout bytes exactly
// and that they match the admitted digest. Fails closed on any divergence.
export function verifyHoldoutSerializerBinding(holdoutBytes) {
  const fixture = JSON.parse(holdoutBytes.toString('utf8'));
  if (!Array.isArray(fixture.rows)) fail('DB_ANALYZE_C2_HOLDOUT_FIXTURE_DENIED');
  const reproduced = serializeHoldout(fixture.rows);
  if (rawSha256(reproduced) !== rawSha256(holdoutBytes)) {
    fail('DB_ANALYZE_C2_HOLDOUT_SERIALIZER_MISMATCH');
  }
  if (rawSha256(reproduced) !== ADMITTED_HOLDOUT_SHA256) {
    fail('DB_ANALYZE_C2_HOLDOUT_DIGEST_MISMATCH');
  }
  return true;
}

// ---- AC01: capability-manifest / runtime parity. Exactly one SUPPORTED operation, and
// its declared operation is canonical-equal to the runtime's frozen operation request;
// every other method is UNSUPPORTED; the closed set and bindings match the admitted
// fixtures and the frozen C1 substrate.
export function validatePostgresqlC2Contract(contract) {
  if (!isPlainObject(contract)) fail('DB_ANALYZE_C2_CONTRACT_DENIED');
  if (contract.schemaVersion !== C2_CONTRACT_SCHEMA) fail('DB_ANALYZE_C2_CONTRACT_SCHEMA_DENIED');
  if (contract.closedSet !== true) fail('DB_ANALYZE_C2_CONTRACT_CLOSED_SET_DENIED');
  if (contract.engine !== 'postgresql') fail('DB_ANALYZE_C2_CONTRACT_ENGINE_DENIED');
  if (!isPlainObject(contract.operations)) fail('DB_ANALYZE_C2_CONTRACT_OPERATIONS_DENIED');

  const supported = Object.entries(contract.operations)
    .filter(([, entry]) => isPlainObject(entry) && entry.status === 'SUPPORTED');
  if (supported.length !== 1 || supported[0][0] !== NET_REVENUE_OPERATION_ID) {
    fail('DB_ANALYZE_C2_SINGLE_OPERATION_DENIED');
  }
  const operation = supported[0][1];
  if (!isPlainObject(operation.operation)) fail('DB_ANALYZE_C2_CONTRACT_OPERATION_DENIED');
  // Manifest <-> runtime parity: the declared operation IS the runtime's frozen op.
  if (canonicalJson(operation.operation) !== canonicalJson(NET_REVENUE_OPERATION_REQUEST)) {
    fail('DB_ANALYZE_C2_CONTRACT_RUNTIME_PARITY_MISMATCH');
  }
  if (canonicalJson(operation.operation.aggregate.outputColumns)
      !== canonicalJson(NET_REVENUE_OUTPUT_COLUMNS)) {
    fail('DB_ANALYZE_C2_CONTRACT_OUTPUT_COLUMNS_MISMATCH');
  }

  if (contract.bindings?.metricContract?.sha256 !== ADMITTED_METRIC_CONTRACT_SHA256
      || contract.bindings?.holdout?.sha256 !== ADMITTED_HOLDOUT_SHA256
      || contract.bindings?.oracle?.sha256 !== ADMITTED_ORACLE_SHA256) {
    fail('DB_ANALYZE_C2_BINDING_MISMATCH');
  }
  if (contract.boundTo?.c1Profile?.sha256 !== C1_PROFILE_SHA256
      || contract.boundTo?.frozenC1Certificate?.sha256 !== C1_CERTIFICATE_SHA256) {
    fail('DB_ANALYZE_C2_C1_BINDING_MISMATCH');
  }

  const unsupported = contract.unsupportedOperations;
  if (!Array.isArray(unsupported) || unsupported.length === 0) {
    fail('DB_ANALYZE_C2_UNSUPPORTED_REQUIRED');
  }
  for (const entry of unsupported) {
    if (!isPlainObject(entry) || entry.status !== 'UNSUPPORTED' || entry.id === NET_REVENUE_OPERATION_ID) {
      fail('DB_ANALYZE_C2_UNSUPPORTED_MALFORMED');
    }
  }
  return contract;
}

// ---- No bypass of the C1 identity/scope. C2 runs against the EXACT frozen C1 profile
// (raw-digest bound) and the EXACT frozen C1 certificate (raw-digest bound, still
// BLOCKED_EXTERNAL in its own bytes, self-digest intact, and declaring c2 a
// non-capability). Any substitution of the substrate bytes fails closed.
export function bindToC1Profile({ profileBytes, certBytes }) {
  if (rawSha256(profileBytes) !== C1_PROFILE_SHA256) {
    fail('DB_ANALYZE_C2_PROFILE_BINDING_MISMATCH');
  }
  if (rawSha256(certBytes) !== C1_CERTIFICATE_SHA256) {
    fail('DB_ANALYZE_C2_CERTIFICATE_BINDING_MISMATCH');
  }
  const cert = JSON.parse(certBytes.toString('utf8'));
  if (cert.realDisprovablePostgresql?.state !== 'BLOCKED_EXTERNAL') {
    fail('DB_ANALYZE_C2_CERTIFICATE_STATE_MISMATCH');
  }
  if (cert.certificateSha256 !== C1_CERTIFICATE_IDENTITY_SHA256) {
    fail('DB_ANALYZE_C2_CERTIFICATE_DIGEST_MISMATCH');
  }
  if (!Array.isArray(cert.binding?.nonCapabilities)
      || !cert.binding.nonCapabilities.includes('c2')) {
    fail('DB_ANALYZE_C2_SCOPE_WIDENING_DENIED');
  }
  return deepFreeze({
    c1ProfileSha256: C1_PROFILE_SHA256,
    c1CertificateSha256: C1_CERTIFICATE_SHA256,
    c1CertificateIdentitySha256: C1_CERTIFICATE_IDENTITY_SHA256,
    c1FrozenState: 'BLOCKED_EXTERNAL',
    c1DeclaresC2NonCapability: true,
  });
}

// ---- Fail-closed gates.

// The real clean-room must find the credential via the postgresql product-secret route.
// A synthetic source-local run has nothing to bind (it uses a synthetic read), so the
// positive path never calls this gate; the fail-closed probe does, with an empty env.
export function assertPostgresqlC2CredentialRoute(descriptor, env = process.env) {
  if (!isPlainObject(descriptor) || !isPlainObject(descriptor.secret)) {
    fail('DB_ANALYZE_C2_DESCRIPTOR_DENIED');
  }
  const value = env[descriptor.secret.env];
  if (typeof value === 'string' && value.length > 0) return;
  fail('DB_ANALYZE_CREDENTIAL_MISSING');
}

// The same read-only least-privilege principal as C1: the session proof must show a
// read-only transaction with no admin capabilities. A non-read-only principal fails
// closed with the same code C1 uses.
export function assertPostgresqlC2ReadOnlyPrincipal(proof) {
  if (!isPlainObject(proof)
      || proof.transactionReadOnly !== 'on'
      || proof.adminCapabilities !== false) {
    fail('DB_ANALYZE_PRINCIPAL_NOT_READ_ONLY');
  }
}

// ---- The regular product path.

// Runs exactly one net-revenue safe-aggregate operation through the regular PostgreSQL
// product descriptor route with the net-revenue typed plan as the closed, digest-bound
// read surface. `read` is the source read closure: the synthetic source-local read in
// CI, or buildPostgresqlC2RealRead(...) in the clean-room. The C1 substrate is
// re-asserted (bindToC1Profile) so the run is bound to the certified profile, not a
// substitution.
export async function runPostgresqlC2SafeAggregate(input) {
  if (!isPlainObject(input)) fail('DB_ANALYZE_C2_RUN_INPUT_DENIED');
  const {
    contract,
    profileBytes,
    certBytes,
    metricContractBytes,
    oracleBytes,
    read,
    signal,
  } = input;
  if (typeof read !== 'function') fail('DB_ANALYZE_C2_READ_REQUIRED');

  // 1. Regular product path: the same descriptor route and secret binding as C1.
  const descriptor = selectProductDescriptor('postgresql');
  assertProductSecretBinding(descriptor, descriptor.secret.env);

  // 2. AC01 capability-manifest / runtime parity (closed set, one op, exact operation).
  validatePostgresqlC2Contract(contract);

  // 3. No bypass of the C1 identity/scope: re-assert the frozen C1 substrate.
  const profileBinding = bindToC1Profile({ profileBytes, certBytes });

  // 4. Compile the net-revenue typed plan (digest-bound to the admitted fixtures).
  const plan = compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes,
    oracleBytes,
  });

  // 5. Execute through the typed plan with the provided read closure.
  const receipt = await executeNetRevenuePlan({
    plan,
    metricContractBytes,
    oracleBytes,
    read,
    signal,
  });

  // 6. Verify the receipt is self-consistent and oracle-bound.
  verifyNetRevenueExecutionReceipt({
    plan,
    receipt,
    metricContractBytes,
    oracleBytes,
  });

  return deepFreeze({
    descriptor,
    profileBinding,
    plan,
    receipt,
    productPath: {
      mode: read.__ksC2RealRead ? 'LIVE' : 'SYNTHETIC',
      dispatch: 'REGULAR',
      engine: 'postgresql',
      regularPath: {
        dispatch: 'REGULAR',
        executorBinding: descriptor.components.executor,
        capability: descriptor.components.capability,
        evidence: descriptor.components.evidence,
        productSecretBindingEnforced: true,
      },
      runtimeValidation: read.__ksC2RealRead ? 'RUNTIME_VALIDATED' : 'SYNTHETIC_UNVALIDATED',
    },
  });
}

// ---- Fail-closed matrix. Each probe drives a REAL gate and returns the observed
// fail-closed reason code (the code a tampering attempt would be stopped with).
export async function runPostgresqlC2FailClosedProbes({
  contract,
  profileBytes,
  certBytes,
  metricContractBytes,
  oracleBytes,
  holdoutBytes,
}) {
  const codeOf = (fn) => {
    try {
      fn();
    } catch (error) {
      return error.code ?? error.message;
    }
    return 'NO_FAILURE';
  };

  // A sabotaged operation request (a different net-revenue operation id / scope) is
  // rejected by the typed plan's closed-operation gate.
  const scopeSubstitutionRequest = JSON.parse(canonicalJson(NET_REVENUE_OPERATION_REQUEST));
  scopeSubstitutionRequest.operationId = 'bi-ks-01-gross-revenue/v1';

  const rawRowSourceRead = async () => ({
    state: 'COMPLETE',
    reasonCode: null,
    bytes: holdoutBytes,
    evidence: {
      accessMode: 'READ_ONLY',
      mutationCount: 0,
      bounded: true,
      relation: 'public.orders',
      rowsRead: 17,
    },
  });
  const mutationStatementRead = async () => ({
    state: 'COMPLETE',
    reasonCode: null,
    bytes: holdoutBytes,
    evidence: {
      accessMode: 'READ_ONLY',
      mutationCount: 1,
      bounded: true,
      relation: CLOSED_RELATION,
      rowsRead: 17,
    },
  });

  // The rawRowSource / mutationStatement probes drive the real typed-plan gate through
  // executeNetRevenuePlan with a compilable plan.
  const probePlan = compileNetRevenuePlan({
    request: createNetRevenueOperationRequest(),
    metricContractBytes,
    oracleBytes,
  });
  // executeNetRevenuePlan does not throw for envelope/digest/oracle denials: it returns
  // a DENIED receipt carrying the reasonCode. (Only the input-validation gate and the
  // oracle-mismatch gate throw.) The probes therefore read the receipt's reasonCode.
  const receiptCodeOfAsync = async (fn) => {
    const receipt = await fn();
    const state = receipt?.execution?.state;
    if (state === 'DENIED' || state === 'UNKNOWN'
        || state === 'TIMEOUT' || state === 'CANCELLED') {
      return receipt.execution.reasonCode;
    }
    return `NO_DENIAL:${state}`;
  };

  return deepFreeze({
    badSecret: codeOf(() => assertPostgresqlC2CredentialRoute(
      selectProductDescriptor('postgresql'),
      {},
    )),
    scopeSubstitution: codeOf(() => compileNetRevenuePlan({
      request: scopeSubstitutionRequest,
      metricContractBytes,
      oracleBytes,
    })),
    crossEngineSecretSubstitution: codeOf(() => assertProductSecretBinding(
      selectProductDescriptor('postgresql'),
      'CM_MSSQL_PASSWORD',
    )),
    staleDescriptor: codeOf(() => selectProductDescriptor('postgresql', { version: 'v0' })),
    rawRowSource: await receiptCodeOfAsync(() => executeNetRevenuePlan({
      plan: probePlan,
      metricContractBytes,
      oracleBytes,
      read: rawRowSourceRead,
    })),
    mutationStatement: await receiptCodeOfAsync(() => executeNetRevenuePlan({
      plan: probePlan,
      metricContractBytes,
      oracleBytes,
      read: mutationStatementRead,
    })),
    readOnlySessionViolation: codeOf(() => assertPostgresqlC2ReadOnlyPrincipal({
      transactionReadOnly: 'off',
      adminCapabilities: true,
    })),
  });
}

// ---- Real read closure (clean-room). The closed, digest-bound SELECT is derived from
// the frozen plan's source request (relation + fields + row budget), never from input.
// ORDER BY order_id reproduces the frozen row order (s-001..s-017). The session is
// verified read-only under the same least-privilege principal as C1.
export function buildPostgresqlC2RealRead({ profile, password, driver }) {
  const realRead = async ({ request, signal }) => {
    if (request.source?.relation !== CLOSED_RELATION
        || !Array.isArray(request.source?.fields)
        || request.source.fields.join('|') !== CLOSED_FIELD_ORDER.slice().sort().join('|')) {
      fail('BUSINESS_BI_SOURCE_SCOPE_DENIED');
    }
    let pg;
    try {
      pg = driver ?? await import('pg');
    } catch {
      fail('DB_ANALYZE_POSTGRESQL_DRIVER_INVALID');
    }
    if (!isPlainObject(pg) || typeof pg.Client !== 'function') {
      fail('DB_ANALYZE_POSTGRESQL_DRIVER_INVALID');
    }
    const { Client } = pg;
    const client = new Client(buildPostgresqlConnectionOptions(profile, password));
    try {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      // The closed digest-bound read: relation/fields/limit come from the frozen plan.
      const statement = [
        'SELECT',
        '  order_id,',
        "  order_date::text AS order_date,",
        '  record_kind,',
        '  amount_minor_units',
        `FROM ${CLOSED_RELATION}`,
        'ORDER BY order_id',
        'LIMIT $1',
      ].join('\n');
      const response = await client.query({
        text: statement,
        values: [request.bounds.rowBudget],
        signal,
      });
      const rows = Array.isArray(response.rows) ? response.rows : [];
      if (rows.length === 0 || rows.length > request.bounds.rowBudget) {
        fail('BUSINESS_BI_ROW_COUNT_EVIDENCE_DENIED');
      }
      for (const row of rows) {
        for (const field of CLOSED_FIELD_ORDER) {
          const value = row[field];
          if (value !== null && typeof value !== 'string' && typeof value !== 'number') {
            fail('BUSINESS_BI_ROW_FIELD_DENIED');
          }
        }
      }
      const bytes = serializeHoldout(rows);
      return {
        state: 'COMPLETE',
        reasonCode: null,
        bytes,
        evidence: {
          accessMode: 'READ_ONLY',
          mutationCount: 0,
          bounded: true,
          relation: CLOSED_RELATION,
          rowsRead: rows.length,
        },
      };
    } finally {
      await client.end().catch(() => {});
    }
  };
  realRead.__ksC2RealRead = true;
  return realRead;
}

// A read-only least-privilege session proof, verified against the same gate C1 uses.
// Returns the proof object (recorded in the clean-room evidence). Fails closed on a
// non-read-only or over-privileged principal.
export async function readPostgresqlC2SessionProof({ profile, password, driver }) {
  let pg;
  try {
    pg = driver ?? await import('pg');
  } catch {
    fail('DB_ANALYZE_POSTGRESQL_DRIVER_INVALID');
  }
  if (!isPlainObject(pg) || typeof pg.Client !== 'function') {
    fail('DB_ANALYZE_POSTGRESQL_DRIVER_INVALID');
  }
  const { Client } = pg;
  const client = new Client(buildPostgresqlConnectionOptions(profile, password));
  try {
    await client.connect();
    const rows = (await client.query(SESSION_PROOF_SQL)).rows;
    assertPostgresqlReadOnlySession(rows);
    const setting = rows[0] ?? {};
    const proof = {
      transactionReadOnly: setting.transaction_read_only ?? setting.transactionReadOnly ?? 'off',
      defaultTransactionReadOnly: setting.default_transaction_read_only ?? 'off',
      adminCapabilities: false,
    };
    assertPostgresqlC2ReadOnlyPrincipal(proof);
    return proof;
  } finally {
    await client.end().catch(() => {});
  }
}

// ---- AC04: the separately-versioned C2 certificate (self-digesting, byte-stable).
export function buildPostgresqlC2Evidence({
  descriptor,
  profileBinding,
  contract,
  plan,
  receipt,
  failClosed,
  release,
}) {
  const body = {
    schemaVersion: C2_EVIDENCE_SCHEMA,
    issue: 'PG-KS-03',
    publicIssue: 'JoFe2/KaleidoSphere#150',
    profileId: 'kaleidosphere-postgresql-c2-v1',
    boundTo: profileBinding,
    productDescriptor: {
      engine: descriptor.engine,
      version: 'v1',
      executor: descriptor.components.executor,
      capability: descriptor.components.capability,
      evidence: descriptor.components.evidence,
      secretEnv: descriptor.secret.env,
      secretFileVariable: descriptor.secret.fileVariable,
    },
    contract: {
      path: C2_CONTRACT_PATH,
      schemaVersion: contract.schemaVersion,
      closedSet: contract.closedSet,
      supportedOperation: NET_REVENUE_OPERATION_ID,
      operationSha256: plan.bindings.operationSha256,
      manifestRuntimeParity: true,
    },
    bindings: {
      metricContractSha256: ADMITTED_METRIC_CONTRACT_SHA256,
      holdoutSha256: ADMITTED_HOLDOUT_SHA256,
      oracleSha256: ADMITTED_ORACLE_SHA256,
      holdoutSerializerReproducesAdmittedHoldout: true,
    },
    productPath: {
      mode: 'SYNTHETIC',
      dispatch: 'REGULAR',
      engine: 'postgresql',
      runtimeValidation: 'SYNTHETIC_UNVALIDATED',
      executorBinding: descriptor.components.executor,
      capability: descriptor.components.capability,
      productSecretBindingEnforced: true,
    },
    typedPlan: {
      planSha256: plan.planSha256,
      operationSha256: plan.bindings.operationSha256,
      bounds: {
        inputRowBudget: plan.bounds.inputRowBudget,
        inputByteBudget: plan.bounds.inputByteBudget,
        outputRowBudget: plan.bounds.outputRowBudget,
        timeoutMs: plan.bounds.timeoutMs,
      },
      authority: plan.authority,
    },
    execution: {
      state: receipt.execution.state,
      reasonCode: receipt.execution.reasonCode,
      readOnlyEvidence: receipt.execution.readOnlyEvidence,
      bounded: receipt.execution.bounded,
      timeoutAware: receipt.execution.timeoutAware,
      cancelAware: receipt.execution.cancelAware,
      rowsRead: receipt.execution.rowsRead,
      oracleEquality: receipt.oracleEquality,
      resultSha256: receipt.resultSha256,
      outputSha256: receipt.outputSha256,
      receiptSha256: receipt.receiptSha256,
    },
    failClosed,
    c1Lifecycle: {
      c1ProfileSha256: C1_PROFILE_SHA256,
      c1CertificateSha256: C1_CERTIFICATE_SHA256,
      c1CertificateIdentitySha256: C1_CERTIFICATE_IDENTITY_SHA256,
      c1LiveMatrixSha256: C1_LIVE_MATRIX_SHA256,
      c1LiveMatrixProvenanceRawSha256: C1_LIVE_MATRIX_PROVENANCE_RAW_SHA256,
      c1LiveMatrixProvenanceIdentitySha256: C1_LIVE_MATRIX_PROVENANCE_IDENTITY_SHA256,
      c1LiveMatrixReadbackSha256: C1_LIVE_MATRIX_READBACK_SHA256,
      c1FrozenBytesUnchanged: true,
    },
    realDisprovablePostgresql: {
      state: 'BLOCKED_EXTERNAL',
      reason: 'NO_REAL_DISPOSABLE_POSTGRESQL',
      ac01VerifiedLeastPrivilegePrincipal: 'BLOCKED_EXTERNAL',
      ac02RealSourcePositiveRun: 'BLOCKED_EXTERNAL',
      ac03RealNegativeMatrix: 'BLOCKED_EXTERNAL',
    },
    release: {
      version: release.version,
    },
    nonClaims: [
      ...NET_REVENUE_NONCLAIMS,
      'C2 is a separately-versioned capability layered on the certified C1 profile; it is not a C1 scope widening and C1 structural certification does not imply C2 safe-aggregate capability.',
      'The source-local C2 certificate records the real-disposable-PostgreSQL clean-room as BLOCKED_EXTERNAL; the real positive/negative clean-room (loopback-only, SCRAM, least-privilege, zero-residue) is separate parent-executed evidence.',
      'No arbitrary SQL, no second metric, no grouping widening, and no production/customer/HA/scale/all-versions claim; synthetic_bi.orders is synthetic non-customer data only.',
      'C2 issuance/revocation never modifies or rewrites the frozen C1 bytes (profile 3faea403..., certificate 859970ca..., live matrix 90866c86..., provenance 05014aaf...): the C1 lifecycle regression pins all of them byte-identical.',
    ],
  };
  return deepFreeze({ ...body, certificateSha256: identitySha256(body) });
}