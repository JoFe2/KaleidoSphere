// Actual disposable COMMON P2P through pinned native PAN APIs, never a provider stub.
import {pathToFileURL} from 'node:url';
import {resolve,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {loadPan520P2pSourceV1} from '../../../services/bi-control/src/business-bi/pan520-p2p-consumer.mjs';
export const p2pRequest=()=>({schemaVersion:'pansphaira.pan520/projection-request/v1',profile:'P2P',scope:{sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'PO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'},questions:['PROCUREMENT_QUANTITY','PROCUREMENT_PRICE_VARIANCE','PROCUREMENT_TIMELINESS']});
export async function nativeProcurementPairFixture(sourceRoot,{confirmed=true}={}){
 const root=resolve(sourceRoot),url=p=>pathToFileURL(resolve(root,p)).href,source=await loadPan520P2pSourceV1({sourceRoot:root});
 const {nativeTradeFixture,nativeRows}=await import(url('tests/fixtures/pan515/native-trade-fixture.mjs'));
 const trade=await import(url('src/pan515/trade-state.mjs'));
 const purchase=await import(url('src/procurement-434/bestellung-lifecycle.mjs'));
 const {scopeProfile}=await import(url('src/pan473/scope-profile.mjs'));
 const {recordLocalJournalControl}=await import(url('demo/runtime/local-journal-owner.mjs'));
 const common=JSON.parse(readFileSync(resolve(root,'contracts/trade/common-trade-01-v1.json'))),owner='LOCAL_SYNTHETIC_OWNER';
 const order={bestellungId:'bestellung:pan516-common',lieferantId:'lieferant:synthetic-01',bestellungZeitstempel:'2026-06-20T08:00:00Z',positionen:[{positionId:'position:common-01',artikelId:'EINK-ART-A01',einheit:'STK',waehrung:'EUR',bestellteMenge:common.purchase_order.quantity,berechneteMengeMinor:null}]};
 const terms={unitPriceMinor:common.purchase_order.unit_net_minor,currency:'EUR',unit:'STK',promisedAt:common.purchase_order.promised_acceptance_at};
 const command=(kind,revision,suffix,receipt=null)=>({schemaVersion:'pansphaira.pan516/procurement-command/v1',effectId:'synthetic:ks286-'+suffix,transportId:'synthetic:ks286-transport-'+suffix,expectedRevision:revision,orderId:order.bestellungId,positionId:order.positionen[0].positionId,supplierId:order.lieferantId,kind,receipt,sourceReference:'synthetic:ks286-source-'+suffix});
 const f=await nativeTradeFixture({common:true}),apply=c=>purchase.executePan516ProcurementCommand({root:f.root,command:c,grant:purchase.authorizePan516ProcurementCommand({root:f.root,command:c,owner})});
 try{
  trade.initializePan515TradeState({root:f.root,owner,caseId:common.id});purchase.initializePan516Procurement({root:f.root,owner,purchase:order,terms});apply(command('APPROVE',0,'approve'));
  if(confirmed)apply({...command('CONFIRM',1,'confirm'),confirmation:{revision:1,previousConfirmationDigest:null,terms,confirmedAt:'2026-06-21T08:00:00Z'}});
  for(const [i,r] of common.receipts.entries())apply(command('ACCEPT_RECEIPT',i+(confirmed?2:1),'receipt-'+i,{id:'wareneingang:ks286-gr-'+i,quantity:r.accepted_quantity,unit:'STK',acceptedAt:new Date(r.accepted_at).toISOString().replace('.000Z','Z')}));
  const rows=()=>({events:nativeRows(f.root,'SELECT command,event FROM pan516_events ORDER BY revision'),objects:nativeRows(f.root,'SELECT id,body,revision,kind,deleted FROM objects ORDER BY id')});
  const revoke=()=>{const {marker}=scopeProfile(f.root),snapshot=trade.readPan515TradeState({root:f.root,projection:p2pRequest()});recordLocalJournalControl(join(f.root,'pan453-owned-v2'),{kind:'REVOKE',sourceIdentity:marker.sourceIdentity,targetIdentity:marker.targetIdentity,operationKey:snapshot.rights.operationKey,stopEpoch:1,issuedAtMs:Date.now(),reason:'Disposable native P06 P2P read revoked after actual KS plan'});};
  return {...f,source,trade,purchase,rows,revoke,apply,command,terms};
 }catch(error){f.close();throw error;}
}
