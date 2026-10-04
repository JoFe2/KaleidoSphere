import {createHash} from 'node:crypto';
import {readFileSync,lstatSync,realpathSync,openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {types} from 'node:util';
import {assertO2cPeriodV1} from './invoice-date-o2c.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../..');
const binding=JSON.parse(readFileSync(resolve(ROOT,'contracts/dependencies/pan520-o2c-source-v1.json'),'utf8'));
const sources=new WeakMap(),plans=new WeakMap();
const questions=['ORDER_SOURCE','DISPATCH_TIMELINESS','CUSTOMER_RECEIPT_TIMELINESS','BILLED_NET'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
function fail(code){throw new Error(code);}
function plain(value,required,optional=[]){
  if(value===null||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)fail('K03_PAN520_REQUEST_DENIED');
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(keys.some(k=>typeof k!=='string'||![...required,...optional].includes(k)||!('value' in fields[k]))||required.some(k=>!Object.hasOwn(fields,k)))fail('K03_PAN520_REQUEST_DENIED');
}
function exactQuestions(value){
  if(!Array.isArray(value)||types.isProxy(value)||Object.getPrototypeOf(value)!==Array.prototype)fail('K03_PAN520_REQUEST_DENIED');
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(fields.length.value!==questions.length||keys.length!==questions.length+1||keys.some(k=>typeof k!=='string'||k!=='length'&&!/^[0-3]$/.test(k)))fail('K03_PAN520_REQUEST_DENIED');
  const items=questions.map((_,i)=>{const d=fields[String(i)];if(!d||!('value' in d)||!d.enumerable)fail('K03_PAN520_REQUEST_DENIED');return d.value;});
  if(new Set(items).size!==questions.length||questions.some(q=>!items.includes(q)))fail('K03_PAN520_REQUEST_DENIED');
}
function freeze(value){if(value!==null&&typeof value==='object'){for(const v of Object.values(value))freeze(v);Object.freeze(value);}return value;}
function boundedPinnedRead(root,name){
  let dir,fd;
  try {
    const flags=constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK;
    dir=openSync(root,flags);const parts=name.split('/');
    for(const part of parts.slice(0,-1)){const next=openSync('/proc/self/fd/'+dir+'/'+part,flags);closeSync(dir);dir=next;}
    fd=openSync('/proc/self/fd/'+dir+'/'+parts.at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const stat=fstatSync(fd);if(!stat.isFile()||stat.size>1048576)fail('K03_PAN520_SOURCE_BINDING_DENIED');
    const bytes=Buffer.alloc(stat.size+1);let offset=0;
    while(offset<bytes.length){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;}
    if(offset!==stat.size)fail('K03_PAN520_SOURCE_BINDING_DENIED');return bytes.subarray(0,offset);
  }finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir);}
}
function qualify(root){
  try {
    const git=(...args)=>{
      const r=spawnSync('git',['--no-optional-locks','-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',timeout:5000,maxBuffer:16384});
      if(r.error||r.status!==0)fail('K03_PAN520_SOURCE_BINDING_DENIED');return r.stdout.trim();
    };
    if(git('rev-parse','--show-toplevel')!==root||git('rev-parse','HEAD')!==binding.producerCommit||git('rev-parse','HEAD^{tree}')!==binding.producerTree||git('status','--porcelain=v1','--untracked-files=no')!=='')fail('K03_PAN520_SOURCE_BINDING_DENIED');
    for(const [name,digest] of Object.entries(binding.fileSha256))if(hash(boundedPinnedRead(root,name))!==digest)fail('K03_PAN520_SOURCE_BINDING_DENIED');
  }catch{fail('K03_PAN520_SOURCE_BINDING_DENIED');}
}
export async function loadPan520O2cSourceV1(options){
  plain(options,['sourceRoot']);const {sourceRoot}=options;
  if(typeof sourceRoot!=='string'||!sourceRoot||!lstatSync(sourceRoot).isDirectory())fail('K03_PAN520_SOURCE_BINDING_DENIED');
  const root=realpathSync(sourceRoot);qualify(root);
  const api=await import(pathToFileURL(resolve(root,binding.entry)).href);qualify(root);
  if(typeof api.capturePan520ProjectionPlan!=='function'||typeof api.executePan520ProjectionRead!=='function')fail('K03_PAN520_SOURCE_BINDING_DENIED');
  const source=freeze({schemaVersion:'kaleidosphere/pan520-o2c-source/v1',producerCommit:binding.producerCommit,producerTree:binding.producerTree,contractSha256:binding.contractSha256,portableAuthority:false});
  sources.set(source,{root,api});return source;
}
export function capturePan520O2cPlanV1(options){
  plain(options,['source','nativeRoot','request','period'],['asOf']);
  const {source,nativeRoot,request,period,asOf=null}=options,held=sources.get(source);
  if(!held||typeof nativeRoot!=='string'||!nativeRoot)fail('K03_PAN520_SOURCE_BINDING_DENIED');
  const p=assertO2cPeriodV1(period);
  plain(request,['schemaVersion','profile','scope','questions']);
  if(request.profile!=='O2C')fail('K03_PAN520_PROFILE_DENIED');
  exactQuestions(request.questions);
  qualify(held.root);
  // This owner constant is the existing native disposable-COMMON owner route,
  // not a caller role, portable grant, or permission for other sources.
  const native=held.api.capturePan520ProjectionPlan({root:nativeRoot,owner:'LOCAL_SYNTHETIC_OWNER',asOf,projection:request});
  const core={schemaVersion:'kaleidosphere/pan520-o2c-plan/v1',source,period:p,asOf,nativePlan:native.plan,proposalOnly:true,effectsProduced:false,portableAuthority:false};
  const plan=freeze({...core,planDigest:hash(canonical(core))}),handle=Object.freeze({});
  plans.set(handle,{plan,source:held,native,nativeRoot,period:p});return {plan,handle};
}
const unavailable=(unit,reason)=>({state:'UNAVAILABLE',value:null,unit,reason});
function resultFromNative(snapshot,period){
  if(snapshot.schemaVersion!=='pansphaira.pan520/projection-snapshot/v1'||snapshot.profile!=='O2C'||snapshot.grain.orderId!=='SO-01'||snapshot.grain.lineId!=='1'||snapshot.readOnly!==true||snapshot.rights.portableGrant!==false||snapshot.productiveAuthority!==false||snapshot.provenance.nativeOperationalDateIsBusinessAcceptance!==false||snapshot.provenance.declaredReferenceTimeIsNativeBusinessEvent!==false)fail('K03_PAN520_SNAPSHOT_DENIED');
  const {projectionDigest,...preimage}=snapshot;
  if(hash(canonical(preimage))!==projectionDigest)fail('K03_PAN520_SNAPSHOT_DENIED');
  const facts=structuredClone(snapshot.facts);
  for(const f of Object.values(facts)){
    if(!['KNOWN','UNAVAILABLE'].includes(f.state)||typeof f.unit!=='string'||(f.state==='UNAVAILABLE'&&(f.value!==null||typeof f.reason!=='string'))||typeof f.value==='number'&&!Number.isSafeInteger(f.value))fail('K03_PAN520_SNAPSHOT_DENIED');
  }
  const order=facts.orderQuantity,onTime=facts.onTimeDispatchedQuantity,otif=facts.dispatchPositionOtif;
  if(!order||!onTime||!otif||!facts.billedNetMinor||!facts.billedNetByMonth)fail('K03_PAN520_SNAPSHOT_DENIED');
  const metrics={
    orderIntakeNetMinor:unavailable('EUR_MINOR','MISSING_NATIVE_BUSINESS_ACCEPTANCE_EVENT'),
    onTimeDispatchQuantityPercent:order.state==='KNOWN'&&onTime.state==='KNOWN'&&Number.isSafeInteger(order.value)&&order.value>0&&Number.isSafeInteger(onTime.value)&&onTime.value>=0&&onTime.value<=order.value?{state:'KNOWN',value:onTime.value/order.value*100,unit:'PERCENT',basis:'NATIVE_DISPATCH_QUANTITY_OVER_NATIVE_ORDER_QUANTITY'}:unavailable('PERCENT',onTime.reason??order.reason??'MISSING_NATIVE_QUANTITY'),
    dispatchPositionOtifPercent:otif.state==='KNOWN'&&typeof otif.value==='boolean'?{state:'KNOWN',value:otif.value?100:0,unit:'PERCENT',basis:'SINGLE_NATIVE_ORDER_POSITION_ORIGINAL_DISPATCH_PROMISE'}:unavailable('PERCENT',otif.reason??'MISSING_NATIVE_DISPATCH_OTIF'),
    customerReceiptOtifPercent:unavailable('PERCENT',facts.customerReceiptOnTimeQuantity?.reason??'MISSING_CUSTOMER_RECEIPT_EVIDENCE')
  };
  const rows=Object.entries({...facts,...metrics}).map(([fact,f])=>({fact,...f}));
  const csvCell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
  const csv=[['fact','state','value','unit','reason','basis'],...rows.map(r=>[r.fact,r.state,r.value,r.unit,r.reason??'',r.basis??''])].map(row=>row.map(csvCell).join(',')).join('\n')+'\n';
  const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
  // Native P06 has no billed-net/monthly invoice facts. Never splice in the
  // separately accepted 500/700 or COMMON 800/100 reference-fixture values.
  if(facts.billedNetMinor.state!=='UNAVAILABLE'||facts.billedNetByMonth.state!=='UNAVAILABLE')fail('K03_PAN520_UNQUALIFIED_BILLING_VERSION_DENIED');
  const bars=rows.filter(r=>r.state==='KNOWN'&&typeof r.value==='number'&&['STK','PERCENT'].includes(r.unit));
  const plotHeight=100+bars.length*36;
  const plot=bars.map((r,i)=>{
    const domain=r.unit==='PERCENT'?100:Math.max(1,facts.orderQuantity.value);
    return '<g><text x="12" y="'+(68+i*36)+'">'+esc(r.fact+': '+r.value+' '+r.unit)+'</text><rect data-fact="'+esc(r.fact)+'" data-value="'+r.value+'" data-unit="'+esc(r.unit)+'" x="440" y="'+(52+i*36)+'" width="'+(400*r.value/domain)+'" height="22" fill="#147d92"/></g>';
  }).join('');
  const chart={schemaVersion:'kaleidosphere/pan520-o2c-chart/v1',rows:structuredClone(rows),bars:structuredClone(bars),billedNetSeries:[],billedNetState:'UNAVAILABLE',billedNetReason:facts.billedNetByMonth.reason,
    svg:'<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="'+(plotHeight+110+rows.length*22)+'" role="img"><title>Native P06 O2C facts; not invoice-period billing</title><text x="12" y="24">Known native quantity / dispatch measures; no invoice-date series</text>'+plot+rows.map((r,i)=>'<text x="12" y="'+(plotHeight+28+i*22)+'">'+esc(r.fact+': '+r.state+' '+(r.value===null?'—':r.value)+' '+r.unit+(r.reason?' '+r.reason:''))+'</text>').join('')+'<text x="12" y="'+(plotHeight+62+rows.length*22)+'">Native snapshot, not requested-period intake/billing. Missing bills and receipt facts remain unavailable.</text></svg>'};
  return freeze({schemaVersion:'kaleidosphere/pan520-o2c-consumer/v1',outcome:'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',facts,metrics,
    requestedPeriod:period,periodApplication:'NATIVE_SNAPSHOT_NOT_INVOICE_PERIOD_AGGREGATE_NO_PERIOD_START_FILTER',nativeAsOf:snapshot.snapshot.asOf,
    table:{rows:structuredClone(rows)},chart,drilldown:{kind:'PERMITTED_SCOPED_FACT_LINEAGE_NOT_RAW_DOCUMENT_ACCESS',rows:structuredClone(rows),grain:structuredClone(snapshot.grain),sourceSnapshot:structuredClone(snapshot.snapshot),questionDependencies:structuredClone(snapshot.questionDependencies),rawBillingDocuments:'UNAVAILABLE'},export:{rows:structuredClone(rows),csv},
    pair:{producerCommit:binding.producerCommit,producerTree:binding.producerTree,contractSha256:binding.contractSha256,projectionDigest,sourceSnapshot:structuredClone(snapshot.snapshot),rights:structuredClone(snapshot.rights),nativeProvenance:structuredClone(snapshot.provenance),syntheticOnly:true,readOnly:true,portableAuthority:false,sourceOperationsExpanded:false},
    operationAuthority:'CURRENT_NATIVE_OPAQUE_READ_AT_USE_DISPOSABLE_COMMON_SCOPED_FACT_VIEWS_ONLY'});
}
export function executePan520O2cReadV1(options){
  try {
    plain(options,['plan','handle']);const {plan,handle}=options,held=plans.get(handle);
    if(!held||held.plan!==plan)fail('K03_PAN520_OPAQUE_PLAN_REQUIRED_DENIED');
    qualify(held.source.root);
    const snapshot=held.source.api.executePan520ProjectionRead({root:held.nativeRoot,plan:held.native.plan,handle:held.native.handle});
    qualify(held.source.root);return resultFromNative(snapshot,held.period);
  }catch(error){const message=String(error.message),reasonCode=/^(K03_|PAN)[A-Z0-9_]{1,120}$/.test(message)?message:'K03_PAN520_ENTRY_DENIED';return {outcome:'DENIED',reasonCode,table:null,chart:null,drilldown:null,export:null,partialSuccess:false};}
}
