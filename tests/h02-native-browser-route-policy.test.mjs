import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveH02NativeBrowserRouteV1 } from '../services/bi-agent/src/hosted-route-policy.mjs';

// Product-route selection only: these results are NOT authenticated principals
// or protected-session authority. Pairing the real PAN adapter is separate.
test('H02 native browser route selection is closed to the fixed owning tenant', () => {
  const page = resolveH02NativeBrowserRouteV1('tenant-a', 'GET', '/t/tenant-a/');
  assert.deepEqual(page, { tenantId: 'tenant-a', requestTarget: '/t/tenant-a/', kind: 'page' });
  assert.ok(Object.isFrozen(page));
  for (const file of ['kaleidosphere-logo.svg', 'kaleidosphere-logo.png', 'favicon-16x16.png',
    'favicon-32x32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']) {
    const target = '/t/tenant-a/assets/' + file;
    assert.deepEqual(resolveH02NativeBrowserRouteV1('tenant-a', 'GET', target),
      { tenantId: 'tenant-a', requestTarget: target, kind: 'asset' });
  }
  assert.deepEqual(resolveH02NativeBrowserRouteV1('tenant-a', 'POST', '/t/tenant-a/api/chat'),
    { tenantId: 'tenant-a', requestTarget: '/t/tenant-a/api/chat', kind: 'read-operation' });
});

test('H02 native route selection denies foreign tenants, effects, files and URL aliases', () => {
  const targets = ['/', '/api/chat', '/t/tenant-b/', '/t/tenant-b/api/chat',
    '/t/tenant-a', '/t/tenant-a//', '/t/tenant-a/../tenant-b/', '/t/tenant-a/%2e%2e/tenant-b/',
    '/t/tenant-a%2f../tenant-b/', '/t/tenant-a/?redirect=https://not-owned.invalid',
    '/t/tenant-a/#fragment', '/t/tenant-a/api/chat?tenant=tenant-b',
    '/t/tenant-a/assets/unknown.svg', '/t/tenant-a/assets/../../run/secrets/control-auth',
    '/t/tenant-a/run/secrets/control-auth', '/t/tenant-a/v1/publish', '/t/tenant-a/v2/intents',
    '/t/tenant-a/v1/apply', '/t/tenant-a/v1/rollback', '/t/tenant-a/session',
    'https://not-owned.invalid/t/tenant-a/', '//not-owned.invalid/t/tenant-a/',
    '/t/tenant-a/\\tenant-b', '/t/tenant-a/\u0000', '/t/TENANT-A/'];
  for (const target of targets) for (const method of ['GET', 'POST']) {
    assert.throws(() => resolveH02NativeBrowserRouteV1('tenant-a', method, target), /H02_PRODUCT_ROUTE_DENIED/,
      `Must deny ${method} ${JSON.stringify(target)}`);
  }
  for (const [method, target] of [['POST', '/t/tenant-a/'], ['GET', '/t/tenant-a/api/chat'],
    ['HEAD', '/t/tenant-a/'], ['OPTIONS', '/t/tenant-a/api/chat'], ['DELETE', '/t/tenant-a/']]) {
    assert.throws(() => resolveH02NativeBrowserRouteV1('tenant-a', method, target), /H02_PRODUCT_ROUTE_DENIED/);
  }
  for (const tenant of ['tenant-a/', 'tenant-a?', '../tenant-b', 'tenant-a\"<script>', '', null, {}, 'A', 'a'.repeat(65)]) {
    assert.throws(() => resolveH02NativeBrowserRouteV1(tenant, 'GET', '/t/tenant-a/'), /H02_PRODUCT_ROUTE_DENIED/);
  }
});
