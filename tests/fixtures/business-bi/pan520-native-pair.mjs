// Actual disposable COMMON setup through the frozen PAN native APIs.
// No projection reader stub; COMMON provides setup events, never billed facts.
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {loadPan520O2cSourceV1} from '../../../services/bi-control/src/business-bi/pan520-o2c-consumer.mjs';
export const period={start:'2026-06-01',end:'2026-08-01'};
export const request=()=>({schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'O2C',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['ORDER_SOURCE','DISPATCH_TIMELINESS','CUSTOMER_RECEIPT_TIMELINESS','BILLED_NET']});
export async function nativeCommonPairFixture(sourceRoot){
  const root=resolve(sourceRoot),url=p=>pathToFileURL(resolve(root,p)).href;
  const source=await loadPan520O2cSourceV1({sourceRoot:root});
  const {nativeTradeFixture,nativeRows}=await import(url('tests/fixtures/pan515/native-trade-fixture.mjs'));
  const trade=await import(url('src/pan515/trade-state.mjs'));
  const {scopeProfile}=await import(url('src/pan473/scope-profile.mjs'));
  const {recordLocalJournalControl}=await import(url('demo/runtime/local-journal-owner.mjs'));
  const common=JSON.parse(readFileSync(resolve(root,'contracts/trade/common-trade-01-v1.json')));
  const command=(kind,revision,id,quantity,referenceId=null,extra={})=>({schemaVersion:'pansphaira.pan517/fulfilment-command/v1',effectId:id,transportId:'synthetic:ks285-'+id.toLowerCase(),expectedRevision:revision,orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',unit:'STK',kind,quantity,referenceId,effectiveAt:'2026-06-29T10:00:00Z',reason:'Actual disposable COMMON PAN520 to KS285 pair',...extra});
  const f=await nativeTradeFixture({common:true});
  const apply=c=>trade.executePan515TradeCommand({root:f.root,command:c,grant:trade.authorizePan515TradeCommand({root:f.root,command:c,owner:'LOCAL_SYNTHETIC_OWNER'})});
  try {
    trade.initializePan515TradeState({root:f.root,owner:'LOCAL_SYNTHETIC_OWNER',caseId:common.id});
    apply(command('PROMISE',0,'PR-01',10,null,{effectiveAt:common.sales_order.accepted_at,promise:{revision:1,kind:'DISPATCH',dueAt:common.sales_order.promised_dispatch_at,previousPromiseDigest:null,sourceReference:'COMMON-TRADE-01.sales_order'}}));
    for(const [i,r] of common.receipts.entries())apply({...command('RECEIPT',i+1,r.id,r.accepted_quantity,common.purchase_order.id,{effectiveAt:r.accepted_at,sourceLineId:'1'}),schemaVersion:'pansphaira.pan515/trade-command/v1'});
    apply({...command('RESERVE',3,'RS-01',10,null,{effectiveAt:common.reservation_events[0].at}),schemaVersion:'pansphaira.pan515/trade-command/v1'});
    apply(command('PICK',4,'PK-01',8,'RS-01'));apply(command('PACK',5,'PA-01',8,'PK-01'));
    apply(command('ISSUE',6,'SH-01',8,'PA-01',{reservationId:'RS-01',reservationEventId:'RC-01',dispatchNoteId:'DN-01',physicalEvidenceId:'EV-01',promiseRevision:1,effectiveAt:common.shipments[0].dispatched_at}));
    let completed=false;
    const finishLate=()=>{
      if(completed)throw new Error('KS285_TEST_FIXTURE_ALREADY_COMPLETED');
      apply(command('PICK',7,'PK-02',2,'RS-01',{effectiveAt:'2026-07-02T10:00:00Z'}));
      apply(command('PACK',8,'PA-02',2,'PK-02',{effectiveAt:'2026-07-02T11:00:00Z'}));
      apply(command('ISSUE',9,'SH-02',2,'PA-02',{reservationId:'RS-01',reservationEventId:'RC-02',dispatchNoteId:'DN-02',physicalEvidenceId:'EV-02',promiseRevision:1,effectiveAt:common.shipments[1].dispatched_at}));completed=true;
    };
    const rows=()=>({events:nativeRows(f.root,'SELECT command,event FROM pan515_events ORDER BY revision'),objects:nativeRows(f.root,'SELECT id,body,revision,kind,deleted FROM objects ORDER BY id')});
    const revoke=()=>{const {marker}=scopeProfile(f.root),projection=trade.readPan515TradeState({root:f.root,projection:request()});recordLocalJournalControl(join(f.root,'pan453-owned-v2'),{kind:'REVOKE',sourceIdentity:marker.sourceIdentity,targetIdentity:marker.targetIdentity,operationKey:projection.rights.operationKey,stopEpoch:1,issuedAtMs:Date.now(),reason:'Disposable native P06 read revoked after actual KS plan'});};
    return {...f,source,trade,rows,finishLate,revoke};
  }catch(error){f.close();throw error;}
}
