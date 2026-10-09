// Original #317: actual pinned PostgreSQL, independent scalar oracle, owner/snapshot/scope negatives.
// There is NO mock SQL result and NO absent-runtime skip/fallback on this required product route.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {PGlite} from '../.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {canonicalJson} from '../services/bi-control/src/canonical-json.js';
import {buildPgliteJourneyDatabase} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import {mapOverdueSnapshotV1,normalizeOverdueInstantV1} from '../services/bi-control/src/business-bi/overdue-stock-mapping-v1.mjs';
import {createOverdueSnapshotOwnerV1,compileOverdueStockPlanV1,executeOverdueStockPlanV1} from '../services/bi-control/src/business-bi/overdue-stock-plan-v1.mjs';
import {buildOverdueStockResultAdapterV1} from '../services/bi-control/src/business-bi/result-lineage-v1.mjs';
const sourceBytes=readFileSync(new URL('../contracts/business-bi/v1/overdue.synthetic-source-v1.json',import.meta.url));
const source=JSON.parse(sourceBytes);
const oracle=JSON.parse(readFileSync(new URL('./fixtures/business-bi/overdue-stock-oracle-v1.json',import.meta.url)));
const digest=(v)=>createHash('sha256').update(canonicalJson(v)).digest('hex');
const clone=(v)=>JSON.parse(JSON.stringify(v));
async function context(fn,{principal='BOTH',variant='COMPLETE',decorate=(d)=>d}={}) {
  const engine=new PGlite();let owner;
  try {
    const database=decorate(buildPgliteJourneyDatabase(engine));
    owner=await createOverdueSnapshotOwnerV1({database,snapshotVariant:variant,syntheticPrincipal:principal});
    return await fn({owner,database,engine,plan:(request)=>compileOverdueStockPlanV1({owner,request}),run:async(request)=>executeOverdueStockPlanV1({owner,plan:compileOverdueStockPlanV1({owner,request})})});
  } finally {owner?.retire();await engine.close();}
}
function projected(result) {return Object.fromEntries(Object.keys(oracle.cases.JUNE.expected).map((k)=>[k,result[k]]));}
for (const [name,example] of Object.entries(oracle.cases)) test(`actual PostgreSQL stock ${name} equals independent aware-time scalar oracle`,async()=> {
  await context(async({run})=> {
    const receipt=await run(example.request);
    assert.notEqual(receipt.execution.state,'DENIED',receipt.execution.reasonCode);
    assert.equal(receipt.execution.engine,'REAL_POSTGRESQL');
    assert.equal(receipt.execution.transactionReadOnly,'on');assert.equal(receipt.execution.defaultTransactionReadOnly,'on');
    assert.equal(receipt.execution.realLeastPrivilegePrincipal,'NOT_VERIFIED_NOT_CLAIMED');
    assert.deepEqual(projected(receipt.result),example.expected);
    assert.equal(receipt.bindings.resultSHA256,digest(receipt.result));
    assert.equal(receipt.bindings.resultRevision,digest({planSHA256:receipt.bindings.planSHA256,resultSHA256:receipt.bindings.resultSHA256}));
  },{principal:name.includes('SITE_A')||name.startsWith('DST_')?'SITE_A':'BOTH'});
});
test('fixed oracle independently recomputes with Python and matches exact input bytes',()=> {
  assert.equal(oracle.sourceBytesSHA256,createHash('sha256').update(sourceBytes).digest('hex'));
  const actual=JSON.parse(execFileSync('python3',['scripts/calculate-overdue-stock-oracle-v1.py','--check'],{encoding:'utf8'}));
  assert.equal(actual.oracle,'EXACT');assert.equal(actual.cases,Object.keys(oracle.cases).length);
});
test('pre-persist UTC normalization: native stored instant strings canonical; business dates retained separately',async()=> {
  await context(async({database})=> {
    for (const name of ['invoices','payments','adjustments']) {
      const rows=(await database.query(`SELECT data FROM synthetic_bi.overdue_${name}_v1`)).rows;
      for(const {data}of rows) for(const key of ['validAt','knownAt']) assert.match(data[key],/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
    const month=(await database.query("SELECT data FROM synthetic_bi.overdue_payments_v1 WHERE record_id='P-MONTH'")).rows[0].data;
    assert.equal(month.validAt,'2026-06-30T22:00:00.000Z');
    const invoice=(await database.query("SELECT data FROM synthetic_bi.overdue_invoices_v1 WHERE record_id='I-02' AND tenant_id='SYN-TENANT-01'")).rows[0].data;
    assert.equal(invoice.invoiceDate,'2026-06-01');assert.equal(invoice.dueDate,'2026-06-30');
  });
  for(const bad of ['2026-06-30T22:00:00','2026-02-30T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:00:00+14:30']) assert.throws(()=>normalizeOverdueInstantV1(bad),/OVERDUE_/);
});
test('raw offset text sorting gives the wrong DST order; real SQL uses normalized instants instead',async()=> {
  const early=source.payments.find((x)=>x.paymentId==='P-DST-EARLY'),late=source.payments.find((x)=>x.paymentId==='P-DST-LATER');
  assert.ok(late.validAt<early.validAt,'negative premise must actually be text-inverted');
  assert.ok(normalizeOverdueInstantV1(early.validAt)<normalizeOverdueInstantV1(late.validAt));
  await context(async({run})=> {
    const receipts=[];for(const key of ['DST_BEFORE','DST_EARLY','DST_LATER'])receipts.push(await run(oracle.cases[key].request));
    assert.deepEqual(receipts.map((x)=>x.result.knownSubset.overdueAmountMinorUnits),['9500','8500','6500']);
  },{principal:'SITE_A'});
});
test('equivalent-offset requests canonicalize to identical plan/result revisions on the SAME snapshot owner',async()=> {
  await context(async({run,plan})=> {
    const a=plan(oracle.cases.JUNE.request),b=plan(oracle.cases.EQUIVALENT_JUNE_UTC.request);
    assert.equal(a.planSHA256,b.planSHA256);assert.deepEqual(a.request,b.request);
    const ra=await run(oracle.cases.JUNE.request),rb=await run(oracle.cases.EQUIVALENT_JUNE_UTC.request);
    assert.equal(ra.bindings.actualSnapshotSHA256,rb.bindings.actualSnapshotSHA256);assert.equal(ra.bindings.resultRevision,rb.bindings.resultRevision);
  });
});
test('backdated event requires separately later knowledge; historical restatement has a NEW bound plan/result',async()=> {
  await context(async({run})=> {
    const original=await run(oracle.cases.JUNE.request),restated=await run(oracle.cases.BACKDATED_RESTATEMENT.request);
    assert.equal(original.bindings.actualSnapshotSHA256,restated.bindings.actualSnapshotSHA256);
    assert.notEqual(original.bindings.planSHA256,restated.bindings.planSHA256);assert.notEqual(original.bindings.resultRevision,restated.bindings.resultRevision);
    assert.equal(original.result.knownSubset.overdueAmountMinorUnits,'21000');assert.equal(restated.result.knownSubset.overdueAmountMinorUnits,'20000');
  });
});
test('missing history yields honest UNKNOWN with no totals/counts/drilldown, not a zero or scoped PASS',async()=> {
  await context(async({run})=> {
    const r=await run(oracle.cases.JUNE.request);assert.equal(r.execution.state,'UNKNOWN');assert.equal(r.result.reasonCode,'HISTORY_INCOMPLETE');
    assert.equal(r.result.knownSubset,null);assert.equal(r.result.overdueAmountMinorUnits,null);assert.equal(r.result.overdueInvoiceCount,null);
    assert.equal(r.result.drilldownTotal,null);assert.deepEqual(r.result.drilldown,[]);assert.equal(r.result.overdueRatio,null);
  },{variant:'MISSING_HISTORY'});
});
test('scope/cardinality bound before query; SITE_A receives no foreign/siteB sums, counts or invoice IDs',async()=> {
  await context(async({run,plan})=> {
    const r=await run(oracle.cases.JUNE_SITE_A.request);
    assert.deepEqual(projected(r.result),oracle.cases.JUNE_SITE_A.expected);
    assert.equal(r.result.knownSubset.scopedInvoiceCount,4);assert.deepEqual(r.result.drilldown.map((x)=>x.invoice_id),['I-01']);
    for(const req of [{...oracle.cases.JUNE.request},{...oracle.cases.JUNE_SITE_A.request,tenantId:'SYN-FOREIGN-TENANT'},
      {...oracle.cases.JUNE_SITE_A.request,siteIds:['SYN_SITE_A','SYN_SITE_A']},
      {...oracle.cases.JUNE_SITE_A.request,drilldownLimit:0},{...oracle.cases.JUNE_SITE_A.request,drilldownLimit:21}]) assert.throws(()=>plan(req),/OVERDUE_REQUEST_SCOPE_OR_BOUND_DENIED/);
  },{principal:'SITE_A'});
});
test('drilldown bounded to one true invoice, truthful authorized total/truncation; never 1:n rows',async()=> {
  await context(async({run})=> {
    const r=await run({...oracle.cases.JUNE.request,drilldownLimit:1});
    assert.equal(r.result.drilldown.length,1);assert.equal(r.result.drilldownTotal,2);assert.equal(r.result.drilldownTruncated,true);
    assert.equal(r.result.drilldown[0].invoice_id,'I-01');assert.equal(r.result.knownSubset.overdueAmountMinorUnits,'21000');
  });
});
test('actual naive 1:n join demonstrably duplicates principal/credit; fixed executor aggregates first',async()=> {
  await context(async({database,run})=> {
    const r=await run(oracle.cases.JUNE.request),invoice=r.result.drilldown.find((x)=>x.invoice_id==='I-01');
    const naive=(await database.query(`SELECT SUM((i.data->>'amountMinorUnits')::bigint)::text AS principal,
      SUM((a.data->>'amountMinorUnits')::bigint)::text AS credited FROM synthetic_bi.overdue_invoices_v1 i
      JOIN synthetic_bi.overdue_payments_v1 p ON p.tenant_id=i.tenant_id AND p.data->>'invoiceId'=i.record_id
      JOIN synthetic_bi.overdue_adjustments_v1 a ON a.tenant_id=i.tenant_id AND a.data->>'invoiceId'=i.record_id
      WHERE i.tenant_id='SYN-TENANT-01' AND i.record_id='I-01' AND (p.data->>'validAt')::timestamptz <= $1::timestamptz
      AND (p.data->>'knownAt')::timestamptz <= $1::timestamptz AND (a.data->>'validAt')::timestamptz <= $1::timestamptz
      AND (a.data->>'knownAt')::timestamptz <= $1::timestamptz;`,['2026-06-30T21:59:59Z'])).rows[0];
    assert.deepEqual(naive,{principal:'20000',credited:'1000'});
    assert.equal(invoice.balance_minor_units,'6000');assert.equal(invoice.credited,'500');assert.equal(invoice.paid,'3500');assert.equal(invoice.payment_count,2);
  });
});
test('duplicate source IDs and wrong/missing unit/value semantics: reject wrong, preserve missing as UNKNOWN',async()=> {
  for(const mutate of [(s)=>s.invoices.push(clone(s.invoices[0])),(s)=>s.payments.push(clone(s.payments[0]))]) {
    const s=clone(source);mutate(s);assert.throws(()=>mapOverdueSnapshotV1(s),/OVERDUE_DUPLICATE_ID_DENIED/);
  }
  for(const mutate of [(s)=>s.invoices[0].unit='BASE_UNITS',(s)=>s.invoices[0].currency='USD',(s)=>s.invoices[0].amountMinorUnits=1.5]) {
    const s=clone(source);mutate(s);assert.throws(()=>mapOverdueSnapshotV1(s),/OVERDUE_(UNIT|CURRENCY|AMOUNT_INTEGER)_DENIED/);
  }
  await context(async({database,run})=> {
    const r=await run(oracle.cases.JUNE.request);assert.equal(r.result.knownSubset.unknownInvoiceCount,3);assert.equal(r.result.overdueAmountMinorUnits,null);
    await database.exec('SET default_transaction_read_only = off;');
    await assert.rejects(()=>database.query("INSERT INTO synthetic_bi.overdue_invoices_v1 SELECT tenant_id,record_id,data FROM synthetic_bi.overdue_invoices_v1 WHERE tenant_id='SYN-TENANT-01' AND record_id='I-01';"),(e)=>e.code==='23505');
    await database.exec('SET default_transaction_read_only = on;');assert.notEqual((await run(oracle.cases.JUNE.request)).execution.state,'DENIED');
  });
});
test('changed actual DB data under old digest denied; new caller hash cannot authorize a replaced snapshot/plan',async()=> {
  await context(async({owner,database,plan})=> {
    const issued=plan(oracle.cases.JUNE.request);
    const forged=clone(issued);forged.actualSnapshotSHA256='0'.repeat(64);forged.planSHA256=digest(forged);
    assert.equal((await executeOverdueStockPlanV1({owner,plan:forged})).execution.state,'DENIED');
    await database.exec('SET default_transaction_read_only = off;');
    await database.query("UPDATE synthetic_bi.overdue_invoices_v1 SET data=jsonb_set(data,'{amountMinorUnits}','\"10001\"'::jsonb) WHERE tenant_id='SYN-TENANT-01' AND record_id='I-01';");
    await database.exec('SET default_transaction_read_only = on;');
    const changed=await executeOverdueStockPlanV1({owner,plan:issued});assert.equal(changed.execution.reasonCode,'OVERDUE_SNAPSHOT_DRIFT_DENIED');assert.equal(changed.result,null);
    const callerhash=digest((await database.query('SELECT data FROM synthetic_bi.overdue_invoices_v1')).rows);
    const rehashed=await executeOverdueStockPlanV1({owner,plan:issued,snapshotSHA256:callerhash});assert.equal(rehashed.execution.state,'DENIED');assert.equal(rehashed.result,null);
    await assert.rejects(()=>createOverdueSnapshotOwnerV1({database,snapshotVariant:'COMPLETE',syntheticPrincipal:'BOTH',sourceBytes,sourceSHA256:callerhash}),/OVERDUE_OWNER_INPUT_DENIED/);
  });
});
test('actual metadata-key identity replacement is denied under the old snapshot identity',async()=> {
  await context(async({owner,database,plan})=> {
    const issued=plan(oracle.cases.JUNE.request);
    await database.exec('SET default_transaction_read_only = off;');
    await database.query("UPDATE synthetic_bi.overdue_metadata_v1 SET record_id='OTHER_SNAPSHOT';");
    await database.exec('SET default_transaction_read_only = on;');
    const r=await executeOverdueStockPlanV1({owner,plan:issued});assert.equal(r.execution.state,'DENIED');assert.equal(r.result,null);
  });
});
test('actual READ ONLY SQL write rejection leaves the actual source unchanged',async()=> {
  await context(async({database,run})=> {
    const before=(await database.query('SELECT data FROM synthetic_bi.overdue_invoices_v1 ORDER BY tenant_id,record_id;')).rows;
    await assert.rejects(()=>database.query("UPDATE synthetic_bi.overdue_invoices_v1 SET data='{}'::jsonb;"),(e)=>e.code==='25006');
    const after=(await database.query('SELECT data FROM synthetic_bi.overdue_invoices_v1 ORDER BY tenant_id,record_id;')).rows;
    assert.deepEqual(after,before);assert.notEqual((await run(oracle.cases.JUNE.request)).execution.state,'DENIED');
  });
});
test('constructor actual SQL fault rolls back all owned seeding/schema effects; no partial source retained',async()=> {
  const engine=new PGlite(),base=buildPgliteJourneyDatabase(engine);
  try {
    const database={...base,async query(sql,values){const result=await base.query(sql,values);if(sql.startsWith('INSERT INTO synthetic_bi.overdue_payments_v1'))throw new Error('OWN_CONSTRUCTOR_AFTER_ACTUAL_INSERT_FAULT');return result;}};
    await assert.rejects(()=>createOverdueSnapshotOwnerV1({database,snapshotVariant:'COMPLETE',syntheticPrincipal:'BOTH'}),/OWN_CONSTRUCTOR_AFTER_ACTUAL_INSERT_FAULT/);
    const rows=(await base.query("SELECT COUNT(*)::integer AS n FROM pg_catalog.pg_namespace WHERE nspname='synthetic_bi';")).rows;
    assert.equal(rows[0].n,0,'actual constructor cleanup must remove its transaction-created schema/tables/rows');
  } finally {await engine.close();}
});
test('owner retirement after actual query response denies commit/projection; cloned/rehashed result adapter refused',async()=> {
  let actualOwner,retireAfterSummary=false;
  await context(async({owner,run})=> {
    actualOwner=owner;
    const r=await run(oracle.cases.JUNE.request),a=buildOverdueStockResultAdapterV1(r);
    assert.equal(a.resultRevision,r.bindings.resultRevision);assert.strictEqual(a.result,r.result);
    assert.equal(a.runtimeAuthority,'PORTABLE_JSON_IS_IDENTITY_NOT_AUTHORITY_USE_PROTECTED_OWNER_READ');
    const forged=clone(r);forged.result.knownSubset.overdueAmountMinorUnits='99999';forged.bindings.resultSHA256=digest(forged.result);
    assert.throws(()=>buildOverdueStockResultAdapterV1(forged),/OVERDUE_/);
    assert.throws(()=>{a.result.state='COMPLETE';},TypeError);
    retireAfterSummary=true;const denied=await run(oracle.cases.JUNE.request);
    assert.equal(denied.execution.state,'DENIED');assert.equal(denied.result,null);
    assert.throws(()=>buildOverdueStockResultAdapterV1(r),/OVERDUE_OWNER_RETIRED_OR_FOREIGN_DENIED/);
  },{decorate:(base)=>({...base,async query(sql,args){const actual=await base.query(sql,args);if(retireAfterSummary&&sql.includes('AS scoped_invoice_count'))actualOwner.retire();return actual;}})});
});
test('actual CLI composes existing PostgreSQL connector, stock-plan and lineage owner for two cutoffs',()=> {
  const d=JSON.parse(execFileSync('node',['scripts/run-overdue-stock-journey-v1.mjs'],{encoding:'utf8'}));
  assert.equal(d.actualEngine,'REAL_POSTGRESQL');assert.equal(d.receipts.length,2);
  for(const [i,key]of ['JUNE','JULY'].entries()) {
    assert.deepEqual(projected(d.receipts[i].receipt.result),oracle.cases[key].expected);
    assert.equal(d.receipts[i].adapter.resultRevision,d.receipts[i].receipt.bindings.resultRevision);
  }
  assert.throws(()=>execFileSync('node',['scripts/run-overdue-stock-journey-v1.mjs','--sql','SELECT 1'],{stdio:'pipe'}),/Command failed/);
});
// RB317-1: same actual three accessor regressions as the preserved pre-fix RED probe.
const captureRequest=()=>({tenantId:'SYN-TENANT-01',siteIds:['SYN_SITE_A'],validCutoff:'2026-06-30T23:59:59+02:00',knowledgeCutoff:'2026-06-30T23:59:59+02:00',businessDate:'2026-06-30',drilldownLimit:1});
for(const field of ['tenantId','siteIds','drilldownLimit'])test(`RB317-1 ${field}: changing accessor cannot widen actual tenant/site/drilldown`,async()=>{
  const expectedSites=field==='tenantId'?['SYN_SITE_B']:['SYN_SITE_A'];
  await context(async({owner})=>{
    let reads=0;const request={...captureRequest(),siteIds:expectedSites};
    const values=field==='tenantId'?['SYN-TENANT-01','SYN-FOREIGN-TENANT']:field==='siteIds'?[['SYN_SITE_A'],['SYN_SITE_B']]:[1,100];
    const checkedReads=field==='tenantId'?1:field==='siteIds'?5:3;
    Object.defineProperty(request,field,{enumerable:true,get(){return values[++reads<=checkedReads?0:1];}});
    let plan;
    try{plan=compileOverdueStockPlanV1({owner,request});}
    catch(error){assert.equal(error.code,'OVERDUE_REQUEST_SCOPE_OR_BOUND_DENIED');return;}
    const receipt=await executeOverdueStockPlanV1({owner,plan});
    assert.equal(plan.request.tenantId,'SYN-TENANT-01');
    assert.deepEqual(plan.request.siteIds,expectedSites);
    assert.equal(plan.request.drilldownLimit,1);
    assert.notEqual(receipt.execution.state,'DENIED');
    assert.ok(receipt.result.drilldown.every(row=>expectedSites.includes(row.site_id)));
  },{principal:field==='tenantId'?'BOTH':'SITE_A'});
});
