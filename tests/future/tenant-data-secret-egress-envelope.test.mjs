import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  TENANT_DATA_SECRET_EGRESS_CONTRACT_ID,
  TENANT_DATA_SECRET_EGRESS_PRODUCT_VERSION,
  validateTenantDataSecretEgressContractV1,
} from '../../scripts/future/validate-tenant-data-secret-egress.mjs';

const MEMO_PATH = 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md';
const CONTRACT_PATH = 'docs/future/remote-connector/fixtures/tenant-data-secret-egress-contract-v1.json';
const SOLE_ALLOWED_DOCUMENT_PATH = 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md';

const REQUIRED_MEMO_MARKERS = [
  'FUTURE_BACKLOG',
  'Status: `FUTURE_BACKLOG` / planning-only',
  'Planning-only memo envelope',
  `Sole allowed document path: \`${SOLE_ALLOWED_DOCUMENT_PATH}\``,
  'Admission condition:',
  'Hard reject conditions:',
  'synthetic evidence only',
  'The only terminal states are `RELEASED` and `REJECTED_WITH_EVIDENCE`.',
  'Supersede the planning document',
  'Rollback',
  '## Non-claims',
];

const AUTHORIZATION_PATTERNS = [
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:an?\s+)?(?:network\s+)?endpoint\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:tenant\s+|customer\s+)?onboarding\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:the\s+)?credential(?:s)?\s+(?:capture|storage|transport)\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:a\s+)?deployment\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:a\s+)?database\s+connection\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:customer\s+)?live\s+data\b/i,
  /\b(?:authorizes?|allows?|enables?|approves?|permits?)\s+(?:the\s+)?production\s+logging\b/i,
];

const loadMemo = () => readFile(MEMO_PATH, 'utf8');
const loadContract = () => readFile(CONTRACT_PATH, 'utf8').then(JSON.parse);

function validatePlanningMemo(memo) {
  for (const marker of REQUIRED_MEMO_MARKERS) assert.ok(memo.includes(marker), marker);
  for (const pattern of AUTHORIZATION_PATTERNS) assert.doesNotMatch(memo, pattern);
  assert.match(memo, /no live data, credentials, endpoint, onboarding, deployment, database\s+connection/i);
  assert.match(memo, /production logging/i);
  return memo;
}

test('memo envelope is an explicitly admitted planning-only future backlog item', async () => {
  validatePlanningMemo(await loadMemo());
});

test('memo hard-rejects endpoint, onboarding, credentials, deployment, database, live-data, and logging authorization', async () => {
  const memo = await loadMemo();
  const unauthorizedAdditions = [
    'This memo authorizes an endpoint.',
    'This memo allows customer onboarding.',
    'This memo permits credential capture.',
    'This memo approves a deployment.',
    'This memo enables a database connection.',
    'This memo authorizes customer live data.',
    'This memo allows production logging.',
  ];

  for (const addition of unauthorizedAdditions) {
    assert.throws(
      () => validatePlanningMemo(`${memo}\n${addition}`),
      (error) => error?.code === 'ERR_ASSERTION',
    );
  }
});

test('contract fixture is synthetic evidence only and remains fail-closed', async () => {
  const contract = await loadContract();
  const checked = validateTenantDataSecretEgressContractV1(contract);
  const serialized = JSON.stringify(contract);

  assert.equal(checked.contractId, TENANT_DATA_SECRET_EGRESS_CONTRACT_ID);
  assert.equal(checked.productVersion, TENANT_DATA_SECRET_EGRESS_PRODUCT_VERSION);
  assert.equal(checked.status, 'FROZEN_FUTURE_SURFACE');
  assert.equal(checked.policy.default, 'DENY');
  assert.equal(checked.integration.remoteConnectorImplemented, false);
  assert.equal(checked.integration.externalApiV2Changed, false);
  assert.equal(checked.integration.supersetBoundaryChanged, false);
  assert.equal(checked.integration.secretFileLayoutChanged, false);
  assert.equal(Object.hasOwn(checked, 'egress'), false);
  for (const [name, value] of Object.entries(checked.policy)) {
    if (name === 'default') continue;
    assert.equal(value, false, name);
  }

  assert.doesNotMatch(serialized, /https?:\/\/|(?:postgres|mssql|oracle):\/\//i);
  assert.doesNotMatch(serialized, /BEGIN [A-Z ]*PRIVATE KEY|\b(?:password|api[_-]?key|bearer)\s*[:=]/i);
  assert.doesNotMatch(serialized, /\b(?:customer|production)\b/i);
});
