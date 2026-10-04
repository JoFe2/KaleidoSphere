import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {nativeCommonPairFixture} from './fixtures/business-bi/pan520-native-pair.mjs';

const sourceRoot=process.env.KS285_PAN520_SOURCE;
assert.ok(sourceRoot,'The exact real PAN520 source runtime is required; no producer stub or fixture-only fallback.');
const root=resolve(sourceRoot),url=p=>pathToFileURL(resolve(root,p)).href;
assert.equal(createHash('sha256').update(readFileSync(resolve(root,'contracts/trade/pan520-projection-contract-v1.json'))).digest('hex'),'fcff403d002b1b877a895e0c8c1b4c9532e9785acdc300310e997fe76835f85e');
const {nativeTradeFixture,nativeRows}=await import(url('tests/fixtures/pan515/native-trade-fixture.mjs'));
const trade=await import(url('src/pan515/trade-state.mjs'));
const common=JSON.parse(readFileSync(resolve(root,'contracts/trade/common-trade-01-v1.json')));
let ks=null;
try {ks=await import('../services/bi-control/src/business-bi/pan520-o2c-consumer.mjs');}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const period={start:'2026-06-01',end:'2026-08-01'};
const request=()=>({schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'O2C',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['ORDER_SOURCE','DISPATCH_TIMELINESS','CUSTOMER_RECEIPT_TIMELINESS','BILLED_NET']});
const command=(kind,revision,id,quantity,referenceId=null,extra={})=>({schemaVersion:'pansphaira.pan517/fulfilment-command/v1',effectId:id,transportId:'synthetic:ks285-'+id.toLowerCase(),expectedRevision:revision,orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',unit:'STK',kind,quantity,referenceId,effectiveAt:'2026-06-29T10:00:00Z',reason:'Actual disposable COMMON PAN520 to KS285 pair',...extra});
const apply=(r,c)=>trade.executePan515TradeCommand({root:r,command:c,grant:trade.authorizePan515TradeCommand({root:r,command:c,owner:'LOCAL_SYNTHETIC_OWNER'})});
async function setup(){
  const f=await nativeTradeFixture({common:true});
  try {
    trade.initializePan515TradeState({root:f.root,owner:'LOCAL_SYNTHETIC_OWNER',caseId:common.id});
    apply(f.root,command('PROMISE',0,'PR-01',10,null,{effectiveAt:common.sales_order.accepted_at,promise:{revision:1,kind:'DISPATCH',dueAt:common.sales_order.promised_dispatch_at,previousPromiseDigest:null,sourceReference:'COMMON-TRADE-01.sales_order'}}));
    for(const [i,r] of common.receipts.entries())apply(f.root,{...command('RECEIPT',i+1,r.id,r.accepted_quantity,common.purchase_order.id,{effectiveAt:r.accepted_at,sourceLineId:'1'}),schemaVersion:'pansphaira.pan515/trade-command/v1'});
    apply(f.root,{...command('RESERVE',3,'RS-01',10,null,{effectiveAt:common.reservation_events[0].at}),schemaVersion:'pansphaira.pan515/trade-command/v1'});
    apply(f.root,command('PICK',4,'PK-01',8,'RS-01'));apply(f.root,command('PACK',5,'PA-01',8,'PK-01'));
    apply(f.root,command('ISSUE',6,'SH-01',8,'PA-01',{reservationId:'RS-01',reservationEventId:'RC-01',dispatchNoteId:'DN-01',physicalEvidenceId:'EV-01',promiseRevision:1,effectiveAt:common.shipments[0].dispatched_at}));
    return f;
  }catch(error){f.close();throw error;}
}

test('K03 actual native P06 opaque read crosses into KS without promoting missing bills or native DRAFT order into billed net or accepted intake',async()=>{
  const f=await setup();
  try {
    const before=nativeRows(f.root,'SELECT command,event FROM pan515_events ORDER BY revision');
    const actual=trade.readPan515TradeState({root:f.root,projection:request()});
    assert.equal(actual.facts.billedNetMinor.state,'UNAVAILABLE');
    assert.equal(typeof ks?.loadPan520O2cSourceV1,'function','Missing actual K03 consumer adapter despite a runnable real native P06 counterpart');
    const source=await ks.loadPan520O2cSourceV1({sourceRoot:root});
    const {plan,handle}=ks.capturePan520O2cPlanV1({source,nativeRoot:f.root,request:request(),period});
    const result=ks.executePan520O2cReadV1({plan,handle});
    assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);
    assert.deepEqual(result.facts,actual.facts);
    assert.deepEqual(result.table.rows,result.chart.rows);
    assert.match(result.chart.svg,/<rect[^>]+data-fact="onTimeDispatchQuantityPercent"[^>]+data-value="80"/,'Known native measures require an actual plot, not an SVG text-list substitute');
    assert.doesNotMatch(result.chart.svg,/<rect[^>]+data-fact="billedNet/);
    assert.deepEqual(result.table.rows,result.drilldown.rows);
    assert.deepEqual(result.table.rows,result.export.rows);
    assert.equal(result.pair.projectionDigest,actual.projectionDigest);
    assert.deepEqual(result.pair.rights,actual.rights);
    assert.equal(result.metrics.orderIntakeNetMinor.state,'UNAVAILABLE');
    assert.equal(result.metrics.orderIntakeNetMinor.value,null);
    assert.equal(result.facts.orderSourceNetMinor.value,100000);
    assert.equal(result.metrics.onTimeDispatchQuantityPercent.value,80);
    assert.equal(result.metrics.dispatchPositionOtifPercent.state,'UNAVAILABLE');
    assert.equal(result.facts.customerReceiptOnTimeQuantity.state,'UNAVAILABLE');
    assert.deepEqual(result.chart.billedNetSeries,[]);
    assert.equal(result.pair.producerCommit,'cf199bbd35706bdeadb04679af7354c94caf482a');
    assert.equal(result.pair.producerTree,'e8e75614ffb8f1d71a6715413386bfd5619e1c3e');
    assert.equal(result.pair.syntheticOnly,true);
    assert.deepEqual(nativeRows(f.root,'SELECT command,event FROM pan515_events ORDER BY revision'),before);
  }finally{f.close();}
});

test('K03 rejects caller question-array accessors without evaluating caller code',async()=>{
  const f=await setup();
  try {
    const source=await ks.loadPan520O2cSourceV1({sourceRoot:root});let calls=0;
    const qs=request().questions;Object.defineProperty(qs,'0',{enumerable:true,get(){calls++;return 'ORDER_SOURCE';}});
    assert.throws(()=>ks.capturePan520O2cPlanV1({source,nativeRoot:f.root,request:{...request(),questions:qs},period}),/DENIED/);
    assert.equal(calls,0,'KS must defer no unsafe getter to its pre-validation path');
  }finally{f.close();}
});

function assertDenied(result,reason){
  assert.equal(result.outcome,'DENIED');assert.match(result.reasonCode,reason);
  for(const key of ['table','chart','drilldown','export'])assert.equal(result[key],null,key);
  assert.equal(result.partialSuccess,false);
}
const csvRows=csv=>csv.trimEnd().split('\n').map(line=>line.slice(1,-1).split('\",\"').map(cell=>cell.replaceAll('\"\"','\"')));

test('K03 actual native two late units produce 80 percent original-dispatch quantity and zero position OTIF in table plot fact-lineage and real CSV',async()=>{
  const f=await nativeCommonPairFixture(root);
  try {
    const {plan,handle}=ks.capturePan520O2cPlanV1({source:f.source,nativeRoot:f.root,request:request(),period});
    const partial=ks.executePan520O2cReadV1({plan,handle});assert.equal(partial.facts.totalIssuedQuantity.value,8);
    f.finishLate();const before=f.rows();
    const actual=f.trade.readPan515TradeState({root:f.root,projection:request()});
    const result=ks.executePan520O2cReadV1({plan,handle});
    assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);
    assert.deepEqual(result.facts,actual.facts);assert.equal(result.facts.totalIssuedQuantity.value,10);
    assert.equal(result.metrics.onTimeDispatchQuantityPercent.value,80);assert.equal(result.metrics.dispatchPositionOtifPercent.value,0);
    assert.notEqual(result.pair.projectionDigest,partial.pair.projectionDigest,'Use time must read real updated native events, not a cached fixture result');
    for(const view of [result.chart,result.drilldown,result.export])assert.deepEqual(view.rows,result.table.rows);
    const parsed=csvRows(result.export.csv);assert.deepEqual(parsed[0],['fact','state','value','unit','reason','basis']);
    assert.deepEqual(parsed.slice(1),result.table.rows.map(r=>[r.fact,r.state,String(r.value??''),r.unit,r.reason??'',r.basis??'']));
    for(const r of result.chart.bars){assert.equal(r.state,'KNOWN');assert.ok(result.table.rows.some(row=>row.fact===r.fact&&row.value===r.value));assert.ok(result.chart.svg.includes('data-fact="'+r.fact+'" data-value="'+r.value+'"'));}
    assert.equal(result.drilldown.rawBillingDocuments,'UNAVAILABLE');assert.deepEqual(result.chart.billedNetSeries,[]);
    assert.equal(result.facts.billedNetByMonth.value,null);assert.equal(result.metrics.orderIntakeNetMinor.value,null);
    assert.equal(result.pair.nativeProvenance.nativeOperationalDateIsBusinessAcceptance,false);
    assert.equal(result.pair.nativeProvenance.declaredReferenceTimeIsNativeBusinessEvent,false);
    assert.equal(result.pair.sourceOperationsExpanded,false);assert.deepEqual(f.rows(),before);
  }finally{f.close();}
});

test('K03 actual native June cutoff preserves late-unit exclusion and keeps missing historical price and billing unavailable',async()=>{
  const f=await nativeCommonPairFixture(root);
  try {
    f.finishLate();const before=f.rows(),asOf='2026-06-30T23:59:59+02:00';
    const held=ks.capturePan520O2cPlanV1({source:f.source,nativeRoot:f.root,request:request(),period,asOf});
    const result=ks.executePan520O2cReadV1(held),actual=f.trade.readPan515TradeState({root:f.root,projection:request(),asOf});
    assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);assert.deepEqual(result.facts,actual.facts);
    assert.equal(result.facts.totalIssuedQuantity.value,8);assert.equal(result.metrics.onTimeDispatchQuantityPercent.value,80);
    assert.equal(result.facts.orderSourceNetMinor.state,'UNAVAILABLE');assert.equal(result.facts.orderSourceNetMinor.reason,'MISSING_NATIVE_PRICE_VALID_TIME_HISTORY');
    assert.equal(result.nativeAsOf,asOf);assert.equal(result.periodApplication,'NATIVE_SNAPSHOT_NOT_INVOICE_PERIOD_AGGREGATE_NO_PERIOD_START_FILTER');
    assert.deepEqual(f.rows(),before);
  }finally{f.close();}
});

