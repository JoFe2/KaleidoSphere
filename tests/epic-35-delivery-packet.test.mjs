// Synthetic, dependency-free tests for the final epic #35 local delivery /
// closure packet template. No provider, network, repository fixture, or live
// release state is consulted. The validator below is deliberately local and
// fail-closed so the acceptance cases remain executable and auditable.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const PACKET_TEMPLATE = 'docs/evidence/progressive-analysis/epic-35-delivery-packet.template.json';
const COMMENT_TEMPLATE = 'docs/evidence/progressive-analysis/epic-35-close-comment.template.md';
const ALLOWED_PATHS = [
  COMMENT_TEMPLATE,
  PACKET_TEMPLATE,
  'tests/epic-35-delivery-packet.test.mjs',
].sort();
const CHILDREN = [36, 37, 38, 39, 40];
const DEPENDENCIES = {
  36: [],
  37: [36],
  38: [36, 37],
  39: [36, 37, 38],
  40: [36, 37, 38, 39],
};

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const sha40 = (value) => sha256(value).slice(0, 40);
const canonicalize = (value) => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
};
const terminalHash = (packet) => {
  const { terminal_hash: _terminalHash, ...withoutTerminalHash } = packet;
  return sha256(canonicalize(withoutTerminalHash));
};
const childOf = (packet, issue) => packet.children.find((child) => child.child_issue === issue);
const clone = (value) => structuredClone(value);
const ref = (issue, name) => `fixtures/synthetic/epic-35/child-${issue}/${name}.json`;
const noReleaseRationaleRef = 'fixtures/synthetic/epic-35/no-release-rationale.json';
const reverseKeys = (value) => {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).reverse().map(([key, child]) => [key, reverseKeys(child)]));
  }
  return value;
};

