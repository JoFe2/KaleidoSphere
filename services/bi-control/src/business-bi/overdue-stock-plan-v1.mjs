// #317: a fixed synthetic stock operation added to the existing business-bi plan owner.
// Existing #237 mapping and actual PostgreSQL connector/READ ONLY proof are consumed.
// No arbitrary SQL/source bytes/caller digests, new BI engine or real permission assertion.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {canonicalJson} from '../canonical-json.js';
import {mapOverdueSnapshotV1, normalizeOverdueInstantV1, normalizeOverdueBusinessDateV1,
  OVERDUE_MAPPING_VERSION} from './overdue-stock-mapping-v1.mjs';
import {assertPostgresqlReadOnlySession} from '../db-analyzer/postgresql-adapter.mjs';
import {OVERDUE_QUERY_VERSION, OVERDUE_SUMMARY_SQL, OVERDUE_DRILLDOWN_SQL} from './overdue-stock-query-v1.mjs';

export const OVERDUE_PLAN_SCHEMA = 'kaleidosphere.business-bi/overdue-stock-plan/v1';
export const OVERDUE_RECEIPT_SCHEMA = 'kaleidosphere.business-bi/overdue-stock-execution-receipt/v1';
const SOURCE_BYTES_SHA256 = '55ef0bbfddc7de8b5472f782b3690e5e1cdf28cac03c943bad7f15f2a142c04a';
const METRIC_BYTES_SHA256 = '462433ab113d33be1c9af296a0ba4260643b23ad0ad12e10d5e4988d2758a7c7';
const sourceURL = new URL('../../../../contracts/business-bi/v1/overdue.synthetic-source-v1.json', import.meta.url);
const metricURL = new URL('../../../../contracts/business-bi/v1/overdue-stock.metric-v1.json', import.meta.url);
const hash = (b) => createHash('sha256').update(b).digest('hex');
const digest = (o) => hash(canonicalJson(o));
const copy = (o) => JSON.parse(canonicalJson(o));
const freeze = (o) => { if (o && typeof o === 'object') { for (const v of Object.values(o)) freeze(v); Object.freeze(o); } return o; };
const exact = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).sort().join('|') === [...keys].sort().join('|');
const fail = (suffix) => { const e = new Error(`OVERDUE_${suffix}`); e.code = e.message; throw e; };
const deny = (code) => freeze({schemaVersion:OVERDUE_RECEIPT_SCHEMA, execution:{state:'DENIED',reasonCode:code},result:null});
const owners = new WeakMap(), plans = new WeakMap(), receipts = new WeakMap(), databases = new WeakSet();
const rowIDs = {invoices:'invoiceId',payments:'paymentId',adjustments:'adjustmentId'};
const table = (name) => `synthetic_bi.overdue_${name}_v1`;
const queryTemplateSHA256 = hash(`${OVERDUE_SUMMARY_SQL}\0${OVERDUE_DRILLDOWN_SQL}`);
const metadataOf = (s) => Object.fromEntries(Object.entries(s).filter(([k]) => !Object.hasOwn(rowIDs,k)));
const alive = (p) => { if (!p || p.retired) fail('OWNER_RETIRED_OR_FOREIGN_DENIED'); };
async function actualSnapshot(p) {
  const meta = (await p.database.query('SELECT record_id, data FROM synthetic_bi.overdue_metadata_v1 ORDER BY record_id;')).rows;
  alive(p);
  if (!Array.isArray(meta) || meta.length !== 1 || meta[0].record_id !== 'SNAPSHOT') fail('SNAPSHOT_DRIFT_DENIED');
  const snapshot = {...meta[0].data};
  for (const [name,id] of Object.entries(rowIDs)) {
    const rows = (await p.database.query(`SELECT tenant_id, record_id, data FROM ${table(name)} ORDER BY tenant_id COLLATE "C", record_id COLLATE "C";`)).rows;
    alive(p);
    if (!Array.isArray(rows) || rows.length > 1000) fail('SNAPSHOT_DRIFT_DENIED');
    snapshot[name] = rows.map((r) => {
      if (r.tenant_id !== r.data?.tenantId || r.record_id !== r.data?.[id]) fail('SNAPSHOT_DRIFT_DENIED');
      return r.data;
    });
  }
  // SQL ordering is immaterial to the canonical snapshot identity; close over ALL actual data/keys.
  for (const [name,id] of Object.entries(rowIDs)) snapshot[name].sort((a,b) => `${a.tenantId}|${a[id]}`.localeCompare(`${b.tenantId}|${b[id]}`, 'en'));
  if (digest(snapshot) !== p.snapshotSHA256) fail('SNAPSHOT_DRIFT_DENIED');
  return snapshot;
}
export async function createOverdueSnapshotOwnerV1(input) {
  if (!exact(input,['database','snapshotVariant','syntheticPrincipal'])) fail('OWNER_INPUT_DENIED');
  const {database,snapshotVariant,syntheticPrincipal} = input;
  if (!database || typeof database.query !== 'function' || typeof database.exec !== 'function'
    || database.mode?.() !== 'REAL_POSTGRESQL' || databases.has(database)) fail('REAL_DATABASE_REQUIRED');
  if (!['COMPLETE','MISSING_HISTORY'].includes(snapshotVariant)
    || !['SITE_A','BOTH'].includes(syntheticPrincipal)) fail('SYNTHETIC_SCOPE_DENIED');
  const sourceBytes = readFileSync(sourceURL), metricBytes = readFileSync(metricURL);
  if (hash(sourceBytes) !== SOURCE_BYTES_SHA256 || hash(metricBytes) !== METRIC_BYTES_SHA256) fail('SHIPPED_INPUT_DRIFT_DENIED');
  const source = JSON.parse(sourceBytes);
  if (snapshotVariant === 'MISSING_HISTORY') {
    source.historyCompleteFrom = '2026-06-01T00:00:00Z';
    source.snapshotId += ':MISSING_HISTORY';
    source.sourceRevision += ':MISSING_HISTORY';
  }
  // Normalization occurs BEFORE the very first INSERT. No raw offset text is persisted.
  const snapshot = freeze(mapOverdueSnapshotV1(source));
  const p = {database, snapshotSHA256:digest(snapshot), snapshot, metric:freeze(JSON.parse(metricBytes)),
    sourceBytesSHA256:SOURCE_BYTES_SHA256, metricBytesSHA256:METRIC_BYTES_SHA256,
    allowedSites:freeze(syntheticPrincipal === 'SITE_A' ? ['SYN_SITE_A'] : ['SYN_SITE_A','SYN_SITE_B']),
    syntheticPrincipal, retired:false, busy:false};
  databases.add(database);
  let seedTransaction = false;
  try {
    await database.exec('BEGIN READ WRITE;'); seedTransaction = true;
    await database.exec('CREATE SCHEMA IF NOT EXISTS synthetic_bi;');
    await database.exec('CREATE TABLE synthetic_bi.overdue_metadata_v1(record_id text PRIMARY KEY, data jsonb NOT NULL);');
    await database.query('INSERT INTO synthetic_bi.overdue_metadata_v1(record_id,data) VALUES ($1,$2::jsonb);',['SNAPSHOT',canonicalJson(metadataOf(snapshot))]);
    for (const [name,id] of Object.entries(rowIDs)) {
      await database.exec(`CREATE TABLE ${table(name)}(tenant_id text NOT NULL, record_id text NOT NULL, data jsonb NOT NULL, PRIMARY KEY(tenant_id,record_id));`);
      for (const row of snapshot[name]) await database.query(`INSERT INTO ${table(name)}(tenant_id,record_id,data) VALUES ($1,$2,$3::jsonb);`,[row.tenantId,row[id],canonicalJson(row)]);
    }
    await actualSnapshot(p); // actual reread, never a "seeded successfully" assertion
    // SET is transaction-bound: a constructor failure also restores the prior session setting.
    await database.exec('SET default_transaction_read_only = on;');
    await database.exec('COMMIT;'); seedTransaction = false;
  } catch (error) {
    if (seedTransaction) await database.exec('ROLLBACK;');
    databases.delete(database);
    throw error;
  }
  const owner = freeze({schemaVersion:'kaleidosphere.business-bi/overdue-stock-owner/v1',
    classification:'SYNTHETIC_NON_CUSTOMER_BYTES', retire() { p.retired = true; }});
  owners.set(owner,p);
  return owner;
}
export function compileOverdueStockPlanV1({owner,request} = {}) {
  const p = owners.get(owner); alive(p);
  const requestKeys=['tenantId','siteIds','validCutoff','knowledgeCutoff','businessDate','drilldownLimit'];
  if (!exact(request,requestKeys)) fail('REQUEST_SCOPE_OR_BOUND_DENIED');
  // Capture own data descriptors once: no getter can split validation from plan/SQL binding.
  const fields=Object.getOwnPropertyDescriptors(request), captured={};
  for (const key of requestKeys) {
    if (!fields[key] || !Object.hasOwn(fields[key],'value')) fail('REQUEST_SCOPE_OR_BOUND_DENIED');
    captured[key]=fields[key].value;
  }
  if (!Array.isArray(captured.siteIds)) fail('REQUEST_SCOPE_OR_BOUND_DENIED');
  const sites=Object.getOwnPropertyDescriptors(captured.siteIds), length=sites.length?.value;
  if (!Number.isInteger(length) || length < 1 || length > p.allowedSites.length) fail('REQUEST_SCOPE_OR_BOUND_DENIED');
  captured.siteIds=[];
  for (let i=0;i<length;i++) {
    if (!sites[i] || !Object.hasOwn(sites[i],'value')) fail('REQUEST_SCOPE_OR_BOUND_DENIED');
    captured.siteIds.push(sites[i].value);
  }
  request=captured;
  if (request.tenantId !== 'SYN-TENANT-01' || !Array.isArray(request.siteIds) || request.siteIds.length < 1
    || new Set(request.siteIds).size !== request.siteIds.length || request.siteIds.some((x) => !p.allowedSites.includes(x))
    || !Number.isInteger(request.drilldownLimit) || request.drilldownLimit < 1 || request.drilldownLimit > 20) fail('REQUEST_SCOPE_OR_BOUND_DENIED');
  const normalized = {tenantId:request.tenantId,siteIds:[...request.siteIds].sort(),
    validCutoff:normalizeOverdueInstantV1(request.validCutoff),knowledgeCutoff:normalizeOverdueInstantV1(request.knowledgeCutoff),
    businessDate:normalizeOverdueBusinessDateV1(request.businessDate),drilldownLimit:request.drilldownLimit};
  const body = {schemaVersion:OVERDUE_PLAN_SCHEMA,operationId:'HISTORICAL_OVERDUE_RECEIVABLES_STOCK/v1',
    metricId:p.metric.metricId,metricVersion:p.metric.metricVersion,metricBytesSHA256:p.metricBytesSHA256,
    mappingVersion:OVERDUE_MAPPING_VERSION,queryVersion:OVERDUE_QUERY_VERSION,queryTemplateSHA256,
    actualSnapshotSHA256:p.snapshotSHA256,sourceBytesSHA256:p.sourceBytesSHA256,
    sourceId:p.snapshot.sourceId,sourceRevision:p.snapshot.sourceRevision,snapshotId:p.snapshot.snapshotId,
    principal:{classification:'OWN_SYNTHETIC_SCOPE_NOT_REAL_PERMISSION',syntheticPrincipal:p.syntheticPrincipal},request:normalized};
  const plan = freeze({...body,planSHA256:digest(body)});
  plans.set(plan,{owner,p,values:[normalized.tenantId,normalized.siteIds,normalized.validCutoff,normalized.knowledgeCutoff,normalized.businessDate],
    queryBindingSHA256:digest({summarySQL:OVERDUE_SUMMARY_SQL,drilldownSQL:OVERDUE_DRILLDOWN_SQL,parameters:normalized})});
  return plan;
}
const integerString = (s) => typeof s === 'string' && /^\d+$/.test(s);
function checkedSummary(rows) {
  if (!Array.isArray(rows) || rows.length !== 1) fail('QUERY_CARDINALITY_DENIED');
  const r = rows[0];
  const countKeys=['scoped_invoice_count','unknown_invoice_count','known_open_count','known_overdue_count','cancelled_invoice_count','credit_balance_invoice_count'];
  const amountKeys=['known_overdue_minor_units','known_open_minor_units','credit_balance_minor_units'];
  if (!exact(r,[...countKeys,...amountKeys]) || countKeys.some((k) => !Number.isInteger(r[k]) || r[k] < 0 || r[k] > 1000)
    || amountKeys.some((k) => !integerString(r[k])) || r.known_overdue_count > r.known_open_count
    || r.known_open_count + r.unknown_invoice_count + r.cancelled_invoice_count > r.scoped_invoice_count) fail('QUERY_RESULT_SHAPE_DENIED');
  return r;
}
function checkedDrilldown(rows,request,total) {
  if (!Array.isArray(rows) || rows.length > request.drilldownLimit || rows.length !== Math.min(total,request.drilldownLimit)) fail('DRILLDOWN_CARDINALITY_DENIED');
  const seen = new Set();
  return rows.map((r) => {
    if (!exact(r,['invoice_id','site_id','due_date','balance_minor_units','paid','credited','payment_count','adjustment_count'])
      || !request.siteIds.includes(r.site_id) || typeof r.invoice_id !== 'string' || seen.has(r.invoice_id)
      || !integerString(r.balance_minor_units) || BigInt(r.balance_minor_units) <= 0n
      || !integerString(r.paid) || !integerString(r.credited) || r.due_date >= request.businessDate
      || !Number.isInteger(r.payment_count) || !Number.isInteger(r.adjustment_count)) fail('DRILLDOWN_RESULT_DENIED');
    normalizeOverdueBusinessDateV1(r.due_date); seen.add(r.invoice_id);
    return copy(r);
  });
}
export async function executeOverdueStockPlanV1(input) {
  if (!exact(input,['owner','plan'])) return deny('OVERDUE_EXECUTION_INPUT_DENIED');
  const {owner,plan}=input, issued=plans.get(plan), p=owners.get(owner);
  if (!issued || issued.owner !== owner || issued.p !== p || !p || p.retired) return deny('OVERDUE_OPAQUE_PLAN_OR_OWNER_DENIED');
  if (p.busy) return deny('OVERDUE_OWNER_BUSY_DENIED');
  p.busy=true; let transaction=false;
  try {
    await p.database.exec('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;'); transaction=true;alive(p);
    const proof=(await p.database.query("SELECT current_setting('transaction_read_only') AS transaction_read_only, current_setting('default_transaction_read_only') AS default_transaction_read_only;")).rows;
    alive(p); assertPostgresqlReadOnlySession(proof);
    const snapshot=await actualSnapshot(p);alive(p);
    const summary=checkedSummary((await p.database.query(OVERDUE_SUMMARY_SQL,issued.values)).rows);alive(p);
    const drilldown=checkedDrilldown((await p.database.query(OVERDUE_DRILLDOWN_SQL,[...issued.values,plan.request.drilldownLimit])).rows,plan.request,summary.known_overdue_count);alive(p);
    const historyComplete = snapshot.historyCompleteFrom <= snapshot.historyRequiredFrom
      && snapshot.historyRequiredFrom <= plan.request.validCutoff && snapshot.historyCompleteThrough >= plan.request.validCutoff
      && snapshot.knowledgeCompleteThrough >= plan.request.knowledgeCutoff;
    const state = !historyComplete ? 'UNKNOWN' : summary.unknown_invoice_count > 0 ? 'PARTIAL' : 'COMPLETE';
    const knownSubset = !historyComplete ? null : {
      overdueAmountMinorUnits:summary.known_overdue_minor_units,overdueInvoiceCount:summary.known_overdue_count,
      openAmountMinorUnits:summary.known_open_minor_units,openInvoiceCount:summary.known_open_count,
      ratio:summary.known_open_count === 0 ? null : {numerator:summary.known_overdue_count,denominator:summary.known_open_count},
      ratioState:summary.known_open_count === 0 ? 'ZERO_DENOMINATOR' : 'KNOWN_SUBSET_RATIO',
      unknownInvoiceCount:summary.unknown_invoice_count,scopedInvoiceCount:summary.scoped_invoice_count,
      cancelledInvoiceCount:summary.cancelled_invoice_count,creditBalanceInvoiceCount:summary.credit_balance_invoice_count,
      creditBalanceMinorUnits:summary.credit_balance_minor_units};
    const result=freeze({schemaVersion:'kaleidosphere.business-bi/overdue-stock-result/v1',metricId:plan.metricId,metricVersion:1,
      state,reasonCode:!historyComplete?'HISTORY_INCOMPLETE':state==='PARTIAL'?'INVOICE_VALUE_OR_DUE_UNKNOWN':null,
      currency:'EUR',unit:'MINOR_UNITS',basis:'VALID_TIME_STOCK_NOT_COHORT',cutoffs:copy(plan.request),
      overdueAmountMinorUnits:state==='COMPLETE'?summary.known_overdue_minor_units:null,
      overdueInvoiceCount:state==='COMPLETE'?summary.known_overdue_count:null,
      overdueRatio:state==='COMPLETE'?knownSubset.ratio:null,knownSubset,
      drilldown:historyComplete?drilldown:[],drilldownTotal:historyComplete?summary.known_overdue_count:null,
      drilldownTruncated:historyComplete?summary.known_overdue_count>drilldown.length:null});
    const resultSHA256=digest(result), resultRevision=digest({planSHA256:plan.planSHA256,resultSHA256});
    await p.database.exec('COMMIT;');transaction=false;alive(p);
    const receipt=freeze({schemaVersion:OVERDUE_RECEIPT_SCHEMA,execution:{state,reasonCode:result.reasonCode,engine:'REAL_POSTGRESQL',
      transactionReadOnly:proof[0].transaction_read_only,defaultTransactionReadOnly:proof[0].default_transaction_read_only,
      realLeastPrivilegePrincipal:'NOT_VERIFIED_NOT_CLAIMED',sourceClassification:'SYNTHETIC_NON_CUSTOMER_BYTES'},
      bindings:{actualSnapshotSHA256:p.snapshotSHA256,sourceBytesSHA256:p.sourceBytesSHA256,sourceId:snapshot.sourceId,
        sourceRevision:snapshot.sourceRevision,snapshotId:snapshot.snapshotId,metricBytesSHA256:p.metricBytesSHA256,
        metricVersion:1,mappingVersion:OVERDUE_MAPPING_VERSION,queryVersion:OVERDUE_QUERY_VERSION,queryTemplateSHA256,
        actualQueryBindingSHA256:issued.queryBindingSHA256,planSHA256:plan.planSHA256,resultSHA256,resultRevision},result});
    receipts.set(receipt,{owner,p,resultSHA256,resultRevision});return receipt;
  } catch(error) {
    return deny(typeof error.code==='string' && error.code.startsWith('OVERDUE_')?error.code:'OVERDUE_ACTUAL_SQL_OR_READONLY_DENIED');
  } finally {
    if (transaction) await p.database.exec('ROLLBACK;').catch(()=>{});
    p.busy=false;
  }
}
export function assertOwnedOverdueReceiptV1(receipt) {
  const issued=receipts.get(receipt);alive(issued?.p);
  if (issued.p.retired || digest(receipt.result)!==issued.resultSHA256 || receipt.bindings.resultRevision!==issued.resultRevision) fail('RESULT_OWNER_OR_REVISION_DENIED');
  return receipt;
}
