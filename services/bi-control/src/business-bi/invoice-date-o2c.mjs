// Additive pure O2C core; existing ORDER_DATE metric modules are not imported or modified.
const validBusinessDate=(date)=>typeof date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+'T00:00:00Z'))&&new Date(date+'T00:00:00Z').toISOString().slice(0,10)===date;
const validOffsetInstant=(at)=>typeof at==='string'&&validBusinessDate(at.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(at)&&Number.isFinite(Date.parse(at));

// Validated instants retain all declared microseconds; Date.parse alone truncates after milliseconds.
const instantMicros=(at)=>BigInt(Date.parse(at))*1000n+BigInt((at.match(/\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/)?.[1]??'').padEnd(6,'0').slice(3));

export function assertO2cPeriodV1({start,end}={}) {
  const valid=validBusinessDate;
  if(!valid(start)||!valid(end)||start>=end)throw new Error('K03_PERIOD_DENIED');
  return Object.freeze({start,end});
}

export function deriveInvoiceDateO2cV1(data,period) {
  const {start,end}=assertO2cPeriodV1(period);
  const unique=(rows,id)=>{
    if(!Array.isArray(rows)||rows.length>1000)throw new Error('K03_GRAIN_DENIED');
    const seen=new Set();
    for(const row of rows){const fields=[row.tenant_id,row.entity_id,row[id],row.position_id];if(fields.some(v=>typeof v!=='string'||!v||v.length>128))throw new Error('K03_GRAIN_DENIED');const key=JSON.stringify(fields);if(seen.has(key))throw new Error('K03_GRAIN_DENIED');seen.add(key);}
  };
  unique(data.orders,'order_id');unique(data.documents,'document_id');unique(data.shipments,'shipment_id');
  const scope=data.scope;
  if(!scope||['source_id','tenant_id','entity_id','warehouse_id','item_id','currency','quantity_unit','business_timezone'].some(k=>typeof scope[k]!=='string'||!scope[k]||scope[k].length>128)||scope.currency!=='EUR'||scope.quantity_unit!=='STK')throw new Error('K03_SCOPE_DENIED');
  const orderKey=(row,position=row.position_id)=>JSON.stringify([row.tenant_id,row.entity_id,row.order_id,position]);
  const orderKeys=new Set(data.orders.map(row=>orderKey(row)));
  for(const row of [...data.orders,...data.documents,...data.shipments]){
    if(row.tenant_id!==scope.tenant_id||row.entity_id!==scope.entity_id||['currency','quantity_unit','warehouse_id','item_id'].some(k=>row[k]!==undefined&&row[k]!==scope[k]))throw new Error('K03_SCOPE_DENIED');
  }
  for(const row of data.documents)if(!orderKeys.has(orderKey(row,row.order_position_id??row.position_id)))throw new Error('K03_SCOPE_DENIED');
  for(const row of data.shipments)if(!orderKeys.has(orderKey(row)))throw new Error('K03_SCOPE_DENIED');
  for(const doc of data.documents)if(!['INVOICE','CREDIT'].includes(doc.type)||!['ISSUED','DRAFT','VOID'].includes(doc.state))throw new Error('K03_DOCUMENT_STATE_DENIED');
  for(const doc of data.documents)if(doc.state==='ISSUED'&&!validBusinessDate(doc.invoice_date))throw new Error('K03_DOCUMENT_DATE_DENIED');
  for(const order of data.orders)if(!validOffsetInstant(order.accepted_at)||!validOffsetInstant(order.promised_dispatch_at))throw new Error('K03_EVENT_DATE_DENIED');
  for(const shipment of data.shipments)if(!validOffsetInstant(shipment.dispatched_at))throw new Error('K03_EVENT_DATE_DENIED');
  const integer=(v,min=0,max=Number.MAX_SAFE_INTEGER)=>{if(!Number.isSafeInteger(v)||v<min||v>max)throw new Error('K03_NUMERIC_DENIED');};
  for(const order of data.orders){integer(order.quantity,1,1000000);integer(order.unit_net_minor);}
  for(const doc of data.documents){integer(doc.quantity_absolute,1,1000000);integer(doc.net_absolute_minor);}
  for(const shipment of data.shipments){integer(shipment.quantity,1,1000000);if(shipment.milestone!=='DISPATCH')throw new Error('K03_MILESTONE_DENIED');}
  const documentKey=(row,id=row.document_id,position=row.position_id)=>JSON.stringify([row.tenant_id,row.entity_id,id,position]);
  const invoices=new Map(data.documents.filter(d=>d.type==='INVOICE'&&d.state==='ISSUED').map(d=>[documentKey(d),d]));
  for(const credit of data.documents.filter(d=>d.type==='CREDIT'&&d.state==='ISSUED')){
    const ref=credit.correction_of;
    const invoice=Array.isArray(ref)&&ref.length===2?invoices.get(documentKey(credit,ref[0],ref[1])):null;
    if(!invoice||orderKey(credit,credit.order_position_id??credit.position_id)!==orderKey(invoice,invoice.order_position_id??invoice.position_id))throw new Error('K03_CREDIT_REFERENCE_DENIED');
  }
  const safeMinor=(value)=>{const number=Number(value);if(!Number.isSafeInteger(number)||BigInt(number)!==value)throw new Error('K03_NUMERIC_DENIED');return number;};
  const totals=new Map();
  for(const doc of data.documents){
    if(doc.state!=='ISSUED'||doc.invoice_date<start||doc.invoice_date>=end)continue;
    const month=doc.invoice_date.slice(0,7);const amount=doc.type==='CREDIT'?-BigInt(doc.net_absolute_minor):BigInt(doc.net_absolute_minor);
    totals.set(month,(totals.get(month)??0n)+amount);
  }
  const rows=[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([month,net_minor])=>({month,net_minor:safeMinor(net_minor),currency:data.scope.currency}));
  let dateFormatter;try{dateFormatter=new Intl.DateTimeFormat('en-US-u-ca-iso8601-nu-latn',{timeZone:scope.business_timezone,year:'numeric',month:'2-digit',day:'2-digit'});}catch{throw new Error('K03_SCOPE_DENIED');}
  const businessDate=(instant)=>{const parts=Object.fromEntries(dateFormatter.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));return parts.year.padStart(4,'0')+'-'+parts.month+'-'+parts.day;};
  const orders=data.orders.filter(o=>businessDate(o.accepted_at)>=start&&businessDate(o.accepted_at)<end);
  let ordered=0,onTime=0,full=0,delivered=0;
  for(const order of orders){
    const history=order.promise_history;
    if(history!==undefined&&(!Array.isArray(history)||!history.length||history.length>1000))throw new Error('K03_PROMISE_DENIED');
    const promises=history??[{revision:order.promise_revision,promised_dispatch_at:order.promised_dispatch_at}];
    const revisions=new Set();for(const promise of promises){if(!Number.isSafeInteger(promise.revision)||promise.revision<1||revisions.has(promise.revision)||!validOffsetInstant(promise.promised_dispatch_at))throw new Error('K03_PROMISE_DENIED');revisions.add(promise.revision);}
    const originalPromise=[...promises].sort((a,b)=>a.revision-b.revision)[0];
    // This bounded v1 profile starts at revision 1. Later-only history is not original evidence.
    if(originalPromise.revision!==1)throw new Error('K03_PROMISE_DENIED');
    const shipments=data.shipments.filter(s=>s.order_id===order.order_id&&s.position_id===order.position_id&&businessDate(s.dispatched_at)<end);
    const timely=shipments.filter(s=>instantMicros(s.dispatched_at)<=instantMicros(originalPromise.promised_dispatch_at)).reduce((n,s)=>n+s.quantity,0);
    const dispatched=shipments.reduce((n,s)=>n+s.quantity,0);if(dispatched>order.quantity)throw new Error('K03_DELIVERY_QUANTITY_DENIED');
    ordered+=order.quantity;onTime+=timely;delivered+=dispatched;if(timely>=order.quantity)full++;
  }
  return {outcome:'ACCEPTED',profile:{id:'o2c-invoice-date-dispatch/v1',dateBasis:'INVOICE_DATE',dispatchBasis:'ORIGINAL_PROMISE_DISPATCH'},table:{rows},orderIntake:{dateBasis:'ORDER_ACCEPTED_DATE',netMinor:safeMinor(orders.reduce((n,o)=>n+BigInt(o.quantity)*BigInt(o.unit_net_minor),0n))},delivery:{orderedQuantity:ordered,dispatchedQuantity:delivered,openQuantity:ordered-delivered,onTimeQuantity:onTime,onTimeQuantityPercent:ordered?100*onTime/ordered:null,positionOtifPercent:orders.length?100*full/orders.length:null},customerReceipt:{outcome:Array.isArray(data.customer_receipts)&&data.customer_receipts.length>0?'UNKNOWN_CUSTOMER_RECEIPT_DEFINITION_NOT_QUALIFIED':'UNKNOWN_NO_CUSTOMER_RECEIPT_EVIDENCE'},producerPairing:'NOT_EXECUTED_LOCAL_FIXTURE_ONLY',partialSuccess:false};
}

