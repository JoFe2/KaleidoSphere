// Bounded declared synthetic deadline projection, never a native grant.
import {types} from 'node:util';
function fail(){throw new Error('K05_DEADLINE_INPUT_DENIED');}
function json(v,depth=0,seen=new Set()){
 if(depth>12)fail();if(v===null||typeof v==='string'&&v.length<=1024||typeof v==='boolean'||Number.isSafeInteger(v))return;
 if(typeof v!=='object'||types.isProxy(v)||seen.has(v))fail();
 const array=Array.isArray(v),d=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(d);
 if(Object.getPrototypeOf(v)!==(array?Array.prototype:Object.prototype)||keys.some(k=>typeof k!=='string'||!('value'in d[k])||k!=='length'&&!d[k].enumerable))fail();
 if(array&&(d.length.value>128||keys.length!==d.length.value+1||keys.some(k=>k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=d.length.value))))fail();
 seen.add(v);for(const k of keys)if(!array||k!=='length')json(d[k].value,depth+1,seen);seen.delete(v);
}
function record(v,keys){if(!v||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
const quantity=v=>{if(!Number.isSafeInteger(v)||v<0||v>1000000)fail();return BigInt(v);};
function instant(v){
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)!==v.slice(0,10))fail();return Date.parse(v);
}
const unknown=reason=>({state:'UNKNOWN',value:null,reason,rows:[]});
export function projectStockDeadlineV1(data,{asOf}){
 json(data);record(data,['schemaVersion','id','revision','scope','stock','stockProvenance','coverage','commitments','expectedArrivals','consumptionHistory','valuationProfile']);
 const cutoff=instant(asOf);if(data.schemaVersion!=='kaleidosphere/stock-deadline-source/v1'||!Number.isSafeInteger(data.revision)||data.revision<1)fail();
 const expected={source_id:'SYN-K05-DEADLINE',tenant_id:'SYN-TENANT-01',entity_id:'SYN-ENTITY-01',warehouse_id:'WH-01',item_id:'ARTICLE-A',currency:'EUR',quantity_unit:'STK'};
 record(data.scope,Object.keys(expected));if(Object.keys(expected).some(k=>data.scope[k]!==expected[k]))fail();
 record(data.stock,['asOf','physical','reserved','blocked','free','reservationProvenance']);const stock=structuredClone(data.stock);
 if(instant(stock.asOf)!==cutoff||stock.reservationProvenance!=='EXPLICIT_SYNTHETIC_SCENARIO_ASSUMPTION_NOT_EVENT_EVIDENCE')fail();
 const physical=quantity(stock.physical),reserved=quantity(stock.reserved),blocked=quantity(stock.blocked),free=quantity(stock.free);
 if(physical-reserved-blocked!==free)fail();
 const p=data.stockProvenance,c=data.coverage;
 let shortage;
 if(p===null||c===null||data.commitments===null||data.expectedArrivals===null)shortage=unknown('MISSING_DECLARED_STOCK_COMMITMENT_OR_ARRIVAL_PROVENANCE');
 else{
  record(p,['profile','revision','asOf','disjointReservedAndBlocked']);record(c,['commitments','arrivals']);
  if(p.profile!=='K05_DECLARED_SYNTHETIC_STOCK_SCENARIO_V1'||p.revision!==data.revision||instant(p.asOf)!==cutoff||p.disjointReservedAndBlocked!==true||c.commitments!=='COMPLETE_DECLARED_SYNTHETIC_SET'||c.arrivals!=='COMPLETE_DECLARED_SYNTHETIC_SET')shortage=unknown('INCOMPLETE_OR_NON_DISJOINT_SOURCE_PROVENANCE');
  else{
   if(!Array.isArray(data.commitments)||!Array.isArray(data.expectedArrivals))fail();
   const ids=new Set(),safeId=v=>{if(typeof v!=='string'||!v.length||v.length>128||ids.has(v))fail();ids.add(v);};
   let missing=false;
   for(const d of data.commitments){record(d,['id','quantity','reservedQuantity','acceptedAt','dueAt','sourceReference']);safeId(d.id);if(quantity(d.reservedQuantity)>quantity(d.quantity))fail();if(d.sourceReference===null||d.acceptedAt===null||d.dueAt===null){missing=true;continue;}if(typeof d.sourceReference!=='string'||!d.sourceReference.length)fail();if(instant(d.acceptedAt)>cutoff||instant(d.dueAt)<cutoff)missing=true;}
   for(const a of data.expectedArrivals){record(a,['id','quantity','knownAt','availableAt','sourceReference']);safeId(a.id);quantity(a.quantity);if(a.sourceReference===null||a.knownAt===null||a.availableAt===null){missing=true;continue;}if(typeof a.sourceReference!=='string'||!a.sourceReference.length)fail();if(instant(a.knownAt)>cutoff||instant(a.availableAt)<=cutoff)missing=true;}
   const allocated=data.commitments.reduce((sum,d)=>sum+quantity(d.reservedQuantity),0n);
   if(missing||allocated!==reserved)shortage=unknown('MISSING_DATED_SOURCE_OR_COMPLETE_RESERVED_COMMITMENT_ASSIGNMENT');
   else{
    const demand=[...data.commitments].sort((a,b)=>instant(a.dueAt)-instant(b.dueAt)||a.id.localeCompare(b.id)),arrivals=[...data.expectedArrivals].sort((a,b)=>instant(a.availableAt)-instant(b.availableAt)||a.id.localeCompare(b.id));
    let pool=free,backlog=0n,index=0,total=0n;const rows=[];
    for(const d of demand){
     const used=[];while(index<arrivals.length&&instant(arrivals[index].availableAt)<=instant(d.dueAt)){const a=arrivals[index++];pool+=quantity(a.quantity);used.push(a.id);}
     const oldCoverage=pool<backlog?pool:backlog;pool-=oldCoverage;backlog-=oldCoverage;
     const needed=quantity(d.quantity)-quantity(d.reservedQuantity),available=pool<needed?pool:needed;pool-=available;const missingQty=needed-available;backlog+=missingQty;total+=missingQty;
     rows.push({id:d.id,dueAt:d.dueAt,quantity:d.quantity,reservedCoverage:d.reservedQuantity,availableCoverage:Number(available),missing:Number(missingQty),onTimeArrivalIds:used,sourceReference:d.sourceReference});
    }
    if(total>BigInt(Number.MAX_SAFE_INTEGER))fail();shortage={state:'KNOWN',value:Number(total),unit:'STK',basis:'DECLARED_COMMITMENT_DEADLINES_AND_ON_TIME_SYNTHETIC_ARRIVAL_FORECAST_NOT_TODAYS_BALANCE',rows};
   }
  }
 }
 return {schemaVersion:'kaleidosphere/stock-deadline-analysis/v1',outcome:'COMPLETE',asOf,stock,shortage,stockRunwayDays:unknown('MISSING_QUALIFIED_CONSUMPTION_HISTORY'),stockValueMinor:unknown('MISSING_QUALIFIED_VALUATION_PROFILE'),source:{id:data.id,revision:data.revision,scope:structuredClone(data.scope),syntheticOnly:true,nativeEvidence:false},mutationAuthority:false};
}