function buildSyntheticPacket({ released = true } = {}) {
  const baseSha = sha40('origin-main-base');
  const reviewedHeadSha = sha40('reviewed-task-head');
  const foundationRefs = [
    'fixtures/synthetic/epic-35/breadth-gate.json',
    'fixtures/synthetic/epic-35/receipt-foundation.json',
  ];
  const children = CHILDREN.map((issue) => {
    const fixture = ref(issue, 'deterministic-fixture');
    const negative = ref(issue, 'negative-probe');
    const exactHeadReceipt = ref(issue, 'exact-head-ci');
    const exactMainReceipt = ref(issue, 'exact-main-ci');
    const headSha = sha40(`child-${issue}-protected-head`);
    const mergeSha = sha40(`child-${issue}-merged-main`);
    const publicReadbackRef = ref(issue, 'public-readback');
    const evidenceRefs = [fixture, negative, exactHeadReceipt, exactMainReceipt, ...(released ? [publicReadbackRef] : [])];
    return {
      child_issue: issue,
      ci: {
        exact_head: {
          conclusion: 'success',
          evidence_ref: exactHeadReceipt,
          run_id: `ci-head-${issue}`,
          sha: headSha,
        },
        exact_main: {
          conclusion: 'success',
          evidence_ref: exactMainReceipt,
          run_id: `ci-main-${issue}`,
          sha: mergeSha,
        },
      },
      closed_rationale: null,
      depends_on: DEPENDENCIES[issue],
      disposition: 'merged',
      evidence: {
        deterministic_fixture: {
          evidence_ref: fixture,
          sha256: sha256(`fixture-${issue}`),
        },
        evidence_refs: evidenceRefs,
        negative_probes: [
          {
            evidence_ref: negative,
            probe_id: `probe-${issue}-rejects-invalid-input`,
            result: 'rejected',
          },
        ],
      },
      merged_pr: {
        base_ref: 'main',
        head_sha: headSha,
        merge_sha: mergeSha,
        number: 600 + issue,
        protected: true,
      },
      nonclaims: [`Child #${issue} does not establish performance, customer outcome, or causality.`],
      release_decision: {
        decision: released ? 'released' : 'no_release',
        public_readback: released
          ? {
              readback_id: `readback-child-${issue}`,
              evidence_ref: publicReadbackRef,
              status: 'success',
              tag: `v1.35.${issue}`,
              tag_sha: sha40(`child-${issue}-release-tag`),
            }
          : null,
        tag: released ? `v1.35.${issue}` : null,
        tag_sha: released ? sha40(`child-${issue}-release-tag`) : null,
      },
    };
  });

  const evidenceIndex = [
    ...foundationRefs.map((evidenceRef, index) => ({ evidence_ref: evidenceRef, kind: 'foundation', owner_issue: index === 0 ? 36 : 37 })),
    ...children.flatMap((child) => [
      ...child.evidence.evidence_refs.map((evidenceRef) => ({ evidence_ref: evidenceRef, kind: evidenceRef.includes('negative') ? 'negative_probe' : evidenceRef.includes('ci') ? 'ci' : 'fixture', owner_issue: child.child_issue })),
      { evidence_ref: ref(child.child_issue, 'external-action'), kind: 'external_action', owner_issue: child.child_issue },
    ]),
    { evidence_ref: 'fixtures/synthetic/epic-35/epic-readback.json', kind: 'readback', owner_issue: 35 },
    { evidence_ref: noReleaseRationaleRef, kind: 'decision', owner_issue: 35 },
  ];
  const packet = {
    artifact_kind: 'epic-35-local-delivery-closure-packet',
    children,
    claim_boundary: {
      allowed: 'Only claims joined to exact provider identifiers, SHAs, decisions, and repository-relative evidence refs in this packet.',
      prohibited: 'Do not add source records, sensitive material, statement text, causal outcome claims, or unjoined provider prose.',
    },
    contract_version: 'epic-35-delivery-packet/v1',
    decision: released
      ? {
          closure: 'eligible',
          public_release_claim: {
            readback_id: 'readback-epic-35',
            evidence_ref: 'fixtures/synthetic/epic-35/epic-readback.json',
            status: 'success',
            tag: 'v1.35.40',
            tag_sha: sha40('epic-35-release-tag'),
          },
          rationale: null,
          release: 'released',
        }
      : {
          closure: 'not_eligible',
          public_release_claim: null,
          rationale: {
            evidence_refs: [noReleaseRationaleRef],
            reason_code: 'release-withheld',
            statement: 'No public release is claimed because the final release decision was withheld.',
          },
          release: 'no_release',
        },
    epic: {
      critical_path: CHILDREN,
      issue: 35,
      repository: 'JoFe2/KaleidoSphere',
    },
    evidence_index: evidenceIndex,
    external_actions: CHILDREN.map((issue) => ({
      action: 'read_provider_state',
      action_id: `action-child-${issue}`,
      child_issue: issue,
      evidence_ref: ref(issue, 'external-action'),
      observed: {
        identifier: `github-object-child-${issue}`,
        result: 'readback-success',
      },
      provider: 'github',
    })),
    foundations: {
      breadth_gate: {
        evidence_refs: [foundationRefs[0]],
        gated_by_child: 36,
      },
      receipt_foundation: {
        evidence_refs: [foundationRefs[1]],
        gated_by_children: [36, 37],
      },
    },
    lineage: {
      base_sha: baseSha,
      head_sha: reviewedHeadSha,
    },
    nonclaims: [
      'This packet does not establish product performance, customer outcome, or causality.',
      'Synthetic fixture identifiers are not live external state unless independently read back.',
      'No action is authorized by this packet; it records readbacks only.',
    ],
    terminal_hash: null,
    work_receipt: {
      base_sha: baseSha,
      changed_paths: ALLOWED_PATHS,
      diff_check: 'git diff --check origin/main...HEAD',
      focused_test: 'node --test tests/epic-35-delivery-packet.test.mjs',
      head_sha: reviewedHeadSha,
      task_id: 'QWEN-KS-35-DELIVERY-PACKET-06',
    },
  };
  packet.external_actions.forEach((action) => {
    // The provider receipt is intentionally indexed above, but a child action
    // must also be part of that child's evidence join.
    const child = childOf(packet, action.child_issue);
    child.evidence.evidence_refs.push(action.evidence_ref);
  });
  packet.terminal_hash = terminalHash(packet);
  return packet;
}

const FORBIDDEN_KEY = /raw|source_row|row_material|cell_value|business_row|password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|private[_-]?key|sql/i;
const CREDENTIAL_VALUE = /\b(?:password|passwd|secret|token|api[_-]?key|access[_-]?key|credential|credentials|private[_-]?key)\b\s*[:=]/i;
const SQL_VALUE = /\b(?:select|insert|update|delete|drop|truncate|alter|create|execute|exec|merge|grant|revoke)\b\s+\S/i;
const RAW_VALUE = /RAW_VALUE:/i;
const CAUSAL_CLAIM = /\b(?:caused|causes|proves|proved|resulted in|led to|increased|decreased|improved)\b/i;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA64 = /^[0-9a-f]{64}$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_.\-/]*$/;
const REASON_CODE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVIDENCE_KINDS = new Set(['fixture', 'negative_probe', 'ci', 'foundation', 'external_action', 'readback', 'decision']);

