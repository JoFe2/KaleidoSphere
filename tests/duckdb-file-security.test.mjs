import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, symlinkSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const root=process.cwd();
const runtime=process.env.KS284_DUCKDB_RUNTIME??join(root,'.ks-file-runtime');
const files=['scripts/run-file-profile.mjs','scripts/run-duckdb-file-worker.mjs','services/bi-control/src/db-analyzer/duckdb-file-workflow.mjs','contracts/file-profile/duckdb-runtime-lock-v1.json','examples/file-profile/approved.csv','examples/file-profile/approved.parquet'];
const hash=b=>createHash('sha256').update(b).digest('hex');
function snapshot() {
  const dir=mkdtempSync(join(tmpdir(),'ks284-security-'));
  for(const file of files){mkdirSync(dirname(join(dir,file)),{recursive:true});copyFileSync(join(root,file),join(dir,file));}
  return dir;
}
function cli(dir,extra=[],source='examples/file-profile/approved.csv',mode='FULL_READ_ONLY') {
  return spawnSync(process.execPath,[join(dir,'scripts/run-file-profile.mjs'),'--source',source,'--question','sum-units-by-category','--mode',mode,'--runtime-root',runtime,'--export',join(dir,'result.csv'),...extra],{encoding:'utf8',timeout:12000,env:{...process.env,TMPDIR:dir}});
}
function denied(out,code) {
  assert.equal(out.error,undefined);
  assert.equal(out.status,1);
  assert.equal(out.stderr,'');
  const result=JSON.parse(out.stdout);
  assert.equal(result.outcome,'DENIED');
  if(code)assert.equal(result.reasonCode,code);
  assert.equal(result.partialSuccess,false);
  assert.equal(result.table,null);
  assert.equal(result.export,null);
  assert.ok(result.diagnostic.length>30);
  return result;
}
for(const source of ['../examples/file-profile/approved.csv','examples/file-profile/../file-profile/approved.csv','https://example.invalid/source.csv','examples/file-profile/*.csv']) {
  test('K02 exact path authority denies '+source,()=>{const dir=snapshot();try{denied(cli(dir,[],source),'K02_SCOPE_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}});
}
for(const options of [['--mode','caller-admin'],['--question','arbitrary-sql'],['--role','admin'],['--sql','INSTALL httpfs']]) {
  test('K02 caller cannot expand authority with '+options[0]+'='+options[1],()=>{const dir=snapshot();try{denied(cli(dir,options));assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}});
}
test('K02 post-grant CSV type/content drift refuses before runtime and writes no result',()=>{
  const dir=snapshot();try{writeFileSync(join(dir,'examples/file-profile/approved.csv'),'category,units\nalpha,not-a-number\n');const d=denied(cli(dir,['--runtime-root','/not-needed']),'K02_SOURCE_IDENTITY_DRIFT');assert.match(d.diagnostic,/Dateibytes.*Freigabe/);assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 symlink source is refused without following its target',()=>{
  const dir=snapshot();try{const p=join(dir,'examples/file-profile/approved.csv');rmSync(p);symlinkSync('/nonexistent-outside-source.csv',p);denied(cli(dir),'K02_FILE_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 nonregular FIFO source refuses promptly before opening',()=>{
  const dir=snapshot();try{const p=join(dir,'examples/file-profile/approved.csv');rmSync(p);assert.equal(spawnSync('mkfifo',[p]).status,0);denied(cli(dir),'K02_FILE_DENIED');}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 source replacement by FIFO after path validation still refuses without blocking',()=>{
  const dir=snapshot();try {
    // A test-only deterministic race hook performs real filesystem replacement, not fake file data.
    const hook=join(dir,'race-hook.mjs');
    writeFileSync(hook,`import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {spawnSync} from 'node:child_process';
const original=fs.realpathSync;let fired=false;fs.realpathSync=function(path,...rest){const value=original(path,...rest);if(!fired&&String(path).endsWith('/examples/file-profile/approved.csv')){fired=true;fs.unlinkSync(path);if(spawnSync('mkfifo',[String(path)]).status!==0)throw new Error('race fixture failed');}return value;};syncBuiltinESMExports();`);
    const out=spawnSync(process.execPath,['--import',hook,join(dir,'scripts/run-file-profile.mjs'),'--source','examples/file-profile/approved.csv','--question','sum-units-by-category','--runtime-root',runtime,'--export',join(dir,'result.csv')],{encoding:'utf8',timeout:2500,killSignal:'SIGKILL',env:{...process.env,TMPDIR:dir}});
    denied(out,'K02_FILE_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
test('K02 oversized Parquet rejects input budget before runtime',()=>{
  const dir=snapshot();try{writeFileSync(join(dir,'examples/file-profile/approved.parquet'),Buffer.alloc(1048577));denied(cli(dir,['--runtime-root','/not-needed'],'examples/file-profile/approved.parquet'),'K02_FILE_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 output cannot overwrite existing file; source and executor scratch are unchanged',()=>{
  const dir=snapshot();try{const input=readFileSync(join(dir,'examples/file-profile/approved.csv'));writeFileSync(join(dir,'result.csv'),'RETAIN');denied(cli(dir),'K02_ENTRY_DENIED');assert.equal(readFileSync(join(dir,'result.csv'),'utf8'),'RETAIN');assert.deepEqual(readFileSync(join(dir,'examples/file-profile/approved.csv')),input);assert.equal(readdirSync(dir).some(n=>n.startsWith('ks284-executor-')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 wrong runtime versions or bytes deny before loading any engine',()=>{
  const dir=snapshot();try{const lock=join(dir,'contracts/file-profile/duckdb-runtime-lock-v1.json');const data=JSON.parse(readFileSync(lock));data.files['@duckdb/node-api/lib/index.js'].sha256='0'.repeat(64);writeFileSync(lock,JSON.stringify(data));denied(cli(dir),'K02_RUNTIME_IDENTITY_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
// Executor defense tests explicitly alter only a synthetic, disposable trusted grant.
// Caller-supplied hashes remain forbidden; these are not authorization for new real sources.
function regrant(dir,source,bytes) {
  const target=join(dir,source);const previous=hash(readFileSync(target));writeFileSync(target,bytes);
  const p=join(dir,'services/bi-control/src/db-analyzer/duckdb-file-workflow.mjs');const text=readFileSync(p,'utf8');assert.ok(text.includes(previous));writeFileSync(p,text.replace(previous,hash(bytes)));
}
test('K02 unchanged final worker rejects wrong inferred type after test-only synthetic grant',()=>{
  const dir=snapshot();try{regrant(dir,'examples/file-profile/approved.csv','category,units\nalpha,wrong\n');denied(cli(dir),'K02_SCHEMA_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 unchanged final worker rejects source row budget with no partial result',()=>{
  const dir=snapshot();try{regrant(dir,'examples/file-profile/approved.csv','category,units\n'+'alpha,1\n'.repeat(10001));denied(cli(dir),'K02_ROW_BUDGET_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 unchanged final worker rejects result row budget with no partial result',()=>{
  const dir=snapshot();try{regrant(dir,'examples/file-profile/approved.csv','category,units\n'+Array.from({length:101},(_,i)=>'group'+i+',1\n').join(''));denied(cli(dir),'K02_ROW_BUDGET_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
test('K02 invalid Parquet inside test-only synthetic grant is a readable executor refusal',()=>{
  const dir=snapshot();try{regrant(dir,'examples/file-profile/approved.parquet','NOT PARQUET');denied(cli(dir,[],'examples/file-profile/approved.parquet'),'K02_EXECUTOR_DENIED');assert.equal(existsSync(join(dir,'result.csv')),false);assert.equal(readdirSync(dir).some(n=>n.startsWith('ks284-executor-')),false);}finally{rmSync(dir,{recursive:true,force:true});}
});
