// XRA-KS-01 — the fail-closed ingestion pipeline behind the local service
// boundary. Every gate is deterministic; every denial carries a specific code,
// a null candidate, and no ordinary answer. The canonical input bytes are
// never mutated.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

import { analyzeProjectionProfile } from './analysis.mjs';
import { buildAuthorityFreeCandidate } from './candidate.mjs';
import { parseCanonicalProfileBytes, validateProfileContract, fail, HELD_NULLS, RELEASED_REQUIRED } from './profile-contract.mjs';

export const REGISTRY_SCHEMA = 'kaleidosphere.pansphaira-analytics/release-registry/v1';
export const REGISTRY_ISSUE = 'XRA-KS-01';
const ENTRY_KEYS = ['pansphairaHeadCommit', 'profileSha256', 'publicClosureEvidence', 'releaseId', 'releaseReceiptSha256', 'status'];
const TOP_KEYS = ['admissionRule', 'entries', 'issue', 'nonclaim', 'schemaVersion'];
const HEX40 = /^[a-f0-9]{40}$/;
const HEX64 = /^[a-f0-9]{64}$/;

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

export function validateRegistry(registry) {
  if (registry === null || typeof registry !== 'object' || Array.isArray(registry)) fail('XRA_KS01_REGISTRY_INVALID');
  const keys = Object.keys(registry).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...TOP_KEYS].sort())) fail('XRA_KS01_REGISTRY_INVALID');
  if (registry.schemaVersion !== REGISTRY_SCHEMA || registry.issue !== REGISTRY_ISSUE) fail('XRA_KS01_REGISTRY_INVALID');
  if (typeof registry.admissionRule !== 'string' || typeof registry.nonclaim !== 'string') fail('XRA_KS01_REGISTRY_INVALID');
  if (!Array.isArray(registry.entries) || registry.entries.length < 1 || registry.entries.length > 16) fail('XRA_KS01_REGISTRY_INVALID');
  for (const entry of registry.entries) {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail('XRA_KS01_REGISTRY_INVALID');
    if (JSON.stringify(Object.keys(entry).sort()) !== JSON.stringify([...ENTRY_KEYS].sort())) fail('XRA_KS01_REGISTRY_INVALID');
    if (typeof entry.releaseId !== 'string' || entry.releaseId.length < 3 || entry.releaseId.length > 128) fail('XRA_KS01_REGISTRY_INVALID');
    if (entry.status === 'HELD') {
      if (entry.profileSha256 !== null || entry.releaseReceiptSha256 !== null
        || entry.pansphairaHeadCommit !== null || entry.publicClosureEvidence !== null) fail('XRA_KS01_REGISTRY_INVALID');
    } else if (entry.status === 'RELEASED') {
      if (typeof entry.profileSha256 !== 'string' || !HEX64.test(entry.profileSha256)) fail('XRA_KS01_REGISTRY_INVALID');
      if (typeof entry.releaseReceiptSha256 !== 'string' || !HEX64.test(entry.releaseReceiptSha256)) fail('XRA_KS01_REGISTRY_INVALID');
      if (typeof entry.pansphairaHeadCommit !== 'string' || !HEX40.test(entry.pansphairaHeadCommit)) fail('XRA_KS01_REGISTRY_INVALID');
      if (typeof entry.publicClosureEvidence !== 'string' || !HEX64.test(entry.publicClosureEvidence)) fail('XRA_KS01_REGISTRY_INVALID');
    } else fail('XRA_KS01_REGISTRY_INVALID');
  }
  return registry;
}

// context: {
//   registry: validated registry object,
//   heads: { commitOid, treeOid },
//   environment: normalized object, environmentSha256: hex64,
//   projectionContractBytes, analysisContractBytes,
// }
export function ingestProjectionProfile(rawBytes, context) {
  const input = Buffer.from(rawBytes);
  const requestSha256 = sha256hex(input);
  try {
    const profile = validateProfileContract(parseCanonicalProfileBytes(input));
    const registry = context.registry;
    const provenance = profile.provenance;
    if (provenance.status === 'HELD') {
      for (const key of HELD_NULLS) if (provenance[key] !== null) fail('XRA_KS01_PROVENANCE_FORGERY_DENIED');
    } else {
      for (const key of RELEASED_REQUIRED) if (provenance[key] === null) fail('XRA_KS01_EVIDENCE_MISSING_DENIED');
      const attested = registry.entries.some(
        (entry) => entry.status === 'RELEASED'
          && entry.releaseReceiptSha256 === provenance.releaseReceiptSha256
          && entry.pansphairaHeadCommit === provenance.pansphairaHeadCommit,
      );
      if (!attested) fail('XRA_KS01_PROVENANCE_FORGERY_DENIED');
    }
    const releasedEntries = registry.entries.filter((entry) => entry.status === 'RELEASED');
    const matchingEntry = releasedEntries.find((entry) => entry.profileSha256 === requestSha256);
    if (provenance.status === 'HELD' || !matchingEntry) {
      fail(releasedEntries.length === 0 ? 'XRA_KS01_RELEASE_HELD' : 'XRA_KS01_PROFILE_DIGEST_MISMATCH_DENIED');
    }

    const analysis = analyzeProjectionProfile(profile, { status: 'OBSERVED', releasedEntryCount: 1 });
    const candidate = buildAuthorityFreeCandidate({
      profile,
      analysis,
      registryEntry: matchingEntry,
      heads: context.heads,
      environment: context.environment,
      environmentSha256: context.environmentSha256,
      projectionProfileSha256: requestSha256,
      projectionContractSha256: sha256hex(context.projectionContractBytes),
      analysisContractSha256: sha256hex(context.analysisContractBytes),
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