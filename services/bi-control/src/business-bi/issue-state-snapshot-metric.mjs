// #250: one additive fixed-domain snapshot metric, NOT a generic connector/engine.
// Authority is established by the maintainer outside this parser. A typed permission or
// matching digest is an integrity check, never proof of an owner's identity or consent.
// No network, writes, credential fields, raw-row output, synthetic-to-real promotion,
// business signoff, human answer or second-context execution.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../canonical-json.js';

const contractBytes = readFileSync(new URL('../../../../contracts/business-bi/v1/captured-open-issues.metric.json', import.meta.url));
const freeze = v => {
  if (v !== null && typeof v === 'object') { for (const x of Object.values(v)) freeze(x); Object.freeze(v); }
  return v;
};
export const ISSUE_SNAPSHOT_CONTRACT = freeze(JSON.parse(contractBytes));
export const ISSUE_SNAPSHOT_CONTRACT_SHA256 = createHash('sha256').update(contractBytes).digest('hex');
const FIELDS = Object.freeze(['id', 'number', 'state', 'createdAt', 'updatedAt', 'closedAt']);
const sha = b => createHash('sha256').update(b).digest('hex');
const exact = (v, fields) => v !== null && typeof v === 'object' && !Array.isArray(v)
  && Object.getPrototypeOf(v) === Object.prototype
  && JSON.stringify(Object.keys(v).sort()) === JSON.stringify([...fields].sort());
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
const denial = code => ({ outcome: 'DENIED', code: `KS250_ISSUE_SNAPSHOT_DENIED:${code}` });

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)
    || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  if (!value.endsWith('Z') && (Number(value.slice(-5, -3)) > 23 || Number(value.slice(-2)) > 59)) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

export function analyzeIssueStateSnapshot({ sourceBytes, permission, capture } = {}) {
  if (!(typeof sourceBytes === 'string' || Buffer.isBuffer(sourceBytes)) || permission === undefined || capture === undefined) return denial('INPUT_REQUIRED');
  if (!exact(permission, ['schemaVersion', 'contextId', 'repositoryId', 'sourceBytesSha256', 'access', 'allowedFields', 'grantId', 'grantedAt', 'secondContextApproved'])
    || permission.schemaVersion !== 'kaleidosphere.business-bi/issue-snapshot-permission/v1'
    || !id(permission.contextId) || !id(permission.repositoryId) || !hex(permission.sourceBytesSha256) || !hex(permission.grantId)
    || permission.access !== 'READ_ONLY_FROZEN_SNAPSHOT' || permission.secondContextApproved !== false
    || !Array.isArray(permission.allowedFields) || JSON.stringify([...permission.allowedFields].sort()) !== JSON.stringify([...FIELDS].sort())
    || instant(permission.grantedAt) === null) return denial('PERMISSION_SCOPE');
  const sourceHash = sha(sourceBytes);
  if (sourceHash !== permission.sourceBytesSha256) return denial('SOURCE_BYTES_MISMATCH');
  if (!exact(capture, ['schemaVersion', 'sourceBytesSha256', 'startedAt', 'finishedAt', 'atomic', 'pages'])
    || capture.schemaVersion !== 'kaleidosphere.business-bi/issue-snapshot-capture/v1'
    || capture.sourceBytesSha256 !== sourceHash || capture.atomic !== false
    || instant(capture.startedAt) === null || instant(capture.finishedAt) === null
    || instant(capture.startedAt) > instant(capture.finishedAt)
    || instant(permission.grantedAt) > instant(capture.startedAt)
    || !Array.isArray(capture.pages) || capture.pages.length < 1) return denial('CAPTURE_BOUNDARY');
  let pageRows = 0; let declaredTotal = null;
  for (const [i, p] of capture.pages.entries()) {
    if (!exact(p, ['rows', 'totalCount', 'hasNextPage']) || !Number.isSafeInteger(p.rows) || p.rows < 0
      || !Number.isSafeInteger(p.totalCount) || p.totalCount < 0
      || p.hasNextPage !== (i < capture.pages.length - 1)) return denial('PAGINATION');
    if (declaredTotal !== null && declaredTotal !== p.totalCount) return denial('PAGINATION');
    declaredTotal = p.totalCount; pageRows += p.rows;
    if (!Number.isSafeInteger(pageRows)) return denial('PAGINATION');
  }
  let source;
  try { source = JSON.parse(sourceBytes.toString()); } catch { return denial('SOURCE_JSON'); }
  if (!exact(source, ['issues', 'repositoryId']) || !Array.isArray(source.issues)) return denial('SOURCE_FIELDS');
  if (source.repositoryId !== permission.repositoryId) return denial('SOURCE_IDENTITY');
  if (source.issues.length !== pageRows || source.issues.length !== declaredTotal) return denial('PAGINATION');
  const ids = new Set(); const numbers = new Set(); let open = 0; let closed = 0; let closedAtAfterUpdated = 0;
  for (const row of source.issues) {
    if (!exact(row, FIELDS)) return denial('ROW_FIELDS');
    if (!id(row.id) || !Number.isSafeInteger(row.number) || row.number <= 0) return denial('ROW_ID');
    if (ids.has(row.id) || numbers.has(row.number)) return denial('DUPLICATE_ISSUE');
    ids.add(row.id); numbers.add(row.number);
    if (row.state !== 'OPEN' && row.state !== 'CLOSED') return denial('ROW_STATE');
    const created = instant(row.createdAt); const updated = instant(row.updatedAt);
    const closedAt = row.closedAt === null ? null : instant(row.closedAt);
    if (created === null || updated === null || created > updated || updated > instant(capture.finishedAt)
      || (row.closedAt !== null && (closedAt === null || closedAt < created || closedAt > instant(capture.finishedAt)))
      || (row.state === 'CLOSED' && closedAt === null)) return denial('ROW_TIME');
    // GitHub's independently exposed timestamps need not be an ordered event log.
    // Preserve and surface this caveat without changing captured-state population/counts.
    if (closedAt !== null && closedAt > updated) closedAtAfterUpdated += 1;
    // An OPEN issue may retain a previous close timestamp; never reconstruct transitions.
    if (row.state === 'OPEN') open += 1; else closed += 1;
  }
  const body = {
    schemaVersion: 'kaleidosphere.business-bi/issue-snapshot-analysis/v1',
    outcome: 'ANALYZED_FROZEN_SNAPSHOT',
    metricId: ISSUE_SNAPSHOT_CONTRACT.metricId,
    metricDefinition: ISSUE_SNAPSHOT_CONTRACT.definition,
    contractSha256: ISSUE_SNAPSHOT_CONTRACT_SHA256,
    contextId: permission.contextId,
    sourceBytesSha256: sourceHash,
    permissionGrantDigest: permission.grantId,
    permissionBindingDigest: sha(JSON.stringify(canonicalJson(permission))),
    capture: { startedAt: capture.startedAt, finishedAt: capture.finishedAt, atomic: false, pageCount: capture.pages.length },
    counts: { totalIssues: source.issues.length, capturedOpenIssues: open, capturedClosedIssues: closed },
    timestampCaveats: { closedAtAfterUpdatedCount: closedAtAfterUpdated, meaning: 'Captured timestamps are not an ordered event log; no row is excluded from captured-state counts for this caveat.' },
    evidenceClass: 'SOURCE_SNAPSHOT_COMPUTATION_ONLY_NOT_PILOT_ACCEPTANCE',
    sourceAuthenticityVerifiedByProduct: false,
    independentBusinessDefinitionConfirmed: false,
    humanComprehensionObserved: false,
    realPilotQualified: false,
    secondContextExecuted: false,
    historicalAsOfOpenBalance: null,
    observedHumanEffort: { setupMs: null, clarificationMs: null, correctionMs: null, maintenanceMs: null },
    unknownReason: 'UNKNOWN: no independent business signoff, human responses or human effort observations supplied; no historical as-of source or second context.',
    limits: ISSUE_SNAPSHOT_CONTRACT.forbiddenClaims,
  };
  return { ...body, bindingDigest: sha(JSON.stringify(canonicalJson(body))) };
}

