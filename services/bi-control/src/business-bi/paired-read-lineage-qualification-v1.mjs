// KS247: an opt-in, read-only join of the released producer receipt and verified
// result lineage. This is a display qualification, not a task issuer or effect grant.
export function qualifyPairedReadLineage({ pairedRead, lineage, producerSha, contractSha256 }) {
  const deny = (reason) => { const error = new Error(`KS247_PAIRED_LINEAGE_DENIED:${reason}`); error.code = error.message; throw error; };
  if (pairedRead?.schemaVersion !== 'pansphaira.contract/synthetic-metric-read-task/v1'
      || pairedRead.status !== 'READ_COMPLETE' || pairedRead.effectStatus !== 'NO_EFFECT_AUTHORIZED'
      || pairedRead.task?.schemaVersion !== pairedRead.schemaVersion
      || pairedRead.task?.origin !== 'LOCAL_SYNTHETIC_KS246_KS247_V1'
      || pairedRead.task?.intent !== 'READ_METRIC_NO_EFFECT'
      || pairedRead.task?.authority?.readOnly !== true
      || pairedRead.task.authority.mutationAuthority !== false
      || pairedRead.task.authority.effectJournal !== false) deny('PRODUCER_READ_NOT_QUALIFIED');
  const t = pairedRead.task;
  const v = lineage?.verification;
  if (lineage?.observationKind !== 'COMPLETE_READ_ONLY_OBSERVATION'
      || lineage.sections?.completion?.state !== 'COMPLETE'
      || lineage.sections.completion.complete !== true
      || v?.verifiedNumberCount !== v?.expectedNumberCount
      || v.verifiedNumberCount === 0
      || v.effectJournal !== 'NOT_INVENTED_READ_ONLY_JOURNEY'
      || v.effectStatus !== 'EFFECT_NOT_APPLIED_READ_ONLY'
      || lineage.sections.syntheticEffects?.length !== 0
      || lineage.authority?.publicationAuthority !== 'NONE'
      || lineage.promotionBoundaries?.mutationAuthority !== 'NONE') deny('LINEAGE_NOT_READ_ONLY_VERIFIED');
  if (t.sourceRevision !== lineage.sourceRevision
      || t.sourceSha256 !== v.evidence?.sourceByteSha256
      || t.contractSha256 !== contractSha256
      || t.question !== lineage.metricId
      || t.units !== v.unit?.id
      || !['current', 'comparison'].every((period) =>
        t.period?.[period]?.start === v.periods?.[period]?.start
        && t.period?.[period]?.end === v.periods?.[period]?.end)
      || lineage.sections.completion.resultSha256 !== v.evidence?.resultSha256) {
    deny('TASK_RESULT_BINDING_MISMATCH');
  }
  if (typeof producerSha !== 'string' || !/^[a-f0-9]{40}$/.test(producerSha)
      || !/^[a-f0-9]{64}$/.test(lineage.lineageSha256)) deny('IDENTITY_UNAVAILABLE');
  // Separate from the original lineage: never relabel its pre-pair authority fields.
  return Object.freeze({ status: 'VERIFIED_LOCAL_SYNTHETIC_READ_ONLY', producerSha,
    lineageSha256: lineage.lineageSha256, taskRef: t.taskRef,
    sourceRevision: t.sourceRevision, sourceSha256: t.sourceSha256,
    question: t.question, period: t.period, layout: t.layout, units: t.units,
    verifiedNumberCount: v.verifiedNumberCount, completion: 'READ_COMPLETE',
    effectStatus: 'NO_EFFECT_AUTHORIZED', mutationAuthority: false,
    causalClaimsVerified: false, externalSourceAuthority: 'NOT_GRANTED' });
}
