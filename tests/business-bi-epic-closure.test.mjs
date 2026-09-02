import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { canonicalJson } from '../services/bi-control/src/canonical-json.js';

const RECORD_PATH = 'verification/business-bi-epic-closure-v1.json';
const SCHEMA_VERSION = 'kaleidosphere.e-bi-1/business-bi-epic-closure/v1';
const TASK_ID = 'PORTFOLIO-KS143-INTEGRATE';
const D044_MANIFEST_SHA256 = 'ed5a4228960969045687d136040c0231bff2c066ce894e7d018dcc7242971031';
const CAPTURED_MAIN = '2cdcdd956f522ee27717db8597a5828b15a934e8';
const EXPECTED_CHILD_SET_SHA256 = '89fb260bec130261b8ad3f8aa4def473e511d1feb1f30ba9bfd62c3b9f40ef64';
const EXPECTED_PUBLIC_THREAD_SET_SHA256 = '41f6e3a24e7a67f673b87925d082996b970f008718bcc94405d75d5e8d35b3e8';
const EXPECTED_RECORD_SHA256 = 'e5bb99559082db20cec2a73c3679b14de27dda2af4bdf2e3bb0c0ee0cd6a69c3';

const CHILD_KEYS = Object.freeze([
  'JoFe2/KaleidoSphere#145',
  'JoFe2/KaleidoSphere#146',
  'JoFe2/KaleidoSphere#147',
]);
const PUBLIC_ISSUE_KEYS = Object.freeze([
  'JoFe2/KaleidoSphere#143',
  ...CHILD_KEYS,
]);
const PARENT_ACCEPTANCE_IDS = Object.freeze([
  'E-BI-1-AC01',
  'E-BI-1-AC02',
  'E-BI-1-AC03',
]);
const CANONICAL_FOCUSED_FAMILY = Object.freeze([
  'tests/business-bi-metric-oracle.test.mjs',
  'tests/business-bi-net-revenue-plan.test.mjs',
  'tests/business-bi-clean-room.test.mjs',
]);
const PARENT_TEST_PATH = 'tests/business-bi-epic-closure.test.mjs';
const RELEASE_PATH_CLASSES = Object.freeze({
  public: Object.freeze([
    'README.md',
  ]),
  evidence: Object.freeze([
    'docs/evidence/business-bi-net-revenue-v1.md',
    'scripts/run-business-bi-falsification-clean-room.mjs',
    'tests/business-bi-clean-room.test.mjs',
    'tests/business-bi-epic-closure.test.mjs',
    'verification/business-bi-epic-closure-v1.json',
    'verification/business-bi-net-revenue-falsification-v1.json',
  ]),
});

const EXPECTED_PARENT_ACCEPTANCE = Object.freeze([
  Object.freeze({
    id: 'E-BI-1-AC01',
    title: 'Every child Acceptance ID remains uniquely owned and dependency-correct.',
    sourceAnchor: 'issue-body:parent-acceptance-child-ownership',
    owner: TASK_ID,
    status: 'PASS',
  }),
  Object.freeze({
    id: 'E-BI-1-AC02',
    title: 'Every child reaches a public evidence-bound terminal outcome.',
    sourceAnchor: 'issue-body:parent-acceptance-child-terminal',
    owner: TASK_ID,
    status: 'PASS',
  }),
  Object.freeze({
    id: 'E-BI-1-AC03',
    title: 'The parent reports PASS, FALSIFIED, and BLOCKED_EXTERNAL separately and closes only after exact child readback.',
    sourceAnchor: 'issue-body:parent-acceptance-outcome-readback',
    owner: TASK_ID,
    status: 'PASS',
  }),
]);

const EXPECTED_ACCEPTANCE = Object.freeze({
  'JoFe2/KaleidoSphere#145': Object.freeze([
    Object.freeze({
      id: 'BI-KS-01-AC01',
      title: 'Contract fixes one relation, one order-date role, one currency, two periods, and explicit credit/cancel/UNKNOWN rules.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-01-AC02',
      title: 'Frozen holdout contains positive, credit, cancelled, boundary-date, null, and UNKNOWN cases without production/customer data.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-01-AC03',
      title: 'An independent calculator emits exact period totals and delta without importing production analysis code.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-01-AC04',
      title: 'Applicability and non-applicability of PSai Canon laws are recorded at issue admission.',
      status: 'PASS',
    }),
  ]),
  'JoFe2/KaleidoSphere#146': Object.freeze([
    Object.freeze({
      id: 'BI-KS-02-AC01',
      title: 'Only one versioned operation with the exact metric/holdout/oracle tuple can execute.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-02-AC02',
      title: 'Execution is read-only, bounded, timeout/cancellation-aware, returns one aggregate row, and never collapses partial/denied/unsupported/unknown to success.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-02-AC03',
      title: 'JSON and TABLE readbacks bind metric, oracle, result, coverage, and nonclaims identically.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-02-AC04',
      title: 'Exact oracle match and all negative tests pass before publication.',
      status: 'PASS',
    }),
  ]),
  'JoFe2/KaleidoSphere#147': Object.freeze([
    Object.freeze({
      id: 'BI-KS-03-AC01',
      title: 'Clean-room runs from exact Main/release head with frozen input, metric, plan, oracle, result, coverage, and environment digests.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-03-AC02',
      title: 'Wrong oracle, substituted metric, widened scope, UNKNOWN-to-zero, and cancelled-row inclusion each fail closed.',
      status: 'PASS',
    }),
    Object.freeze({
      id: 'BI-KS-03-AC03',
      title: 'Public claim is exactly one admitted-holdout metric and reports satisfied criteria/total criteria separately from delivered packages.',
      status: 'PASS',
    }),
  ]),
});

