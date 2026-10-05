import assert from 'node:assert/strict';
import test from 'node:test';

let consumer;
try {
  consumer = await import('../services/bi-control/src/runtime/pan-origin-source.mjs');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('/runtime/pan-origin-source.mjs')) throw error;
}

test('H02 consumes the exact public PAN origin rule without inventing a KS protected-session capability', async () => {
  assert.equal(typeof consumer?.loadH02PanOriginSourceV1, 'function',
    'The H02 optional origin seam must consume the pinned producer, not a duplicate common schema');
  assert.ok(process.env.KS293_PAN527_SOURCE, 'Exact operator-acquired PAN527 source is required; absence is not PASS or SKIP');
  const source = await consumer.loadH02PanOriginSourceV1(process.env.KS293_PAN527_SOURCE);
  try {
    assert.equal(source.producerCommit, '8ed580342b1b7392ff3c56175d507084cdbaa8ad');
    assert.equal(source.producerTree, '83c8f0f439969736624a5bd6f0d165fc9dc4f6b6');
    assert.equal(source.contractSha256, '3a6d8eb1e9eb3e494bcc2ef15da0581d84b428f431b17b77bc27952c453ce200');
    assert.equal(source.KSProtectedSessionAvailable, false);
    assert.equal(source.executionAuthorityGranted, false);
    assert.equal(consumer.validateH02PanOriginV1(source, 'https://ks293.test:4443'), 'https://ks293.test:4443');
    assert.equal(consumer.validateH02PanOriginV1(source, 'https://127.0.0.1:4443'), 'https://127.0.0.1:4443');
  } finally { consumer.releaseH02PanOriginSourceV1(source); }
});

test('H02 origin consumer denies alias origins and copied or released source handles', async () => {
  const source = await consumer.loadH02PanOriginSourceV1(process.env.KS293_PAN527_SOURCE);
  try {
    for (const origin of ['', undefined, 'http://127.0.0.1:4443', 'https://ks293.test:4443/',
      'https://caller@ks293.test:4443', 'https://ks293.test:4443?tenant=tenant-b',
      'https://ks293.test:4443#role=reviewer', 'https://KS293.test:4443',
      'https://ks293.test:443', 'https://ks293.test:04443', 'https://ks293.test:65536']) {
      assert.throws(() => consumer.validateH02PanOriginV1(source, origin), /HOSTED_ORIGIN_DENIED/);
    }
    assert.throws(() => consumer.validateH02PanOriginV1({ ...source }, 'https://ks293.test:4443'),
      /H02_PAN_ORIGIN_SOURCE_DENIED/);
  } finally { consumer.releaseH02PanOriginSourceV1(source); }
  assert.throws(() => consumer.validateH02PanOriginV1(source, 'https://ks293.test:4443'),
    /H02_PAN_ORIGIN_SOURCE_DENIED/);
});
