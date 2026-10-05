// Read-only compatibility for the existing narrow M3 contract. No extra M3 kinds.
import {types} from 'node:util';
import {BESTAND_SCHEMA_V1,bestandslageBerechnenV1,verifyBestandslageDigestV1} from '../../../../dependencies/pansphaira/dist/packages/contracts/src/bestand-nachschub-v1.js';
function fail(){throw new Error('K05_NARROW_STOCK_SOURCE_DENIED');}
function json(value,depth=0,seen=new Set()){
 if(depth>8)fail();if(value===null||typeof value==='string'&&value.length<=1024||Number.isSafeInteger(value))return;
 if(typeof value!=='object'||types.isProxy(value)||seen.has(value))fail();
 const array=Array.isArray(value),d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
 if(Object.getPrototypeOf(value)!==(array?Array.prototype:Object.prototype)||keys.some(k=>typeof k!=='string'||!('value'in d[k])||k!=='length'&&!d[k].enumerable))fail();
 if(array&&(d.length.value>32||keys.length!==d.length.value+1||keys.some(k=>k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=d.length.value))))fail();
 seen.add(value);for(const k of keys)if(!array||k!=='length')json(d[k].value,depth+1,seen);seen.delete(value);
}
function record(v,keys){if(!v||Array.isArray(v)||Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
const unknown=reason=>({state:'UNKNOWN',value:null,reason});
export function projectNarrowM3StockV1(data,{asOf}){
 json(data);record(data,['schemaVersion','id','revision','asOf','legacyStock']);
 if(data.schemaVersion!=='kaleidosphere/narrow-m3-stock-source/v1'||data.id!=='K05-HISTORICAL-NARROW-M3'||data.revision!==1||typeof asOf!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(asOf)||!Number.isFinite(Date.parse(asOf))||new Date(asOf).toISOString().replace('.000Z','Z')!==asOf||data.asOf!==asOf)fail();
 const s=data.legacyStock;record(s,['schemaVersion','positions','verlauf','lageDigest']);
 if(s.schemaVersion!==BESTAND_SCHEMA_V1||!Array.isArray(s.positions)||s.positions.length!==1||!Array.isArray(s.verlauf)||s.verlauf.length!==0||!verifyBestandslageDigestV1(s))fail();
 const p=s.positions[0];record(p,['artikelId','lagerortId','einheit','physisch','reserviert','herkunft']);
 if(p.artikelId!=='SYN-ART-A01'||p.lagerortId!=='LAGER-01'||p.einheit!=='STK'||p.herkunft?.beobachtetAm!==asOf)fail();
 const checked=bestandslageBerechnenV1(s.positions);if(checked.outcome!=='LAGE'||checked.lage.lageDigest!==s.lageDigest)fail();
 // A retained combined reservation number cannot prove an independent quarantine
 // bucket, a reservation event or the disjoint free quantity required by K05.
 const absent='NARROW_M3_HAS_NO_DISTINCT_BLOCKING_OR_RESERVATION_EVENT_EVIDENCE';
 return {schemaVersion:'kaleidosphere/narrow-m3-stock-analysis/v1',outcome:'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',asOf,
  stockFacts:{physical:{state:'KNOWN',value:p.physisch,unit:'STK',basis:'DECLARED_SYNTHETIC_M3_OBSERVATION_NOT_NATIVE_EVENT'},reserved:unknown(absent),blocked:unknown(absent),free:unknown(absent)},
  shortage:unknown('MISSING_TIME_BOUND_COMMITMENT_OR_EXPECTED_ARRIVAL_PROVENANCE'),stockRunwayDays:unknown('MISSING_QUALIFIED_CONSUMPTION_HISTORY'),stockValueMinor:unknown('MISSING_QUALIFIED_VALUATION_PROFILE'),
  source:{id:data.id,revision:data.revision,syntheticOnly:true,nativeEvidence:false,legacyDigest:s.lageDigest},legacyProfileExpanded:false,mutationAuthority:false};
}
