#!/usr/bin/env node
/**
 * Offline readback harness for the sole KS91 tenant-data/secret-egress memo.
 *
 * This command reads only repository fixtures and the planning memo. It never
 * performs external I/O, invokes a provider, or writes a file. FUTURE_BACKLOG is a
 * nonterminal planning state; this harness does not release the future surface.
 *
 * Usage:
 *   node scripts/future/readback-tenant-data-secret-egress.mjs \
 *     --memo docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md --offline
 */
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import {fileURLToPath} from 'node:url';

import {
  FUTURE_MEMO_DISPOSITION,
  FUTURE_MEMO_PLANNING_STATUS,
  TENANT_DATA_SECRET_EGRESS_CONTRACT_SCHEMA,
  TENANT_DATA_SECRET_EGRESS_FUTURE_MEMO_SCHEMA,
  validateFutureMemoFixtureV1,
  validateTenantDataSecretEgressContractV1,
  validateTenantDataSecretEgressNegativeCasesV1,
} from './validate-tenant-data-secret-egress.mjs';

export const READBACK_SCHEMA = 'kaleidosphere.remote-connector/tenant-data-secret-egress-readback-receipt/v1';
export const SOLE_MEMO_PATH = 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md';
export const RECEIPT_PATH = 'docs/future/remote-connector/fixtures/tenant-data-secret-egress-readback-receipt-v1.json';

export const READBACK_CODES = Object.freeze({
  FIXTURE_MISSING: 'KS91_READBACK_FIXTURE_MISSING',
  FIXTURE_INVALID: 'KS91_READBACK_FIXTURE_INVALID',
  RECEIPT_INVALID: 'KS91_READBACK_RECEIPT_DENIED',
  MEMO_SECTION: 'KS91_READBACK_MEMO_SECTION_DENIED',
  REJECT_GATE: 'KS91_READBACK_REJECT_GATE_DENIED',
  NONTERMINAL_STATE: 'KS91_READBACK_NONTERMINAL_STATE_DENIED',
  NON_CLAIM: 'KS91_READBACK_NON_CLAIM_DENIED',
  UNSAFE_CONTENT: 'KS91_READBACK_UNSAFE_CONTENT_DENIED',
  OFFLINE_MODE: 'KS91_READBACK_OFFLINE_MODE_DENIED',
});

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const RECEIPT_DIGEST = 'sha256:62d5301be590cafd056692895edca30fef1d666a2aaa9ec10cb98825565f50d0';

const COMPONENTS = Object.freeze([
  Object.freeze({id: 'contract', path: 'docs/future/remote-connector/fixtures/tenant-data-secret-egress-contract-v1.json', schemaVersion: TENANT_DATA_SECRET_EGRESS_CONTRACT_SCHEMA}),
  Object.freeze({id: 'envelope-negative-cases', path: 'docs/future/remote-connector/fixtures/tenant-data-secret-egress-negative-cases-v1.json', schemaVersion: 'kaleidosphere.remote-connector/tenant-data-secret-egress-negative-cases/v1'}),
  Object.freeze({id: 'isolation', path: 'docs/future/remote-connector/fixtures/tenant-isolation-threat-model-v1.json', schemaVersion: 'kaleidosphere.remote-connector/tenant-isolation-threat-model/v1'}),
  Object.freeze({id: 'retention', path: 'docs/future/remote-connector/fixtures/data-classification-retention-v1.json', schemaVersion: 'kaleidosphere.remote-connector/data-classification-retention/v1'}),
  Object.freeze({id: 'egress', path: 'docs/future/remote-connector/fixtures/egress-threat-allowlist-v1.json', schemaVersion: 'kaleidosphere.remote-connector/egress-threat-allowlist/v1'}),
  Object.freeze({id: 'secret-custody', path: 'docs/future/remote-connector/fixtures/secret-custody-options-v1.json', schemaVersion: 'kaleidosphere.remote-connector/secret-custody-options/v1'}),
  Object.freeze({id: 'compliance', path: 'docs/future/remote-connector/fixtures/compliance-assumptions-unknowns-v1.json', schemaVersion: 'kaleidosphere.remote-connector/compliance-assumptions-unknowns/v1'}),
]);