function failure(code, path, detail = code) {
  return { ok: false, code, path, detail };
}
function objectShape(value, keys, path) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return failure('E-SHAPE', path, 'expected object');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalize(actual) !== canonicalize(expected)) return failure('E-SHAPE', path, 'object keys do not match the closed packet shape');
  return null;
}
function scanContent(value, path = '$') {
  if (typeof value === 'string') {
    if (CREDENTIAL_VALUE.test(value)) return failure('E-CONTENT-CREDENTIAL', path);
    if (SQL_VALUE.test(value)) return failure('E-CONTENT-SQL', path);
    if (RAW_VALUE.test(value)) return failure('E-CONTENT-RAW', path);
    if (CAUSAL_CLAIM.test(value)) return failure('E-CONTENT-CAUSAL', path);
    return null;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = scanContent(value[index], `${path}[${index}]`);
      if (result) return result;
    }
    return null;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value).sort()) {
      if (FORBIDDEN_KEY.test(key)) return failure('E-CONTENT-KEY', `${path}.${key}`);
      const result = scanContent(value[key], `${path}.${key}`);
      if (result) return result;
    }
  }
  return null;
}

function shapePacket(packet) {
  const top = objectShape(packet, ['artifact_kind', 'children', 'claim_boundary', 'contract_version', 'decision', 'epic', 'evidence_index', 'external_actions', 'foundations', 'lineage', 'nonclaims', 'terminal_hash', 'work_receipt'], '$');
  if (top) return top;
  if (typeof packet.artifact_kind !== 'string' || typeof packet.contract_version !== 'string' || !SHA64.test(packet.terminal_hash)) return failure('E-SHAPE', '$');
  if (!Array.isArray(packet.children) || packet.children.length !== 5) return failure('E-SHAPE', '$.children');
  if (!Array.isArray(packet.nonclaims) || packet.nonclaims.length < 1) return failure('E-SHAPE', '$.nonclaims');
  const claimBoundary = objectShape(packet.claim_boundary, ['allowed', 'prohibited'], '$.claim_boundary');
  if (claimBoundary) return claimBoundary;
  const epic = objectShape(packet.epic, ['critical_path', 'issue', 'repository'], '$.epic');
  if (epic || packet.epic.issue !== 35 || packet.epic.repository !== 'JoFe2/KaleidoSphere') return epic ?? failure('E-SHAPE', '$.epic');
  const lineage = objectShape(packet.lineage, ['base_sha', 'head_sha'], '$.lineage');
  if (lineage || !SHA40.test(packet.lineage.base_sha) || !SHA40.test(packet.lineage.head_sha)) return lineage ?? failure('E-SHAPE', '$.lineage');
  const decision = objectShape(packet.decision, ['closure', 'public_release_claim', 'rationale', 'release'], '$.decision');
  if (decision) return decision;
  const receipt = objectShape(packet.work_receipt, ['base_sha', 'changed_paths', 'diff_check', 'focused_test', 'head_sha', 'task_id'], '$.work_receipt');
  if (receipt || packet.work_receipt.base_sha !== packet.lineage.base_sha || packet.work_receipt.head_sha !== packet.lineage.head_sha) return receipt ?? failure('E-SHAPE', '$.work_receipt');
  const foundation = objectShape(packet.foundations, ['breadth_gate', 'receipt_foundation'], '$.foundations');
  if (foundation) return foundation;
  const breadth = objectShape(packet.foundations.breadth_gate, ['evidence_refs', 'gated_by_child'], '$.foundations.breadth_gate');
  if (breadth) return breadth;
  const foundationReceipt = objectShape(packet.foundations.receipt_foundation, ['evidence_refs', 'gated_by_children'], '$.foundations.receipt_foundation');
  if (foundationReceipt) return foundationReceipt;
  if (!Array.isArray(packet.foundations.breadth_gate.evidence_refs) || !Array.isArray(packet.foundations.receipt_foundation.evidence_refs)) return failure('E-SHAPE', '$.foundations');
  if (!Array.isArray(packet.foundations.receipt_foundation.gated_by_children)) return failure('E-SHAPE', '$.foundations.receipt_foundation.gated_by_children');
  if (!Array.isArray(packet.evidence_index) || packet.evidence_index.length < 1) return failure('E-SHAPE', '$.evidence_index');
  if (!Array.isArray(packet.external_actions) || packet.external_actions.length < 1) return failure('E-SHAPE', '$.external_actions');

  for (let index = 0; index < packet.evidence_index.length; index += 1) {
    const entry = packet.evidence_index[index];
    const entryPath = `$.evidence_index[${index}]`;
    const entryShape = objectShape(entry, ['evidence_ref', 'kind', 'owner_issue'], entryPath);
    if (entryShape || !REF.test(entry.evidence_ref) || !EVIDENCE_KINDS.has(entry.kind) || ![35, ...CHILDREN].includes(entry.owner_issue)) return entryShape ?? failure('E-SHAPE', entryPath);
  }
  for (let index = 0; index < packet.external_actions.length; index += 1) {
    const action = packet.external_actions[index];
    const actionPath = `$.external_actions[${index}]`;
    const actionShape = objectShape(action, ['action', 'action_id', 'child_issue', 'evidence_ref', 'observed', 'provider'], actionPath);
    if (actionShape || typeof action.action !== 'string' || typeof action.action_id !== 'string' || !CHILDREN.includes(action.child_issue) || !REF.test(action.evidence_ref) || action.provider !== 'github') return actionShape ?? failure('E-SHAPE', actionPath);
    const observed = objectShape(action.observed, ['identifier', 'result'], `${actionPath}.observed`);
    if (observed || typeof action.observed.identifier !== 'string' || typeof action.observed.result !== 'string') return observed ?? failure('E-SHAPE', `${actionPath}.observed`);
  }

  for (let index = 0; index < packet.children.length; index += 1) {
    const child = packet.children[index];
    const childPath = `$.children[${index}]`;
    const childShape = objectShape(child, ['child_issue', 'ci', 'closed_rationale', 'depends_on', 'disposition', 'evidence', 'merged_pr', 'nonclaims', 'release_decision'], childPath);
    if (childShape) return childShape;
    if (!Number.isInteger(child.child_issue) || !Array.isArray(child.depends_on) || !Array.isArray(child.nonclaims)) return failure('E-SHAPE', childPath);
    const evidence = objectShape(child.evidence, ['deterministic_fixture', 'evidence_refs', 'negative_probes'], `${childPath}.evidence`);
    if (evidence) return evidence;
    const fixture = objectShape(child.evidence.deterministic_fixture, ['evidence_ref', 'sha256'], `${childPath}.evidence.deterministic_fixture`);
    if (fixture || !REF.test(child.evidence.deterministic_fixture.evidence_ref) || !SHA64.test(child.evidence.deterministic_fixture.sha256)) return fixture ?? failure('E-SHAPE', `${childPath}.evidence.deterministic_fixture`);
    if (!Array.isArray(child.evidence.evidence_refs) || child.evidence.evidence_refs.length < 1 || child.evidence.evidence_refs.some((evidenceRef) => !REF.test(evidenceRef)) || !Array.isArray(child.evidence.negative_probes) || child.evidence.negative_probes.length < 1) return failure('E-SHAPE', `${childPath}.evidence`);
    for (const probe of child.evidence.negative_probes) {
      const probeShape = objectShape(probe, ['evidence_ref', 'probe_id', 'result'], `${childPath}.evidence.negative_probes`);
      if (probeShape || typeof probe.evidence_ref !== 'string' || typeof probe.probe_id !== 'string' || probe.result !== 'rejected') return probeShape ?? failure('E-SHAPE', `${childPath}.evidence.negative_probes`);
    }
    if (child.ci !== null) {
      const ci = objectShape(child.ci, ['exact_head', 'exact_main'], `${childPath}.ci`);
      if (ci) return ci;
      for (const lane of ['exact_head', 'exact_main']) {
        const laneShape = objectShape(child.ci[lane], ['conclusion', 'evidence_ref', 'run_id', 'sha'], `${childPath}.ci.${lane}`);
        if (laneShape || child.ci[lane].conclusion !== 'success' || !REF.test(child.ci[lane].evidence_ref) || typeof child.ci[lane].run_id !== 'string' || !child.ci[lane].run_id || !SHA40.test(child.ci[lane].sha)) return laneShape ?? failure('E-SHAPE', `${childPath}.ci.${lane}`);
      }
    }
    if (child.merged_pr !== null) {
      const pr = objectShape(child.merged_pr, ['base_ref', 'head_sha', 'merge_sha', 'number', 'protected'], `${childPath}.merged_pr`);
      if (pr || child.merged_pr.base_ref !== 'main' || !SHA40.test(child.merged_pr.head_sha) || !SHA40.test(child.merged_pr.merge_sha) || !Number.isInteger(child.merged_pr.number) || child.merged_pr.protected !== true) return pr ?? failure('E-SHAPE', `${childPath}.merged_pr`);
    }
    if (child.release_decision !== null) {
      const release = objectShape(child.release_decision, ['decision', 'public_readback', 'tag', 'tag_sha'], `${childPath}.release_decision`);
      if (release || !['released', 'no_release'].includes(child.release_decision.decision) || (child.release_decision.tag !== null && typeof child.release_decision.tag !== 'string') || (child.release_decision.tag_sha !== null && !SHA40.test(child.release_decision.tag_sha))) return release ?? failure('E-SHAPE', `${childPath}.release_decision`);
      if (child.release_decision.public_readback !== null) {
        const readback = objectShape(child.release_decision.public_readback, ['evidence_ref', 'readback_id', 'status', 'tag', 'tag_sha'], `${childPath}.release_decision.public_readback`);
        if (readback || !REF.test(child.release_decision.public_readback.evidence_ref) || typeof child.release_decision.public_readback.readback_id !== 'string' || !child.release_decision.public_readback.readback_id || child.release_decision.public_readback.status !== 'success' || typeof child.release_decision.public_readback.tag !== 'string' || !SHA40.test(child.release_decision.public_readback.tag_sha)) return readback ?? failure('E-SHAPE', `${childPath}.release_decision.public_readback`);
      }
    }
  }
  return null;
}

