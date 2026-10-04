import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {types} from 'node:util';
import {buildProcurementViewsV1} from './procurement-analysis-views.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const binding=JSON.parse(readFileSync(resolve(ROOT,'contracts/dependencies/pan520-p2p-source-v1.json'),'utf8'));
const sources=new WeakMap(),plans=new WeakMap();
const questions=['PROCUREMENT_QUANTITY','PROCUREMENT_PRICE_VARIANCE','PROCUREMENT_TIMELINESS'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
function fail(code){throw new Error(code);}
function plain(value,required,optional=[]){
  if(value===null||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('K04_PAN520_REQUEST_DENIED');
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(keys.some(k=>typeof k!=='string'||![...required,...optional].includes(k)||!('value' in fields[k]))||required.some(k=>!Object.hasOwn(fields,k)))fail('K04_PAN520_REQUEST_DENIED');
}
function exactQuestions(value){
  if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('K04_PAN520_REQUEST_DENIED');
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(fields.length.value!==questions.length||keys.length!==questions.length+1||keys.some(k=>typeof k!=='string'||k!=='length'&&!/^[0-2]$/.test(k)))fail('K04_PAN520_REQUEST_DENIED');
  const items=questions.map((_,i)=>{const d=fields[String(i)];if(!d||!('value' in d)||!d.enumerable)fail('K04_PAN520_REQUEST_DENIED');return d.value;});
  if(new Set(items).size!==questions.length||questions.some(q=>!items.includes(q)))fail('K04_PAN520_REQUEST_DENIED');
}
function freeze(value){if(value!==null&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function boundedPinnedRead(root,name){
  let dir,fd;
  try {
    const flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
    dir=openSync(root,flags);const parts=name.split('/');
    for(const part of parts.slice(0,-1)){const next=openSync('/proc/self/fd/'+dir+'/'+part,flags);closeSync(dir);dir=next;}
    fd=openSync('/proc/self/fd/'+dir+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1048576)fail('K04_PAN520_SOURCE_BINDING_DENIED');
    const bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
    if(offset!==stat.size)fail('K04_PAN520_SOURCE_BINDING_DENIED');return bytes.subarray(0,offset);
  }finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir);}
}
function qualify(root){
  try {
    const git=(...args)=>{
      const r=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',timeout:5000,maxBuffer:16384});
      if(r.error||r.status!==0)fail('K04_PAN520_SOURCE_BINDING_DENIED');return r.stdout.trim();
    };
    if(git('rev-parse','--show-toplevel')!==root||git('rev-parse','HEAD')!==binding.producerCommit||git('rev-parse','HEAD^{tree}')!==binding.producerTree||git('status','--porcelain=v1','--untracked-files=no')!=='')fail('K04_PAN520_SOURCE_BINDING_DENIED');
    for(const [name,digest] of Object.entries(binding.fileSha256))if(hash(boundedPinnedRead(root,name))!==digest)fail('K04_PAN520_SOURCE_BINDING_DENIED');
  }catch{fail('K04_PAN520_SOURCE_BINDING_DENIED');}
}
export async function loadPan520P2pSourceV1(options){
  plain(options,['sourceRoot']);const {sourceRoot}=options;
  if(typeof sourceRoot!=='string'||!sourceRoot||!lstatSync(sourceRoot).isDirectory())fail('K04_PAN520_SOURCE_BINDING_DENIED');
  const root=realpathSync(sourceRoot);qualify(root);
  const api=await import(pathToFileURL(resolve(root,binding.entry)).href);qualify(root);
  if(typeof api.capturePan520ProjectionPlan!=='function'||typeof api.executePan520ProjectionRead!=='function')fail('K04_PAN520_SOURCE_BINDING_DENIED');
  const source=freeze({schemaVersion:'kaleidosphere/pan520-p2p-source/v1',producerCommit:binding.producerCommit,producerTree:binding.producerTree,contractSha256:binding.contractSha256,portableAuthority:false});
  sources.set(source,{root,api});return source;
}
export function capturePan520P2pPlanV1(options){
  plain(options,['source','nativeRoot','request'],['asOf']);
  const {source,nativeRoot,request,asOf=null}=options,held=sources.get(source);
  if(!held||typeof nativeRoot!=='string'||!nativeRoot)fail('K04_PAN520_SOURCE_BINDING_DENIED');
  plain(request,['schemaVersion','profile','scope','questions']);
  if(request.profile!=='P2P')fail('K04_PAN520_PROFILE_DENIED');exactQuestions(request.questions);qualify(held.root);
  // Existing owner route for disposable COMMON only; caller roles are never grants.
  const native=held.api.capturePan520ProjectionPlan({root:nativeRoot,owner:'LOCAL_SYNTHETIC_OWNER',asOf,projection:request});
  const core={schemaVersion:'kaleidosphere/pan520-p2p-plan/v1',source,asOf,nativePlan:native.plan,proposalOnly:true,effectsProduced:false,portableAuthority:false};
  const plan=freeze({...core,planDigest:hash(canonical(core))}),handle=Object.freeze({});
  plans.set(handle,{plan,source:held,native,nativeRoot});return {plan,handle};
}
function resultFromNative(snapshot){
  if(snapshot.schemaVersion!=='pansphaira.pan520/projection-snapshot/v1'||snapshot.profile!=='P2P'||snapshot.grain.orderId!=='PO-01'||snapshot.grain.lineId!=='1'||snapshot.readOnly!==true||snapshot.rights.portableGrant!==false||snapshot.productiveAuthority!==false)fail('K04_PAN520_SNAPSHOT_DENIED');
  const {projectionDigest,...unsigned}=snapshot;if(hash(canonical(unsigned))!==projectionDigest)fail('K04_PAN520_SNAPSHOT_DENIED');
  const facts=structuredClone(snapshot.facts);
  for(const f of Object.values(facts))if(!['KNOWN','UNAVAILABLE'].includes(f.state)||typeof f.unit!=='string'||f.state==='UNAVAILABLE'&&(f.value!==null||typeof f.reason!=='string')||f.state==='KNOWN'&&!Number.isSafeInteger(f.value))fail('K04_PAN520_SNAPSHOT_DENIED');
  const v=key=>facts[key].value,known=key=>facts[key]?.state==='KNOWN';
  const accepted=v('acceptedQuantity'),invoiced=v('invoicedQuantity'),onTime=v('onTimeAcceptedQuantity');
  const quantityKnown=known('orderedQuantity')&&known('acceptedQuantity'),invoiceKnown=known('invoicedQuantity'),priceKnown=['expectedInvoiceNetMinor','invoiceAmountMinor','supplierPriceVarianceMinor'].every(known),timeKnown=quantityKnown&&known('onTimeAcceptedQuantity');
  const quantity={status:quantityKnown?'KNOWN':'UNKNOWN',ordered:v('orderedQuantity'),accepted,invoiced,receivedNotInvoiced:quantityKnown&&invoiceKnown?Math.max(0,accepted-invoiced):null,invoicedNotReceived:quantityKnown&&invoiceKnown?Math.max(0,invoiced-accepted):null,
    ...(!invoiceKnown?{optionalInvoiceFactsStatus:'UNAVAILABLE',invoiceReason:facts.invoicedQuantity.reason}:{}),...(!quantityKnown?{reason:facts.acceptedQuantity.reason??facts.orderedQuantity.reason}:{})};
  const price=priceKnown?{status:'KNOWN',expectedNetMinor:v('expectedInvoiceNetMinor'),invoiceNetMinor:v('invoiceAmountMinor'),varianceMinor:v('supplierPriceVarianceMinor')}:{status:'UNKNOWN',expectedNetMinor:null,invoiceNetMinor:null,varianceMinor:null,reason:facts.supplierPriceVarianceMinor.reason??facts.expectedInvoiceNetMinor.reason??facts.invoiceAmountMinor.reason};
  const timing=timeKnown?{status:'KNOWN',onTimeAccepted:onTime,lateAccepted:accepted-onTime,unknownTimeAccepted:0,denominator:accepted}:{status:'UNKNOWN',onTimeAccepted:null,lateAccepted:null,unknownTimeAccepted:quantityKnown?accepted:null,denominator:accepted,reason:facts.onTimeAcceptedQuantity.reason??facts.acceptedQuantity.reason};
  if(facts.invoiceAmountMinor.state==='KNOWN'&&snapshot.provenance.invoiceGrainCount!==1)fail('K04_PAN520_INVOICE_GRAIN_DENIED');
  const result={outcome:Object.values(facts).some(f=>f.state==='UNAVAILABLE')?'READ_COMPLETE_WITH_UNAVAILABLE_FACTS':'COMPLETE',profile:'p2p-procurement/v1',facts,lines:[{po_id:'PO-01',po_line_id:'1',grain:structuredClone(snapshot.grain),
    quantity,price,timing}],
    pair:{producerCommit:binding.producerCommit,producerTree:binding.producerTree,contractSha256:binding.contractSha256,projectionDigest,nativeProvenance:structuredClone(snapshot.provenance),sourceSnapshot:structuredClone(snapshot.snapshot),rights:structuredClone(snapshot.rights),receiptFacts:structuredClone(snapshot.receiptFacts),syntheticOnly:true,readOnly:true,portableAuthority:false},
    mutationAuthority:false,invoiceMatcherImplemented:false,operationAuthority:'CURRENT_NATIVE_OPAQUE_READ_AT_USE_DISPOSABLE_COMMON_SCOPED_FACTS_ONLY'};
  return freeze({...result,...buildProcurementViewsV1(result)});
}
export function executePan520P2pReadV1(options){
  try{
    plain(options,['plan','handle']);const {plan,handle}=options,held=plans.get(handle);
    if(!held||held.plan!==plan)fail('K04_PAN520_OPAQUE_PLAN_REQUIRED_DENIED');qualify(held.source.root);
    const snapshot=held.source.api.executePan520ProjectionRead({root:held.nativeRoot,plan:held.native.plan,handle:held.native.handle});
    qualify(held.source.root);return resultFromNative(snapshot);
  }catch(error){const message=String(error.message),reasonCode=/^(K04_|PAN)[A-Z0-9_]{1,120}$/.test(message)?message:'K04_PAN520_ENTRY_DENIED';return {outcome:'DENIED',reasonCode,table:null,chart:null,drilldown:null,export:null,partialSuccess:false};}
}
