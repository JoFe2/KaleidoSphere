// KaleidoSphere #256 (KS-OPS-04) — READ-ONLY project lifecycle and transfer status.
//
// Result / DoD: "Expose bounded read-only status, coverage and deviations using existing
// verified result/receipt surfaces."
//
// What this module COMPOSES (nothing is reimplemented, nothing is duplicated):
//
//   KS released surface — `order-source-consumption.mjs`
//     `composeReleasedNetRevenueComparison({ sourceRows })` and
//     `attestReleasedNetRevenueComparison(report, { retainedSourceRows })`
//     This is the VERIFIED RESULT / RECEIPT facet. It is actually EXECUTED here over the
//     separately retained rows the caller names, and its attestation is the only route by
//     which a number can appear as `verified` on the status board. A JSON round-trip of a
//     genuine report loses its private execution provenance and is refused; a report whose
//     digest is self-consistent but unexecuted is refused (`..._RELEASED_EXECUTION_UNVERIFIED`);
//     a one-cent row mutation no longer re-derives and is refused
//     (`..._RETAINED_ROWS_DIGEST_MISMATCH`).
//
//   PRODUCER REFERENCE (retained LOCAL candidates, NOT public releases — cited as lineage,
//   deliberately NOT imported; imports outside this slice stay dependencies and are never
//   invented here):
//     PAN461 candidate `46922f077697c22adae8fab7204a19b9922abcd7`
//       `src/pan461/lifecycle-inventory.mjs`
//       -> the lifecycle-state vocabulary, the generation MATCHED/DRIFTED/UNAVAILABLE axis,
//          the SOURCE_ARCHIVE-is-never-an-installable-target rule, the secret-VALUE refusal
//          with a REDACTED marker, and the content-bound rebind after serialization.
//     PAN471 candidate `90cb8d06dc642586f6b9295fbe66bce81b7b5a76`
//       `src/pan471/capability-inventory.mjs`
//       -> the availability vocabulary that keeps DENIED / UNAVAILABLE / NOT_COVERED
//          distinct (denied visibility is not deletion and not coverage), the separated
//          evidence planes, and open questions carrying an owner.
//
// AUTHORITY MODEL (issue #256, AC03): a verified display neither approves nor executes an
// update, restore or migration. The projection is READ-ONLY: it grants no write authority,
// it exposes no approval surface, and any attempt to escalate to a mutating action is
// refused by name. There is no code path in this module that writes, migrates, restores or
// mutates any byte.
//
// HONEST BOUNDARY (disclosed, never hidden): the lifecycle/transfer inventory inputs are
// AUTHORED, BOUND, LOCAL-SYNTHETIC declarations — not a product execution and not a real
// host probe. The only facet this module actually EXECUTES is the released comparison
// attestation above; that is stated on every output and in the evidence record. A
// helper-only or authored-fixture facet must never be read as an executed observation.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { canonicalJson } from './net-revenue-segment-comparison.mjs';
import {
  composeReleasedNetRevenueComparison,
  attestReleasedNetRevenueComparison,
} from './order-source-consumption.mjs';

export const PROJECT_STATUS_SCHEMA =
  'kaleidosphere.business-bi/project-lifecycle-transfer-status/v1';
export const PROJECT_STATUS_DECLARATION_SCHEMA =
  'kaleidosphere.business-bi/project-lifecycle-transfer-status-declaration/v1';
export const PROJECT_STATUS_OBSERVED_SCOPE_SCHEMA =
  'kaleidosphere.business-bi/project-lifecycle-transfer-status-observed-scope/v1';
export const PROJECT_STATUS_QUARANTINE_SCHEMA =
  'kaleidosphere.business-bi/project-lifecycle-transfer-status-quarantine/v1';
export const PROJECT_STATUS_CONSUMER_CONTRACT = 'ks-ops-04.project-lifecycle-transfer-status/v1';
export const PROJECT_STATUS_CLASSIFICATION = 'SYNTHETIC_NON_CUSTOMER_BYTES';
export const PROJECT_STATUS_FORMATS = Object.freeze(['JSON', 'TABLE']);

// PAN461 LIFECYCLE_STATES_V1 (producer reference, cited): UNKNOWN is the fail-closed state
// for an unavailable decisive facet and is never an inferred version.
export const PROJECT_STATUS_STATES_V1 = Object.freeze([
  'RUNNING',
  'STOPPED',
  'PARTIALLY_INSTALLED',
  'LOCALLY_MODIFIED',
  'SLEEPING',
  'UNKNOWN',
]);

// AC02: the coverage states that must survive a source change intact. DENIED is denied
// visibility (not absence), PARTIAL is an incomplete but non-empty observation, and
// OBSERVED_ABSENT is a positive observation that the item was not present. None of the
// four is ever collapsed into an empty value, a zero, or a current truth.
export const PROJECT_STATUS_COVERAGE_V1 = Object.freeze([
  'AVAILABLE',
  'DENIED',
  'UNKNOWN',
  'PARTIAL',
  'OBSERVED_ABSENT',
]);

// PAN461 ARTIFACT_ROLES_V1 (producer reference, cited). A SOURCE_ARCHIVE is an archive of
// the declared source; it is NEVER an installable target and never transfer authority.
export const PROJECT_STATUS_TRANSFER_ROLES_V1 = Object.freeze([
  'SOURCE_ARCHIVE',
  'IMAGE',
  'CONFIG_BUNDLE',
]);

