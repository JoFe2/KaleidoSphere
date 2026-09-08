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
      // Source-only provenance (v2): the named release's tag and resolved
      // commit, the later byte-equivalent head, the genuine 64-hex SHA256 of
      // the controller-observed receipt bytes, and the observed source file
      // identity are bound SEPARATELY. A 40-hex commit OID is never a receipt
      // hash, and the receipt digest is verified over the raw bytes, never
      // recomputed from the caller sidecar or the candidate itself.
      pansphairaHead: {
        status: 'RELEASED',
        commitOid: sidecarEntry.pansphairaHeadCommit,
        releaseTag: sidecarEntry.releaseTag,
        releaseCommit: sidecarEntry.releaseCommit,
        releaseReceiptSha256: sidecarEntry.releaseReceiptSha256,
        sourceFileIdentity: structuredClone(sidecarEntry.sourceFileIdentity),
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
//   frozen released raw artifact), receiptBytes (the exact controller-observed
//   public release/source receipt bytes, trailing newline included),
//   nativeProjectionContractBytes, analysisContractBytes,
//   releaseSidecarBytes, sidecarEntry (the RELEASED trusted sidecar entry),
//   heads: {commitOid, treeOid}, environment,
//   environmentSha256, trusted (independent pins reconstructed from the raw
//   receipt/source bytes and the observed byte-equivalent head:
//   releaseTag, releaseCommit, pansphairaHeadCommit, releaseReceiptSha256,
//   sourceFileIdentity, rawArtifactSha256, canonicalTransportSha256,
//   projectionBodyDigest),
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
  if (pansphairaHead.commitOid !== materials.trusted.pansphairaHeadCommit) fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');

  // Source-only provenance, re-derived from the exact raw controller-observed
  // receipt bytes (never from the candidate or the caller sidecar): the
  // candidate's receipt digest must equal the genuine 64-hex SHA256 of the raw
  // bytes AND the independently-pinned trusted digest. A wrong-length token
  // (a 40-hex commit masquerading as a receipt hash) or a recomputed self-hash
  // over altered bytes fails here.
  if (!Buffer.isBuffer(materials.receiptBytes) || materials.receiptBytes.length === 0) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  const receiptDigest = sha256hex(materials.receiptBytes);
  if (receiptDigest !== pansphairaHead.releaseReceiptSha256) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (receiptDigest !== materials.trusted.releaseReceiptSha256) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (pansphairaHead.releaseTag !== materials.trusted.releaseTag) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (pansphairaHead.releaseCommit !== materials.trusted.releaseCommit) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (canonicalJson(pansphairaHead.sourceFileIdentity) !== canonicalJson(materials.trusted.sourceFileIdentity)) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');

  // The raw receipt's observed named-release identity must bind the trusted
  // pins: a named-release/head mismatch or a substituted source file is denied.
  // A recomputed self-hash over altered receipt bytes (changed resolved_commit
  // or source) fails this observed-identity bind, so it cannot be laundered
  // into a "valid" receipt digest.
  let receipt;
  try {
    receipt = JSON.parse(materials.receiptBytes.toString('utf8'));
  } catch {
    fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  }
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (receipt.tag !== materials.trusted.releaseTag) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (receipt.resolved_commit !== materials.trusted.releaseCommit) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (!Array.isArray(receipt.sources) || receipt.sources.length < 1) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  const observedSource = receipt.sources[0];
  if (observedSource === null || typeof observedSource !== 'object' || Array.isArray(observedSource)) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');
  if (observedSource.path !== materials.trusted.sourceFileIdentity.path
    || observedSource.sha256 !== materials.trusted.sourceFileIdentity.sha256) fail('XRA_KS01_NATIVE_CANDIDATE_PROVENANCE_DENIED');

  // The named release's resolved commit and the later byte-equivalent head are
  // two distinct commits; conflating them is denied.
  if (materials.trusted.releaseCommit === materials.trusted.pansphairaHeadCommit) fail('XRA_KS01_NATIVE_CANDIDATE_HEAD_DENIED');

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