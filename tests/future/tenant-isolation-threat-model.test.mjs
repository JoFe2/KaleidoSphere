import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const FIXTURE_PATH = 'docs/future/remote-connector/fixtures/tenant-isolation-threat-model-v1.json';
const MEMO_PATH = 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md';

const loadFixture = async () => JSON.parse(await readFile(FIXTURE_PATH, 'utf8'));
const loadMemo = () => readFile(MEMO_PATH, 'utf8');

function deny(code) {
  const error = new Error(code);
  error.code = code;
  throw error;
}

function denialCodeOf(run) {
  try {
    run();
  } catch (error) {
    return error.code;
  }
  return null;
}

function validateSyntheticInput(candidate, model) {
  if (candidate.dataOrigin !== 'synthetic') deny('KS91_LIVE_DATA_DENIED');
  if (!candidate.tenantId || !candidate.tenantScope) deny('KS91_TENANT_SCOPE_REQUIRED_DENIED');
  if (candidate.sharedTenantIdentifier === true) deny('KS91_SHARED_TENANT_IDENTIFIER_DENIED');
  if (candidate.boundaryAmbiguous === true) deny('KS91_AMBIGUOUS_BOUNDARY_DENIED');
  if (candidate.bypassAllowed === true) deny('KS91_BYPASS_ALLOWED_DENIED');

  if (candidate.targetTenantId && candidate.targetTenantId !== candidate.tenantId) {
    const operationCodes = {
      read: 'KS91_CROSS_TENANT_READ_DENIED',
      write: 'KS91_CROSS_TENANT_WRITE_DENIED',
      export: 'KS91_CROSS_TENANT_EXPORT_DENIED',
    };
    deny(operationCodes[candidate.operation] ?? 'KS91_CROSS_TENANT_ACCESS_DENIED');
  }

  const flow = model.flows.find(({id}) => id === candidate.flowId);
  if (!flow) deny('KS91_UNKNOWN_FLOW_DENIED');
  if (flow.scope === 'explicitly-rejected') deny(flow.rejectCode);
  if (flow.scope !== 'tenant-scoped' || flow.tenantBinding !== 'same-tenant') {
    deny('KS91_AMBIGUOUS_BOUNDARY_DENIED');
  }
  if (candidate.tenantScope !== candidate.tenantId) deny('KS91_TENANT_SCOPE_MISMATCH_DENIED');
  return 'ACCEPTED';
}

test('model identifies all required isolation boundaries', async () => {
  const model = await loadFixture();
  assert.equal(model.schemaVersion, 'kaleidosphere.remote-connector/tenant-isolation-threat-model/v1');
  assert.equal(model.status, 'FROZEN_FUTURE_SURFACE');
  assert.equal(model.evidenceClass, 'synthetic-fixture-only');
  assert.equal(model.policy.default, 'DENY');
  assert.equal(model.policy.syntheticOnly, true);

  assert.deepEqual(
    model.boundaries.map(({id}) => id).sort(),
    ['control-plane', 'data-plane', 'external-destination', 'operator', 'tenant'],
  );
  for (const boundary of model.boundaries) {
    assert.ok(boundary.label.startsWith('Synthetic'), boundary.id);
    assert.ok(boundary.role.length > 0, boundary.id);
    assert.ok(boundary.isolationKey, boundary.id);
  }
  assert.deepEqual(model.diagram.nodes.sort(), model.boundaries.map(({id}) => id).sort());
  assert.equal(model.diagram.format, 'mermaid');
});

