import { createHash } from 'node:crypto';

import { canonicalJson } from '../canonical-json.js';
import { createAgentProcessEvidenceBackingV1 } from './agent-process-inbox-v1.mjs';

export const EVENT_ENVELOPE_VERSION = 'chimpmaera.bi/event-envelope/v1';
export const VERSION_IDENTITY_VERSION = 'chimpmaera.bi/version-identity/v1';
export const EVENT_CHANNELS = Object.freeze(['durable', 'live']);
export const DATA_CLASSES = Object.freeze(['public', 'internal', 'confidential', 'restricted']);
export const AGENT_PROCESS_EVENT_TYPE = 'pan.workspace.action.observed';
export const AGENT_PROCESS_PAYLOAD_VERSION = 'kaleidosphere.agent-process/action-observation/v1';
export const KNOWN_EVENT_TYPES = new Set([
  'transcript.partial', 'transcript.final', 'assistant.delta', 'assistant.final',
  'ui_action.proposed', 'ui_action.applied', 'ui_action.denied',
  'interaction.interrupted', 'interaction.cancelled', 'tool.execution.receipt',
  'pan.workspace.action.observed',
]);

const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const SENSITIVE_KEY = /(password|passwd|secret|access.?token|refresh.?token|authorization|cookie|ssn|social.?security|email|phone|raw.?row|source.?row|chain.?of.?thought|reasoning)/i;
const SENSITIVE_VALUE = /(-----BEGIN [A-Z ]+PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+\/-]+=*|\bsk-[A-Za-z0-9_-]{12,})/i;
const fail = (code) => { const error = new Error(code); error.code = code; throw error; };

function closed(value, keys, code) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key))
    || Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || !descriptors[key].enumerable || !('value' in descriptors[key]))) fail(code);
}

// Shape/consistency only, NOT source authentication, read authority or a
// business-success attestation. The trusted producer connection is still absent.
export function assertAgentProcessPayloadV1(payload) {
  const code = 'PROCESS_PAYLOAD_DENIED';
  closed(payload, ['schemaVersion', 'scope', 'source', 'action', 'mode', 'phase', 'result', 'readbackRef', 'processFacts', 'humanFacts', 'grantFacts'], code);
  closed(payload.scope, ['tenantId', 'principalDigest', 'privacyEpoch'], code);
  closed(payload.source, ['sourceId', 'sourceEpoch', 'eventDigest', 'sourceTimeMs'], code);
  closed(payload.action, ['taskId', 'stepId', 'attempt', 'capability', 'taskRevision'], code);
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const id = value => typeof value === 'string' && ID.test(value);
  const positive = value => Number.isSafeInteger(value) && value >= 1;
  const { scope, source, action } = payload;
  if (payload.schemaVersion !== AGENT_PROCESS_PAYLOAD_VERSION || !id(scope.tenantId) || !hex(scope.principalDigest)
    || !positive(scope.privacyEpoch) || source.sourceId !== 'pan548.signed-native-context-outbox/v1'
    || !hex(source.sourceEpoch) || !hex(source.eventDigest)
    || !(source.sourceTimeMs === null || Number.isSafeInteger(source.sourceTimeMs) && source.sourceTimeMs >= 0)
    || !id(action.taskId) || !id(action.stepId) || !Number.isSafeInteger(action.attempt) || action.attempt < 0 || action.attempt > 1
    || !(action.taskRevision === null || positive(action.taskRevision))) fail(code);
  const capability = { PREVIEW: 'pan.workspace.view.preview/v1', DISPLAY: 'pan.workspace.document.display/v2' };
  if (typeof payload.mode !== 'string' || !Object.hasOwn(capability, payload.mode) || action.capability !== capability[payload.mode]
    || !['PROPOSED', 'ADMITTED', 'PENDING', 'RESULT_CONFIRMED', 'UNKNOWN'].includes(payload.phase)
    || [payload.processFacts, payload.humanFacts, payload.grantFacts].some(value => value !== 'NOT_OBSERVED')
    || !(payload.readbackRef === null || id(payload.readbackRef))) fail(code);
  if (payload.result !== null) {
    closed(payload.result, ['resultPhase', 'proofRef', 'proofKind'], code);
    const { resultPhase, proofRef, proofKind } = payload.result;
    if (typeof proofRef !== 'string' || !/^context-proof:[a-f0-9]{64}$/.test(proofRef)
      || (payload.mode === 'PREVIEW'
        ? resultPhase !== 'PREVIEW_VALIDATED' || proofKind !== 'PAN546_PREVIEW_VALIDATED'
        : resultPhase !== 'DOCUMENT_ACCEPTED' || !['PAN597_DOCUMENT_ACCEPTED', 'PAN597_DOCUMENT_RENDERED'].includes(proofKind))) fail(code);
  }
  if ((payload.phase === 'RESULT_CONFIRMED') !== (payload.result !== null)
    || payload.phase === 'RESULT_CONFIRMED' && (payload.readbackRef === null || action.attempt !== 1 || action.taskRevision === null)) fail(code);
  return payload;
}

