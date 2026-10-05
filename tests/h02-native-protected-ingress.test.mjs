import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadH02PanOriginSourceV1, releaseH02PanOriginSourceV1 } from '../services/bi-control/src/runtime/pan-origin-source.mjs';

let ingress;
try { ingress = await import('../services/bi-control/src/hosting/origin-session-ingress.mjs'); }
catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('/hosting/origin-session-ingress.mjs')) throw error;
}

test('H02 optional native ingress requires explicit opt-in and the real KS-capable pinned producer', async () => {
  assert.equal(typeof ingress?.createH02OptionalNativeIngressV1, 'function',
    'The native HTTPS product ingress must use the shared protected-route session consumer');
  assert.throws(() => ingress.createH02OptionalNativeIngressV1({ optIn: false }), /H02_HOSTED_OPT_IN_REQUIRED/);
  const source = await loadH02PanOriginSourceV1(process.env.KS293_PAN527_SOURCE);
  const stateRoot = mkdtempSync(join(tmpdir(), 'ks293-native-ingress-unavailable-'));
  const options = { optIn: true, source, origin: 'https://127.0.0.1:4443',
    tls: { keyPath: '/not-created/key.pem', certPath: '/not-created/cert.pem' },
    tenants: [{ routeBinding: { componentId: 'kaleidosphere-bi-control', tenantId: 'tenant-a' },
      stateRoot, agentOrigin: 'http://127.0.0.1:18790' }] };
  try {
    assert.throws(() => ingress.createH02OptionalNativeIngressV1(options), /H02_KS_SESSION_CAPABILITY_UNAVAILABLE/,
      'The public PAN-only predecessor cannot be used as KS-session authority or fall back to unsecured HTTP');
    assert.deepEqual(readdirSync(stateRoot), [], 'No session persistence or listener is created on missing capability');
    assert.throws(() => ingress.createH02OptionalNativeIngressV1({ ...options, source: { ...source, KSProtectedSessionAvailable: true } }), /H02_PAN_ORIGIN_SOURCE_DENIED/);
  } finally { releaseH02PanOriginSourceV1(source); rmSync(stateRoot, { recursive: true, force: true }); }
});