test('every synthetic flow is tenant-scoped or explicitly rejected', async () => {
  const model = await loadFixture();
  const boundaryIds = new Set(model.boundaries.map(({id}) => id));
  const tenantCandidate = {
    dataOrigin: 'synthetic',
    tenantId: 'synthetic-tenant-alpha-isolated',
    tenantScope: 'synthetic-tenant-alpha-isolated',
  };

  assert.ok(model.flows.length > 0);
  for (const flow of model.flows) {
    assert.equal(boundaryIds.has(flow.from), true, flow.id);
    assert.equal(boundaryIds.has(flow.to), true, flow.id);
    assert.ok(['tenant-scoped', 'explicitly-rejected'].includes(flow.scope), flow.id);
    if (flow.scope === 'tenant-scoped') {
      assert.equal(flow.decision, 'ALLOW', flow.id);
      assert.equal(flow.tenantBinding, 'same-tenant', flow.id);
      assert.equal(
        validateSyntheticInput({...tenantCandidate, flowId: flow.id}, model),
        'ACCEPTED',
        flow.id,
      );
    } else {
      assert.equal(flow.decision, 'REJECT', flow.id);
      assert.equal(typeof flow.rejectCode, 'string', flow.id);
      assert.equal(
        denialCodeOf(() => validateSyntheticInput({...tenantCandidate, flowId: flow.id}, model)),
        flow.rejectCode,
        flow.id,
      );
    }
  }

  for (const edge of model.diagram.edges) {
    assert.ok(['tenant-scoped', 'explicitly-rejected'].includes(edge.scope), edge.id);
    assert.equal(edge.decision, edge.scope === 'tenant-scoped' ? 'ALLOW' : 'REJECT', edge.id);
  }
});

test('mandatory cross-tenant read, write, and export flows fail closed', async () => {
  const model = await loadFixture();
  const expectedCodes = new Set();
  for (const negative of model.negativeCases.filter(({id}) => id.includes('cross-tenant'))) {
    expectedCodes.add(negative.expectedCode);
    assert.equal(
      denialCodeOf(() => validateSyntheticInput(negative.candidate, model)),
      negative.expectedCode,
      negative.id,
    );
  }
  assert.deepEqual(expectedCodes, new Set([
    'KS91_CROSS_TENANT_READ_DENIED',
    'KS91_CROSS_TENANT_WRITE_DENIED',
    'KS91_CROSS_TENANT_EXPORT_DENIED',
  ]));
  assert.equal(model.policy.crossTenantReadAllowed, false);
  assert.equal(model.policy.crossTenantWriteAllowed, false);
  assert.equal(model.policy.crossTenantExportAllowed, false);
});

test('all hard reject conditions have stable denial evidence', async () => {
  const model = await loadFixture();
  const requiredCodes = [
    'KS91_SHARED_TENANT_IDENTIFIER_DENIED',
    'KS91_CROSS_TENANT_READ_DENIED',
    'KS91_CROSS_TENANT_WRITE_DENIED',
    'KS91_CROSS_TENANT_EXPORT_DENIED',
    'KS91_AMBIGUOUS_BOUNDARY_DENIED',
    'KS91_BYPASS_ALLOWED_DENIED',
  ];
  const fixtureCodes = model.hardRejectConditions.map(({code}) => code);
  assert.deepEqual(new Set(fixtureCodes), new Set(requiredCodes));

  for (const negative of model.negativeCases) {
    assert.equal(requiredCodes.includes(negative.expectedCode), true, negative.id);
    assert.equal(
      denialCodeOf(() => validateSyntheticInput(negative.candidate, model)),
      negative.expectedCode,
      negative.id,
    );
  }
  assert.equal(model.policy.sharedTenantIdentifierAllowed, false);
  assert.equal(model.policy.ambiguousBoundaryAllowed, false);
  assert.equal(model.policy.bypassAllowed, false);
});

test('threat model memo records its synthetic diagram and fail-closed boundary rules', async () => {
  const memo = await loadMemo();
  for (const marker of [
    'Tenant-isolation threat model',
    'synthetic boundary/data-flow diagram',
    'Tenant boundary',
    'Control plane boundary',
    'Data plane boundary',
    'Operator boundary',
    'External destination boundary',
    'Every flow is either tenant-scoped or explicitly rejected',
    'cross-tenant read',
    'cross-tenant write',
    'cross-tenant export',
    'ambiguous boundary',
    'allowed bypass',
    'hard reject',
  ]) {
    assert.match(memo, new RegExp(marker, 'i'), marker);
  }
});
