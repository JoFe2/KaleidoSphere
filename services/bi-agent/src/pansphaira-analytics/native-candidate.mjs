// XRA-KS-01 — authority-free native analytics candidate: builder and verifier.
// Separately versioned from the relational candidate. State CANDIDATE, no
// authority. It binds both repo heads, both native contracts, the trusted
// release sidecar, the input (three distinct digests), the result, and the
// service environment. It never carries a digest of itself.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

import { AUTHORITY_FREE } from './candidate.mjs';
import {
  NATIVE_ANALYSIS_ID,
  NATIVE_ANALYSIS_VERSION,
  NATIVE_COVERAGE_ASPECT_KEYS,
  NATIVE_COVERAGE_STATUSES,
  NATIVE_COUNTEREVIDENCE_CLAIM_IDS,
  NATIVE_COUNTEREVIDENCE_STATUSES,
} from './native-analysis.mjs';

export const NATIVE_CANDIDATE_SCHEMA = 'kaleidosphere.pansphaira-analytics/native-authority-free-candidate/v1';
export const NATIVE_ISSUE_ID = 'XRA-KS-01';
export const NATIVE_CANDIDATE_STATE = 'CANDIDATE';
export const NATIVE_CANDIDATE_NONCLAIMS = Object.freeze([
  'No autonomous promotion: this native candidate is state CANDIDATE and carries no promotion, mutation, execution, or publication authority.',
  'No relation-truth or knowledge-effectiveness claim: the analysis emits structural node/edge/evidence coverage only; no relation truth or effectiveness is asserted.',
  'No generic PANSPHAIRA domain in KaleidoSphere: the analysis is confined to the one closed native nodes/edges projection v1 shape.',
  'No external effect: no push, publish, release, credential use, customer data access, or production-data claim is made or implied by this candidate.',
]);

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

export function buildNativeAuthorityFreeCandidate({ analysis, sidecarEntry, heads, environment, environmentSha256, canonicalTransportSha256, projectionBodyDigest, nativeProjectionContractSha256, analysisContractSha256, releaseSidecarSha256 }) {
  return {
    schemaVersion: NATIVE_CANDIDATE_SCHEMA,
    issue: NATIVE_ISSUE_ID,
    state: NATIVE_CANDIDATE_STATE,
    analysis: {
      id: NATIVE_ANALYSIS_ID,
      version: NATIVE_ANALYSIS_VERSION,
      contractSha256: analysisContractSha256,
    },
    claims: analysis.claims,
    coverage: analysis.coverage,
    counterevidence: analysis.counterevidence,
    resultSha256: analysis.resultSha256,
    bindings: {
      kaleidosphereHead: { commitOid: heads.commitOid, treeOid: heads.treeOid },
      pansphairaHead: {
        status: 'RELEASED',
        commitOid: sidecarEntry.pansphairaHeadCommit,
        releaseReceiptSha256: sidecarEntry.releaseReceiptSha256,
      },
      rawArtifactSha256: sidecarEntry.rawArtifactSha256,
      canonicalTransportSha256,
      projectionBodyDigest,
      nativeProjectionContractSha256,
      analysisContractSha256,
      releaseSidecarSha256,
      environmentSha256,
    },
    authority: { promote: false, mutate: false, execute: false, publish: false, capabilities: [], effects: [] },
    nonclaims: [...NATIVE_CANDIDATE_NONCLAIMS],
  };
}

