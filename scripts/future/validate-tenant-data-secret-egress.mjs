#!/usr/bin/env node
/**
 * KaleidoSphere future remote-connector boundary receipt — tenant data and
 * secret egress validator.
 *
 * Task: PLAN-KS91-BOUNDARY-CONTRACT-01
 * Receipt: docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md
 *
 * This script is the fail-closed checker for the frozen v1 egress boundary of
 * the future remote-connector surface. The remote connector is NOT implemented
 * in product v0.24.0; this receipt only freezes the boundary so a later
 * implementation cannot drift it.
 *
 * Usage:
 *   node scripts/future/validate-tenant-data-secret-egress.mjs
 *     Self-check: validates the shipped contract fixture and verifies every
 *     shipped negative case is rejected with its exact expected denial code.
 *
 *   node scripts/future/validate-tenant-data-secret-egress.mjs <envelope.json>
 *     Validates one candidate egress envelope against the shipped contract.
 *
 *   node scripts/future/validate-tenant-data-secret-egress.mjs --memo <memo.md> --dry-run
 *     Validates the sole memo, synthetic contracts and matrices, and readback
 *     receipt as one offline planning package. The legacy --fixture form
 *     remains available for the shipped fixture self-check.
 *
 * Exit codes: 0 accepted / self-check passed, 1 denied or self-check failed,
 * 2 usage error. Denial output is the stable denial code only.
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';
import {types as utilTypes} from 'node:util';

export const TENANT_DATA_SECRET_EGRESS_CONTRACT_SCHEMA = 'kaleidosphere.remote-connector/tenant-data-secret-egress-contract/v1';
export const TENANT_DATA_SECRET_EGRESS_ENVELOPE_SCHEMA = 'kaleidosphere.remote-connector/tenant-data-secret-egress-envelope/v1';
export const TENANT_DATA_SECRET_EGRESS_NEGATIVE_CASES_SCHEMA = 'kaleidosphere.remote-connector/tenant-data-secret-egress-negative-cases/v1';
export const TENANT_DATA_SECRET_EGRESS_FUTURE_MEMO_SCHEMA = 'kaleidosphere.remote-connector/future-memo-validation/v1';
export const TENANT_DATA_SECRET_EGRESS_CONTRACT_ID = 'KS91-BOUNDARY-CONTRACT-01';
export const TENANT_DATA_SECRET_EGRESS_PRODUCT_VERSION = '0.24.0';
export const FUTURE_MEMO_PLANNING_STATUS = 'FUTURE_BACKLOG';
export const FUTURE_MEMO_DISPOSITION = 'NONTERMINAL';

const ENGINES = Object.freeze(['mssql', 'oracle']);
const COVERAGE_STATES = Object.freeze(['COMPLETE', 'DENIED', 'PARTIAL', 'UNSUPPORTED', 'UNKNOWN']);
const BLIND_SPOT_LABELS = Object.freeze([
  'COVERAGE_DENIAL', 'COVERAGE_ERRORED', 'COVERAGE_MISSING', 'COVERAGE_PARTIAL',
  'COVERAGE_STALE', 'COVERAGE_TIMEOUT', 'COVERAGE_UNKNOWN',
]);
const PERMITTED_CLASSES = Object.freeze([
  'aggregate-count', 'blind-spot-label', 'coverage-state', 'evidence-digest', 'object-identifier',
]);
const DENIED_CLASSES = Object.freeze([
  'connection-configuration', 'credential-material', 'raw-definition-text',
  'source-row-material', 'sql-statement', 'unenumerated-freeform',
]);
const CLASS_SHAPES = Object.freeze({
  'aggregate-count': Object.freeze(['class', 'metric', 'value']),
  'blind-spot-label': Object.freeze(['class', 'label']),
  'coverage-state': Object.freeze(['class', 'objectDigest', 'state']),
  'evidence-digest': Object.freeze(['class', 'label', 'sha256']),
  'object-identifier': Object.freeze(['class', 'engine', 'object', 'schema']),
});
export const TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED = 'KS91_EGRESS_CONTRACT_SURFACE_DENIED';
export const TENANT_DATA_SECRET_EGRESS_CONTRACT_DIGEST_DENIED = 'KS91_EGRESS_CONTRACT_DIGEST_DENIED';
export const TENANT_DATA_SECRET_EGRESS_ENVELOPE_SURFACE_DENIED = 'KS91_EGRESS_ENVELOPE_SURFACE_DENIED';
export const TENANT_DATA_SECRET_EGRESS_AUTHORITY_DENIED = 'KS91_EGRESS_AUTHORITY_DENIED';
export const TENANT_DATA_SECRET_EGRESS_BINDING_DENIED = 'KS91_EGRESS_BINDING_DENIED';
export const TENANT_DATA_SECRET_EGRESS_CLASS_DENIED = 'KS91_EGRESS_CLASS_DENIED';
export const TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED = 'KS91_EGRESS_CLASS_SHAPE_DENIED';
const SELF_CHECK_DENIED = 'KS91_EGRESS_SELF_CHECK_DENIED';
const DENIAL_CODES = Object.freeze([
  TENANT_DATA_SECRET_EGRESS_CONTRACT_DIGEST_DENIED,
  TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED,
  TENANT_DATA_SECRET_EGRESS_ENVELOPE_SURFACE_DENIED,
  TENANT_DATA_SECRET_EGRESS_AUTHORITY_DENIED,
  TENANT_DATA_SECRET_EGRESS_BINDING_DENIED,
  TENANT_DATA_SECRET_EGRESS_CLASS_DENIED,
  TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED,
]);

export const FUTURE_MEMO_REJECT_CODES = Object.freeze({
  CROSS_TENANT_FLOW: 'KS91_CROSS_TENANT_FLOW_DENIED',
  RETENTION_UNBOUNDED: 'KS91_RETENTION_UNBOUNDED_DENIED',
  UNCONTROLLED_EGRESS: 'KS91_UNCONTROLLED_EGRESS_DENIED',
  SECRET_LOG_ARTIFACT: 'KS91_SECRET_LOG_ARTIFACT_DENIED',
  RESIDENCY_MISMATCH: 'KS91_RESIDENCY_MISMATCH_DENIED',
  LIVE_DATA: 'KS91_LIVE_DATA_DENIED',
  CREDENTIAL_PATH: 'KS91_CREDENTIAL_PATH_DENIED',
  ENDPOINT: 'KS91_ENDPOINT_DENIED',
  DEPLOYMENT: 'KS91_DEPLOYMENT_DENIED',
  NETWORK_INVOCATION: 'KS91_NETWORK_INVOCATION_DENIED',
});

const FUTURE_MEMO_CRITERIA = Object.freeze([
  Object.freeze({id: 'cross-tenant-data-flow', reject: FUTURE_MEMO_REJECT_CODES.CROSS_TENANT_FLOW, markers: ['cross-tenant', 'tenant-scoped']}),
  Object.freeze({id: 'unbounded-retention', reject: FUTURE_MEMO_REJECT_CODES.RETENTION_UNBOUNDED, markers: ['unbounded retention', 'finite duration']}),
  Object.freeze({id: 'uncontrolled-egress', reject: FUTURE_MEMO_REJECT_CODES.UNCONTROLLED_EGRESS, markers: ['uncontrolled egress', 'default: DENY']}),
  Object.freeze({id: 'secret-in-log-or-artifact', reject: FUTURE_MEMO_REJECT_CODES.SECRET_LOG_ARTIFACT, markers: ['secret', 'logs', 'artifacts']}),
  Object.freeze({id: 'region-residency-mismatch', reject: FUTURE_MEMO_REJECT_CODES.RESIDENCY_MISMATCH, markers: ['region/residency mismatch', 'Residency choices']}),
  Object.freeze({id: 'live-data', reject: FUTURE_MEMO_REJECT_CODES.LIVE_DATA, markers: ['no live data', 'live-data']}),
  Object.freeze({id: 'credential-path', reject: FUTURE_MEMO_REJECT_CODES.CREDENTIAL_PATH, markers: ['credentials', 'secret material']}),
  Object.freeze({id: 'endpoint', reject: FUTURE_MEMO_REJECT_CODES.ENDPOINT, markers: ['endpoint', 'remote egress']}),
  Object.freeze({id: 'deployment', reject: FUTURE_MEMO_REJECT_CODES.DEPLOYMENT, markers: ['deployment', 'service activation']}),
  Object.freeze({id: 'network-invocation', reject: FUTURE_MEMO_REJECT_CODES.NETWORK_INVOCATION, markers: ['network request', 'open a socket']}),
]);

const ID = /^[A-Za-z][A-Za-z0-9._:-]{2,127}$/;
const SCHEMA = /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const MAX_ITEMS = 256;

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

const plain = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && !utilTypes.isProxy(value) && Object.getPrototypeOf(value) === Object.prototype;

export function canonicalJson(value, code = TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail(code);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item, code)).join(',')}]`;
  if (!plain(value)) fail(code);
  return `{${Object.keys(value).sort().map((key) => {
    if (value[key] === undefined) fail(code);
    return `${JSON.stringify(key)}:${canonicalJson(value[key], code)}`;
  }).join(',')}}`;
}

export const sha256OfCanonical = (value, code) => `sha256:${createHash('sha256').update(canonicalJson(value, code)).digest('hex')}`;

const exact = (value, keys, code) => {
  if (!plain(value)) fail(code);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return typeof key !== 'string' || descriptor?.enumerable !== true
      || !Object.hasOwn(descriptor ?? {}, 'value');
  }) || canonicalJson(ownKeys.sort(), code) !== canonicalJson([...keys].sort(), code)) fail(code);
};

function assertDataTreeV1(value, code) {
  const seen = new Set();
  const visit = (item) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return;
    if (typeof item === 'number') {
      if (!Number.isFinite(item) || Object.is(item, -0)) fail(code);
      return;
    }
    if (!item || typeof item !== 'object' || utilTypes.isProxy(item) || seen.has(item)) fail(code);
    seen.add(item);
    const array = Array.isArray(item);
    if (!array && Object.getPrototypeOf(item) !== Object.prototype) fail(code);
    for (const key of Reflect.ownKeys(item)) {
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (typeof key !== 'string' || !Object.hasOwn(descriptor ?? {}, 'value')) fail(code);
      if (array && key === 'length') continue;
      if (descriptor.enumerable !== true) fail(code);
      visit(descriptor.value);
    }
    seen.delete(item);
  };
  visit(value);
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}

const digestValue = (value) => typeof value === 'string' && DIGEST.test(value);
const idValue = (value) => typeof value === 'string' && ID.test(value);
const schemaValue = (value) => typeof value === 'string' && SCHEMA.test(value);

export function buildTenantDataSecretEgressContractBodyV1() {
  return {
    schemaVersion: TENANT_DATA_SECRET_EGRESS_CONTRACT_SCHEMA,
    contractId: TENANT_DATA_SECRET_EGRESS_CONTRACT_ID,
    status: 'FROZEN_FUTURE_SURFACE',
    productVersion: TENANT_DATA_SECRET_EGRESS_PRODUCT_VERSION,
    policy: {
      default: 'DENY',
      tenantSourceRowsEgress: false,
      tenantSecretsEgress: false,
      rawDefinitionTextEgress: false,
      freeformPayloadEgress: false,
      mutationAuthority: false,
      queryExecutionAuthority: false,
      credentialTransportAuthority: false,
    },
    permittedEgressClasses: [...PERMITTED_CLASSES],
    deniedEgressClasses: [...DENIED_CLASSES],
    classShapes: Object.fromEntries(Object.entries(CLASS_SHAPES).map(([key, value]) => [key, [...value]])),
    coverageStates: [...COVERAGE_STATES],
    blindSpotLabels: [...BLIND_SPOT_LABELS],
    denialCodes: [...DENIAL_CODES],
    integration: {
      mode: 'separate-versioned-extension',
      remoteConnectorImplemented: false,
      externalApiV2Changed: false,
      supersetBoundaryChanged: false,
      secretFileLayoutChanged: false,
    },
  };
}

export const tenantDataSecretEgressContractDigestV1 = () => sha256OfCanonical(
  buildTenantDataSecretEgressContractBodyV1(),
  TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED,
);

export function validateTenantDataSecretEgressContractV1(value) {
  assertDataTreeV1(value, TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED);
  const body = buildTenantDataSecretEgressContractBodyV1();
  const expectedKeys = [...Object.keys(body).sort(), 'digest'].sort();
  exact(value, expectedKeys, TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED);
  if (!digestValue(value.digest)) fail(TENANT_DATA_SECRET_EGRESS_CONTRACT_DIGEST_DENIED);
  const candidate = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'digest'));
  if (canonicalJson(candidate, TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED)
    !== canonicalJson(body, TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED)) fail(TENANT_DATA_SECRET_EGRESS_CONTRACT_SURFACE_DENIED);
  if (value.digest !== tenantDataSecretEgressContractDigestV1()) fail(TENANT_DATA_SECRET_EGRESS_CONTRACT_DIGEST_DENIED);
  return deepFreeze(structuredClone(value));
}

const EGRESS_ENVELOPE_KEYS = Object.freeze(['attestation', 'egress', 'envelopeId', 'schemaVersion']);
const ATTESTATION_KEYS = Object.freeze(['contractSha256', 'contractVersion', 'productVersion']);
const EGRESS_KEYS = Object.freeze(['freeformIncluded', 'items', 'rawSqlIncluded', 'secretsIncluded', 'sourceRowsIncluded']);
const AUTHORITY_KEYS = Object.freeze(['freeformIncluded', 'rawSqlIncluded', 'secretsIncluded', 'sourceRowsIncluded']);

function validateClassInstance(item, contract, code) {
  if (!plain(item) || typeof item.class !== 'string') fail(code);
  if (!PERMITTED_CLASSES.includes(item.class)) fail(TENANT_DATA_SECRET_EGRESS_CLASS_DENIED);
  const shape = CLASS_SHAPES[item.class];
  exact(item, shape, TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED);
  switch (item.class) {
    case 'aggregate-count':
      if (!idValue(item.metric) || !Number.isInteger(item.value) || item.value < 0
        || item.value > Number.MAX_SAFE_INTEGER) fail(TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED);
      break;
    case 'blind-spot-label':
      if (!BLIND_SPOT_LABELS.includes(item.label)) fail(TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED);
      break;
    case 'coverage-state':
      if (!digestValue(item.objectDigest)
        || !COVERAGE_STATES.includes(item.state)) fail(TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED);
      break;
    case 'evidence-digest':
      if (!idValue(item.label)
        || !digestValue(item.sha256)) fail(TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED);
      break;
    case 'object-identifier':
      if (!ENGINES.includes(item.engine) || !schemaValue(item.schema) || !idValue(item.object))
        fail(TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED);
      break;
    default:
      fail(TENANT_DATA_SECRET_EGRESS_CLASS_DENIED);
  }
  return item;
}

export function validateTenantDataSecretEgressEnvelopeV1(value, contract) {
  const checked = validateTenantDataSecretEgressContractV1(contract);
  assertDataTreeV1(value, TENANT_DATA_SECRET_EGRESS_ENVELOPE_SURFACE_DENIED);
  exact(value, EGRESS_ENVELOPE_KEYS, TENANT_DATA_SECRET_EGRESS_ENVELOPE_SURFACE_DENIED);
  if (value.schemaVersion !== TENANT_DATA_SECRET_EGRESS_ENVELOPE_SCHEMA || !idValue(value.envelopeId))
    fail(TENANT_DATA_SECRET_EGRESS_ENVELOPE_SURFACE_DENIED);
  exact(value.attestation, ATTESTATION_KEYS, TENANT_DATA_SECRET_EGRESS_BINDING_DENIED);
  if (value.attestation.productVersion !== checked.productVersion
    || value.attestation.contractVersion !== checked.schemaVersion
    || value.attestation.contractSha256 !== checked.digest) fail(TENANT_DATA_SECRET_EGRESS_BINDING_DENIED);
  exact(value.egress, EGRESS_KEYS, TENANT_DATA_SECRET_EGRESS_ENVELOPE_SURFACE_DENIED);
  if (AUTHORITY_KEYS.some((key) => value.egress[key] !== false)) fail(TENANT_DATA_SECRET_EGRESS_AUTHORITY_DENIED);
  if (!Array.isArray(value.egress.items) || value.egress.items.length > MAX_ITEMS)
    fail(TENANT_DATA_SECRET_EGRESS_ENVELOPE_SURFACE_DENIED);
  for (const item of value.egress.items) validateClassInstance(item, checked, TENANT_DATA_SECRET_EGRESS_CLASS_SHAPE_DENIED);
  return deepFreeze(structuredClone(value));
}

export function validateTenantDataSecretEgressNegativeCasesV1(value, contract) {
  const checked = validateTenantDataSecretEgressContractV1(contract);
  assertDataTreeV1(value, SELF_CHECK_DENIED);
  const allowedKeys = ['cases', 'contractId', 'schemaVersion'];
  if (Object.hasOwn(value, 'memoValidation')) allowedKeys.push('memoValidation');
  exact(value, allowedKeys, SELF_CHECK_DENIED);
  if (value.schemaVersion !== TENANT_DATA_SECRET_EGRESS_NEGATIVE_CASES_SCHEMA
    || value.contractId !== checked.contractId) fail(SELF_CHECK_DENIED);
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > MAX_ITEMS) fail(SELF_CHECK_DENIED);
  const ids = new Set();
  for (const item of value.cases) {
    exact(item, ['envelope', 'expectedCode', 'id'], SELF_CHECK_DENIED);
    if (!idValue(item.id) || ids.has(item.id)) fail(SELF_CHECK_DENIED);
    ids.add(item.id);
    if (!DENIAL_CODES.includes(item.expectedCode)) fail(SELF_CHECK_DENIED);
    let denied = null;
    try {
      validateTenantDataSecretEgressEnvelopeV1(item.envelope, contract);
    } catch (error) {
      denied = error.code;
    }
    if (denied !== item.expectedCode) fail(SELF_CHECK_DENIED);
  }
  return deepFreeze(structuredClone(value));
}

const FUTURE_MEMO_DENIED = 'KS91_FUTURE_MEMO_VALIDATION_DENIED';
const FUTURE_MEMO_SURFACE_DENIED = 'KS91_FUTURE_MEMO_SURFACE_DENIED';
const FUTURE_MEMO_CRITERION_DENIED = 'KS91_FUTURE_MEMO_CRITERION_DENIED';
const FUTURE_MEMO_CANDIDATE_DENIED = 'KS91_FUTURE_MEMO_CANDIDATE_DENIED';
const FUTURE_MEMO_AUTHORIZATION_DENIED = 'KS91_FUTURE_MEMO_AUTHORIZATION_DENIED';

const FUTURE_MEMO_AUTHORIZATION_PATTERNS = Object.freeze([
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:an?\s+)?(?:network\s+)?endpoint\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:tenant\s+|customer\s+)?onboarding\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:the\s+)?credentials?\s+(?:capture|storage|transport)\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:an?\s+)?credentials?\s+(?:path|reference|value)\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:a\s+)?deployment\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:a\s+)?database\s+connection\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:customer\s+)?live[-\s]+data\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:an?\s+)?cross-tenant\s+(?:access|approval|data\s+flow|operation)\b/i,
  /\b(?:claims?|asserts?)\s+(?:that\s+)?(?!no\b)(?:an?\s+)?(?:network\s+)?(?:endpoint|deployment|credentials?(?:\s+(?:path|transport|value))?|live[-\s]+data(?:\s+access)?|cross-tenant\s+(?:access|approval|data\s+flow|operation))\b/i,
  /\b(?:endpoint|deployment|credentials?\s+(?:path|transport)|live[-\s]+data|cross-tenant\s+(?:access|data\s+flow))\s+(?:is|are)\s+(?:allowed|approved|available|configured|enabled|implemented|permitted)\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:the\s+)?production\s+logging\b/i,
]);

const FUTURE_MEMO_NETWORK_INVOCATION_PATTERN = /\b(?:fetch|axios|curl|wget|nc|net\.connect|http\.request|https\.request|dns\.lookup|socket\.connect)\s*\(/i;

const futureMemoFail = (code) => fail(code);

function validateFutureMemoTextV1(memo) {
  if (typeof memo !== 'string' || memo.length === 0) futureMemoFail(FUTURE_MEMO_DENIED);
  for (const criterion of FUTURE_MEMO_CRITERIA) {
    for (const marker of criterion.markers) {
      if (!memo.toLowerCase().includes(marker.toLowerCase())) futureMemoFail(FUTURE_MEMO_CRITERION_DENIED);
    }
  }
  for (const pattern of FUTURE_MEMO_AUTHORIZATION_PATTERNS) {
    if (pattern.test(memo)) futureMemoFail(FUTURE_MEMO_AUTHORIZATION_DENIED);
  }
  if (/https?:\/\/|\b(?:postgres|mssql|oracle):\/\//i.test(memo)
    || /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----|\b(?:password|api[_-]?key|bearer)\s*[:=]\s*[^\s`]/i.test(memo)
    || FUTURE_MEMO_NETWORK_INVOCATION_PATTERN.test(memo)) {
    futureMemoFail(FUTURE_MEMO_DENIED);
  }
  return memo;
}

const FUTURE_MEMO_CANDIDATE_KEYS = Object.freeze([
  'credentialPath', 'dataOrigin', 'deployment', 'egress', 'endpoint', 'flow', 'liveData',
  'networkInvocation', 'residency', 'retention', 'secretExposure', 'targetTenantId', 'tenantId',
]);
const FUTURE_MEMO_POLICY_KEYS = Object.freeze([
  'default', 'liveDataAllowed', 'credentialPathAllowed', 'endpointAllowed', 'deploymentAllowed',
  'networkInvocationAllowed', 'secretInLogsOrArtifactsAllowed', 'crossTenantFlowAllowed',
  'unboundedRetentionAllowed', 'residencyMismatchAllowed', 'offlineOnly',
]);
const SYNTHETIC_LABEL = /^synthetic-[A-Za-z0-9-]+$/;

function validateFutureMemoCandidateShapeV1(candidate) {
  assertDataTreeV1(candidate, FUTURE_MEMO_CANDIDATE_DENIED);
  exact(candidate, FUTURE_MEMO_CANDIDATE_KEYS, FUTURE_MEMO_CANDIDATE_DENIED);
  if (typeof candidate.dataOrigin !== 'string' || typeof candidate.tenantId !== 'string'
    || typeof candidate.targetTenantId !== 'string' || typeof candidate.liveData !== 'boolean'
    || typeof candidate.credentialPath !== 'boolean' || typeof candidate.endpoint !== 'boolean'
    || typeof candidate.deployment !== 'boolean' || typeof candidate.networkInvocation !== 'boolean') {
    futureMemoFail(FUTURE_MEMO_CANDIDATE_DENIED);
  }
  exact(candidate.flow, ['scope'], FUTURE_MEMO_CANDIDATE_DENIED);
  exact(candidate.retention, ['bounded', 'durationDays', 'policy'], FUTURE_MEMO_CANDIDATE_DENIED);
  exact(candidate.egress, ['controlled', 'destinationScope'], FUTURE_MEMO_CANDIDATE_DENIED);
  exact(candidate.secretExposure, ['inArtifact', 'inLog'], FUTURE_MEMO_CANDIDATE_DENIED);
  exact(candidate.residency, ['dataRegion', 'tenantRegion'], FUTURE_MEMO_CANDIDATE_DENIED);
  if (typeof candidate.flow.scope !== 'string' || typeof candidate.retention.bounded !== 'boolean'
    || (candidate.retention.durationDays !== null && !Number.isInteger(candidate.retention.durationDays))
    || typeof candidate.retention.policy !== 'string' || typeof candidate.egress.controlled !== 'boolean'
    || typeof candidate.egress.destinationScope !== 'string'
    || typeof candidate.secretExposure.inArtifact !== 'boolean' || typeof candidate.secretExposure.inLog !== 'boolean'
    || typeof candidate.residency.dataRegion !== 'string' || typeof candidate.residency.tenantRegion !== 'string') {
    futureMemoFail(FUTURE_MEMO_CANDIDATE_DENIED);
  }
  if (!SYNTHETIC_LABEL.test(candidate.tenantId) || !SYNTHETIC_LABEL.test(candidate.targetTenantId)
    || !SYNTHETIC_LABEL.test(candidate.residency.dataRegion)
    || !SYNTHETIC_LABEL.test(candidate.residency.tenantRegion)) futureMemoFail(FUTURE_MEMO_CANDIDATE_DENIED);
}

export function validateFutureMemoCandidateV1(candidate) {
  validateFutureMemoCandidateShapeV1(candidate);
  if (candidate.dataOrigin !== 'synthetic' || candidate.liveData) futureMemoFail(FUTURE_MEMO_REJECT_CODES.LIVE_DATA);
  if (candidate.tenantId !== candidate.targetTenantId || candidate.flow.scope !== 'tenant-scoped') {
    futureMemoFail(FUTURE_MEMO_REJECT_CODES.CROSS_TENANT_FLOW);
  }
  if (!candidate.retention.bounded || candidate.retention.durationDays === null
    || candidate.retention.policy === 'unbounded') futureMemoFail(FUTURE_MEMO_REJECT_CODES.RETENTION_UNBOUNDED);
  if (!candidate.egress.controlled || candidate.egress.destinationScope !== 'request-tenant-only') {
    futureMemoFail(FUTURE_MEMO_REJECT_CODES.UNCONTROLLED_EGRESS);
  }
  if (candidate.secretExposure.inLog || candidate.secretExposure.inArtifact) {
    futureMemoFail(FUTURE_MEMO_REJECT_CODES.SECRET_LOG_ARTIFACT);
  }
  if (candidate.residency.dataRegion !== candidate.residency.tenantRegion) {
    futureMemoFail(FUTURE_MEMO_REJECT_CODES.RESIDENCY_MISMATCH);
  }
  if (candidate.credentialPath) futureMemoFail(FUTURE_MEMO_REJECT_CODES.CREDENTIAL_PATH);
  if (candidate.endpoint) futureMemoFail(FUTURE_MEMO_REJECT_CODES.ENDPOINT);
  if (candidate.deployment) futureMemoFail(FUTURE_MEMO_REJECT_CODES.DEPLOYMENT);
  if (candidate.networkInvocation) futureMemoFail(FUTURE_MEMO_REJECT_CODES.NETWORK_INVOCATION);
  return deepFreeze(structuredClone(candidate));
}

export function validateFutureMemoFixtureV1(value, memo) {
  assertDataTreeV1(value, FUTURE_MEMO_SURFACE_DENIED);
  exact(value, ['schemaVersion', 'status', 'evidenceClass', 'policy', 'criteria', 'validCases', 'negativeCases'], FUTURE_MEMO_SURFACE_DENIED);
  if (value.schemaVersion !== TENANT_DATA_SECRET_EGRESS_FUTURE_MEMO_SCHEMA
    || value.status !== 'FROZEN_FUTURE_SURFACE' || value.evidenceClass !== 'synthetic-fixture-only') {
    futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
  }
  exact(value.policy, FUTURE_MEMO_POLICY_KEYS, FUTURE_MEMO_SURFACE_DENIED);
  if (value.policy.default !== 'DENY') futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
  for (const key of FUTURE_MEMO_POLICY_KEYS.slice(1)) {
    if (key === 'offlineOnly') {
      if (value.policy[key] !== true) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
    } else if (value.policy[key] !== false) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
  }
  if (!Array.isArray(value.criteria) || value.criteria.length !== FUTURE_MEMO_CRITERIA.length
    || !Array.isArray(value.validCases) || value.validCases.length < 1
    || !Array.isArray(value.negativeCases) || value.negativeCases.length < FUTURE_MEMO_CRITERIA.length) {
    futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
  }
  validateFutureMemoTextV1(memo);

  const criteriaById = new Map();
  for (const criterion of value.criteria) {
    exact(criterion, ['id', 'markers', 'reject'], FUTURE_MEMO_CRITERION_DENIED);
    if (!idValue(criterion.id) || criteriaById.has(criterion.id) || !Array.isArray(criterion.markers)
      || criterion.markers.length < 1 || criterion.markers.some((marker) => typeof marker !== 'string')
      || typeof criterion.reject !== 'string') futureMemoFail(FUTURE_MEMO_CRITERION_DENIED);
    criteriaById.set(criterion.id, criterion);
  }
  for (const expected of FUTURE_MEMO_CRITERIA) {
    const actual = criteriaById.get(expected.id);
    if (!actual || actual.reject !== expected.reject
      || canonicalJson(actual.markers) !== canonicalJson(expected.markers)) futureMemoFail(FUTURE_MEMO_CRITERION_DENIED);
  }

  const validIds = new Set();
  for (const item of value.validCases) {
    exact(item, ['candidate', 'id'], FUTURE_MEMO_SURFACE_DENIED);
    if (!idValue(item.id) || validIds.has(item.id)) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
    validIds.add(item.id);
    validateFutureMemoCandidateV1(item.candidate);
  }

  const negativeIds = new Set();
  const seenCriteria = new Set();
  const report = [];
  for (const item of value.negativeCases) {
    exact(item, ['candidate', 'criterion', 'expectedReject', 'id'], FUTURE_MEMO_SURFACE_DENIED);
    if (!idValue(item.id) || negativeIds.has(item.id) || !criteriaById.has(item.criterion)
      || item.expectedReject !== criteriaById.get(item.criterion).reject) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
    negativeIds.add(item.id);
    seenCriteria.add(item.criterion);
    let rejected = null;
    try {
      validateFutureMemoCandidateV1(item.candidate);
    } catch (error) {
      rejected = error.code;
    }
    if (rejected !== item.expectedReject) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
    report.push({criterion: item.criterion, id: item.id, reject: rejected});
  }
  for (const criterion of FUTURE_MEMO_CRITERIA) {
    if (!seenCriteria.has(criterion.id)) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
  }
  const serialized = JSON.stringify(value);
  if (/https?:\/\/|\b(?:postgres|mssql|oracle):\/\//i.test(serialized)
    || /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----|\b(?:password|api[_-]?key|bearer)\s*[:=]\s*[^\s`]/i.test(serialized)) {
    futureMemoFail(FUTURE_MEMO_DENIED);
  }
  return deepFreeze({fixture: structuredClone(value), report});
}

function resolveFixtures() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  return {
    root,
    contract: path.join(root, 'docs', 'future', 'remote-connector', 'fixtures', 'tenant-data-secret-egress-contract-v1.json'),
    negative: path.join(root, 'docs', 'future', 'remote-connector', 'fixtures', 'tenant-data-secret-egress-negative-cases-v1.json'),
    memo: path.join(root, 'docs', 'future', 'remote-connector', 'TENANT_DATA_SECRET_EGRESS.md'),
  };
}

async function runFutureMemoDryRun({fixturePath, memoPath, paths}) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const contract = JSON.parse(await readFile(paths.contract, 'utf8'));
  const checkedContract = validateTenantDataSecretEgressContractV1(contract);
  const negative = validateTenantDataSecretEgressNegativeCasesV1(fixture, contract);
  if (!Object.hasOwn(fixture, 'memoValidation')) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
  const checkedMemo = validateFutureMemoFixtureV1(fixture.memoValidation, await readFile(memoPath, 'utf8'));
  const {readbackTenantDataSecretEgress} = await import('./readback-tenant-data-secret-egress.mjs');
  const readback = await readbackTenantDataSecretEgress({
    memoPath: path.relative(paths.root, memoPath),
    offline: true,
  });
  if (readback.planningStatus !== FUTURE_MEMO_PLANNING_STATUS
    || readback.disposition !== FUTURE_MEMO_DISPOSITION || readback.nonterminalState.terminal !== false
    || readback.implementationDisposition?.disposition !== 'REJECTED_WITH_EVIDENCE'
    || readback.implementationDisposition?.decision !== 'REJECT_IMPLEMENTATION_NOW'
    || readback.implementationDisposition?.requirementsStatus !== 'FUTURE_BACKLOG'
    || readback.componentCoverage.length !== 7 || readback.criterionCoverage.length !== 15
    || readback.mandatoryNegatives.length !== checkedMemo.report.length
    || readback.blockingNodes.length !== 0) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
  for (const item of checkedMemo.report) {
    process.stdout.write(`TENANT_DATA_SECRET_EGRESS_REJECT_CONFIRMED criterion=${item.criterion} id=${item.id} reject=${item.reject}\n`);
  }
  process.stdout.write(
    `TENANT_DATA_SECRET_EGRESS_FUTURE_MEMO_VALIDATION_PASSED planningStatus=${readback.planningStatus} `
    + `disposition=${readback.disposition} terminal=${readback.nonterminalState.terminal} `
    + `implementationDisposition=${readback.implementationDisposition.disposition} `
    + `implementationDecision=${readback.implementationDisposition.decision} `
    + `components=${readback.componentCoverage.length} criteria=${readback.criterionCoverage.length} `
    + `contractDigest=${checkedContract.digest} `
    + `validCases=${checkedMemo.fixture.validCases.length} negativeCases=${checkedMemo.report.length} `
    + `envelopeNegativeCases=${negative.cases.length}\n`,
  );
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  const paths = resolveFixtures();
  if (args[0] === '--memo') {
    if (args.length !== 3 || args[2] !== '--dry-run') {
      process.stderr.write('usage: validate-tenant-data-secret-egress.mjs --memo <memo.md> --dry-run\n');
      return 2;
    }
    if (path.resolve(args[1]) !== paths.memo) futureMemoFail(FUTURE_MEMO_SURFACE_DENIED);
    return runFutureMemoDryRun({fixturePath: paths.negative, memoPath: paths.memo, paths});
  }
  if (args[0] === '--fixture') {
    if (args.length !== 3 || args[2] !== '--dry-run') {
      process.stderr.write('usage: validate-tenant-data-secret-egress.mjs --fixture <fixture.json> --dry-run\n');
      return 2;
    }
    return runFutureMemoDryRun({fixturePath: args[1], memoPath: paths.memo, paths});
  }
  if (args.length === 1) {
    const [envelopeFile] = args;
    const envelope = JSON.parse(await readFile(envelopeFile, 'utf8'));
    const contract = JSON.parse(await readFile(paths.contract, 'utf8'));
    try {
      const accepted = validateTenantDataSecretEgressEnvelopeV1(envelope, contract);
      process.stdout.write(`TENANT_DATA_SECRET_EGRESS_ENVELOPE_ACCEPTED ${accepted.envelopeId}\n`);
      return 0;
    } catch (error) {
      process.stdout.write(`${error.code}\n`);
      return 1;
    }
  }
  if (args.length !== 0) {
    process.stderr.write('usage: validate-tenant-data-secret-egress.mjs [envelope.json]\n');
    return 2;
  }
  const contract = JSON.parse(await readFile(paths.contract, 'utf8'));
  const checked = validateTenantDataSecretEgressContractV1(contract);
  const negative = JSON.parse(await readFile(paths.negative, 'utf8'));
  const checkedNegative = validateTenantDataSecretEgressNegativeCasesV1(negative, contract);
  process.stdout.write(
    `TENANT_DATA_SECRET_EGRESS_SELF_CHECK_PASSED contractDigest=${checked.digest} negativeCases=${checkedNegative.cases.length}\n`,
  );
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error.code ?? error.message}\n`);
    process.exitCode = 1;
  });
}