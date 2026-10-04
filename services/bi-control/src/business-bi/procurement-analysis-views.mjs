// Formatting is not permission: native callers materialize only after actual opaque read.
const columns={quantity:['ordered','accepted','invoiced','receivedNotInvoiced','invoicedNotReceived'],price:['expectedNetMinor','invoiceNetMinor','varianceMinor'],timing:['onTimeAccepted','lateAccepted','unknownTimeAccepted','denominator']};
const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
const cell=v=>'"'+String(v??'').replaceAll('"','""')+'"';
export function buildProcurementViewsV1(result){
 if(!['COMPLETE','READ_COMPLETE_WITH_UNAVAILABLE_FACTS'].includes(result?.outcome)||result.profile!=='p2p-procurement/v1'||!Array.isArray(result.lines)||result.lines.length!==1||result.mutationAuthority!==false||result.invoiceMatcherImplemented!==false)throw new Error('K04_VIEW_DENIED');
 const rows=[];
 for(const line of result.lines){
  if(line.po_id!=='PO-01'||line.po_line_id!=='1')throw new Error('K04_VIEW_DENIED');
  for(const [question,names] of Object.entries(columns))for(const metric of names){
   const group=line[question],value=group[metric],known=Number.isSafeInteger(value),reason=known?'':group.reason??group.invoiceReason??'MISSING_QUALIFIED_FACT';
   rows.push({po_id:line.po_id,po_line_id:line.po_line_id,metric,state:known?'KNOWN':'UNKNOWN',value:known?value:null,unit:question==='price'?'EUR_MINOR':'STK',reason,question});
  }
 }
 const csv=[['po_id','po_line_id','metric','state','value','unit','reason','question'],...rows.map(r=>[r.po_id,r.po_line_id,r.metric,r.state,r.value,r.unit,r.reason,r.question])].map(r=>r.map(cell).join(',')).join('\n')+'\n';
 const domains=Object.fromEntries(['STK','EUR_MINOR'].map(unit=>[unit,Math.max(1,...rows.filter(r=>r.unit===unit&&r.state==='KNOWN').map(r=>Math.abs(r.value)))]));
 const plot=rows.map((r,i)=>{const y=64+i*30,width=r.state==='KNOWN'?300*Math.abs(r.value)/domains[r.unit]:0,x=r.value<0?480-width:480;return '<g><text x="12" y="'+y+'">'+esc(r.metric+': '+(r.state==='KNOWN'?r.value+' '+r.unit:'UNKNOWN '+r.reason))+'</text>'+(r.state==='KNOWN'?'<rect data-metric="'+esc(r.metric)+'" data-value="'+r.value+'" data-unit="'+esc(r.unit)+'" x="'+x+'" y="'+(y-16)+'" width="'+width+'" height="19" fill="#147d92"/>':'')+'</g>';}).join('');
 const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="'+(100+rows.length*30)+'" role="img"><title>PO-01 /1 procurement quantities, price and dated acceptance</title><text x="12" y="24">Independent STK and EUR_MINOR scales; UNKNOWN never plotted as zero</text>'+plot+'</svg>';
 return {table:{rows:structuredClone(rows)},chart:{rows:structuredClone(rows),domains,svg},export:{rows:structuredClone(rows),csv},drilldown:{kind:'SCOPED_FACT_LINEAGE_NOT_RAW_DOCUMENT_ACCESS',rows:structuredClone(rows),sourceClass:'DATA_VIEWS_NOT_SOURCE_OR_RIGHTS_AUTHORITY',sourceSnapshot:result.pair?structuredClone(result.pair.sourceSnapshot):null,rawInvoiceDocumentAccess:false}};
}
