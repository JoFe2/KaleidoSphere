import { createHash } from 'node:crypto';
import { readLocalObservedWireJson } from '../../../../scripts/lib/h01-local-wire-data.mjs';
import { getH05SharedRuntimeApisV1 } from './h05-shared-runtime-source.mjs';
import { createH05NativeResourceStoreV1 } from './h05-native-resource-store.mjs';
import { createH05NativeOpenAIConsumerV1 } from './h05-native-openai-consumer.mjs';
import { readH05ServerRuntimeTemplateV1 } from './h05-closed-runtime-template.mjs';

// Same pure common guard/adaptation preflight for deferred native startup and
// actual invocation. It allocates no ledger, reservation or provider request.
export function preflightH05NativeModelRequestV1(source, value, localTemplateContext = undefined) {
  try {
    const shared = getH05SharedRuntimeApisV1(source);
    const guarded = shared.broker.guardModelRequestV1(readLocalObservedWireJson(value), shared.broker.syntheticModelAccessPolicyV1());
    if (guarded.outcome !== 'ALLOW') return guarded;
    if (localTemplateContext !== undefined) {
      const resourceClass = readH05ServerRuntimeTemplateV1(localTemplateContext).resourceClass;
      if (['maxInputBytes', 'maxOutputBytes', 'maxTokens', 'maxRequests', 'timeoutMs']
        .some(key => guarded.request.budget[key] > resourceClass[key]))
        return { outcome: 'DENY', issues: ['H05_TEMPLATE_RESOURCE_CLASS_DENIED'], runtimeActivationGranted: false };
    }
    shared.canonical.canonicalJson(shared.broker.adaptCanonicalRequestV1(guarded.request, guarded.route));
    return guarded;
  } catch { return { outcome: 'DENY', issues: ['H05_SHARED_ADAPTATION_PREFLIGHT_DENIED'], runtimeActivationGranted: false }; }
}