export function sha256Digest(value) {
  return `sha256:${createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex')}`;
}

export function assertSafeJson(value, path = '$') {
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value === 'string') {
    if (SENSITIVE_VALUE.test(value)) fail('SENSITIVE_VALUE_DENIED');
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeJson(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('NON_JSON_PAYLOAD_DENIED');
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail('SENSITIVE_FIELD_DENIED');
    if (item === undefined) fail('UNDEFINED_PAYLOAD_DENIED');
    assertSafeJson(item, `${path}.${key}`);
  }
}

export function assertVersionIdentity(identity) {
  closed(identity, ['schemaVersion', 'contract', 'version', 'producer'], 'EVENT_CLOSED_SHAPE_DENIED');
  if (!identity || identity.schemaVersion !== VERSION_IDENTITY_VERSION) fail('VERSION_IDENTITY_VERSION_UNSUPPORTED');
  if (!ID.test(identity.contract ?? '') || !/^v[1-9][0-9]*$/.test(identity.version ?? '')) fail('VERSION_IDENTITY_INVALID');
  closed(identity.producer, ['id', 'version', 'artifactDigest'], 'EVENT_CLOSED_SHAPE_DENIED');
  if (!ID.test(identity.producer.id ?? '') || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(identity.producer.version ?? '')) fail('PRODUCER_IDENTITY_INVALID');
  if (!DIGEST.test(identity.producer.artifactDigest ?? '')) fail('PRODUCER_DIGEST_INVALID');
  return identity;
}

