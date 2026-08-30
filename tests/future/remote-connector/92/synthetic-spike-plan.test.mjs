import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

// Executable evidence for the committed #92 synthetic-only spike plan
// (docs/future/remote-connector/SYNTHETIC_SPIKE_PLAN.md).
//
// This test replaces the external qwen-leaves JSON evidence gate with direct,
// deterministic, local validation of the committed plan artifact. The
// committed Markdown document is the only input: no network, no local model,
// and no external JSON evidence file. The validator fails closed: any missing
// bounded-scope, non-authority, or stop-condition content yields
// REJECTED_WITH_EVIDENCE with the failing check IDs recorded.

const PLAN_PATH = new URL('../../../../docs/future/remote-connector/SYNTHETIC_SPIKE_PLAN.md', import.meta.url);
const SCHEMA_VERSION = 'kaleidosphere/synthetic-spike-plan-evidence/v1';
const ARTIFACT_PATH = 'docs/future/remote-connector/SYNTHETIC_SPIKE_PLAN.md';
// Pinned digest of the positive report for the committed plan (set from a
// first deterministic run; see the VALIDATED test below).
const COMMITTED_PLAN_DIGEST = 'sha256:ebcbb708f9528001eee797b4dfaab5d37b30e101ae74d06f03241bc7d7cce7f8';

const SECTION_TITLES = [
  ['SEC-01', 'Purpose and scope'],
  ['SEC-02', 'Preflight go/no-go gate'],
  ['SEC-03', 'Synthetic-only definition'],
  ['SEC-04', 'Allowed synthetic data'],
  ['SEC-05', 'Isolation boundary'],
  ['SEC-06', 'Bounded execution'],
  ['SEC-07', 'Start criteria'],
  ['SEC-08', 'NO-GO conditions'],
  ['SEC-09', 'Stop criteria (immediate)'],
  ['SEC-10', 'Success criteria'],
  ['SEC-11', 'Cleanup and rollback'],
  ['SEC-12', 'Evidence and receipts'],
  ['SEC-13', 'Terminal outcomes'],
  ['SEC-14', 'Nonclaims'],
  ['SEC-15', 'Criterion crosswalk'],
];

