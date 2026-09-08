// XRA-KS-01 — exact closed shape validation for the native PAN nodes/edges
// projection (v1). Separately versioned from the relational profile contract;
// no relational fields and no period metadata are accepted. The projection
// arrives only as canonical JSON bytes over the local service boundary; no
// PANSPHAIRA module is imported and no dryRun bridge is used. Malformed or
// widened variants are denied with a specific code, never coerced.

import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

export const NATIVE_PROJECTION_SCHEMA = 'chimpmaera.cks/kaleidosphere-analytics-projection/v1';
export const NATIVE_PROJECTION_ID = 'pansphaira:cks-xra-ps-01-kaleidosphere-analytics-001';
export const NATIVE_CONTRACT_VERSION = '1.0.0';
export const NATIVE_PURPOSE = 'PANSPHAIRA_EDGE_EVIDENCE_ANALYTICS';
export const NATIVE_SOURCE_CONTRACT = 'pansphaira.fnd-ps-02/owner-edge-evidence-inputs/v2';
export const NATIVE_SOURCE_CONTRACT_VERSION = 'v2';
export const MAX_NATIVE_PROJECTION_BYTES = 16384;
export const NATIVE_TOP_KEYS = Object.freeze([
  'authority', 'contractVersion', 'effect', 'edges', 'nodes', 'nonclaims',
  'projectionDigest', 'projectionId', 'promotion', 'purpose', 'relationTruth', 'schemaVersion', 'source',
]);
export const NATIVE_SOURCE_KEYS = Object.freeze(['contract', 'contractSha256', 'contractVersion']);
export const NATIVE_SOURCE_EVIDENCE_KEYS = Object.freeze(['contract', 'contractSha256', 'reference']);
export const NATIVE_NODE_KEYS = Object.freeze([
  'authority', 'counterevidence', 'coverage', 'id', 'kind', 'sourceEvidence', 'unknown',
]);
export const NATIVE_EDGE_KEYS = Object.freeze([
  'authority', 'counterevidence', 'coverage', 'effect', 'evidence', 'evidenceSha256',
  'from', 'promotion', 'relation', 'relationTruthClaimed', 'relationTruth', 'sourceEvidence', 'to', 'unknown',
]);
export const NATIVE_EVIDENCE_KEYS = Object.freeze(['evidenceId', 'evidenceRole', 'evidenceSha256', 'evidenceVersion']);
// Frozen subjects: the only node ids/kinds and source references the shape
// accepts. Any deviation (a widened or re-digested variant) is denied.
export const NATIVE_FROZEN_SUBJECTS = Object.freeze([
  { id: 'knowledge-001', kind: 'KNOWLEDGE', reference: 'canonicalKnowledge' },
  { id: 'decision-001', kind: 'DECISION', reference: 'relation' },
]);
export const NATIVE_EDGE_FROM = 'knowledge-001';
export const NATIVE_EDGE_TO = 'decision-001';
export const NATIVE_EDGE_RELATION = 'KNOWLEDGE_USED_BY_DECISION';
export const NATIVE_EDGE_SOURCE_REFERENCE = 'edge';
// The edge is established only by its two frozen source receipts, in this
// order; never by endpoint presence alone.
export const NATIVE_EVIDENCE_ROLES = Object.freeze(['KNOWLEDGE_QUALIFICATION', 'RELATION_ASSERTION']);
export const NATIVE_NONCLAIMS = Object.freeze([
  'NO_RELATION_TRUTH_FROM_ENDPOINTS',
  'NO_AUTHORITY',
  'NO_PROMOTION',
  'NO_EFFECT',
  'NO_CANONICAL_KNOWLEDGE_MUTATION',
  'NO_PRODUCTION_OR_CUSTOMER_DATA_CLAIM',
]);

const HEX64 = /^[a-f0-9]{64}$/;

export function fail(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function exactKeys(value, allowed, code) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...allowed].sort())) fail(code);
}

// Gate 1 (transport): bounded body, and the bytes must be exactly the canonical
// JSON form of the parsed document. Any drift is a canonicality denial.
export function parseCanonicalNativeProjectionBytes(rawBytes) {
  if (rawBytes.length === 0 || rawBytes.length > MAX_NATIVE_PROJECTION_BYTES) fail('XRA_KS01_REQUEST_SIZE_DENIED');
  const text = Buffer.from(rawBytes).toString('utf8');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail('XRA_KS01_NATIVE_CANONICALITY_DENIED');
  }
  if (canonicalJson(parsed) !== text) fail('XRA_KS01_NATIVE_CANONICALITY_DENIED');
  return parsed;
}

