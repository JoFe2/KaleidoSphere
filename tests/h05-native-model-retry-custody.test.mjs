import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { H05NativeModelTransportV1 } from '../services/bi-control/src/runtime/h05-native-model-transport.mjs';

test('H05 native caller cannot configure blind inherited retries', () => {
  assert.throws(() => new H05NativeModelTransportV1({ optIn: true,
    baseUrl: 'http://127.0.0.1:12345/v1', model: 'owned-synthetic-only', maxRetries: 1 }),
  { message: 'H05_NATIVE_BLIND_RETRY_DENIED' });
});

test('H05 native accepted POST with 503 cannot blind-retry unresolved usage through inherited default retries', async () => {
  let dispatches = 0;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { /* accept the real entire native POST */ }
    dispatches += 1;
    response.writeHead(503, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: 'owned synthetic no completion/usage evidence' }));
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const adapter = new H05NativeModelTransportV1({ optIn: true, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'owned-synthetic-only' });
    const options = { idempotencyKey: 'ks295-unknown-503', messages: [{ role: 'user', content: 'Status' }] };
    await assert.rejects(adapter.complete(options));
    console.log(JSON.stringify({ scope: 'native actual accepted POST/503, synthetic only; not shared persistent budget', actualDispatches: dispatches, ledger: adapter.ledger.snapshot().map(({ state, attempts }) => ({ state, attempts })) }));
    assert.equal(dispatches, 1, '503 after accepted POST is not proof of zero usage or safe redispatch');
    assert.equal(adapter.ledger.snapshot()[0].attempts, 1);
    await assert.rejects(adapter.complete(options), { code: 'H05_UNKNOWN_MODEL_USAGE_RECONCILIATION_REQUIRED' });
    assert.equal(dispatches, 1);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('H05 native retry configuration cannot be reenabled after explicit owner construction', async () => {
  const adapter = new H05NativeModelTransportV1({ optIn: true, baseUrl: 'http://127.0.0.1:12345/v1', model: 'owned-synthetic-only' });
  assert.throws(() => { adapter.maxRetries = 1; }, TypeError);
  assert.throws(() => Object.defineProperty(adapter, 'maxRetries', { value: 1 }), TypeError);
  assert.equal(adapter.maxRetries, 0);
});

test('H05 actual accepted POST timeout stays unresolved without redispatch in the first process', async () => {
  let dispatches = 0;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { /* actual full POST */ }
    dispatches += 1;
    // Keep the first ACK absent until the native timeout. A second dispatch
    // would receive a complete synthetic response and be precisely detectable.
    if (dispatches > 1) {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'STATUS' } }], usage: { total_tokens: 1 } }));
    }
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const adapter = new H05NativeModelTransportV1({ optIn: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'owned-synthetic-only', timeoutMs: 150 });
    const options = { idempotencyKey: 'ks295-unknown-timeout', messages: [{ role: 'user', content: 'Status' }], maxRetries: 1 };
    await assert.rejects(adapter.complete(options), { code: 'MODEL_TIMEOUT' });
    assert.equal(dispatches, 1, 'caller per-request retry options must not enable inherited timeout retries');
    assert.deepEqual(adapter.ledger.snapshot().map(({ state, attempts }) => ({ state, attempts })), [{ state: 'failed', attempts: 1 }]);
    await assert.rejects(adapter.complete(options), { code: 'H05_UNKNOWN_MODEL_USAGE_RECONCILIATION_REQUIRED' });
    assert.equal(dispatches, 1);
    console.log(JSON.stringify({ scope: 'actual first-process ACK-loss timeout native transport, synthetic only', actualProviderDispatches: dispatches, nativeAttempts: 1, perRequestMaxRetriesCannotReenable: true }));
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
