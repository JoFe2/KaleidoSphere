// XRA-KS-01 — the fail-closed native ingestion pipeline behind the local
// service boundary. Separately versioned from the relational pipeline. Every
// gate is deterministic and ordered; every denial carries a specific code, a
// null candidate, and no ordinary answer. The canonical input bytes are never
// mutated. Source provenance is attested against the trusted release sidecar
// and the controller-observed public release/source receipt bytes, never
// against a caller-recomputed hash.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

import { analyzeNativeProjection } from './native-analysis.mjs';
import { buildNativeAuthorityFreeCandidate } from './native-candidate.mjs';
import { parseCanonicalNativeProjectionBytes, validateNativeProjectionContract, fail } from './native-contract.mjs';

export const NATIVE_SIDECAR_SCHEMA = 'kaleidosphere.pansphaira-analytics/native-release-sidecar/v2';
export const NATIVE_SOURCE_PROVENANCE_SCHEMA = 'kaleidosphere.pansphaira-analytics/native-source-provenance/v1';
export const NATIVE_SIDECAR_ISSUE = 'XRA-KS-01';
// The v2 sidecar is explicitly source-only: it pins a versioned source
// provenance contract and never admits a production compatibility pair.
const SIDECAR_TOP_KEYS = ['admissionRule', 'entries', 'issue', 'nonclaim', 'notPublicClosureEvidence', 'pinnedSource', 'provenanceSchema', 'schemaVersion', 'synthetic'];
// The source-only provenance distinguishes the named release tag/commit, the
// later byte-equivalent head, and the actual SHA256 of the observed receipt
// bytes. These are separate, never conflated: a 40-hex commit OID is a commit,
// not a receipt hash, and a receipt SHA256 is 64-hex.
const PINNED_SOURCE_KEYS = ['dataClass', 'pansphairaHeadCommit', 'releaseCommit', 'releaseId', 'releaseReceiptSha256', 'releaseTag', 'sourceContractSha256', 'sourceFileIdentity'];
const ENTRY_KEYS = ['canonicalTransportSha256', 'pansphairaHeadCommit', 'projectionBodyDigest', 'rawArtifactSha256', 'releaseCommit', 'releaseId', 'releaseReceiptSha256', 'releaseTag', 'sourceContractSha256', 'sourceFileIdentity', 'status'];
const SOURCE_FILE_IDENTITY_KEYS = ['path', 'sha256'];
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

// Source file identity: the observed raw projection file's path and digest.
function validateSourceFileIdentity(value, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(code);
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SOURCE_FILE_IDENTITY_KEYS].sort())) fail(code);
  if (typeof value.path !== 'string' || value.path.length < 1) fail(code);
  if (typeof value.sha256 !== 'string' || !HEX64.test(value.sha256)) fail(code);
}

// The named release's resolved commit and the later byte-equivalent head are
// two distinct 40-hex commits. They are never equal and both must be well-formed
// 40-hex OIDs; conflating them (or one being a receipt-length token) is denied.
function assertDistinctCommitOids(releaseCommit, pansphairaHeadCommit, code) {
  if (typeof releaseCommit !== 'string' || !HEX40.test(releaseCommit)) fail(code);
  if (typeof pansphairaHeadCommit !== 'string' || !HEX40.test(pansphairaHeadCommit)) fail(code);
  if (releaseCommit === pansphairaHeadCommit) fail(code);
}

function assertProvenanceScalars(value, code) {
  if (typeof value.releaseId !== 'string' || value.releaseId.length < 3 || value.releaseId.length > 128) fail(code);
  if (typeof value.releaseTag !== 'string' || value.releaseTag.length < 1) fail(code);
  assertDistinctCommitOids(value.releaseCommit, value.pansphairaHeadCommit, code);
  if (typeof value.releaseReceiptSha256 !== 'string' || !HEX64.test(value.releaseReceiptSha256)) fail(code);
  if (typeof value.sourceContractSha256 !== 'string' || !HEX64.test(value.sourceContractSha256)) fail(code);
  validateSourceFileIdentity(value.sourceFileIdentity, code);
}