// [id, requirement, normalized-text needle]. All needles are exact content
// from the committed plan; matching runs over whitespace-normalized text so
// line wrapping in the document is irrelevant.
const CONTENT_CHECKS = [
  ['GATE-00', 'preflight gates fail closed on missing or stale evidence', 'The gates fail closed: any missing, stale, or ambiguous evidence is NO-GO and must not initiate a run'],
  ['GATE-01', 'gate G-1: FRC.0-FRC.2 complete or explicitly scoped down', '| G-1 | FRC.0-FRC.2 discovery artifacts are complete, or explicitly scoped down |'],
  ['GATE-02', 'gate G-2: separate product authorization', '| G-2 | Separate product authorization |'],
  ['GATE-03', 'gate G-3: separate security authorization', '| G-3 | Separate security authorization |'],
  ['GATE-04', 'gate G-4: synthetic fixture available locally', '| G-4 | Synthetic fixture available locally |'],
  ['GATE-05', 'gate G-5: local guards pass offline', '| G-5 | Local guards pass offline |'],
  ['GATE-06', 'gate G-6: dry-run/readback receipt conforms', '| G-6 | Dry-run/readback receipt conforms |'],
  ['BND-01', 'fixture bound: at most 10 collections', 'at most 10 collections'],
  ['BND-02', 'fixture bound: at most 50 records per collection (500 total)', 'at most 50 records per collection (at most 500 records total)'],
  ['BND-03', 'fixture bound: at most 10 fields per record', 'at most 10 fields per record'],
  ['BND-04', 'fixture bound: at most 256 bytes per field', 'at most 256 bytes per field'],
  ['BND-05', 'per-command timeout: 30 seconds', 'Per-command timeout: 30 seconds'],
  ['BND-06', 'total spike session: 10 minutes', 'Total spike session: 10 minutes'],
  ['BND-07', 'request budget: at most 20 per run, at most 50 for the whole spike', 'Request budget: at most 20 synthetic requests per run, at most 50 requests for the whole spike'],
  ['BND-08', 'record budget: at most 100 per request, at most 500 fixture total', 'Record budget: at most 100 records read per request; the whole fixture is at most 500 records'],
  ['BND-09', 'retry bound: at most 1 retry, zero for boundary failures', 'Retries: at most 1 retry for a local read failure. Zero retries for any boundary, authorization, budget, or fixture-provenance failure'],
  ['BND-10', 'action set: read-only synthetic actions only', 'read-only synthetic actions only — enumerate collections, read a record, count records'],
  ['BND-11', 'mutation-capable action in the planned surface is NO-GO', 'If the planned surface exposes a mutation-capable action, the preflight is NO-GO'],
  ['BND-12', 'stricter limits allowed, looser limits NO-GO', 'Stricter values are allowed; looser values are NO-GO'],
  ['BND-13', 'isolation: localhost only or disabled, no public bind', 'Network: localhost only, or disabled. There is no public bind and no hosted endpoint (NEG-02)'],
  ['AUTH-01', 'artifact is not an implementation, authorization, or execution', 'It is not a connector or MCP implementation, not an authorization, and not an execution'],
  ['AUTH-02', 'no artifact outcome authorizes a spike', 'No outcome of this artifact authorizes, starts, or executes a spike'],
  ['AUTH-03', 'artifact grants no authority', 'This artifact does not claim that a spike was authorized, started, or executed, and it grants no authority'],
  ['AUTH-04', 'no release and no authority expansion', 'No release and no authority expansion'],
  ['AUTH-05', 'only an authorized actor may start a run', 'An authorized actor (per G-2 and G-3) explicitly starts the run. No timer, script, CI step, or automated follow-on may start it'],
  ['AUTH-06', 'no automated follow-on permitted', 'No automated follow-on is permitted by this artifact'],
  ['AUTH-07', 'authorizations are fail-closed preflight evidence, not task dependencies', 'FRC.0-FRC.2 completion, product authorization, and security authorization are fail-closed preflight evidence, not task dependencies'],
  ['STOP-01', 'run stops immediately on enumerated triggers', 'the run stops immediately on any of the following'],
  ['STOP-02', 'stop: timeout or budget exceeded', 'any timeout or budget in Bounded execution is exceeded'],
  ['STOP-03', 'stop: prohibited data, credential, bind, or mutation', 'a prohibited data item, credential, bind, or mutation is observed or attempted (NEG-01 through NEG-04)'],
  ['STOP-04', 'stop: retry beyond bound', 'a retry beyond the bound in Bounded execution (NEG-05)'],
  ['STOP-05', 'stop: fixture provenance mismatch', 'a fixture provenance mismatch: any readback differs from the fixture manifest hash'],
  ['STOP-06', 'stop: write outside the execution directory', 'any write outside the execution directory and the sealed receipt file'],
  ['STOP-07', 'stop: external activation', 'any external activation: a service start, a bind beyond localhost, or spike network egress'],
  ['STOP-08', 'stop: loss of isolation', 'any loss of isolation: a process escaping the execution directory, or environment leakage into the run'],
  ['NEG-01', 'live credential requirement is NO-GO', 'NEG-01: any live credential requirement (provider token, real database credential, personal or service secret) is NO-GO'],
  ['NEG-02', 'public bind or hosted endpoint is NO-GO', 'NEG-02: any public bind or hosted endpoint in the plan is NO-GO'],
  ['NEG-03', 'customer data or provider payload is NO-GO', 'NEG-03: any customer data or provider payload in the fixture or plan is NO-GO'],
  ['NEG-04', 'mutation-capable connector action is NO-GO', 'NEG-04: any mutation-capable connector action in the planned surface is NO-GO'],
  ['NEG-05', 'open-ended or blind retry loop is NO-GO', 'NEG-05: any open-ended or blind retry loop is NO-GO'],
  ['NEG-06', 'NO-GO is a terminal outcome and is not retried', 'NO-GO is a terminal preflight outcome: it does not initiate a run, is not retried'],
  ['TERM-01', 'terminal outcome is exactly one of two values', 'The terminal outcome of this artifact is exactly one of'],
  ['TERM-02', 'RELEASED terminal outcome defined', '`RELEASED`: approved plan artifact'],
  ['TERM-03', 'REJECTED_WITH_EVIDENCE terminal outcome defined', '`REJECTED_WITH_EVIDENCE`: a required section, gate, or check is missing or failing'],
  ['WALK-01', 'crosswalk: NEG-01 live credential fails closed', 'NEG-01 (live credential fails closed)'],
  ['WALK-02', 'crosswalk: NEG-02 public bind fails closed', 'NEG-02 (public bind/hosted endpoint fails closed)'],
  ['WALK-03', 'crosswalk: NEG-03 customer data fails closed', 'NEG-03 (customer data/provider payload fails closed)'],
  ['WALK-04', 'crosswalk: NEG-04 mutation-capable action fails closed', 'NEG-04 (mutation-capable action fails closed)'],
  ['WALK-05', 'crosswalk: NEG-05 open-ended retry fails closed', 'NEG-05 (open-ended retry fails closed)'],
  ['WALK-06', 'crosswalk: AC-01 start/stop/rollback', 'AC-01 (start/stop/rollback)'],
  ['WALK-07', 'crosswalk: AC-03 go/no-go', 'AC-03 (go/no-go)'],
  ['WALK-08', 'crosswalk: DEP-01 separate authorizations', 'DEP-01 (FRC.0-FRC.2 plus separate authorizations)'],
  ['WALK-09', 'crosswalk: GATE-01 synthetic-only, non-production, isolated, bounded', 'GATE-01 (synthetic-only, non-production, isolated, bounded)'],
];

