import { readBoundedObservedJson } from './h01-observed-json.mjs';

// KS data conversion only, not a portable contract or permission. The bounded
// decoder must run BEFORE JSON conversion so no input callback is consulted.
// Preserve exact keys and values; never relabel a component or runtime version.
export function readLocalObservedWireJson(input) {
  return JSON.parse(JSON.stringify(readBoundedObservedJson(input)));
}