function validatePacket(packet) {
  if (packet === null || typeof packet !== 'object' || Array.isArray(packet)) return failure('E-SHAPE', '$');
  const content = scanContent(packet);
  if (content) return content;
  const shape = shapePacket(packet);
  if (shape) return shape;
  if (packet.contract_version !== 'epic-35-delivery-packet/v1') return failure('E-SHAPE', '$.contract_version');
  if (canonicalize(packet.epic.critical_path) !== canonicalize(CHILDREN)) return failure('E-R02', '$.epic.critical_path');
  const issues = packet.children.map((child) => child.child_issue);
  if (canonicalize(issues) !== canonicalize(CHILDREN)) return failure('E-R01', '$.children');
  const byIssue = new Map(packet.children.map((child) => [child.child_issue, child]));
  for (const child of packet.children) {
    if (canonicalize(child.depends_on) !== canonicalize(DEPENDENCIES[child.child_issue])) return failure('E-R02', `$.children[${child.child_issue}].depends_on`);
    if (child.disposition === 'merged') {
      for (const dependency of child.depends_on) {
        if (byIssue.get(dependency)?.disposition !== 'merged') return failure('E-R03', `$.children[${child.child_issue}]`);
      }
    } else if (child.disposition !== 'closed_no_delivery') {
      return failure('E-SHAPE', `$.children[${child.child_issue}].disposition`);
    }
  }
  if (packet.foundations.breadth_gate.gated_by_child !== 36) return failure('E-R06', '$.foundations.breadth_gate.gated_by_child');
  if (canonicalize(packet.foundations.receipt_foundation.gated_by_children) !== canonicalize([36, 37])) return failure('E-R06', '$.foundations.receipt_foundation.gated_by_children');
  if (packet.lineage.base_sha !== packet.work_receipt.base_sha || packet.lineage.head_sha !== packet.work_receipt.head_sha) return failure('E-R08', '$.work_receipt');
  const indexedRefs = new Set(packet.evidence_index.map((entry) => entry.evidence_ref));
  if (indexedRefs.size !== packet.evidence_index.length) return failure('E-R08', '$.evidence_index');
  if (packet.foundations.breadth_gate.evidence_refs.length < 1 || packet.foundations.receipt_foundation.evidence_refs.length < 1 || packet.foundations.breadth_gate.evidence_refs.some((evidenceRef) => !indexedRefs.has(evidenceRef)) || packet.foundations.receipt_foundation.evidence_refs.some((evidenceRef) => !indexedRefs.has(evidenceRef))) return failure('E-R06', '$.foundations');
  for (const child of packet.children) {
    if (child.evidence.evidence_refs.some((evidenceRef) => !indexedRefs.has(evidenceRef))) return failure('E-R08', `$.children[${child.child_issue}].evidence`);
    if (child.evidence.negative_probes.some((probe) => !indexedRefs.has(probe.evidence_ref))) return failure('E-R08', `$.children[${child.child_issue}].evidence.negative_probes`);
    if (!child.evidence.evidence_refs.includes(child.evidence.deterministic_fixture.evidence_ref) || child.evidence.negative_probes.some((probe) => !child.evidence.evidence_refs.includes(probe.evidence_ref))) return failure('E-R08', `$.children[${child.child_issue}].evidence`);
    if (child.disposition === 'merged') {
      if (child.merged_pr === null || child.closed_rationale !== null || child.merged_pr.head_sha === child.merged_pr.merge_sha) return failure('E-R04', `$.children[${child.child_issue}]`);
      if (child.ci === null) return failure('E-R05', `$.children[${child.child_issue}].ci`);
      if (child.ci.exact_head.sha !== child.merged_pr.head_sha || child.ci.exact_main.sha !== child.merged_pr.merge_sha) return failure('E-R05', `$.children[${child.child_issue}].ci`);
      if (![child.ci.exact_head.evidence_ref, child.ci.exact_main.evidence_ref].every((evidenceRef) => indexedRefs.has(evidenceRef) && child.evidence.evidence_refs.includes(evidenceRef))) return failure('E-R05', `$.children[${child.child_issue}].ci`);
      if (child.release_decision === null) return failure('E-R05', `$.children[${child.child_issue}].release_decision`);
      const release = child.release_decision;
      if (release.decision === 'released') {
        if (release.tag === null || release.tag_sha === null || release.public_readback === null) return failure('E-R05', `$.children[${child.child_issue}].release_decision`);
        if (release.public_readback.status !== 'success' || release.public_readback.tag !== release.tag || release.public_readback.tag_sha !== release.tag_sha || !indexedRefs.has(release.public_readback.evidence_ref) || !child.evidence.evidence_refs.includes(release.public_readback.evidence_ref)) return failure('E-R05', `$.children[${child.child_issue}].release_decision.public_readback`);
      } else if (release.tag !== null || release.tag_sha !== null || release.public_readback !== null) {
        return failure('E-R05', `$.children[${child.child_issue}].release_decision`);
      }
    } else {
      if (child.merged_pr !== null || child.ci !== null || child.release_decision !== null) return failure('E-R04', `$.children[${child.child_issue}]`);
      const rationale = child.closed_rationale;
      const rationaleShape = rationale === null ? failure('E-R04', `$.children[${child.child_issue}].closed_rationale`) : objectShape(rationale, ['evidence_refs', 'reason_code', 'statement'], `$.children[${child.child_issue}].closed_rationale`);
      if (rationaleShape || !REASON_CODE.test(rationale.reason_code) || !Array.isArray(rationale.evidence_refs) || rationale.evidence_refs.length < 1 || rationale.evidence_refs.some((evidenceRef) => !REF.test(evidenceRef) || !indexedRefs.has(evidenceRef)) || typeof rationale.statement !== 'string' || rationale.statement.length < 10) return rationaleShape ?? failure('E-R04', `$.children[${child.child_issue}].closed_rationale`);
    }
  }
  if (packet.decision.release === 'released') {
    if (packet.decision.public_release_claim === null || packet.decision.rationale !== null) return failure('E-R07', '$.decision');
    const claim = packet.decision.public_release_claim;
    const claimShape = objectShape(claim, ['evidence_ref', 'readback_id', 'status', 'tag', 'tag_sha'], '$.decision.public_release_claim');
    if (claimShape || !REF.test(claim.evidence_ref) || typeof claim.readback_id !== 'string' || !claim.readback_id || claim.status !== 'success' || typeof claim.tag !== 'string' || !claim.tag || !SHA40.test(claim.tag_sha) || !indexedRefs.has(claim.evidence_ref)) return claimShape ?? failure('E-R07', '$.decision.public_release_claim');
    if (packet.children.some((child) => child.disposition === 'merged' && child.release_decision.decision !== 'released')) return failure('E-R07', '$.decision.release');
  } else if (packet.decision.release === 'no_release') {
    const rationale = packet.decision.rationale;
    const rationaleShape = rationale === null ? failure('E-R07', '$.decision.rationale') : objectShape(rationale, ['evidence_refs', 'reason_code', 'statement'], '$.decision.rationale');
    if (packet.decision.public_release_claim !== null || rationaleShape || !REASON_CODE.test(rationale.reason_code) || !Array.isArray(rationale.evidence_refs) || rationale.evidence_refs.length < 1 || rationale.evidence_refs.some((evidenceRef) => !REF.test(evidenceRef) || !indexedRefs.has(evidenceRef)) || typeof rationale.statement !== 'string' || rationale.statement.length < 10) return rationaleShape ?? failure('E-R07', '$.decision');
    if (packet.children.some((child) => child.disposition === 'merged' && child.release_decision.decision !== 'no_release')) return failure('E-R07', '$.decision.release');
  } else {
    return failure('E-SHAPE', '$.decision.release');
  }
  if (packet.external_actions.some((action) => !action.action || !action.action_id || !action.observed.identifier || !action.observed.result || !indexedRefs.has(action.evidence_ref) || !childOf(packet, action.child_issue).evidence.evidence_refs.includes(action.evidence_ref))) return failure('E-R08', '$.external_actions');
  if (packet.terminal_hash !== terminalHash(packet)) return failure('E-R09', '$.terminal_hash');
  return { ok: true, code: 'OK' };
}

