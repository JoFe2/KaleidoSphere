import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const moduleUrl = new URL('../scripts/lib/h01-local-demo-probe.mjs', import.meta.url);

test('H01 local business probe verifies the real demo truth rather than HTTP 200', async () => {
  assert.ok(fs.existsSync(moduleUrl), 'KS-H01 actual local-demo business probe is absent');
  const { checkLocalDemoBusinessReadback } = await import(moduleUrl.href);
  // Public deterministic MSSQL metadata fixture, actually collected through the
  // qualified local product. No live database/provider/hosting authority claim.
  const reply = {
    httpStatus: 200,
    body: {
      schemaVersion: 'chimpmaera.bi/readback/v1',
      generationId: '9b1bfd2b0733041d70117bcb2932e1eb12943ff3963910faa6b9c2ebff1ff13c',
      summary: {
        source_engine: 'mssql', source_database: 'CM_BI_FIXTURE', source_mode: 'fixture',
        runtime_validation: 'SYNTHETIC_UNVALIDATED', status: 'ANALYZED_READ_ONLY',
        relation_count: 2, column_count: 3, constraint_count: 1, index_count: 1,
        source_read_only: 1,
      },
      detailCount: 3,
      technicalOverview: {systemSchemaRows: 1, tableCapacityRows: 2, codeDependencyRows: 0, coverageRows: 9, biCandidateRows: 2},
      projectionMirror: {state: 'IN_SYNC', inSync: true},
    },
  };
  const good = checkLocalDemoBusinessReadback(reply);
  assert.equal(good.status, 'LOCAL_BUSINESS_FACTS_VERIFIED');
  assert.equal(good.hostedRouteOpen, false, 'Business facts alone never grant a route or identity authority');
  const wrong = structuredClone(reply);
  wrong.body.summary.relation_count = 3;
  const denied = checkLocalDemoBusinessReadback(wrong);
  assert.equal(denied.status, 'NOT_READY');
  assert.equal(denied.code, 'LOCAL_DEMO_BUSINESS_VALUE_MISMATCH');
  assert.equal(denied.hostedRouteOpen, false);
});

test('H01 local business probe rejects getters and proxies without executing them', async () => {
  const { checkLocalDemoBusinessReadback } = await import(moduleUrl.href);
  let calls = 0;
  const getter = {httpStatus: 200};
  Object.defineProperty(getter, 'body', {enumerable: true, get() { calls += 1; return {}; }});
  const result = checkLocalDemoBusinessReadback(getter);
  assert.equal(calls, 0, 'Untrusted readiness input accessor must not execute');
  assert.equal(result.status, 'NOT_READY');
  assert.equal(result.code, 'LOCAL_DEMO_INPUT_DENIED');
  const proxy = new Proxy({}, {get() { calls += 1; return undefined; }, ownKeys() { calls += 1; return []; }});
  assert.equal(checkLocalDemoBusinessReadback(proxy).code, 'LOCAL_DEMO_INPUT_DENIED');
  assert.equal(calls, 0, 'Untrusted readiness proxy must not execute');
});
