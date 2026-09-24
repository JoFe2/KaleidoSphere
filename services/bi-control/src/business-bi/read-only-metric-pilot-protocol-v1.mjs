// KaleidoSphere #250 (KS-EVO-05) — the credential-free READ-ONLY metric pilot protocol and its
// synthetic rehearsal on the EXISTING installable path.
//
// Result / DoD: "A bounded pilot protocol and, only after exact source permission, repeatable
// evidence of business correctness, comprehension and onboarding/reuse effort."
//
// What is ADMITTED locally and what is NOT, stated up front:
//   * ADMITTED (this slice): the credential-free pilot protocol, the data-minimization rules,
//     the per-context source/identity/permission contract, the synthetic REHEARSAL executed on
//     the released read path, the reader-explanation CONTRACT (which refuses a simulated
//     answer), the timing contract (which leaves an unmeasured duration UNKNOWN) and the
//     second-context reuse contract.
//   * NOT ADMITTED and never faked: a REAL pilot. Without an explicit, separate permission
//     record for each real read-only source, a context stays `BLOCKED_EXTERNAL`; the synthetic
//     rehearsal is NEVER presented as a real pilot, and no reader explanation is ever
//     manufactured. `realPilotExecuted` stays `false` and no human-comprehension claim is made.
//
// Reuse, never duplicated: #236 owns the original reader-comprehension / user-journey
// acceptance and #167 the broader-promotion criteria; this slice PREPARES the protocol and
// rehearses it — it does not restate, replace or claim those acceptances.
//
// Reused, never rebuilt: the released `compareSegmentsAcrossPeriods` read path (the existing
// installable path) and the released `canonicalJson`. No second metric, engine or dashboard.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  PERIODS,
  canonicalJson,
  compareSegmentsAcrossPeriods,
} from './net-revenue-segment-comparison.mjs';

export const PILOT_PROTOCOL_SCHEMA =
  'kaleidosphere.business-bi/read-only-metric-pilot-protocol/v1';
export const PILOT_CONTEXTS_SCHEMA =
  'kaleidosphere.business-bi/read-only-metric-pilot-contexts/v1';
export const PILOT_EXPLANATIONS_SCHEMA =
  'kaleidosphere.business-bi/read-only-metric-pilot-explanations/v1';
export const PILOT_PACKAGE_SCHEMA =
  'kaleidosphere.business-bi/read-only-metric-pilot-package/v1';
export const PILOT_CLASSIFICATION = 'SYNTHETIC_NON_CUSTOMER_BYTES';
export const PILOT_FORMATS = Object.freeze(['JSON', 'TABLE']);

// AC01: the closed permission vocabulary. Anything that is not an explicit GRANT is not a
// permission, and a missing permission is BLOCKED_EXTERNAL rather than "probably fine".
export const PERMISSION_STATES_V1 = Object.freeze([
  'GRANTED',
  'MISSING',
  'REVOKED',
]);

// AC01: the closed field kinds a minimized pilot read may carry.
export const FIELD_KINDS_V1 = Object.freeze([
  'METRIC_AGGREGATE',
  'PERIOD',
  'SEGMENT',
  'ORDER_COUNT',
]);

// AC03: the closed evidence classes. A rehearsal is NEVER a pilot.
export const EVIDENCE_CLASSES_V1 = Object.freeze([
  'SYNTHETIC_REHEARSAL',
  'REAL_READ_ONLY_PILOT',
]);

// AC03: only a DECLARED human reader explanation is admissible. A simulated answer is a denial.
export const EXPLANATION_SOURCES_V1 = Object.freeze([
  'HUMAN_READER_DECLARED',
  'SIMULATED',
]);

// AC03: the declaration class separates a genuine human reading from an AUTHORED TEST INPUT used
// to exercise the contract. An authored test input is NEVER human-comprehension evidence and
// never yields a real pilot.
export const DECLARATION_CLASSES_V1 = Object.freeze([
  'HUMAN_READING',
  'AUTHORED_TEST_INPUT',
]);

// AC03: the measured durations. An unmeasured duration is null with an UNKNOWN reason.
export const TIMING_KEYS_V1 = Object.freeze([
  'setupMs',
  'clarificationMs',
  'correctionMs',
  'maintenanceMs',
]);

