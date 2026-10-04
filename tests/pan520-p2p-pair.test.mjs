import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
const sourceRoot=process.env.KS286_PAN520_SOURCE;
async function consumer(){
 let c;try{c=await import('../services/bi-control/src/business-bi/pan520-p2p-consumer.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
 assert.equal(typeof c?.loadPan520P2pSourceV1,'function','Actual K04 P06 P2P consumer adapter is missing');
 assert.equal(typeof sourceRoot,'string','KS286_PAN520_SOURCE must name the actual frozen public producer; no stub or skip');return c;
}
async function fixture(options){const {nativeProcurementPairFixture}=await import('./fixtures/business-bi/pan520-native-procurement-pair.mjs');return nativeProcurementPairFixture(sourceRoot,options);}

test('K04 actual CLI executes real producer P2P price/quantity/time, exports the same values and denies revoked read',async()=>{
 const c=await consumer(),f=await fixture();try{
  const args=['scripts/run-procurement-analysis.mjs','--producer-source',sourceRoot,'--native-root',f.root],run=extra=>spawnSync(process.execPath,[...args,...extra],{encoding:'utf8',timeout:10000,maxBuffer:1000000});
  const before=f.rows(),p=run([]);assert.equal(p.status,0,p.stderr+' '+p.stdout);const r=JSON.parse(p.stdout);assert.equal(r.outcome,'COMPLETE');assert.equal(r.lines[0].price.varianceMinor,2000);assert.equal(r.lines[0].timing.onTimeAccepted,8);assert.equal(r.pair.producerCommit,'cf199bbd35706bdeadb04679af7354c94caf482a');
  const csv=run(['--view','export']);assert.equal(csv.status,0);assert.equal(csv.stdout,r.export.csv);assert.deepEqual(f.rows(),before);
  f.revoke();const denied=run([]);assert.equal(denied.status,1);const d=JSON.parse(denied.stdout);assert.equal(d.outcome,'DENIED');assert.match(d.reasonCode,/STOP_OR_REVOKE_DENIED$/);assert.equal(d.table,null);assert.equal(d.partialSuccess,false);
 }finally{f.close();}
});


test('K04 real P06 cutoff shows8 accepted/on-time but never invents missing invoice business date',async()=>{
 const c=await consumer(),f=await fixture();try{
  const r=c.executePan520P2pReadV1(c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,asOf:'2026-06-25T23:59:59+02:00',request:request()}));
  assert.equal(r.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS');assert.equal(r.lines[0].quantity.accepted,8);assert.equal(r.lines[0].timing.onTimeAccepted,8);
  assert.equal(r.lines[0].price.status,'UNKNOWN');assert.equal(r.lines[0].price.reason,'MISSING_NATIVE_INVOICE_BUSINESS_DATE_FOR_HISTORICAL_PRICE_QUESTION');assert.equal(r.pair.receiptFacts.length,1);
 }finally{f.close();}
});
test('K04 real use-time revoke denies all result surfaces after a valid captured P2P plan',async()=>{
 const c=await consumer(),f=await fixture();try{
  const p=c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:request()});f.revoke();const before=f.rows(),r=c.executePan520P2pReadV1(p);
  assert.equal(r.outcome,'DENIED');assert.match(r.reasonCode,/STOP_OR_REVOKE_DENIED$/);for(const k of ['table','chart','drilldown','export'])assert.equal(r[k],null);assert.equal(r.partialSuccess,false);assert.deepEqual(f.rows(),before);
 }finally{f.close();}
});
test('K04 real native request refuses foreign PO/unit/currency, SQL and caller roles instead of treating metadata as rights',async()=>{
 const c=await consumer(),f=await fixture();try{
  const before=f.rows();for(const [field,value] of [['orderId','PO-FOREIGN'],['unit','KG'],['currency','USD'],['tenantId','FOREIGN']]){const q=request();q.scope[field]=value;assert.throws(()=>c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:q}),/COMPOSITE_SOURCE_GRAIN_DENIED/);}
  const q=request();q.sql='SELECT * FROM private';assert.throws(()=>c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:q}),/REQUEST_DENIED/);
  assert.throws(()=>c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:request(),role:'OWNER'}),/REQUEST_DENIED/);assert.deepEqual(f.rows(),before);
 }finally{f.close();}
});
test('K04 cloned source/plan/handle metadata cannot carry real native projection authority',async()=>{
 const c=await consumer(),f=await fixture();try{
  assert.throws(()=>c.capturePan520P2pPlanV1({source:structuredClone(f.source),nativeRoot:f.root,request:request()}),/SOURCE_BINDING_DENIED/);
  const p=c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:request()});
  for(const clone of [{plan:structuredClone(p.plan),handle:p.handle},{plan:p.plan,handle:{}}]){const r=c.executePan520P2pReadV1(clone);assert.equal(r.outcome,'DENIED');assert.equal(r.reasonCode,'K04_PAN520_OPAQUE_PLAN_REQUIRED_DENIED');assert.equal(r.table,null);}
 }finally{f.close();}
});
test('K04 later native supplier promise does not rewrite receipt-assigned revision or old timeliness; only price dependency changes',async()=>{
 const c=await consumer(),f=await fixture();try{
  const p=c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:request()}),before=f.trade.readPan515TradeState({root:f.root,projection:request()}),purchase=f.purchase.readPan516Procurement({root:f.root});
  f.apply({...f.command('CONFIRM',purchase.revision,'later-promise'),confirmation:{revision:2,previousConfirmationDigest:purchase.confirmations[0].confirmationDigest,terms:{...f.terms,promisedAt:'2026-06-27T23:59:59+02:00'},confirmedAt:'2026-06-27T10:00:00Z'}});
  // Producer plans bind source/control/request, not an old business snapshot.
  // Fresh read under unchanged current rights is valid and must expose new dependencies.
  assert.equal(c.executePan520P2pReadV1(p).outcome,'COMPLETE');
  const after=f.trade.readPan515TradeState({root:f.root,projection:request()}),r=c.executePan520P2pReadV1(c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:request()}));
  assert.equal(r.outcome,'COMPLETE');assert.equal(r.lines[0].timing.onTimeAccepted,8);assert.equal(r.lines[0].price.varianceMinor,2000);assert.deepEqual(r.pair.receiptFacts.map(x=>x.promiseRevision),[1,1]);
  for(const key of ['PROCUREMENT_QUANTITY','PROCUREMENT_TIMELINESS'])assert.equal(after.questionDependencies[key],before.questionDependencies[key]);assert.notEqual(after.questionDependencies.PROCUREMENT_PRICE_VARIANCE,before.questionDependencies.PROCUREMENT_PRICE_VARIANCE);
 }finally{f.close();}
});

