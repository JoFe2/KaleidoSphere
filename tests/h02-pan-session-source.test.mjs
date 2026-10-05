import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import * as consumer from '../services/bi-control/src/runtime/pan-origin-source.mjs';

// Exact executable producer/consumer pairing with synthetic binding/store
// options. Native KS binding acquisition and HTTPS/browser use are separate.
test('H02 consumes executable pinned PAN v3 without a RuntimeIdentity enum extension or mutation adapter', async () => {
  assert.equal(typeof consumer.loadH02PanSessionSourceV1, 'function', 'Explicit executable v3 selector is required, not v1 promotion');
  const source = await consumer.loadH02PanSessionSourceV1(process.env.KS293_PAN527_SESSION_SOURCE);
  const root = mkdtempSync(join(tmpdir(), 'ks293-v3-source-store-'));
  const routeBinding = {
    schemaVersion: 'pansphaira.hosted-origin-session/protected-route-binding/v1',
    componentId: 'kaleidosphere-bi-control', entrypointPath: 'services/bi-control/src/server.mjs',
    sourceCommit: '67c611c6b523d8d8ee329a65f8a00a589de81e1e', sourceTree: 'c36229b762bac232eb5cc942c9d68272076ee46c',
    entrypointSha256: '8b4e3bed4aec797dd4d556148c48530736fe991fa25cfaae1412c8b97319eda1',
    runtime: { name: 'node', version: process.version.slice(1) }, instanceId: 'ks293-v3-store-shape', tenantId: 'tenant-a', generation: 1,
  };
  try {
    assert.equal(source.producerCommit, '6a7752be07405bd03ccbc40c13a9936d1b8d0d2b');
    assert.equal(source.producerTree, '43f33d0c3c14aacc23f1497aae7a0f83f1cd7f30');
    assert.equal(source.contractSha256, 'cd87f1a1a5942bea20ac19cc8b08d5e32861c1e2499b9895b9d759fb4ba7b20b');
    assert.equal(source.KSProtectedSessionAvailable, true); assert.equal(source.executionAuthorityGranted, false);
    const options = { optIn: true, origin: 'https://127.0.0.1:4443', stateRoot: root, routeBinding };
    const sessions = consumer.createH02PanProtectedRouteSessionsV1(source, options);
    assert.equal(sessions.authorizeMutation, undefined);
    assert.equal(sessions.binding.componentId, 'kaleidosphere-bi-control');
    assert.equal(sessions.binding.audience, 'kaleidosphere-protected-control-origin-v1');
    const issued = sessions.issueOwnerSession({ subjectId: 'synthetic-source-reader', role: 'reader', expiresAtMs: Date.now() + 60000 });
    const headers = { cookie: issued.cookieHeader, origin: options.origin, 'x-pan527-csrf': issued.csrf };
    assert.equal(sessions.authorizeReadOperation(headers).tenantId, 'tenant-a');
    assert.equal(typeof sessions.responseCookie, 'function', 'The native HTTPS response must reuse actual producer cookie policy');
    assert.match(sessions.responseCookie(headers), /^__Host-ks293-session=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=/);
    assert.throws(() => sessions.authorizeReadOperation({ ...headers, 'x-pan527-csrf': undefined }), /HOSTED_CSRF_DENIED/);
    assert.throws(() => sessions.authenticate({ ...headers, 'x-role': 'owner' }), /HOSTED_HEADER_AUTHORITY_DENIED/);
    assert.throws(() => consumer.createH02PanProtectedRouteSessionsV1({ ...source }, options), /H02_PAN_ORIGIN_SOURCE_DENIED/);
    const schema = JSON.parse(readFileSync(join(process.env.KS293_PAN527_SESSION_SOURCE, 'contracts/runtime-portability/portable-runtime-v1.schema.json')));
    assert.deepEqual(schema.$defs.RuntimeIdentity.properties.componentId.enum, ['pansphaira-local-demo', 'kaleidosphere-bi-agent']);
    consumer.releaseH02PanOriginSourceV1(source);
    assert.throws(() => sessions.authenticate(headers), /H02_PAN_ORIGIN_SOURCE_DENIED/);
  } finally {
    try { consumer.releaseH02PanOriginSourceV1(source); } catch (error) { assert.match(error.message, /H02_PAN_ORIGIN_SOURCE_DENIED/); }
    rmSync(root, { recursive: true, force: true });
  }
});
