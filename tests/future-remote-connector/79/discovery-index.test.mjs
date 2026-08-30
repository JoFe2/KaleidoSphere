import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const INDEX_PATH = 'docs/future-remote-connector/79/discovery-index.md';
const TRACE_PATH = 'docs/future-remote-connector/79/criterion-traceability.json';
const SCHEMA_VERSION = 'chimpmaera.bi/frc-parent-closure/v2';
const TERMINAL = 'REJECTED_WITH_EVIDENCE';
const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

const CHILD_FIELDS = [
  'artifact',
  'artifactSha256',
  'closedAt',
  'disposition',
  'executionDecision',
  'issue',
  'issueState',
  'issueStateReason',
  'issueUrl',
  'mainSha',
  'receipt',
  'release',
  'releaseUrl',
  'stageId',
];

const EXPECTED_CHILDREN = [
  {
    stageId: 'FRC.0',
    issue: 89,
    closedAt: '2026-08-30T11:22:19Z',
    release: '2026_08_30_v1',
    mainSha: 'eb200aa4c3bb206c4bec70a6b92b73a89453d55e',
    artifact: 'docs/future/remote-connector/PRODUCT_BOUNDARY_THREAT_MODEL.md',
    artifactSha256: '97ca82d288050233e50eac314e080afb43352b516bd4816e422f76eb18e604ce',
    receipt: 'docs/evidence/conveyor/ks89-operating-contract-v2-receipt.json',
    executionDecision: 'DEFER_REJECT_NOW',
  },
  {
    stageId: 'FRC.1',
    issue: 90,
    closedAt: '2026-08-30T11:57:40Z',
    release: '2026_08_30_v2',
    mainSha: '5f75e1261585bf5464ef8b3fa3d4d220c21dde9a',
    artifact: 'docs/future/remote-connector/IDENTITY_AUTHORITY_RECEIPTS.md',
    artifactSha256: '8bcf41343763ef9c38ffbe7f51671d8e8c5ee52c415960138cde092c689fda30',
    receipt: 'docs/evidence/conveyor/ks90-operating-contract-v21-integration.json',
    executionDecision: 'REJECT_IMPLEMENTATION_NOW',
  },
  {
    stageId: 'FRC.2',
    issue: 91,
    closedAt: '2026-08-30T12:19:59Z',
    release: '2026_08_30_v3',
    mainSha: '664447988841eed2f9023f29ab7ba7025562e524',
    artifact: 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md',
    artifactSha256: 'fffe23a0f386601e5cc502219bef2f462b13fd487b09aa3dfe5642d7e41e6a84',
    receipt: 'docs/evidence/conveyor/ks91-operating-contract-v21-integration.json',
    executionDecision: 'REJECT_IMPLEMENTATION_NOW',
  },
  {
    stageId: 'FRC.3',
    issue: 92,
    closedAt: '2026-08-30T12:37:32Z',
    release: '2026_08_30_v4',
    mainSha: 'f5a1363e3f29114def0054d4d817abb93818a2a1',
    artifact: 'docs/future/remote-connector/SYNTHETIC_SPIKE_AUTHORIZATION_PACKET.md',
    artifactSha256: '21d7524b7faf0fd677609d57ce69de83de92f51dc644dce920d565cdeaabb4ce',
    receipt: 'docs/evidence/conveyor/ks92-operating-contract-v21-integration.json',
    executionDecision: 'NO_GO',
  },
  {
    stageId: 'FRC.4',
    issue: 93,
    closedAt: '2026-08-30T13:28:55Z',
    release: '2026_08_30_v5',
    mainSha: '11e20bf248f8ea79d5a88e090b920c2dbbffe461',
    artifact: 'docs/future/remote-connector/GO_NO_GO_DECISION.md',
    artifactSha256: '592cd5a645a46646b868be2b399cb53f7f6c40cb4e53d8cc4534e94ca3bb73ec',
    receipt: 'docs/evidence/conveyor/ks93-operating-contract-v21-integration.json',
    executionDecision: 'NO_GO',
  },
];

const CRITERION_IDS = [
  'FRC.0-A1', 'FRC.0-A2', 'FRC.0-A3',
  'FRC.1-A1', 'FRC.1-A2', 'FRC.1-A3', 'FRC.1-A4',
  'FRC.2-A1', 'FRC.2-A2', 'FRC.2-A3', 'FRC.2-A4',
  'FRC.3-A1', 'FRC.3-A2', 'FRC.3-A3',
  'FRC.4-A1', 'FRC.4-A2', 'FRC.4-A3',
  'FRC.E-A1', 'FRC.E-A2', 'FRC.E-A3', 'FRC.E-A4',
];

