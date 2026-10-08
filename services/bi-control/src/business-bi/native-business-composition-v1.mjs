// Closed synthetic COMMON read composition over existing immutable native consumers.
// Activation is client-session state only, never a native write/portable grant.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {canonicalJson} from '../canonical-json.js';
import {assertO2cPeriodV1} from './invoice-date-o2c.mjs';
import {loadPan520O2cSourceV1,capturePan520O2cPlanV1,executePan520O2cReadV1} from './pan520-o2c-consumer.mjs';
import {loadPan520P2pSourceV1,capturePan520P2pPlanV1,executePan520P2pReadV1} from './pan520-p2p-consumer.mjs';
import {loadPan520StockSourceV1,capturePan520StockPlanV1,executePan520StockReadV1} from './pan520-stock-consumer.mjs';
const scope={sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'};
const request=(profile,orderId,questions)=>({schemaVersion:'pansphaira.pan520/projection-request/v1',profile,scope:{...scope,orderId},questions});
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
export async function createNativeBusinessCompositionV1(options){
 if(!options||typeof options!=='object'||types.isProxy(options)||Object.getPrototypeOf(options)!==Object.prototype)throw new Error('KS281_INPUT_DENIED');
 const fields=Object.getOwnPropertyDescriptors(options),keys=['sourceRoot','nativeRoot','asOf','period'];
 if(Reflect.ownKeys(fields).length!==keys.length||Reflect.ownKeys(fields).some(key=>typeof key!=='string'||!keys.includes(key))||Object.values(fields).some(field=>!field.enumerable||!('value' in field)))throw new Error('KS281_INPUT_DENIED');
 const {sourceRoot,nativeRoot,asOf}=options,rawPeriod=options.period;
 if(!rawPeriod||typeof rawPeriod!=='object'||types.isProxy(rawPeriod)||Object.getPrototypeOf(rawPeriod)!==Object.prototype)throw new Error('KS281_INPUT_DENIED');
 const dates=Object.getOwnPropertyDescriptors(rawPeriod);
 if(Reflect.ownKeys(dates).length!==2||!Object.hasOwn(dates,'start')||!Object.hasOwn(dates,'end')||Object.values(dates).some(field=>!field.enumerable||!('value' in field)))throw new Error('KS281_INPUT_DENIED');
 const period=assertO2cPeriodV1({start:dates.start.value,end:dates.end.value});
 const source={o2c:await loadPan520O2cSourceV1({sourceRoot}),p2p:await loadPan520P2pSourceV1({sourceRoot}),stock:await loadPan520StockSourceV1({sourceRoot})};
 const plans={o2c:capturePan520O2cPlanV1({source:source.o2c,nativeRoot,asOf,period,request:request('O2C','SO-01',['ORDER_SOURCE','DISPATCH_TIMELINESS','CUSTOMER_RECEIPT_TIMELINESS','BILLED_NET'])}),p2p:capturePan520P2pPlanV1({source:source.p2p,nativeRoot,asOf,request:request('P2P','PO-01',['PROCUREMENT_QUANTITY','PROCUREMENT_PRICE_VARIANCE','PROCUREMENT_TIMELINESS'])}),stock:capturePan520StockPlanV1({source:source.stock,nativeRoot,asOf,request:request('STOCK','SO-01',['STOCK_POSITION','STOCK_RUNWAY','STOCK_VALUE'])})};
 let previous=null;
 return Object.freeze({read(){
  const components={o2c:executePan520O2cReadV1(plans.o2c),p2p:executePan520P2pReadV1(plans.p2p),stock:executePan520StockReadV1(plans.stock)};
  const refused=Object.values(components).find(result=>result.outcome!=='READ_COMPLETE_WITH_UNAVAILABLE_FACTS');
  if(refused)return Object.freeze({schema:'kaleidosphere/native-business-composition/v1',outcome:'DENIED',reasonCode:refused.reasonCode,components:null,sharedSnapshot:null,stateVersion:previous?.stateVersion??0,previousQualifiedHeld:previous!==null,readOnly:true,persistentMutation:false,partialSuccess:false});
  const sharedKeys=['asOf','bindingDigest','nativeEventSetDigest','nativeRevision'];
  const shared=components.o2c.pair.sourceSnapshot;
  if(Object.values(components).some(result=>sharedKeys.some(key=>!Object.hasOwn(result.pair.sourceSnapshot,key)||result.pair.sourceSnapshot[key]!==shared[key])))return Object.freeze({schema:'kaleidosphere/native-business-composition/v1',outcome:'DENIED',reasonCode:'KS281_SHARED_SNAPSHOT_DRIFT_DENIED',components:null,sharedSnapshot:null,stateVersion:previous?.stateVersion??0,previousQualifiedHeld:previous!==null,readOnly:true,persistentMutation:false,partialSuccess:false});
  const content={schema:'kaleidosphere/native-business-composition/v1',outcome:'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',sharedSnapshot:{...components.o2c.pair.sourceSnapshot},components,readOnly:true,persistentMutation:false,portableAuthority:false,sourceOperationsExpanded:false,consistency:'MATCHED_SHARED_READBACK_NOT_ATOMIC_SQL_TRANSACTION'};
  const resultDigest=createHash('sha256').update(canonicalJson(content)).digest('hex');
  if(previous?.resultDigest===resultDigest)return previous;
  previous=frozen({...content,resultDigest,stateVersion:(previous?.stateVersion??0)+1});return previous;
 }});
}