function request(){return {schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'P2P',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'PO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['PROCUREMENT_QUANTITY','PROCUREMENT_PRICE_VARIANCE','PROCUREMENT_TIMELINESS']};}

test('K04 actual unconfirmed P06 quantity works while native price/time remain unavailable',async()=>{
 const c=await consumer(),f=await fixture({confirmed:false});try{
  const before=f.rows(),r=c.executePan520P2pReadV1(c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:request()}));
  assert.equal(r.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',r.reasonCode);const l=r.lines[0];assert.equal(l.quantity.status,'KNOWN');assert.equal(l.quantity.accepted,10);
  assert.equal(l.quantity.invoiced,null);assert.equal(l.quantity.optionalInvoiceFactsStatus,'UNAVAILABLE');
  assert.deepEqual(l.price,{status:'UNKNOWN',expectedNetMinor:null,invoiceNetMinor:null,varianceMinor:null,reason:'MISSING_NATIVE_CONFIRMED_PRICE'});
  assert.equal(l.timing.status,'UNKNOWN');assert.equal(l.timing.onTimeAccepted,null);assert.equal(l.timing.reason,'MISSING_NATIVE_CONFIRMED_PROMISE_AT_RECEIPT');
  assert.equal(r.facts.supplierPriceVarianceMinor.state,'UNAVAILABLE');assert.deepEqual(f.rows(),before);
 }finally{f.close();}
});

test('K04 real P06 P2P two native receipts retain one reused ERV invoice grain and actual2000/8',async()=>{
 const c=await consumer(),f=await fixture();try{
  const before=f.rows(),captured=c.capturePan520P2pPlanV1({source:f.source,nativeRoot:f.root,request:request()});
  const result=c.executePan520P2pReadV1(captured);assert.equal(result.outcome,'COMPLETE',result.reasonCode);const line=result.lines[0];
  assert.deepEqual(line.quantity,{status:'KNOWN',ordered:10,accepted:10,invoiced:10,receivedNotInvoiced:0,invoicedNotReceived:0});
  assert.deepEqual(line.price,{status:'KNOWN',expectedNetMinor:60000,invoiceNetMinor:62000,varianceMinor:2000});
  assert.deepEqual(line.timing,{status:'KNOWN',onTimeAccepted:8,lateAccepted:2,unknownTimeAccepted:0,denominator:10});
  assert.equal(result.pair.nativeProvenance.invoiceGrainCount,1);assert.equal(result.pair.nativeProvenance.liabilityCoreOutcome,'CONFLICT');
  assert.equal(result.pair.nativeProvenance.receiptEventDigests.length,2);assert.equal(result.invoiceMatcherImplemented,false);assert.equal(result.mutationAuthority,false);assert.deepEqual(f.rows(),before);

  assert.deepEqual(result.table.rows,result.chart.rows);assert.deepEqual(result.table.rows,result.export.rows);assert.deepEqual(result.table.rows,result.drilldown.rows);
  assert.equal(result.table.rows.find(r=>r.metric==='varianceMinor').value,2000);assert.equal(result.table.rows.find(r=>r.metric==='onTimeAccepted').value,8);
  assert.match(result.chart.svg,/data-metric="varianceMinor" data-value="2000"/);assert.equal(result.drilldown.rawInvoiceDocumentAccess,false);

 }finally{f.close();}
});
