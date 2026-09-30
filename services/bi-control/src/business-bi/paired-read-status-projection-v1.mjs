// KS256: a bounded display of two separately executed public-only synthetic reads.
// The KS256 authored board is not an observed transfer or target installation.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonicalJson } from '../canonical-json.js';
import { qualifyPairedReadLineage } from './paired-read-lineage-qualification-v1.mjs';
import { PUBLIC_PAN_MAIN } from './public-producer-status-crossing-v1.mjs';
import { observeSyntheticTarget } from './synthetic-target-status-v1.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const contractSha256 = digest(readFileSync(new URL('../../../../contracts/business-bi/v1/net-revenue.metric.json', import.meta.url)));

export function projectPairedReadStatus({ read, crossing, variant = 'v1', requestedAction = 'READ_STATUS', targetSnapshot } = {}) {
  const deny = (code) => ({ outcome: 'DENIED', code, mutationCount: 0 });
  if (requestedAction !== 'READ_STATUS') return deny('KS256_WRITE_AUTHORITY_NOT_GRANTED');
  const qualification = read?.pairedQualification;
  // Re-derive the released qualification instead of trusting copied display labels.
  // This checks consistency of just-executed child outputs, not external receipt authority.
  try {
    const fresh = qualifyPairedReadLineage({ pairedRead: read?.pairedRead, lineage: read?.lineage,
      producerSha: read?.pairedRead?.producerSha, contractSha256, variant });
    const { lineageSha256, ...body } = read.lineage;
    if (canonicalJson(fresh) !== canonicalJson(qualification)
        || digest(canonicalJson(body)) !== lineageSha256) return deny('KS256_PAIRED_READ_UNQUALIFIED');
  } catch { return deny('KS256_PAIRED_READ_UNQUALIFIED'); }
  if (qualification?.status !== 'VERIFIED_LOCAL_SYNTHETIC_READ_ONLY'
      || qualification.completion !== 'READ_COMPLETE'
      || qualification.effectStatus !== 'NO_EFFECT_AUTHORIZED'
      || qualification.mutationAuthority !== false
      || qualification.externalSourceAuthority !== 'NOT_GRANTED'
      || read?.pairedRead?.producerSha !== qualification.producerSha
      || read.pairedRead.status !== 'READ_COMPLETE'
      || read.pairedRead.effectStatus !== 'NO_EFFECT_AUTHORIZED'
      || read.pairedRead.task?.sourceSha256 !== qualification.sourceSha256
      || read.pairedRead.task?.taskRef !== qualification.taskRef
      || read.lineage?.lineageSha256 !== qualification.lineageSha256
      || read.lineage?.verification?.verifiedNumberCount !== qualification.verifiedNumberCount
      || read.lineage?.sections?.completion?.complete !== true) return deny('KS256_PAIRED_READ_UNQUALIFIED');
  if (crossing?.outcome !== 'PROJECTED' || crossing.code !== 'OK'
      || crossing.producerCrossing !== 'EXECUTED_AND_REBOUND_LOCAL_SYNTHETIC'
      || crossing.producerStatus?.panMain !== PUBLIC_PAN_MAIN
      || crossing.mutationCount !== 0 || crossing.producerStatus?.authority !== 'READ_ONLY'
      || crossing.producerStatus?.promotedToKsLifecycle !== false
      || crossing.producerStatus?.promotedToKsProgress !== false
      || crossing.producerStatus?.effectConfirmed !== false
      || crossing.ksStatus?.authority?.writeAuthority !== 'NOT_GRANTED'
      || crossing.ksStatus?.authority?.mutationCount !== 0
      || !/^[a-f0-9]{64}$/.test(crossing.crossingBindingDigest ?? '')) {
    return deny('KS256_PRODUCER_STATUS_UNQUALIFIED');
  }
  if (crossing.crossingBindingDigest !== digest(JSON.stringify({
    ks: crossing.ksStatus.bindingDigest, producers: crossing.producerStatus,
  }))) return deny('KS256_PRODUCER_STATUS_UNQUALIFIED');
  const targetStatus = targetSnapshot === undefined ? null : observeSyntheticTarget({ ...targetSnapshot, read });
  if (targetStatus?.outcome === 'DENIED') return targetStatus;
  const { outcome: _targetOutcome, mutationCount: _targetMutations, ...targetFields } = targetStatus ?? {};
  return {
    outcome: 'PROJECTED_LOCAL_SYNTHETIC_READ_ONLY',
    source: { taskRef: qualification.taskRef, question: qualification.question, sourceRevision: qualification.sourceRevision,
      sourceSha256: qualification.sourceSha256, producerSha: qualification.producerSha,
      lineageSha256: qualification.lineageSha256, verifiedNumberCount: qualification.verifiedNumberCount,
      unit: qualification.units, periods: qualification.period, scope: 'FIXED_LOCAL_SYNTHETIC_READ' },
    producerCrossing: { status: crossing.producerCrossing,
      panMain: crossing.producerStatus.panMain, bindingDigest: crossing.crossingBindingDigest,
      evidencePlane: 'SEPARATE_PUBLIC_SYNTHETIC_PRODUCER_OBSERVATION',
      lifecycle: { state: crossing.producerStatus.lifecycle.state,
        observationValidity: crossing.producerStatus.lifecycle.observationValidity,
        bindingDigest: crossing.producerStatus.lifecycle.bindingDigest,
        observedBytesSha256: crossing.producerStatus.lifecycle.observedBytesSha256 },
      capabilities: { bindingDigest: crossing.producerStatus.capabilities.bindingDigest,
        sourceBytesSha256: crossing.producerStatus.capabilities.sourceBytesSha256,
        coverage: crossing.producerStatus.capabilities.coverage.map(({ kind, availability }) => ({ kind, availability })) },
      appliesToMetricSourceOrTarget: false },
    // Neither source read describes a target. The independently authored KS board's
    // denominator does not qualify as a target's measured progress.
    target: { identity: 'UNKNOWN', observed: false, responsibleRole: 'TARGET_CONTRACT_OWNER' },
    ownedScope: 'UNKNOWN_TARGET_SCOPE', denominator: 'NOT_OBSERVED', progress: 'UNKNOWN',
    quarantine: 'NOT_OBSERVED', nextResponsibleRole: 'TARGET_CONTRACT_OWNER',
    ...targetFields,
    authority: { display: 'READ_ONLY', update: 'NOT_GRANTED', restore: 'NOT_GRANTED',
      migration: 'NOT_GRANTED', mutationCount: 0 },
    nonclaims: [targetStatus ? 'Observed only a local synthetic receipt snapshot, not an installation or executed transfer.'
      : 'No target identity, denominator, transfer progress or quarantine observed.',
      'Authored project board does not become a measured target through a metric read.'],
  };
}
