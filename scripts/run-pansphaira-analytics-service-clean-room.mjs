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
import {
  ingestNativeProjection,
  validateNativeSidecar,
} from '../services/bi-agent/src/pansphaira-analytics/native-pipeline.mjs';
import { verifyNativeAuthorityFreeCandidate } from '../services/bi-agent/src/pansphaira-analytics/native-candidate.mjs';

export const ISSUE_ID = 'XRA-KS-01';
export const TASK_ID = 'XRA-KS-01-SERVICE-CLEAN-ROOM';
export const ROOT = path.resolve(import.meta.dirname, '..');
export const FIXTURE_PATH = 'tests/pansphaira-analytics-synthetic-profile-v1.json';
export const PROJECTION_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/projection-profile.v1.json';
export const ANALYSIS_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/analysis.v1.json';
export const RELEASE_REGISTRY_PATH = 'contracts/pansphaira-analytics/v1/release-registry.v1.json';
export const NATIVE_FIXTURE_PATH = 'tests/pansphaira-analytics-native-released-fixture.json';
export const NATIVE_PROJECTION_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/native-projection.v1.json';
export const NATIVE_ANALYSIS_CONTRACT_PATH = 'contracts/pansphaira-analytics/v1/edge-evidence-analysis.v1.json';
export const NATIVE_RELEASE_SIDECAR_PATH = 'contracts/pansphaira-analytics/v1/native-release-registry.v1.json';
export const NATIVE_RECEIPT_FIXTURE_PATH = 'tests/pansphaira-analytics-native-source-receipt.json';
// The later byte-equivalent head the controller observed for the named release.
// It is NOT in the receipt (the receipt records the named release's resolved
// commit); it is an independently-supplied trusted pin, distinct from the
// named release's resolved commit.
const NATIVE_TRUSTED_HEAD_COMMIT = '988395110a9189d1b8cd4ee98184ed5c1d77a15d';

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

// Native pipeline-level fail-closed cases (TIMEOUT is service-boundary-only, as
// for the relational slice). The re-digested forgery is self-consistent yet
// denied; authority widening is denied, never coerced.
export const NATIVE_PIPELINE_ADVERSARIAL_CASE_IDS = Object.freeze([
  'FORGED_EDGE',
  'SUBSTITUTED_PROJECTION',
  'MISSING_EVIDENCE',
  'UNKNOWN_COLLAPSE',
  'UNSUPPORTED_PROFILE',
  'AUTHORITY_WIDENING',
  'REDIGESTED_FORGERY',
]);
export const NATIVE_EXPECTED_DENIAL_CODES = Object.freeze({
  FORGED_EDGE: 'XRA_KS01_NATIVE_PROVENANCE_FORGERY_DENIED',
  SUBSTITUTED_PROJECTION: 'XRA_KS01_NATIVE_DIGEST_MISMATCH_DENIED',
  MISSING_EVIDENCE: 'XRA_KS01_NATIVE_EVIDENCE_MISSING_DENIED',
  UNKNOWN_COLLAPSE: 'XRA_KS01_NATIVE_UNKNOWN_COLLAPSE_DENIED',
  UNSUPPORTED_PROFILE: 'XRA_KS01_NATIVE_CONTRACT_DENIED',
  AUTHORITY_WIDENING: 'XRA_KS01_NATIVE_AUTHORITY_DENIED',
  REDIGESTED_FORGERY: 'XRA_KS01_NATIVE_CONTRACT_DENIED',
  TIMEOUT: 'XRA_KS01_TIMEOUT_DENIED',
});

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

