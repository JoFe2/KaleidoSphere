import { readBoundedObservedJson } from './h01-observed-json.mjs';
import { checkLocalDemoImageObservations } from './h01-local-image-observations.mjs';
import { checkLocalDemoBoundReadback } from './h01-local-bound-readback.mjs';

// The trusted local stack collector calls this conjunction, not the intentionally
// partial image helper alone. No portable schema, identity or execution grant.
export function checkLocalDemoStackFacts(input, heldGenerationId, operatorHeldPins) {
  const result = (status, code) => ({ status, code, hostedRouteOpen: false,
    scope: 'LOCAL_COMPLETE_SERVICE_IMAGE_AND_BUSINESS_FACTS_NOT_PORTABLE_READINESS' });
  let bundle;
  try { bundle = readBoundedObservedJson(input); }
  catch { return result('NOT_READY', 'LOCAL_DEMO_STACK_INPUT_DENIED'); }
  if (!bundle || Array.isArray(bundle) || typeof bundle !== 'object'
    || Object.keys(bundle).length !== 2 || !Object.hasOwn(bundle, 'readback') || !Object.hasOwn(bundle, 'imageObservations')) {
    return result('NOT_READY', 'LOCAL_DEMO_STACK_INPUT_DENIED');
  }
  const images = checkLocalDemoImageObservations(bundle?.imageObservations, operatorHeldPins);
  if (images.status !== 'LOCAL_IMAGE_OBSERVATIONS_MATCHED') return result('NOT_READY', images.code);
  // The approved local image helper already denies unknown/duplicate roles. It
  // intentionally admits subsets; this actual caller additionally requires all.
  const required = ['superset-init', 'superset', 'bi-control', 'bi-agent'];
  if (required.some(role => !bundle.imageObservations.some(row => row.component === role))) {
    return result('NOT_READY', 'LOCAL_DEMO_REQUIRED_SERVICE_OBSERVATION_MISSING');
  }
  const business = checkLocalDemoBoundReadback(bundle?.readback, heldGenerationId);
  if (business.status !== 'LOCAL_BUSINESS_FACTS_VERIFIED') return result('NOT_READY', business.code);
  return result('LOCAL_STACK_FACTS_VERIFIED', 'LOCAL_DEMO_COMPLETE_HELD_IMAGE_AND_BUSINESS_FACTS_MATCH');
}