const EXPECTED_DEPENDENCIES = Object.freeze({
  'JoFe2/KaleidoSphere#145': Object.freeze([]),
  'JoFe2/KaleidoSphere#146': Object.freeze(['JoFe2/KaleidoSphere#145']),
  'JoFe2/KaleidoSphere#147': Object.freeze(['JoFe2/KaleidoSphere#146']),
});

const EXPECTED_ISSUES = Object.freeze({
  'JoFe2/KaleidoSphere#143': Object.freeze({
    bodySha256: 'c068cb5c43c27a8305c47b3d46212e8276379d2f686f195007060279de532c02',
    state: 'open',
    stateReason: null,
    title: '[E-BI-1] Narrow business BI falsification proof',
    commentId: null,
    commentBodySha256: null,
  }),
  'JoFe2/KaleidoSphere#145': Object.freeze({
    bodySha256: '7148f787413bc62fe2f9a2bd0a1c35d3969dbc1c06222934a231618e7f650d17',
    state: 'closed',
    stateReason: 'completed',
    title: '[BI-KS-01] Freeze one admitted net-revenue metric, holdout, and independent oracle',
    commentId: 5497389020,
    commentBodySha256: 'd0cbd285b63389b243a52bc9c70510f1896b6e95a812399c3cd16de84dc07694',
  }),
  'JoFe2/KaleidoSphere#146': Object.freeze({
    bodySha256: '3015cf6355bd2c204eedd818370264e5dd24aa61abba59393dfa440284419001',
    state: 'closed',
    stateReason: 'completed',
    title: '[BI-KS-02] Execute one closed typed net-revenue aggregate and deterministic JSON/TABLE readback',
    commentId: 5507368104,
    commentBodySha256: '0871101399f2e7932374436cbd648d38005c558025852312af644ae7b5bc3a00',
  }),
  'JoFe2/KaleidoSphere#147': Object.freeze({
    bodySha256: '32777a27dabac1cca9d86e3ea007032e5e2663cf051cf4049923c06d3b0369c0',
    state: 'closed',
    stateReason: 'completed',
    title: '[BI-KS-03] Falsify the narrow BI claim in an isolated clean-room and publish bounded evidence',
    commentId: 5510406071,
    commentBodySha256: 'fc7258d30354a2992d2f2ceef2d13b3b0a4ef2bdb65c63d15e5dd951200534fa',
  }),
});

const EXPECTED_DELIVERY = Object.freeze({
  'JoFe2/KaleidoSphere#145': Object.freeze({
    prNumber: 154,
    prBase: '90c574e9a06cb752be06270395d44a31eabc44ae',
    prHead: '9bf02230cd9cea8cced8352c9a9a2cc35fdde974',
    prCiRunId: 33534218190,
    mergeSha: '22b3d38b33a96165be11b98c347c371f31c95d12',
    mainCiRunId: 33534283854,
    releaseId: 380675389,
    releaseTag: '2026_09_01_v2',
    releasePublishedAt: '2026-09-01T16:51:51Z',
    relation: 'ANCESTOR',
    receiptCommentId: 5497389020,
  }),
  'JoFe2/KaleidoSphere#146': Object.freeze({
    prNumber: 156,
    prBase: '06631e2cebce56f50f37e15610de3cd73b84a6a6',
    prHead: 'c01ae391cf432a7e7d133b18b97c71b38c0425f4',
    prCiRunId: 33613680938,
    mergeSha: '764d0f7a1bad9e8e407b96e1b2340baa1e001af6',
    mainCiRunId: 33613748752,
    releaseId: 381121360,
    releaseTag: '2026_09_02_v1',
    releasePublishedAt: '2026-09-02T09:23:02Z',
    relation: 'ANCESTOR',
    receiptCommentId: 5507368104,
  }),
  'JoFe2/KaleidoSphere#147': Object.freeze({
    prNumber: 158,
    prBase: '764d0f7a1bad9e8e407b96e1b2340baa1e001af6',
    prHead: '09253e7375eff4bf541dd2986b05f0e6a8fa117e',
    prCiRunId: 33636594248,
    mergeSha: CAPTURED_MAIN,
    mainCiRunId: 33636657853,
    releaseId: 381289961,
    releaseTag: '2026_09_02_v2',
    releasePublishedAt: '2026-09-02T13:36:06Z',
    relation: 'EQUAL',
    receiptCommentId: 5510406071,
  }),
});

const EXPECTED_QUEUE = Object.freeze({
  'JoFe2/KaleidoSphere#145': Object.freeze({
    taskId: 'PORTFOLIO-KS145-ROOT-QS',
    claimGeneration: 18,
    eventId: 8584,
    occurredAt: 1788281516.8344033,
    controllerId: 'pop-os:1006352:closure:JoFe2-KaleidoSphere',
  }),
  'JoFe2/KaleidoSphere#146': Object.freeze({
    taskId: 'PORTFOLIO-KS146-ROOT-QS',
    claimGeneration: 18,
    eventId: 16522,
    occurredAt: 1788340987.3773723,
    controllerId: 'pop-os:702040:closure:JoFe2-KaleidoSphere',
  }),
  'JoFe2/KaleidoSphere#147': Object.freeze({
    taskId: 'PORTFOLIO-KS147-ROOT-QS',
    claimGeneration: 14,
    eventId: 16617,
    occurredAt: 1788356174.3135405,
    controllerId: 'pop-os:1398293:closure:JoFe2-KaleidoSphere',
  }),
});

