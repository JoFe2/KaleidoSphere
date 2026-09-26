// KaleidoSphere #249 (KS-EVO-04) — one bounded metric-compiler adapter, evaluated by an
// executable ADOPT-OR-REJECT decision.
//
// LOCAL / SYNTHETIC / READ-ONLY. This module compiles the RELEASED metric contract
// (contracts/business-bi/v1/net-revenue.metric.json) into a bounded, versioned metric IR and
// preserves the bounded contracts' channels — UNKNOWN, DENIED, observed ABSENCE, the evidence
// revision and the applicability record — without collapsing any of them to an empty value.
//
// What this slice does NOT do, and does not claim:
//   * It does not adopt any external vendor component. The decision record rejects both
//     observed external alternatives on cost/verifiability grounds and says so; no vendor
//     compatibility is asserted or assumed.
//   * It compiles exactly ONE dialect (`kaleidosphere-metric-ir/v1`). Every other dialect is
//     refused by name, never silently approximated.
//   * No production, customer, general BI or dashboard claim; no push, publish or release.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import {
  PERIODS,
  canonicalJson,
} from './net-revenue-segment-comparison.mjs';

export const METRIC_IR_SCHEMA = 'kaleidosphere.business-bi/metric-ir/v1';
export const ADAPTER_CLASSIFICATION = 'SYNTHETIC_NON_CUSTOMER_BYTES';

/** The ONE dialect this adapter compiles. */
export const SUPPORTED_DIALECTS_V1 = Object.freeze(['kaleidosphere-metric-ir/v1']);

/** Dialects refused by name, each with the exact reason. Untested vendor compatibility is never assumed. */
export const DIALECT_REFUSALS_V1 = Object.freeze([
  Object.freeze({
    dialect: 'sql:postgres',
    reason: 'the repository has no SQL dialect implementation; a textual SQL dialect would need an untested external engine, which this slice does not assume to be compatible',
  }),
  Object.freeze({
    dialect: 'cube-yaml',
    reason: 'a Cube.js schema dialect would require an unverified external runtime; no vendor compatibility is assumed',
  }),
  Object.freeze({
    dialect: 'malloy',
    reason: 'a Malloy dialect would require an unverified external runtime; no vendor compatibility is assumed',
  }),
]);

/** The bounded channel kinds. None of these may be collapsed to an empty value. */
export const CHANNEL_KINDS_V1 = Object.freeze(['VALUE', 'UNKNOWN', 'DENIED', 'OBSERVED_ABSENT']);

export const APPLICABILITY_V1 = Object.freeze(['APPLICABLE', 'NOT_APPLICABLE', 'UNASSESSED']);

export const ADAPTER_DENIAL_CODES_V1 = Object.freeze([
  'KS249_COMPILER_DENIED:INPUT_REQUIRED',
  'KS249_COMPILER_DENIED:CONTRACT_UNREADABLE',
  'KS249_COMPILER_DENIED:CONTRACT_MALFORMED',
  'KS249_COMPILER_DENIED:DRIFT_DETECTED',
  'KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT',
  'KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT',
  'KS249_COMPILER_DENIED:REFUSED_OVERFLOW',
  'KS249_COMPILER_DENIED:EVIDENCE_REVISION_STALE',
  'KS249_COMPILER_DENIED:CHANNEL_COLLAPSED',
  'KS249_COMPILER_DENIED:CHANNEL_MALFORMED',
  'KS249_COMPILER_DENIED:ROUND_TRIP_LOSSY',
  'KS249_COMPILER_DENIED:SERIALIZED_BINDING_MISMATCH',
  'KS249_COMPILER_DENIED:SERIALIZED_BINDING_MALFORMED',
  'KS249_COMPILER_DENIED:SERIALIZED_EVIDENCE_MISMATCH',
  'KS249_COMPILER_DENIED:FORMAT_UNSUPPORTED',
  'KS249_COMPILER_DENIED:PROJECTION_FAILED',
]);

export const ADAPTER_NONCLAIMS_V1 = Object.freeze([
  'No vendor adoption: no external component is adopted, installed or assumed compatible.',
  'No general compiler claim: exactly one dialect and exactly one metric are compiled.',
  'No productive or public effect: this slice compiles in memory and writes no artifact.',
  'No catalog/dashboard claim: no catalog platform and no dashboard engine is added.',
]);