export function assertEventEnvelope(envelope) {
  closed(envelope, ['schemaVersion', 'eventId', 'streamId', 'eventType', 'channel', 'seq', 'occurredAt', 'correlationId', 'causationId', 'version', 'sensitivity', 'payload', 'payloadDigest', 'ignorable'], 'EVENT_CLOSED_SHAPE_DENIED');
  if (!envelope || envelope.schemaVersion !== EVENT_ENVELOPE_VERSION) fail('EVENT_ENVELOPE_VERSION_UNSUPPORTED');
  if (!ID.test(envelope.eventId ?? '') || !ID.test(envelope.streamId ?? '') || !ID.test(envelope.correlationId ?? '')) fail('EVENT_IDENTITY_INVALID');
  if (!ID.test(envelope.eventType ?? '')) fail('EVENT_TYPE_INVALID');
  if (envelope.causationId !== null && envelope.causationId !== undefined && !ID.test(envelope.causationId)) fail('EVENT_CAUSATION_INVALID');
  if (!EVENT_CHANNELS.includes(envelope.channel) || !Number.isSafeInteger(envelope.seq) || envelope.seq < 1) fail('EVENT_SEQUENCE_INVALID');
  if (Number.isNaN(Date.parse(envelope.occurredAt ?? ''))) fail('EVENT_TIME_INVALID');
  assertVersionIdentity(envelope.version);
  closed(envelope.sensitivity, ['dataClass', 'categories', 'redaction'], 'EVENT_CLOSED_SHAPE_DENIED');
  if (!DATA_CLASSES.includes(envelope.sensitivity.dataClass)) fail('EVENT_DATA_CLASS_INVALID');
  const categories = envelope.sensitivity.categories;
  if (!Array.isArray(categories) || categories.length === 0 || categories.some((item) => !['none', 'pii'].includes(item))) fail('EVENT_SENSITIVE_CATEGORY_DENIED');
  if (categories.includes('pii') && envelope.sensitivity.redaction !== 'redacted') fail('EVENT_PII_REDACTION_REQUIRED');
  if (!['none', 'redacted'].includes(envelope.sensitivity.redaction)) fail('EVENT_REDACTION_INVALID');
  if (typeof envelope.ignorable !== 'boolean') fail('EVENT_IGNORABLE_REQUIRED');
  if (!KNOWN_EVENT_TYPES.has(envelope.eventType) && envelope.ignorable !== true) fail('UNKNOWN_REQUIRED_EVENT');
  if (envelope.eventType === AGENT_PROCESS_EVENT_TYPE) {
    if (envelope.version.contract !== 'workspace-action-observation' || envelope.version.version !== 'v1'
      || envelope.channel !== 'durable' || envelope.ignorable !== false) fail('PROCESS_ENVELOPE_DENIED');
    assertAgentProcessPayloadV1(envelope.payload);
  }
  assertSafeJson(envelope.payload);
  if (!DIGEST.test(envelope.payloadDigest ?? '') || envelope.payloadDigest !== sha256Digest(envelope.payload)) fail('EVENT_PAYLOAD_DIGEST_MISMATCH');
  return envelope;
}

export class InMemoryEvidenceStore {
  #events = [];
  #lastSequence = new Map();
  #eventById = new Map();
  #agentProcess = null;

  // Historical zero-option callers remain in-memory. Only the trusted host
  // may opt this existing evidence owner into the bounded KS322 backing.
  constructor(options = null) {
    if (options !== null) {
      closed(options, ['agentProcess'], 'PROCESS_CONFIG_DENIED');
      this.#agentProcess = createAgentProcessEvidenceBackingV1(options.agentProcess, assertEventEnvelope, AGENT_PROCESS_EVENT_TYPE);
    }
  }

  append(envelope) {
    assertEventEnvelope(envelope);
    if (this.#agentProcess) {
      const imported = this.importBytes(Buffer.from(canonicalJson(envelope)));
      if (!imported.persisted) fail('PROCESS_SEQUENCE_GAP');
      return imported.event;
    }
    if (this.#eventById.has(envelope.eventId)) fail('EVENT_ID_REPLAY');
    const sequenceKey = `${envelope.streamId}:${envelope.channel}`;
    const expected = (this.#lastSequence.get(sequenceKey) ?? 0) + 1;
    if (envelope.seq !== expected) fail('EVENT_SEQUENCE_NON_MONOTONIC');
    if (envelope.causationId) {
      const cause = this.#eventById.get(envelope.causationId);
      if (!cause) fail('EVENT_CAUSATION_UNKNOWN');
      if (cause.correlationId !== envelope.correlationId) fail('EVENT_CORRELATION_MISMATCH');
    }
    const frozen = structuredClone(envelope);
    Object.freeze(frozen);
    this.#events.push(frozen);
    this.#eventById.set(frozen.eventId, frozen);
    this.#lastSequence.set(sequenceKey, frozen.seq);
    return frozen;
  }

  importBytes(bytes) {
    if (!this.#agentProcess) fail('PROCESS_PERSISTENT_OWNER_REQUIRED');
    return this.#agentProcess.importBytes(bytes);
  }

  durableEvents() { return this.#agentProcess ? this.#agentProcess.durableEvents() : this.#events.filter((event) => event.channel === 'durable').map(structuredClone); }
  liveEvents() { if (this.#agentProcess) { this.#agentProcess.durableEvents(); return []; } return this.#events.filter((event) => event.channel === 'live').map(structuredClone); }
  close() { this.#agentProcess?.close(); }
}
