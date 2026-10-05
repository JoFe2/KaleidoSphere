import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {nativeCommonPairFixture} from './fixtures/business-bi/pan520-native-pair.mjs';
const sourceRoot=process.env.KS285_PAN520_SOURCE;
assert.ok(sourceRoot,'Exact existing native PAN520 source is required; no stub or skip.');
const root=resolve(sourceRoot),url=p=>pathToFileURL(resolve(root,p)).href;
const {nativeRows}=await import(url('tests/fixtures/pan515/native-trade-fixture.mjs'));
let ks=null;try{ks=await import('../services/bi-control/src/business-bi/pan520-stock-consumer.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const request=()=>({schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'STOCK',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['STOCK_POSITION','STOCK_RUNWAY','STOCK_VALUE']});
const june='2026-06-30T23:59:59+02:00';
test('K05 actual native June STOCK snapshot crosses the product consumer with visible source-event provenance and identical read-only SQL',async()=>{
 const f=await nativeCommonPairFixture(root);
 try{
  const before=f.rows(),native=f.trade.readPan515TradeState({root:f.root,asOf:june,projection:request()});
  assert.equal(typeof ks?.loadPan520StockSourceV1,'function','Missing K05 actual stock consumer over existing qualified native producer');
  const source=await ks.loadPan520StockSourceV1({sourceRoot:root});
  const held=ks.capturePan520StockPlanV1({source,nativeRoot:f.root,request:request(),asOf:june});
  assert.equal(held.plan.effectsProduced,false);
  const result=ks.executePan520StockReadV1(held);
  assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);
  assert.deepEqual(result.facts,native.facts);
  assert.deepEqual(['physical','reserved','quarantined','free'].map(k=>result.facts[k].value),[2,2,0,0]);
  assert.equal(result.facts.stockRunwayDays.value,null);assert.equal(result.facts.stockValueMinor.value,null);
  assert.equal(result.pair.projectionDigest,native.projectionDigest);
  assert.deepEqual(result.reservationProvenance.nativeEventDigests,native.provenance.nativeEventDigests);
  assert.equal(result.reservationProvenance.basis,'ACTUAL_NATIVE_PAN515_EVENT_STOCK_READBACK');
  assert.deepEqual(f.rows(),before);
  assert.ok(nativeRows(f.root,'SELECT event FROM pan515_events ORDER BY revision').some(r=>JSON.parse(r.event).kind==='RESERVE'));
 }finally{f.close();}
});

test('K05 actual public native stock CLI emits the July quarantined return and preserves the June cutoff without altering native rows',async()=>{
 const f=await nativeCommonPairFixture(root);
 try{
  f.finishLate();const command={schemaVersion:'pansphaira.pan517/fulfilment-command/v1',effectId:'RT-01',transportId:'synthetic:ks287-return',expectedRevision:10,orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',unit:'STK',kind:'RETURN_RECEIPT',quantity:1,referenceId:'SH-01',physicalEvidenceId:'EV-03',effectiveAt:'2026-07-05T14:00:00+02:00',reason:'Actual disposable K05 COMMON return'};
  f.trade.executePan515TradeCommand({root:f.root,command,grant:f.trade.authorizePan515TradeCommand({root:f.root,command,owner:'LOCAL_SYNTHETIC_OWNER'})});
  const before=f.rows();
  for(const [asOf,expected] of [[june,[2,2,0,0]],['2026-07-31T23:59:59+02:00',[1,0,1,0]]]){
   const p=spawnSync(process.execPath,['scripts/run-stock-analysis.mjs','--producer-source',root,'--native-root',f.root,'--as-of',asOf],{encoding:'utf8',timeout:10000});
   assert.equal(p.status,0,p.stdout+p.stderr);const result=JSON.parse(p.stdout),native=f.trade.readPan515TradeState({root:f.root,asOf,projection:request()});
   assert.deepEqual(['physical','reserved','quarantined','free'].map(k=>result.facts[k].value),expected);assert.deepEqual(result.facts,native.facts);assert.equal(result.asOf,asOf);
  }
  assert.deepEqual(f.rows(),before);
 }finally{f.close();}
});


test('K05 native stock opaque handles and foreign scope deny without changing actual rows',async()=>{
 const f=await nativeCommonPairFixture(root);try{
  const source=await ks.loadPan520StockSourceV1({sourceRoot:root}),before=f.rows();
  for(const [key,value] of [['orderId','SO-FOREIGN'],['warehouseId','WH-FOREIGN'],['unit','KG'],['currency','USD']]){const q=request();q.scope[key]=value;assert.throws(()=>ks.capturePan520StockPlanV1({source,nativeRoot:f.root,request:q,asOf:june}),/COMPOSITE_SOURCE_GRAIN_DENIED/);}
  assert.throws(()=>ks.capturePan520StockPlanV1({source:structuredClone(source),nativeRoot:f.root,request:request(),asOf:june}),/SOURCE_BINDING_DENIED/);
  const p=ks.capturePan520StockPlanV1({source,nativeRoot:f.root,request:request(),asOf:june});
  for(const options of [{plan:structuredClone(p.plan),handle:p.handle},{plan:p.plan,handle:{}}]){const r=ks.executePan520StockReadV1(options);assert.equal(r.outcome,'DENIED');assert.equal(r.partialSuccess,false);assert.equal(r.table,null);assert.equal(r.export,null);}
  assert.deepEqual(f.rows(),before);
 }finally{f.close();}
});
test('K05 native use-time STOCK revoke denies a previously captured plan and CLI without altering native rows',async()=>{
 const f=await nativeCommonPairFixture(root);try{
  const source=await ks.loadPan520StockSourceV1({sourceRoot:root}),p=ks.capturePan520StockPlanV1({source,nativeRoot:f.root,request:request(),asOf:june}),native=f.trade.readPan515TradeState({root:f.root,asOf:june,projection:request()});
  const {scopeProfile}=await import(url('src/pan473/scope-profile.mjs')),{recordLocalJournalControl}=await import(url('demo/runtime/local-journal-owner.mjs'));
  const {marker}=scopeProfile(f.root);recordLocalJournalControl(resolve(f.root,'pan453-owned-v2'),{kind:'REVOKE',sourceIdentity:marker.sourceIdentity,targetIdentity:marker.targetIdentity,operationKey:native.rights.operationKey,stopEpoch:1,issuedAtMs:Date.now(),reason:'Disposable K05 STOCK read revoked'});
  const before=f.rows(),r=ks.executePan520StockReadV1(p);assert.equal(r.outcome,'DENIED');assert.match(r.reasonCode,/STOP_OR_REVOKE_DENIED$/);assert.equal(r.table,null);assert.equal(r.export,null);
  const cli=spawnSync(process.execPath,['scripts/run-stock-analysis.mjs','--producer-source',root,'--native-root',f.root,'--as-of',june],{encoding:'utf8',timeout:10000});assert.equal(cli.status,1);assert.match(JSON.parse(cli.stdout).reasonCode,/STOP_OR_REVOKE_DENIED$/);assert.deepEqual(f.rows(),before);
 }finally{f.close();}
});

test('K05 native consumer exposes explicit unknown history/value and a same-cutoff blocked alias without rewriting the producer snapshot',async()=>{
 const f=await nativeCommonPairFixture(root);try{const source=await ks.loadPan520StockSourceV1({sourceRoot:root}),r=ks.executePan520StockReadV1(ks.capturePan520StockPlanV1({source,nativeRoot:f.root,request:request(),asOf:june}));
  for(const key of ['stockRunwayDays','stockValueMinor']){assert.equal(r[key]?.state,'UNKNOWN');assert.equal(r[key]?.value,null);}
  assert.deepEqual(r.stock,{asOf:june,physical:2,reserved:2,blocked:0,free:0});assert.equal(r.facts.stockValueMinor.state,'UNAVAILABLE');
 }finally{f.close();}
});
