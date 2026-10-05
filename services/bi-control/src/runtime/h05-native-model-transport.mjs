import { createHash } from 'node:crypto';
import { LocalOpenAIAdapter } from '../bi-specialist/local-openai-adapter.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// KS native transport seam only: the historical adapter and blind commitments
// remain byte-identical. The single shared PAN policy/budget/broker semantics,
// durable unknownUsage accounting and activation authority are not implemented
// or inferred here. This explicitly selected successor reuses the real adapter.
export class H05NativeModelTransportV1 extends LocalOpenAIAdapter {
  #inFlight = new Map();

  constructor({ optIn, ...options }) {
    if (optIn !== true) throw new Error('H05_NATIVE_MODEL_OPT_IN_REQUIRED');
    if (options.maxRetries !== undefined && options.maxRetries !== 0) throw new Error('H05_NATIVE_BLIND_RETRY_DENIED');
    // A transient HTTP response/timeout after accepting the POST is not zero-
    // usage evidence. Shared reconciliation, never an inherited automatic
    // transport retry, decides what may happen to the held budget.
    super({ ...options, maxRetries: 0 });
    Object.defineProperty(this, 'maxRetries', { value: 0, enumerable: true, writable: false, configurable: false });
  }

  async complete(options) {
    const body = JSON.parse(JSON.stringify(this.buildRequest({ ...options, stream: false })));
    const key = options.idempotencyKey ?? `auto:${digest(body)}`;
    const requestDigest = digest(body);
    // Native ledger owns digest conflict/replay checks. Never merge different
    // requests simply because a caller reused the same idempotency key.
    const prior = this.ledger.snapshot().find(entry => entry.key === key);
    const known = this.ledger.begin(key, requestDigest);
    if (known.state === 'complete') return structuredClone(known.response);
    const active = this.#inFlight.get(key);
    if (active) return structuredClone(await active);
    // Accepted-POST/ACK loss, prior failure or interrupted native progress is
    // not evidence of zero usage. A restored unresolved entry cannot dispatch
    // again. Only the separate shared durable broker can reconcile its budget;
    // neither a restart nor a model answer clears this native evidence.
    if (prior) {
      const error = new Error('H05_UNKNOWN_MODEL_USAGE_RECONCILIATION_REQUIRED');
      error.code = error.message;
      throw error;
    }
    // Capture the dispatched JSON before yielding: later caller mutation of
    // messages/tool catalogs cannot change a request under its bound digest.
    const held = { ...options, messages: body.messages, temperature: body.temperature,
      topP: body.top_p, seed: body.seed, maxTokens: body.max_tokens,
      responseFormat: body.response_format, tools: body.tools,
      toolChoice: body.tool_choice, idempotencyKey: key };
    const promise = Promise.resolve().then(() => super.complete(held));
    this.#inFlight.set(key, promise);
    try {
      return structuredClone(await promise);
    } finally {
      if (this.#inFlight.get(key) === promise) this.#inFlight.delete(key);
    }
  }
}
