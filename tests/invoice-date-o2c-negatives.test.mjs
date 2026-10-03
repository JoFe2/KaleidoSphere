import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveInvoiceDateO2cV1,normalizeKnownO2cV1} from '../services/bi-control/src/business-bi/invoice-date-o2c.mjs';
const initial=JSON.parse(readFileSync('examples/o2c/ks-original-500-700.json','utf8'));
const period={start:'2026-06-01',end:'2026-08-01'};
test('K03 order intake uses declared business timezone rather than slicing UTC date',()=>{
  const data=structuredClone(initial);data.orders[0].accepted_at='2026-05-31T22:30:00Z';
  const v=deriveInvoiceDateO2cV1(data,period);assert.equal(v.orderIntake.netMinor,100000);assert.equal(v.delivery.onTimeQuantityPercent,80);
});
for(const value of [undefined,'2026-06-31'])test('K03 no ORDER_DATE fallback or normalization for invalid invoice date '+value,()=>{
  const data=structuredClone(initial);data.documents[0].invoice_date=value;
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_DOCUMENT_DATE_DENIED'});
});
test('K03 a dispatch one microsecond after an offset deadline remains late',()=>{
  const data=structuredClone(initial);data.orders[0].promised_dispatch_at='2026-06-30T23:59:59.000001+02:00';
  data.shipments[0].dispatched_at='2026-06-30T23:59:59.000002+02:00';
  const v=deriveInvoiceDateO2cV1(data,period);assert.equal(v.delivery.onTimeQuantityPercent,0);assert.equal(v.delivery.positionOtifPercent,0);
});
test('K03 dispatch after the explicit period cutoff cannot close an earlier open quantity',()=>{
  const data=structuredClone(initial);const v=deriveInvoiceDateO2cV1(data,{start:'2026-06-01',end:'2026-07-01'});
  assert.equal(v.delivery.dispatchedQuantity,8);assert.equal(v.delivery.openQuantity,2);
  assert.equal(v.delivery.onTimeQuantityPercent,80);assert.equal(v.delivery.positionOtifPercent,0);
});
test('K03 actual dispatch requires a valid offset instant, never host-local interpretation',()=>{
  const data=structuredClone(initial);data.shipments[0].dispatched_at='2026-06-29T15:00:00';
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_EVENT_DATE_DENIED'});
});
test('K03 later renegotiation cannot overwrite original promise history or repair OTIF',()=>{
  const data=structuredClone(initial);const order=data.orders[0];
  order.promise_history=[{revision:1,promised_dispatch_at:order.promised_dispatch_at},{revision:2,promised_dispatch_at:'2026-07-31T23:59:59+02:00'}];order.promised_dispatch_at='2026-07-31T23:59:59+02:00';order.promise_revision=2;
  const v=deriveInvoiceDateO2cV1(data,period);assert.equal(v.delivery.onTimeQuantityPercent,80);assert.equal(v.delivery.positionOtifPercent,0);assert.equal(v.delivery.openQuantity,0);
});
test('K03 bounded delivery profile refuses overshipment instead of negative open quantity or above-100 percent',()=>{
  const data=structuredClone(initial);data.shipments[0].quantity=11;
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_DELIVERY_QUANTITY_DENIED'});
});
test('K03 a renegotiated scalar or truncated history cannot substitute for the original promise',()=>{
  for(const history of [undefined,[{revision:2,promised_dispatch_at:'2026-07-31T23:59:59+02:00'}]]){
    const data=structuredClone(initial);data.orders[0].promise_revision=2;data.orders[0].promised_dispatch_at='2026-07-31T23:59:59+02:00';
    if(history)data.orders[0].promise_history=history;
    assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_PROMISE_DENIED'});
  }
});
test('K03 customer-receipt milestones cannot be counted as dispatch evidence',()=>{
  const data=structuredClone(initial);data.shipments[0].milestone='CUSTOMER_RECEIPT';
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_MILESTONE_DENIED'});
});
test('K03 a late customer receipt does not inherit timely dispatch or fabricate customer OTIF',()=>{
  const data=structuredClone(initial);data.customer_receipts=[{receipt_id:'CUSTOMER-R-01',milestone:'CUSTOMER_RECEIPT',received_at:'2026-07-10T10:00:00+02:00',quantity:10}];
  const v=deriveInvoiceDateO2cV1(data,period);assert.equal(v.delivery.onTimeQuantityPercent,80);assert.equal(v.delivery.positionOtifPercent,0);assert.equal(v.customerReceipt.outcome,'UNKNOWN_CUSTOMER_RECEIPT_DEFINITION_NOT_QUALIFIED');
});
test('K03 exact invoice aggregate refuses overflow even when each source amount is safe',()=>{
  const data=structuredClone(initial);data.documents[0].net_absolute_minor=Number.MAX_SAFE_INTEGER;data.documents[2].invoice_date='2026-06-28';
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_NUMERIC_DENIED'});
});
test('K03 order quantity-price multiplication is exact or refused, not rounded',()=>{
  const data=structuredClone(initial);data.orders[0].unit_net_minor=Number.MAX_SAFE_INTEGER;
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_NUMERIC_DENIED'});
});
test('K03 issued credits require an existing issued invoice on the same scoped order position',()=>{
  const data=structuredClone(initial);data.documents[1].correction_of=['NO-SUCH-INVOICE','1'];
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_CREDIT_REFERENCE_DENIED'});
});
for(const [label,array,field,value] of [['negative credit would invert sign','documents','net_absolute_minor',-10000],['unsafe cents','documents','net_absolute_minor',Number.MAX_SAFE_INTEGER+1],['fractional quantity','shipments','quantity',0.5],['non-numeric order price','orders','unit_net_minor','10000']])test('K03 refuses non-absolute or non-exact numeric facts: '+label,()=>{
  const data=structuredClone(initial);data[array][array==='documents'?1:0][field]=value;
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_NUMERIC_DENIED'});
});
for(const state of ['DRAFT','VOID'])test('K03 excludes non-issued invoice state '+state,()=>{
  const data=structuredClone(initial);data.documents[2].state=state;
  assert.deepEqual(deriveInvoiceDateO2cV1(data,period).table.rows,[{month:'2026-06',net_minor:50000,currency:'EUR'}]);
});
test('K03 order or ledger records cannot masquerade as invoice/credit documents',()=>{
  const data=structuredClone(initial);data.documents[0].type='LEDGER_POSTING';
  assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_DOCUMENT_STATE_DENIED'});
});
test('K03 known mapping cannot silently drop foreign unit, item or warehouse facts',()=>{
  const reference=JSON.parse(readFileSync('examples/o2c/common-trade-01.json','utf8'));
  for(const [record,field,value] of [['sales_documents','quantity_unit','KG'],['shipments','warehouse_id','FOREIGN-WAREHOUSE'],['sales_order','item_id','FOREIGN-ITEM']]){
    const data=structuredClone(reference);(Array.isArray(data[record])?data[record][0]:data[record])[field]=value;
    assert.throws(()=>deriveInvoiceDateO2cV1(normalizeKnownO2cV1(data,'common-snake-reference/v1'),period),{message:'K03_SCOPE_DENIED'});
  }
});
test('K03 document-position grain never silently replaces an explicit foreign order-position link',()=>{
  const data=JSON.parse(readFileSync('examples/o2c/common-trade-01.json','utf8'));
  data.sales_documents[0].order_position_id='FOREIGN-POSITION';
  assert.throws(()=>deriveInvoiceDateO2cV1(normalizeKnownO2cV1(data,'common-snake-reference/v1'),period),{message:'K03_SCOPE_DENIED'});
});
test('K03 bounded EUR/STK profile refuses unsupported root currency or quantity unit',()=>{
  for(const [field,value] of [['currency','USD'],['quantity_unit','KG']]){
    const data=structuredClone(initial);data.scope[field]=value;
    assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_SCOPE_DENIED'});
  }
});
for(const [label,array,field,value] of [['foreign tenant','shipments','tenant_id','FOREIGN-TENANT'],['foreign order same position','documents','order_id','FOREIGN-ORDER'],['mixed currency','documents','currency','USD']]){
  test('K03 real core refuses cross-scope linkage: '+label,()=>{
    const data=structuredClone(initial);data[array][0][field]=value;
    assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_SCOPE_DENIED'});
  });
}
// These execute the exact business core called by the actual CLI, without mocks or replacement workers.
for(const [label,array,index] of [['credit duplicate','documents',1],['shipment join fanout','shipments',0],['order join fanout','orders',0]]){
  test('K03 real core refuses duplicate composite grain: '+label,()=>{
    const data=structuredClone(initial);data[array].push(structuredClone(data[array][index]));
    assert.throws(()=>deriveInvoiceDateO2cV1(data,period),{message:'K03_GRAIN_DENIED'});
  });
}