export const PILOT_DENIALS_V1 = Object.freeze([
  'KS250_PILOT_DENIED:INPUT_REQUIRED',
  'KS250_PILOT_DENIED:PROTOCOL_MALFORMED',
  'KS250_PILOT_DENIED:CONTEXTS_MALFORMED',
  'KS250_PILOT_DENIED:EXPLANATIONS_MALFORMED',
  'KS250_PILOT_DENIED:CREDENTIAL_FIELD_PRESENT',
  'KS250_PILOT_DENIED:RAW_PERSON_PAYLOAD_INCLUDED',
  'KS250_PILOT_DENIED:PROTOCOL_FORBIDS_ROW_LEVEL',
  'KS250_PILOT_DENIED:SIMULATED_READER_ANSWER',
  'KS250_PILOT_DENIED:READER_EXPLANATION_FOR_UNGRANTED_CONTEXT',
  'KS250_PILOT_DENIED:CONTEXT_IDENTITY_SUBSTITUTED',
  'KS250_PILOT_DENIED:PROTOCOL_DIGEST_MISMATCH',
  'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING',
  'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_REVOKED',
  'KS250_PILOT_BLOCKED_EXTERNAL:SECOND_CONTEXT_NOT_PERMITTED',
  'KS250_PILOT_BLOCKED_EXTERNAL:READER_EXPLANATION_MISSING',
  'KS250_PILOT_DENIED:FORMAT_UNSUPPORTED',
]);

export const PILOT_NONCLAIMS = Object.freeze([
  'Preparation only: no real source is connected, read or qualified by this slice.',
  'A synthetic rehearsal is NEVER a real pilot and carries no human-comprehension evidence.',
  'No reader explanation is simulated, generated or inferred; only a declared human answer is admissible.',
  'An unmeasured duration or cost stays null with an UNKNOWN reason and is never a zero.',
  'No credential is accepted: this slice is credential-free by construction.',
  'No generalization from a small pilot, no broader promotion claim (#167 stays separately held) and no replacement of the #236 reader-comprehension acceptance.',
  'No production, customer, cross-tenant, private-source or public-write authority.',
]);

// ---------------------------------------------------------------------------
// Primitives.
// ---------------------------------------------------------------------------
const isRecord = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;
const isDenseArray = (value) =>
  Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
const closedString = (value) => typeof value === 'string' && value.length > 0 && value.length <= 256;
const sha256Hex = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const closedId = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9-]{1,31}:[a-z0-9][a-z0-9._-]{2,95}$/.test(value);
const inSet = (set, value) => set.includes(value);
const canonicalKeySet = (keys) => JSON.stringify(canonicalJson([...keys].sort()));
const exactKeys = (value, keys) =>
  isRecord(value) && canonicalKeySet(Object.keys(value)) === canonicalKeySet(keys);
const sha256 = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value)), 'utf8').digest('hex');
const bytesSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nonNegativeInt = (value) => Number.isInteger(value) && value >= 0;

const deny = (code, detail = {}) => ({ outcome: 'DENIED', code: `KS250_PILOT_DENIED:${code}`, ...detail });

// AC01 credential-free + data minimization: a credential-shaped or raw-person-shaped field
// ANYWHERE in an input is a denial. The pilot never needs one, so there is no legitimate case.
const normalisedKey = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
const CREDENTIAL_KEY = /(?:^|_)(?:credential|credentials|password|passwd|secret|token|api_?key|access_?key|private_?key|client_?secret|auth_?token|session_?key|connection_?string|dsn|user_?name|login)(?:$|_)/i;
const PERSON_KEY = /(?:^|_)(?:ssn|social_?security|national_?id|passport|tax_?id|card_?number|iban|email|e_?mail|phone|mobile|first_?name|last_?name|full_?name|surname|given_?name|date_?of_?birth|dob|address|person_?name|patient_?name|customer_?name|reader_?name)(?:$|_)/i;

// The protocol's OWN closed vocabulary legitimately names the credential policy; those exact
// keys are not credential payloads and are exempt from the credential scan.
const PROTOCOL_VOCABULARY_KEYS = new Set([
  'credential_policy', 'credential_free', 'retained_credential_free',
  'credentials_accepted', 'allowed_authentication',
]);

