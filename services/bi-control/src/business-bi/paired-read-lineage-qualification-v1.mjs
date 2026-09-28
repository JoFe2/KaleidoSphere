// KS247: an opt-in, read-only join of the released producer receipt and verified
// result lineage. This is a display qualification, not a task issuer or effect grant.
export function qualifyPairedReadLineage({ pairedRead, lineage, producerSha, contractSha256, variant = "v1" }) {
  const deny = (reason) => { const error = new Error(`KS247_PAIRED_LINEAGE_DENIED:${reason}`); error.code = error.message; throw error; };
  const scope = variant === "v1"
    ? {sha:"d8e78430e66a6d1b623fde26a3018089652d2112",origin:"LOCAL_SYNTHETIC_KS246_KS247_V1",taskRef:"ks247-net-revenue-read-v1"}
    : variant === "v2" ? {sha:"e305a3432f7a98de83b1fdbf2a2b1d21bb719e7c",origin:"LOCAL_SYNTHETIC_KS246_KS247_V2",taskRef:"ks247-net-revenue-read-v2",sourceRevision:"synthetic-unfamiliar-source-v2",sourceSha256:"cacd2a08d5fa5cb8603513a769362a2f7bdb700c44d700728a1fe2f1244be52e"} : null;
  if (scope === null || producerSha !== scope.sha) deny("IDENTITY_UNAVAILABLE");
  if (pairedRead?.schemaVersion !== 'pansphaira.contract/synthetic-metric-read-task/v1'
      || pairedRead.status !== 'READ_COMPLETE' || pairedRead.effectStatus !== 'NO_EFFECT_AUTHORIZED'
      || pairedRead.task?.schemaVersion !== pairedRead.schemaVersion
      || pairedRead.task?.origin !== scope.origin
      || pairedRead.task?.taskRef !== scope.taskRef
      || (scope.sourceRevision && (pairedRead.task?.sourceRevision !== scope.sourceRevision
        || pairedRead.task?.sourceSha256 !== scope.sourceSha256))
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
