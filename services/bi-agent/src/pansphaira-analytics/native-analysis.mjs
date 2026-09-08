// XRA-KS-01 — the one predeclared native edge-evidence coverage analysis
// (separately versioned from the relational analysis). A deterministic function
// of the canonical native projection: it emits structural node/edge/evidence
// counts, preserves the UNKNOWN channel, and reports counterevidence. It makes
// no knowledge-effectiveness or relation-truth claim. No I/O, no clock, no
// random, no network.

import { createHash } from 'node:crypto';
import { canonicalJson } from '../../../bi-control/src/canonical-json.js';

export const NATIVE_ANALYSIS_ID = 'pansphaira/native-edge-evidence-coverage-analysis';
export const NATIVE_ANALYSIS_VERSION = 'v1';
export const NATIVE_ANALYSIS_SCHEMA = 'kaleidosphere.pansphaira-analytics/edge-evidence-analysis-contract/v1';
export const NATIVE_COVERAGE_ASPECT_KEYS = Object.freeze([
  'nodes', 'edges', 'evidence', 'source', 'unknownChannel', 'counterevidence',
]);
export const NATIVE_COVERAGE_STATUSES = Object.freeze(['HELD', 'OBSERVED', 'UNKNOWN']);
export const NATIVE_COUNTEREVIDENCE_CLAIM_IDS = Object.freeze([
  'nodes', 'edges', 'evidence', 'source', 'unknownChannel', 'counterevidence',
]);
export const NATIVE_COUNTEREVIDENCE_STATUSES = Object.freeze(['EVIDENCE_FOUND', 'HELD', 'MATCH', 'NONE_FOUND', 'UNKNOWN']);
export const NATIVE_COMPUTED_CLAIM_KEYS = Object.freeze([
  'decisionNodeCount', 'edgeCount', 'evidenceCount', 'frozenReceiptsEstablishingEdge',
  'knowledgeNodeCount', 'nodeCount', 'counterevidenceTotal', 'unknownTotal',
]);
export const NATIVE_OBSERVED_CLAIM_KEYS = Object.freeze([
  'authority', 'edgeRelation', 'evidenceRoles', 'nonclaimCount',
  'nodeIds', 'nodeKinds', 'promotion', 'relationTruth', 'sourceContract', 'sourceContractVersion',
]);

const sha256hex = (value) => createHash('sha256').update(value).digest('hex');

export function analyzeNativeProjection(projection, releaseEvidence) {
  const nodes = projection.nodes;
  const edge = projection.edges[0];
  const unknownTotal = projection.nodes.reduce((sum, node) => sum + (node.unknown === true ? 1 : 0), 0)
    + projection.edges.reduce((sum, item) => sum + (item.unknown === true ? 1 : 0), 0);
  const counterevidenceTotal = projection.nodes.reduce((sum, node) => sum + node.counterevidence.length, 0)
    + projection.edges.reduce((sum, item) => sum + item.counterevidence.length, 0);

  const computed = {
    nodeCount: nodes.length,
    edgeCount: projection.edges.length,
    evidenceCount: edge.evidence.length,
    knowledgeNodeCount: nodes.filter((node) => node.kind === 'KNOWLEDGE').length,
    decisionNodeCount: nodes.filter((node) => node.kind === 'DECISION').length,
    unknownTotal,
    counterevidenceTotal,
    frozenReceiptsEstablishingEdge: edge.evidence.length,
  };
  const observed = {
    nodeIds: nodes.map((node) => node.id),
    nodeKinds: nodes.map((node) => node.kind),
    edgeRelation: edge.relation,
    evidenceRoles: edge.evidence.map((entry) => entry.evidenceRole),
    sourceContract: projection.source.contract,
    sourceContractVersion: projection.source.contractVersion,
    authority: projection.authority,
    promotion: projection.promotion,
    relationTruth: projection.relationTruth,
    nonclaimCount: projection.nonclaims.length,
  };

  const releaseObserved = releaseEvidence.status === 'OBSERVED';
  const coverage = {
    nodes: 'OBSERVED',
    edges: 'OBSERVED',
    evidence: 'OBSERVED',
    source: releaseObserved ? 'OBSERVED' : 'HELD',
    unknownChannel: unknownTotal === 0 ? 'OBSERVED' : 'UNKNOWN',
    counterevidence: counterevidenceTotal === 0 ? 'OBSERVED' : 'EVIDENCE_FOUND',
  };
  const counterevidence = [
    { claim: 'nodes', check: 'frozen subject inventory and duplicate node identifiers', observed: computed.nodeCount, status: 'NONE_FOUND' },
    { claim: 'edges', check: 'the single frozen purpose-bound relation', observed: computed.edgeCount, status: 'NONE_FOUND' },
    { claim: 'evidence', check: 'the edge established by its frozen source receipts', observed: computed.frozenReceiptsEstablishingEdge, status: 'NONE_FOUND' },
    { claim: 'source', check: 'native source binding to the pinned CKS proof input', observed: releaseObserved ? releaseEvidence.releasedEntryCount : 0, status: releaseObserved ? 'EVIDENCE_FOUND' : 'HELD' },
    { claim: 'unknownChannel', check: 'unknown frozen to false on every node and edge', observed: unknownTotal, status: 'NONE_FOUND' },
    { claim: 'counterevidence', check: 'per-node and per-edge counterevidence arrays remain empty', observed: counterevidenceTotal, status: 'NONE_FOUND' },
  ];

  const claims = { observed, computed };
  const resultSha256 = sha256hex(canonicalJson({ claims, coverage, counterevidence }));
  return { claims, coverage, counterevidence, resultSha256 };
}