const CRITERIA = Object.freeze([
  Object.freeze({id: 'AC-01', name: 'Isolation boundary documentation', section: '## Tenant-isolation threat model', markers: ['Tenant boundary', 'Control plane boundary', 'Data plane boundary', 'Operator boundary', 'External destination boundary']}),
  Object.freeze({id: 'AC-02', name: 'Residency choices', section: '### Residency choices', markers: ['synthetic-eu-1', 'synthetic-us-1', 'region/residency mismatch']}),
  Object.freeze({id: 'AC-03', name: 'Classification and retention matrix', section: '### Data classification and retention/deletion matrix', markers: ['Retention and deletion rules', 'finite duration', 'deletion verification']}),
  Object.freeze({id: 'AC-04', name: 'Secret custody gates', section: '## Secret-custody option matrix', markers: ['Approval and rejection gates', 'log/artifact exclusion', 'plaintext custody']}),
  Object.freeze({id: 'AC-05', name: 'Egress allowlist threat model', section: '## Candidate egress allowlist decision matrix', markers: ['Egress threats and hard rejects', 'tenant-scoped destinations', 'default: DENY']}),
  Object.freeze({id: 'AC-06', name: 'Compliance assumptions and unknowns', section: '## Compliance assumptions and unknowns register', markers: ['All compliance unknowns are', 'external waits or claims', 'named approval and reject gates']}),
  Object.freeze({id: 'AC-07', name: 'Hard rejects', section: '## Safety boundary', markers: ['Hard reject conditions', 'stable denial code', 'fail closed']}),
  Object.freeze({id: 'AC-08', name: 'Planning-only boundary', section: '# FUTURE_BACKLOG — Tenant Data and Secret Egress Boundary', markers: ['Planning-only memo envelope', 'not an implementation approval', 'FUTURE_BACKLOG']}),
  Object.freeze({id: 'AC-09', name: 'Cross-tenant reject', section: '### Hard reject conditions', markers: ['cross-tenant read', 'KS91_CROSS_TENANT_READ_DENIED', 'tenant-scoped']}),
  Object.freeze({id: 'AC-10', name: 'Unbounded-retention reject', section: '### Fail-closed reject matrix', markers: ['unbounded retention', 'KS91_RETENTION_UNBOUNDED_DENIED', 'both are rejected']}),
  Object.freeze({id: 'AC-11', name: 'Uncontrolled-egress reject', section: '### Egress threats and hard rejects', markers: ['uncontrolled egress', 'KS91_UNCONTROLLED_EGRESS_DENIED', 'default: DENY']}),
  Object.freeze({id: 'AC-12', name: 'Secret exposure reject', section: '### Approval and rejection gates', markers: ['secret values', 'KS91_SECRET_LOG_ARTIFACT_DENIED', 'excluded from logs']}),
  Object.freeze({id: 'AC-13', name: 'Residency mismatch reject', section: '### Residency choices', markers: ['region/residency mismatch', 'KS91_RESIDENCY_MISMATCH_DENIED', 'never silently remapped']}),
  Object.freeze({id: 'AC-14', name: 'Rollback and terminal rule', section: '## Terminal rule', markers: ['only terminal states are `RELEASED` and `REJECTED_WITH_EVIDENCE`', '## Rollback', 'local Git revert']}),
  Object.freeze({id: 'AC-15', name: 'Issue 91 implementation rejection', section: '### Issue #91 implementation disposition', markers: ['REJECTED_WITH_EVIDENCE', 'Decision owner', 'Reasons', 'Affected scope', 'Supersession conditions', 'caller-authored expected values or assertions are not authority evidence']}),
]);