export const ADAPTER_FORMATS = Object.freeze(['JSON', 'IR', 'TABLE']);

const sha256 = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value)), 'utf8').digest('hex');
const bytesSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isDenseArray = (value) => Array.isArray(value) && value.every((entry) => entry !== undefined);
const closedString = (value) => typeof value === 'string' && value.length > 0 && value.length <= 240;
const inSet = (set, value) => set.includes(value);
const exactKeys = (value, keys) => isRecord(value)
  && JSON.stringify(canonicalJson(Object.keys(value).sort())) === JSON.stringify(canonicalJson([...keys].sort()));
const nonNegativeInt = (value) => Number.isInteger(value) && value >= 0;

function refuse(code, detail = {}) {
  return { outcome: 'DENIED', code, ...detail };
}

/** The bounded shape of the RELEASED metric contract. Closed vocabulary: an unknown key is refused. */
const CONTRACT_KEYS = Object.freeze([
  'schemaVersion', 'metric', 'relation', 'orderDateRole', 'currency', 'periods', 'recordRules',
  'nullPolicy', 'unknownPolicy', 'arithmetic', 'canonApplicability', 'nonclaims', 'holdout',
]);

/** Collect every numeric literal in the contract, with its trail, so numeric semantics can be checked. */
function numericLiterals(value, trail = '$', found = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => numericLiterals(entry, `${trail}[${index}]`, found));
    return found;
  }
  if (isRecord(value)) {
    for (const [key, nested] of Object.entries(value)) numericLiterals(nested, `${trail}.${key}`, found);
    return found;
  }
  if (typeof value === 'number') found.push({ trail, value });
  return found;
}

function validContract(contract) {
  if (!exactKeys(contract, CONTRACT_KEYS)) return false;
  if (!closedString(contract.schemaVersion) || !isRecord(contract.metric)) return false;
  if (!closedString(contract.metric.id) || !closedString(contract.metric.classification)) return false;
  if (!isRecord(contract.relation) || !closedString(contract.relation.name)) return false;
  if (!isRecord(contract.orderDateRole) || contract.orderDateRole.role !== 'ORDER_DATE') return false;
  if (!isRecord(contract.currency) || !closedString(contract.currency.code)) return false;
  if (!isRecord(contract.periods) || !isRecord(contract.periods.current) || !isRecord(contract.periods.comparison)) return false;
  if (!isRecord(contract.recordRules) || !isRecord(contract.arithmetic)) return false;
  if (!isRecord(contract.unknownPolicy) || !isRecord(contract.nullPolicy)) return false;
  if (!isRecord(contract.canonApplicability) || !isDenseArray(contract.canonApplicability.laws)) return false;
  if (!isDenseArray(contract.nonclaims) || contract.nonclaims.length === 0) return false;
  return true;
}

function validChannels(channels) {
  if (!isDenseArray(channels)) return false;
  for (const channel of channels) {
    if (!exactKeys(channel, ['channelId', 'kind', 'reason'])) return false;
    if (!closedString(channel.channelId) || !inSet(CHANNEL_KINDS_V1, channel.kind)) return false;
    if (!(channel.reason === null || closedString(channel.reason))) return false;
    if (channel.kind === 'DENIED' && channel.reason === null) return false;
  }
  return true;
}

/**
 * Compile the released metric contract into the bounded metric IR, preserving every bounded
 * channel. Required inputs are never defaulted.
 */