// Exactly two documented local naming/shape mappings; not universal ERP conversion.
export function normalizeKnownO2cV1(input,mapping) {
  if(mapping==='canonical-local/v1')return structuredClone(input);
  if(!['common-snake-reference/v1','ks-camel-fixture/v1'].includes(mapping))throw new Error('K03_MAPPING_DENIED');
  const snake=(v)=>Array.isArray(v)?v.map(snake):(v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k.replace(/[A-Z]/g,c=>'_'+c.toLowerCase()),snake(x)])):v);
  const data=mapping==='ks-camel-fixture/v1'?snake(input):structuredClone(input);
  const scope=data.scope,order=data.sales_order;
  const identity=(row)=>({tenant_id:row.tenant_id??scope.tenant_id,entity_id:row.entity_id??scope.entity_id,order_id:row.order_id??order.id,position_id:row.order_position_id??row.line_id??order.line_id,...Object.fromEntries(['currency','quantity_unit','warehouse_id','item_id'].filter(k=>row[k]!==undefined).map(k=>[k,row[k]]))});
  const shipments=data.shipments.map(s=>({...identity(s),shipment_id:s.id,dispatched_at:s.dispatched_at,quantity:s.quantity,promise_revision:s.promise_revision,milestone:s.milestone??'DISPATCH'}));
  const documents=data.sales_documents.map(d=>({...identity(d),document_id:d.id,position_id:d.line_id,order_position_id:d.order_position_id??d.line_id,type:d.type,state:d.state??'ISSUED',invoice_date:d.invoice_date,quantity_absolute:d.quantity_absolute,net_absolute_minor:d.net_absolute_minor,correction_of:d.correction_of,...(d.currency!==undefined?{currency:d.currency}:{})}));
  return {id:data.id,revision:data.revision,schema:'kaleidosphere/o2c-invoice-date-dispatch/v1',scope,orders:[{...identity(order),order_id:order.id,position_id:order.line_id,accepted_at:order.accepted_at,quantity:order.quantity,unit_net_minor:order.unit_net_minor,promised_dispatch_at:order.promised_dispatch_at,promise_revision:order.promise_revision,...(order.promise_history?{promise_history:order.promise_history}:{})}],documents,shipments,customer_receipts:data.customer_receipts,documentStateBasis:'EXACT_PUBLIC_REFERENCE_INVOICE_CREDIT_NOT_LEDGER_POSTING'};
}