const EXPECTED_OUTCOMES = Object.freeze({
  'JoFe2/KaleidoSphere#145': Object.freeze({
    class: 'PASS',
    basis: 'METRIC_HOLDOUT_AND_INDEPENDENT_ORACLE_ACCEPTED',
    acceptanceSatisfied: 4,
    acceptanceTotal: 4,
    falsified: false,
    blockedExternal: false,
    unknown: false,
  }),
  'JoFe2/KaleidoSphere#146': Object.freeze({
    class: 'PASS',
    basis: 'CLOSED_TYPED_AGGREGATE_AND_IDENTITY_EQUAL_READBACK_ACCEPTED',
    acceptanceSatisfied: 4,
    acceptanceTotal: 4,
    falsified: false,
    blockedExternal: false,
    unknown: false,
  }),
  'JoFe2/KaleidoSphere#147': Object.freeze({
    class: 'PASS',
    basis: 'NARROW_SYNTHETIC_CLAIM_SURVIVED_ISOLATED_FALSIFICATION',
    acceptanceSatisfied: 3,
    acceptanceTotal: 3,
    falsified: false,
    blockedExternal: false,
    unknown: false,
  }),
});

const EXPECTED_CLAIM_BOUNDARY = Object.freeze({
  admittedMetricCount: 1,
  metricIds: Object.freeze(['bi-ks-01-net-revenue']),
  classification: 'SYNTHETIC_NON_CUSTOMER_BYTES',
  productionMetricCount: 0,
  broaderBiCapabilityClaimed: false,
  productiveSourceUsed: false,
  customerDataUsed: false,
  externalEffectPerformed: false,
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function digestValue(value) {
  return sha256(canonicalJson(value));
}

function loadRecord() {
  return JSON.parse(readFileSync(RECORD_PATH, 'utf8'));
}

function requireCondition(condition, code) {
  if (!condition) throw new Error(code);
}

function exactArray(actual, expected, code) {
  requireCondition(Array.isArray(actual), `${code}:NOT_ARRAY`);
  requireCondition(canonicalJson(actual) === canonicalJson(expected), code);
}

function unique(values) {
  return new Set(values).size === values.length;
}

function recordDigest(record) {
  const copy = structuredClone(record);
  delete copy.integrity.recordSha256;
  return digestValue(copy);
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function validateRecord(input) {
  requireCondition(input !== null && typeof input === 'object' && !Array.isArray(input), 'STRUCTURE');
  const record = structuredClone(input);
  requireCondition(record.schemaVersion === SCHEMA_VERSION, 'SCHEMA_VERSION');
  requireCondition(record.taskId === TASK_ID, 'TASK_ID');
  requireCondition(record.status === 'INTEGRATION_READY_FOR_DELIVERY_NOT_PARENT_CLOSED', 'STATUS');
  requireCondition(record.authority?.operatingModel === 'Operating Model v1.1', 'OPERATING_MODEL');
  exactArray(record.authority?.preservedDecisions, ['D-001', 'D-002', 'D-003', 'D-004', 'D-005', 'D-006', 'D-007'], 'PROCESS_DECISIONS');
  requireCondition(record.authority?.frozenPortfolio?.authorityDecision === 'D-044', 'D044_AUTHORITY');
  requireCondition(record.authority?.frozenPortfolio?.manifestSha256 === D044_MANIFEST_SHA256, 'D044_MANIFEST');
  exactArray(record.authority?.frozenPortfolio?.parentDependencies, CHILD_KEYS, 'D044_CHILDREN');
  requireCondition(record.authority?.closureGraph?.graphId === `JoFe2/KaleidoSphere#143@${CAPTURED_MAIN}`, 'CLOSURE_GRAPH');
  requireCondition(record.authority?.closureGraph?.artifactSha256 === '092508718c4c5bf020ed59b517e4355d4cf3e82120a68eaeb4f0e23e335e6a97', 'CLOSURE_GRAPH_DIGEST');
  requireCondition(record.authority?.closureGraph?.graphManifestDigest === 'fe928025ca9b09d83aed2f613c588ffba05105dc8ff3de866dbc423bc90435cf', 'CLOSURE_GRAPH_MANIFEST');
  requireCondition(record.authority?.closureGraph?.materializationReceiptSha256 === 'c7b41cd2e9b8f0be4dea75045bb2400b261f57de3238665cf8cb2cd3f10c194b', 'MATERIALIZATION_RECEIPT');
  for (const key of CHILD_KEYS) {
    requireCondition(record.authority.closureGraph.predecessorStates[key] === 'PUBLIC_CLOSED_RELEASE_READBACK_QUEUE_DONE', `PREDECESSOR:${key}`);
  }

  requireCondition(record.capture?.currentMain?.commit === CAPTURED_MAIN, 'CURRENT_MAIN');
  requireCondition(record.capture?.currentMain?.parent === '764d0f7a1bad9e8e407b96e1b2340baa1e001af6', 'CURRENT_MAIN_PARENT');
  requireCondition(record.capture?.currentMain?.tree === '51d5be66ac612781301df2736354e63140f8323f', 'CURRENT_MAIN_TREE');
  requireCondition(record.capture?.anonymousPublicReadback === true, 'PUBLIC_READBACK');
  requireCondition(record.capture?.publicTransport === 'ANONYMOUS_GITHUB_REST' && record.capture?.authorizationHeaderSent === false, 'PUBLIC_TRANSPORT');
  requireCondition(record.capture?.queueReadOnly === true && record.capture?.queueMutationCount === 0, 'QUEUE_CAPTURE_MUTATED');
  requireCondition(record.capture?.productiveSystemsCalled === false && record.capture?.credentialsUsed === false && record.capture?.customerDataUsed === false, 'CAPTURE_BOUNDARY');

  exactArray(record.parent?.integrationAcceptance, EXPECTED_PARENT_ACCEPTANCE, 'PARENT_ACCEPTANCE');
  exactArray(record.parent.integrationAcceptance.map(({ id }) => id), PARENT_ACCEPTANCE_IDS, 'PARENT_ACCEPTANCE_IDS');
  requireCondition(unique(record.parent.integrationAcceptance.map(({ id }) => id)), 'PARENT_ACCEPTANCE_DUPLICATE');
  exactArray(record.parent?.remainingCriterionIds, [], 'PARENT_REMAINDER');
  requireCondition(canonicalJson(record.parent?.acceptanceSummary) === canonicalJson({ satisfiedCriteria: 3, totalCriteria: 3 }), 'PARENT_ACCEPTANCE_SUMMARY');
  requireCondition(record.parent?.publicIssueState === 'open' && record.parent?.publicIssueStateReason === null, 'PARENT_PREMATURE_CLOSURE');
  requireCondition(record.parent?.publicClosurePerformed === false && record.parent?.finalOwner === 'PORTFOLIO-KS143-ROOT-QS', 'PARENT_CLOSURE_OWNER');

  const publicIssues = record.publicIssues;
  requireCondition(Array.isArray(publicIssues), 'PUBLIC_ISSUES');
  exactArray(publicIssues.map(({ issueKey }) => issueKey), PUBLIC_ISSUE_KEYS, 'PUBLIC_ISSUE_SET');
  requireCondition(unique(publicIssues.map(({ issueKey }) => issueKey)), 'PUBLIC_ISSUE_DUPLICATE');
  const issueByKey = new Map();
  const commentIds = [];
  for (const issue of publicIssues) {
    const expected = EXPECTED_ISSUES[issue.issueKey];
    requireCondition(expected !== undefined, `ISSUE_EXPECTATION:${issue.issueKey}`);
    requireCondition(issue.title === expected.title, `ISSUE_TITLE:${issue.issueKey}`);
    requireCondition(issue.bodySha256 === expected.bodySha256, `ISSUE_BODY:${issue.issueKey}`);
    requireCondition(issue.state === expected.state && issue.stateReason === expected.stateReason, `ISSUE_STATE:${issue.issueKey}`);
    requireCondition(issue.repository === 'JoFe2/KaleidoSphere' && issue.number === Number(issue.issueKey.split('#')[1]), `ISSUE_IDENTITY:${issue.issueKey}`);
    requireCondition(issue.url === `https://github.com/${issue.issueKey.replace('#', '/issues/')}`, `ISSUE_URL:${issue.issueKey}`);
    requireCondition(issue.apiUrl === `https://api.github.com/repos/${issue.issueKey.replace('#', '/issues/')}`, `ISSUE_API_URL:${issue.issueKey}`);
    if (expected.commentId === null) {
      exactArray(issue.comments, [], `ISSUE_COMMENTS:${issue.issueKey}`);
    } else {
      requireCondition(Array.isArray(issue.comments) && issue.comments.length === 1, `ISSUE_COMMENTS:${issue.issueKey}`);
      const comment = issue.comments[0];
      requireCondition(comment.id === expected.commentId && comment.bodySha256 === expected.commentBodySha256, `ISSUE_COMMENT:${issue.issueKey}`);
      requireCondition(comment.author === 'JoFe2' && comment.authorAssociation === 'OWNER', `ISSUE_COMMENT_OWNER:${issue.issueKey}`);
      commentIds.push(comment.id);
    }
    issueByKey.set(issue.issueKey, issue);
  }
  requireCondition(unique(commentIds), 'ISSUE_COMMENT_DUPLICATE');

  const children = record.children;
  requireCondition(Array.isArray(children), 'CHILDREN');
  exactArray(children.map(({ issueKey }) => issueKey), CHILD_KEYS, 'CHILD_SET');
  requireCondition(unique(children.map(({ issueKey }) => issueKey)), 'CHILD_DUPLICATE');
  const childByKey = new Map();
  const allAcceptanceIds = [];
  for (const [index, child] of children.entries()) {
    const key = child.issueKey;
    const expectedDelivery = EXPECTED_DELIVERY[key];
    const expectedQueue = EXPECTED_QUEUE[key];
    requireCondition(child.ordinal === index + 1, `CHILD_ORDINAL:${key}`);
    requireCondition(child.acceptanceOwner === expectedQueue.taskId, `ACCEPTANCE_OWNER:${key}`);
    exactArray(child.acceptance, EXPECTED_ACCEPTANCE[key], `ACCEPTANCE_SET:${key}`);
    const ids = child.acceptance.map(({ id }) => id);
    requireCondition(unique(ids), `ACCEPTANCE_DUPLICATE:${key}`);
    allAcceptanceIds.push(...ids);
    exactArray(child.dependencies?.declared, EXPECTED_DEPENDENCIES[key], `DEPENDENCIES:${key}`);
    requireCondition(canonicalJson(child.terminalOutcome) === canonicalJson(EXPECTED_OUTCOMES[key]), `TERMINAL_OUTCOME:${key}`);

    requireCondition(Array.isArray(child.evidenceBindings) && child.evidenceBindings.length === 2, `EVIDENCE_BINDINGS:${key}`);
    for (const binding of child.evidenceBindings) {
      requireCondition(/^[a-f0-9]{64}$/.test(binding.sha256), `EVIDENCE_DIGEST:${key}`);
      requireCondition(sha256(readFileSync(binding.path)) === binding.sha256, `EVIDENCE_BYTES:${key}:${binding.path}`);
    }

    const delivery = child.publicDelivery;
    requireCondition(delivery.pr?.number === expectedDelivery.prNumber && delivery.pr?.state === 'closed', `PR_IDENTITY:${key}`);
    requireCondition(delivery.pr?.baseSha === expectedDelivery.prBase && delivery.pr?.headSha === expectedDelivery.prHead, `PR_HEAD:${key}`);
    requireCondition(delivery.pr?.mergeSha === expectedDelivery.mergeSha && delivery.finalMergeSha === expectedDelivery.mergeSha, `MERGE_HEAD:${key}`);
    requireCondition(delivery.prCi?.runId === expectedDelivery.prCiRunId && delivery.prCi?.event === 'pull_request', `PR_CI_IDENTITY:${key}`);
    requireCondition(delivery.prCi?.headSha === expectedDelivery.prHead && delivery.prCi?.status === 'completed' && delivery.prCi?.conclusion === 'success' && delivery.prCi?.runAttempt === 1, `PR_CI:${key}`);
    requireCondition(delivery.mainCi?.runId === expectedDelivery.mainCiRunId && delivery.mainCi?.event === 'push', `MAIN_CI_IDENTITY:${key}`);
    requireCondition(delivery.mainCi?.headSha === expectedDelivery.mergeSha && delivery.mainCi?.status === 'completed' && delivery.mainCi?.conclusion === 'success' && delivery.mainCi?.runAttempt === 1, `MAIN_CI:${key}`);
    requireCondition(delivery.relationToCapturedMain === expectedDelivery.relation, `MAIN_RELATION:${key}`);
    requireCondition(delivery.release?.id === expectedDelivery.releaseId && delivery.release?.tag === expectedDelivery.releaseTag, `RELEASE_IDENTITY:${key}`);
    requireCondition(delivery.release?.target === expectedDelivery.mergeSha && delivery.release?.publishedAt === expectedDelivery.releasePublishedAt, `RELEASE_TARGET:${key}`);
    requireCondition(delivery.release?.draft === false && delivery.release?.prerelease === false && Array.isArray(delivery.release?.assets), `RELEASE_STATE:${key}`);
    requireCondition(delivery.receiptCommentId === expectedDelivery.receiptCommentId, `PUBLIC_RECEIPT:${key}`);
    requireCondition(issueByKey.get(key)?.comments.some(({ id }) => id === delivery.receiptCommentId), `PUBLIC_RECEIPT_THREAD:${key}`);

    const readback = delivery.anonymousReadback;
    requireCondition(readback !== null && typeof readback === 'object', `ANONYMOUS_READBACK_MISSING:${key}`);
    requireCondition(readback.status === 'PASS' && readback.transport === 'ANONYMOUS_GITHUB_REST' && readback.authorizationHeaderSent === false, `ANONYMOUS_READBACK_STATUS:${key}`);
    requireCondition(readback.issueState === 'closed' && readback.issueStateReason === 'completed', `ANONYMOUS_READBACK_ISSUE:${key}`);
    requireCondition(readback.capturedMainSha === CAPTURED_MAIN && readback.finalMergeReachableFromCapturedMain === true, `ANONYMOUS_READBACK_MAIN:${key}`);
    requireCondition(readback.releaseTarget === expectedDelivery.mergeSha && readback.tagResolvedSha === expectedDelivery.mergeSha, `ANONYMOUS_READBACK_HEAD:${key}`);
    requireCondition(readback.tagRef === `refs/tags/${expectedDelivery.releaseTag}` && readback.tagObjectType === 'commit', `ANONYMOUS_READBACK_TAG:${key}`);
    requireCondition(readback.releaseDraft === false && readback.releasePrerelease === false && Array.isArray(readback.assets), `ANONYMOUS_READBACK_RELEASE:${key}`);

    const terminal = child.terminalProof;
    requireCondition(terminal?.kind === 'QUEUE_DONE' && terminal.taskId === expectedQueue.taskId, `QUEUE_TASK:${key}`);
    requireCondition(terminal.state === 'DONE' && terminal.packageDoneSubstitution === false, `QUEUE_DONE:${key}`);
    requireCondition(terminal.attempt === 0 && terminal.claimGeneration === expectedQueue.claimGeneration, `QUEUE_GENERATION:${key}`);
    requireCondition(terminal.resultHead === expectedDelivery.prHead && terminal.resultHeadSemantics === 'REVIEWED_PR_HEAD', `QUEUE_RESULT_HEAD:${key}`);
    requireCondition(terminal.deliveryFinalHead === expectedDelivery.mergeSha, `QUEUE_DELIVERY_HEAD:${key}`);
    requireCondition(terminal.unowned === true && canonicalJson(terminal.lease) === canonicalJson({ claimedAt: null, controllerId: null, heartbeatAt: null, workerPid: null, workerStartTicks: null }), `QUEUE_UNOWNED:${key}`);
    requireCondition(terminal.doneEvent?.eventId === expectedQueue.eventId && terminal.doneEvent?.occurredAtEpochSeconds === expectedQueue.occurredAt, `QUEUE_EVENT:${key}`);
    requireCondition(terminal.doneEvent?.fromState === 'RELEASED' && terminal.doneEvent?.toState === 'DONE' && terminal.doneEvent?.attempt === 0, `QUEUE_TRANSITION:${key}`);
    requireCondition(terminal.doneEvent?.controllerId === expectedQueue.controllerId && terminal.doneEvent?.details === null, `QUEUE_EVENT_EXACT:${key}`);
    childByKey.set(key, child);
  }
  requireCondition(unique(allAcceptanceIds), 'GLOBAL_ACCEPTANCE_DUPLICATE');
  requireCondition(allAcceptanceIds.length === 11, 'GLOBAL_ACCEPTANCE_COUNT');

  for (const child of children) {
    for (const dependencyKey of child.dependencies.declared) {
      const dependency = childByKey.get(dependencyKey);
      requireCondition(dependency !== undefined, `DEPENDENCY_MISSING:${child.issueKey}:${dependencyKey}`);
      requireCondition(dependency.publicDelivery.release.publishedAt < child.publicDelivery.release.publishedAt, `DEPENDENCY_ORDER:${child.issueKey}:${dependencyKey}`);
    }
  }

  const outcomes = record.outcomeReport;
  exactArray(outcomes?.classes.map(({ class: outcomeClass }) => outcomeClass), ['PASS', 'FALSIFIED', 'BLOCKED_EXTERNAL'], 'OUTCOME_CLASS_SET');
  const expectedBuckets = outcomes.classes.map(({ class: outcomeClass }) => ({
    class: outcomeClass,
    childIssueKeys: children.filter((child) => child.terminalOutcome.class === outcomeClass).map(({ issueKey }) => issueKey),
    count: children.filter((child) => child.terminalOutcome.class === outcomeClass).length,
  }));
  requireCondition(canonicalJson(outcomes.classes) === canonicalJson(expectedBuckets), 'OUTCOME_BUCKETS');
  requireCondition(outcomes.collapsed === false && outcomes.parentDisposition === 'PASS', 'OUTCOME_DISPOSITION');
  requireCondition(canonicalJson(outcomes.unknown) === canonicalJson({ childIssueKeys: [], count: 0, promotedToSuccess: false }), 'UNKNOWN_PROMOTION');
  requireCondition(canonicalJson(record.claimBoundary) === canonicalJson(EXPECTED_CLAIM_BOUNDARY), 'CLAIM_BOUNDARY');

  requireCondition(record.governance?.packageDoneSubstitutesForDone === false, 'PACKAGE_DONE_GOVERNANCE');
  requireCondition(record.governance?.unknownMayPromoteToSuccess === false, 'UNKNOWN_GOVERNANCE');
  requireCondition(record.governance?.outcomeClassesMayCollapse === false, 'OUTCOME_GOVERNANCE');
  requireCondition(canonicalJson(record.governance?.canonicalTestRegistration) === canonicalJson({
    testPath: PARENT_TEST_PATH,
    gatePath: 'tests/source-map.test.mjs',
    method: 'SOURCE_GATE_IMPORT',
    packageJsonMutated: false,
    reason: 'PRESERVE_BI_KS_03_FROZEN_PACKAGE_PREIMAGE',
    executionSurfaces: [
      'node --test tests/business-bi-epic-closure.test.mjs',
      'npm run test:source',
      'npm test',
    ],
  }), 'CANONICAL_TEST_REGISTRATION');
  requireCondition(record.governance?.releaseGovernance?.serialWithinRepository === true, 'SERIAL_RELEASE_GOVERNANCE');
  requireCondition(record.governance?.releaseGovernance?.parentReleaseRequired === true && record.governance?.releaseGovernance?.tagStrategy === 'DAILY_SEQUENCE', 'PARENT_RELEASE_GOVERNANCE');
  requireCondition(sha256(readFileSync(record.governance.releaseGovernance.sourcePath)) === record.governance.releaseGovernance.sourceSha256, 'RELEASE_GOVERNANCE_DIGEST');
  requireCondition(record.governance?.deliveryBoundary?.externalEffectsPerformed === false && record.governance?.deliveryBoundary?.parentIssueClosed === false && record.governance?.deliveryBoundary?.queueMutated === false, 'DELIVERY_BOUNDARY');
  requireCondition(record.governance?.deferredParentStages?.owner === 'PORTFOLIO-KS143-ROOT-QS' && record.governance?.deferredParentStages?.workerPerformed === false, 'DEFERRED_PARENT_OWNER');
  requireCondition(Array.isArray(record.nonclaims) && record.nonclaims.length === 7, 'NONCLAIMS');
  requireCondition(record.nonclaims.some((value) => value.includes('does not close public parent issue #143')), 'NONCLAIM_PARENT');
  requireCondition(record.nonclaims.some((value) => value.includes('UNKNOWN is never promoted')), 'NONCLAIM_UNKNOWN');
  requireCondition(record.nonclaims.some((value) => value.includes('Empty FALSIFIED and BLOCKED_EXTERNAL buckets')), 'NONCLAIM_OUTCOMES');

  requireCondition(record.integrity?.childSetSha256 === EXPECTED_CHILD_SET_SHA256, 'CHILD_SET_DIGEST_FROZEN');
  requireCondition(digestValue(children) === record.integrity.childSetSha256, 'CHILD_SET_DIGEST');
  requireCondition(record.integrity?.publicThreadSetSha256 === EXPECTED_PUBLIC_THREAD_SET_SHA256, 'PUBLIC_THREAD_SET_DIGEST_FROZEN');
  requireCondition(digestValue(publicIssues) === record.integrity.publicThreadSetSha256, 'PUBLIC_THREAD_SET_DIGEST');
  requireCondition(record.integrity?.recordSha256 === EXPECTED_RECORD_SHA256, 'RECORD_DIGEST_FROZEN');
  requireCondition(recordDigest(record) === record.integrity.recordSha256, 'RECORD_DIGEST');
  return deepFreeze(record);
}

function denied(mutate, code) {
  const candidate = loadRecord();
  mutate(candidate);
  assert.throws(
    () => validateRecord(candidate),
    (error) => error instanceof Error && error.message.startsWith(code),
    code,
  );
}

function rebindIntegrity(record) {
  record.integrity.childSetSha256 = digestValue(record.children);
  record.integrity.publicThreadSetSha256 = digestValue(record.publicIssues);
  record.integrity.recordSha256 = recordDigest(record);
}

test('E-BI-1 cumulative record is byte-stable and binds exactly #145/#146/#147 plus AC01 through AC03 once', () => {
  const first = validateRecord(loadRecord());
  const second = validateRecord(JSON.parse(readFileSync(RECORD_PATH, 'utf8')));
  assert.equal(canonicalJson(first), canonicalJson(second));
  assert.equal(first.integrity.childSetSha256, EXPECTED_CHILD_SET_SHA256);
  assert.equal(first.integrity.publicThreadSetSha256, EXPECTED_PUBLIC_THREAD_SET_SHA256);
  assert.equal(first.integrity.recordSha256, EXPECTED_RECORD_SHA256);
  assert.deepStrictEqual(first.parent.integrationAcceptance.map(({ id }) => id), PARENT_ACCEPTANCE_IDS);
  assert.deepStrictEqual(first.children.map(({ issueKey }) => issueKey), CHILD_KEYS);
});

test('every child binds exact public PR/CI/merge/release/readback and unowned Queue DONE', () => {
  const record = validateRecord(loadRecord());
  for (const child of record.children) {
    assert.equal(child.publicDelivery.pr.mergeSha, child.publicDelivery.finalMergeSha);
    assert.equal(child.publicDelivery.release.target, child.publicDelivery.finalMergeSha);
    assert.equal(child.publicDelivery.anonymousReadback.tagResolvedSha, child.publicDelivery.finalMergeSha);
    assert.equal(child.publicDelivery.prCi.conclusion, 'success');
    assert.equal(child.publicDelivery.mainCi.conclusion, 'success');
    assert.equal(child.publicDelivery.anonymousReadback.status, 'PASS');
    assert.equal(child.terminalProof.state, 'DONE');
    assert.equal(child.terminalProof.unowned, true);
  }
});

test('PASS, FALSIFIED and BLOCKED_EXTERNAL remain separate even when only PASS is observed', () => {
  const record = validateRecord(loadRecord());
  assert.deepStrictEqual(record.outcomeReport.classes, [
    { class: 'PASS', childIssueKeys: CHILD_KEYS, count: 3 },
    { class: 'FALSIFIED', childIssueKeys: [], count: 0 },
    { class: 'BLOCKED_EXTERNAL', childIssueKeys: [], count: 0 },
  ]);
  assert.equal(record.outcomeReport.collapsed, false);
  assert.equal(record.outcomeReport.unknown.promotedToSuccess, false);
});

test('missing or duplicate child, child criterion, or parent criterion fails closed', () => {
  denied((record) => { record.children.pop(); }, 'CHILD_SET');
  denied((record) => { record.children.push(structuredClone(record.children[0])); }, 'CHILD_SET');
  denied((record) => { record.children[0].acceptance.pop(); }, 'ACCEPTANCE_SET:');
  denied((record) => { record.children[0].acceptance.push(structuredClone(record.children[0].acceptance[0])); }, 'ACCEPTANCE_SET:');
  denied((record) => { record.parent.integrationAcceptance.pop(); }, 'PARENT_ACCEPTANCE');
  denied((record) => { record.parent.integrationAcceptance.push(structuredClone(record.parent.integrationAcceptance[0])); }, 'PARENT_ACCEPTANCE');
});

test('wrong dependency and dependency release order fail closed', () => {
  denied((record) => { record.children[1].dependencies.declared = []; }, 'DEPENDENCIES:');
  denied((record) => { record.children[2].dependencies.declared = ['JoFe2/KaleidoSphere#145']; }, 'DEPENDENCIES:');
  denied((record) => { record.children[1].publicDelivery.release.publishedAt = '2026-09-01T00:00:00Z'; }, 'RELEASE_TARGET:');
});

test('stale or substituted issue, Main, PR head, merge head, and release fail closed', () => {
  denied((record) => { record.publicIssues[3].bodySha256 = '0'.repeat(64); }, 'ISSUE_BODY:');
  denied((record) => { record.capture.currentMain.commit = '0'.repeat(40); }, 'CURRENT_MAIN');
  denied((record) => { record.children[0].publicDelivery.pr.headSha = '0'.repeat(40); }, 'PR_HEAD:');
  denied((record) => { record.children[1].publicDelivery.finalMergeSha = '0'.repeat(40); }, 'MERGE_HEAD:');
  denied((record) => { record.children[2].publicDelivery.release.target = '0'.repeat(40); }, 'RELEASE_TARGET:');
  denied((record) => { record.children[2].publicDelivery.anonymousReadback.tagResolvedSha = '0'.repeat(40); }, 'ANONYMOUS_READBACK_HEAD:');
});

test('absent anonymous readback, PACKAGE_DONE, collapsed outcomes, and UNKNOWN promotion fail closed', () => {
  denied((record) => { delete record.children[0].publicDelivery.anonymousReadback; }, 'ANONYMOUS_READBACK_MISSING:');
  denied((record) => { record.children[1].terminalProof.state = 'PACKAGE_DONE'; }, 'QUEUE_DONE:');
  denied((record) => { record.outcomeReport.classes.splice(1, 1); }, 'OUTCOME_CLASS_SET');
  denied((record) => { record.outcomeReport.classes[1].class = 'PASS'; }, 'OUTCOME_CLASS_SET');
  denied((record) => { record.outcomeReport.unknown.promotedToSuccess = true; }, 'UNKNOWN_PROMOTION');
  denied((record) => { record.children[2].terminalOutcome.unknown = true; }, 'TERMINAL_OUTCOME:');
});

test('fully re-digested post-capture mutation and widened BI claim fail closed', () => {
  const redigested = loadRecord();
  redigested.capture.capturedAt = '2099-01-01T00:00:00Z';
  rebindIntegrity(redigested);
  assert.throws(() => validateRecord(redigested), /RECORD_DIGEST_FROZEN/);
  denied((record) => { record.claimBoundary.admittedMetricCount = 2; }, 'CLAIM_BOUNDARY');
  denied((record) => { record.claimBoundary.broaderBiCapabilityClaimed = true; }, 'CLAIM_BOUNDARY');
  denied((record) => { record.governance.deliveryBoundary.externalEffectsPerformed = true; }, 'DELIVERY_BOUNDARY');
});

test('validated snapshot is detached and deeply immutable after validation', () => {
  const mutable = loadRecord();
  const verified = validateRecord(mutable);
  mutable.children[0].publicDelivery.finalMergeSha = '0'.repeat(40);
  assert.equal(verified.children[0].publicDelivery.finalMergeSha, EXPECTED_DELIVERY[CHILD_KEYS[0]].mergeSha);
  assert.throws(() => validateRecord(mutable), /MERGE_HEAD/);
  assert.throws(() => { verified.children.push(structuredClone(verified.children[0])); }, TypeError);
  assert.throws(() => { verified.children[0].terminalOutcome.class = 'FALSIFIED'; }, TypeError);
});

test('canonical source gate, SOURCE-MAP, release, and README surfaces bind the parent evidence in repository order', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  const canonicalTests = pkg.scripts.test.split(/\s+/).slice(2);
  const familyStart = canonicalTests.indexOf(CANONICAL_FOCUSED_FAMILY[0]);
  assert.notEqual(familyStart, -1);
  assert.deepStrictEqual(canonicalTests.slice(familyStart, familyStart + CANONICAL_FOCUSED_FAMILY.length), CANONICAL_FOCUSED_FAMILY);
  for (const path of CANONICAL_FOCUSED_FAMILY) {
    assert.equal(canonicalTests.filter((candidate) => candidate === path).length, 1, path);
  }
  assert.equal(canonicalTests.includes(PARENT_TEST_PATH), false);
  const sourceGate = readFileSync('tests/source-map.test.mjs', 'utf8');
  assert.equal(
    (sourceGate.match(/import '\.\/business-bi-epic-closure\.test\.mjs';/g) ?? []).length,
    1,
  );

  const sourceMap = JSON.parse(readFileSync('SOURCE-MAP.json', 'utf8'));
  assert.deepStrictEqual(sourceMap.releasePathClasses.businessBiFalsification, RELEASE_PATH_CLASSES);
  for (const path of [RECORD_PATH, PARENT_TEST_PATH]) {
    assert.equal(sourceMap.files[path], sha256(readFileSync(path)), path);
  }
  const classifiedPaths = Object.values(RELEASE_PATH_CLASSES).flat();
  assert.equal(new Set(classifiedPaths).size, classifiedPaths.length);
  assert.deepStrictEqual(
    [...RELEASE_PATH_CLASSES.evidence],
    [...RELEASE_PATH_CLASSES.evidence].sort((left, right) => left.localeCompare(right)),
  );

  const readme = readFileSync('README.md', 'utf8');
  assert.match(readme, /`E-BI-1` cumulative evidence record binds the exact public\s+terminal\/release\/readback and Queue-DONE chains for #145, #146, and #147/i);
  assert.match(readme, /reports `PASS`, `FALSIFIED`, and `BLOCKED_EXTERNAL` as separate classes/i);
  assert.match(readme, /leaves parent #143 open for its own controlled delivery/i);
  assert.doesNotMatch(readme, /E-BI-1[^.\n]*(?:closes|closed) (?:parent )?#143/i);
});
