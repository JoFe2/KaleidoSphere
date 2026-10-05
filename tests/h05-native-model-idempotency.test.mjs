import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { H05NativeModelTransportV1 } from '../services/bi-control/src/runtime/h05-native-model-transport.mjs';

test('H05 existing native model adapter coalesces 100 simultaneous equal-idempotency operations to one real synthetic provider dispatch', async () => {
  let dispatches = 0;
  const observedRequests = [];
  const server = http.createServer(async (request, response) => {
    let bytes = '';
    for await (const chunk of request) bytes += chunk;
    observedRequests.push({ method: request.method, path: request.url, idempotencyKey: request.headers['x-idempotency-key'], body: JSON.parse(bytes) });
    dispatches += 1;
    // Responses may be synthetic; the actual native adapter, HTTP dispatch,
    // concurrent operation calls and reconciliation ledger are not mocked.
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'STATUS', tool_calls: [] } }], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 } }));
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const adapter = new H05NativeModelTransportV1({ optIn: true, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'owned-synthetic-model', maxRetries: 0 });
    const options = { messages: [{ role: 'user', content: 'Status' }], idempotencyKey: 'ks295-native-equal-operation' };
    const operations = Array.from({ length: 100 }, () => adapter.complete(options));
    const answers = await Promise.all(operations);
    console.log(JSON.stringify({ scope: 'actual native LocalOpenAIAdapter HTTP/synthetic replies, not budget persistence or complete H05', simultaneousAttempts: operations.length, actualProviderDispatches: dispatches, nativeLedger: adapter.ledger.snapshot().map(({ key, state, attempts }) => ({ key, state, attempts })) }));
    assert.equal(answers.length, 100);
    assert.equal(dispatches, 1, 'one equal operation must dispatch only once, including concurrent retries');
    assert.equal(observedRequests.length, 1);
    assert.equal(observedRequests[0].method, 'POST');
    assert.equal(observedRequests[0].path, '/v1/chat/completions');
    assert.equal(observedRequests[0].idempotencyKey, options.idempotencyKey);
    assert.ok(answers.every(answer => answer.content === 'STATUS'));
    const rows = adapter.ledger.snapshot();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'complete');
    assert.equal(rows[0].attempts, 1);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
