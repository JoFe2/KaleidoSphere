import { createHash, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import sql from 'mssql';

import { answerCatalogQuestion, searchCatalog } from './catalog.mjs';
import {
  activateProjectionGeneration, projectionMirrorStatus, readActiveProjectionGeneration,
  stageProjectionGeneration,
} from './projection-generation.mjs';
import { handleDiscovery } from './discovery.mjs';
import { RealBiSpecialist } from './bi-specialist/specialist-agent.mjs';
import { selectPlanningPolicy } from './bi-specialist/planning-policy.mjs';
import { readPostgresqlSessionProof } from './db-analyzer/postgresql-runtime.mjs';
import { runAnalyzeProfile } from './db-analyzer/workflow.mjs';
import { coded, exactObject, validateActionRequest, validateAgentText } from './policy.mjs';
import { assertProductSecretBinding, buildLiveProfile, selectProductDescriptor, selectedEngine } from './runtime-config.mjs';
import { collectSupersetFingerprint, evaluateSupersetPlanningGate } from './superset-fingerprint.mjs';

const port = Number(process.env.PORT ?? 18089);
const receiptDir = process.env.RECEIPT_DIR ?? '/var/lib/chimpmaera-bi/receipts';
const projectionDb = process.env.PROJECTION_DB ?? '/var/lib/chimpmaera-bi/projection/analytics.db';
const repositoryRoot = process.env.REPOSITORY_ROOT ?? '/app';
const supersetFingerprintFixture = '/app/fixtures/superset-fingerprint-runtime-v1.json';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const engine = selectedEngine();

async function secret(fileVariable, code) {
  const file = process.env[fileVariable];
  if (!file) throw coded(code);
  const value = (await readFile(file, 'utf8').catch(() => '')).trim();
  if (!value) throw coded(code);
  return value;
}

function authorized(request, token) {
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
  const left = Buffer.from(supplied);
  const right = Buffer.from(token);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function bodyJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) throw coded('CONTROL_REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw coded('CONTROL_JSON_INVALID'); }
}

async function assertLivePrincipalReadOnly(profile, password) {
  const pool = await sql.connect({
    server: profile.adapter.host, port: profile.adapter.port, user: profile.adapter.user, password,
    database: profile.scope.database, connectionTimeout: profile.policy.maxQueryTimeoutMs,
    requestTimeout: profile.policy.maxQueryTimeoutMs,
    options: {encrypt: profile.adapter.encrypt, trustServerCertificate: profile.adapter.trustServerCertificate, readOnlyIntent: true, enableArithAbort: true},
  });
  try {
    const response = await pool.request().query(`SELECT
      DB_NAME() AS database_name,
      CAST(DATABASEPROPERTYEX(DB_NAME(), N'Updateability') AS nvarchar(32)) AS updateability,
      CAST(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'INSERT') AS int) AS can_insert,
      CAST(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'UPDATE') AS int) AS can_update,
      CAST(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'DELETE') AS int) AS can_delete,
      CAST(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'ALTER') AS int) AS can_alter,
      CAST(HAS_PERMS_BY_NAME(DB_NAME(), N'DATABASE', N'CONTROL') AS int) AS can_control`);
    const row = response.recordset?.[0];
    if (!row || row.database_name !== profile.scope.database) throw coded('DB_ANALYZE_SCOPE_MISMATCH');
    if ([row.can_insert, row.can_update, row.can_delete, row.can_alter, row.can_control].some((value) => value !== 0)) {
      throw coded('DB_ANALYZE_PRINCIPAL_NOT_READ_ONLY');
    }
    return {database: row.database_name, databaseUpdateability: row.updateability, principalDmlDdlPermissions: false, readOnlyIntent: true};
  } finally { await pool.close(); }
}

function extractRows(evidence, queryId) {
  return evidence.extracts.find((entry) => entry.queryId === queryId)?.rows ?? [];
}

async function analyze() {
  await mkdir(receiptDir, {recursive: true});
  const sourceMode = process.env.BI_SOURCE_MODE ?? 'fixture';
  let profileFile;
  let readOnlyEvidence;
  try {
    if (sourceMode === 'fixture') {
      if (engine !== 'mssql') throw coded('DB_ANALYZE_SOURCE_MODE_DENIED');
      profileFile = '/app/fixtures/mssql-profile-v1.json';
      readOnlyEvidence = {database: 'CM_BI_FIXTURE', databaseUpdateability: 'FIXTURE', principalDmlDdlPermissions: false, readOnlyIntent: true};
    } else if (sourceMode === 'live') {
      const descriptor = selectProductDescriptor(engine);
      const password = await secret(descriptor.secret.fileVariable, 'DB_ANALYZE_CREDENTIAL_MISSING');
      process.env[descriptor.secret.env] = password;
      const profile = buildLiveProfile(process.env, descriptor.secret.env);
      assertProductSecretBinding(descriptor, profile.adapter.passwordEnv);
      readOnlyEvidence = await liveReadOnlyEvidence(descriptor, profile, password);
      profileFile = path.join(receiptDir, 'live-profile.json');
      await writeFile(profileFile, `${JSON.stringify(profile, null, 2)}\n`, {mode: 0o600});
    } else throw coded('DB_ANALYZE_SOURCE_MODE_DENIED');

    const analysis = await runAnalyzeProfile(profileFile, {repositoryRoot});
    const analyzedAt = new Date().toISOString();
    const receiptId = `${engine}-${sha256(`${analysis.snapshotSha256}:${sourceMode}:${analysis.profile.scope.database}`).slice(0, 24)}`;
    const receipt = {
      schemaVersion: 'chimpmaera.bi/analysis-receipt/v1', receiptId, status: 'ANALYZED_READ_ONLY', analyzedAt,
      sourceMode, engine, scope: analysis.profile.scope,
      safety: {queryPackSelectOnly: true, rowSamples: false, ...readOnlyEvidence}, analysis,
    };
    const staged = stageProjectionGeneration({receiptDir, receipt});
    const activated = activateProjectionGeneration({receiptDir, staged, projectionDb});
    return activated.receipt;
  } finally {
    delete process.env.CM_MSSQL_PASSWORD;
    delete process.env.CM_ORACLE_PASSWORD;
    delete process.env.CM_POSTGRESQL_PASSWORD;
  }
}

// Explicit, fail-closed live dispatch by the product descriptor's capability route.
// Every engine's read-only evidence is named here; an unrecognized route fails closed
// rather than falling through to another engine's evidence.
async function liveReadOnlyEvidence(descriptor, profile, password) {
  switch (descriptor.components.capability) {
    case 'mssql.read-only-principal':
      return assertLivePrincipalReadOnly(profile, password);
    case 'oracle.read-only-capabilities':
      return {database: profile.scope.database, serviceName: profile.scope.container, principalDmlDdlPermissions: false, oracleThinMode: true, sourceScopeBound: true};
    case 'postgresql.read-only-session':
      return readPostgresqlSessionProof({profile, password});
    default:
      throw coded('DB_ANALYZE_DESCRIPTOR_CAPABILITY_MISMATCH');
  }
}

async function latestReceipt() {
  // The receipt and its projection are ONE generation: resolve the single active pointer and
  // re-verify the pair, rather than reading a separately written pointer file.
  const active = readActiveProjectionGeneration({receiptDir});
  if (!active.ok) throw coded(active.code === 'GENERATION_POINTER_ABSENT' ? 'ANALYSIS_RECEIPT_MISSING' : active.code);
  return active.receipt;
}

async function publish() {
  const receipt = await latestReceipt();
  // The digest-bound materializer reads the fixed projection path. Publishing a receipt whose
  // declared projection digest does not match that path would either bind mixed evidence or
  // fail closed inside Superset; refuse it here instead, before any request is sent.
  if (!projectionMirrorStatus(projectionDb, receipt.projection.sha256).inSync) throw coded('PROJECTION_MIRROR_NOT_ACTIVE');
  const token = await secret('CONTROL_TOKEN_FILE', 'CONTROL_TOKEN_MISSING');
  const response = await fetch(process.env.SUPERSET_MATERIALIZER_URL, {
    method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify({receiptId: receipt.receiptId, snapshotSha256: receipt.analysis.snapshotSha256, projectionSha256: receipt.projection.sha256}),
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json().catch(() => ({code: 'SUPERSET_RESPONSE_INVALID'}));
  if (!response.ok) throw coded(result.code ?? 'SUPERSET_MATERIALIZATION_FAILED');
  await writeFile(path.join(receiptDir, 'latest-publish.json'), `${JSON.stringify(result, null, 2)}\n`, {mode: 0o600});
  return result;
}

async function supersetFingerprint(body) {
  exactObject(body, ['action', 'mode'], ['action']);
  if (body.action !== 'collect_superset_fingerprint') throw coded('CONTROL_ACTION_DENIED');
  const mode = body.mode ?? 'runtime';
  if (!['runtime', 'fixture'].includes(mode)) throw coded('SUPERSET_FINGERPRINT_MODE_DENIED');
  const token = await secret('CONTROL_TOKEN_FILE', 'CONTROL_TOKEN_MISSING');
  const internalUrl = process.env.SUPERSET_FINGERPRINT_INTERNAL_URL
    ?? String(process.env.SUPERSET_MATERIALIZER_URL ?? '').replace(/\/internal\/materialize$/, '/internal/fingerprint');
  return collectSupersetFingerprint({
    mode,
    token,
    internalUrl,
    targetUrl: process.env.SUPERSET_FINGERPRINT_TARGET_URL ?? 'http://superset:8088',
    fixturePath: supersetFingerprintFixture,
    receiptDir,
  });
}

async function supersetPlanningGate(body) {
  exactObject(body, ['action', 'fingerprint', 'request'], ['action', 'request']);
  if (body.action !== 'evaluate_superset_planning_gate') throw coded('CONTROL_ACTION_DENIED');
  const fingerprint = body.fingerprint ?? await readFile(path.join(receiptDir, 'latest-superset-fingerprint.json'), 'utf8').then(JSON.parse).catch(() => null);
  return evaluateSupersetPlanningGate({fingerprint, request: body.request});
}

async function readback() {
  const [active, publication] = await Promise.all([
    Promise.resolve(readActiveProjectionGeneration({receiptDir})),
    readFile(path.join(receiptDir, 'latest-publish.json'), 'utf8').then(JSON.parse).catch(() => null),
  ]);
  if (!active.ok) throw coded(active.code === 'GENERATION_POINTER_ABSENT' ? 'ANALYSIS_RECEIPT_MISSING' : active.code);
  const receipt = active.receipt;
  const projectionMirror = projectionMirrorStatus(projectionDb, receipt.projection.sha256);
  const db = new DatabaseSync(active.projectionPath, {readOnly: true});
  try {
    const summary = db.prepare('SELECT * FROM bi_analysis_summary WHERE receipt_id=?').get(receipt.receiptId);
    const detailCount = db.prepare('SELECT COUNT(*) AS count FROM bi_analysis_detail WHERE receipt_id=?').get(receipt.receiptId).count;
    const catalogSnapshot = db.prepare('SELECT snapshot_sha256, receipt_id, schema_version.value AS schema_version FROM catalog_snapshots JOIN catalog_meta schema_version ON schema_version.key=? WHERE catalog_snapshots.snapshot_sha256=? AND active=1').get('schema_version', receipt.analysis.snapshotSha256);
    const technicalOverview = {
      systemSchemaRows: db.prepare('SELECT COUNT(*) AS count FROM technical_system_schema_overview WHERE snapshot_sha256=?').get(receipt.analysis.snapshotSha256).count,
      tableCapacityRows: db.prepare('SELECT COUNT(*) AS count FROM technical_tables_capacity WHERE snapshot_sha256=?').get(receipt.analysis.snapshotSha256).count,
      codeDependencyRows: db.prepare('SELECT COUNT(*) AS count FROM technical_code_dependencies WHERE snapshot_sha256=?').get(receipt.analysis.snapshotSha256).count,
      coverageRows: db.prepare('SELECT COUNT(*) AS count FROM technical_coverage_blind_spots WHERE snapshot_sha256=?').get(receipt.analysis.snapshotSha256).count,
      biCandidateRows: db.prepare('SELECT COUNT(*) AS count FROM technical_bi_relevance_candidates WHERE snapshot_sha256=?').get(receipt.analysis.snapshotSha256).count,
    };
    if (!summary || summary.snapshot_sha256 !== receipt.analysis.snapshotSha256) throw coded('PROJECTION_READBACK_MISMATCH');
    if (!catalogSnapshot || catalogSnapshot.receipt_id !== receipt.receiptId) throw coded('CATALOG_READBACK_MISMATCH');
    return {schemaVersion: 'chimpmaera.bi/readback/v1', receiptId: receipt.receiptId, generationId: active.generationId,
      summary, detailCount, catalogSnapshot, technicalOverview, publication, projectionMirror};
  } finally { db.close(); }
}

async function catalogQuestion(body) {
  const db = new DatabaseSync(projectionDb, {readOnly: true});
  try { return answerCatalogQuestion(db, body); }
  finally { db.close(); }
}

async function catalogSearch(body) {
  const db = new DatabaseSync(projectionDb, {readOnly: true});
  try { return searchCatalog(db, body); }
  finally { db.close(); }
}

async function discovery(body) {
  const db = new DatabaseSync(projectionDb);
  try { return handleDiscovery(db, body); }
  finally { db.close(); }
}

async function externalPlan(body) {
  exactObject(body, ['objective', 'receiptId'], ['objective']);
  const objective = validateAgentText(body.objective);
  const receipt = await latestReceipt();
  if (body.receiptId !== undefined && body.receiptId !== receipt.receiptId) throw coded('EXTERNAL_PLAN_RECEIPT_MISMATCH');
  const policy = selectPlanningPolicy(objective);
  const planId = `plan-${sha256(`${receipt.receiptId}:${receipt.analysis.snapshotSha256}:${objective}`).slice(0, 24)}`;
  return {
    schemaVersion: 'superset-bi-agent.external/plan/v2',
    planId,
    objective,
    evidenceBinding: {receiptId: receipt.receiptId, snapshotSha256: receipt.analysis.snapshotSha256},
    graph: {acceptedIncumbent: 'adaptive-v1', candidatePromotion: 'none'},
    planning: {
      policyVersion: policy.schemaVersion,
      taskClass: policy.taskClass,
      pattern: policy.pattern,
      validationDepth: policy.validationDepth,
      toolBudget: policy.toolBudget,
      stepBudget: policy.stepBudget,
      fallback: policy.fallback,
    },
    authority: {proposalOnly: true, persistentActionAllowed: false, modelMutationAuthority: false},
    trustedWorkflow: ['preview', 'direct-trusted-ui-approval', 'apply', 'readback', 'rollback'],
  };
}

async function externalPreview(body) {
  const plan = await externalPlan(body);
  const specialist = await new RealBiSpecialist().investigate({
    databasePath: projectionDb,
    objective: plan.objective,
    modelSynthesis: false,
    runId: `preview-${plan.planId.slice(5)}`,
  });
  const discovery = specialist.discovery;
  return {
    schemaVersion: 'superset-bi-agent.external/preview/v2',
    previewId: specialist.runId,
    planId: plan.planId,
    evidenceBinding: plan.evidenceBinding,
    graph: plan.graph,
    hypotheses: discovery.anomalyQualityCauseHypotheses.causeHypotheses,
    kpiCandidates: discovery.semanticKpiModel.kpis.map(({id, label, validation}) => ({id, label, validation})),
    visualizationProposal: discovery.visualizationProposal,
    confidence: discovery.evidenceConfidenceBlindSpots.confidence,
    blindSpots: discovery.evidenceConfidenceBlindSpots.blindSpots,
    userCorrection: discovery.userCorrection,
    authority: {
      proposalOnly: true,
      applyPerformed: false,
      sourceRowsReturned: false,
      modelMutationAuthority: false,
      approvalRequiredBeforePersistence: true,
    },
  };
}

function send(response, status, value) {
  const body = `${JSON.stringify(value)}\n`;
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store'});
  response.end(body);
}

const token = await secret('CONTROL_TOKEN_FILE', 'CONTROL_TOKEN_MISSING');
await mkdir(receiptDir, {recursive: true});
const server = http.createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/healthz') return send(response, 200, {status: 'ok'});
    if (!authorized(request, token)) throw coded('CONTROL_AUTH_DENIED');
    if (request.method === 'GET' && request.url === '/v1/status') {
      const active = readActiveProjectionGeneration({receiptDir, verifyProjection: false});
      const latest = active.ok ? active.receipt : null;
      return send(response, 200, {status: 'READY', engine, sourceMode: process.env.BI_SOURCE_MODE ?? 'fixture',
        latestReceiptId: latest?.receiptId ?? null, scope: latest?.scope ?? null,
        catalogReady: latest?.analysis?.snapshotSha256 ? true : false,
        generation: {state: active.state, generationId: active.generationId ?? null, code: active.code}});
    }
    if (request.method !== 'POST') throw coded('CONTROL_ROUTE_DENIED');
    const body = await bodyJson(request);
    if (request.url === '/v1/analyze') { validateActionRequest(body, 'analyze'); return send(response, 200, await analyze()); }
    if (request.url === '/v1/publish') { validateActionRequest(body, 'publish'); return send(response, 200, await publish()); }
    if (request.url === '/v1/readback') { validateActionRequest(body, 'readback'); return send(response, 200, await readback()); }
    if (request.url === '/v1/superset/fingerprint') return send(response, 200, await supersetFingerprint(body));
    if (request.url === '/v1/superset/planning-gate') return send(response, 200, await supersetPlanningGate(body));
    if (request.url === '/v1/catalog/question') return send(response, 200, await catalogQuestion(body));
    if (request.url === '/v1/catalog/search') return send(response, 200, await catalogSearch(body));
    if (request.url === '/v1/discovery') return send(response, 200, await discovery(body));
    if (request.url === '/v1/external/plan') return send(response, 200, await externalPlan(body));
    if (request.url === '/v1/external/preview') return send(response, 200, await externalPreview(body));
    exactObject(body, []); throw coded('CONTROL_ROUTE_DENIED');
  } catch (error) {
    const code = String(error.code ?? error.message ?? 'CONTROL_INTERNAL_ERROR').replace(/[^A-Z0-9_]/g, '_').slice(0, 128);
    send(response, code === 'CONTROL_AUTH_DENIED' ? 401 : 400, {status: 'DENIED', code});
  }
});
server.listen(port, '0.0.0.0');
