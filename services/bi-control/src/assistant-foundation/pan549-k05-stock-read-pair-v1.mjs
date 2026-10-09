// One existing K05 read consumer behind the actual published PAN analysis path.
// Trusted code-owner construction, not an HTTP plugin installer or a new BI engine.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {readFileSync} from 'node:fs';
import {capturePan520StockPlanV1,executePan520StockReadV1} from '../business-bi/pan520-stock-consumer.mjs';
import {canonicalJson} from '../../../../contracts/dependencies/pan549-stock-workspace-v1/runtime/canonical-json.js';
import {validateWorkspaceAnalysisReadV1,verifyWorkspaceAnalysisResultIntegrityV1} from '../../../../contracts/dependencies/pan549-stock-workspace-v1/runtime/workspace-analysis-v1.js';
import sourceBinding from '../../../../contracts/dependencies/pan549-stock-workspace-v1/binding.json' with {type:'json'};

const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
const clone=value=>structuredClone(value);
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
// Metadata attribution is captured once, never read from a shared mutable JSON alias at use.
const attribution=freeze(clone(sourceBinding));
const stockRequest=freeze(clone(attribution.boundedProjectionRequest));
function exact(value,keys,code='KS303_STOCK_PAIR_OPTIONS_DENIED'){
 if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new Error(code);
 const ds=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(ds).length!==keys.length||Reflect.ownKeys(ds).some(k=>typeof k!=='string'||!keys.includes(k))||Object.values(ds).some(d=>!d.enumerable||!('value' in d)))throw new Error(code);
}
function assertConsumerBytes(){
 const bytes=readFileSync(new URL('../business-bi/pan520-stock-consumer.mjs',import.meta.url));
 if(digest(bytes.toString('utf8'))!==attribution.existingKSConsumer.sha256)throw new Error('KS303_EXISTING_CONSUMER_SOURCE_DENIED');
}

export function createPan549K05StockReadPairV1(options){
 exact(options,['ksSource','nativeRoot','sessions','nativeReader','isNativeReader']);
 const {ksSource,nativeRoot,sessions,nativeReader,isNativeReader}=options;
 // These objects/functions are process-owner capabilities, never deserialized HTTP fields.
 if(typeof nativeRoot!=='string'||!nativeRoot||typeof isNativeReader!=='function'||typeof sessions?.authenticate!=='function'||typeof nativeReader?.read!=='function'||isNativeReader(nativeReader,sessions.binding)!==true)throw new Error('KS303_NATIVE_READER_OWNER_DENIED');
 assertConsumerBytes();
 const binding=freeze({origin:sessions.binding.origin,tenantId:sessions.binding.tenantId,instanceId:sessions.binding.instanceId,generation:sessions.binding.generation,identityDigest:sessions.binding.identityDigest});
 let closed=false,lastEvidence=null;
 const authorize=headers=>{
  if(closed)throw new Error('KS303_STOCK_PAIR_CLOSED');
  const principal=sessions.authenticate(headers);
  if(headers.origin!==binding.origin||principal.tenantId!==binding.tenantId||principal.instanceId!==binding.instanceId||principal.generation!==binding.generation||!['reader','reviewer'].includes(principal.role))throw new Error('ANALYSIS_ORIGIN_OR_ROLE_DENIED');
  return principal;
 };
 return Object.freeze({
  async read(headers,input){
   lastEvidence=null;authorize(headers);assertConsumerBytes();
   const selector=validateWorkspaceAnalysisReadV1(input);
   if(selector.asOf!==attribution.cutoff)throw new Error('KS303_STOCK_PAIR_CUTOFF_DENIED');
   // The unchanged existing K05 loader/opaque handle owns the source and current
   // native permission. The protected browser session is an additional boundary.
   const plan=capturePan520StockPlanV1({source:ksSource,nativeRoot,request:stockRequest,asOf:selector.asOf});
   authorize(headers);
   const ksResult=executePan520StockReadV1(plan);
   if(ksResult.outcome!=='READ_COMPLETE_WITH_UNAVAILABLE_FACTS'||ksResult.schemaVersion!=='kaleidosphere/pan520-stock-consumer/v1'||ksResult.mutationAuthority!==false||ksResult.pair?.portableAuthority!==false||ksResult.pair?.readOnly!==true||ksResult.pair?.syntheticOnly!==true)throw new Error('KS303_K05_CURRENT_READ_DENIED');
   authorize(headers);
   const result=await verifyWorkspaceAnalysisResultIntegrityV1(nativeReader.read(headers,selector),binding);
   authorize(headers);assertConsumerBytes();
   // Re-use the existing opaque K05 capability AFTER actual async integrity.
   // The unchanged source owner rechecks durable revoke/stop and source drift.
   // This is another read, never a new plan/grant, effect or mutation retry.
   const currentKSResult=executePan520StockReadV1(plan);
   if(currentKSResult.outcome!=='READ_COMPLETE_WITH_UNAVAILABLE_FACTS'||canonicalJson(currentKSResult)!==canonicalJson(ksResult))throw new Error('KS303_K05_RETIRED_OR_SOURCE_DRIFT_DENIED');
   authorize(headers);
   // Different PAN commits are explicit. Six fact states/values/units and the
   // exact source snapshot/cutoff/projection identity prove this bounded pairing.
   if(ksResult.pair.producerCommit!==attribution.existingKSConsumer.producerCommit||ksResult.pair.producerTree!==attribution.existingKSConsumer.producerTree||ksResult.pair.contractSha256!==attribution.existingKSConsumer.contractSha256||ksResult.pair.projectionDigest!==result.source.projectionDigest||canonicalJson(ksResult.pair.sourceSnapshot)!==canonicalJson(result.source.snapshot)||ksResult.asOf!==selector.asOf||canonicalJson(stockRequest.scope)!==canonicalJson(result.source.grain)||result.source.coverage!==attribution.coverage)throw new Error('KS303_SOURCE_SNAPSHOT_PAIR_DENIED');
   for(const row of result.rows){
    const fact=ksResult.facts[row.key];
    if(!fact||fact.state!==row.state||fact.value!==row.value||fact.unit!==row.unit||(fact.reason??null)!==row.reason||(fact.basis??null)!==row.basis)throw new Error('KS303_SOURCE_VALUE_PAIR_DENIED');
   }
   authorize(headers);
   lastEvidence=freeze({schemaVersion:'kaleidosphere/ks303-k05-pan549-read-pair/v1',PAN:attribution.PAN549,KSConsumer:attribution.existingKSConsumer,protectedBinding:binding,nativeGrain:result.source.grain,sourceSnapshot:result.source.snapshot,nativeProjectionDigest:result.source.projectionDigest,PANResultRevision:result.resultRevision,KSResultDigest:digest(ksResult),KSPlanDigest:plan.plan.planDigest,sixFactsCompared:true,persistentSupersetMutation:false,executionAuthorityGranted:false,consentChanged:false,transportEnabled:false,syntheticOnly:true});
   // Return original verified producer result bytes, not a relabelled source,
   // duplicate metric, fabricated K05 envelope or injected HTML/iframe.
   return result;
  },
  readPairEvidence(){return lastEvidence===null?null:freeze(clone(lastEvidence));},
  close(){closed=true;lastEvidence=null;},
 });
}