export function compileMetricAdapter({
  contractBytes,
  pinnedContractSha256,
  dialect,
  channels,
  applicability,
  evidenceRevision,
  currentEvidenceRevision,
  referenceRows,
  now,
} = {}) {
  const missing = ['contractBytes', 'pinnedContractSha256', 'dialect', 'channels', 'applicability',
    'evidenceRevision', 'currentEvidenceRevision', 'referenceRows', 'now']
    .filter((key) => ({ contractBytes, pinnedContractSha256, dialect, channels, applicability,
      evidenceRevision, currentEvidenceRevision, referenceRows, now })[key] === undefined);
  if (missing.length > 0) return refuse('KS249_COMPILER_DENIED:INPUT_REQUIRED', { missing });

  try {
    // AC03 — source drift is detected against the PINNED contract, never silently recompiled.
    if (!Buffer.isBuffer(contractBytes) && typeof contractBytes !== 'string') {
      return refuse('KS249_COMPILER_DENIED:CONTRACT_UNREADABLE', { observed: typeof contractBytes });
    }
    const observedContractSha256 = bytesSha256(contractBytes);
    if (observedContractSha256 !== pinnedContractSha256) {
      return refuse('KS249_COMPILER_DENIED:DRIFT_DETECTED', {
        declared: pinnedContractSha256, observed: observedContractSha256,
      });
    }

    // AC01 — exactly one dialect is compiled; every other dialect is refused by name.
    if (!inSet(SUPPORTED_DIALECTS_V1, dialect)) {
      const known = DIALECT_REFUSALS_V1.find((entry) => entry.dialect === dialect);
      return refuse('KS249_COMPILER_DENIED:UNSUPPORTED_DIALECT', {
        dialect,
        supportedDialects: [...SUPPORTED_DIALECTS_V1],
        reason: known === undefined
          ? 'no implementation of this dialect exists in the repository; untested vendor compatibility is not assumed'
          : known.reason,
      });
    }

    let contract;
    try {
      contract = JSON.parse(contractBytes.toString('utf8'));
    } catch (error) {
      return refuse('KS249_COMPILER_DENIED:CONTRACT_MALFORMED', { detail: String(error?.message ?? error) });
    }
    if (!validContract(contract)) return refuse('KS249_COMPILER_DENIED:CONTRACT_MALFORMED', { detail: 'closed contract shape' });
    if (!validChannels(channels)) return refuse('KS249_COMPILER_DENIED:CHANNEL_MALFORMED', { detail: 'closed channel shape' });
    if (!isDenseArray(applicability)) return refuse('KS249_COMPILER_DENIED:CHANNEL_MALFORMED', { detail: 'applicability' });
    for (const entry of applicability) {
      if (!exactKeys(entry, ['lawId', 'applicability']) || !closedString(entry.lawId)
        || !inSet(APPLICABILITY_V1, entry.applicability)) {
        return refuse('KS249_COMPILER_DENIED:CHANNEL_MALFORMED', { detail: 'applicability entry' });
      }
    }
    if (typeof evidenceRevision !== 'string' || evidenceRevision !== currentEvidenceRevision) {
      return refuse('KS249_COMPILER_DENIED:EVIDENCE_REVISION_STALE', {
        declared: evidenceRevision, current: currentEvidenceRevision,
      });
    }

    // AC03 — numerical semantics are TESTED, not assumed: integer minor units only, no floating
    // point anywhere in the contract, and no literal outside the safe integer range.
    if (contract.arithmetic.floatingPoint !== 'forbidden') {
      return refuse('KS249_COMPILER_DENIED:CONTRACT_MALFORMED', { detail: 'arithmetic.floatingPoint must be "forbidden"' });
    }
    for (const literal of numericLiterals(contract)) {
      if (!Number.isInteger(literal.value)) {
        return refuse('KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT', { trail: literal.trail, value: literal.value });
      }
      if (!Number.isSafeInteger(literal.value)) {
        return refuse('KS249_COMPILER_DENIED:REFUSED_OVERFLOW', { trail: literal.trail, value: literal.value });
      }
    }
    if (!Number.isInteger(contract.currency.minorUnitsPerMajorUnit) || contract.currency.minorUnitsPerMajorUnit < 1) {
      return refuse('KS249_COMPILER_DENIED:REFUSED_FLOATING_POINT', { trail: '$.currency.minorUnitsPerMajorUnit' });
    }

    // AC02 — the bounded channels are DERIVED from the released read path and preserved as
    // first-class entries. UNKNOWN, DENIED, OBSERVED_ABSENT and VALUE are never collapsed.
    const derivedUnknown = referenceRows.filter((row) => row.record_kind === 'unknown'
      || row.amount_minor_units === null || row.order_date === null);
    const derivedAbsent = [];
    for (const period of ['current', 'comparison']) {
      const window = contract.periods[period];
      const present = referenceRows.some((row) => typeof row.order_date === 'string'
        && row.order_date >= window.start && row.order_date <= window.end
        && (row.record_kind === 'sale' || row.record_kind === 'credit'));
      if (!present) derivedAbsent.push(period);
    }
    const derivedChannels = [
      {
        channelId: 'channel:value:current', kind: 'VALUE', reason: null,
        period: 'current', rows: referenceRows.length,
      },
      {
        channelId: 'channel:value:comparison', kind: 'VALUE', reason: null,
        period: 'comparison', rows: referenceRows.length,
      },
      {
        channelId: 'channel:unknown', kind: 'UNKNOWN', reason: null,
        count: derivedUnknown.length,
        amountMinorUnits: derivedUnknown.reduce((sum, row) => sum
          + (Number.isInteger(row.amount_minor_units) ? row.amount_minor_units : 0), 0),
      },
      ...derivedAbsent.map((period) => ({
        channelId: `channel:observed-absent:${period}`, kind: 'OBSERVED_ABSENT',
        reason: `no sale or credit row falls inside the '${period}' window in the retained rows`, period,
      })),
    ];
    for (const channel of channels) {
      if (derivedChannels.some((entry) => entry.channelId === channel.channelId)) continue;
      derivedChannels.push({ ...channel, derived: false });
    }
    const collapsed = derivedChannels.filter((entry) => entry.kind !== 'VALUE'
      && !Object.hasOwn(entry, 'count') && !Object.hasOwn(entry, 'reason')
      && !Object.hasOwn(entry, 'period'));
    if (collapsed.length > 0) {
      return refuse('KS249_COMPILER_DENIED:CHANNEL_COLLAPSED', { channelIds: collapsed.map((entry) => entry.channelId) });
    }

    const laws = contract.canonApplicability.laws.map((law) => ({
      lawId: law.id,
      statement: law.statement,
      applicability: inSet(APPLICABILITY_V1, law.applicability) ? law.applicability : 'UNASSESSED',
      admissionBasis: law.admissionBasis ?? null,
      recordedAt: law.recordedAt ?? null,
      declaredOutsideContract: false,
    }));
    // A law declared by the caller that the contract does not carry is preserved as an
    // explicit entry with its declared applicability. An unassessed law stays UNASSESSED:
    // it is never dropped and never silently marked not-applicable.
    for (const entry of applicability) {
      if (laws.some((law) => law.lawId === entry.lawId)) continue;
      laws.push({
        lawId: entry.lawId,
        statement: null,
        applicability: entry.applicability,
        admissionBasis: null,
        recordedAt: null,
        declaredOutsideContract: true,
      });
    }
    const declaredApplicability = applicability.map((entry) => entry.lawId);
    // The cross-check is against the CONTRACT's own laws: a law the caller declares that the
    // contract does not carry is recorded, never silently folded into the carried set.
    const carried = contract.canonApplicability.laws.map((law) => law.id);
    const unassessedLaws = laws.filter((law) => law.applicability === 'UNASSESSED').map((law) => law.lawId);

    const plan = {
      schemaVersion: METRIC_IR_SCHEMA,
      classification: ADAPTER_CLASSIFICATION,
      dialect,
      metricId: contract.metric.id,
      metricClassification: contract.metric.classification,
      relation: {
        name: contract.relation.name,
        kind: contract.relation.kind,
        fields: { ...contract.relation.fields },
      },
      orderDateRole: { ...contract.orderDateRole },
      currency: { ...contract.currency },
      periods: {
        current: { ...contract.periods.current },
        comparison: { ...contract.periods.comparison },
      },
      arithmetic: { ...contract.arithmetic },
      unknownPolicy: { ...contract.unknownPolicy },
      nullPolicy: { ...contract.nullPolicy },
      channels: derivedChannels,
      laws,
      applicabilityCrossCheck: {
        declaredLawIds: declaredApplicability,
        carriedLawIds: carried,
        lawIdsDeclaredButNotInContract: declaredApplicability.filter((id) => !carried.includes(id)),
        lawIdsInContractButNotDeclared: carried.filter((id) => !declaredApplicability.includes(id)),
        unassessedLaws,
      },
      evidenceRevision,
      contractSha256: observedContractSha256,
      sourceDrift: {
        detected: false,
        pinnedContractSha256,
        observedContractSha256,
        policy: 'a contract whose bytes differ from the pinned digest is DRIFT_DETECTED and never silently recompiled',
      },
      channelCollapsePolicy: 'UNKNOWN, DENIED, observed ABSENCE, the evidence revision and the applicability record are carried as first-class entries and are never collapsed to an empty value',
      nonclaims: [...ADAPTER_NONCLAIMS_V1],
      generatedAt: now,
    };

    // AC03 — lossless bounded round-trip: emit then re-parse must reproduce the same digest.
    const emitted = emitMetricIr(plan);
    const reparsed = parseMetricIr(emitted);
    if (reparsed.outcome !== 'PARSED') {
      return refuse('KS249_COMPILER_DENIED:ROUND_TRIP_LOSSY', { detail: reparsed.code });
    }
    const roundTripDigest = sha256(reparsed.plan);
    const planDigest = sha256(plan);
    if (roundTripDigest !== planDigest) {
      return refuse('KS249_COMPILER_DENIED:ROUND_TRIP_LOSSY', { declared: planDigest, observed: roundTripDigest });
    }

    const planWithDigest = { ...plan, planDigest };
    const body = {
      planDigest,
      roundTripDigest,
      dialect,
      contractSha256: observedContractSha256,
      evidenceRevision,
      channels: derivedChannels.map((entry) => ({ channelId: entry.channelId, kind: entry.kind })),
      laws: laws.map((law) => ({ lawId: law.lawId, applicability: law.applicability })),
      generatedAt: now,
    };
    const plan2 = { ...planWithDigest, roundTripDigest, evidenceRevision, bindingDigest: sha256(body), binding: body };
    return { outcome: 'COMPILED', code: 'OK', plan: plan2 };
  } catch (error) {
    return refuse('KS249_COMPILER_DENIED:PROJECTION_FAILED', { detail: String(error?.message ?? error) });
  }
}