test('K03 actual native foreign composite scope and forbidden caller SQL credentials roles or approval fail before any partial product view',async()=>{
  const f=await nativeCommonPairFixture(root);
  try {
    const before=f.rows(),base={source:f.source,nativeRoot:f.root,period};
    for(const scope of [{orderId:'SO-99'},{lineId:'99'},{tenantId:'SYN-TENANT-99'},{currency:'USD'},{unit:'KG'},{warehouseId:'WH-99'}])assert.throws(()=>ks.capturePan520O2cPlanV1({...base,request:{...request(),scope:{...request().scope,...scope}}}),/PAN520_COMPOSITE_SOURCE_GRAIN_DENIED/);
    for(const key of ['sql','credentials','role','approved','capabilities'])assert.throws(()=>ks.capturePan520O2cPlanV1({...base,request:{...request(),[key]:'CALLER_METADATA_NOT_AUTHORITY'}}),/K03_PAN520_REQUEST_DENIED/);
    assert.throws(()=>ks.capturePan520O2cPlanV1({...base,request:{...request(),profile:'P2P'}}),/K03_PAN520_PROFILE_DENIED/);
    assert.throws(()=>ks.capturePan520O2cPlanV1({...base,request:{...request(),questions:['SELECT * FROM private_source']}}),/K03_PAN520_REQUEST_DENIED/);
    assert.deepEqual(f.rows(),before);
  }finally{f.close();}
});

