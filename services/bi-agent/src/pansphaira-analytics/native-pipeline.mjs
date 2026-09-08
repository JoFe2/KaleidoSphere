// XRA-KS-01 — the fail-closed native ingestion pipeline behind the local
// service boundary. Separately versioned from the relational pipeline. Every
// gate is deterministic and ordered; every denial carries a specific code, a
// null candidate, and no ordinary answer. The canonical input bytes are never
// mutated. Source provenance is attested against the trusted release sidecar,
// never against a caller-recomputed hash.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

import { analyzeNativeProjection } from './native-analysis.mjs';
import { buildNativeAuthorityFreeCandidate } from './native-candidate.mjs';
import { parseCanonicalNativeProjectionBytes, validateNativeProjectionContract, fail } from './native-contract.mjs';

export const NATIVE_SIDECAR_SCHEMA = 'kaleidosphere.pansphaira-analytics/native-release-sidecar/v1';
export const NATIVE_SIDECAR_ISSUE = 'XRA-KS-01';
const SIDECAR_TOP_KEYS = ['admissionRule', 'entries', 'issue', 'nonclaim', 'notPublicClosureEvidence', 'pinnedSource', 'schemaVersion', 'synthetic'];
const PINNED_SOURCE_KEYS = ['dataClass', 'pansphairaHeadCommit', 'releaseId', 'releaseReceiptSha256', 'sourceContractSha256'];
const ENTRY_KEYS = ['canonicalTransportSha256', 'pansphairaHeadCommit', 'projectionBodyDigest', 'rawArtifactSha256', 'releaseId', 'releaseReceiptSha256', 'sourceContractSha256', 'status'];
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

// Trusted release sidecar: pins the independently released public synthetic
// native producer (source/release/head), independently of any
// caller-recomputed hash. Visibly test-only: it is not the live release
// registry, admits no production pair, and is not public closure evidence.
export function validateNativeSidecar(sidecar) {
  if (sidecar === null || typeof sidecar !== 'object' || Array.isArray(sidecar)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  const keys = Object.keys(sidecar).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SIDECAR_TOP_KEYS].sort())) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (sidecar.schemaVersion !== NATIVE_SIDECAR_SCHEMA || sidecar.issue !== NATIVE_SIDECAR_ISSUE) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (sidecar.synthetic !== true) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (sidecar.notPublicClosureEvidence !== true) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (typeof sidecar.admissionRule !== 'string' || typeof sidecar.nonclaim !== 'string') fail('XRA_KS01_NATIVE_SIDECAR_INVALID');

  const pinned = sidecar.pinnedSource;
  if (pinned === null || typeof pinned !== 'object' || Array.isArray(pinned)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (JSON.stringify(Object.keys(pinned).sort()) !== JSON.stringify([...PINNED_SOURCE_KEYS].sort())) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (typeof pinned.releaseId !== 'string' || pinned.releaseId.length < 3 || pinned.releaseId.length > 128) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (typeof pinned.dataClass !== 'string' || pinned.dataClass.length < 1) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (!HEX40.test(pinned.releaseReceiptSha256)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (!HEX40.test(pinned.pansphairaHeadCommit)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  if (!HEX64.test(pinned.sourceContractSha256)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');

  if (!Array.isArray(sidecar.entries) || sidecar.entries.length < 1 || sidecar.entries.length > 16) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
  for (const entry of sidecar.entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...ENTRY_KEYS].sort())) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    if (typeof entry.releaseId !== 'string' || entry.releaseId.length < 3) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    if (entry.status === 'RELEASED') {
      if (!HEX64.test(entry.rawArtifactSha256) || !HEX64.test(entry.canonicalTransportSha256) || !HEX64.test(entry.projectionBodyDigest)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      if (!HEX40.test(entry.releaseReceiptSha256)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      if (!HEX40.test(entry.pansphairaHeadCommit)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      if (!HEX64.test(entry.sourceContractSha256)) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      // Each entry's pin must equal the sidecar's independent pinned source.
      if (entry.releaseReceiptSha256 !== pinned.releaseReceiptSha256
        || entry.pansphairaHeadCommit !== pinned.pansphairaHeadCommit
        || entry.sourceContractSha256 !== pinned.sourceContractSha256) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
    } else if (entry.status === 'HELD') {
      for (const key of ['canonicalTransportSha256', 'pansphairaHeadCommit', 'projectionBodyDigest', 'rawArtifactSha256', 'releaseReceiptSha256', 'sourceContractSha256']) {
        if (entry[key] !== null) fail('XRA_KS01_NATIVE_SIDECAR_INVALID');
      }
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