const NEGATIVE_GATES = Object.freeze([
  Object.freeze({id: 'AC-09-cross-tenant', criterion: 'AC-09', name: 'reject-cross-tenant', fixture: 'isolation', caseIds: ['reject-cross-tenant-read', 'reject-cross-tenant-write', 'reject-cross-tenant-export'], expectedCodes: ['KS91_CROSS_TENANT_READ_DENIED', 'KS91_CROSS_TENANT_WRITE_DENIED', 'KS91_CROSS_TENANT_EXPORT_DENIED']}),
  Object.freeze({id: 'AC-10-unbounded-retention', criterion: 'AC-10', name: 'reject-unbounded-retention', fixture: 'retention', caseIds: ['reject-unbounded-retention'], expectedCodes: ['KS91_RETENTION_UNBOUNDED_DENIED']}),
  Object.freeze({id: 'AC-11-uncontrolled-egress', criterion: 'AC-11', name: 'reject-uncontrolled-egress', fixture: 'egress', caseIds: ['reject-uncontrolled-egress'], expectedCodes: ['KS91_UNCONTROLLED_EGRESS_DENIED']}),
  Object.freeze({id: 'AC-12-secret-exposure', criterion: 'AC-12', name: 'reject-secret-exposure', fixture: 'secret-custody', caseIds: ['reject-secret-visible-to-log', 'reject-secret-visible-to-artifact'], expectedCodes: ['KS91_SECRET_LOG_ARTIFACT_DENIED']}),
  Object.freeze({id: 'AC-13-residency-mismatch', criterion: 'AC-13', name: 'reject-residency-mismatch', fixture: 'retention', caseIds: ['reject-region-residency-mismatch'], expectedCodes: ['KS91_RESIDENCY_MISMATCH_DENIED']}),
]);

const NON_CLAIMS = Object.freeze([
  'No remote-connector implementation',
  'No network egress',
  'No credential transport',
  'No query-execution authority',
  'customer-data access',
  'No completeness claims',
  'Absence is never mapped to a claim',
]);

const STATE = Object.freeze({
  current: 'FUTURE_BACKLOG',
  terminal: false,
  terminalStates: Object.freeze(['RELEASED', 'REJECTED_WITH_EVIDENCE']),
  requiredMarkers: Object.freeze(['Status: `FUTURE_BACKLOG` / planning-only', 'No in-progress or ambiguous terminal state is permitted']),
});

const IMPLEMENTATION_DISPOSITION = Object.freeze({
  issueNumber: 91,
  disposition: 'REJECTED_WITH_EVIDENCE',
  decision: 'REJECT_IMPLEMENTATION_NOW',
  requirementsStatus: 'FUTURE_BACKLOG',
  decisionOwner: 'product owner',
  evidenceBindings: Object.freeze([
    Object.freeze({issueNumber: 89, release: '2026_08_30_v1', mainSha: 'eb200aa4c3bb206c4bec70a6b92b73a89453d55e', decision: 'DEFER/REJECT-NOW'}),
    Object.freeze({issueNumber: 90, release: '2026_08_30_v2', mainSha: '5f75e1261585bf5464ef8b3fa3d4d220c21dde9a', decision: 'REJECTED_WITH_EVIDENCE'}),
  ]),
  reasons: Object.freeze(['NO_APPROVED_TENANT_ISOLATION_AUTHORITY', 'NO_APPROVED_RESIDENCY_OR_RETENTION_AUTHORITY', 'NO_APPROVED_SECRET_CUSTODY_AUTHORITY', 'NO_APPROVED_EGRESS_AUTHORITY', 'NO_COMPLIANCE_OR_LEGAL_CONCLUSION_AUTHORITY', 'NO_APPROVED_DEPLOYMENT_OR_OPERATIONS_AUTHORITY']),
  affectedScope: Object.freeze(['IMPLEMENTATION', 'CUSTOMER_DATA_AND_TENANT_HANDLING', 'RETENTION_DELETION_AND_RESIDENCY', 'SECRET_CUSTODY', 'NETWORK_EGRESS', 'COMPLIANCE_DEPLOYMENT_AND_OPERATIONS']),
  supersessionConditions: Object.freeze(['SEPARATELY_AUTHORIZED_IMMUTABLE_PROPOSAL', 'ACCOUNTABLE_OWNER_APPROVALS', 'FAIL_CLOSED_TENANT_RESIDENCY_RETENTION_AND_DELETION_PROOF', 'APPROVED_SECRET_CUSTODY_AND_LOG_ARTIFACT_EXCLUSION', 'INDEPENDENTLY_ENFORCED_CLOSED_EGRESS_AND_RESOLVED_COMPLIANCE_UNKNOWNS', 'TESTED_OPERATIONS_ROLLBACK_EXIT_AND_INDEPENDENT_READBACK']),
  nonClaims: Object.freeze(['NO_IMPLEMENTATION', 'NO_DEPLOYMENT_OR_PRODUCTION_READINESS', 'NO_COMPLIANCE_READINESS_OR_CERTIFICATION', 'NO_RUNTIME_TENANT_ISOLATION_RESIDENCY_RETENTION_CUSTODY_OR_EGRESS_CONTROL', 'NO_CALLER_AUTHORED_AUTHORITY', 'REQUIREMENTS_REMAIN_VALID_FUTURE_BACKLOG']),
});

