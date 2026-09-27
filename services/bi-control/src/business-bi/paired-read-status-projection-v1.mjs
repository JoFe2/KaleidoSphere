// KS256: a bounded display of two separately executed public-only synthetic reads.
// The KS256 authored board is not an observed transfer or target installation.
export function projectPairedReadStatus({ read, crossing, requestedAction = 'READ_STATUS' } = {}) {
  const deny = (code) => ({ outcome: 'DENIED', code, mutationCount: 0 });
  if (requestedAction !== 'READ_STATUS') return deny('KS256_WRITE_AUTHORITY_NOT_GRANTED');
  const qualification = read?.pairedQualification;
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
      || crossing.mutationCount !== 0 || crossing.producerStatus?.authority !== 'READ_ONLY'
      || crossing.producerStatus?.promotedToKsLifecycle !== false
      || crossing.producerStatus?.promotedToKsProgress !== false
      || crossing.producerStatus?.effectConfirmed !== false
      || crossing.ksStatus?.authority?.writeAuthority !== 'NOT_GRANTED'
      || crossing.ksStatus?.authority?.mutationCount !== 0
      || !/^[a-f0-9]{64}$/.test(crossing.crossingBindingDigest ?? '')) {
    return deny('KS256_PRODUCER_STATUS_UNQUALIFIED');
  }
  return {
    outcome: 'PROJECTED_LOCAL_SYNTHETIC_READ_ONLY',
    source: { taskRef: qualification.taskRef, sourceRevision: qualification.sourceRevision,
      sourceSha256: qualification.sourceSha256, producerSha: qualification.producerSha,
      lineageSha256: qualification.lineageSha256, verifiedNumberCount: qualification.verifiedNumberCount,
      unit: qualification.units, periods: qualification.period, scope: 'FIXED_LOCAL_SYNTHETIC_READ' },
    producerCrossing: { status: crossing.producerCrossing,
      panMain: crossing.producerStatus.panMain, bindingDigest: crossing.crossingBindingDigest },
    // Neither source read describes a target. The independently authored KS board's
    // denominator does not qualify as a target's measured progress.
    target: { identity: 'UNKNOWN', observed: false, responsibleRole: 'TARGET_CONTRACT_OWNER' },
    ownedScope: 'UNKNOWN_TARGET_SCOPE', denominator: 'NOT_OBSERVED', progress: 'UNKNOWN',
    quarantine: 'NOT_OBSERVED', nextResponsibleRole: 'TARGET_CONTRACT_OWNER',
    authority: { display: 'READ_ONLY', update: 'NOT_GRANTED', restore: 'NOT_GRANTED',
      migration: 'NOT_GRANTED', mutationCount: 0 },
    nonclaims: ['No target identity, denominator, transfer progress or quarantine observed.',
      'Authored project board does not become a measured target through a metric read.'],
  };
}
