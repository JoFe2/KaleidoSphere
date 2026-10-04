// Pure bounded COMMON reference analysis; not an invoice matcher or a grant.
import {types} from 'node:util';
function assertFixtureJson(value){
  let nodes=0;const seen=new Set();
  function visit(v,depth){
    if(++nodes>20000||depth>16)throw new Error('K04_INPUT_DENIED');
    if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||typeof v==='string'&&v.length<=4096)return;
    if(typeof v!=='object'||types.isProxy(v)||seen.has(v))throw new Error('K04_INPUT_DENIED');
    const array=Array.isArray(v),proto=Object.getPrototypeOf(v),fields=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(fields);
    if(proto!==(array?Array.prototype:Object.prototype)||keys.some(k=>typeof k!=='string'||!('value' in fields[k])||k!=='length'&&!fields[k].enumerable))throw new Error('K04_INPUT_DENIED');
    if(array&&(fields.length.value>10000||keys.length!==fields.length.value+1||keys.some(k=>k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=fields.length.value))))throw new Error('K04_INPUT_DENIED');
    seen.add(v);for(const k of keys)if(!array||k!=='length')visit(fields[k].value,depth+1);seen.delete(v);
  }
  visit(value,0);
}
const key=(scope,order,line)=>JSON.stringify([scope.source_id,scope.tenant_id,scope.entity_id,order,line,scope.item_id,scope.warehouse_id,scope.currency,scope.quantity_unit]);
const safe=(n)=>{if(!Number.isSafeInteger(n))throw new Error('K04_NUMERIC_DENIED');return n;};

const validTime=at=>typeof at==='string'&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-3]):[0-5]\d|[+-]14:00)$/.test(at)&&Number.isFinite(Date.parse(at))&&new Date(at.slice(0,10)+'T00:00:00Z').toISOString().slice(0,10)===at.slice(0,10);
const micros=at=>BigInt(Date.parse(at))*1000n+BigInt((at.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1]??'').padEnd(6,'0').slice(3));

export function deriveProcurementV1(data){
  assertFixtureJson(data);
  const {scope,purchase_order:po,purchase_invoice:invoice,receipts}=data;
  if(!scope||!po||!invoice||!Array.isArray(receipts)||receipts.length>1000)throw new Error('K04_GRAIN_DENIED');
  const admitted={source_id:'SYN-COMMON',tenant_id:'SYN-TENANT-01',entity_id:'SYN-ENTITY-01',warehouse_id:'WH-01',item_id:'ARTICLE-A',currency:'EUR',quantity_unit:'STK'};
  if(data.id!=='COMMON-TRADE-01'||Object.entries(admitted).some(([k,v])=>scope[k]!==v)||po.id!=='PO-01'||po.line_id!=='1')throw new Error('K04_SCOPE_DENIED');
  for(const row of [po,invoice,...receipts]){
    if(Object.keys(admitted).some(k=>row[k]!==undefined&&row[k]!==scope[k])||row.unit!==undefined&&row.unit!==scope.quantity_unit)throw new Error('K04_SCOPE_DENIED');
  }
  for(const row of [invoice,...receipts])if(row.po_id!==po.id||row.po_line_id!==po.line_id)throw new Error('K04_SCOPE_DENIED');
  const id=v=>typeof v==='string'&&v.length>0&&v.length<=128;
  if(data.purchase_invoices!==undefined||!Array.isArray(receipts)||receipts.length>1000||!id(invoice.id)||!id(invoice.line_id))throw new Error('K04_GRAIN_DENIED');
  const seen=new Set();
  for(const r of receipts){const receiptKey=JSON.stringify([scope.tenant_id,scope.entity_id,r.id]);if(!id(r.id)||seen.has(receiptKey))throw new Error('K04_GRAIN_DENIED');seen.add(receiptKey);}
  const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw new Error('K04_NUMERIC_DENIED');};
  integer(po.quantity,1,1000000);integer(invoice.quantity,1,1000000);
  for(const r of receipts)integer(r.accepted_quantity,1,1000000);
  for(const v of [po.unit_net_minor,invoice.unit_net_minor,invoice.net_minor])if(v!=null)integer(v);
  for(const at of [po.promised_acceptance_at,...receipts.map(r=>r.accepted_at)])if(at!=null&&!validTime(at))throw new Error('K04_EVENT_DATE_DENIED');
  const grain=key(scope,po.id,po.line_id);
  // Receipt reduction happens once at the full source/tenant/entity/PO/line grain.
  const accepted=safe(receipts.reduce((n,r)=>n+r.accepted_quantity,0));
  const unknownTime=safe(receipts.filter(r=>r.accepted_at==null||po.promised_acceptance_at==null).reduce((n,r)=>n+r.accepted_quantity,0));
  const onTime=safe(receipts.filter(r=>r.accepted_at!=null&&po.promised_acceptance_at!=null&&micros(r.accepted_at)<=micros(po.promised_acceptance_at)).reduce((n,r)=>n+r.accepted_quantity,0));
  const hasPrice=po.unit_net_minor!=null&&invoice.net_minor!=null;
  const expected=hasPrice?safe(Number(BigInt(invoice.quantity)*BigInt(po.unit_net_minor))):null;
  return {outcome:'COMPLETE',profile:'p2p-procurement/v1',scope:structuredClone(scope),
    lines:[{grain,po_id:po.id,po_line_id:po.line_id,
      quantity:{status:'KNOWN',ordered:po.quantity,accepted,invoiced:invoice.quantity,receivedNotInvoiced:Math.max(0,accepted-invoice.quantity),invoicedNotReceived:Math.max(0,invoice.quantity-accepted)},
      price:hasPrice?{status:'KNOWN',expectedNetMinor:expected,invoiceNetMinor:invoice.net_minor,varianceMinor:safe(invoice.net_minor-expected)}:{status:'UNKNOWN',expectedNetMinor:null,invoiceNetMinor:null,varianceMinor:null,reason:'MISSING_CONFIRMED_PRICE_OR_INVOICE_NET'},
      timing:unknownTime?{status:'UNKNOWN',onTimeAccepted:null,lateAccepted:null,unknownTimeAccepted:unknownTime,denominator:accepted,reason:'MISSING_RECEIPT_ACCEPTANCE_OR_CONFIRMED_PROMISE_TIME'}:{status:'KNOWN',onTimeAccepted:onTime,lateAccepted:accepted-onTime,unknownTimeAccepted:0,denominator:accepted}}],
    mutationAuthority:false,invoiceMatcherImplemented:false,producerPairing:'NOT_EXECUTED_LOCAL_COMMON_REFERENCE_ONLY'};
}
