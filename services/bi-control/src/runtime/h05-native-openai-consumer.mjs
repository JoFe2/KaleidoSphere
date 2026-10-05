import { types } from 'node:util';
import { H05NativeModelTransportV1 } from './h05-native-model-transport.mjs';
import { readLocalObservedWireJson } from '../../../../scripts/lib/h01-local-wire-data.mjs';

// KS native format/transport adapter only. This owner-only factory is not an
// endpoint, policy store, budget allocator, approval or settlement capability.
// Invoke only from the bound shared PAN broker after its actual request guard.
export function createH05NativeOpenAIConsumerV1({ optIn, baseUrl, model }) {
  const observedUsage = new Map();
  const observedMime = new Map();
  const native = new H05NativeModelTransportV1({ optIn, baseUrl, model,
    fetchImpl: async (url, init) => {
      const response = await fetch(url, init);
      observedMime.set(init.headers['x-idempotency-key'], response.headers.get('content-type') ?? '');
      if (response.ok) {
        // Preserve only integer accounting facts from the actual HTTP response.
        // The historical privacy-safe trace intentionally removes token keys;
        // do not alter it or infer usage from model text/roles/approvals.
        // Bound the actual cloned HTTP frame before JSON parsing. Keep the
        // original response/body untouched for the existing native adapter.
        const copy = response.clone();
        const reader = copy.body.getReader();
        const chunks = [];
        let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 65_536) {
            await Promise.all([reader.cancel(), response.body.cancel()]);
            const error = new Error('H05_NATIVE_RESPONSE_FRAME_DENIED');
            error.code = error.message;
            throw error;
          }
          chunks.push(Buffer.from(chunk.value));
        }
        const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
        const usage = payload.usage;
        if (usage && [usage.prompt_tokens, usage.completion_tokens, usage.costMicros]
          .every(value => Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0))) {
          observedUsage.set(init.headers['x-idempotency-key'], {
            inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, costMicros: usage.costMicros });
        }
      }
      return response;
    } });
  return Object.freeze({
    async invoke(candidate) {
      // This is a closed native wire format, not another route/rights policy.
      // The model cannot supply commands, endpoints or protected owner options.
      let data, signal;
      try {
        if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || types.isProxy(candidate)) throw new Error();
        const fields = Object.getOwnPropertyDescriptors(candidate);
        const keys = Reflect.ownKeys(fields);
        if (keys.some(key => !['operationId', 'request', 'signal'].includes(key))
          || !fields.operationId || !fields.request
          || keys.some(key => !Object.hasOwn(fields[key], 'value') || !fields[key].enumerable)) throw new Error();
        signal = fields.signal?.value;
        if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error();
        data = readLocalObservedWireJson({ operationId: fields.operationId.value, request: fields.request.value });
        const request = data.request;
        if (!/^operation:[a-z0-9][a-z0-9._-]{2,63}$/.test(data.operationId)
          || !request || Array.isArray(request)
          || Object.keys(request).some(key => !['model', 'messages', 'max_tokens', 'tools', 'attachments',
            'response_format', 'temperature', 'top_p', 'seed'].includes(key))
          || request.model !== model || !Array.isArray(request.messages)
          || !Number.isSafeInteger(request.max_tokens)
          || (request.attachments !== undefined && (!Array.isArray(request.attachments) || request.attachments.length !== 0))) throw new Error();
      } catch { throw new Error('H05_NATIVE_FORMAT_DENIED'); }
      const result = await native.complete({ idempotencyKey: data.operationId,
        messages: data.request.messages, maxTokens: data.request.max_tokens,
        temperature: data.request.temperature, topP: data.request.top_p, seed: data.request.seed,
        responseFormat: data.request.response_format, tools: data.request.tools,
        signal });
      const usage = observedUsage.get(data.operationId);
      if (!usage) throw new Error('H05_NATIVE_USAGE_UNPROVEN');
      return { contentType: observedMime.get(data.operationId) ?? '', text: result.content, toolCalls: structuredClone(result.toolCalls),
        structuredOutput: null, usage: structuredClone(usage) };
    },
  });
}