test('K03 missing invalid or reversed period and invalid native cutoff deny without source mutation',async()=>{
  const f=await nativeCommonPairFixture(root);
  try {
    const before=f.rows(),base={source:f.source,nativeRoot:f.root,request:request()};
    for(const p of [undefined,{start:'2026-06-01'},{start:'2026-02-30',end:'2026-08-01'},{start:'2026-08-01',end:'2026-06-01'}])assert.throws(()=>ks.capturePan520O2cPlanV1({...base,period:p}),/K03_PERIOD_DENIED/);
    assert.throws(()=>ks.capturePan520O2cPlanV1({...base,period,asOf:'2026-02-30T00:00:00Z'}),/PAN515_CUTOFF_DATE_DENIED/);
    assert.deepEqual(f.rows(),before);
  }finally{f.close();}
});

test('K03 cloned source metadata plan handles and caller-provided snapshot cannot become native authority',async()=>{
  const f=await nativeCommonPairFixture(root);
  try {
    const before=f.rows();
    assert.throws(()=>ks.capturePan520O2cPlanV1({source:JSON.parse(JSON.stringify(f.source)),nativeRoot:f.root,request:request(),period}),/K03_PAN520_SOURCE_BINDING_DENIED/);
    const held=ks.capturePan520O2cPlanV1({source:f.source,nativeRoot:f.root,request:request(),period});
    assertDenied(ks.executePan520O2cReadV1({...held,handle:{}}),/K03_PAN520_OPAQUE_PLAN_REQUIRED_DENIED/);
    assertDenied(ks.executePan520O2cReadV1({...held,plan:JSON.parse(JSON.stringify(held.plan))}),/K03_PAN520_OPAQUE_PLAN_REQUIRED_DENIED/);
    assertDenied(ks.executePan520O2cReadV1({...held,snapshot:{approved:true,facts:{billedNetMinor:90000}}}),/K03_PAN520_REQUEST_DENIED/);
    assert.deepEqual(f.rows(),before);
  }finally{f.close();}
});