// Trusted release sidecar: pins the independently released public synthetic
// native producer through the versioned source-only provenance contract,
// independently of any caller-recomputed hash. Visibly test-only: it is not the
// live release registry, admits no production pair, and is not public closure
// evidence. receiptBytes are the exact controller-observed public
// release/source receipt bytes (trailing newline included); the pinned receipt
// digest must be their genuine 64-hex SHA256, and the receipt's observed tag /
// resolved commit / source file identity must bind the named release.
export function validateNativeSidecar(sidecar, receiptBytes) {
  if (sidecar === null || typeof sidecar !== 'object' || Array.isArray(sidecar)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  const keys = Object.keys(sidecar).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SIDECAR_TOP_KEYS].sort())) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (sidecar.schemaVersion !== NATIVE_SIDECAR_SCHEMA || sidecar.issue !== NATIVE_SIDECAR_ISSUE) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (sidecar.provenanceSchema !== NATIVE_SOURCE_PROVENANCE_SCHEMA) fail('XRA_KS01_NATIVE_PROVENANCE_DENIED');
  if (sidecar.synthetic !== true) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (sidecar.notPublicClosureEvidence !== true) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (typeof sidecar.admissionRule !== 'string' || typeof sidecar.nonclaim !== 'string') fail('XRA_KS01_NATIVE_SIDECAR_INVALID');

  const pinned = sidecar.pinnedSource;
  if (pinned === null || typeof pinned !== 'object' || Array.isArray(pinned)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (JSON.stringify(Object.keys(pinned).sort()) !== JSON.stringify([...PINNED_SOURCE_KEYS].sort())) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (typeof pinned.dataClass !== 'string' || pinned.dataClass.length < 1) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  assertProvenanceScalars(pinned, 'XRA_KS01_NATIVE_SIDECAR_INVALID');

  // Trusted receipt binding: the pinned receipt digest must be the genuine
  // 64-hex SHA256 of the exact controller-observed receipt bytes. A 40-hex
  // commit token (wrong length), a caller-recomputed digest, or altered receipt
  // bytes all fail here; a successful commit lookup never validates a receipt.
  if (!Buffer.isBuffer(receiptBytes) || receiptBytes.length === 0) fail('XRA_KS01_NATIVE_RECEIPT_DENIED');
  if (sha256hex(receiptBytes) !== pinned.releaseReceiptSha256) fail('XRA_KS01_NATIVE_RECEIPT_DENIED');

  // Named-release consistency: the receipt's observed tag, resolved commit, and
  // first source file identity must equal the pinned named release. A named
  // release/head mismatch or a substituted source file is denied.
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString('utf8'));
  } catch {
    fail('XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED');
  }
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) fail('XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED');
  if (typeof receipt.tag !== 'string' || receipt.tag !== pinned.releaseTag) fail('XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED');
  if (typeof receipt.resolved_commit !== 'string' || receipt.resolved_commit !== pinned.releaseCommit) fail('XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED');
  if (!Array.isArray(receipt.sources) || receipt.sources.length < 1) fail('XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED');
  const observedSource = receipt.sources[0];
  if (observedSource === null || typeof observedSource !== 'object' || Array.isArray(observedSource)) fail('XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED');
  if (observedSource.path !== pinned.sourceFileIdentity.path || observedSource.sha256 !== pinned.sourceFileIdentity.sha256) fail('XRA_KS01_NATIVE_RECEIPT_MISMATCH_DENIED');

  if (!Array.isArray(sidecar.entries) || sidecar.entries.length < 1 || sidecar.entries.length > 16) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  for (const entry of sidecar.entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...ENTRY_KEYS].sort())) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    if (entry.status === 'RELEASED') {
      if (!HEX64.test(entry.rawArtifactSha256) || !HEX64.test(entry.canonicalTransportSha256) || !HEX64.test(entry.projectionBodyDigest)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      assertProvenanceScalars(entry, 'XRA_KS01_NATIVE_SIDECAR_INVALID');
      // Each entry's provenance pin must equal the sidecar's independent pinned source.
      if (entry.releaseTag !== pinned.releaseTag
        || entry.releaseCommit !== pinned.releaseCommit
        || entry.pansphairaHeadCommit !== pinned.pansphairaHeadCommit
        || entry.releaseReceiptSha256 !== pinned.releaseReceiptSha256
        || entry.sourceContractSha256 !== pinned.sourceContractSha256
        || canonicalJson(entry.sourceFileIdentity) !== canonicalJson(pinned.sourceFileIdentity)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      // The raw released artifact is the observed source file bytes.
      if (entry.rawArtifactSha256 !== pinned.sourceFileIdentity.sha256) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    } else if (entry.status === 'HELD') {
      for (const key of ['canonicalTransportSha256', 'pansphairaHeadCommit', 'projectionBodyDigest', 'rawArtifactSha256', 'releaseCommit', 'releaseReceiptSha256', 'sourceContractSha256']) {
        if (entry[key] !== null) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      }
      if (entry.releaseTag !== null || entry.sourceFileIdentity !== null) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    } else fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  }
  return sidecar;
}

