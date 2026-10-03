import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
const root=process.cwd(),runtime=process.env.KS284_DUCKDB_RUNTIME??join(root,'.ks-file-runtime');
const files=['scripts/run-file-profile.mjs','scripts/run-duckdb-file-worker.mjs','services/bi-control/src/db-analyzer/duckdb-file-workflow.mjs','contracts/file-profile/duckdb-runtime-lock-v1.json','examples/file-profile/approved.csv'];
// Reuse the independently qualified exact probes; do not invent a replacement engine.
// These are boundary fault injections, NOT an unmodified final-worker acceptance.
const pins={
  'executor-probe-worker.mjs':'a3a933cd9fdff9db05cea66aa2470f9013eae7ce93fe4f79695efe609e117599',
  'duckdb-memory-probe.mjs':'a6812d2e54f421c0c714ff0ef9e90c61fc977b3b65c0248732a29be00fcb1684',
  'worker-timeout-probe.mjs':'d8ab844dd8343a1a7ac199c16bddc9d42b7eff58cf435cebdc36912a1271458e',
  'worker-output-limit-probe.mjs':'4d049980b7badf0d4988318dad5cf250beada616c2c5efe33278896e231daae6',
};
function probe(name,check) {
  const dir=mkdtempSync(join(tmpdir(),'ks284-boundary-'));
  try {
    for(const p of files){mkdirSync(dirname(join(dir,p)),{recursive:true});copyFileSync(join(root,p),join(dir,p));}
    const worker=readFileSync(join(root,'tests/fixtures/file-profile',name));
    assert.equal(createHash('sha256').update(worker).digest('hex'),pins[name]);
    if(name==='executor-probe-worker.mjs'||name==='duckdb-memory-probe.mjs'){
      const actual=readFileSync(join(root,'scripts/run-duckdb-file-worker.mjs'),'utf8');
      const init=actual.slice(0,actual.indexOf("  const engine ="));
      assert.ok(worker.toString().startsWith(init),'qualified initialization remains exactly unchanged');
    }
    writeFileSync(join(dir,'scripts/run-duckdb-file-worker.mjs'),worker);
    writeFileSync(join(dir,'outside-oracle.txt'),'EXISTS_OUTSIDE_EXECUTOR');
    const before=readFileSync(join(dir,'examples/file-profile/approved.csv'));
    const started=performance.now();
    const out=spawnSync(process.execPath,[join(dir,'scripts/run-file-profile.mjs'),'--source','examples/file-profile/approved.csv','--question','sum-units-by-category','--mode','SCHEMA_INFERENCE','--runtime-root',runtime],{encoding:'utf8',timeout:12000,env:{...process.env,TMPDIR:dir}});
    assert.equal(out.error,undefined);assert.equal(out.stderr,'');
    check(out,JSON.parse(out.stdout),performance.now()-started);
    assert.deepEqual(readFileSync(join(dir,'examples/file-profile/approved.csv')),before);
    assert.equal(existsSync(join(dir,'result.csv')),false);
    assert.equal(readdirSync(dir).some(n=>n.startsWith('ks284-executor-')),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('K02 reused executing boundary: SQL reads/network/INSTALL/LOAD/COPY/unlock plus kernel write/read/TCP refusals',()=>{
  probe('executor-probe-worker.mjs',(out,result)=>{
    assert.equal(out.status,0);const checks=result.schema.probeChecks;
    assert.deepEqual(checks.map(c=>c.name),['unwanted-read','network-read','extension-install','extension-load','source-overwrite','configuration-unlock','native-source-write','unmounted-oracle','kernel-network']);
    assert.ok(checks.every(c=>c.denied));assert.equal(checks[6].code,'EROFS');assert.equal(checks[7].code,'ENOENT');assert.ok(['ENETUNREACH','EHOSTUNREACH','EPERM','EACCES'].includes(checks[8].code));
  });
});
test('K02 reused real DuckDB 64MB memory-boundary OOM refusal',()=>{
  probe('duckdb-memory-probe.mjs',(out,result)=>{assert.equal(out.status,0);assert.deepEqual(result.schema.memoryProbe,{denied:true,oom:true});});
});
function denied(out,result){assert.equal(out.status,1);assert.equal(result.outcome,'DENIED');assert.equal(result.reasonCode,'K02_EXECUTOR_DENIED');assert.equal(result.partialSuccess,false);assert.equal(result.table,null);assert.equal(result.export,null);assert.match(result.diagnostic,/Budget|budget/);}
test('K02 reused executing wall-time limit kills infinite child and removes its scratch',()=>{
  probe('worker-timeout-probe.mjs',(out,result,elapsed)=>{denied(out,result);assert.ok(elapsed>=5000&&elapsed<10000,'actual 5-second executor deadline, not a simulated denial');});
});
test('K02 reused executing output limit denies 100k stdout without partial results',()=>{
  probe('worker-output-limit-probe.mjs',denied);
});