// AC01: the closed set of responsible roles that may be named as the NEXT responsible role
// for an open item. UNASSIGNED is explicit, never omitted.
export const PROJECT_STATUS_RESPONSIBLE_ROLES_V1 = Object.freeze([
  'RELEASE_OWNER',
  'SOURCE_OWNER',
  'DELIVERY_OWNER',
  'INDEPENDENT_REVIEWER',
  'PLATFORM_OPERATOR',
  'UNASSIGNED',
]);

// The one action a status display may perform. Everything else is a mutating escalation.
export const PROJECT_STATUS_ALLOWED_ACTION = 'READ_STATUS';

// AC03: mutating actions the display refuses by name.
export const PROJECT_STATUS_REFUSED_ACTIONS_V1 = Object.freeze([
  'UPDATE',
  'RESTORE',
  'MIGRATE',
  'APPROVE_TRANSFER',
  'EXECUTE',
  'WRITE',
  'DELETE',
]);

// The single marker a reference-bearing field carries; a real value is never exported.
const REFERENCE_MARKER = 'REDACTED';

export const PROJECT_STATUS_DENIALS_V1 = Object.freeze([
  'PROJECT_STATUS_INPUT_REQUIRED',
  'PROJECT_STATUS_DECLARATION_MALFORMED',
  'PROJECT_STATUS_OBSERVED_SCOPE_MALFORMED',
  'PROJECT_STATUS_OBSERVED_SCOPE_DIGEST_MISMATCH',
  'PROJECT_STATUS_EVIDENCE_REVISION_STALE',
  'PROJECT_STATUS_TRANSFER_MALFORMED',
  'PROJECT_STATUS_SOURCE_ARCHIVE_UNREADABLE',
  'PROJECT_STATUS_SOURCE_ARCHIVE_BYTES_MISMATCH',
  'PROJECT_STATUS_SOURCE_ARCHIVE_ROLE_INVALID',
  'PROJECT_STATUS_QUARANTINE_MALFORMED',
  'PROJECT_STATUS_SECRET_VALUE_INCLUDED',
  'PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED',
  'PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED',
  'PROJECT_STATUS_UNKNOWN_AUTHORITY_ACTION',
  'PROJECT_STATUS_SERIALIZED_BINDING_MALFORMED',
  'PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH',
  'PROJECT_STATUS_SERIALIZED_EVIDENCE_MISMATCH',
  'PROJECT_STATUS_RELEASED_READBACK_INPUT_REQUIRED',
  'PROJECT_STATUS_PROJECTION_FAILED',
  'PROJECT_STATUS_FORMAT_UNSUPPORTED',
]);

export const PROJECT_STATUS_NONCLAIMS = Object.freeze([
  'Read-only status projection: no write, update, restore, migration, approval, execution or productive effect.',
  'The lifecycle and transfer inventory inputs are AUTHORED LOCAL-SYNTHETIC declarations, not a product execution and not a real host probe.',
  'Only the released comparison attestation facet is actually executed; every authored facet is disclosed as such.',
  'UNKNOWN, DENIED, PARTIAL and OBSERVED_ABSENT are preserved and are never collapsed into an empty value or a zero.',
  'No secret value, credential or raw person payload is exported; only reference paths may be carried.',
  'No production, customer, private-source, cross-tenant or real-environment claim; no measured performance claim.',
  'No second dashboard engine, no second metric semantic, no second catalog and no general-purpose status framework.',
]);

// ---------------------------------------------------------------------------
// Small closed-shape primitives (mirroring the repository's fail-closed style).
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
const nonNegativeInt = (value) => Number.isInteger(value) && value >= 0;
const positiveInt = (value) => Number.isInteger(value) && value >= 1;
// `canonicalJson` returns a canonicalised VALUE, not a string, so the comparison is made on
// the canonical serialisation (a bare `===` between two canonicalised arrays is always false).
const canonicalKeySet = (keys) => JSON.stringify(canonicalJson([...keys].sort()));
const exactKeys = (value, keys) =>
  isRecord(value) && canonicalKeySet(Object.keys(value)) === canonicalKeySet(keys);
const sha256 = (value) => createHash('sha256').update(JSON.stringify(canonicalJson(value)), 'utf8').digest('hex');
const bytesSha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// AC01 + the explicit secret/raw-person refusal. Two independent gates:
//   1. the closed shapes above refuse an unexpected key at all, and
//   2. this recursive scan refuses a SECRET-SHAPED key whose value is a real value, and any
//      raw person payload key, ANYWHERE in an input (so a caller cannot smuggle a payload
//      through a nested record that happens to match shape).
// A reference key is legitimate; a secret VALUE is a denial.
const SECRET_KEY = /(?:^|_)(?:secret|password|passwd|credential|credentials|token|api_?key|access_?key|private_?key|client_?secret|auth_?token|session_?key)(?:$|_)/i;
const RAW_PERSON_KEY = /(?:^|_)(?:ssn|social_?security|national_?id|passport|tax_?id|card_?number|iban|email|e_?mail|phone|mobile|first_?name|last_?name|full_?name|surname|given_?name|date_?of_?birth|dob|home_?address|street_?address|postal_?address|person_?name|patient_?name|customer_?name)(?:$|_)/i;

// A camelCase key is normalised to snake_case before matching, so `secretToken` cannot
// sidestep the gate that `secret_token` is refused by.
const normalisedKey = (key) => key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