// Gate 2 (contract): exact closed native v1 shape with the frozen subject,
// authority, and coverage freeze. The source binding's value is attested
// against the trusted release sidecar in the pipeline provenance gate, not here.
export function validateNativeProjectionContract(projection) {
  if (projection === null || typeof projection !== 'object' || Array.isArray(projection)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  exactKeys(projection, NATIVE_TOP_KEYS, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (projection.schemaVersion !== NATIVE_PROJECTION_SCHEMA) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (projection.projectionId !== NATIVE_PROJECTION_ID) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (projection.contractVersion !== NATIVE_CONTRACT_VERSION) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (projection.purpose !== NATIVE_PURPOSE) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');

  // Authority freeze: a widened authority/promotion/effect/relation-truth is
  // denied with its own code, before the generic contract denial.
  if (projection.authority !== 'NONE' || projection.promotion !== 'NOT_AUTHORIZED'
    || projection.effect !== 'NONE' || projection.relationTruth !== 'NOT_GRANTED') fail('XRA_KS01_NATIVE_AUTHORITY_DENIED');

  if (JSON.stringify(projection.nonclaims) !== JSON.stringify([...NATIVE_NONCLAIMS])) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');

  exactKeys(projection.source, NATIVE_SOURCE_KEYS, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (projection.source.contract !== NATIVE_SOURCE_CONTRACT) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (projection.source.contractVersion !== NATIVE_SOURCE_CONTRACT_VERSION) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (typeof projection.source.contractSha256 !== 'string' || !HEX64.test(projection.source.contractSha256)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');

  // Nodes: the exact frozen subjects, in inventory order, each with FULL
  // coverage, unknown frozen to false, and an empty counterevidence array.
  if (!Array.isArray(projection.nodes)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  const seenIds = new Set();
  for (const node of projection.nodes) {
    if (node === null || typeof node !== 'object' || Array.isArray(node)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    exactKeys(node, NATIVE_NODE_KEYS, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
    const subject = NATIVE_FROZEN_SUBJECTS.find((candidate) => typeof node.id === 'string' && candidate.id === node.id);
    if (subject === undefined || node.kind !== subject.kind) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    exactKeys(node.sourceEvidence, NATIVE_SOURCE_EVIDENCE_KEYS, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
    if (node.sourceEvidence.contract !== NATIVE_SOURCE_CONTRACT) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    if (typeof node.sourceEvidence.contractSha256 !== 'string' || !HEX64.test(node.sourceEvidence.contractSha256)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    if (node.sourceEvidence.reference !== subject.reference) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    if (node.authority !== 'NONE') fail('XRA_KS01_NATIVE_AUTHORITY_DENIED');
    if (node.coverage !== 'FULL' || node.unknown !== false
      || !Array.isArray(node.counterevidence) || node.counterevidence.length > 0) fail('XRA_KS01_NATIVE_UNKNOWN_COLLAPSE_DENIED');
    if (seenIds.has(node.id)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    seenIds.add(node.id);
  }
  if (projection.nodes.length !== NATIVE_FROZEN_SUBJECTS.length) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  for (const subject of NATIVE_FROZEN_SUBJECTS) if (!seenIds.has(subject.id)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');

  // Edge: the single frozen relation, established only by its two frozen source
  // receipts in the declared order.
  if (!Array.isArray(projection.edges) || projection.edges.length !== 1) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  const edge = projection.edges[0];
  if (edge === null || typeof edge !== 'object' || Array.isArray(edge)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  exactKeys(edge, NATIVE_EDGE_KEYS, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (edge.from !== NATIVE_EDGE_FROM || edge.to !== NATIVE_EDGE_TO || edge.relation !== NATIVE_EDGE_RELATION) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  exactKeys(edge.sourceEvidence, NATIVE_SOURCE_EVIDENCE_KEYS, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (edge.sourceEvidence.contract !== NATIVE_SOURCE_CONTRACT) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (typeof edge.sourceEvidence.contractSha256 !== 'string' || !HEX64.test(edge.sourceEvidence.contractSha256)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (edge.sourceEvidence.reference !== NATIVE_EDGE_SOURCE_REFERENCE) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (!Array.isArray(edge.evidence) || edge.evidence.length !== NATIVE_EVIDENCE_ROLES.length) fail('XRA_KS01_NATIVE_EVIDENCE_MISSING_DENIED');
  edge.evidence.forEach((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    exactKeys(entry, NATIVE_EVIDENCE_KEYS, 'XRA_KS01_NATIVE_CONTRACT_DENIED');
    if (entry.evidenceRole !== NATIVE_EVIDENCE_ROLES[index]) fail('XRA_KS01_NATIVE_EVIDENCE_MISSING_DENIED');
    if (typeof entry.evidenceId !== 'string' || entry.evidenceId.length < 1) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    if (typeof entry.evidenceVersion !== 'string' || entry.evidenceVersion.length < 1) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
    if (typeof entry.evidenceSha256 !== 'string' || !HEX64.test(entry.evidenceSha256)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  });
  if (typeof edge.evidenceSha256 !== 'string' || !HEX64.test(edge.evidenceSha256)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  if (edge.authority !== 'NONE' || edge.promotion !== 'NOT_AUTHORIZED' || edge.effect !== 'NONE'
    || edge.relationTruthClaimed !== false || edge.relationTruth !== 'NOT_GRANTED') fail('XRA_KS01_NATIVE_AUTHORITY_DENIED');
  if (edge.coverage !== 'FULL' || edge.unknown !== false
    || !Array.isArray(edge.counterevidence) || edge.counterevidence.length > 0) fail('XRA_KS01_NATIVE_UNKNOWN_COLLAPSE_DENIED');

  // Body self-digest shape (the value is checked against the sidecar pin in the
  // pipeline provenance gate, not here).
  if (typeof projection.projectionDigest !== 'string' || !HEX64.test(projection.projectionDigest)) fail('XRA_KS01_NATIVE_CONTRACT_DENIED');
  return projection;
}