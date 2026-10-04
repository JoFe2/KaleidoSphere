import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {deriveProcurementV1} from '../services/bi-control/src/business-bi/procurement-analysis.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../examples/p2p/common-trade-01.json',import.meta.url)));

test('K04 receipt comparison preserves microseconds rather than silently repairing a late receipt',()=>{
 const f=fixture();f.purchase_order.promised_acceptance_at='2026-06-25T23:59:59.000001+02:00';f.receipts[0].accepted_at='2026-06-25T23:59:59.000002+02:00';
 const l=deriveProcurementV1(f).lines[0];assert.equal(l.timing.onTimeAccepted,0);assert.equal(l.timing.lateAccepted,10);
});
for(const bad of ['2026-02-30T10:00:00Z','2026-06-25','2026-06-25T10:00:00','2026-06-25T10:00:00+14:30'])test('K04 malformed evidence time is denied, not treated as unknown '+bad,()=>{const f=fixture();f.receipts[0].accepted_at=bad;assert.throws(()=>deriveProcurementV1(f),{message:'K04_EVENT_DATE_DENIED'});});


for(const [label,change] of [
 ['negative receipt',f=>{f.receipts[0].accepted_quantity=-1;}],
 ['fractional quantity',f=>{f.purchase_invoice.quantity=1.2;}],
 ['string ordered quantity',f=>{f.purchase_order.quantity='10';}],
 ['negative invoice net',f=>{f.purchase_invoice.net_minor=-1;}],
 ['unsafe unit price',f=>{f.purchase_order.unit_net_minor=Number.MAX_SAFE_INTEGER+1;}]
])test('K04 exact integer dimensions reject '+label,()=>{const f=fixture();change(f);assert.throws(()=>deriveProcurementV1(f),{message:'K04_NUMERIC_DENIED'});});

test('K04 getters and proxies are not executable fixture authority',()=>{
 let invoked=0;const f=fixture();Object.defineProperty(f.scope,'currency',{enumerable:true,get(){invoked++;return 'EUR';}});
 assert.throws(()=>deriveProcurementV1(f),{message:'K04_INPUT_DENIED'});assert.equal(invoked,0);
 const p=new Proxy(fixture(),{get(){invoked++;throw new Error('must not execute');}});
 assert.throws(()=>deriveProcurementV1(p),{message:'K04_INPUT_DENIED'});assert.equal(invoked,0);
});


for(const [label,change] of [
 ['duplicate receipt',f=>{f.receipts.push(structuredClone(f.receipts[0]));}],
 ['prejoined invoice copies',f=>{f.purchase_invoices=[structuredClone(f.purchase_invoice),structuredClone(f.purchase_invoice)];}],
 ['unbounded receipts',f=>{f.receipts=Array.from({length:1001},(_,i)=>({...f.receipts[0],id:'R'+i}));}]
])test('K04 preaggregate grain denies '+label,()=>{const f=fixture();change(f);assert.throws(()=>deriveProcurementV1(f),{message:'K04_GRAIN_DENIED'});});

test('K04 optional missing price holds price only, never known procurement quantity',()=>{
 const f=fixture();delete f.purchase_order.unit_net_minor;delete f.purchase_invoice.unit_net_minor;delete f.purchase_invoice.net_minor;
 const r=deriveProcurementV1(f),l=r.lines[0];
 assert.equal(r.outcome,'COMPLETE');assert.equal(l.quantity.status,'KNOWN');assert.equal(l.quantity.accepted,10);assert.equal(l.quantity.invoiced,10);
 assert.deepEqual(l.price,{status:'UNKNOWN',expectedNetMinor:null,invoiceNetMinor:null,varianceMinor:null,reason:'MISSING_CONFIRMED_PRICE_OR_INVOICE_NET'});
 assert.equal(l.timing.onTimeAccepted,8);
});

for(const [label,change] of [
 ['timeless ledger receipt',f=>{for(const r of f.receipts){delete r.accepted_at;r.ledger_posted_at='2026-06-20T08:00:00Z';}}],
 ['missing promised receipt milestone',f=>{delete f.purchase_order.promised_acceptance_at;}]
])test('K04 '+label+' is UNKNOWN time, not zero-late or global quantity denial',()=>{
 const f=fixture();change(f);const l=deriveProcurementV1(f).lines[0];
 assert.equal(l.quantity.accepted,10);assert.equal(l.price.varianceMinor,2000);
 assert.deepEqual(l.timing,{status:'UNKNOWN',onTimeAccepted:null,lateAccepted:null,unknownTimeAccepted:10,denominator:10,reason:'MISSING_RECEIPT_ACCEPTANCE_OR_CONFIRMED_PROMISE_TIME'});
});


for(const [label,change] of [
 ['same line of another receipt PO',f=>{f.receipts[1].po_id='PO-FOREIGN';}],
 ['same line of another invoice PO',f=>{f.purchase_invoice.po_id='PO-FOREIGN';}],
 ['receipt tenant',f=>{f.receipts[0].tenant_id='FOREIGN';}],
 ['invoice entity',f=>{f.purchase_invoice.entity_id='FOREIGN';}],
 ['receipt unit',f=>{f.receipts[0].quantity_unit='KG';}],
 ['invoice currency',f=>{f.purchase_invoice.currency='USD';}],
 ['foreign top-level scope',f=>{f.scope.tenant_id='FOREIGN';}]
])test('K04 composite source grain rejects '+label,()=>{const f=fixture();change(f);assert.throws(()=>deriveProcurementV1(f),{message:'K04_SCOPE_DENIED'});});
