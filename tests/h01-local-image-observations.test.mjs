import test from 'node:test';
import assert from 'node:assert/strict';
const moduleUrl = new URL('../scripts/lib/h01-local-image-observations.mjs', import.meta.url);
const unitPins = () => Object.fromEntries(['superset-init','superset','bi-control','bi-agent'].map(role => [role,'sha256:'+'a'.repeat(64)]));

test('H01 compares KS-local Docker image observations against qualified held bytes', async () => {
  const mod = await import(moduleUrl.href).catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.url === moduleUrl.href) return {};
    throw error;
  });
  assert.equal(typeof mod.checkLocalDemoImageObservations, 'function', 'Missing KS-local actual image observation comparison');
  const check = mod.checkLocalDemoImageObservations;
  const good = check([{component:'bi-control',imageId:'sha256:'+'a'.repeat(64)}], unitPins());
  assert.equal(good.status,'LOCAL_IMAGE_OBSERVATIONS_MATCHED');
  assert.equal(good.hostedRouteOpen,false);
  const wrong = check([{component:'bi-control',imageId:'sha256:'+'b'.repeat(64)}], unitPins());
  assert.equal(wrong.status,'NOT_READY');
  assert.equal(wrong.code,'LOCAL_DEMO_ACTUAL_IMAGE_MISMATCH');
  assert.equal(wrong.hostedRouteOpen,false);
});

test('H01 local image comparison refuses mutable aliases rather than qualifying their equality', async () => {
  const {checkLocalDemoImageObservations: check} = await import(moduleUrl.href);
  for (const alias of ['main','latest','sha256:'+'A'.repeat(64)]) {
    const pins = unitPins(); pins['bi-control'] = alias;
    const verdict = check([{component:'bi-control',imageId:alias}],pins);
    assert.equal(verdict.status,'NOT_READY','Matching aliases are not qualified image bytes');
    assert.equal(verdict.code,'LOCAL_DEMO_HELD_IMAGE_PIN_DENIED');
    assert.equal(verdict.hostedRouteOpen,false);
  }
});

test('H01 image facts cannot add KS-local Docker roles or permission metadata', async () => {
  const {checkLocalDemoImageObservations: check} = await import(moduleUrl.href);
  const pins = unitPins(); pins['billing-admin'] = 'sha256:'+'a'.repeat(64);
  const unknown = check([{component:'billing-admin',imageId:pins['billing-admin']}],pins);
  assert.equal(unknown.status,'NOT_READY','Unknown local roles must not be supplied by metadata');
  assert.equal(unknown.code,'LOCAL_DEMO_IMAGE_SCOPE_OR_ROLE_DENIED');
  const rights = check([{component:'bi-control',imageId:unitPins()['bi-control'],rights:['admin']}],unitPins());
  assert.equal(rights.status,'NOT_READY');
  assert.equal(rights.code,'LOCAL_DEMO_IMAGE_SCOPE_OR_ROLE_DENIED');
  assert.equal(rights.hostedRouteOpen,false);
  const duplicate = check([{component:'bi-control',imageId:unitPins()['bi-control']},{component:'bi-control',imageId:unitPins()['bi-control']}],unitPins());
  assert.equal(duplicate.status,'NOT_READY');
});
