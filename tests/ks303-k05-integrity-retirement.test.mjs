import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

import {loadPan520StockSourceV1,capturePan520StockPlanV1} from '../services/bi-control/src/business-bi/pan520-stock-consumer.mjs';
import {createPan549K05StockReadPairV1} from '../services/bi-control/src/assistant-foundation/pan549-k05-stock-read-pair-v1.mjs';
import binding from '../contracts/dependencies/pan549-stock-workspace-v1/binding.json' with {type:'json'};
const selector={schemaVersion:'pansphaira.workspace-analysis/read/v1',objectId:'analysis:common-trade-01:stock',expectedNativeRevision:null,expectedResultRevision:null,asOf:binding.cutoff};
const load=(root,path)=>import(pathToFileURL(join(root,path)).href);
for(const fault of ['ACTUAL_KS_REVOKED_DURING_NATIVE_RESULT_INTEGRITY','ACTUAL_NATIVE_SOURCE_DRIFT_AFTER_READ']){
 test('KS303 '+fault+' denies old success after the real async integrity boundary',async t=>{
  if(!process.env.KS303_PAN549_SOURCE_ROOT&&!process.env.KS303_REQUIRE_REAL_WORKSPACE){t.skip('NOT_RUN: exact own PAN549/K05 source roots absent; required CI provisions them');return;}
  assert.ok(process.env.KS303_PAN549_SOURCE_ROOT&&process.env.KS303_K05_SOURCE_ROOT&&process.env.TMPDIR);
  const pan=process.env.KS303_PAN549_SOURCE_ROOT,cwd=process.cwd();process.chdir(pan);let native,tls,pair,pending;
  try{
   const {financeFixture}=await load(pan,'tests/pan519/native-fixture.mjs');const {nativeRows}=await load(pan,'tests/fixtures/pan515/native-trade-fixture.mjs');const {nativeFixture527}=await load(pan,'tests/pan527/helpers.mjs');const {createNativeAnalysisReadAdapterV1,isNativeAnalysisReadAdapterV1}=await load(pan,'src/pan549/native-analysis-read.mjs');
   const trade=await load(pan,'src/pan515/trade-state.mjs');const {nativeTradeFixture}=await load(pan,'tests/fixtures/pan515/native-trade-fixture.mjs');const {default:common}=await import(pathToFileURL(join(pan,'contracts/trade/common-trade-01-v1.json')).href,{with:{type:'json'}});
   native=await nativeTradeFixture({common:true});trade.initializePan515TradeState({root:native.root,owner:'LOCAL_SYNTHETIC_OWNER',caseId:common.id});
   const apply=c=>trade.executePan515TradeCommand({root:native.root,command:c,grant:trade.authorizePan515TradeCommand({root:native.root,owner:'LOCAL_SYNTHETIC_OWNER',command:c})});
   const command=(kind,revision,id,quantity,referenceId,effectiveAt,extra={})=>({schemaVersion:'pansphaira.pan515/trade-command/v1',effectId:id,transportId:'synthetic:ks303-'+id.toLowerCase(),expectedRevision:revision,orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',unit:'STK',kind,quantity,referenceId,effectiveAt,reason:'Own existing native June source, not sessionaction',...extra});
   for(const [i,r] of common.receipts.entries())apply(command('RECEIPT',i,r.id,r.accepted_quantity,common.purchase_order.id,r.accepted_at,{sourceLineId:'1'}));
   apply(command('RESERVE',2,'RS-01',10,null,common.reservation_events[0].at));apply(command('SHIP',3,'SH-01',8,'RS-01',common.shipments[0].dispatched_at,{reservationEventId:'RC-01'}));
   tls=await nativeFixture527();const ksSource=await loadPan520StockSourceV1({sourceRoot:process.env.KS303_K05_SOURCE_ROOT});const sessions=tls.gateway.sessionAdapter('tenant-a'),issued=sessions.issueOwnerSession({subjectId:'synthetic:ks303-integrity-retirement',role:'reader',expiresAtMs:Date.now()+300000});const headers={cookie:issued.cookieHeader,origin:tls.origin};
   pair=createPan549K05StockReadPairV1({ksSource,nativeRoot:native.root,sessions,nativeReader:createNativeAnalysisReadAdapterV1({optIn:true,root:native.root,sessions}),isNativeReader:isNativeAnalysisReadAdapterV1});
   const initial=await pair.read(headers,selector);assert.equal(initial.rows[0].value,2);assert.ok(pair.readPairEvidence());const before=nativeRows(native.root,'SELECT revision,command,event FROM pan515_events ORDER BY revision');
   const {scopeProfile}=await load(pan,'src/pan473/scope-profile.mjs');const {recordLocalJournalControl}=await load(pan,'demo/runtime/local-journal-owner.mjs');
   const permissionPlan=capturePan520StockPlanV1({source:ksSource,nativeRoot:native.root,request:structuredClone(binding.boundedProjectionRequest),asOf:binding.cutoff});
   // Both real reads occur synchronously before the actual WebCrypto await. No
   // stub, fake predicate, crypto/prototype patch or scheduler sleep is needed.
   pending=pair.read(headers,selector);
   if(fault==='ACTUAL_KS_REVOKED_DURING_NATIVE_RESULT_INTEGRITY'){
    const {marker}=scopeProfile(native.root);
    recordLocalJournalControl(join(native.root,'pan453-owned-v2'),{kind:'REVOKE',sourceIdentity:marker.sourceIdentity,targetIdentity:marker.targetIdentity,operationKey:permissionPlan.plan.nativePlan.operationKey,stopEpoch:1,issuedAtMs:Date.now(),reason:'Own synthetic K05 read revoked during actual result integrity await'});
    await assert.rejects(pending,/DENIED|RETIRED|STALE/);assert.equal(pair.readPairEvidence(),null);assert.deepEqual(nativeRows(native.root,'SELECT revision,command,event FROM pan515_events ORDER BY revision'),before);
   }else{
    // An unrelated July event correctly preserves a June snapshot. Use the
    // existing native command owner to append an ACTUALLY in-cutoff change;
    // no immutable-history trigger is disabled, no old event is overwritten.
    apply(command('COUNT_ADJUSTMENT',4,'CT-99',3,'GR-01',selector.asOf));
    const after=nativeRows(native.root,'SELECT revision,command,event FROM pan515_events ORDER BY revision');assert.equal(after.length,before.length+1);
    await assert.rejects(pending,/DENIED|RETIRED|STALE/);assert.equal(pair.readPairEvidence(),null);assert.deepEqual(nativeRows(native.root,'SELECT revision,command,event FROM pan515_events ORDER BY revision'),after,'pair must cause no extra source effect after the explicit test-owner native change');
   }
  }finally{await pending?.catch(()=>{});pair?.close();native?.close();await tls?.close();process.chdir(cwd);}
 });
}