function scanForForbiddenPayload(value, trail = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = scanForForbiddenPayload(value[index], `${trail}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    if (RAW_PERSON_KEY.test(normalisedKey(key))) return { kind: 'RAW_PERSON_PAYLOAD', key, trail };
    // A SECRET-shaped key may carry ONLY a reference: a `...Ref` field with a closed-id or
    // path-shaped value. Every other secret-shaped key with a real value is a denial, and so
    // is a `...Ref` field whose value is not reference-shaped.
    if (SECRET_KEY.test(normalisedKey(key)) && nested !== null && nested !== undefined) {
      const referenceShaped = /ref$/i.test(key)
        && typeof nested === 'string'
        && (closedId(nested)
          || /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(nested) && nested !== REFERENCE_MARKER);
      if (!referenceShaped) return { kind: 'SECRET_VALUE', key, trail };
    }
    const found = scanForForbiddenPayload(nested, `${trail}.${key}`);
    if (found) return found;
  }
  return null;
}

function refuseForbiddenPayload(value) {
  const found = scanForForbiddenPayload(value);
  if (!found) return null;
  return found.kind === 'RAW_PERSON_PAYLOAD'
    ? { outcome: 'DENIED', code: 'PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED', key: found.key, trail: found.trail }
    : { outcome: 'DENIED', code: 'PROJECT_STATUS_SECRET_VALUE_INCLUDED', key: found.key, trail: found.trail };
}

// ---------------------------------------------------------------------------
// Input validation (closed shapes; every derived value is RE-DERIVED, never trusted).
// ---------------------------------------------------------------------------
function validDeclaration(value) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'projectId', 'projectLabel',
    'denominatorUnit', 'ownedScope'])) return false;
  if (value.schemaVersion !== PROJECT_STATUS_DECLARATION_SCHEMA
    || value.classification !== PROJECT_STATUS_CLASSIFICATION
    || !closedId(value.projectId)
    || !closedString(value.projectLabel)
    || !closedString(value.denominatorUnit)
    || !isDenseArray(value.ownedScope) || value.ownedScope.length === 0) return false;
  let ok = true;
  for (const item of value.ownedScope) {
    if (!exactKeys(item, ['scopeId', 'label', 'ownerRole', 'requiredCount'])
      || !closedId(item.scopeId) || !closedString(item.label)
      || !PROJECT_STATUS_RESPONSIBLE_ROLES_V1.includes(item.ownerRole)
      || !positiveInt(item.requiredCount)) { ok = false; break; }
  }
  if (!ok) return false;
  const ids = value.ownedScope.map(({ scopeId }) => scopeId);
  return ids.length === new Set(ids).size;
}

function validObservedScope(value) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'observedRevision',
    'evidenceSha256', 'scope'])) return false;
  if (value.schemaVersion !== PROJECT_STATUS_OBSERVED_SCOPE_SCHEMA
    || value.classification !== PROJECT_STATUS_CLASSIFICATION
    || !closedString(value.observedRevision)
    || !sha256Hex(value.evidenceSha256)
    || !isDenseArray(value.scope)) return false;
  let ok = true;
  for (const entry of value.scope) {
    if (!exactKeys(entry, ['scopeId', 'state', 'completedCount'])
      || !closedId(entry.scopeId)
      || !PROJECT_STATUS_COVERAGE_V1.includes(entry.state)) { ok = false; break; }
    // completedCount is an INTEGER or an explicit null. It is NEVER inferred from state,
    // and a DENIED / UNKNOWN / OBSERVED_ABSENT entry may not carry a fabricated count.
    if (entry.completedCount !== null && !nonNegativeInt(entry.completedCount)) { ok = false; break; }
    if (entry.state !== 'AVAILABLE' && entry.completedCount !== null) { ok = false; break; }
    if (entry.state === 'AVAILABLE' && entry.completedCount === null) { ok = false; break; }
  }
  if (!ok) return false;
  const ids = value.scope.map(({ scopeId }) => scopeId);
  return ids.length === new Set(ids).size;
}

function observedScopeBody(value) {
  const { evidenceSha256: _ignored, ...body } = value;
  return body;
}

function validTransfer(value) {
  if (!exactKeys(value, ['sourceArchive', 'target'])) return false;
  const { sourceArchive, target } = value;
  if (!exactKeys(sourceArchive, ['artifactId', 'role', 'path', 'declaredSha256'])
    || !closedId(sourceArchive.artifactId)
    || !closedString(sourceArchive.path)
    || !sha256Hex(sourceArchive.declaredSha256)) return false;
  if (!exactKeys(target, ['artifactId', 'role', 'declaredDigest', 'observedDigest'])
    || !closedId(target.artifactId)
    || !PROJECT_STATUS_TRANSFER_ROLES_V1.includes(target.role)
    || !sha256Hex(target.declaredDigest)
    || (target.observedDigest !== null && !sha256Hex(target.observedDigest))) return false;
  return true;
}

function validQuarantine(value) {
  if (!exactKeys(value, ['schemaVersion', 'classification', 'entries'])) return false;
  if (value.schemaVersion !== PROJECT_STATUS_QUARANTINE_SCHEMA
    || value.classification !== PROJECT_STATUS_CLASSIFICATION
    || !isDenseArray(value.entries)) return false;
  let ok = true;
  for (const entry of value.entries) {
    if (!exactKeys(entry, ['itemId', 'reason', 'retainedEvidenceSha256', 'ownerRole'])
      || !closedId(entry.itemId) || !closedString(entry.reason)
      || !sha256Hex(entry.retainedEvidenceSha256)
      || !PROJECT_STATUS_RESPONSIBLE_ROLES_V1.includes(entry.ownerRole)) { ok = false; break; }
  }
  if (!ok) return false;
  const ids = value.entries.map(({ itemId }) => itemId);
  return ids.length === new Set(ids).size;
}

const PROBE_OUTCOMES_V1 = Object.freeze(['MATCH', 'MISMATCH', 'UNAVAILABLE']);

function validLifecycleObservation(value) {
  return exactKeys(value, ['installation', 'runtime', 'configuration', 'health'])
    && Object.values(value).every((probe) => PROBE_OUTCOMES_V1.includes(probe));
}

// PAN461 `classifyLifecycle` — the closed decision table, preserved. A decisive facet that
// was not observed yields UNKNOWN / PARTIALLY_INSTALLED; a version is never inferred.
function classifyLifecycle({ installation, runtime, configuration, health }, imageDrifted) {
  if (installation === 'UNAVAILABLE') {
    return { state: 'UNKNOWN', reason: 'installation facet unavailable; no installation identity inferred' };
  }
  if (imageDrifted) {
    return { state: 'LOCALLY_MODIFIED', reason: 'observed image generation drifted from the declared transfer target' };
  }
  if (runtime === 'UNAVAILABLE') {
    return { state: 'PARTIALLY_INSTALLED', reason: 'runtime facet unavailable; partial install, not inferred as running or stopped' };
  }
  if (configuration === 'UNAVAILABLE') {
    return { state: 'PARTIALLY_INSTALLED', reason: 'configuration facet unavailable; partial install, not inferred' };
  }
  if (runtime === 'MATCH' && configuration === 'MATCH') {
    return { state: 'RUNNING', reason: 'image, runtime and configuration generations matched the declared transfer target' };
  }
  if (runtime === 'MISMATCH') {
    if (health === 'UNAVAILABLE') {
      return { state: 'SLEEPING', reason: 'runtime stopped with no active health readback; image intact' };
    }
    return { state: 'STOPPED', reason: 'runtime stopped; image intact and health observable' };
  }
  return { state: 'PARTIALLY_INSTALLED', reason: 'configuration generation drifted from the declared transfer target' };
}

// ---------------------------------------------------------------------------
// The projection.
// ---------------------------------------------------------------------------
function projectStatus({
  declaration,
  observedScope,
  transfer,
  quarantine,
  lifecycleObservation,
  retainedComparisonRows,
  evidenceRevision,
  now,
  repoRoot,
}) {
  // The transfer SOURCE archive bytes are read by THIS module from the named file; the
  // caller's declared digest is never trusted. This is the one place a real byte-level
  // observation happens for the transfer facet, and it is reported as such.
  // AC02: a stale evidence revision cannot appear current. The observation carries its own
  // revision AND the digest of its own canonical body; both are re-derived here.
  if (observedScope.observedRevision !== evidenceRevision) {
    return {
      outcome: 'DENIED',
      code: 'PROJECT_STATUS_EVIDENCE_REVISION_STALE',
      observedRevision: observedScope.observedRevision,
      requestedEvidenceRevision: evidenceRevision,
    };
  }
  const derivedEvidenceSha256 = sha256(observedScopeBody(observedScope));
  if (derivedEvidenceSha256 !== observedScope.evidenceSha256) {
    return {
      outcome: 'DENIED',
      code: 'PROJECT_STATUS_OBSERVED_SCOPE_DIGEST_MISMATCH',
      declaredSha256: observedScope.evidenceSha256,
      derivedSha256: derivedEvidenceSha256,
    };
  }

  // A SOURCE_ARCHIVE is never an installable target and never transfer authority; a
  // transfer whose source carries an installable role is refused before any byte is read.
  if (transfer.sourceArchive.role !== 'SOURCE_ARCHIVE') {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_SOURCE_ARCHIVE_ROLE_INVALID' };
  }

  // The transfer SOURCE archive bytes are read by THIS module from the named file; the
  // caller's declared digest is never trusted. This is the one place a real byte-level
  // observation happens for the transfer facet, and it is reported as such.
  const archivePath = path.isAbsolute(transfer.sourceArchive.path)
    ? transfer.sourceArchive.path
    : path.resolve(repoRoot, transfer.sourceArchive.path);
  if (!existsSync(archivePath)) {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_SOURCE_ARCHIVE_UNREADABLE', file: archivePath };
  }
  const archiveBytes = readFileSync(archivePath);
  const observedSourceSha256 = bytesSha256(archiveBytes);
  if (observedSourceSha256 !== transfer.sourceArchive.declaredSha256) {
    return {
      outcome: 'DENIED',
      code: 'PROJECT_STATUS_SOURCE_ARCHIVE_BYTES_MISMATCH',
      declaredSha256: transfer.sourceArchive.declaredSha256,
      observedSha256: observedSourceSha256,
    };
  }

  const declarationById = new Map(declaration.ownedScope.map((item) => [item.scopeId, item]));
  const observationById = new Map(observedScope.scope.map((entry) => [entry.scopeId, entry]));
  const quarantinedIds = new Set(quarantine.entries.map(({ itemId }) => itemId));

  // AC01 per-scope coverage, with the four non-AVAILABLE states preserved verbatim.
  const scopeCoverage = declaration.ownedScope.map((item) => {
    const observed = observationById.get(item.scopeId);
    const quarantined = quarantinedIds.has(item.scopeId);
    const coverage = quarantined
      ? 'PARTIAL'
      : observed === undefined
        ? 'UNKNOWN'
        : observed.state;
    const observedCompleted = observed !== undefined && observed.state === 'AVAILABLE'
      ? observed.completedCount
      : null;
    const unavailableReason = quarantined
      ? 'QUARANTINED_ITEM'
      : observed === undefined
        ? 'NOT_OBSERVED_IN_CURRENT_EVIDENCE_REVISION'
        : observed.state === 'AVAILABLE'
          ? null
          : `OBSERVED_STATE_${observed.state}`;
    return {
      scopeId: item.scopeId,
      label: item.label,
      ownerRole: item.ownerRole,
      requiredCount: item.requiredCount,
      coverage,
      observedCompletedCount: observedCompleted,
      quarantined,
      unavailableReason,
    };
  });

  // Progress is DERIVED from observations only. An unobserved or non-available scope item
  // leaves the fraction UNAVAILABLE by name rather than contributing a zero.
  const denominatorTotal = declaration.ownedScope.reduce((sum, item) => sum + item.requiredCount, 0);
  const observableItems = scopeCoverage.filter((item) => !item.quarantined);
  const unavailableItems = observableItems.filter((item) => item.coverage !== 'AVAILABLE');
  const observedCompleted = observableItems
    .filter((item) => item.coverage === 'AVAILABLE')
    .reduce((sum, item) => sum + item.observedCompletedCount, 0);
  const progress = {
    unit: declaration.denominatorUnit,
    denominator: denominatorTotal,
    denominatorScope: declaration.ownedScope.map((item) => item.scopeId),
    quarantinedExcludedFromProgress: [...quarantinedIds],
    observedCompletedCount: unavailableItems.length === 0 ? observedCompleted : null,
    fraction: unavailableItems.length === 0 ? observedCompleted / denominatorTotal : null,
    fractionUnavailableReason: unavailableItems.length === 0
      ? null
      : `NON_AVAILABLE_SCOPE_ITEMS:${unavailableItems.map((item) => `${item.scopeId}=${item.coverage}`).join(',')}`,
    basis: 'OBSERVED_SCOPE_AT_CURRENT_EVIDENCE_REVISION',
  };

  // AC01 unknown outcomes + quarantine, each with its next responsible role.
  const unknownOutcomes = scopeCoverage
    .filter((item) => item.coverage !== 'AVAILABLE')
    .map((item) => ({
      itemId: item.scopeId,
      coverage: item.coverage,
      reason: item.unavailableReason,
      nextResponsibleRole: item.ownerRole,
    }));
  const quarantineEntries = quarantine.entries
    .map((entry) => ({
      itemId: entry.itemId,
      reason: entry.reason,
      retainedEvidenceSha256: entry.retainedEvidenceSha256,
      nextResponsibleRole: entry.ownerRole,
      includedInProgress: false,
    }))
    .sort((left, right) => left.itemId.localeCompare(right.itemId));

  // AC01 source/target identity. A SOURCE_ARCHIVE is never an installable target.
  const imageDrifted = transfer.target.observedDigest !== null
    && transfer.target.observedDigest !== transfer.target.declaredDigest;
  const targetInstallable = transfer.target.role === 'IMAGE'
    && transfer.target.observedDigest !== null
    && transfer.target.observedDigest === transfer.target.declaredDigest;
  const sourceArchive = {
    artifactId: transfer.sourceArchive.artifactId,
    role: transfer.sourceArchive.role,
    path: transfer.sourceArchive.path,
    declaredSha256: transfer.sourceArchive.declaredSha256,
    observedSha256: observedSourceSha256,
    matches: observedSourceSha256 === transfer.sourceArchive.declaredSha256,
    installable: false, // a SOURCE_ARCHIVE is NEVER an installable target
    byteObservation: 'READ_BY_THIS_MODULE_FROM_THE_NAMED_FILE',
  };
  const target = {
    artifactId: transfer.target.artifactId,
    role: transfer.target.role,
    declaredDigest: transfer.target.declaredDigest,
    observedDigest: transfer.target.observedDigest,
    generationValidity: transfer.target.observedDigest === null
      ? 'UNAVAILABLE'
      : imageDrifted ? 'DRIFTED' : 'MATCHED',
    installable: targetInstallable,
    byteObservation: 'AUTHORED_DECLARED_DIGEST_NOT_RE_READ',
  };

  const lifecycle = classifyLifecycle(lifecycleObservation, imageDrifted);
  const observationValidity = lifecycleObservation.installation !== 'UNAVAILABLE'
    && transfer.target.observedDigest !== null
    ? 'VALID'
    : 'DEGRADED';

  // The VERIFIED RESULT facet: the released comparison is actually executed and attested
  // here. A refusal is PRESERVED on the board as DENIED with its exact released code; it is
  // never deleted and never silently upgraded to a current number.
  let readback;
  if (retainedComparisonRows === undefined) {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_RELEASED_READBACK_INPUT_REQUIRED' };
  }
  const composed = composeReleasedNetRevenueComparison({ sourceRows: retainedComparisonRows });
  if (composed.outcome !== 'COMPOSED') {
    readback = {
      facet: 'RELEASED_NET_REVENUE_COMPARISON_ATTESTATION',
      coverage: 'DENIED',
      code: composed.code,
      reason: 'the released comparison refused the separately retained rows; the refusal is preserved and is not a number',
      attestationBasis: null,
      executed: false,
    };
  } else {
    const attested = attestReleasedNetRevenueComparison(composed.report);
    readback = attested.ok
      ? {
        facet: 'RELEASED_NET_REVENUE_COMPARISON_ATTESTATION',
        coverage: 'AVAILABLE',
        code: 'OK',
        attestationBasis: attested.basis,
        digest: attested.digest,
        sourceRowsSha256: attested.sourceRowsSha256,
        periodWindows: attested.periodWindows,
        executed: true,
        byteObservation: 'RELEASED_COMPARISON_EXECUTED_IN_THIS_PROCESS',
      }
      : {
        facet: 'RELEASED_NET_REVENUE_COMPARISON_ATTESTATION',
        coverage: 'DENIED',
        code: attested.code,
        reason: attested.reason ?? 'the released execution could not be attested',
        attestationBasis: null,
        executed: false,
      };
  }

  const openItems = [...unknownOutcomes, ...quarantineEntries.map((entry) => ({
    itemId: entry.itemId,
    coverage: 'PARTIAL',
    reason: `QUARANTINED:${entry.reason}`,
    nextResponsibleRole: entry.nextResponsibleRole,
  }))].sort((left, right) => left.itemId.localeCompare(right.itemId));

  const authority = {
    displayAuthority: 'READ_ONLY',
    writeAuthority: 'NOT_GRANTED',
    approvedActions: [],
    allowedActions: [PROJECT_STATUS_ALLOWED_ACTION],
    refusedAuthorityActions: [...PROJECT_STATUS_REFUSED_ACTIONS_V1],
    executesUpdate: false,
    executesRestore: false,
    executesMigration: false,
    executesTransfer: false,
    mutationCount: 0,
  };

  const coverage = [
    ...scopeCoverage.map((item) => ({
      subject: item.scopeId,
      subjectKind: 'SCOPE_ITEM',
      coverage: item.coverage,
      observedAt: 'CURRENT_EVIDENCE_REVISION',
    })),
    { subject: 'transfer-source-archive', subjectKind: 'TRANSFER_ARTIFACT', coverage: 'AVAILABLE', observedAt: 'CURRENT_EVIDENCE_REVISION' },
    { subject: 'transfer-target', subjectKind: 'TRANSFER_ARTIFACT', coverage: transfer.target.observedDigest === null ? 'UNKNOWN' : 'AVAILABLE', observedAt: 'CURRENT_EVIDENCE_REVISION' },
    { subject: readback.facet, subjectKind: 'RELEASED_READBACK', coverage: readback.coverage, observedAt: 'CURRENT_EVIDENCE_REVISION' },
  ];

  const binding = {
    schemaVersion: PROJECT_STATUS_SCHEMA,
    consumerContract: PROJECT_STATUS_CONSUMER_CONTRACT,
    classification: PROJECT_STATUS_CLASSIFICATION,
    trust: 'LOCAL_SYNTHETIC',
    now,
    evidenceRevision,
    observedScopeSha256: observedScope.evidenceSha256,
    projectId: declaration.projectId,
    sourceArchiveSha256: observedSourceSha256,
    targetDeclaredDigest: transfer.target.declaredDigest,
    targetObservedDigest: transfer.target.observedDigest,
    lifecycleState: lifecycle.state,
    denominator: denominatorTotal,
    quarantineDigest: sha256(quarantine.entries),
    readbackCode: readback.code,
    readbackDigest: readback.digest ?? null,
    producerReference: [
      { surface: 'pan461/lifecycle-inventory', candidateCommit: '46922f077697c22adae8fab7204a19b9922abcd7', status: 'RETAINED_LOCAL_CANDIDATE_NOT_RELEASED' },
      { surface: 'pan471/capability-inventory', candidateCommit: '90cb8d06dc642586f6b9295fbe66bce81b7b5a76', status: 'RETAINED_LOCAL_CANDIDATE_NOT_RELEASED' },
    ],
  };

  return {
    outcome: 'PROJECTED',
    code: 'OK',
    schemaVersion: PROJECT_STATUS_SCHEMA,
    consumerContract: PROJECT_STATUS_CONSUMER_CONTRACT,
    classification: PROJECT_STATUS_CLASSIFICATION,
    trust: 'LOCAL_SYNTHETIC',
    now,
    executionFacets: {
      executed: ['RELEASED_NET_REVENUE_COMPARISON_ATTESTATION'],
      authoredAndBound: [
        'PROJECT_DECLARATION',
        'OBSERVED_SCOPE_INVENTORY',
        'LIFECYCLE_OBSERVATION',
        'TRANSFER_TARGET_DECLARATION',
        'QUARANTINE_INVENTORY',
      ],
      disclosure: 'Only the released comparison attestation is executed. Every other facet is an AUTHORED, BOUND, LOCAL-SYNTHETIC declaration, not a product execution and not a real host probe.',
    },
    projectIdentity: {
      projectId: declaration.projectId,
      projectLabel: declaration.projectLabel,
      ownedScope: declaration.ownedScope.map((item) => item.scopeId),
      evidenceRevision,
    },
    lifecycle: {
      state: lifecycle.state,
      reason: lifecycle.reason,
      observationValidity,
      probe: { ...lifecycleObservation },
      auditedBy: 'AUTHORED_BOUND_LIFECYCLE_OBSERVATION',
    },
    transfer: { sourceArchive, target },
    progress,
    scopeCoverage,
    unknownOutcomes,
    quarantine: quarantineEntries,
    openItems,
    nextResponsibleRole: openItems.length > 0 ? openItems[0].nextResponsibleRole : 'NONE_OPEN',
    coverage,
    readback,
    authority,
    secretValuesExported: false,
    rawPersonPayloadsIncluded: false,
    referenceMarker: REFERENCE_MARKER,
    binding,
    bindingDigest: sha256(binding),
    nonClaims: [...PROJECT_STATUS_NONCLAIMS],
  };
}

/**
 * Public read-only entry point.
 *
 * `declaredProject`, `observedScope`, `transfer`, `quarantine`, `lifecycleObservation`,
 * `retainedComparisonRows`, `evidenceRevision` and `now` are all REQUIRED: nothing has a
 * default and no fixture is adopted implicitly (a caller that wants a fixture must name
 * it). `requestedAction` defaults to the only permitted action, `READ_STATUS`; any
 * mutating action is refused by name (AC03).
 */
export function createProjectLifecycleTransferStatus({
  declaredProject,
  observedScope,
  transfer,
  quarantine,
  lifecycleObservation,
  retainedComparisonRows,
  evidenceRevision,
  now,
  requestedAction = PROJECT_STATUS_ALLOWED_ACTION,
  repoRoot = null,
} = {}) {
  const missing = [];
  if (declaredProject === undefined) missing.push('declaredProject');
  if (observedScope === undefined) missing.push('observedScope');
  if (transfer === undefined) missing.push('transfer');
  if (quarantine === undefined) missing.push('quarantine');
  if (lifecycleObservation === undefined) missing.push('lifecycleObservation');
  if (retainedComparisonRows === undefined) missing.push('retainedComparisonRows');
  if (!closedString(evidenceRevision)) missing.push('evidenceRevision');
  if (!closedString(now)) missing.push('now');
  if (missing.length > 0) {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_INPUT_REQUIRED', missing };
  }

  // AC03: the display refuses a mutating escalation BEFORE it reads anything.
  if (requestedAction !== PROJECT_STATUS_ALLOWED_ACTION) {
    if (PROJECT_STATUS_REFUSED_ACTIONS_V1.includes(requestedAction)) {
      return {
        outcome: 'DENIED',
        code: 'PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED',
        requestedAction,
        grantedAuthority: 'READ_ONLY',
        executed: false,
        mutationCount: 0,
      };
    }
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_UNKNOWN_AUTHORITY_ACTION', requestedAction };
  }

  // Everything below is fail-closed: a hostile input whose own property access throws is
  // reported as a projection failure rather than escaping as an uncaught exception.
  try {
    for (const input of [declaredProject, observedScope, transfer, quarantine, lifecycleObservation]) {
      const forbidden = refuseForbiddenPayload(input);
      if (forbidden) return forbidden;
    }

    if (!validDeclaration(declaredProject)) return { outcome: 'DENIED', code: 'PROJECT_STATUS_DECLARATION_MALFORMED' };
    if (!validObservedScope(observedScope)) return { outcome: 'DENIED', code: 'PROJECT_STATUS_OBSERVED_SCOPE_MALFORMED' };
    if (!validTransfer(transfer)) return { outcome: 'DENIED', code: 'PROJECT_STATUS_TRANSFER_MALFORMED' };
    if (!validQuarantine(quarantine)) return { outcome: 'DENIED', code: 'PROJECT_STATUS_QUARANTINE_MALFORMED' };
    if (!validLifecycleObservation(lifecycleObservation)) {
      return { outcome: 'DENIED', code: 'PROJECT_STATUS_OBSERVED_SCOPE_MALFORMED' };
    }
    if (!isDenseArray(retainedComparisonRows)) {
      return { outcome: 'DENIED', code: 'PROJECT_STATUS_RELEASED_READBACK_INPUT_REQUIRED' };
    }
    return projectStatus({
      declaration: declaredProject,
      observedScope,
      transfer,
      quarantine,
      lifecycleObservation,
      retainedComparisonRows,
      evidenceRevision,
      now,
      repoRoot: repoRoot ?? process.cwd(),
    });
  } catch (error) {
    // A projection failure is reported as ITSELF, never relabelled as a malformed input.
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_PROJECTION_FAILED', message: String(error?.message ?? error) };
  }
}

/**
 * Mandatory content-bound re-binding after serialization (anti-substitution).
 *
 * The consumer carries the serialized status + `bindingDigest` plus the independently
 * retained inputs — the authored declaration, the observed scope bytes, the transfer
 * declaration, the quarantine inventory, the lifecycle observation, the retained
 * comparison rows, the evidence revision and the decision time. The released comparison is
 * RE-EXECUTED against those inputs here, and the freshly derived binding must match the
 * carried one exactly. A substituted evidence revision, a resealed observed-scope body, or
 * a swapped retained-rows set no longer re-derives and is refused: stale or substituted
 * evidence can never appear current.
 */
export function rebindProjectLifecycleTransferStatus({
  declaredProject,
  observedScope,
  transfer,
  quarantine,
  lifecycleObservation,
  retainedComparisonRows,
  evidenceRevision,
  now,
  status,
  bindingDigest,
  repoRoot = null,
} = {}) {
  if (!isRecord(status) || !sha256Hex(bindingDigest)) {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_SERIALIZED_BINDING_MALFORMED' };
  }
  const fresh = createProjectLifecycleTransferStatus({
    declaredProject,
    observedScope,
    transfer,
    quarantine,
    lifecycleObservation,
    retainedComparisonRows,
    evidenceRevision,
    now,
    repoRoot,
  });
  if (fresh.outcome !== 'PROJECTED') {
    return { outcome: 'DENIED', code: fresh.code ?? 'PROJECT_STATUS_SERIALIZED_EVIDENCE_MISMATCH', detail: fresh };
  }
  if (fresh.bindingDigest !== bindingDigest) {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH', expected: bindingDigest, derived: fresh.bindingDigest };
  }
  if (fresh.bindingDigest !== sha256(status.binding)) {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_SERIALIZED_EVIDENCE_MISMATCH', expected: bindingDigest, derived: sha256(status.binding) };
  }
  return {
    outcome: 'REBOUND',
    code: 'OK',
    bindingDigest: fresh.bindingDigest,
    lifecycleState: fresh.lifecycle.state,
    readbackCoverage: fresh.readback.coverage,
  };
}

// ---------------------------------------------------------------------------
// Rendering (JSON + TABLE only; this is a status board, not a dashboard engine).
// ---------------------------------------------------------------------------
const HEADER = Object.freeze(['section', 'subject', 'state', 'value', 'next_role']);

function statusRows(status) {
  const rows = [];
  rows.push(['identity', status.projectIdentity.projectId, 'DECLARED', status.projectIdentity.projectLabel, 'NONE_OPEN']);
  rows.push(['lifecycle', status.projectIdentity.projectId, status.lifecycle.state, status.lifecycle.reason, status.nextResponsibleRole]);
  rows.push(['transfer-source', status.transfer.sourceArchive.artifactId, status.transfer.sourceArchive.matches ? 'MATCHED' : 'DRIFTED', status.transfer.sourceArchive.role, status.nextResponsibleRole]);
  rows.push(['transfer-target', status.transfer.target.artifactId, status.transfer.target.generationValidity, status.transfer.target.installable ? 'INSTALLABLE' : 'NOT_INSTALLABLE', status.nextResponsibleRole]);
  rows.push(['progress', status.projectIdentity.projectId,
    status.progress.fraction === null ? 'UNAVAILABLE' : 'OBSERVED',
    `${status.progress.observedCompletedCount === null ? 'UNKNOWN' : status.progress.observedCompletedCount}/${status.progress.denominator} ${status.progress.unit}`,
    status.nextResponsibleRole]);
  for (const item of status.scopeCoverage) {
    rows.push(['scope', item.scopeId, item.coverage,
      item.observedCompletedCount === null ? 'unknown' : String(item.observedCompletedCount),
      item.ownerRole]);
  }
  for (const entry of status.quarantine) {
    rows.push(['quarantine', entry.itemId, 'PARTIAL', entry.reason, entry.nextResponsibleRole]);
  }
  rows.push(['readback', status.readback.facet, status.readback.coverage, status.readback.code, status.nextResponsibleRole]);
  rows.push(['authority', 'display', status.authority.displayAuthority, `write=${status.authority.writeAuthority}`, 'NONE_OPEN']);
  return rows;
}

function renderJson(status) {
  return `${JSON.stringify(status, null, 2)}\n`;
}

function renderTable(status) {
  const rows = statusRows(status);
  const widths = HEADER.map((cell, index) =>
    Math.max(cell.length, ...rows.map((row) => String(row[index]).length)));
  const line = (cells) =>
    cells.map((cell, index) => String(cell).padEnd(widths[index])).join('  ').trimEnd();
  const separator = widths.map((width) => '-'.repeat(width)).join('  ');
  return [
    line(HEADER),
    separator,
    ...rows.map(line),
    '',
    `bindingDigest=${status.bindingDigest}`,
    `authority=READ_ONLY writeAuthority=${status.authority.writeAuthority} mutationCount=${status.authority.mutationCount}`,
    `secretValuesExported=${status.secretValuesExported} rawPersonPayloadsIncluded=${status.rawPersonPayloadsIncluded}`,
    '',
  ].join('\n');
}

export function renderProjectLifecycleTransferStatus(status, format = 'JSON') {
  if (!PROJECT_STATUS_FORMATS.includes(format)) {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_FORMAT_UNSUPPORTED', format };
  }
  if (!isRecord(status) || status.outcome !== 'PROJECTED') {
    return { outcome: 'DENIED', code: 'PROJECT_STATUS_SERIALIZED_BINDING_MALFORMED' };
  }
  return {
    outcome: 'RENDERED',
    code: 'OK',
    format,
    text: format === 'TABLE' ? renderTable(status) : renderJson(status),
  };
}

export function formatProjectStatusDenial(error) {
  if (isRecord(error) && typeof error.code === 'string') return error.code;
  if (error instanceof Error && typeof error.message === 'string') return error.message;
  return 'PROJECT_STATUS_DENIED';
}

// Exported for the suite and for the CLI's own closed shape checks.
export const PROJECT_STATUS_INTERNALS = Object.freeze({
  scanForForbiddenPayload,
  observedScopeBody,
  classifyLifecycle,
  statusRows,
  validDeclaration,
  validObservedScope,
  validTransfer,
  validQuarantine,
  validLifecycleObservation,
  normalisedKey,
  isRecord,
  exactKeys,
  canonicalJson,
});
