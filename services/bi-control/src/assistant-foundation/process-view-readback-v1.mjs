// KS324: one read-only presentation of the existing authorized inbox owner.
// No second store, scope supplied by the client, source authentication or effects.
import {sha256Digest} from './core-contracts.mjs';
import {exactObject,coded} from '../policy.mjs';
export function readProcessViewV1(owner,request){
 exactObject(request,['phase']);
 if(!['ALL','PROPOSED','PENDING','UNKNOWN','RESULT_CONFIRMED'].includes(request.phase))throw coded('PROCESS_VIEW_FILTER_DENIED');
 const metrics=owner.processMetrics({requiredThroughSequence:null});
 const events=owner.durableEvents();
 const current=owner.processMetrics({requiredThroughSequence:null});
 const digest=sha256Digest({binding:metrics.input.binding,requiredThroughSequence:null,events});
 if(digest!==metrics.input.inputStateDigest||digest!==current.input.inputStateDigest)throw coded('PROCESS_VIEW_STALE');
 const correlations=new Set(events.map(event=>event.correlationId));
 if(correlations.size>1)return{state:'UNAVAILABLE',code:'PROCESS_VIEW_MULTIPLE_CORRELATIONS',rows:[],metrics:null};
 return{schemaVersion:'kaleidosphere/process-view/v1',state:events.length?'CURRENT':'EMPTY',
  inputStateDigest:digest,correlationId:events[0]?.correlationId??null,filter:request.phase,
  input:metrics.input,metrics,rows:events.filter(event=>request.phase==='ALL'||event.payload.phase===request.phase).map(event=>({
   eventId:event.eventId,sequence:event.seq,taskId:event.payload.action.taskId,stepId:event.payload.action.stepId,
   phase:event.payload.phase,mode:event.payload.mode,attempt:event.payload.action.attempt,taskRevision:event.payload.action.taskRevision,
   sourceEventDigest:event.payload.source.eventDigest,sourceTimeMs:event.payload.source.sourceTimeMs,
   proofRef:event.payload.result?.proofRef??null,proofKind:event.payload.result?.proofKind??null,
   readbackRef:event.payload.readbackRef,causationId:event.causationId,inputStateDigest:digest}))};
}