const ROLLBACK = Object.freeze({
  section: '## Rollback',
  markers: Object.freeze(['local Git revert or removal', 're-running the focused validation', 'no running service']),
});
const LOCAL_COMPLETION_MARKER = 'no waiting, owner, or external completion node is created';

const fail = (code) => {
  const error = new Error(code);
  error.code = code;
  throw error;
};

const exactKeys = (value, keys, code) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) fail(code);
};

const canonicalJson = (value) => {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
};

const bodyDigest = (value) => `sha256:${createHash('sha256').update(canonicalJson(value)).digest('hex')}`;

const receiptBody = (receipt) => {
  const {digest, ...body} = receipt;
  return body;
};

export function validateReadbackReceiptV1(receipt) {
  exactKeys(receipt, ['components', 'criteria', 'digest', 'evidenceClass', 'implementationDisposition', 'memoPath', 'mode', 'negativeGates', 'nonClaims', 'receiptId', 'rollback', 'schemaVersion', 'soleMemoPath', 'state', 'status'], READBACK_CODES.RECEIPT_INVALID);
  if (receipt.schemaVersion !== READBACK_SCHEMA || receipt.receiptId !== 'KS91-MEMO-ASSEMBLY-READBACK-01'
    || receipt.status !== 'FROZEN_FUTURE_SURFACE' || receipt.evidenceClass !== 'synthetic-fixture-only'
    || receipt.mode !== 'offline' || receipt.memoPath !== SOLE_MEMO_PATH || receipt.soleMemoPath !== SOLE_MEMO_PATH
    || !DIGEST.test(receipt.digest) || receipt.digest !== bodyDigest(receiptBody(receipt))
    || receipt.digest !== RECEIPT_DIGEST) fail(READBACK_CODES.RECEIPT_INVALID);

  exactKeys(receipt.state, ['current', 'requiredMarkers', 'terminal', 'terminalStates'], READBACK_CODES.RECEIPT_INVALID);
  if (JSON.stringify(receipt.state) !== JSON.stringify(STATE)) fail(READBACK_CODES.RECEIPT_INVALID);
  exactKeys(receipt.rollback, ['markers', 'section'], READBACK_CODES.RECEIPT_INVALID);
  if (JSON.stringify(receipt.rollback) !== JSON.stringify(ROLLBACK)) fail(READBACK_CODES.RECEIPT_INVALID);
  if (JSON.stringify(receipt.implementationDisposition) !== JSON.stringify(IMPLEMENTATION_DISPOSITION)) fail(READBACK_CODES.RECEIPT_INVALID);
  if (JSON.stringify(receipt.nonClaims) !== JSON.stringify(NON_CLAIMS)) fail(READBACK_CODES.RECEIPT_INVALID);

  if (!Array.isArray(receipt.components) || receipt.components.length !== COMPONENTS.length) fail(READBACK_CODES.RECEIPT_INVALID);
  for (let index = 0; index < COMPONENTS.length; index += 1) {
    const actual = receipt.components[index];
    const expected = COMPONENTS[index];
    exactKeys(actual, ['id', 'path', 'required', 'schemaVersion'], READBACK_CODES.RECEIPT_INVALID);
    if (JSON.stringify(actual) !== JSON.stringify({...expected, required: true})) fail(READBACK_CODES.RECEIPT_INVALID);
  }
  if (JSON.stringify(receipt.criteria) !== JSON.stringify(CRITERIA)
    || JSON.stringify(receipt.negativeGates) !== JSON.stringify(NEGATIVE_GATES)) fail(READBACK_CODES.RECEIPT_INVALID);
  return receipt;
}