// Optional SYNTHETIC_ONLY native composition. The unchanged common broker
// decides model policy. This local owner factory supplies native persistence
// and guarded completion; it grants no BI effect, runtime activation or rights.
export function createH05NativeBrokerRuntimeV1(source, value, localTemplateContext = undefined) {
  const shared = getH05SharedRuntimeApisV1(source);
  // A transport copy of a template/identity cannot acquire this owner handle.
  // Binding metadata does not create a qualification or activation grant.
  const template = localTemplateContext === undefined ? null : readH05ServerRuntimeTemplateV1(localTemplateContext);
  const resourceClass = template?.resourceClass;
  const modelReservationUnits = resourceClass?.modelReservationUnits ?? 64;
  const runtimeReservationUnits = resourceClass?.runtimeReservationUnits ?? 1;
  const { canonicalJson } = shared.canonical;
  const hash = value => createHash('sha256').update(canonicalJson(value)).digest('hex');
  const options = shared.envelope.readCcpClosedObjectV1(readLocalObservedWireJson(value),
    ['optIn', 'stateRoot', 'baseUrl', 'limits'], new WeakSet(), 'H05_NATIVE_RUNTIME_OPTIONS_DENIED');
  if (options.optIn !== true) throw new Error('H05_NATIVE_RUNTIME_OPT_IN_REQUIRED');
  if (resourceClass && (!options.limits || options.limits.modelUnits > resourceClass.maxRequests * modelReservationUnits
    || options.limits.runtimeUnits > resourceClass.maxRequests * runtimeReservationUnits))
    throw new Error('H05_TEMPLATE_RESOURCE_CLASS_DENIED');
  const policy = shared.broker.syntheticModelAccessPolicyV1();
  const native = createH05NativeOpenAIConsumerV1({ optIn: true, baseUrl: options.baseUrl, model: policy.routes[0].model });
  const store = createH05NativeResourceStoreV1(source, { optIn: true, stateRoot: options.stateRoot,
    tenantId: policy.routes[0].allowedTenants[0], limits: options.limits,
    bindingDigest: hash({ descriptorSha256: source.descriptorSha256, policy, nativeSyntheticBaseUrl: options.baseUrl,
      ...(template === null ? {} : { serverRuntimeTemplate: template }),
      syntheticProviderOnly: true, runtimeActivationGranted: false }) });
  const broker = new shared.broker.ModelAccessBrokerV1(policy), inFlight = new Map();
  const issue = (outcome, codes) => ({ outcome, issues: codes, runtimeActivationGranted: false });
  const first = async (request, requestDigest) => {
    try {
      store.reserve({ operationId: request.operationId, requestDigest, modelUnits: modelReservationUnits, runtimeUnits: runtimeReservationUnits });
      const dispatched = store.markUnknownUsage(request.operationId);
      if (!dispatched.dispatchGranted) {
        if (dispatched.reservation.state === 'SETTLED') return { outcome: 'ALLOW', state: 'SETTLED_REPLAY',
          operationId: request.operationId, requestDigest, modelConsumed: dispatched.reservation.model_consumed,
          runtimeConsumed: dispatched.reservation.runtime_consumed, replay: 'SAME_NATIVE_RECEIPT', runtimeActivationGranted: false };
        return { ...issue('QUARANTINE', ['H05_NATIVE_USAGE_RECONCILIATION_REQUIRED']), state: 'UNKNOWN_USAGE_HELD' };
      }
      const result = await broker.invoke(request, (candidate, signal) => native.invoke({ operationId: request.operationId,
        request: JSON.parse(JSON.stringify(candidate.request)), signal }));
      if (result.outcome !== 'ALLOW') return { ...result, state: 'UNKNOWN_USAGE_HELD', runtimeActivationGranted: false };
      const modelUnits = result.response.usage.inputTokens + result.response.usage.outputTokens;
      if (!Number.isSafeInteger(modelUnits) || modelUnits < 0 || modelUnits > modelReservationUnits || result.response.usage.costMicros !== 0)
        return { ...issue('QUARANTINE', ['H05_NATIVE_USAGE_RECONCILIATION_REQUIRED']), state: 'UNKNOWN_USAGE_HELD' };
      const evidence = store.ownerCompletionEvidence({ operationId: request.operationId, requestDigest,
        modelUnits, runtimeUnits: runtimeReservationUnits, evidenceDigest: result.audit.responseDigest });
      store.settle(evidence);
      return { ...structuredClone(result), state: 'SETTLED', runtimeActivationGranted: false };
    } catch (error) {
      const prior = store.read(request.operationId);
      return { ...issue(error.message === 'H05_RESOURCE_RETRY_CONFLICT_DENIED' ? 'DENY'
        : prior?.state === 'UNKNOWN_USAGE' ? 'QUARANTINE' : 'DENY',
        [/^H05_RESOURCE_[A-Z_]+$/.test(error.message) ? error.message : 'H05_NATIVE_RUNTIME_FAILED_CLOSED']),
        state: prior?.state === 'UNKNOWN_USAGE' ? 'UNKNOWN_USAGE_HELD' : 'NOT_DISPATCHED' };
    }
  };
  let isClosed = false;
  return Object.freeze({
    invoke(value) {
      if (isClosed) return Promise.resolve(issue('DENY', ['H05_NATIVE_RUNTIME_CLOSED']));
      let guarded, requestDigest;
      try {
        guarded = preflightH05NativeModelRequestV1(source, value, localTemplateContext);
        if (guarded.outcome !== 'ALLOW') return Promise.resolve(issue(guarded.outcome, guarded.issues));
        requestDigest = hash(guarded.request);
        // Preserve the public null-structured-output producer RED. A broken
        // adaptation fails before native reservation/dispatch; no producer fix
        // or unsupported wire option is fabricated in this consumer.
        hash(shared.broker.adaptCanonicalRequestV1(guarded.request, guarded.route));
      } catch { return Promise.resolve(issue('DENY', ['H05_SHARED_ADAPTATION_PREFLIGHT_DENIED'])); }
      const request = guarded.request, pending = inFlight.get(request.operationId);
      if (pending) return pending.requestDigest === requestDigest ? pending.result
        : Promise.resolve(issue('DENY', ['MODEL_REPLAY_CONFLICT_DENIED']));
      const result = Promise.resolve().then(() => first(request, requestDigest))
        .finally(() => inFlight.delete(request.operationId));
      inFlight.set(request.operationId, { requestDigest, result }); return result;
    },
    snapshot: () => store.snapshot(),
    close: () => {
      if (inFlight.size !== 0) throw new Error('H05_NATIVE_RUNTIME_INFLIGHT_CLOSE_DENIED');
      if (!isClosed) { store.close(); isClosed = true; }
    },
  });
}
