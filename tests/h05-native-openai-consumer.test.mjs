import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';

// The native binding below is KS transport/format adaptation only. The shared
// PAN broker alone owns policy/response guards and durable accounting decisions.
test('KS H05 native OpenAI consumer passes actual numeric provider usage to the shared broker without legacy trace-redaction loss', async () => {
  const module = await import('../services/bi-control/src/runtime/h05-native-openai-consumer.mjs').catch(() => ({}));
  assert.equal(typeof module.createH05NativeOpenAIConsumerV1, 'function', 'actual KS native consumer seam required');
  let dispatches = 0;
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    requests.push({ path: request.url, key: request.headers['x-idempotency-key'], body: JSON.parse(raw) });
    dispatches += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'STATUS', tool_calls: [] } }], usage: { prompt_tokens: 3, completion_tokens: 2, costMicros: 0 } }));
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const native = module.createH05NativeOpenAIConsumerV1({ optIn: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'model:synthetic-v1' });
    const request = { model: 'model:synthetic-v1', messages: [{ role: 'user', content: 'Status' }],
      max_tokens: 512, temperature: 0, tools: [], attachments: [] };
    const calls = Array.from({ length: 100 }, () => native.invoke({ operationId: 'operation:ks295-usage001', request }));
    const results = await Promise.all(calls);
    assert.equal(dispatches, 1);
    assert.deepEqual(results[0], { contentType: 'application/json', text: 'STATUS', toolCalls: [], structuredOutput: null,
      usage: { inputTokens: 3, outputTokens: 2, costMicros: 0 } });
    assert.deepEqual(results[99], results[0]);
    assert.equal(requests[0].key, 'operation:ks295-usage001');
    assert.equal(requests[0].path, '/v1/chat/completions');
    assert.equal(requests[0].body.model, 'model:synthetic-v1');
    assert.equal(requests[0].body.stream, false);
    assert.equal(requests[0].body.messages[0].content, 'Status');
    results[0].usage.inputTokens = 99;
    assert.equal(results[1].usage.inputTokens, 3, 'operation callers must not share mutable returned usage');
    console.log(JSON.stringify({ scope: 'KS native actual HTTP/usage format seam; not shared policy or budget acceptance', simultaneousAttempts: 100,
      actualProviderDispatches: dispatches, actualUsage: results[1].usage, callerCopiesIsolated: true }));
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});

test('KS H05 native format seam rejects extra effect-bearing fields and wrong model before actual HTTP dispatch', async () => {
  const { createH05NativeOpenAIConsumerV1 } = await import('../services/bi-control/src/runtime/h05-native-openai-consumer.mjs');
  let dispatches = 0;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { /* actual request if incorrectly dispatched */ }
    dispatches += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'STATUS', tool_calls: [] } }], usage: { prompt_tokens: 1, completion_tokens: 1, costMicros: 0 } }));
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const native = createH05NativeOpenAIConsumerV1({ optIn: true, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'model:synthetic-v1' });
    const request = { model: 'model:synthetic-v1', messages: [{ role: 'user', content: 'Status' }], max_tokens: 512, tools: [], attachments: [] };
    const variants = [
      { command: 'id' }, { url: 'https://invalid.example/not-dispatched' }, { sql: 'SELECT 1' },
      { protectedPolicy: { rights: ['owner'] } }, { maxRetries: 1 },
    ].map((extra, index) => ({ operationId: `operation:ks295-extra00${index}`, request, ...extra }));
    variants.push({ operationId: 'operation:ks295-reqextra', request: { ...request, command: 'id' } });
    variants.push({ operationId: 'operation:ks295-wrongmodel', request: { ...request, model: 'model:other-native' } });
    variants.push({ operationId: 'operation:ks295-attachment', request: { ...request, attachments: [{ reference: 'attachment:unbound-file' }] } });
    for (const candidate of variants) {
      await assert.rejects(native.invoke(candidate), { message: 'H05_NATIVE_FORMAT_DENIED' });
      assert.equal(dispatches, 0, 'format denials must not reach the owned HTTP provider');
    }
    console.log(JSON.stringify({ scope: 'KS native format denial only, shared policy semantics not duplicated', effectFreeCases: variants.length, actualProviderDispatches: dispatches }));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('KS H05 native MIME evidence preserves actual provider MIME instead of relabeling HTML as JSON', async () => {
  const { createH05NativeOpenAIConsumerV1 } = await import('../services/bi-control/src/runtime/h05-native-openai-consumer.mjs');
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { /* full real native POST */ }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'STATUS' } }], usage: { prompt_tokens: 1, completion_tokens: 1, costMicros: 0 } }));
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const native = createH05NativeOpenAIConsumerV1({ optIn: true, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'model:synthetic-v1' });
    const result = await native.invoke({ operationId: 'operation:ks295-html-wire', request: {
      model: 'model:synthetic-v1', messages: [{ role: 'user', content: 'Status' }], max_tokens: 512, tools: [], attachments: [] } });
    assert.equal(result.contentType, 'text/html', 'the shared broker must receive actual MIME for its own quarantine guard');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('KS H05 native response frame is bounded before parsing metadata or passing usage to the shared broker', async () => {
  const { createH05NativeOpenAIConsumerV1 } = await import('../services/bi-control/src/runtime/h05-native-openai-consumer.mjs');
  let dispatches = 0;
  const server = http.createServer(async (request, response) => {
    for await (const chunk of request) { /* real full POST */ }
    dispatches += 1;
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ choices: [{ message: { content: 'STATUS' } }], usage: { prompt_tokens: 1, completion_tokens: 1, costMicros: 0 }, ignoredProviderMetadata: 'x'.repeat(128 * 1024) }));
  });
  try {
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const native = createH05NativeOpenAIConsumerV1({ optIn: true, baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: 'model:synthetic-v1' });
    const call = { operationId: 'operation:ks295-frame-oversize', request: {
      model: 'model:synthetic-v1', messages: [{ role: 'user', content: 'Status' }], max_tokens: 512, tools: [], attachments: [] } };
    await assert.rejects(native.invoke(call), { message: 'H05_NATIVE_RESPONSE_FRAME_DENIED' });
    assert.equal(dispatches, 1);
    await assert.rejects(native.invoke(call), { message: 'H05_UNKNOWN_MODEL_USAGE_RECONCILIATION_REQUIRED' });
    assert.equal(dispatches, 1, 'unproven oversized response must not yield an automatic replay or usage release');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