const fixtureSafetyCheck = (fixture) => {
  const serialized = JSON.stringify(fixture);
  if (/https?:\/\/|\b(?:postgres|mssql|oracle):\/\//i.test(serialized)
    || /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----|\b(?:password|api[_-]?key|bearer)\s*[:=]\s*[^\s"`]/i.test(serialized)) {
    fail(READBACK_CODES.UNSAFE_CONTENT);
  }
};

function validateCompanionFixture(id, fixture, schemaVersion) {
  if (!fixture || fixture.schemaVersion !== schemaVersion || fixture.status !== 'FROZEN_FUTURE_SURFACE'
    || fixture.evidenceClass !== 'synthetic-fixture-only' || fixture.policy?.default !== 'DENY'
    || fixture.policy.syntheticOnly !== true) fail(READBACK_CODES.FIXTURE_INVALID);
  fixtureSafetyCheck(fixture);
  if (!Array.isArray(fixture.negativeCases) || fixture.negativeCases.length < 1
    || (id !== 'retention' && (!Array.isArray(fixture.hardRejectConditions) || fixture.hardRejectConditions.length < 1))) {
    fail(READBACK_CODES.FIXTURE_INVALID);
  }
  if (id === 'isolation' && JSON.stringify(fixture.boundaries.map(({id: boundaryId}) => boundaryId).sort())
      !== JSON.stringify(['control-plane', 'data-plane', 'external-destination', 'operator', 'tenant'])) fail(READBACK_CODES.FIXTURE_INVALID);
  if (id === 'retention' && (fixture.matrix?.length !== 3 || fixture.retentionPolicies?.length !== 3)) fail(READBACK_CODES.FIXTURE_INVALID);
  if (id === 'egress' && fixture.candidates?.length !== 4) fail(READBACK_CODES.FIXTURE_INVALID);
  if (id === 'secret-custody' && fixture.options?.length !== 4) fail(READBACK_CODES.FIXTURE_INVALID);
  if (id === 'compliance' && (fixture.approvalGates?.length < 5 || fixture.assumptions?.length < 5
    || fixture.unknowns?.length < 5 || fixture.policy.externalWaitsAllowed !== false
    || fixture.policy.productionApprovalGranted !== false)) fail(READBACK_CODES.FIXTURE_INVALID);
}

function validateFixtureSet(fixtures) {
  for (const component of COMPONENTS) {
    const fixture = fixtures[component.id];
    if (!fixture) fail(READBACK_CODES.FIXTURE_MISSING);
    try {
      if (component.id === 'contract') {
        validateTenantDataSecretEgressContractV1(fixture);
      } else if (component.id === 'envelope-negative-cases') {
        validateTenantDataSecretEgressNegativeCasesV1(fixture, fixtures.contract);
      } else {
        validateCompanionFixture(component.id, fixture, component.schemaVersion);
      }
    } catch (error) {
      if (error.code === READBACK_CODES.UNSAFE_CONTENT) throw error;
      fail(READBACK_CODES.FIXTURE_INVALID);
    }
  }
}

function validateNegativeGates(receipt, fixtures) {
  for (const gate of receipt.negativeGates) {
    const fixture = fixtures[gate.fixture];
    if (!fixture) fail(READBACK_CODES.FIXTURE_MISSING);
    for (const caseId of gate.caseIds) {
      const negative = fixture.negativeCases?.find(({id}) => id === caseId);
      if (!negative || !gate.expectedCodes.includes(negative.expectedCode)) fail(READBACK_CODES.REJECT_GATE);
      const hardReject = fixture.hardRejectConditions?.find(({code}) => code === negative.expectedCode);
      if (gate.fixture !== 'retention' && !hardReject) fail(READBACK_CODES.REJECT_GATE);
    }
  }
}

const memoContains = (memo, marker) => memo.toLowerCase().includes(marker.toLowerCase());

function validateMemoSafety(memo) {
  if (typeof memo !== 'string' || memo.length === 0) fail(READBACK_CODES.MEMO_SECTION);
  if (/https?:\/\/|\b(?:postgres|mssql|oracle):\/\//i.test(memo)
    || /-----BEGIN\s+[A-Z ]*PRIVATE KEY-----|\b(?:password|api[_-]?key|bearer|credential)\s*[:=]\s*[^\s`"']/i.test(memo)
    || /\b(?:fetch|axios|curl|wget|nc|net\.connect|http\.request|https\.request|dns\.lookup|socket\.connect)\s*\(/i.test(memo)
    || /\b(?:credentialPath|credentialReference|credential_path|credential_reference|liveData|live_data|live-data|customerData|customer_data|dataOrigin|networkInvocation|networkRequest|network_request)\s*[:=]/i.test(memo)
    || /\b(?:credential|credentials?)\s+(?:reference|path|value)\s*[:=]/i.test(memo)
    || /\b(?:claims?|asserts?)\s+(?:compliance|deployment|production)\s+(?:readiness|ready|exists)\b/i.test(memo)
    || /\b(?:treats?|accepts?|uses?)\s+caller-authored\s+(?:expected\s+values|assertions?)\s+as\s+authority\b/i.test(memo)
    || /\b(?:read|query|fetch|access)\s+(?:live|customer)\s+(?:data|rows?)\b/i.test(memo)) fail(READBACK_CODES.UNSAFE_CONTENT);
}

function validateMemo(receipt, memo, negativeFixture) {
  validateMemoSafety(memo);
  for (const criterion of receipt.criteria) {
    if (!memoContains(memo, criterion.section) || criterion.markers.some((marker) => !memoContains(memo, marker))) {
      fail(READBACK_CODES.MEMO_SECTION);
    }
  }
  for (const marker of receipt.state.requiredMarkers) if (!memoContains(memo, marker)) fail(READBACK_CODES.NONTERMINAL_STATE);
  if (!memoContains(memo, receipt.rollback.section) || receipt.rollback.markers.some((marker) => !memoContains(memo, marker))) {
    fail(READBACK_CODES.MEMO_SECTION);
  }
  if (!memoContains(memo.replace(/\s+/g, ' '), LOCAL_COMPLETION_MARKER)) fail(READBACK_CODES.NONTERMINAL_STATE);
  if (receipt.nonClaims.some((claim) => !memoContains(memo, claim))) fail(READBACK_CODES.NON_CLAIM);
  if (receipt.state.current !== 'FUTURE_BACKLOG' || receipt.state.terminal !== false
    || receipt.state.terminalStates.length !== 2) fail(READBACK_CODES.NONTERMINAL_STATE);
  if (!negativeFixture?.memoValidation || negativeFixture.memoValidation.schemaVersion !== TENANT_DATA_SECRET_EGRESS_FUTURE_MEMO_SCHEMA) {
    fail(READBACK_CODES.FIXTURE_MISSING);
  }
  try {
    return validateFutureMemoFixtureV1(negativeFixture.memoValidation, memo);
  } catch (error) {
    if (error.code === 'KS91_FUTURE_MEMO_CRITERION_DENIED') fail(READBACK_CODES.MEMO_SECTION);
    if (error.code === 'KS91_FUTURE_MEMO_AUTHORIZATION_DENIED' || error.code === 'KS91_FUTURE_MEMO_VALIDATION_DENIED') fail(READBACK_CODES.UNSAFE_CONTENT);
    fail(READBACK_CODES.FIXTURE_INVALID);
  }
}

export function validateReadbackArtifacts({memo, receipt, fixtures}) {
  const checkedReceipt = validateReadbackReceiptV1(receipt);
  validateFixtureSet(fixtures);
  validateNegativeGates(checkedReceipt, fixtures);
  const checkedMemo = validateMemo(checkedReceipt, memo, fixtures['envelope-negative-cases']);
  if (checkedReceipt.state.current !== FUTURE_MEMO_PLANNING_STATUS
    || checkedReceipt.state.terminal !== false || FUTURE_MEMO_DISPOSITION !== 'NONTERMINAL') {
    fail(READBACK_CODES.NONTERMINAL_STATE);
  }
  return {
    status: 'READBACK_PASSED',
    planningStatus: FUTURE_MEMO_PLANNING_STATUS,
    disposition: FUTURE_MEMO_DISPOSITION,
    mode: 'offline',
    memoPath: SOLE_MEMO_PATH,
    soleMemoPath: SOLE_MEMO_PATH,
    componentCoverage: checkedReceipt.components.map(({id, path: componentPath, schemaVersion}) => ({
      id, path: componentPath, schemaVersion, covered: true,
    })),
    criterionCoverage: checkedReceipt.criteria.map(({id, name, section}) => ({id, name, section, covered: true})),
    hardRejects: checkedReceipt.negativeGates.map(({id, criterion, name, fixture, caseIds, expectedCodes}) => ({
      id, criterion, name, fixture, caseIds, expectedCodes, confirmed: true,
    })),
    nonClaims: [...checkedReceipt.nonClaims],
    implementationDisposition: structuredClone(checkedReceipt.implementationDisposition),
    nonterminalState: {
      current: checkedReceipt.state.current,
      terminal: checkedReceipt.state.terminal,
      terminalStates: [...checkedReceipt.state.terminalStates],
    },
    mandatoryNegatives: checkedMemo.report.map(({criterion, id, reject}) => ({criterion, id, reject, confirmed: true})),
    blockingNodes: [],
    rollback: {section: checkedReceipt.rollback.section, confirmed: true},
  };
}

async function readJson(file, missingCode = READBACK_CODES.FIXTURE_MISSING) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') fail(missingCode);
    fail(READBACK_CODES.FIXTURE_INVALID);
  }
}

async function loadArtifacts(receiptPath) {
  const receipt = await readJson(receiptPath, READBACK_CODES.RECEIPT_INVALID);
  const fixtures = {};
  for (const component of COMPONENTS) {
    fixtures[component.id] = await readJson(path.join(ROOT, component.path));
  }
  return {receipt, fixtures};
}

function parseArgs(args) {
  if (args.length !== 3 || args[0] !== '--memo' || args[2] !== '--offline') {
    process.stderr.write('usage: readback-tenant-data-secret-egress.mjs --memo <memo.md> --offline\n');
    return null;
  }
  return {memoPath: args[1]};
}

export async function readbackTenantDataSecretEgress({memoPath, receiptPath = path.join(ROOT, RECEIPT_PATH), offline = true}) {
  if (!offline) fail(READBACK_CODES.OFFLINE_MODE);
  const absoluteMemoPath = path.resolve(ROOT, memoPath);
  if (path.relative(ROOT, absoluteMemoPath) !== SOLE_MEMO_PATH) fail(READBACK_CODES.MEMO_SECTION);
  const memo = await readFile(absoluteMemoPath, 'utf8').catch(() => fail(READBACK_CODES.MEMO_SECTION));
  const {receipt, fixtures} = await loadArtifacts(receiptPath);
  return validateReadbackArtifacts({memo, receipt, fixtures});
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed) return 2;
  const report = await readbackTenantDataSecretEgress(parsed);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => {
    process.stderr.write(`${error.code ?? error.message}\n`);
    process.exitCode = 1;
  });
}
