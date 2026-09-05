#!/usr/bin/env node
// XRA-KS-01 / service clean room.
// Deterministic, network-free, write-free local evidence for the projection
// ingestion pipeline: one positive synthetic-DI run (proven twice, oracle
// readback EXACT) and the fail-closed adversarial cases. The live release
// registry remains HELD; the exact released PANSPHAIRA projection is not
// ingested, and no public closure is claimed. TIMEOUT is exercised at the
// service boundary by tests/pansphaira-analytics-service.test.mjs.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import { ANALYSIS_ID, ANALYSIS_VERSION } from '../services/bi-agent/src/pansphaira-analytics/analysis.mjs';
import {
  buildEnvironmentIdentity,
  verifyAuthorityFreeCandidate,
} from '../services/bi-agent/src/pansphaira-analytics/candidate.mjs';
import {
  REGISTRY_ISSUE,
  REGISTRY_SCHEMA,
  ingestProjectionProfile,
  validateRegistry,
} from '../services/bi-agent/src/pansphaira-analytics/pipeline.mjs';

export const ISSUE_ID = 'XRA-KS-01';
export const TASK_ID = 'XRA-KS-01-SERVICE-CLEAN-ROOM';
export const ROOT = path.resolve(import.meta.dirname, '..');
export const FIXTURE_PATH = 'tests/pansphaira-analytics-synthetic-profile-v1.json';
export const PROJECTION_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/projection-profile.v1.json';
export const ANALYSIS_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/analysis.v1.json';
export const RELEASE_REGISTRY_PATH = 'contracts/pansphaira-analytics/v1/release-registry.v1.json';

// Five pipeline-level cases run here; TIMEOUT is service-boundary-only.
export const PIPELINE_ADVERSARIAL_CASE_IDS = Object.freeze([
  'FORGED_EDGE',
  'SUBSTITUTED_PROJECTION',
  'MISSING_EVIDENCE',
  'UNKNOWN_COLLAPSE',
  'UNSUPPORTED_PROFILE',
]);
export const ADVERSARIAL_CASE_IDS = Object.freeze([...PIPELINE_ADVERSARIAL_CASE_IDS, 'TIMEOUT']);
export const EXPECTED_DENIAL_CODES = Object.freeze({
  FORGED_EDGE: 'XRA_KS01_PROVENANCE_FORGERY_DENIED',
  SUBSTITUTED_PROJECTION: 'XRA_KS01_PROFILE_DIGEST_MISMATCH_DENIED',
  MISSING_EVIDENCE: 'XRA_KS01_EVIDENCE_MISSING_DENIED',
  UNKNOWN_COLLAPSE: 'XRA_KS01_UNKNOWN_COLLAPSE_DENIED',
  UNSUPPORTED_PROFILE: 'XRA_KS01_PROFILE_CONTRACT_DENIED',
  TIMEOUT: 'XRA_KS01_TIMEOUT_DENIED',
  RELEASE_HELD: 'XRA_KS01_RELEASE_HELD',
});

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

export function loadFrozenInputs() {
  return {
    fixtureBytes: readFileSync(path.join(ROOT, FIXTURE_PATH)),
    projectionContractBytes: readFileSync(path.join(ROOT, PROJECTION_CONTRACT_PATH)),
    analysisContractBytes: readFileSync(path.join(ROOT, ANALYSIS_CONTRACT_PATH)),
    releaseRegistryBytes: readFileSync(path.join(ROOT, RELEASE_REGISTRY_PATH)),
    packageBytes: readFileSync(path.join(ROOT, 'package.json')),
    canonicalJsonBytes: readFileSync(path.join(ROOT, 'services/bi-control/src/canonical-json.js')),
  };
}