test('K03 native REVOKE after actual opaque planning denies all views at use time and cannot reuse a successful prior read',async()=>{
  const f=await nativeCommonPairFixture(root);
  try {
    const before=f.rows(),held=ks.capturePan520O2cPlanV1({source:f.source,nativeRoot:f.root,request:request(),period});
    assert.equal(ks.executePan520O2cReadV1(held).outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS');
    f.revoke();assertDenied(ks.executePan520O2cReadV1(held),/PAN520_PROJECTION_STOP_OR_REVOKE_DENIED/);
    assert.throws(()=>ks.capturePan520O2cPlanV1({source:f.source,nativeRoot:f.root,request:request(),period}),/PAN520_PROJECTION_STOP_OR_REVOKE_DENIED/);
    assert.deepEqual(f.rows(),before);
  }finally{f.close();}
});

test('K03 public native consumer CLI emits actual JSON table SVG drilldown and CSV and denies missing period or caller role',async()=>{
  const f=await nativeCommonPairFixture(root);
  try {
    f.finishLate();const before=f.rows();
    const invoke=(extra=[],dated=true)=>spawnSync(process.execPath,['scripts/run-pan520-o2c-consumer.mjs','--pan-source-root',root,'--native-root',f.root,...(dated?['--period-start',period.start,'--period-end',period.end]:[]),...extra],{encoding:'utf8',timeout:10000,maxBuffer:1048576});
    const all=invoke();assert.equal(all.status,0,all.stderr+' '+all.stdout);const result=JSON.parse(all.stdout);
    assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS');assert.equal(result.metrics.dispatchPositionOtifPercent.value,0);
    for(const view of ['table','drilldown']){const r=invoke(['--view',view]);assert.equal(r.status,0,r.stderr);assert.deepEqual(JSON.parse(r.stdout)[view].rows,result.table.rows);}
    const chart=invoke(['--view','chart']),csv=invoke(['--view','export']);assert.equal(chart.status,0,chart.stderr);assert.equal(csv.status,0,csv.stderr);
    assert.equal(chart.stdout,result.chart.svg);assert.equal(csv.stdout,result.export.csv);
    const absent=invoke([],false);assert.equal(absent.status,1);assertDenied(JSON.parse(absent.stdout),/K03_PERIOD_DENIED/);
    const role=invoke(['--role','admin']);assert.equal(role.status,1);assertDenied(JSON.parse(role.stdout),/K03_PAN520_ENTRY_DENIED/);
    assert.deepEqual(f.rows(),before);
  }finally{f.close();}
});