function expectRejected(label, packet, code) {
  const result = validatePacket(packet);
  assert.equal(result.ok, false, `${label} must fail closed`);
  assert.equal(result.code, code, `${label}: expected ${code}, got ${result.code}`);
}

function assertCanonicalKeys(value, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertCanonicalKeys(item, `${path}[${index}]`));
  if (value !== null && typeof value === 'object') {
    assert.deepEqual(Object.keys(value), [...Object.keys(value)].sort(), `${path} keys must be code-unit sorted`);
    for (const [key, child] of Object.entries(value)) assertCanonicalKeys(child, `${path}.${key}`);
  }
}

test('the template names every child, exact lineage fields, evidence joins, and the allowed work receipt', async () => {
  const template = JSON.parse(await readFile(PACKET_TEMPLATE, 'utf8'));
  const comment = await readFile(COMMENT_TEMPLATE, 'utf8');
  assertCanonicalKeys(template);
  assert.deepEqual(template.children.map((child) => child.child_issue), CHILDREN);
  assert.deepEqual(template.epic.critical_path, CHILDREN);
  assert.deepEqual(template.work_receipt.changed_paths, ALLOWED_PATHS);
  assert.equal(template.work_receipt.task_id, 'QWEN-KS-35-DELIVERY-PACKET-06');
  assert.equal(template.lineage.base_sha, template.work_receipt.base_sha);
  assert.equal(template.lineage.head_sha, template.work_receipt.head_sha);
  assert.match(comment, /exact-head CI/);
  assert.match(comment, /exact-main CI/);
  assert.match(comment, /external_actions/);
  assert.match(comment, /No-release branch/);
  assert.match(comment, /causal overclaim/);
});