export function gitHead(ref) {
  const result = spawnSync('git', ['rev-parse', ref], { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error('XRA_KS01_GIT_HEAD_UNRESOLVED');
  return result.stdout.trim();
}

export function createCleanRoomContext(inputs) {
  const heads = { commitOid: gitHead('HEAD'), treeOid: gitHead('HEAD^{tree}') };
  const environmentIdentity = buildEnvironmentIdentity({
    nodeVersion: process.version,
    nodeModulesAbi: process.versions.modules,
    platform: process.platform,
    architecture: process.arch,
    canonicalJsonBytes: inputs.canonicalJsonBytes,
    packageBytes: inputs.packageBytes,
  });
  return {
    registry: validateRegistry(JSON.parse(inputs.releaseRegistryBytes.toString('utf8'))),
    heads,
    environment: environmentIdentity.environment,
    environmentSha256: environmentIdentity.environmentSha256,
    projectionContractBytes: Buffer.from(inputs.projectionContractBytes),
    analysisContractBytes: Buffer.from(inputs.analysisContractBytes),
  };
}

// Synthetic DI registry: proves the admission/analysis/candidate/verifier
// machinery against exactly one synthetic released variant. It is not the
// release registry and is not public closure evidence.
export function buildSyntheticDiRegistry(releasedCanonicalBytes, fixture) {
  return {
    schemaVersion: REGISTRY_SCHEMA,
    issue: REGISTRY_ISSUE,
    admissionRule: 'SYNTHETIC_DI_ONLY: admits exactly the one synthetic released variant for deterministic machinery proof; it is not public closure evidence.',
    entries: [
      {
        releaseId: 'xra-ps-01-synthetic-di',
        status: 'RELEASED',
        profileSha256: sha256hex(releasedCanonicalBytes),
        releaseReceiptSha256: fixture.releasedVariant.provenance.releaseReceiptSha256,
        pansphairaHeadCommit: fixture.releasedVariant.provenance.pansphairaHeadCommit,
        publicClosureEvidence: fixture.syntheticRegistryEvidence.publicClosureEvidence,
      },
    ],
    nonclaim: 'Synthetic DI registry for deterministic machinery proof only. It does not register the exact released PANSPHAIRA projection and is not public closure evidence for XRA-PS-01.',
  };
}

export function buildAdversarialBytes(fixture) {
  const clone = (object) => structuredClone(object);
  const substituted = clone(fixture.releasedVariant);
  substituted.fields[3].name = 'record_kinde';
  const forged = clone(fixture.releasedVariant);
  forged.provenance.releaseReceiptSha256 = 'f'.repeat(64);
  const missingEvidence = clone(fixture.releasedVariant);
  missingEvidence.provenance.releaseReceiptSha256 = null;
  const unknownCollapse = clone(fixture.heldProfile);
  unknownCollapse.unknownHandling = 'ZERO_COLLAPSE';
  const unsupported = clone(fixture.heldProfile);
  unsupported.profileVersion = 'pansphaira/projection-profile/v2';
  return {
    FORGED_EDGE: Buffer.from(canonicalJson(forged)),
    SUBSTITUTED_PROJECTION: Buffer.from(canonicalJson(substituted)),
    MISSING_EVIDENCE: Buffer.from(canonicalJson(missingEvidence)),
    UNKNOWN_COLLAPSE: Buffer.from(canonicalJson(unknownCollapse)),
    UNSUPPORTED_PROFILE: Buffer.from(canonicalJson(unsupported)),
  };
}

// Independent oracle: recomputes every computed claim from the raw profile
// with its own inline canonicalization. Imports no analysis, pipeline,
// candidate, or service module.
function independentCanonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) throw new Error('oracle rejects non-integer numbers');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(independentCanonical).join(',')}]`;
  const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${independentCanonical(value[key])}`);
  return `{${entries.join(',')}}`;
}

