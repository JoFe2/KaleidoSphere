// Disposable synthetic COMMON setup; actual frozen native APIs, no result stub.
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {readFileSync} from 'node:fs';
import {nativeCommonPairFixture} from './pan520-native-pair.mjs';
export async function combinedBusinessFixture(sourceRoot){
 const imp=p=>import(pathToFileURL(join(sourceRoot,p)).href);
 const purchase=await imp('src/procurement-434/bestellung-lifecycle.mjs');
 const {nativeRows}=await imp('tests/fixtures/pan515/native-trade-fixture.mjs');
 const common=JSON.parse(readFileSync(join(sourceRoot,'contracts/trade/common-trade-01-v1.json')));
 const f=await nativeCommonPairFixture(sourceRoot),owner='LOCAL_SYNTHETIC_OWNER';
 try{
  const order={bestellungId:'bestellung:pan516-common',lieferantId:'lieferant:synthetic-01',bestellungZeitstempel:'2026-06-20T08:00:00Z',positionen:[{positionId:'position:common-01',artikelId:'EINK-ART-A01',einheit:'STK',waehrung:'EUR',bestellteMenge:common.purchase_order.quantity,berechneteMengeMinor:null}]};
  const terms={unitPriceMinor:common.purchase_order.unit_net_minor,currency:'EUR',unit:'STK',promisedAt:common.purchase_order.promised_acceptance_at};
  purchase.initializePan516Procurement({root:f.root,owner,purchase:order,terms});
  const command=(kind,revision,suffix,extra={})=>({schemaVersion:'pansphaira.pan516/procurement-command/v1',effectId:'synthetic:ks281-'+suffix,transportId:'synthetic:ks281-transport-'+suffix,expectedRevision:revision,orderId:order.bestellungId,positionId:order.positionen[0].positionId,supplierId:order.lieferantId,kind,receipt:null,sourceReference:'synthetic:ks281-source-'+suffix,...extra});
  const apply=c=>purchase.executePan516ProcurementCommand({root:f.root,command:c,grant:purchase.authorizePan516ProcurementCommand({root:f.root,command:c,owner})});
  apply(command('APPROVE',0,'approve'));apply(command('CONFIRM',1,'confirm',{confirmation:{revision:1,previousConfirmationDigest:null,terms,confirmedAt:'2026-06-21T08:00:00Z'}}));
  for(const [i,r]of common.receipts.entries())apply(command('ACCEPT_RECEIPT',i+2,'receipt-'+i,{receipt:{id:'wareneingang:ks281-gr-'+i,quantity:r.accepted_quantity,unit:'STK',acceptedAt:new Date(r.accepted_at).toISOString().replace('.000Z','Z')}}));
  const combinedRows=()=>({...f.rows(),procurement:nativeRows(f.root,'SELECT command,event FROM pan516_events ORDER BY revision')});
  return {...f,combinedRows};
 }catch(error){f.close();throw error;}
}
