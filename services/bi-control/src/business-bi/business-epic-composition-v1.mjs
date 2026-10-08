// A single local client activation over existing, independently authorized scopes.
// This is not an atomic database transaction or a new source permission.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {types} from 'node:util';
import {canonicalJson} from '../canonical-json.js';
import {createBusinessFirstWaveConsumerV1} from './business-first-wave-v1.mjs';
import {runRelationalCoreProfile} from '../db-analyzer/relational-core-workflow.mjs';
import {runBoundedApiReadProfile} from '../db-analyzer/bounded-api-read-workflow.mjs';
import {executeO2cInvestigationV1} from './o2c-investigation-profile.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const freeze=value=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
function copyPlainData(value,ancestors=new Set(),depth=0){
 const deny=()=>{throw new Error('KS281_INPUT_DENIED');};
 if(depth>8)deny();
 if(value===null||typeof value!=='object'){
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  deny();
 }
 if(types.isProxy(value)||ancestors.has(value))deny();
 const array=Array.isArray(value);
 if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype))deny();
 const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
 if(keys.length>128||array&&(!Number.isSafeInteger(fields.length.value)||fields.length.value>64||keys.length!==fields.length.value+1))deny();
 if(array&&Array.from({length:fields.length.value},(_,index)=>String(index)).some(key=>!Object.hasOwn(fields,key)))deny();
 const copied=array?[]:{};ancestors.add(value);
 for(const key of keys){
  if(array&&key==='length')continue;
  const field=fields[key];
  if(typeof key!=='string'||!field.enumerable||!('value'in field))deny();
  Object.defineProperty(copied,key,{value:copyPlainData(field.value,ancestors,depth+1),enumerable:true,writable:true,configurable:true});
 }
 ancestors.delete(value);return copied;
}
export async function createBusinessEpicCompositionV1(rawOptions){
 const options=copyPlainData(rawOptions);
 if(!options||Array.isArray(options)||Object.keys(options).length!==4||['firstWave','relationalProfile','apiProfile','savedInvestigation'].some(key=>!Object.hasOwn(options,key)))throw new Error('KS281_INPUT_DENIED');
 if(options.relationalProfile?.approval?.state!=='APPROVED_SCOPE')throw new Error('KS281_CORE_APPROVAL_DENIED');
 const firstWave=await createBusinessFirstWaveConsumerV1(options.firstWave);
 let previous=null,closed=false,attemptSequence=0;
 const lifetime=new AbortController();
 const denied=reasonCode=>({schema:'kaleidosphere/business-epic-composition/v1',outcome:'DENIED',reasonCode,components:null,stateVersion:previous?.stateVersion??0,previousQualifiedHeld:previous!==null,partialSuccess:false,sourceMutationPerformed:false});
 return Object.freeze({close(){closed=true;lifetime.abort();},async read(){
  if(closed)return denied('KS281_COMPOSITION_CLOSED');
  const attempt=++attemptSequence;
  const inactive=()=>closed?'KS281_COMPOSITION_CLOSED':attempt!==attemptSequence?'KS281_COMPOSITION_SUPERSEDED':null;
  try{
   const relational=await runRelationalCoreProfile(options.relationalProfile,{signal:lifetime.signal});
   if(inactive())return denied(inactive());
   const api=await runBoundedApiReadProfile(options.apiProfile,{signal:lifetime.signal});
   if(inactive())return denied(inactive());
   if(api.complete!==true)return denied(api.reasonCode);
   const selected=options.savedInvestigation;
   const savedInvestigation=executeO2cInvestigationV1({root,values:{'profile-read':selected.profileId,'profile-version':selected.profileVersion,store:selected.store}});
   const wave=firstWave.read();if(wave.outcome==='DENIED')return denied(wave.reasonCode);
   const content={schema:'kaleidosphere/business-epic-composition/v1',outcome:'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',components:{firstWave:wave,relational,api,savedInvestigation},sourceScopeClaim:'MULTIPLE_EXISTING_APPROVED_SCOPES_NOT_ONE_DATASET',atomicCrossSourceTransaction:false,sourceMutationPerformed:false,partialSuccess:false};
   const resultDigest=createHash('sha256').update(canonicalJson(content)).digest('hex');
   // Preserve the actual fresh worker PID in every receipt. Only semantic client
   // identity excludes that OS-process observation, not any source/cleanup guard.
   const semantic={...content,components:{...content.components,relational:{...relational,lifecycle:{...relational.lifecycle,workerPid:null}}}};
   const stateDigest=createHash('sha256').update(canonicalJson(semantic)).digest('hex');
   const stateVersion=previous?.stateDigest===stateDigest?previous.stateVersion:(previous?.stateVersion??0)+1;
   previous=freeze({...content,resultDigest,stateDigest,stateVersion});return previous;
  }catch(error){
   if(closed&&error.code==='K06_CANCELLED')return denied('KS281_COMPOSITION_CLOSED');
   if(/^(?:K06|K07|K08|K03|KS281)_[A-Z0-9_]+$/.test(error.code??error.message))return denied(error.code??error.message);
   throw error;
  }
 }});
}
