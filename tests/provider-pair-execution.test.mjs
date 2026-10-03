import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { externalBiProviderProfileV1,validateProviderProfileV1,canonicalJson } from '../services/bi-agent/src/external-api-v2.mjs';
import { ingestProjectionProfile,validateRegistry } from '../services/bi-agent/src/pansphaira-analytics/pipeline.mjs';
import { createRetainedSourceAuthority,consumeOrderSourceHandoff } from '../services/bi-control/src/business-bi/order-source-consumption.mjs';

const root=process.cwd();
const registryPath='contracts/pansphaira-analytics/v1/release-registry.v1.json';
const source={sourceBytesFile:'tests/fixtures/business-bi/ks238-order-source/erp-supported-export-v1.json',contractFile:'tests/fixtures/business-bi/ks238-order-source/erp-read-contract-v1.json',sourceLabel:'LOCAL_SYNTHETIC_ERP_ORDER_SOURCE_V1',now:'2026-08-10T08:30:00Z',repoRoot:root};

test('J02 HELD projection denial remains exact while genuine released direct order-source handoff executes',async()=>{
  const before=readFileSync(registryPath);
  const registry=validateRegistry(JSON.parse(before));
  assert.equal(registry.entries[0].status,'HELD');
  validateProviderProfileV1(externalBiProviderProfileV1());
  const held=JSON.parse(readFileSync('tests/pansphaira-analytics-synthetic-profile-v1.json')).heldProfile;
  const denial=ingestProjectionProfile(Buffer.from(canonicalJson(held)),{registry});
  assert.equal(denial.state,'DENIED');assert.equal(denial.code,'XRA_KS01_RELEASE_HELD');
  assert.equal(denial.candidate,null);assert.equal(denial.successfulOrdinaryAnswer,false);
  const retained=createRetainedSourceAuthority(source);assert.equal(retained.ok,true);
  const direct=await consumeOrderSourceHandoff({retainedAuthority:retained.authority,repoRoot:root});
  assert.equal(direct.outcome,'CONSUMED',JSON.stringify(direct));
  assert(before.equals(readFileSync(registryPath)));
});

test('J02 actual missing source and disabled source rights do not block independent value-reading CLI analysis',async()=>{
  const before=readFileSync(registryPath);
  const missing=createRetainedSourceAuthority({...source,sourceBytesFile:'tests/fixtures/business-bi/ks238-order-source/nonexistent-source.json'});
  assert.equal(missing.ok,false);assert.equal(missing.code,'RETAINED_SOURCE_BYTES_MISSING');
  const deniedAuthority=createRetainedSourceAuthority({...source,enabled:false});assert.equal(deniedAuthority.ok,true);
  const noRights=await consumeOrderSourceHandoff({retainedAuthority:deniedAuthority.authority,repoRoot:root});
  assert.equal(noRights.outcome,'DENIED',JSON.stringify(noRights));
  assert.match(noRights.code,/DISABLED/);
  const runtime=process.env.KS284_DUCKDB_RUNTIME??join(root,'.ks-file-runtime');
  const dir=mkdtempSync(join(tmpdir(),'ks-j02-standalone-'));
  try{
    const output=join(dir,'result.csv');
    const p=spawnSync(process.execPath,['scripts/run-file-profile.mjs','--source','examples/file-profile/approved.csv','--question','sum-units-by-category','--runtime-root',runtime,'--export',output],{encoding:'utf8',timeout:10000});
    assert.equal(p.error,undefined);assert.equal(p.status,0,p.stderr+' '+p.stdout);
    const independent=JSON.parse(p.stdout);assert.equal(independent.outcome,'ACCEPTED');assert.equal(independent.dataReadPerformed,true);
    assert.deepEqual(independent.table.rows,[{category:'alpha',sum_units:'11',null_units:1},{category:'beta',sum_units:'5',null_units:0}]);
    assert.equal(readFileSync(output,'utf8'),'category,sum_units,null_units\nalpha,11,1\nbeta,5,0\n');
  }finally{rmSync(dir,{recursive:true,force:true});}
  validateProviderProfileV1(externalBiProviderProfileV1());
  assert(before.equals(readFileSync(registryPath)));
});