/** Deterministic, lossless IR rendering of a compiled plan. */
export function emitMetricIr(plan) {
  const {
    binding: _binding, bindingDigest: _bindingDigest,
    roundTripDigest: _roundTripDigest, planDigest: _planDigest, ...body
  } = plan;
  return `${JSON.stringify(canonicalJson(body), null, 2)}\n`;
}

/** The plan body without its binding/digest metadata — the content a digest is derived over. */
function planBody(plan) {
  const {
    binding: _binding, bindingDigest: _bindingDigest,
    roundTripDigest: _roundTripDigest, planDigest: _planDigest, ...body
  } = plan;
  return body;
}

/** Parse an emitted IR document back into a plan. */
export function parseMetricIr(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return refuse('KS249_COMPILER_DENIED:CONTRACT_MALFORMED', { detail: 'empty IR document' });
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return refuse('KS249_COMPILER_DENIED:CONTRACT_MALFORMED', { detail: String(error?.message ?? error) });
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== METRIC_IR_SCHEMA) {
    return refuse('KS249_COMPILER_DENIED:CONTRACT_MALFORMED', { detail: 'IR schemaVersion' });
  }
  return { outcome: 'PARSED', code: 'OK', plan: parsed };
}

/** Re-derive a carried plan from the independently retained inputs and require an exact match. */
export function verifyMetricAdapter({ plan, bindingDigest, contractBytes, ...inputs } = {}) {
  if (!isRecord(plan) || typeof bindingDigest !== 'string' || bindingDigest.length !== 64) {
    return refuse('KS249_COMPILER_DENIED:SERIALIZED_BINDING_MALFORMED');
  }
  const fresh = compileMetricAdapter({ contractBytes, ...inputs });
  if (fresh.outcome !== 'COMPILED') {
    // The fresh derivation refused for its own exact reason: surface that reason rather than
    // hiding it behind a generic serialized mismatch.
    if (typeof fresh.code === 'string' && [
      'DRIFT_DETECTED', 'UNSUPPORTED_DIALECT', 'EVIDENCE_REVISION_STALE',
      'CONTRACT_UNREADABLE', 'CONTRACT_MALFORMED', 'REFUSED_FLOATING_POINT', 'REFUSED_OVERFLOW',
      'CHANNEL_MALFORMED',
    ].some((suffix) => fresh.code.endsWith(suffix))) {
      return { ...fresh, verified: false };
    }
    return refuse('KS249_COMPILER_DENIED:SERIALIZED_EVIDENCE_MISMATCH', { detail: fresh });
  }
  if (fresh.plan.bindingDigest !== bindingDigest) {
    return refuse('KS249_COMPILER_DENIED:SERIALIZED_BINDING_MISMATCH', {
      declared: bindingDigest, observed: fresh.plan.bindingDigest,
    });
  }
  // The carried plan's own content must re-derive to the same digest: a resealed body or a
  // stale carried planDigest is refused even when the binding digest was carried along.
  const carriedDigest = sha256(planBody(plan));
  if (carriedDigest !== fresh.plan.planDigest || plan.planDigest !== fresh.plan.planDigest) {
    return refuse('KS249_COMPILER_DENIED:SERIALIZED_EVIDENCE_MISMATCH', {
      declared: plan.planDigest ?? null, observed: carriedDigest, fresh: fresh.plan.planDigest,
    });
  }
  if (sha256(plan.binding) !== bindingDigest) {
    return refuse('KS249_COMPILER_DENIED:SERIALIZED_EVIDENCE_MISMATCH', { declared: bindingDigest });
  }
  return { outcome: 'VERIFIED', code: 'OK', verified: true, planDigest: fresh.plan.planDigest, bindingDigest };
}