// context: {
//   nativeSidecar: validated sidecar object,
//   heads: { commitOid, treeOid },
//   environment, environmentSha256,
//   nativeProjectionContractBytes, nativeAnalysisContractBytes, nativeSidecarBytes,
// }
export function ingestNativeProjection(rawBytes, context) {
  const input = Buffer.from(rawBytes);
  const requestSha256 = sha256hex(input);
  try {
    const projection = validateNativeProjectionContract(parseCanonicalNativeProjectionBytes(input));
    const sidecar = context.nativeSidecar;
    const releasedEntry = sidecar.entries.find((entry) => entry.status === 'RELEASED');
    if (releasedEntry === undefined) fail('XRA_KS01_NATIVE_RELEASE_HELD');

    // Provenance (upstream of the digest gates): the native source binding must
    // be the trusted sidecar's independently pinned source, never a
    // caller-recomputed value.
    if (projection.source.contractSha256 !== releasedEntry.sourceContractSha256) fail('XRA_KS01_NATIVE_PROVENANCE_FORGERY_DENIED');

    // Body self-digest: the projection's self-attested body digest must be
    // self-consistent and equal the sidecar body pin.
    const body = {};
    for (const [key, value] of Object.entries(projection)) if (key !== 'projectionDigest') body[key] = value;
    if (sha256hex(canonicalJson(body)) !== projection.projectionDigest) fail('XRA_KS01_NATIVE_DIGEST_MISMATCH_DENIED');
    if (projection.projectionDigest !== releasedEntry.projectionBodyDigest) fail('XRA_KS01_NATIVE_DIGEST_MISMATCH_DENIED');

    // Canonical transport: the exact released canonical bytes are the wire form.
    if (requestSha256 !== releasedEntry.canonicalTransportSha256) fail('XRA_KS01_NATIVE_DIGEST_MISMATCH_DENIED');

    const analysis = analyzeNativeProjection(projection, { status: 'OBSERVED', releasedEntryCount: 1 });
    const candidate = buildNativeAuthorityFreeCandidate({
      analysis,
      sidecarEntry: releasedEntry,
      heads: context.heads,
      environment: context.environment,
      environmentSha256: context.environmentSha256,
      canonicalTransportSha256: requestSha256,
      projectionBodyDigest: projection.projectionDigest,
      nativeProjectionContractSha256: sha256hex(context.nativeProjectionContractBytes),
      analysisContractSha256: sha256hex(context.nativeAnalysisContractBytes),
      releaseSidecarSha256: sha256hex(context.nativeSidecarBytes),
    });
    return { state: 'CANDIDATE', requestSha256, candidate };
  } catch (error) {
    const denied = {
      state: 'DENIED',
      code: typeof error?.code === 'string' && error.code.startsWith('XRA_KS01_') ? error.code : 'XRA_KS01_INTERNAL_ERROR_DENIED',
      requestSha256,
      candidate: null,
      ordinaryAnswer: null,
      successfulOrdinaryAnswer: false,
    };
    denied.denialSha256 = sha256hex(canonicalJson(denied));
    return denied;
  }
}