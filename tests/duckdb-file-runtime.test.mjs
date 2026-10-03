import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('K02 pinned provisioner verifies the exact separately installed closure without loading DuckDB',()=>{
  const runtime=process.env.KS284_DUCKDB_RUNTIME??join(process.cwd(),'.ks-file-runtime');
  const out=spawnSync(process.execPath,['scripts/provision-duckdb-file-runtime.mjs','--verify','--runtime-root',runtime],{encoding:'utf8',timeout:10000});
  assert.equal(out.status,0,out.stderr);
  const r=JSON.parse(out.stdout);assert.equal(r.outcome,'VERIFIED');assert.equal(r.clientVersion,'1.5.6-r.1');assert.equal(r.engineVersion,'v1.5.6');assert.match(r.closureSha256,/^[a-f0-9]{64}$/);assert.equal(r.engineLoaded,false);
});
test('K02 provisioner refuses missing closure without pretending an engine PASS',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ks284-empty-runtime-'));try{
    const out=spawnSync(process.execPath,['scripts/provision-duckdb-file-runtime.mjs','--verify','--runtime-root',dir],{encoding:'utf8',timeout:3000});
    assert.equal(out.status,1);assert.equal(JSON.parse(out.stdout).outcome,'DENIED');assert.equal(out.stderr,'');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