export function oracleComputedClaims(profile) {
  const fields = profile.fields;
  const [sy, sm, sd] = profile.periodWindow.start.split('-').map(Number);
  const [ey, em, ed] = profile.periodWindow.end.split('-').map(Number);
  const dateFieldCount = fields.filter((field) => field.type === 'DATE' || field.type === 'TIMESTAMP').length;
  return {
    fieldCount: fields.length,
    dateFieldCount,
    decimalFieldCount: fields.filter((field) => field.type === 'DECIMAL').length,
    nullableFieldCount: fields.filter((field) => field.nullable === true).length,
    periodDays: Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000) + 1,
    projectionSignatureSha256: sha256hex(independentCanonical(fields)),
    periodEvaluability: dateFieldCount >= 1 ? 'SUPPORTED' : 'UNKNOWN',
  };
}

export function runPositiveRun(inputs, contextLike) {
  const fixture = JSON.parse(inputs.fixtureBytes.toString('utf8'));
  const releasedCanonical = Buffer.from(canonicalJson(structuredClone(fixture.releasedVariant)));
  const registry = buildSyntheticDiRegistry(releasedCanonical, fixture);
  const result = ingestProjectionProfile(Buffer.from(releasedCanonical), { ...contextLike, registry });
  if (result.state !== 'CANDIDATE') throw new Error(`positive run denied: ${result.code}`);
  verifyAuthorityFreeCandidate(result.candidate, {
    profileBytes: Buffer.from(releasedCanonical),
    projectionContractBytes: contextLike.projectionContractBytes,
    analysisContractBytes: contextLike.analysisContractBytes,
    registry,
    heads: contextLike.heads,
    environment: contextLike.environment,
    environmentSha256: contextLike.environmentSha256,
  });
  const oracle = oracleComputedClaims(fixture.releasedVariant);
  const oracleEquality = canonicalJson(result.candidate.claims.computed) === canonicalJson(oracle) ? 'EXACT' : 'MISMATCH';
  const evidence = {
    admission: 'SYNTHETIC_DI_REGISTRY_ONLY',
    requestSha256: result.requestSha256,
    candidate: result.candidate,
  };
  return { result, evidence, evidenceSha256: sha256hex(canonicalJson(evidence)), oracle, oracleEquality };
}

export function runAdversarialCase(caseId, inputs, contextLike) {
  const fixture = JSON.parse(inputs.fixtureBytes.toString('utf8'));
  const bytes = buildAdversarialBytes(fixture)[caseId];
  const registry = caseId === 'SUBSTITUTED_PROJECTION'
    ? buildSyntheticDiRegistry(Buffer.from(canonicalJson(structuredClone(fixture.releasedVariant))), fixture)
    : contextLike.registry;
  return ingestProjectionProfile(Buffer.from(bytes), { ...contextLike, registry });
}

function assertFailClosed(result, caseId) {
  if (result.state !== 'DENIED' || result.candidate !== null || result.ordinaryAnswer !== null || result.successfulOrdinaryAnswer !== false) {
    throw new Error(`case ${caseId} did not fail closed`);
  }
  if (!/^[a-f0-9]{64}$/.test(result.denialSha256)) throw new Error(`case ${caseId} denial digest malformed`);
  const { denialSha256, ...rest } = result;
  if (sha256hex(canonicalJson(rest)) !== denialSha256) throw new Error(`case ${caseId} denial digest mismatch`);
  if (result.code !== EXPECTED_DENIAL_CODES[caseId]) throw new Error(`case ${caseId} code ${result.code}`);
}