function runPlanChecks(planText) {
  const flat = planText.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');
  const lines = planText.split('\n');
  const findings = [];
  const record = (id, requirement, ok, detail) => {
    findings.push(ok
      ? { id, requirement, status: 'PASS' }
      : { id, requirement, status: 'FAIL', detail });
  };
  for (const [id, title] of SECTION_TITLES) {
    record(id, `section present: ## ${title}`, lines.includes(`## ${title}`), `missing section: ## ${title}`);
  }
  for (const [id, requirement, needle] of CONTENT_CHECKS) {
    record(id, requirement, flat.includes(needle), `missing: ${needle}`);
  }
  return findings;
}

function buildPlanEvidenceReport(planText) {
  const findings = runPlanChecks(planText);
  const failedCount = findings.filter((finding) => finding.status === 'FAIL').length;
  const report = {
    schemaVersion: SCHEMA_VERSION,
    artifact: ARTIFACT_PATH,
    outcome: failedCount === 0 ? 'VALIDATED' : 'REJECTED_WITH_EVIDENCE',
    checkCount: findings.length,
    failedCount,
    findings,
  };
  report.reportDigest = `sha256:${createHash('sha256').update(JSON.stringify(report)).digest('hex')}`;
  return report;
}

function failingIds(report) {
  return report.findings.filter((finding) => finding.status === 'FAIL').map((finding) => finding.id);
}

// In-memory mutations for the fail-closed cases. If a mutation target no
// longer matches the committed text, the test fails loudly (fail closed)
// instead of silently validating a stale expectation.
function replaceOnce(source, oldText, newText, label) {
  assert.ok(source.includes(oldText), `mutation target missing for ${label}`);
  const replaced = source.replace(oldText, newText);
  assert.ok(!replaced.includes(oldText), `mutation target survived for ${label}`);
  return replaced;
}

const planText = await readFile(PLAN_PATH, 'utf8');
const EXPECTED_CHECK_COUNT = SECTION_TITLES.length + CONTENT_CHECKS.length;

