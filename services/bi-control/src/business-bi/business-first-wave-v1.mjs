// One trusted local client activation, not one falsely unified production source.
// Existing aggregate/file grants and static known mappings remain independent scopes;
// actual native O2C/P2P/STOCK results have their own matched shared snapshot.
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {types} from 'node:util';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {canonicalJson} from '../canonical-json.js';
import {validateAggregateProfile} from './permitted-aggregate-candidate.mjs';
import {runAggregateCandidate} from './permitted-aggregate-sandbox.mjs';
import {runDuckdbFileProfile} from '../db-analyzer/duckdb-file-workflow.mjs';
import {assertO2cPeriodV1} from './invoice-date-o2c.mjs';
import {createNativeBusinessCompositionV1} from './native-business-composition-v1.mjs';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
export async function createBusinessFirstWaveConsumerV1(options){
 const keys=['sourceRoot','nativeRoot','asOf','period','fileRuntimeRoot'];
 if(!options||typeof options!=='object'||types.isProxy(options)||Object.getPrototypeOf(options)!==Object.prototype)throw new Error('KS281_INPUT_DENIED');
 const fields=Object.getOwnPropertyDescriptors(options);
 if(Reflect.ownKeys(fields).length!==keys.length||Reflect.ownKeys(fields).some(key=>typeof key!=='string'||!keys.includes(key))||Object.values(fields).some(field=>!field.enumerable||!('value'in field)))throw new Error('KS281_INPUT_DENIED');
 const {sourceRoot,nativeRoot,asOf,fileRuntimeRoot}=options,rawPeriod=fields.period.value;
 if(typeof fileRuntimeRoot!=='string'||!fileRuntimeRoot||!rawPeriod||typeof rawPeriod!=='object'||types.isProxy(rawPeriod)||Object.getPrototypeOf(rawPeriod)!==Object.prototype)throw new Error('KS281_INPUT_DENIED');
 const dates=Object.getOwnPropertyDescriptors(rawPeriod);
 if(Reflect.ownKeys(dates).length!==2||!Object.hasOwn(dates,'start')||!Object.hasOwn(dates,'end')||Object.values(dates).some(field=>!field.enumerable||!('value'in field)))throw new Error('KS281_INPUT_DENIED');
 const period=assertO2cPeriodV1({start:dates.start.value,end:dates.end.value});
 const native=await createNativeBusinessCompositionV1({sourceRoot,nativeRoot,asOf,period});
 let previous=null;
 const denied=reasonCode=>Object.freeze({schema:'kaleidosphere/business-first-wave/v1',outcome:'DENIED',reasonCode,firstWave:null,stateVersion:previous?.stateVersion??0,previousQualifiedHeld:previous!==null,sourceMutationPerformed:false,partialSuccess:false});
 return Object.freeze({read(){
  const owned=mkdtempSync(join(tmpdir(),'ks281-first-wave-'));
  try{
   const payload=validateAggregateProfile(JSON.parse(readFileSync(join(root,'examples/business-bi/k01-permitted-period-aggregates-v1.json'))));
   const aggregate=runAggregateCandidate(root,payload);
   const fileProfile=runDuckdbFileProfile({root,runtimeRoot:fileRuntimeRoot,source:'examples/file-profile/approved.csv',question:'sum-units-by-category',exportPath:join(owned,'file-profile.csv'),mode:'FULL_READ_ONLY'});
   const knownReferenceMappings={};
   for(const mapping of ['common-snake-reference/v1','ks-camel-fixture/v1']){
    const proc=spawnSync(process.execPath,[join(root,'scripts/run-invoice-date-o2c.mjs'),'--fixture','COMMON-TRADE-01','--period-start',period.start,'--period-end',period.end,'--mapping',mapping],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:65536,env:{PATH:'/usr/bin:/bin'}});
    if(proc.error||proc.status!==0||proc.stderr)throw new Error('KS281_KNOWN_MAPPING_DENIED');
    const result=JSON.parse(proc.stdout);if(result.outcome!=='ACCEPTED')throw new Error('KS281_KNOWN_MAPPING_DENIED');
    knownReferenceMappings[mapping]=result;
   }
   const nativeBusiness=native.read();if(nativeBusiness.outcome==='DENIED')return denied(nativeBusiness.reasonCode);
   const content={schema:'kaleidosphere/business-first-wave/v1',outcome:'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',firstWave:{aggregate,fileProfile,knownReferenceMappings,nativeBusiness},sourceScopeClaim:'MULTIPLE_EXISTING_SYNTHETIC_GRANTS_NOT_ONE_PRODUCTION_SOURCE',referenceBillingClaim:'KNOWN_LOCAL_MAPPING_REFERENCE_NOT_NATIVE_BILLING',sourceMutationPerformed:false,ownedTemporaryArtifactsRemoved:true,partialSuccess:false,portableAuthority:false};
   const resultDigest=createHash('sha256').update(canonicalJson(content)).digest('hex');
   if(previous?.resultDigest===resultDigest)return previous;
   previous=freeze({...content,resultDigest,stateVersion:(previous?.stateVersion??0)+1});return previous;
  }catch(error){if(/^(?:K01|K02|K03|KS281)_[A-Z0-9_]+$/.test(error.message))return denied(error.message);throw error;}
  finally{rmSync(owned,{recursive:true,force:true});}
 }});
}