test('a fully populated synthetic packet is canonical, joins every child receipt, and is valid', () => {
  const packet = buildSyntheticPacket();
  const reordered = reverseKeys(packet);
  assert.equal(canonicalize(packet), canonicalize(reordered), 'canonical serialization ignores input insertion order');
  assert.equal(packet.terminal_hash, terminalHash(packet));
  assert.deepEqual(validatePacket(packet), { ok: true, code: 'OK' });
  const indexed = new Set(packet.evidence_index.map((entry) => entry.evidence_ref));
  for (const child of packet.children) {
    assert.ok(child.evidence.evidence_refs.every((evidenceRef) => indexed.has(evidenceRef)));
    assert.ok(child.evidence.negative_probes.every((probe) => indexed.has(probe.evidence_ref)));
    assert.equal(child.ci.exact_head.sha, child.merged_pr.head_sha);
    assert.equal(child.ci.exact_main.sha, child.merged_pr.merge_sha);
    assert.equal(child.release_decision.public_readback.status, 'success');
  }
  assert.ok(packet.external_actions.every((action) => indexed.has(action.evidence_ref)));
  assert.ok(packet.nonclaims.length > 0);
});

test('a no-release packet is valid only with durable rationale and no public-release claim', () => {
  const packet = buildSyntheticPacket({ released: false });
  assert.deepEqual(validatePacket(packet), { ok: true, code: 'OK' });
  assert.equal(packet.decision.release, 'no_release');
  assert.equal(packet.decision.public_release_claim, null);
  assert.ok(packet.decision.rationale.evidence_refs.length > 0);
  assert.match(packet.decision.rationale.reason_code, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.equal(packet.children.every((child) => child.release_decision.decision === 'no_release'), true);
  expectRejected('no-release without durable rationale', (() => { const copy = clone(packet); copy.decision.rationale = null; return copy; })(), 'E-R07');
  expectRejected('no-release with a public-release claim', (() => { const copy = clone(packet); copy.decision.public_release_claim = { readback_id: 'claim', status: 'success', tag: 'v1.35.40', tag_sha: sha40('claim') }; return copy; })(), 'E-R07');
});

test('missing child, critical edge, or foundation fails closed', () => {
  const missingChild = buildSyntheticPacket();
  missingChild.children.pop();
  expectRejected('missing child', missingChild, 'E-SHAPE');

  const missingEdge = buildSyntheticPacket();
  childOf(missingEdge, 38).depends_on = [36];
  expectRejected('missing critical dependency edge', missingEdge, 'E-R02');

  const missingFoundation = buildSyntheticPacket();
  delete missingFoundation.foundations.receipt_foundation;
  expectRejected('missing receipt foundation', missingFoundation, 'E-SHAPE');

  const missingFoundationReceipt = buildSyntheticPacket();
  missingFoundationReceipt.foundations.breadth_gate.evidence_refs = [];
  expectRejected('missing breadth-gate receipt', missingFoundationReceipt, 'E-R06');

  const reorderedChildren = buildSyntheticPacket();
  reorderedChildren.children.reverse();
  expectRejected('noncanonical child order', reorderedChildren, 'E-R01');

  const bypass = buildSyntheticPacket();
  childOf(bypass, 36).disposition = 'closed_no_delivery';
  childOf(bypass, 36).merged_pr = null;
  childOf(bypass, 36).ci = null;
  childOf(bypass, 36).release_decision = null;
  childOf(bypass, 36).closed_rationale = { evidence_refs: ['fixtures/synthetic/epic-35/closed-36.json'], reason_code: 'withheld', statement: 'No delivery was made.' };
  expectRejected('parity depth bypass of breadth gate', bypass, 'E-R03');
});

test('missing protected merge, CI, release decision, or released readback fails closed', () => {
  const missingMerge = buildSyntheticPacket();
  childOf(missingMerge, 36).merged_pr = null;
  expectRejected('missing protected merge', missingMerge, 'E-R04');

  const missingCi = buildSyntheticPacket();
  childOf(missingCi, 36).ci = null;
  expectRejected('missing exact CI pair', missingCi, 'E-R05');

  const missingRelease = buildSyntheticPacket();
  childOf(missingRelease, 36).release_decision = null;
  expectRejected('missing release decision', missingRelease, 'E-R05');

  const missingReadback = buildSyntheticPacket();
  childOf(missingReadback, 36).release_decision.public_readback = null;
  expectRejected('released child without public readback', missingReadback, 'E-R05');

  const forgedHeadJoin = buildSyntheticPacket();
  childOf(forgedHeadJoin, 36).ci.exact_head.sha = sha40('forged-head');
  expectRejected('exact-head CI not bound to PR head', forgedHeadJoin, 'E-R05');
});

test('forged terminal hash, causal overclaim, raw value, credential, DDL/DML, and free SQL reject', () => {
  const forged = buildSyntheticPacket();
  forged.terminal_hash = forged.terminal_hash.replace(/^./, forged.terminal_hash.startsWith('0') ? '1' : '0');
  expectRejected('forged terminal hash', forged, 'E-R09');

  const causal = buildSyntheticPacket();
  causal.external_actions[0].observed.result = 'release caused customer growth';
  expectRejected('causal overclaim', causal, 'E-CONTENT-CAUSAL');

  const raw = buildSyntheticPacket();
  raw.nonclaims.push('RAW_VALUE: fixture row');
  expectRejected('raw value marker', raw, 'E-CONTENT-RAW');

  const credential = buildSyntheticPacket();
  credential.external_actions[0].observed.result = 'api_key=hunter2';
  expectRejected('credential value', credential, 'E-CONTENT-CREDENTIAL');

  const ddl = buildSyntheticPacket();
  ddl.external_actions[0].observed.result = 'DROP TABLE accounts';
  expectRejected('DDL statement', ddl, 'E-CONTENT-SQL');

  const dml = buildSyntheticPacket();
  dml.external_actions[0].observed.result = 'DELETE FROM accounts';
  expectRejected('DML statement', dml, 'E-CONTENT-SQL');

  const sql = buildSyntheticPacket();
  sql.external_actions[0].sql_receipt = 'select 1';
  expectRejected('free SQL field', sql, 'E-CONTENT-KEY');
});

test('unknown fields and unjoined external actions fail closed', () => {
  const unknown = buildSyntheticPacket();
  unknown.children[0].unjoined_note = 'not evidence';
  expectRejected('unknown child field', unknown, 'E-SHAPE');

  const action = buildSyntheticPacket();
  action.external_actions[0].action_id = '';
  expectRejected('external action without exact identifier', action, 'E-R08');

  const unindexed = buildSyntheticPacket();
  unindexed.evidence_index = unindexed.evidence_index.filter((entry) => entry.evidence_ref !== ref(36, 'external-action'));
  expectRejected('external action without joined evidence', unindexed, 'E-R08');
});

test('the work receipt keeps exact base/head lineage and only the three allowlisted paths', () => {
  const packet = buildSyntheticPacket();
  assert.deepEqual(packet.work_receipt.changed_paths, ALLOWED_PATHS);
  assert.equal(new Set(packet.work_receipt.changed_paths).size, 3);
  assert.equal(packet.lineage.base_sha, packet.work_receipt.base_sha);
  assert.equal(packet.lineage.head_sha, packet.work_receipt.head_sha);
  assert.equal(packet.work_receipt.task_id, 'QWEN-KS-35-DELIVERY-PACKET-06');
  const drift = clone(packet);
  drift.work_receipt.head_sha = sha40('different-reviewed-head');
  expectRejected('work receipt head drift', drift, 'E-SHAPE');
});
