import test from 'node:test';
import assert from 'node:assert/strict';

const moduleUrl = new URL('../scripts/lib/h01-local-bound-readback.mjs', import.meta.url);

// Explicit unit-only public synthetic business fixture; real Docker/HTTP proof
// is collected separately, never inferred from this constructed input.
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

test('H01 local fact observation rejects a changed actual generation against held bytes', async () => {
  const mod = await import(moduleUrl.href).catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
    throw error;
  });
  assert.equal(typeof mod.checkLocalDemoBoundReadback, 'function', 'Missing KS-local actual generation binding');
  const check = mod.checkLocalDemoBoundReadback;
  const good = check(unitReply(), 'a'.repeat(64));
  assert.equal(good.status, 'LOCAL_BUSINESS_FACTS_VERIFIED');
  assert.equal(good.hostedRouteOpen, false);
  const wrong = unitReply(); wrong.body.generationId = 'b'.repeat(64);
  const denied = check(wrong, 'a'.repeat(64));
  assert.equal(denied.status, 'NOT_READY');
  assert.equal(denied.code, 'LOCAL_DEMO_ACTUAL_GENERATION_MISMATCH');
  assert.equal(denied.hostedRouteOpen, false);
});

test('H01 held generation requires the exact KS254 content digest, never aliases or absent pins', async () => {
  const {checkLocalDemoBoundReadback: check} = await import(moduleUrl.href);
  for (const alias of ['main', 'latest', 'A'.repeat(64), undefined]) {
    const reply = unitReply();
    if (alias === undefined) delete reply.body.generationId;
    else reply.body.generationId = alias;
    const denied = check(reply, alias);
    assert.equal(denied.status, 'NOT_READY', 'Unqualified or absent generation must never match');
    assert.equal(denied.code, 'LOCAL_DEMO_HELD_GENERATION_PIN_DENIED');
    assert.equal(denied.hostedRouteOpen, false);
  }
});