function scanForbidden(value, trail = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = scanForbidden(value[index], `${trail}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    const normalised = normalisedKey(key);
    if (PERSON_KEY.test(normalised)) return { kind: 'PERSON', key, trail };
    if (!PROTOCOL_VOCABULARY_KEYS.has(normalised)
      && CREDENTIAL_KEY.test(normalised) && nested !== null && nested !== undefined) {
      return { kind: 'CREDENTIAL', key, trail };
    }
    const found = scanForbidden(nested, `${trail}.${key}`);
    if (found) return found;
  }
  return null;
}

function refuseForbidden(value) {
  const found = scanForbidden(value);
  if (!found) return null;
  return found.kind === 'PERSON'
    ? deny('RAW_PERSON_PAYLOAD_INCLUDED', { key: found.key, trail: found.trail })
    : deny('CREDENTIAL_FIELD_PRESENT', { key: found.key, trail: found.trail });
}

// ---------------------------------------------------------------------------
// AC01 — the protocol. Frozen, versioned, credential-free, minimized.
// ---------------------------------------------------------------------------
function validProtocol(value) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'protocolId', 'metric',
    'dataMinimization', 'credentialPolicy', 'digest'])) return false;
  if (value.schemaVersion !== PILOT_PROTOCOL_SCHEMA
    || value.classification !== PILOT_CLASSIFICATION
    || !closedId(value.protocolId)) return false;
  if (!exactKeys(value.metric, ['metricId', 'contractPath', 'contractSha256'])
    || !closedId(value.metric.metricId)
    || !closedString(value.metric.contractPath)
    || !sha256Hex(value.metric.contractSha256)) return false;
  if (!exactKeys(value.dataMinimization, ['allowedFieldKinds', 'forbiddenFieldKinds', 'rowLevelPermitted'])
    || !isDenseArray(value.dataMinimization.allowedFieldKinds)
    || !value.dataMinimization.allowedFieldKinds.every((kind) => inSet(FIELD_KINDS_V1, kind))
    || !isDenseArray(value.dataMinimization.forbiddenFieldKinds)
    || value.dataMinimization.forbiddenFieldKinds.length === 0
    || typeof value.dataMinimization.rowLevelPermitted !== 'boolean') return false;
  if (!exactKeys(value.credentialPolicy, ['credentialFree', 'allowedAuthentication'])
    || value.credentialPolicy.credentialFree !== true
    || !isDenseArray(value.credentialPolicy.allowedAuthentication)
    || value.credentialPolicy.allowedAuthentication.length !== 1
    || value.credentialPolicy.allowedAuthentication[0] !== 'NONE') return false;
  const { digest: _ignored, ...body } = value;
  return sha256(body) === value.digest;
}

function validContexts(value) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'contexts'])) return false;
  if (value.schemaVersion !== PILOT_CONTEXTS_SCHEMA
    || value.classification !== PILOT_CLASSIFICATION
    || !isDenseArray(value.contexts) || value.contexts.length === 0) return false;
  for (const context of value.contexts) {
    if (!exactKeys(context, ['contextId', 'label', 'permission', 'sourceIdentity'])
      || !closedId(context.contextId) || !closedString(context.label)) return false;
    if (!exactKeys(context.permission, ['state', 'permissionId', 'grantedAt', 'scopeNote'])
      || !inSet(PERMISSION_STATES_V1, context.permission.state)) return false;
    if (context.permission.state === 'GRANTED') {
      if (!closedId(context.permission.permissionId)) return false;
      if (!closedString(context.permission.grantedAt)) return false;
      if (!closedString(context.permission.scopeNote)) return false;
    } else if (context.permission.permissionId !== null
      || context.permission.grantedAt !== null
      || context.permission.scopeNote !== null) {
      return false; // an ungranted permission must not carry a permission identity
    }
    if (!exactKeys(context.sourceIdentity, ['sourceLabel', 'sourceBytesSha256', 'retained'])
      || !closedString(context.sourceIdentity.sourceLabel)
      || !sha256Hex(context.sourceIdentity.sourceBytesSha256)
      || typeof context.sourceIdentity.retained !== 'boolean') return false;
  }
  const ids = value.contexts.map(({ contextId }) => contextId);
  return ids.length === new Set(ids).size;
}

// AC03 — reader explanations. A DECLARED human answer with its own declared reading; a
// simulated answer is refused, and an unmeasured duration stays null.
function validExplanations(value) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'explanations'])) return false;
  if (value.schemaVersion !== PILOT_EXPLANATIONS_SCHEMA
    || value.classification !== PILOT_CLASSIFICATION
    || !isDenseArray(value.explanations)) return false;
  for (const entry of value.explanations) {
    if (!exactKeys(entry, ['contextId', 'readerId', 'answerSource', 'declarationClass',
      'declaredNumberText', 'declaredSourceText', 'declaredLimits', 'timings'])) return false;
    if (!closedId(entry.contextId) || !closedId(entry.readerId)) return false;
    if (!inSet(DECLARATION_CLASSES_V1, entry.declarationClass)) return false;
    if (!inSet(EXPLANATION_SOURCES_V1, entry.answerSource)) return false;
    if (!closedString(entry.declaredNumberText) || !closedString(entry.declaredSourceText)) return false;
    if (!isDenseArray(entry.declaredLimits) || entry.declaredLimits.length === 0
      || !entry.declaredLimits.every((limit) => closedString(limit))) return false;
    if (!exactKeys(entry.timings, [...TIMING_KEYS_V1])) return false;
    for (const key of TIMING_KEYS_V1) {
      const duration = entry.timings[key];
      if (duration !== null && !nonNegativeInt(duration)) return false;
    }
  }
  const ids = value.explanations.map(({ contextId }) => contextId);
  return ids.length === new Set(ids).size;
}

/** Execute the released read path (the existing installable path) over the synthetic rows. */
function rehearse({ rows, contextId }) {
  const released = compareSegmentsAcrossPeriods(rows);
  return {
    contextId,
    evidenceClass: 'SYNTHETIC_REHEARSAL',
    realPilot: false,
    callableAsRealPilot: false,
    executed: true,
    metricId: 'bi-ks-01-net-revenue',
    numbers: {
      comparisonNetMinorUnits: released.comparison.netRevenue,
      currentNetMinorUnits: released.current.netRevenue,
      deltaNetMinorUnits: released.delta.netRevenue,
    },
    periodWindows: { comparison: { ...PERIODS.comparison }, current: { ...PERIODS.current } },
    rowsRead: rows.length,
    rowLevelReadPerformed: false,
    disclosedBoundary: 'A rehearsal runs the released read path over synthetic rows. It is not a real read-only pilot and produces no human or business-comprehension evidence.',
  };
}

function decideContext({ context, protocol, rows, explanations }) {
  const permission = context.permission;
  if (permission.state !== 'GRANTED') {
    const blockedCode = permission.state === 'REVOKED'
      ? 'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_REVOKED'
      : 'KS250_PILOT_BLOCKED_EXTERNAL:PERMISSION_MISSING';
    return {
      contextId: context.contextId,
      label: context.label,
      permissionState: permission.state,
      realPilotStatus: 'BLOCKED_EXTERNAL',
      blockedCode,
      blockedReason: permission.state === 'REVOKED'
        ? 'the previously granted read permission for this context was REVOKED'
        : 'no explicit read permission record exists for this context; a synthetic rehearsal is not a pilot',
      realPilot: false,
      evidenceClass: null,
      explanation: null,
      rehearsal: rehearse({ rows, contextId: context.contextId }),
      sourceIdentity: { ...context.sourceIdentity },
      readiness: 'PREPARED_ONLY',
    };
  }
  const explanation = explanations.explanations.find((entry) => entry.contextId === context.contextId);
  if (explanation === undefined) {
    return {
      contextId: context.contextId,
      label: context.label,
      permissionState: permission.state,
      realPilotStatus: 'BLOCKED_EXTERNAL',
      blockedCode: 'KS250_PILOT_BLOCKED_EXTERNAL:READER_EXPLANATION_MISSING',
      blockedReason: 'the permission exists but NO declared human reader explanation was supplied; no answer is ever inferred',
      realPilot: false,
      evidenceClass: null,
      explanation: null,
      rehearsal: rehearse({ rows, contextId: context.contextId }),
      sourceIdentity: { ...context.sourceIdentity },
      readiness: 'PREPARED_ONLY',
    };
  }
  const measuredTimings = Object.fromEntries(TIMING_KEYS_V1.map((key) => [
    key,
    explanation.timings[key] === null ? null : explanation.timings[key],
  ]));
  const unknownTimings = TIMING_KEYS_V1.filter((key) => explanation.timings[key] === null);
  // An AUTHORED TEST INPUT exercises the contract at CONTRACT LEVEL and is NEVER a real pilot.
  const realPilot = explanation.declarationClass === 'HUMAN_READING';
  return {
    contextId: context.contextId,
    label: context.label,
    permissionState: permission.state,
    permissionId: permission.permissionId,
    realPilotStatus: realPilot ? 'QUALIFIED_ON_DECLARED_HUMAN_READING' : 'CONTRACT_LEVEL_ONLY',
    blockedCode: null,
    blockedReason: null,
    realPilot,
    evidenceClass: realPilot ? 'REAL_READ_ONLY_PILOT' : null,
    contractLevelEvidenceClass: realPilot ? null : 'AUTHORED_TEST_INPUT',
    explanation: {
      readerId: explanation.readerId,
      answerSource: explanation.answerSource,
      declarationClass: explanation.declarationClass,
      declaredNumberText: explanation.declaredNumberText,
      declaredSourceText: explanation.declaredSourceText,
      declaredLimits: [...explanation.declaredLimits],
      simulated: false,
      humanComprehensionEvidence: realPilot,
    },
    timings: { ...measuredTimings },
    unmeasuredTimings: unknownTimings,
    unmeasuredTimingReason: unknownTimings.length === 0
      ? null
      : `UNKNOWN: not measured for ${unknownTimings.join(',')}`,
    rehearsal: rehearse({ rows, contextId: context.contextId }),
    sourceIdentity: { ...context.sourceIdentity },
    readiness: realPilot ? 'QUALIFIED' : 'CONTRACT_LEVEL_ONLY',
  };
}

/**
 * Public entry point. `protocol`, `contexts`, `explanations`, `rows`, `sourceIdentity` and
 * `now` are REQUIRED and never defaulted. The rehearsal always runs on the existing
 * installable path; the REAL pilot portion is only ever `QUALIFIED` when a context carries its
 * own explicit permission record AND a declared human reader explanation. Missing permission
 * stays `BLOCKED_EXTERNAL` and the rehearsal is never presented as a pilot.
 */
export function buildReadOnlyMetricPilot({
  protocol,
  contexts,
  explanations,
  rows,
  sourceIdentity,
  now,
  repoRoot = null,
} = {}) {
  const missing = [];
  if (protocol === undefined) missing.push('protocol');
  if (contexts === undefined) missing.push('contexts');
  if (explanations === undefined) missing.push('explanations');
  if (rows === undefined) missing.push('rows');
  if (sourceIdentity === undefined) missing.push('sourceIdentity');
  if (!closedString(now)) missing.push('now');
  if (missing.length > 0) return deny('INPUT_REQUIRED', { missing });

  try {
    for (const input of [protocol, contexts, explanations, sourceIdentity]) {
      const forbidden = refuseForbidden(input);
      if (forbidden) return forbidden;
    }
    if (!validProtocol(protocol)) return deny('PROTOCOL_MALFORMED');
    if (!validContexts(contexts)) return deny('CONTEXTS_MALFORMED');
    if (!validExplanations(explanations)) return deny('EXPLANATIONS_MALFORMED');
    if (!isDenseArray(rows) || rows.length === 0) return deny('INPUT_REQUIRED', { missing: ['rows'] });
    if (!exactKeys(sourceIdentity, ['sourceLabel', 'sourceBytesSha256', 'retainedCredentialFree'])
      || !closedString(sourceIdentity.sourceLabel)
      || !sha256Hex(sourceIdentity.sourceBytesSha256)
      || sourceIdentity.retainedCredentialFree !== true) {
      return deny('CONTEXTS_MALFORMED');
    }
    // Data minimization: the protocol may not permit row-level reading, and a row-level claim
    // must not be smuggled through the rehearsal.
    if (protocol.dataMinimization.rowLevelPermitted !== false) {
      return deny('PROTOCOL_FORBIDS_ROW_LEVEL', { rowLevelPermitted: protocol.dataMinimization.rowLevelPermitted });
    }
    // The metric contract the protocol names is read and re-digested HERE; a caller-supplied
    // digest for substituted contract bytes is refused.
    let contractBytes;
    try {
      contractBytes = readFileSync(protocol.metric.contractPath);
    } catch {
      return deny('PROTOCOL_MALFORMED', { contractPath: protocol.metric.contractPath });
    }
    if (bytesSha256(contractBytes) !== protocol.metric.contractSha256) {
      return deny('PROTOCOL_DIGEST_MISMATCH', {
        declared: protocol.metric.contractSha256,
        observed: bytesSha256(contractBytes),
      });
    }
    // The rehearsal source is the independently retained one; a substitution is refused.
    if (bytesSha256(JSON.stringify(rows)) !== sourceIdentity.sourceBytesSha256) {
      return deny('CONTEXT_IDENTITY_SUBSTITUTED', {
        declared: sourceIdentity.sourceBytesSha256,
        observed: bytesSha256(JSON.stringify(rows)),
      });
    }
    // A SIMULATED answer is refused before anything is qualified, and an explanation for a
    // context that has no permission is refused rather than silently carried.
    for (const explanation of explanations.explanations) {
      if (explanation.answerSource === 'SIMULATED') {
        return deny('SIMULATED_READER_ANSWER', { contextId: explanation.contextId, readerId: explanation.readerId });
      }
      const context = contexts.contexts.find((entry) => entry.contextId === explanation.contextId);
      if (context === undefined) return deny('EXPLANATIONS_MALFORMED', { contextId: explanation.contextId });
      if (context.permission.state !== 'GRANTED') {
        return deny('READER_EXPLANATION_FOR_UNGRANTED_CONTEXT', {
          contextId: explanation.contextId,
          permissionState: context.permission.state,
        });
      }
    }

    const decided = contexts.contexts.map((context) =>
      decideContext({ context, protocol, rows, explanations }));
    const granted = decided.filter((entry) => entry.realPilot);
    const [first, second] = contexts.contexts;

    // AC04 — reuse in a second context. The comparative finding exists ONLY when BOTH contexts
    // are independently permitted; otherwise the reuse part is BLOCKED_EXTERNAL by name.
    let secondContextReuse;
    if (contexts.contexts.length < 2) {
      secondContextReuse = {
        state: 'NOT_ATTEMPTED',
        reason: 'fewer than two declared contexts in this slice',
        additionalMappingCodeLines: null,
        specialCaseCount: null,
        comparativeFindings: null,
      };
    } else {
      const secondDecided = decided.find((entry) => entry.contextId === second.contextId);
      if (secondDecided.permissionState !== 'GRANTED') {
        secondContextReuse = {
          state: 'BLOCKED_EXTERNAL',
          code: 'KS250_PILOT_BLOCKED_EXTERNAL:SECOND_CONTEXT_NOT_PERMITTED',
          firstContextId: first.contextId,
          secondContextId: second.contextId,
          reason: 'the second context has no explicit read permission of its own; reuse is not evidenced',
          additionalMappingCodeLines: null,
          specialCaseCount: null,
          comparativeFindings: null,
        };
      } else if (!secondDecided.realPilot) {
        secondContextReuse = {
          state: 'CONTRACT_LEVEL_ONLY',
          firstContextId: first.contextId,
          secondContextId: second.contextId,
          reason: 'the second context carries only AUTHORED_TEST_INPUT evidence; the reuse contract is exercised but no real reuse finding exists',
          additionalMappingCodeLines: null,
          specialCaseCount: null,
          comparativeFindings: null,
        };
      } else {
        secondContextReuse = {
          state: 'QUALIFIED_ON_DECLARED_HUMAN_READING',
          firstContextId: first.contextId,
          secondContextId: second.contextId,
          additionalMappingCodeLines: 0,
          specialCaseCount: 0,
          comparativeFindings: {
            basis: 'BOTH_CONTEXTS_INDEPENDENTLY_PERMITTED_AND_DECLARED_BY_A_HUMAN_READER',
            generalized: false,
            generalizationClaim: 'NOT_PERMITTED',
            note: 'A two-context declared reading is not generalizable; no broader promotion claim is made.',
          },
        };
      }
    }

    const body = {
      schemaVersion: PILOT_PACKAGE_SCHEMA,
      classification: PILOT_CLASSIFICATION,
      trust: 'LOCAL_SYNTHETIC',
      now,
      protocolId: protocol.protocolId,
      protocolDigest: protocol.digest,
      metric: {
        metricId: protocol.metric.metricId,
        contractPath: protocol.metric.contractPath,
        contractSha256: protocol.metric.contractSha256,
        contractDigestReDerived: true,
      },
      dataMinimization: {
        ...protocol.dataMinimization,
        allowedFieldKinds: [...protocol.dataMinimization.allowedFieldKinds],
        forbiddenFieldKinds: [...protocol.dataMinimization.forbiddenFieldKinds],
        rowLevelReadPerformed: false,
      },
      credentialPolicy: { credentialFree: true, allowedAuthentication: ['NONE'], credentialsAccepted: false },
      sourceIdentity: { ...sourceIdentity },
      contexts: decided,
      realPilotExecuted: granted.length > 0,
      qualifiedContextCount: granted.length,
      blockedContextCount: decided.length - granted.length,
      secondContextReuse,
      generalizationClaim: 'NOT_PERMITTED',
      evidenceClasses: [...EVIDENCE_CLASSES_V1],
      nonClaims: [...PILOT_NONCLAIMS],
    };
    return {
      outcome: 'PREPARED',
      code: 'OK',
      ...body,
      binding: body,
      bindingDigest: sha256(body),
    };
  } catch (error) {
    return deny('PROTOCOL_MALFORMED', { message: String(error?.message ?? error) });
  }
}

/**
 * The independent checker: re-derive the package from the independently retained inputs and
 * require the carried binding to match exactly. A substituted protocol digest, a substituted
 * rehearsal source, a re-granted permission or a manufactured reader answer all change the
 * re-derived digest and are refused.
 */
export function verifyReadOnlyMetricPilot({
  protocol, contexts, explanations, rows, sourceIdentity, now, pilot, bindingDigest,
} = {}) {
  if (!isRecord(pilot) || !sha256Hex(bindingDigest)) return deny('INPUT_REQUIRED', { missing: ['pilot'] });
  const fresh = buildReadOnlyMetricPilot({
    protocol, contexts, explanations, rows, sourceIdentity, now,
  });
  if (fresh.outcome !== 'PREPARED') return deny('CONTEXT_IDENTITY_SUBSTITUTED', { detail: fresh.code });
  if (fresh.bindingDigest !== bindingDigest) {
    return deny('PROTOCOL_DIGEST_MISMATCH', { expected: bindingDigest, derived: fresh.bindingDigest });
  }
  if (fresh.bindingDigest !== sha256(pilot.binding ?? pilot)) {
    return deny('PROTOCOL_DIGEST_MISMATCH', { expected: bindingDigest, derived: sha256(pilot.binding ?? pilot) });
  }
  return {
    outcome: 'VERIFIED',
    code: 'OK',
    bindingDigest: fresh.bindingDigest,
    realPilotExecuted: fresh.realPilotExecuted,
    qualifiedContextCount: fresh.qualifiedContextCount,
    blockedContextCount: fresh.blockedContextCount,
  };
}

export function renderReadOnlyMetricPilot(pilot, format = 'JSON') {
  if (!PILOT_FORMATS.includes(format)) return deny('FORMAT_UNSUPPORTED', { format });
  if (!isRecord(pilot) || pilot.outcome !== 'PREPARED') return deny('INPUT_REQUIRED', { missing: ['pilot'] });
  if (format === 'JSON') {
    return { outcome: 'RENDERED', code: 'OK', format, text: `${JSON.stringify(pilot, null, 2)}\n` };
  }
  const header = ['context', 'permission', 'realPilot', 'evidenceClass', 'blockedCode', 'rehearsal'];
  const rows = pilot.contexts.map((entry) => [
    entry.contextId,
    entry.permissionState,
    String(entry.realPilot),
    entry.evidenceClass ?? 'null',
    entry.blockedCode ?? 'null',
    `${entry.rehearsal.evidenceClass}:${entry.rehearsal.numbers.deltaNetMinorUnits}`,
  ]);
  const widths = header.map((cell, index) => Math.max(cell.length, ...rows.map((r) => String(r[index]).length)));
  const line = (cells) => cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
  const text = [
    line(header),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(line),
    '',
    `bindingDigest=${pilot.bindingDigest}`,
    `realPilotExecuted=${pilot.realPilotExecuted} qualified=${pilot.qualifiedContextCount} blocked=${pilot.blockedContextCount}`,
    `secondContextReuse=${pilot.secondContextReuse.state}`,
    `generalizationClaim=${pilot.generalizationClaim}`,
    '',
  ].join('\n');
  return { outcome: 'RENDERED', code: 'OK', format, text };
}

export const PILOT_INTERNALS = Object.freeze({
  validProtocol,
  validContexts,
  validExplanations,
  rehearse,
  scanForbidden,
  sha256,
  exactKeys,
});
