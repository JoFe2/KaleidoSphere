import test from 'node:test';
import assert from 'node:assert/strict';
const moduleUrl = new URL('../services/bi-control/src/runtime/pan-runtime-source.mjs', import.meta.url);
const sourceRoot = process.env.KS292_PAN526_SOURCE;
// Explicit identity-shape fixture only. Native acquisition is tested separately.
const identity = () => ({ schemaVersion: 'pansphaira.portable-runtime/identity/v1',
  componentId: 'kaleidosphere-bi-agent', sourceCommit: 'dfc7f2ae2399109b90fe8a101f2d4eed465a7cef',
  sourceTree: 'ff9949615ec27bb37d848b0b01ca41d55f6994b7', imageDigest: 'sha256:' + 'a'.repeat(64),
  architecture: 'x86_64', productVersion: '0.18.1', runtime: { name: 'node', version: '24.14.0' },
  contractVersion: '1.0.0', instanceId: 'ks-unit-only', tenantId: 'synthetic-unit-only', generation: 1,
  authorityProfile: 'SAFE_GUIDED', effectiveRights: ['bi.catalog.read'],
  configurationDigest: 'b'.repeat(64), templateDigest: 'c'.repeat(64),
  policyDigest: 'd'.repeat(64), networkDigest: 'e'.repeat(64) });

test('H01 consumes the exact public implemented PAN contract without defining a second schema', async () => {
  assert.ok(sourceRoot, 'The exact public PAN526 source closure is required; no fake API or skipped contract test');
  const mod = await import(moduleUrl.href).catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
    throw error;
  });
  assert.equal(typeof mod.loadH01PanRuntimeSourceV1, 'function', 'Missing immutable common-runtime source consumer');
  const source = await mod.loadH01PanRuntimeSourceV1(sourceRoot);
  assert.equal(source.producerCommit, '700c7ca369e2ac7aca4973480b4e265bfcffb454');
  assert.equal(source.contractSha256, '7c49eb32b45d4942f81828713babd45ef643a4d63b230e039445e6e9c2c6ebcb');
  assert.equal(source.executionAuthorityGranted, false);
  const validated = mod.applyH01PanRuntimeContractV1(source, 'validateRuntimeIdentityV1', identity());
  assert.deepEqual(validated, identity());
  assert.ok(Object.isFrozen(validated) && Object.isFrozen(validated.runtime));
  const wrong = identity(); wrong.runtime = { name: 'superset', version: '6.1.0' };
  assert.throws(() => mod.applyH01PanRuntimeContractV1(source, 'validateRuntimeIdentityV1', wrong), /RUNTIME_IDENTITY_DENIED/);
  assert.throws(() => mod.applyH01PanRuntimeContractV1({ ...source }, 'validateRuntimeIdentityV1', identity()), /H01_PAN_SOURCE_DENIED/);
  assert.equal(typeof mod.releaseH01PanRuntimeSourceV1, 'function', 'Loaded private SDK closure must have explicit owned cleanup');
  mod.releaseH01PanRuntimeSourceV1(source);
  assert.throws(() => mod.applyH01PanRuntimeContractV1(source, 'validateRuntimeIdentityV1', identity()), /H01_PAN_SOURCE_DENIED/);
  assert.throws(() => mod.releaseH01PanRuntimeSourceV1(source), /H01_PAN_SOURCE_DENIED/);
});