// Independently retained source/permission/capture are mandatory; self-resealing is not verification.
export function verifyIssueStateSnapshot({ carried, ...inputs } = {}) {
  const actual = analyzeIssueStateSnapshot(inputs);
  if (actual.outcome === 'DENIED') return actual;
  if (JSON.stringify(canonicalJson(carried)) !== JSON.stringify(canonicalJson(actual))) return denial('CARRIED_RESULT_MISMATCH');
  return { outcome: 'VERIFIED', bindingDigest: actual.bindingDigest };
}

// Reuse #236 v2 worksheet/blank human-record and separate maintainer-reference protocol.
// Different domain-specific prompts; neither old synthetic worksheet nor this new form is a human answer.
export function prepareIssueSnapshotReaderTask(inputs) {
  const result = analyzeIssueStateSnapshot(inputs);
  if (result.outcome === 'DENIED') return result;
  const tasks = [
    { id: 'T1', prompt: 'State what the reported number measures and its unit, in your own words.' },
    { id: 'T2', prompt: 'Describe the source population and whether raw issue content was used.' },
    { id: 'T3', prompt: 'Explain the time boundary and whether this is one atomic instant or the current live state.' },
    { id: 'T4', prompt: 'Name the unknown fields and explain what null means here.' },
    { id: 'T5', prompt: 'State which claims about historical balances, business value or reuse this result does not establish.' },
  ];
  const worksheet = {
    schemaVersion: 'kaleidosphere.business-bi/ks236-reader-task/v2',
    issue: 'KPI-USER-01 (#236) reused for KS-EVO-05 (#250)',
    provenance: 'Prepared from the exact admitted frozen issue-state product execution; not a human observation or independent business definition confirmation.',
    readerFacing: {
      question: 'Explain the captured open-issue metric, its source and limits.',
      sourceMode: 'PERMISSION_BOUND_FROZEN_GITHUB_ISSUE_METADATA',
      figures: { ...result.counts, unit: 'issues', capture: result.capture, timestampCaveats: result.timestampCaveats, historicalAsOfOpenBalance: null, observedHumanEffort: result.observedHumanEffort },
      resultBindingDigest: result.bindingDigest,
      tasks,
    },
    comprehensionRecord: { readerIdentity: null, readAt: null, sourceModeSeen: null, answers: Object.fromEntries(tasks.map(t => [t.id, null])), notes: null },
    honestyRule: 'Only a real reader supplies identity, time and answers; this emitter leaves every human slot null. Maintainer reference is separate and must not be handed to an uncoached reader.',
  };
  return {
    worksheet,
    referenceAnswers: {
      T1: `${result.counts.capturedOpenIssues} distinct supplied issues with captured state OPEN; unit = issues.`,
      T2: 'The complete permission-bound frozen GitHub issue-metadata population, excluding PRs, texts, authors and credentials.',
      T3: `Per-page capture from ${result.capture.startedAt} to ${result.capture.finishedAt}; non-atomic, not current live or historical as-of state.`,
      T4: 'historicalAsOfOpenBalance and setupMs, clarificationMs, correctionMs, maintenanceMs are null: not observed/available, not zero.',
      T5: 'No historical open balance, revenue, causal business outcome, independent signoff, human comprehension, second-context reuse or wider promotion is established.',
    },
  };
}