// materials: {
//   projectionBytes (canonical transport wire bytes), rawArtifactBytes (the
//   frozen released raw artifact), nativeProjectionContractBytes,
//   analysisContractBytes, releaseSidecarBytes, sidecarEntry (the RELEASED
//   trusted sidecar entry), heads: {commitOid, treeOid}, environment,
//   environmentSha256, trusted (independent pins: rawArtifactSha256,
//   canonicalTransportSha256, projectionBodyDigest, pansphairaHeadCommit,
//   releaseReceiptSha256),
// }
export function verifyNativeAuthorityFreeCandidate(candidate, materials) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) fail('XRA_KS01_NATIVE_CANDIDATE_STATE_DENIED');
  if (candidate.state !== NATIVE_CANDIDATE_STATE) fail('XRA_KS01_NATIVE_CANDIDATE_STATE_DENIED');
  if (candidate.schemaVersion !== NATIVE_CANDIDATE_SCHEMA) fail('XRA_KS01_NATIVE_CANDIDATE_STATE_DENIED');
  if (candidate.issue !== NATIVE_ISSUE_ID) fail('XRA_KS01_NATIVE_CANDIDATE_STATE_DENIED');
  if (!deepEqual(candidate.authority, AUTHORITY_FREE)) fail('XRA_KS01_NATIVE_CANDIDATE_AUTHORITY_DENIED');
  if (!deepEqual(candidate.nonclaims, NATIVE_CANDIDATE_NONCLAIMS)) fail('XRA_KS01_NATIVE_CANDIDATE_AUTHORITY_DENIED');

  const analysis = candidate.analysis;
  if (analysis === null || typeof analysis !== 'object' || analysis.id !== NATIVE_ANALYSIS_ID || analysis.version !== NATIVE_ANALYSIS_VERSION) {
    fail('XRA_KS01_NATIVE_CANDIDATE_CONTRACT_DIGEST_DENIED');
  }

  const bindings = candidate.bindings;
  if (bindings === null || typeof bindings !== 'object' || Array.isArray(bindings)) fail('XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED');
  if (sha256hex(materials.projectionBytes) !== bindings.canonicalTransportSha256) fail('XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED');
  if (sha256hex(materials.projectionBytes) !== materials.trusted.canonicalTransportSha256) fail('XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED');
  if (sha256hex(materials.rawArtifactBytes) !== bindings.rawArtifactSha256) fail('XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED');
  if (sha256hex(materials.rawArtifactBytes) !== materials.trusted.rawArtifactSha256) fail('XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED');
  if (deriveBodyDigest(materials.projectionBytes) !== bindings.projectionBodyDigest) fail('XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED');
  if (deriveBodyDigest(materials.projectionBytes) !== materials.trusted.projectionBodyDigest) fail('XRA_KS01_NATIVE_CANDIDATE_INPUT_DIGEST_DENIED');

  if (sha256hex(materials.nativeProjectionContractBytes) !== bindings.nativeProjectionContractSha256) fail('XRA_KS01_NATIVE_CANDIDATE_CONTRACT_DIGEST_DENIED');
  if (sha256hex(materials.analysisContractBytes) !== bindings.analysisContractSha256) fail('XRA_KS01_NATIVE_CANDIDATE_CONTRACT_DIGEST_DENIED');
  if (bindings.analysisContractSha256 !== candidate.analysis.contractSha256) fail('XRA_KS01_NATIVE_CANDIDATE_CONTRACT_DIGEST_DENIED');
  if (sha256hex(materials.releaseSidecarBytes) !== bindings.releaseSidecarSha256) fail('XRA_KS01_NATIVE_CANDIDATE_CONTRACT_DIGEST_DENIED');

  if (sha256hex(canonicalJson(materials.environment)) !== bindings.environmentSha256) fail('XRA_KS01_NATIVE_CANDIDATE_ENVIRONMENT_DENIED');
  if (sha256hex(canonicalJson(materials.environment)) !== materials.environmentSha256) fail('XRA_KS01_NATIVE_CANDIDATE_ENVIRONMENT_DENIED');

  const kaleidosphereHead = bindings.kaleidosphereHead;
  if (kaleidosphereHead === null || typeof kaleidosphereHead !== 'object' || Array.isArray(kaleidosphereHead)
    || kaleidosphereHead.commitOid !== materials.heads.commitOid || kaleidosphereHead.treeOid !== materials.heads.treeOid) {
    fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');
  }

  const pansphairaHead = bindings.pansphairaHead;
  if (pansphairaHead === null || typeof pansphairaHead !== 'object' || Array.isArray(pansphairaHead)) fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');
  if (pansphairaHead.status !== 'RELEASED') fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');
  if (pansphairaHead.commitOid !== materials.sidecarEntry.pansphairaHeadCommit) fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');
  if (pansphairaHead.commitOid !== materials.trusted.pansphairaHeadCommit) fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');
  if (pansphairaHead.releaseReceiptSha256 !== materials.sidecarEntry.releaseReceiptSha256) fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');
  if (pansphairaHead.releaseReceiptSha256 !== materials.trusted.releaseReceiptSha256) fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');

  const claimIds = candidate.counterevidence.map((entry) => entry.claim).sort();
  if (JSON.stringify(claimIds) !== JSON.stringify([...NATIVE_COUNTEREVIDENCE_CLAIM_IDS].sort())) fail('XRA_KS01_NATIVE_CANDIDATE_COUNTEREVIDENCE_DENIED');
  for (const entry of candidate.counterevidence) {
    if (entry === null || typeof entry !== 'object' || !NATIVE_COUNTEREVIDENCE_STATUSES.includes(entry.status)) fail('XRA_KS01_NATIVE_CANDIDATE_COUNTEREVIDENCE_DENIED');
  }
  for (const aspect of NATIVE_COVERAGE_ASPECT_KEYS) {
    if (!NATIVE_COVERAGE_STATUSES.includes(candidate.coverage[aspect])) fail('XRA_KS01_NATIVE_CANDIDATE_UNKNOWN_COLLAPSE_DENIED');
  }

  const { claims, coverage, counterevidence, resultSha256 } = candidate;
  if (claims === null || coverage === null || !Array.isArray(counterevidence)) fail('XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED');
  if (sha256hex(canonicalJson({ claims, coverage, counterevidence })) !== resultSha256) fail('XRA_KS01_NATIVE_CANDIDATE_RESULT_DIGEST_DENIED');
  return { state: 'VERIFIED' };
}

function deriveBodyDigest(projectionBytes) {
  const parsed = JSON.parse(Buffer.from(projectionBytes).toString('utf8'));
  const body = {};
  for (const [key, value] of Object.entries(parsed)) if (key !== 'projectionDigest') body[key] = value;
  return sha256hex(canonicalJson(body));
}

function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}