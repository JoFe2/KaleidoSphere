import test from 'node:test';
import assert from 'node:assert/strict';
const moduleUrl = new URL('../scripts/lib/h01-local-stack-facts.mjs', import.meta.url);
// Unit-only public synthetic examples; real isolated stack probes are separate.
const unitReply = () => ({httpStatus: 200, body: {
  schemaVersion: 'chimpmaera.bi/readback/v1', generationId: 'a'.repeat(64),
  summary: {source_engine: 'mssql', source_database: 'CM_BI_FIXTURE', source_mode: 'fixture',
    runtime_validation: 'SYNTHETIC_UNVALIDATED', status: 'ANALYZED_READ_ONLY', source_read_only: 1,
    relation_count: 2, column_count: 3, constraint_count: 1, index_count: 1},
  detailCount: 3, catalogSnapshot: {snapshot_sha256: '293a896156d8f6269c4ad33e8d632da653ea180d35a4ea5f390b0be52ce3e44a'},
  technicalOverview: {systemSchemaRows: 1, tableCapacityRows: 2, codeDependencyRows: 0, coverageRows: 9, biCandidateRows: 2},
  publication: {datasets: 6, charts: 13, dashboards: 5},
  projectionMirror: {state: 'IN_SYNC', inSync: true}
}});
const unitPins = () => Object.fromEntries(['superset-init', 'superset', 'bi-control', 'bi-agent'].map(role => [role, 'sha256:' + 'a'.repeat(64)]));
const unitImages = () => Object.entries(unitPins()).map(([component, imageId]) => ({ component, imageId }));

test('H01 stack caller requires every local service while retaining partial image-helper semantics', async () => {
  const mod = await import(moduleUrl.href).catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
    throw error;
  });
  assert.equal(typeof mod.checkLocalDemoStackFacts, 'function', 'Missing actual local caller service-completeness check');
  const check = mod.checkLocalDemoStackFacts;
  const complete = check({ readback: unitReply(), imageObservations: unitImages() }, 'a'.repeat(64), unitPins());
  assert.equal(complete.status, 'LOCAL_STACK_FACTS_VERIFIED');
  assert.equal(complete.hostedRouteOpen, false);
  for (const missing of Object.keys(unitPins())) {
    const subset = unitImages().filter(row => row.component !== missing);
    const { checkLocalDemoImageObservations } = await import('../scripts/lib/h01-local-image-observations.mjs');
    assert.equal(checkLocalDemoImageObservations(subset, unitPins()).status, 'LOCAL_IMAGE_OBSERVATIONS_MATCHED');
    const denied = check({ readback: unitReply(), imageObservations: subset }, 'a'.repeat(64), unitPins());
    assert.equal(denied.status, 'NOT_READY');
    assert.equal(denied.code, 'LOCAL_DEMO_REQUIRED_SERVICE_OBSERVATION_MISSING');
    assert.equal(denied.hostedRouteOpen, false);
  }
});

test('H01 stack caller denies liveness wrong business stale generation and caller execution metadata', async () => {
  const { checkLocalDemoStackFacts: check } = await import(moduleUrl.href);
  const good = () => ({ readback: unitReply(), imageObservations: unitImages() });
  const wrongBusiness = good(); wrongBusiness.readback.body.summary.relation_count = 3;
  assert.equal(check(wrongBusiness, 'a'.repeat(64), unitPins()).code, 'LOCAL_DEMO_BUSINESS_VALUE_MISMATCH');
  const stale = good(); stale.readback.body.generationId = 'b'.repeat(64);
  assert.equal(check(stale, 'a'.repeat(64), unitPins()).code, 'LOCAL_DEMO_ACTUAL_GENERATION_MISMATCH');
  const liveOnly = good(); liveOnly.readback = { httpStatus: 200, body: { status: 'ok' } };
  assert.equal(check(liveOnly, 'a'.repeat(64), unitPins()).status, 'NOT_READY');
  const metadata = good(); metadata.executionAuthorityGranted = true;
  assert.equal(check(metadata, 'a'.repeat(64), unitPins()).code, 'LOCAL_DEMO_STACK_INPUT_DENIED');
});
