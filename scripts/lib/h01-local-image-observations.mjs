import { readBoundedObservedJson } from './h01-observed-json.mjs';

// Compare ONLY KS-local Docker service observations with operator-held image
// bytes. Not the portable Component-ID registry or runtime contract. Docker
// observations must be collected through the owned actor's trusted driver, not
// supplied by a model. Matching data never opens a route or grants permission.
export function checkLocalDemoImageObservations(input, operatorHeldPins) {
  const result = (status, code) => ({status, code, hostedRouteOpen: false,
    scope: 'LOCAL_DOCKER_SERVICE_IMAGE_FACTS_ONLY_NO_PERMISSION_OR_RUNTIME_CONTRACT'});
  let observations, pins;
  try {
    observations = readBoundedObservedJson(input);
    pins = readBoundedObservedJson(operatorHeldPins);
  } catch { return result('NOT_READY', 'LOCAL_DEMO_IMAGE_INPUT_DENIED'); }
  if (!Array.isArray(observations) || observations.length === 0 || !pins || typeof pins !== 'object') {
    return result('NOT_READY', 'LOCAL_DEMO_IMAGE_INPUT_DENIED');
  }
  const roles = ['superset-init', 'superset', 'bi-control', 'bi-agent'];
  if (Array.isArray(pins) || Object.keys(pins).length !== roles.length
    || Object.keys(pins).some(role => !roles.includes(role))
    || observations.length > roles.length
    || observations.some(row => !row || typeof row !== 'object' || Array.isArray(row)
      || Object.keys(row).length !== 2 || !Object.hasOwn(row, 'component') || !Object.hasOwn(row, 'imageId')
      || !roles.includes(row.component))
    || new Set(observations.map(row => row.component)).size !== observations.length) {
    return result('NOT_READY', 'LOCAL_DEMO_IMAGE_SCOPE_OR_ROLE_DENIED');
  }
  if (Object.values(pins).some(pin => typeof pin !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(pin))) {
    return result('NOT_READY', 'LOCAL_DEMO_HELD_IMAGE_PIN_DENIED');
  }
  if (observations.some(row => row?.imageId !== pins[row?.component])) {
    return result('NOT_READY', 'LOCAL_DEMO_ACTUAL_IMAGE_MISMATCH');
  }
  return result('LOCAL_IMAGE_OBSERVATIONS_MATCHED', 'LOCAL_DEMO_OPERATOR_HELD_IMAGE_BYTES_MATCH');
}