const NEGATIVE_IDS = [
  'NEG-MISSING-OR-OPEN-CHILD',
  'NEG-PACKAGE-DONE',
  'NEG-DISCOVERY-AS-IMPLEMENTATION',
  'NEG-ENDPOINT',
  'NEG-CREDENTIALS-CUSTOMER-DATA',
  'NEG-API-WIDENING',
  'NEG-DEPLOYMENT-READINESS',
];

const PARENT_ACCEPTANCE_IDS = [
  'CHILD_CLOSURE',
  'DISCOVERY_EVIDENCE',
  'TERMINAL_DECISION',
  'NO_IMPLEMENTATION',
];

const TOP_LEVEL_FIELDS = [
  'artifact',
  'children',
  'criteria',
  'epic',
  'historicalBacklog',
  'label',
  'mandatoryNegatives',
  'nonClaims',
  'parentAcceptance',
  'provenance',
  'schemaVersion',
  'status',
];

function sameKeys(value, fields) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort());
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readDocument(root) {
  const [json, markdown] = await Promise.all([
    readFile(path.join(root, TRACE_PATH), 'utf8'),
    readFile(path.join(root, INDEX_PATH), 'utf8'),
  ]);
  return { doc: JSON.parse(json), markdown };
}

async function validateRoot(root) {
  const violations = [];
  let loaded;
  try {
    loaded = await readDocument(root);
  } catch (error) {
    return [`document read failed: ${error.message}`];
  }
  const { doc, markdown } = loaded;

  if (!sameKeys(doc, TOP_LEVEL_FIELDS)) violations.push('document must use the exact closed top-level field set');
  if (doc.schemaVersion !== SCHEMA_VERSION) violations.push(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (doc.artifact !== 'frc-parent-terminal-closure') violations.push('artifact must identify the parent terminal closure');
  if (doc.label !== 'FUTURE_BACKLOG') violations.push('historical label must remain FUTURE_BACKLOG');
  if (doc.status !== TERMINAL) violations.push(`status must be exactly ${TERMINAL}`);

  const epic = doc.epic ?? {};
  if (epic.issue !== 79 || epic.url !== 'https://github.com/JoFe2/KaleidoSphere/issues/79') {
    violations.push('epic must bind issue #79 and its URL');
  }
  if (epic.publicIssueStateAtReconciliation !== 'open') {
    violations.push('epic must not claim the parent was already publicly closed');
  }
  if (epic.terminalDisposition !== TERMINAL || epic.executionDecision !== 'NO_GO') {
    violations.push('epic must close discovery exactly REJECTED_WITH_EVIDENCE and NO_GO');
  }
  if (epic.decisionOwner !== 'Jo') violations.push('epic decision owner must be Jo');
  if (!epic.scope?.includes('without implementation')) violations.push('epic scope must deny implementation');
  if (!Array.isArray(epic.reasons) || epic.reasons.length < 3) violations.push('epic must record bounded rejection reasons');
  if (!epic.supersession?.includes('Jo, Product, and Security')) violations.push('supersession must require Jo, Product, and Security');
  if (JSON.stringify(epic.terminalStates) !== JSON.stringify(['RELEASED', TERMINAL])) {
    violations.push('epic terminal states must remain exact');
  }

  if (doc.historicalBacklog?.requirementsStatus !== 'PRESERVED_HISTORICAL_DOCUMENTATION') {
    violations.push('FUTURE_BACKLOG requirements must remain preserved historical documentation');
  }
  if (!doc.historicalBacklog?.interpretation?.includes('not a current implementation queue')) {
    violations.push('historical backlog must not become implementation authority');
  }

  if (!Array.isArray(doc.children) || doc.children.length !== EXPECTED_CHILDREN.length) {
    violations.push('children must list exactly #89-#93');
  } else {
    for (const [index, expected] of EXPECTED_CHILDREN.entries()) {
      const child = doc.children[index];
      const label = `child #${expected.issue}`;
      if (!sameKeys(child, CHILD_FIELDS)) violations.push(`${label} must use the exact closed field set`);
      for (const [key, value] of Object.entries(expected)) {
        if (child[key] !== value) violations.push(`${label} ${key} must bind exact released evidence`);
      }
      if (child.issueState !== 'closed' || child.issueStateReason !== 'completed') {
        violations.push(`${label} must be publicly closed/completed`);
      }
      if (child.disposition !== TERMINAL) violations.push(`${label} disposition must be ${TERMINAL}`);
      if (child.issueUrl !== `https://github.com/JoFe2/KaleidoSphere/issues/${expected.issue}`) {
        violations.push(`${label} issue URL mismatch`);
      }
      if (child.releaseUrl !== `https://github.com/JoFe2/KaleidoSphere/releases/tag/${expected.release}`) {
        violations.push(`${label} release URL mismatch`);
      }
      try {
        const bytes = await readFile(path.join(root, child.artifact));
        if (sha256(bytes) !== child.artifactSha256) violations.push(`${label} artifact digest mismatch`);
      } catch (error) {
        violations.push(`${label} artifact missing: ${error.message}`);
      }
      try {
        const receipt = JSON.parse(await readFile(path.join(root, child.receipt), 'utf8'));
        if (receipt.issue?.number !== child.issue) violations.push(`${label} receipt issue mismatch`);
        if (child.issue > 89 && receipt.disposition !== TERMINAL) violations.push(`${label} receipt disposition mismatch`);
        if (child.issue >= 92 && receipt.executionDecision !== 'NO_GO') violations.push(`${label} receipt execution decision mismatch`);
      } catch (error) {
        violations.push(`${label} receipt missing or malformed: ${error.message}`);
      }
    }
  }

  if (!Array.isArray(doc.criteria) || doc.criteria.length !== CRITERION_IDS.length) {
    violations.push('criteria must list exactly 21 declared criteria');
  } else {
    if (JSON.stringify(doc.criteria.map(({ id }) => id)) !== JSON.stringify(CRITERION_IDS)) {
      violations.push('criteria IDs or order differ from the declared FRC family');
    }
    for (const criterion of doc.criteria) {
      if (criterion.status !== 'SATISFIED') violations.push(`${criterion.id} must be SATISFIED`);
      if (!Array.isArray(criterion.evidence) || criterion.evidence.length === 0) {
        violations.push(`${criterion.id} must bind evidence`);
      }
      for (const evidence of criterion.evidence ?? []) {
        try {
          await readFile(path.join(root, evidence.artifact));
        } catch (error) {
          violations.push(`${criterion.id} evidence is missing: ${error.message}`);
        }
      }
    }
  }

  if (JSON.stringify(doc.parentAcceptance?.map(({ id }) => id)) !== JSON.stringify(PARENT_ACCEPTANCE_IDS)) {
    violations.push('parent acceptance must bind the four planned acceptance IDs');
  }
  for (const acceptance of doc.parentAcceptance ?? []) {
    if (acceptance.status !== 'SATISFIED' || typeof acceptance.evidence !== 'string' || acceptance.evidence.length === 0) {
      violations.push(`${acceptance.id} must be SATISFIED with evidence`);
    }
  }

  if (JSON.stringify(doc.mandatoryNegatives?.map(({ id }) => id)) !== JSON.stringify(NEGATIVE_IDS)) {
    violations.push('mandatory negatives must be exact and complete');
  }
  for (const negative of doc.mandatoryNegatives ?? []) {
    if (!negative.outcome?.startsWith('DENY')) violations.push(`${negative.id} must deny`);
  }

  const requiredNonClaims = [
    'NO_IMPLEMENTATION_OR_PROCUREMENT_AUTHORITY',
    'NO_CONNECTOR_SAAS_REMOTE_MCP_OR_ENDPOINT',
    'NO_CREDENTIAL_SECRET_TOKEN_OR_CUSTOMER_DATA_HANDLING',
    'NO_EXTERNAL_API_V2_WIDENING',
    'NO_DEPLOYMENT_ACTIVATION_OR_RUNTIME_CHANGE',
    'NO_COMPLIANCE_PRODUCTION_CUSTOMER_OR_SUPPORT_READINESS',
    'NO_LOCAL_PACKAGE_DONE_AS_PUBLIC_CLOSURE',
    'NO_DISCOVERY_AS_IMPLEMENTATION',
    'NO_PARENT_PUBLIC_ISSUE_CLOSE_CLAIM_BEFORE_DELIVERY_READBACK',
  ];
  if (JSON.stringify(doc.nonClaims) !== JSON.stringify(requiredNonClaims)) {
    violations.push('nonClaims must preserve every authority and readiness boundary');
  }

  if (doc.provenance?.baseSha !== '11e20bf248f8ea79d5a88e090b920c2dbbffe461') {
    violations.push('provenance must bind the immutable base');
  }
  if (!doc.provenance?.method?.includes('current-checkout')) violations.push('provenance must use current-checkout validation');

  const requiredMarkdown = [
    '**Terminal disposition: `REJECTED_WITH_EVIDENCE`**',
    '**Execution decision: `NO_GO`**',
    '**Decision owner: Jo**',
    'schema\n`chimpmaera.bi/frc-parent-closure/v2`',
    'The parent closes exactly `REJECTED_WITH_EVIDENCE`',
    'Historical `FUTURE_BACKLOG` requirements',
    'Only a separately authorized immutable work item',
    'Jo, Product, and\nSecurity',
    'no claim that #79 is already publicly closed',
  ];
  for (const mention of requiredMarkdown) {
    if (!markdown.includes(mention)) violations.push(`discovery-index.md missing required text: ${mention}`);
  }
  for (const child of EXPECTED_CHILDREN) {
    for (const mention of [
      `[#${child.issue}](https://github.com/JoFe2/KaleidoSphere/issues/${child.issue})`,
      child.release,
      child.mainSha,
      child.artifact,
    ]) {
      if (!markdown.includes(mention)) violations.push(`discovery-index.md missing child #${child.issue} binding: ${mention}`);
    }
  }
  if (markdown.includes('- [ ]')) violations.push('discovery-index.md contains a stale unchecked acceptance box');
  if (markdown.includes('all stages unstarted')) violations.push('discovery-index.md contains stale all-stages-unstarted state');

  return violations;
}

function expectViolation(violations, needle) {
  assert(violations.some((entry) => entry.includes(needle)), `expected '${needle}' in: ${violations.join(' | ')}`);
}

async function withMutation(mutator) {
  const { doc, markdown } = await readDocument(ROOT);
  mutator(doc);
  const temp = await mkdtemp(path.join(os.tmpdir(), 'ks79-mutation-'));
  try {
    for (const relative of [INDEX_PATH, ...EXPECTED_CHILDREN.flatMap((child) => [child.artifact, child.receipt])]) {
      const destination = path.join(temp, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(path.join(ROOT, relative), destination);
    }
    const traceDestination = path.join(temp, TRACE_PATH);
    await mkdir(path.dirname(traceDestination), { recursive: true });
    await Promise.all([
      import('node:fs/promises').then(({ writeFile }) => writeFile(traceDestination, `${JSON.stringify(doc, null, 2)}\n`)),
      import('node:fs/promises').then(({ writeFile }) => writeFile(path.join(temp, INDEX_PATH), markdown)),
    ]);
    return await validateRoot(temp);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

const cliRootIndex = process.argv.indexOf('--validate-root');
if (cliRootIndex >= 0) {
  const violations = await validateRoot(path.resolve(process.argv[cliRootIndex + 1]));
  if (violations.length > 0) {
    console.error(violations.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('KS79_PARENT_CLOSURE_VALIDATED');
  }
} else {
  test('current-checkout parent closure binds exact released #89-#93 evidence', async () => {
    assert.deepEqual(await validateRoot(ROOT), []);
  });

  test('missing or open child and PACKAGE_DONE substitution fail closed', async () => {
    expectViolation(await withMutation((doc) => { doc.children[2].issueState = 'open'; }), 'child #91 must be publicly closed/completed');
    expectViolation(await withMutation((doc) => { doc.status = 'PACKAGE_DONE'; }), `status must be exactly ${TERMINAL}`);
    expectViolation(await withMutation((doc) => { doc.children.splice(4, 1); }), 'children must list exactly #89-#93');
  });

  test('authority, endpoint, data, API widening, and readiness negatives are mandatory', async () => {
    for (const id of NEGATIVE_IDS.slice(2)) {
      const violations = await withMutation((doc) => {
        doc.mandatoryNegatives = doc.mandatoryNegatives.filter((negative) => negative.id !== id);
      });
      expectViolation(violations, 'mandatory negatives must be exact and complete');
    }
    expectViolation(
      await withMutation((doc) => { doc.nonClaims = doc.nonClaims.filter((claim) => claim !== 'NO_DISCOVERY_AS_IMPLEMENTATION'); }),
      'nonClaims must preserve every authority and readiness boundary',
    );
  });

  test('validator is portable without repository history and uses process.execPath', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'ks79-portable-'));
    try {
      const paths = [TRACE_PATH, INDEX_PATH, ...EXPECTED_CHILDREN.flatMap((child) => [child.artifact, child.receipt])];
      for (const relative of paths) {
        const destination = path.join(temp, relative);
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(path.join(ROOT, relative), destination);
      }
      const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--validate-root', temp], {
        cwd: temp,
        encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /KS79_PARENT_CLOSURE_VALIDATED/);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}
