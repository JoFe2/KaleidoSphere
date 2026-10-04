import { readBoundedObservedJson } from './h01-observed-json.mjs';
import { checkLocalDemoBusinessReadback } from './h01-local-demo-probe.mjs';

// KS254 projection generation observation only, not another portable contract.
// heldGenerationId must come from the operator's verified generation bytes, not
// from the reply, a blueprint or model-provided metadata. This comparison never
// creates an authorization, RuntimeIdentity, ReadinessReceipt or hosted route.
export function checkLocalDemoBoundReadback(input, heldGenerationId) {
  let reply;
  const denied = code => ({status: 'NOT_READY', code, hostedRouteOpen: false,
    scope: 'LOCAL_SYNTHETIC_METADATA_DEMO_ONLY_NO_LIVE_DATABASE_OR_PROVIDER_CLAIM'});
  if (typeof heldGenerationId !== 'string' || !/^[0-9a-f]{64}$/.test(heldGenerationId)) {
    return denied('LOCAL_DEMO_HELD_GENERATION_PIN_DENIED');
  }
  try { reply = readBoundedObservedJson(input); }
  catch { return denied('LOCAL_DEMO_INPUT_DENIED'); }
  if (reply?.body?.generationId !== heldGenerationId) {
    return denied('LOCAL_DEMO_ACTUAL_GENERATION_MISMATCH');
  }
  return checkLocalDemoBusinessReadback(reply);
}
