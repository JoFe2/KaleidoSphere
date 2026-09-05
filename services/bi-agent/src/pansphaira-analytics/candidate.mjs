// XRA-KS-01 — authority-free analytics candidate: builder and verifier.
// The candidate is state CANDIDATE, carries no authority, and binds both repo
// heads, both contracts, the input, the result, and the service environment.
// It never carries a digest of itself.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

import { ANALYSIS_ID, ANALYSIS_VERSION, COVERAGE_ASPECT_KEYS, COVERAGE_STATUSES, COUNTEREVIDENCE_CLAIM_IDS, COUNTEREVIDENCE_STATUSES } from './analysis.mjs';

export const CANDIDATE_SCHEMA = 'kaleidosphere.pansphaira-analytics/authority-free-candidate/v1';
export const ISSUE_ID = 'XRA-KS-01';
export const CANDIDATE_STATE = 'CANDIDATE';
export const AUTHORITY_FREE = Object.freeze({
  promote: false,
  mutate: false,
  execute: false,
  publish: false,
  capabilities: Object.freeze([]),
  effects: Object.freeze([]),
});
export const CANDIDATE_NONCLAIMS = Object.freeze([
  'No autonomous promotion: this candidate is state CANDIDATE and carries no promotion, mutation, execution, or publication authority.',
  'No generic PANSPHAIRA domain in KaleidoSphere: the analysis is confined to the one closed projection-profile v1 shape.',
  'No broad knowledge-effectiveness score: no score is emitted; claims are structural facts with UNKNOWN preserved.',
  'No external effect: no push, publish, release, credential use, customer data access, or marketplace claim is made or implied by this candidate.',
]);

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

// Normalized service environment identity, bound into every candidate.
export function buildEnvironmentIdentity({ nodeVersion, nodeModulesAbi, platform, architecture, canonicalJsonBytes, packageBytes }) {
  const environment = {
    nodeVersion,
    nodeModulesAbi,
    platform,
    architecture,
    canonicalJsonSha256: sha256hex(canonicalJsonBytes),
    packageSha256: sha256hex(packageBytes),
  };
  return { environment, environmentSha256: sha256hex(canonicalJson(environment)) };
}

export function buildAuthorityFreeCandidate({ profile, analysis, registryEntry, heads, environment, environmentSha256, projectionProfileSha256, projectionContractSha256, analysisContractSha256 }) {
  const released = registryEntry !== null && registryEntry.status === 'RELEASED';
  return {
    schemaVersion: CANDIDATE_SCHEMA,
    issue: ISSUE_ID,
    state: CANDIDATE_STATE,
    analysis: {
      id: ANALYSIS_ID,
      version: ANALYSIS_VERSION,
      contractSha256: analysisContractSha256,
    },
    claims: analysis.claims,
    coverage: analysis.coverage,
    counterevidence: analysis.counterevidence,
    resultSha256: analysis.resultSha256,
    bindings: {
      kaleidosphereHead: { commitOid: heads.commitOid, treeOid: heads.treeOid },
      pansphairaHead: released
        ? { status: 'RELEASED', commitOid: registryEntry.pansphairaHeadCommit }
        : { status: 'HELD', commitOid: null },
      projectionProfileSha256,
      projectionContractSha256,
      analysisContractSha256,
      environmentSha256,
    },
    authority: {
      promote: false,
      mutate: false,
      execute: false,
      publish: false,
      capabilities: [],
      effects: [],
    },
    nonclaims: [...CANDIDATE_NONCLAIMS],
  };
}

