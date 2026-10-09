#!/usr/bin/env node
// #317 runnable existing-connector synthetic PostgreSQL stock/result-owner path.
// No synthetic fallback; no source/hash/SQL override, network or productive effect.
import {PGlite} from '../.ks-journey-runtime/node_modules/@electric-sql/pglite/dist/index.js';
import {buildPgliteJourneyDatabase} from '../services/bi-control/src/business-bi/net-revenue-journey.mjs';
import {createOverdueSnapshotOwnerV1,compileOverdueStockPlanV1,executeOverdueStockPlanV1}
  from '../services/bi-control/src/business-bi/overdue-stock-plan-v1.mjs';
import {buildOverdueStockResultAdapterV1} from '../services/bi-control/src/business-bi/result-lineage-v1.mjs';
const args=process.argv.slice(2);
if (args.length!==0) throw new Error('OVERDUE_CLI_ARGUMENT_DENIED_NO_SQL_OR_SOURCE_OVERRIDE');
const engine=new PGlite();let owner;
try {
  owner=await createOverdueSnapshotOwnerV1({database:buildPgliteJourneyDatabase(engine),snapshotVariant:'COMPLETE',syntheticPrincipal:'BOTH'});
  const receipts=[];
  for (const [validCutoff,businessDate] of [['2026-06-30T23:59:59+02:00','2026-06-30'],['2026-07-31T23:59:59+02:00','2026-07-31']]) {
    const plan=compileOverdueStockPlanV1({owner,request:{tenantId:'SYN-TENANT-01',siteIds:['SYN_SITE_A','SYN_SITE_B'],validCutoff,knowledgeCutoff:validCutoff,businessDate,drilldownLimit:20}});
    const receipt=await executeOverdueStockPlanV1({owner,plan});
    if (receipt.execution.state==='DENIED') throw new Error(receipt.execution.reasonCode);
    receipts.push({plan,receipt,adapter:buildOverdueStockResultAdapterV1(receipt)});
  }
  process.stdout.write(JSON.stringify({schemaVersion:'kaleidosphere.business-bi/overdue-stock-actual-two-cutoff-product/v1',actualEngine:'REAL_POSTGRESQL',sourceScope:'OWN_SYNTHETIC_ONLY',receipts},null,2)+'\n');
} finally {owner?.retire();await engine.close();}
