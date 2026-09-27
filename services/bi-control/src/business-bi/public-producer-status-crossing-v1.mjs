// KS256: optional, read-only crossing of two PUBLIC PAN producer entry points.
// A producer result is never an input authority: the caller supplies independently
// selected bytes/contracts and executable producer functions. Rebind re-executes
// both producers against those bytes before any facet is displayed. The existing
// authored KS board is deliberately not rewritten as an observed installation.
import { createHash } from 'node:crypto';
import { createProjectLifecycleTransferStatus } from './project-lifecycle-transfer-status-v1.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const deny = (code) => ({ outcome: 'DENIED', code, mutationCount: 0 });
export const PUBLIC_PAN_MAIN = 'ac42e9d9fa5d6ef471d634159eb5a316464e425e';

export function crossPublicProducerStatus({ panMain, pan461, pan471, lifecycle, capability, project, carriedLifecycle, carriedCapability } = {}) {
  if (panMain !== PUBLIC_PAN_MAIN || !pan461 || !pan471 || !lifecycle || !capability || !project
    || typeof pan461.createPan461LifecycleInventory !== 'function'
    || typeof pan461.rebindPan461Inventory !== 'function'
    || typeof pan471.createPan471CapabilityInventory !== 'function'
    || typeof pan471.rebindPan471Inventory !== 'function'
    || !Buffer.isBuffer(lifecycle.observed) || !Buffer.isBuffer(capability.sourceBytes)) {
    return deny('PUBLIC_PRODUCER_INPUT_REQUIRED');
  }
  if (project.requestedAction && project.requestedAction !== 'READ_STATUS') {
    return deny('PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED');
  }
  const l = pan461.createPan461LifecycleInventory(lifecycle);
  if (l.outcome !== 'INVENTORIED') return deny(`PAN461_${l.code}`);
  const c = pan471.createPan471CapabilityInventory(capability);
  if (c.outcome !== 'INVENTORIED') return deny(`PAN471_${c.code}`);
  const lr = pan461.rebindPan461Inventory({ ...lifecycle,
    observedSha256: digest(lifecycle.observed), binding: structuredClone(carriedLifecycle?.binding ?? l.binding),
    bindingDigest: carriedLifecycle?.bindingDigest ?? l.bindingDigest });
  if (lr.outcome !== 'REBOUND' || lr.bindingDigest !== l.bindingDigest) return deny(`PAN461_REBIND_${lr.code}`);
  const cr = pan471.rebindPan471Inventory({ ...capability,
    sourceBytesSha256: digest(capability.sourceBytes), inventoryBinding: structuredClone(carriedCapability?.binding ?? c.binding),
    bindingDigest: carriedCapability?.bindingDigest ?? c.bindingDigest });
  if (cr.outcome !== 'REBOUND' || cr.bindingDigest !== c.bindingDigest) return deny(`PAN471_REBIND_${cr.code}`);
  const board = createProjectLifecycleTransferStatus(project);
  if (board.outcome !== 'PROJECTED') return deny(`KS256_${board.code}`);
  if (board.authority?.writeAuthority !== 'NOT_GRANTED' || board.authority?.mutationCount !== 0) {
    return deny('PUBLIC_PRODUCER_AUTHORITY_MISMATCH');
  }
  // No raw observations, tenant/person data, or producer-authored completion
  // count is copied into the status. The producer facets retain their own
  // evidence plane; KS progress/transfer/lifecycle remain authored.
  const producerStatus = {
    scope: 'LOCAL_SYNTHETIC_PUBLIC_SOURCE',
    panMain,
    lifecycle: { state: lr.lifecycleState, observationValidity: l.observationValidity,
      bindingDigest: lr.bindingDigest, observedBytesSha256: digest(lifecycle.observed) },
    capabilities: { bindingDigest: cr.bindingDigest, sourceBytesSha256: digest(capability.sourceBytes),
      coverage: cr.capabilities.map(({ kind, availability }) => ({ kind, availability })) },
    promotedToKsLifecycle: false,
    promotedToKsProgress: false,
    effectConfirmed: false,
    authority: 'READ_ONLY',
  };
  return {
    outcome: 'PROJECTED', code: 'OK',
    producerCrossing: 'EXECUTED_AND_REBOUND_LOCAL_SYNTHETIC',
    ksBoard: board, producerStatus,
    crossingBindingDigest: digest(JSON.stringify({ ks: board.bindingDigest, producers: producerStatus })),
    mutationCount: 0,
    nonClaims: ['No real host, installation or effect evidence; KS lifecycle/denominator remain authored.',
      'A source-only release is not an installable target; no update, restore or migration authority.'],
  };
}