// materials: {
//   profileBytes, projectionContractBytes, analysisContractBytes,
//   registry (validated registry object), heads: {commitOid, treeOid},
//   environment (normalized object), environmentSha256,
// }
export function verifyAuthorityFreeCandidate(candidate, materials) {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) fail('XRA_KS01_CANDIDATE_STATE_DENIED');
  if (candidate.state !== CANDIDATE_STATE) fail('XRA_KS01_CANDIDATE_STATE_DENIED');
  if (candidate.schemaVersion !== CANDIDATE_SCHEMA) fail('XRA_KS01_CANDIDATE_STATE_DENIED');
  if (candidate.issue !== ISSUE_ID) fail('XRA_KS01_CANDIDATE_STATE_DENIED');
  if (!deepEqual(candidate.authority, AUTHORITY_FREE)) fail('XRA_KS01_CANDIDATE_AUTHORITY_DENIED');
  if (!deepEqual(candidate.nonclaims, CANDIDATE_NONCLAIMS)) fail('XRA_KS01_CANDIDATE_AUTHORITY_DENIED');

  const analysis = candidate.analysis;
  if (analysis === null || typeof analysis !== 'object' || analysis.id !== ANALYSIS_ID || analysis.version !== ANALYSIS_VERSION) fail('XRA_KS01_CANDIDATE_CONTRACT_DIGEST_DENIED');

  const bindings = candidate.bindings;
  if (bindings === null || typeof bindings !== 'object' || Array.isArray(bindings)) fail('XRA_KS01_CANDIDATE_INPUT_DIGEST_DENIED');
  if (sha256hex(materials.profileBytes) !== bindings.projectionProfileSha256) fail('XRA_KS01_CANDIDATE_INPUT_DIGEST_DENIED');
  if (sha256hex(materials.projectionContractBytes) !== bindings.projectionContractSha256) fail('XRA_KS01_CANDIDATE_CONTRACT_DIGEST_DENIED');
  if (sha256hex(materials.analysisContractBytes) !== bindings.analysisContractSha256) fail('XRA_KS01_CANDIDATE_CONTRACT_DIGEST_DENIED');
  if (sha256hex(canonicalJson(materials.environment)) !== bindings.environmentSha256) fail('XRA_KS01_CANDIDATE_ENVIRONMENT_DENIED');
  if (sha256hex(canonicalJson(materials.environment)) !== materials.environmentSha256) fail('XRA_KS01_CANDIDATE_ENVIRONMENT_DENIED');

  const kaleidosphereHead = bindings.kaleidosphereHead;
  if (kaleidosphereHead === null || kaleidosphereHead.commitOid !== materials.heads.commitOid || kaleidosphereHead.treeOid !== materials.heads.treeOid) fail('XRA_KS01_CANDIDATE_HEAD_DENIED');

  const profileSha256 = sha256hex(materials.profileBytes);
  const matchingEntry = materials.registry.entries.find(
    (entry) => entry.status === 'RELEASED' && entry.profileSha256 === profileSha256,
  );
  const pansphairaHead = bindings.pansphairaHead;
  if (pansphairaHead === null || typeof pansphairaHead !== 'object') fail('XRA_KS01_CANDIDATE_HEAD_DENIED');
  if (matchingEntry) {
    if (pansphairaHead.status !== 'RELEASED' || pansphairaHead.commitOid !== matchingEntry.pansphairaHeadCommit) fail('XRA_KS01_CANDIDATE_HEAD_DENIED');
  } else if (pansphairaHead.status !== 'HELD' || pansphairaHead.commitOid !== null) fail('XRA_KS01_CANDIDATE_HEAD_DENIED');

  const { claims, coverage, counterevidence, resultSha256 } = candidate;
  if (claims === null || coverage === null || !Array.isArray(counterevidence)) fail('XRA_KS01_CANDIDATE_RESULT_DIGEST_DENIED');
  if (sha256hex(canonicalJson({ claims, coverage, counterevidence })) !== resultSha256) fail('XRA_KS01_CANDIDATE_RESULT_DIGEST_DENIED');

  const claimIds = counterevidence.map((entry) => entry.claim).sort();
  if (JSON.stringify(claimIds) !== JSON.stringify([...COUNTEREVIDENCE_CLAIM_IDS].sort())) fail('XRA_KS01_CANDIDATE_COUNTEREVIDENCE_DENIED');
  for (const entry of counterevidence) {
    if (entry === null || typeof entry !== 'object' || !COUNTEREVIDENCE_STATUSES.includes(entry.status)) fail('XRA_KS01_CANDIDATE_COUNTEREVIDENCE_DENIED');
  }
  for (const aspect of COVERAGE_ASPECT_KEYS) {
    if (!COVERAGE_STATUSES.includes(coverage[aspect])) fail('XRA_KS01_CANDIDATE_UNKNOWN_COLLAPSE_DENIED');
  }
  return { state: 'VERIFIED' };
}

function deepEqual(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}