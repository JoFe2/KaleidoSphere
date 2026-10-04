import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {deriveProcurementV1} from '../services/bi-control/src/business-bi/procurement-analysis.mjs';
const fixture=()=>JSON.parse(readFileSync(new URL('../examples/p2p/common-trade-01.json',import.meta.url)));

test('K04 actual bounded CLI independently exposes exact COMMON procurement values and no native reference-only claim',()=>{
 const p=spawnSync(process.execPath,['scripts/run-procurement-analysis.mjs','--fixture','COMMON-TRADE-01'],{encoding:'utf8',timeout:5000});
 assert.equal(p.status,0,'K04 procurement CLI is missing or failed: '+p.stderr);const r=JSON.parse(p.stdout);
 assert.equal(r.outcome,'COMPLETE');assert.equal(r.lines[0].price.varianceMinor,2000);assert.equal(r.lines[0].timing.onTimeAccepted,8);assert.equal(r.source.syntheticOnly,true);
 assert.equal(r.producerPairing,'NOT_EXECUTED_LOCAL_COMMON_REFERENCE_ONLY');assert.equal(r.source.sha256,'2b76e8537646f727b75b157a3b5529a44b94e2e8ee551b5fcef9f5d3bd3c8160');
 assert.deepEqual(r.table.rows,r.export.rows);
});

async function builder(){let m;try{m=await import('../services/bi-control/src/business-bi/procurement-analysis-views.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}assert.equal(typeof m?.buildProcurementViewsV1,'function','K04 actual procurement views are absent');return m.buildProcurementViewsV1;}

test('K04 a formatting-only view never promotes caller pair metadata to native proof or raw rights',async()=>{
 const build=await builder(),r=deriveProcurementV1(fixture());r.pair={sourceSnapshot:{fake:true},productiveAuthority:true};
 const v=build(r);assert.equal(v.drilldown.sourceClass,'DATA_VIEWS_NOT_SOURCE_OR_RIGHTS_AUTHORITY');assert.equal(v.drilldown.rawInvoiceDocumentAccess,false);
});
test('K04 UNKNOWN price cells remain null in actual table/CSV/chart while known quantity still renders',async()=>{
 const build=await builder(),f=fixture();delete f.purchase_order.unit_net_minor;const v=build(deriveProcurementV1(f)),r=v.table.rows.find(x=>x.metric==='varianceMinor');
 assert.equal(r.state,'UNKNOWN');assert.equal(r.value,null);assert.ok(v.export.csv.includes('"varianceMinor","UNKNOWN","","EUR_MINOR"'));assert.doesNotMatch(v.chart.svg,/data-metric="varianceMinor"/);assert.match(v.chart.svg,/data-metric="accepted" data-value="10"/);
});

test('K04 actual reference table/chart/permitted fact-lineage/CSV carry the same2000/8 rather than invoice fanout',async()=>{
 const build=await builder(),r=deriveProcurementV1(fixture()),views=build(r);
 assert.deepEqual(views.chart.rows,views.table.rows);assert.deepEqual(views.export.rows,views.table.rows);assert.deepEqual(views.drilldown.rows,views.table.rows);
 const row=name=>views.table.rows.find(r=>r.metric===name);assert.equal(row('varianceMinor').value,2000);assert.equal(row('onTimeAccepted').value,8);assert.equal(row('accepted').value,10);
 assert.ok(views.export.csv.includes('"varianceMinor","KNOWN","2000","EUR_MINOR"'));assert.match(views.chart.svg,/data-metric="onTimeAccepted" data-value="8"/);assert.equal(views.drilldown.rawInvoiceDocumentAccess,false);
});