export function loadFrozenInputs() {
  return {
    fixtureBytes: readFileSync(path.join(ROOT, FIXTURE_PATH)),
    projectionContractBytes: readFileSync(path.join(ROOT, PROJECTION_CONTRACT_PATH)),
    analysisContractBytes: readFileSync(path.join(ROOT, ANALYSIS_CONTRACT_PATH)),
    releaseRegistryBytes: readFileSync(path.join(ROOT, RELEASE_REGISTRY_PATH)),
    nativeFixtureBytes: readFileSync(path.join(ROOT, NATIVE_FIXTURE_PATH)),
    nativeProjectionContractBytes: readFileSync(path.join(ROOT, NATIVE_PROJECTION_CONTRACT_PATH)),
    nativeAnalysisContractBytes: readFileSync(path.join(ROOT, NATIVE_ANALYSIS_CONTRACT_PATH)),
    nativeSidecarBytes: readFileSync(path.join(ROOT, NATIVE_RELEASE_SIDECAR_PATH)),
    nativeReceiptBytes: readFileSync(path.join(ROOT, NATIVE_RECEIPT_FIXTURE_PATH)),
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
    nativeSidecar: validateNativeSidecar(JSON.parse(inputs.nativeSidecarBytes.toString('utf8')), inputs.nativeReceiptBytes),
    nativeProjectionContractBytes: Buffer.from(inputs.nativeProjectionContractBytes),
    nativeAnalysisContractBytes: Buffer.from(inputs.nativeAnalysisContractBytes),
    nativeSidecarBytes: Buffer.from(inputs.nativeSidecarBytes),
    nativeReceiptBytes: Buffer.from(inputs.nativeReceiptBytes),
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

// --- KS151-NATIVE-PROJECTION-01: separately versioned native pipeline ---

// The exact released native fixture is the wire form; every variant deviates
// from the frozen subjects or provenance and is denied, never coerced. The
// re-digested forgery recomputes its own body digest so it is self-consistent
// yet still denied (frozen-subject shape gate, upstream of any digest gate).
export function buildNativeAdversarialBytes(fix) {
  const clone = (object) => structuredClone(object);
  const recomputeDigest = (projection) => {
    const body = {};
    for (const [key, value] of Object.entries(projection)) if (key !== 'projectionDigest') body[key] = value;
    projection.projectionDigest = sha256hex(Buffer.from(canonicalJson(body)));
  };
  const forged = clone(fix);
  forged.source.contractSha256 = 'f'.repeat(64);
  const substituted = clone(fix);
  substituted.edges[0].evidenceSha256 = sha256hex(Buffer.from('ks01-substituted-edge-evidence'));
  recomputeDigest(substituted);
  const missingEvidence = clone(fix);
  missingEvidence.edges[0].evidence = [];
  recomputeDigest(missingEvidence);
  const unknownCollapse = clone(fix);
  unknownCollapse.nodes[0].unknown = true;
  recomputeDigest(unknownCollapse);
  const unsupported = clone(fix);
  unsupported.purpose = 'PANSPHAIRA_UNSUPPORTED_PURPOSE';
  recomputeDigest(unsupported);
  const authorityWidening = clone(fix);
  authorityWidening.authority = 'PROMOTED';
  recomputeDigest(authorityWidening);
  const redigested = clone(fix);
  redigested.nodes[0].kind = 'DECISION';
  recomputeDigest(redigested);
  return {
    FORGED_EDGE: Buffer.from(canonicalJson(forged)),
    SUBSTITUTED_PROJECTION: Buffer.from(canonicalJson(substituted)),
    MISSING_EVIDENCE: Buffer.from(canonicalJson(missingEvidence)),
    UNKNOWN_COLLAPSE: Buffer.from(canonicalJson(unknownCollapse)),
    UNSUPPORTED_PROFILE: Buffer.from(canonicalJson(unsupported)),
    AUTHORITY_WIDENING: Buffer.from(canonicalJson(authorityWidening)),
    REDIGESTED_FORGERY: Buffer.from(canonicalJson(redigested)),
  };
}

// Independent oracle: recomputes every native computed claim inline from the
// raw fixture; it does not reuse the native analysis code path.
export function oracleNativeComputedClaims(nativeFixture) {
  const nodes = nativeFixture.nodes;
  const edge = nativeFixture.edges[0];
  const unknownTotal = nodes.reduce((sum, node) => sum + (node.unknown === true ? 1 : 0), 0)
    + nativeFixture.edges.reduce((sum, item) => sum + (item.unknown === true ? 1 : 0), 0);
  const counterevidenceTotal = nodes.reduce((sum, node) => sum + node.counterevidence.length, 0)
    + nativeFixture.edges.reduce((sum, item) => sum + item.counterevidence.length, 0);
  return {
    nodeCount: nodes.length,
    edgeCount: nativeFixture.edges.length,
    evidenceCount: edge.evidence.length,
    knowledgeNodeCount: nodes.filter((node) => node.kind === 'KNOWLEDGE').length,
    decisionNodeCount: nodes.filter((node) => node.kind === 'DECISION').length,
    unknownTotal,
    counterevidenceTotal,
    frozenReceiptsEstablishingEdge: edge.evidence.length,
  };
}

export function runNativePositiveRun(inputs, contextLike) {
  const nativeFixture = JSON.parse(inputs.nativeFixtureBytes.toString('utf8'));
  const canonicalBytes = Buffer.from(canonicalJson(structuredClone(nativeFixture)));
  const result = ingestNativeProjection(canonicalBytes, contextLike);
  if (result.state !== 'CANDIDATE') throw new Error(`native positive run denied: ${result.code}`);
  const sidecarEntry = contextLike.nativeSidecar.entries.find((entry) => entry.status === 'RELEASED');
  // Independent trusted pins reconstructed from the exact controller-observed
  // receipt/source bytes and the observed byte-equivalent head — never copied
  // from the sidecar or the candidate under test.
  const receiptBytes = contextLike.nativeReceiptBytes;
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  verifyNativeAuthorityFreeCandidate(result.candidate, {
    projectionBytes: canonicalBytes,
    rawArtifactBytes: inputs.nativeFixtureBytes,
    receiptBytes,
    nativeProjectionContractBytes: contextLike.nativeProjectionContractBytes,
    analysisContractBytes: contextLike.nativeAnalysisContractBytes,
    releaseSidecarBytes: contextLike.nativeSidecarBytes,
    sidecarEntry,
    heads: contextLike.heads,
    environment: contextLike.environment,
    environmentSha256: contextLike.environmentSha256,
    trusted: {
      releaseTag: receipt.tag,
      releaseCommit: receipt.resolved_commit,
      pansphairaHeadCommit: NATIVE_TRUSTED_HEAD_COMMIT,
      releaseReceiptSha256: sha256hex(receiptBytes),
      sourceFileIdentity: { path: receipt.sources[0].path, sha256: receipt.sources[0].sha256 },
      rawArtifactSha256: sha256hex(inputs.nativeFixtureBytes),
      canonicalTransportSha256: sha256hex(canonicalBytes),
      projectionBodyDigest: nativeFixture.projectionDigest,
    },
  });
  const oracle = oracleNativeComputedClaims(nativeFixture);
  const oracleEquality = canonicalJson(result.candidate.claims.computed) === canonicalJson(oracle) ? 'EXACT' : 'MISMATCH';
  const evidence = {
    admission: 'SYNTHETIC_PRODUCER_SIDECAR_PIN_ONLY',
    requestSha256: result.requestSha256,
    rawArtifactSha256: sha256hex(inputs.nativeFixtureBytes),
    candidate: result.candidate,
  };
  return { result, evidence, evidenceSha256: sha256hex(canonicalJson(evidence)), oracle, oracleEquality };
}

export function runNativeAdversarialCase(caseId, inputs, contextLike) {
  const nativeFixture = JSON.parse(inputs.nativeFixtureBytes.toString('utf8'));
  const bytes = buildNativeAdversarialBytes(nativeFixture)[caseId];
  return ingestNativeProjection(Buffer.from(bytes), contextLike);
}

function assertFailClosedNative(result, caseId) {
  if (result.state !== 'DENIED' || result.candidate !== null || result.ordinaryAnswer !== null || result.successfulOrdinaryAnswer !== false) {
    throw new Error(`native case ${caseId} did not fail closed`);
  }
  if (!/^[a-f0-9]{64}$/.test(result.denialSha256)) throw new Error(`native case ${caseId} denial digest malformed`);
  const { denialSha256, ...rest } = result;
  if (sha256hex(canonicalJson(rest)) !== denialSha256) throw new Error(`native case ${caseId} denial digest mismatch`);
  if (result.code !== NATIVE_EXPECTED_DENIAL_CODES[caseId]) throw new Error(`native case ${caseId} code ${result.code}`);
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

  // KS151-NATIVE-PROJECTION-01: the separately versioned native slice. The
  // trusted release sidecar pins the synthetic producer independently of any
  // caller-recomputed hash; the relational real registry above stays HELD.
  const nativeFixture = JSON.parse(inputs.nativeFixtureBytes.toString('utf8'));
  const nativeCanonicalBytes = Buffer.from(canonicalJson(structuredClone(nativeFixture)));
  const nativeFirst = runNativePositiveRun(inputs, contextLike);
  const nativeSecond = runNativePositiveRun(inputs, contextLike);
  if (nativeFirst.evidenceSha256 !== nativeSecond.evidenceSha256) throw new Error('native positive runs are not deterministic');
  if (nativeFirst.oracleEquality !== 'EXACT') throw new Error('native oracle readback is not EXACT');

  const nativeAdversarial = [];
  for (const caseId of NATIVE_PIPELINE_ADVERSARIAL_CASE_IDS) {
    const firstDenial = runNativeAdversarialCase(caseId, inputs, contextLike);
    const secondDenial = runNativeAdversarialCase(caseId, inputs, contextLike);
    assertFailClosedNative(firstDenial, caseId);
    if (canonicalJson(firstDenial) !== canonicalJson(secondDenial)) throw new Error(`native case ${caseId} denial not deterministic`);
    nativeAdversarial.push({
      ordinal: nativeAdversarial.length + 1,
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

  const nativeReleasedEntryCount = contextLike.nativeSidecar.entries.filter((entry) => entry.status === 'RELEASED').length;
  if (nativeReleasedEntryCount < 1) throw new Error('native sidecar must pin the synthetic producer');
  const nativeRawSha256 = sha256hex(inputs.nativeFixtureBytes);
  const nativeCanonicalSha256 = sha256hex(nativeCanonicalBytes);
  const nativeBodyDigest = nativeFixture.projectionDigest;
  const native = {
    rawFixtureSha256: nativeRawSha256,
    digestBindings: {
      rawArtifactSha256: nativeRawSha256,
      canonicalTransportSha256: nativeCanonicalSha256,
      projectionBodyDigest: nativeBodyDigest,
      distinct: nativeRawSha256 !== nativeCanonicalSha256
        && nativeCanonicalSha256 !== nativeBodyDigest
        && nativeRawSha256 !== nativeBodyDigest,
    },
    sidecar: {
      status: 'RELEASED',
      entryCount: contextLike.nativeSidecar.entries.length,
      releasedEntryCount: nativeReleasedEntryCount,
      synthetic: contextLike.nativeSidecar.synthetic,
    },
    positive: {
      admission: nativeFirst.evidence.admission,
      evidenceSha256: nativeFirst.evidenceSha256,
      deterministic: true,
      oracleEquality: 'EXACT',
      verifierState: 'VERIFIED',
    },
    adversarial: nativeAdversarial,
  };

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
    native,
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
    const NATIVE_CASE_PREFIX = 'NATIVE_';
    if (caseArg.startsWith(NATIVE_CASE_PREFIX)) {
      const nativeCaseId = caseArg.slice(NATIVE_CASE_PREFIX.length);
      if (!NATIVE_PIPELINE_ADVERSARIAL_CASE_IDS.includes(nativeCaseId)) {
        console.error(`XRA_KS01_NATIVE_UNKNOWN_CASE ${caseArg}`);
        process.exit(2);
      }
      const denial = runNativeAdversarialCase(nativeCaseId, inputs, contextLike);
      assertFailClosedNative(denial, nativeCaseId);
      console.log(JSON.stringify(denial, null, 2));
      process.exit(2);
    }
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