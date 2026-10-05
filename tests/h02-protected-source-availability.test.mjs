import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as consumer from '../services/bi-control/src/runtime/pan-origin-source.mjs';

test('H02 cannot turn the actual PAN-only development source or a copied handle into KS sessions', async () => {
  assert.equal(typeof consumer.createH02PanProtectedRouteSessionsV1, 'function',
    'Product wiring needs an opaque source-bound shared session consumer, never a duplicate session implementation');
  const source = await consumer.loadH02PanOriginSourceV1(process.env.KS293_PAN527_SOURCE);
  const stateRoot = mkdtempSync(join(tmpdir(), 'ks293-unavailable-session-'));
  const options = { optIn: true, origin: 'https://127.0.0.1:4443', stateRoot,
    routeBinding: { componentId: 'kaleidosphere-bi-control' } };
  try {
    assert.throws(() => consumer.createH02PanProtectedRouteSessionsV1(source, options), /H02_KS_SESSION_CAPABILITY_UNAVAILABLE/);
    assert.throws(() => consumer.createH02PanProtectedRouteSessionsV1({ ...source, KSProtectedSessionAvailable: true }, options), /H02_PAN_ORIGIN_SOURCE_DENIED/);
    assert.throws(() => consumer.createH02PanProtectedRouteSessionsV1({ authenticate: () => ({ role: 'owner' }) }, options), /H02_PAN_ORIGIN_SOURCE_DENIED/);
  } finally { consumer.releaseH02PanOriginSourceV1(source); rmSync(stateRoot, { recursive: true, force: true }); }
  assert.throws(() => consumer.createH02PanProtectedRouteSessionsV1(source, options), /H02_PAN_ORIGIN_SOURCE_DENIED/);
});
