import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {types} from 'node:util';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const binding=JSON.parse(readFileSync(resolve(ROOT,'contracts/dependencies/pan520-stock-source-v1.json'),'utf8'));
const sources=new WeakMap(),plans=new WeakMap();
const questions=['STOCK_POSITION','STOCK_RUNWAY','STOCK_VALUE'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
function fail(code){throw new Error(code);}
function plain(value,required,optional=[]){
  if(value===null||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('K05_PAN520_REQUEST_DENIED');
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(keys.some(k=>typeof k!=='string'||![...required,...optional].includes(k)||!('value' in fields[k]))||required.some(k=>!Object.hasOwn(fields,k)))fail('K05_PAN520_REQUEST_DENIED');
}
function exactQuestions(value){
  if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('K05_PAN520_REQUEST_DENIED');
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(fields.length.value!==questions.length||keys.length!==questions.length+1||keys.some(k=>typeof k!=='string'||k!=='length'&&!/^[0-2]$/.test(k)))fail('K05_PAN520_REQUEST_DENIED');
  const items=questions.map((_,i)=>{const d=fields[String(i)];if(!d||!('value' in d)||!d.enumerable)fail('K05_PAN520_REQUEST_DENIED');return d.value;});
  if(new Set(items).size!==questions.length||questions.some(q=>!items.includes(q)))fail('K05_PAN520_REQUEST_DENIED');
}
function freeze(value){if(value!==null&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function boundedPinnedRead(root,name){
  let dir,fd;
  try {
    const flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
    dir=openSync(root,flags);const parts=name.split('/');
    for(const part of parts.slice(0,-1)){const next=openSync('/proc/self/fd/'+dir+'/'+part,flags);closeSync(dir);dir=next;}
    fd=openSync('/proc/self/fd/'+dir+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1048576)fail('K05_PAN520_SOURCE_BINDING_DENIED');
    const bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
    if(offset!==stat.size)fail('K05_PAN520_SOURCE_BINDING_DENIED');return bytes.subarray(0,offset);
  }finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir);}
}
function qualify(root){
  try {
    const git=(...args)=>{
      const r=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',timeout:5000,maxBuffer:16384});
      if(r.error||r.status!==0)fail('K05_PAN520_SOURCE_BINDING_DENIED');return r.stdout.trim();
    };
    if(git('rev-parse','--show-toplevel')!==root||git('rev-parse','HEAD')!==binding.producerCommit||git('rev-parse','HEAD^{tree}')!==binding.producerTree||git('status','--porcelain=v1','--untracked-files=no')!=='')fail('K05_PAN520_SOURCE_BINDING_DENIED');
    for(const [name,digest] of Object.entries(binding.fileSha256))if(hash(boundedPinnedRead(root,name))!==digest)fail('K05_PAN520_SOURCE_BINDING_DENIED');
  }catch{fail('K05_PAN520_SOURCE_BINDING_DENIED');}
}
export async function loadPan520StockSourceV1(options){
  plain(options,['sourceRoot']);const {sourceRoot}=options;
  if(typeof sourceRoot!=='string'||!sourceRoot||!lstatSync(sourceRoot).isDirectory())fail('K05_PAN520_SOURCE_BINDING_DENIED');
  const root=realpathSync(sourceRoot);qualify(root);
  const api=await import(pathToFileURL(resolve(root,binding.entry)).href);qualify(root);
  if(typeof api.capturePan520ProjectionPlan!=='function'||typeof api.executePan520ProjectionRead!=='function')fail('K05_PAN520_SOURCE_BINDING_DENIED');
  const source=freeze({schemaVersion:'kaleidosphere/pan520-stock-source/v1',producerCommit:binding.producerCommit,producerTree:binding.producerTree,contractSha256:binding.contractSha256,portableAuthority:false});
  sources.set(source,{root,api});return source;
}
export function capturePan520StockPlanV1(options){
  plain(options,['source','nativeRoot','request','asOf']);
  const {source,nativeRoot,request,asOf}=options,held=sources.get(source);
  if(!held||typeof nativeRoot!=='string'||!nativeRoot)fail('K05_PAN520_SOURCE_BINDING_DENIED');
  if(typeof asOf!=='string')fail('K05_CUTOFF_REQUIRED_DENIED');
  plain(request,['schemaVersion','profile','scope','questions']);
  if(request.profile!=='STOCK')fail('K05_PAN520_PROFILE_DENIED');
  exactQuestions(request.questions);
  qualify(held.root);
  // This owner constant is the existing native disposable-COMMON owner route,
  // not a caller role, portable grant, or permission for other sources.
  const native=held.api.capturePan520ProjectionPlan({root:nativeRoot,owner:'LOCAL_SYNTHETIC_OWNER',asOf,projection:request});
  const core={schemaVersion:'kaleidosphere/pan520-stock-plan/v1',source,asOf,nativePlan:native.plan,proposalOnly:true,effectsProduced:false,portableAuthority:false};
  const plan=freeze({...core,planDigest:hash(canonical(core))}),handle=Object.freeze({});
  plans.set(handle,{plan,source:held,native,nativeRoot});return {plan,handle};
}
function resultFromNative(snapshot){
  if(snapshot.schemaVersion!=='pansphaira.pan520/projection-snapshot/v1'||snapshot.profile!=='STOCK'||snapshot.grain.orderId!=='SO-01'||snapshot.grain.lineId!=='1'||snapshot.readOnly!==true||snapshot.rights.portableGrant!==false||snapshot.productiveAuthority!==false||snapshot.provenance.coverage!=='COMPLETE_OWNED_EVENT_LEDGER_ONLY')fail('K05_PAN520_SNAPSHOT_DENIED');
  const {projectionDigest,...preimage}=snapshot;
  if(hash(canonical(preimage))!==projectionDigest)fail('K05_PAN520_SNAPSHOT_DENIED');
  const facts=structuredClone(snapshot.facts),position=['physical','reserved','quarantined','free'];
  if(Object.keys(facts).length!==6)fail('K05_PAN520_SNAPSHOT_DENIED');
  for(const k of position){const f=facts[k];if(!f||f.state!=='KNOWN'||f.unit!=='STK'||!Number.isSafeInteger(f.value)||f.value<0||f.basis!=='ACTUAL_NATIVE_PAN515_EVENT_STOCK_READBACK')fail('K05_PAN520_SNAPSHOT_DENIED');}
  if(BigInt(facts.physical.value)-BigInt(facts.reserved.value)-BigInt(facts.quarantined.value)!==BigInt(facts.free.value))fail('K05_PAN520_DISJOINT_STOCK_DENIED');
  for(const [k,unit,reason] of [['stockRunwayDays','DAYS','MISSING_NATIVE_CONSUMPTION_HISTORY'],['stockValueMinor','EUR_MINOR','MISSING_QUALIFIED_VALUATION_PROFILE']]){const f=facts[k];if(!f||f.state!=='UNAVAILABLE'||f.value!==null||f.unit!==unit||f.reason!==reason)fail('K05_PAN520_UNQUALIFIED_HISTORY_OR_VALUE_DENIED');}
  const rows=Object.entries(facts).map(([fact,f])=>({fact,...f}));
  const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const csv=[['fact','state','value','unit','reason','basis'],...rows.map(r=>[r.fact,r.state,r.value,r.unit,r.reason??'',r.basis??''])].map(row=>row.map(csvCell).join(',')).join('\n')+'\n';
  return freeze({schemaVersion:'kaleidosphere/pan520-stock-consumer/v1',outcome:'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',facts,asOf:snapshot.snapshot.asOf,table:{rows:structuredClone(rows)},export:{rows:structuredClone(rows),csv},
    reservationProvenance:{basis:'ACTUAL_NATIVE_PAN515_EVENT_STOCK_READBACK',coverage:snapshot.provenance.coverage,nativeEventDigests:structuredClone(snapshot.provenance.nativeEventDigests),nativeEventSetDigest:snapshot.snapshot.nativeEventSetDigest,quantityOwner:snapshot.provenance.quantityOwner,sourceSnapshot:structuredClone(snapshot.snapshot),meaning:'Actual bounded producer event-ledger snapshot, not a hardcoded KS reservation or a portable write grant'},
    pair:{producerCommit:binding.producerCommit,producerTree:binding.producerTree,contractSha256:binding.contractSha256,projectionDigest,sourceSnapshot:structuredClone(snapshot.snapshot),rights:structuredClone(snapshot.rights),nativeProvenance:structuredClone(snapshot.provenance),syntheticOnly:true,readOnly:true,portableAuthority:false,sourceOperationsExpanded:false},
    shortage:{state:'UNKNOWN',value:null,reason:'NATIVE_STOCK_PROFILE_HAS_NO_TIME_BOUND_COMMITMENT_OR_EXPECTED_ARRIVAL_PROJECTION'},
    stock:{asOf:snapshot.snapshot.asOf,physical:facts.physical.value,reserved:facts.reserved.value,blocked:facts.quarantined.value,free:facts.free.value},
    stockRunwayDays:{state:'UNKNOWN',value:null,reason:facts.stockRunwayDays.reason},stockValueMinor:{state:'UNKNOWN',value:null,reason:facts.stockValueMinor.reason},mutationAuthority:false});
}
export function executePan520StockReadV1(options){
  try{
    plain(options,['plan','handle']);const {plan,handle}=options,held=plans.get(handle);
    if(!held||held.plan!==plan)fail('K05_PAN520_OPAQUE_PLAN_REQUIRED_DENIED');
    qualify(held.source.root);
    const snapshot=held.source.api.executePan520ProjectionRead({root:held.nativeRoot,plan:held.native.plan,handle:held.native.handle});
    qualify(held.source.root);return resultFromNative(snapshot);
  }catch(error){const message=String(error.message),reasonCode=/^(K05_|PAN)[A-Z0-9_]{1,120}$/.test(message)?message:'K05_PAN520_ENTRY_DENIED';return {outcome:'DENIED',reasonCode,table:null,export:null,partialSuccess:false};}
}