export function renderMetricAdapter(result, format = 'JSON') {
  if (!inSet(ADAPTER_FORMATS, format)) {
    return refuse('KS249_COMPILER_DENIED:FORMAT_UNSUPPORTED', { format, supported: [...ADAPTER_FORMATS] });
  }
  if (result?.outcome !== 'COMPILED') {
    return refuse('KS249_COMPILER_DENIED:INPUT_REQUIRED', { detail: 'not a compiled plan' });
  }
  const plan = result.plan;
  if (format === 'IR') return { outcome: 'RENDERED', code: 'OK', format, text: emitMetricIr(plan) };
  if (format === 'JSON') {
    return { outcome: 'RENDERED', code: 'OK', format, text: `${JSON.stringify(plan, null, 2)}\n` };
  }
  const lines = [
    `metricId=${plan.metricId} dialect=${plan.dialect} revision=${plan.evidenceRevision}`,
    `relation=${plan.relation.name} orderDateRole=${plan.orderDateRole.column} currency=${plan.currency.code}`,
    `planDigest=${plan.planDigest} roundTripDigest=${plan.roundTripDigest} bindingDigest=${plan.bindingDigest}`,
    `contractSha256=${plan.contractSha256} drift=${plan.sourceDrift.detected}`,
    'channelId                       kind             detail',
    '------------------------------  ---------------  ------------------------------------------',
  ];
  for (const channel of plan.channels) {
    const detail = channel.kind === 'UNKNOWN'
      ? `count=${channel.count} amount=${channel.amountMinorUnits}`
      : channel.kind === 'VALUE'
        ? `period=${channel.period}`
        : channel.kind === 'OBSERVED_ABSENT'
          ? `period=${channel.period} reason=${channel.reason}`
          : `reason=${channel.reason}`;
    lines.push(`${channel.channelId.padEnd(30)}  ${channel.kind.padEnd(15)}  ${detail}`);
  }
  lines.push(`laws=${plan.laws.length} unassessed=${plan.applicabilityCrossCheck.unassessedLaws.length} `
    + `nonclaims=${plan.nonclaims.length}`);
  return { outcome: 'RENDERED', code: 'OK', format, text: `${lines.join('\n')}\n` };
}

export const ADAPTER_INTERNALS = Object.freeze({
  sha256,
  bytesSha256,
  exactKeys,
  validContract,
  validChannels,
  numericLiterals,
  planBody,
  refuse,
});