test('committed #92 synthetic spike plan is internally VALIDATED with every check passing', () => {
  const report = buildPlanEvidenceReport(planText);
  assert.equal(report.schemaVersion, SCHEMA_VERSION);
  assert.equal(report.artifact, ARTIFACT_PATH);
  assert.equal(report.checkCount, EXPECTED_CHECK_COUNT);
  assert.equal(report.outcome, 'VALIDATED');
  assert.equal(report.failedCount, 0);
  assert.deepEqual(report.findings.map((finding) => finding.status), Array(EXPECTED_CHECK_COUNT).fill('PASS'));
  assert.equal(report.reportDigest, COMMITTED_PLAN_DIGEST);
});

test('plan evidence report is byte-identical across independent reruns', async () => {
  const rerun = await readFile(PLAN_PATH, 'utf8');
  const left = buildPlanEvidenceReport(planText);
  const right = buildPlanEvidenceReport(rerun);
  assert.deepEqual(left, right);
  assert.equal(left.reportDigest, right.reportDigest);
});

test('live credential requirement fails closed (NEG-01)', () => {
  const mutated = replaceOnce(
    planText,
    '- NEG-01: any live credential requirement (provider token, real database\n  credential, personal or service secret) is NO-GO. The spike is not\n  re-designed around credential injection.',
    '- NEG-01: live credentials are required and injected at run time.',
    'NEG-01 live credential',
  );
  const report = buildPlanEvidenceReport(mutated);
  assert.equal(report.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.deepEqual(failingIds(report), ['NEG-01']);
});

test('production mutation action fails closed (NEG-04)', () => {
  const mutated = replaceOnce(
    planText,
    '- NEG-04: any mutation-capable connector action in the planned surface is\n  NO-GO.',
    '- NEG-04: mutation-capable connector actions are permitted in the planned surface.',
    'NEG-04 mutation action',
  );
  const report = buildPlanEvidenceReport(mutated);
  assert.equal(report.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.deepEqual(failingIds(report), ['NEG-04']);
});

test('unbounded scope fails closed (BND-05, BND-07)', () => {
  let mutated = replaceOnce(
    planText,
    '- Per-command timeout: 30 seconds.',
    '- Per-command timeout: unbounded.',
    'unbounded per-command timeout',
  );
  mutated = replaceOnce(
    mutated,
    '- Request budget: at most 20 synthetic requests per run, at most 50 requests\n  for the whole spike.',
    '- Request budget: unlimited synthetic requests.',
    'unbounded request budget',
  );
  const report = buildPlanEvidenceReport(mutated);
  assert.equal(report.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.deepEqual(failingIds(report), ['BND-05', 'BND-07']);
});

test('missing stop conditions fail closed (SEC-09, STOP-01..STOP-08)', () => {
  const start = planText.indexOf('## Stop criteria (immediate)');
  const end = planText.indexOf('## Success criteria');
  assert.notEqual(start, -1, 'stop criteria heading missing from committed plan');
  assert.ok(end > start, 'success criteria heading must follow stop criteria');
  const mutated = planText.slice(0, start) + planText.slice(end);
  const report = buildPlanEvidenceReport(mutated);
  assert.equal(report.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.deepEqual(failingIds(report), ['SEC-09', 'STOP-01', 'STOP-02', 'STOP-03', 'STOP-04', 'STOP-05', 'STOP-06', 'STOP-07', 'STOP-08']);
});

test('external qwen-leaves JSON gate placeholder is not evidence: fails closed', () => {
  const externalGatePlan = '# Spike plan\n\nEvidence: awaiting qwen-leaves JSON gate output from the local model.\n';
  const report = buildPlanEvidenceReport(externalGatePlan);
  assert.equal(report.outcome, 'REJECTED_WITH_EVIDENCE');
  assert.equal(report.failedCount, EXPECTED_CHECK_COUNT);
  assert.ok(failingIds(report).length > 0);
});

test('committed plan has no external qwen-leaves JSON dependency', () => {
  assert.doesNotMatch(planText, /qwen-leaves|external JSON evidence/i);
});