export function buildCleanRoomEvidence(inputs, contextLike) {
  const fixture = JSON.parse(inputs.fixtureBytes.toString('utf8'));
  const first = runPositiveRun(inputs, contextLike);
  const second = runPositiveRun(inputs, contextLike);
  const deterministic = canonicalJson(first.evidence) === canonicalJson(second.evidence);
  if (!deterministic) throw new Error('positive runs are not deterministic');
  if (first.oracleEquality !== 'EXACT') throw new Error('oracle readback is not EXACT');

  const adversarial = [];
  for (const caseId of PIPELINE_ADVERSARIAL_CASE_IDS) {
    const firstDenial = runAdversarialCase(caseId, inputs, contextLike);
    const secondDenial = runAdversarialCase(caseId, inputs, contextLike);
    assertFailClosed(firstDenial, caseId);
    if (canonicalJson(firstDenial) !== canonicalJson(secondDenial)) throw new Error(`case ${caseId} denial not deterministic`);
    adversarial.push({
      ordinal: adversarial.length + 1,
      id: caseId,
      status: 'PASS',
      observedState: 'DENIED',
      code: firstDenial.code,
      deterministic: true,
      ordinaryAnswer: null,
      result: null,
      successfulOrdinaryAnswer: false,
    });
  }
  adversarial.push({
    ordinal: adversarial.length + 1,
    id: 'TIMEOUT',
    status: 'SERVICE_BOUNDARY_ONLY',
    observedState: null,
    code: EXPECTED_DENIAL_CODES.TIMEOUT,
    deterministic: null,
    ordinaryAnswer: null,
    result: null,
    successfulOrdinaryAnswer: false,
  });

  const heldReal = ingestProjectionProfile(Buffer.from(canonicalJson(structuredClone(fixture.heldProfile))), contextLike);
  const releasedReal = ingestProjectionProfile(Buffer.from(canonicalJson(structuredClone(fixture.releasedVariant))), contextLike);
  assertFailClosed(heldReal, 'RELEASE_HELD');
  // The released variant is not attested by the real HELD registry, so the
  // forgery gate (upstream of release-held in the declared gate order) fires
  // first. Both fixture variants are denied by the real registry.
  assertFailClosed(releasedReal, 'FORGED_EDGE');

  const releasedEntryCount = contextLike.registry.entries.filter((entry) => entry.status === 'RELEASED').length;
  if (releasedEntryCount !== 0) throw new Error('real release registry must remain HELD');

  return {
    issue: ISSUE_ID,
    taskId: TASK_ID,
    heads: contextLike.heads,
    environmentSha256: contextLike.environmentSha256,
    analysis: { id: ANALYSIS_ID, version: ANALYSIS_VERSION, count: 1 },
    realRegistry: {
      status: 'HELD',
      entryCount: contextLike.registry.entries.length,
      releasedEntryCount: 0,
      heldProfileDenial: { code: heldReal.code, denialSha256: heldReal.denialSha256 },
      releasedVariantDenial: { code: releasedReal.code, denialSha256: releasedReal.denialSha256 },
    },
    positive: {
      admission: first.evidence.admission,
      evidenceSha256: first.evidenceSha256,
      evidenceByteLength: Buffer.byteLength(canonicalJson(first.evidence)),
      deterministic: true,
      oracleEquality: 'EXACT',
      verifierState: 'VERIFIED',
    },
    adversarial,
    boundary: {
      canonicalInputsMutated: false,
      realProjectionIngested: false,
      networkUsed: false,
      pushPerformed: false,
      releasePerformed: false,
      issueClosed: false,
      publicClosureClaimed: false,
    },
  };
}

const SELF_PATH = fileURLToPath(import.meta.url);

// The module is import-safe (tests/pansphaira-analytics-service.test.mjs
// consumes the exported helpers); the CLI evidence run only happens when the
// script is executed directly.
if (process.argv[1] && path.resolve(process.argv[1]) === SELF_PATH) {
  const caseArg = process.argv.includes('--case')
    ? process.argv[process.argv.indexOf('--case') + 1]
    : null;

  const inputs = loadFrozenInputs();
  const contextLike = createCleanRoomContext(inputs);

  if (caseArg !== null) {
    if (!PIPELINE_ADVERSARIAL_CASE_IDS.includes(caseArg)) {
      console.error(`XRA_KS01_UNKNOWN_CASE ${caseArg}`);
      process.exit(2);
    }
    const denial = runAdversarialCase(caseArg, inputs, contextLike);
    assertFailClosed(denial, caseArg);
    console.log(JSON.stringify(denial, null, 2));
    process.exit(2);
  }

  const evidence = buildCleanRoomEvidence(inputs, contextLike);
  console.log(JSON.stringify(evidence, null, 2));
  process.exit(0);
}