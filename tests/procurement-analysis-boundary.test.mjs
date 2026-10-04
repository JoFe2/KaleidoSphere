import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,cpSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const ROOT=fileURLToPath(new URL('..',import.meta.url));
const run=(root,args)=>spawnSync(process.execPath,[join(root,'scripts/run-procurement-analysis.mjs'),...args],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:1000000});
function copy(){const root=mkdtempSync(join(tmpdir(),'ks286-entry-'));for(const name of ['scripts/run-procurement-analysis.mjs','services/bi-control/src/business-bi/procurement-analysis.mjs','services/bi-control/src/business-bi/procurement-analysis-views.mjs','examples/p2p/common-trade-01.json','contracts/business-bi/v1/synthetic-p2p-fixture-routes-v1.json']){const dest=join(root,name);mkdirSync(dirname(dest),{recursive:true});cpSync(join(ROOT,name),dest);}return root;}
const catalog='contracts/business-bi/v1/synthetic-p2p-fixture-routes-v1.json';
test('K04 exact bundled route cannot expose export/chart/drilldown under aggregate-only local permission',()=>{
 const root=copy();try{const p=join(root,catalog),r=JSON.parse(readFileSync(p));r.operations=['aggregate'];writeFileSync(p,JSON.stringify(r));const a=run(root,['--fixture','COMMON-TRADE-01','--view','aggregate']);assert.equal(a.status,0,a.stderr);const v=JSON.parse(a.stdout);assert.ok(v.table);for(const k of ['chart','drilldown','export'])assert.equal(v[k],undefined);
 const no=run(root,['--fixture','COMMON-TRADE-01','--view','export']);assert.equal(no.status,1);assert.equal(JSON.parse(no.stdout).reasonCode,'K04_RIGHTS_DENIED');
 }finally{rmSync(root,{recursive:true,force:true});}
});
for(const [label,args] of [['foreign fixture',['--fixture','PO-FOREIGN']],['caller role',['--fixture','COMMON-TRADE-01','--role','OWNER']],['historical local fallback',['--fixture','COMMON-TRADE-01','--as-of','2026-06-25T00:00:00Z']],['mixed producer and fixture',['--fixture','COMMON-TRADE-01','--native-root','unused']]])test('K04 actual entry denies '+label+' without any partial result',()=>{const p=run(ROOT,args);assert.equal(p.status,1);const r=JSON.parse(p.stdout);assert.equal(r.outcome,'DENIED');for(const k of ['table','chart','drilldown','export'])assert.equal(r[k],null);assert.equal(r.partialSuccess,false);});
test('K04 actual CLI refuses changed and symlinked source bytes before analysis',()=>{
 const root=copy(),p=join(root,'examples/p2p/common-trade-01.json');try{writeFileSync(p,readFileSync(p,'utf8')+' ');const a=run(root,['--fixture','COMMON-TRADE-01']);assert.equal(a.status,1);assert.equal(JSON.parse(a.stdout).reasonCode,'K04_SOURCE_DRIFT_DENIED');rmSync(p);symlinkSync(join(ROOT,'examples/p2p/common-trade-01.json'),p);const b=run(root,['--fixture','COMMON-TRADE-01']);assert.equal(b.status,1);assert.equal(JSON.parse(b.stdout).reasonCode,'K04_SOURCE_DENIED');}finally{rmSync(root,{recursive:true,force:true});}
});
test('K04 actual CLI rejects an unwritten FIFO instead of blocking on source read',()=>{const root=copy(),p=join(root,'examples/p2p/common-trade-01.json');try{rmSync(p);const m=spawnSync('mkfifo',[p]);assert.equal(m.status,0);const q=run(root,['--fixture','COMMON-TRADE-01']);assert.equal(q.error,undefined,'FIFO timeout is a failure, not rejection');assert.equal(q.status,1);assert.equal(JSON.parse(q.stdout).reasonCode,'K04_SOURCE_DENIED');}finally{rmSync(root,{recursive:true,force:true});}});
