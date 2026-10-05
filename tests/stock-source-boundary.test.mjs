import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,cpSync,mkdirSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
const ROOT=new URL('..',import.meta.url).pathname;
const route='contracts/business-bi/v1/synthetic-stock-deadline-routes-v1.json',fixture='examples/stock/k05-demand-on-time.json';
const args=['--fixture','K05-DEMAND-ON-TIME','--as-of','2026-06-30T23:59:59+02:00'];
const run=(root,extra=args)=>spawnSync(process.execPath,[join(root,'scripts/run-stock-analysis.mjs'),...extra],{cwd:root,encoding:'utf8',timeout:5000,maxBuffer:1000000});
function copy(){const root=mkdtempSync(join(tmpdir(),'ks287-entry-'));for(const n of ['scripts/run-stock-analysis.mjs','services/bi-control/src/business-bi/pan520-stock-consumer.mjs','services/bi-control/src/business-bi/stock-deadline-analysis.mjs','services/bi-control/src/business-bi/stock-narrow-profile.mjs','contracts/dependencies/pan520-stock-source-v1.json',route,fixture]){mkdirSync(dirname(join(root,n)),{recursive:true});cpSync(join(ROOT,n),join(root,n));}mkdirSync(join(root,'dependencies'),{recursive:true});cpSync(join(ROOT,'dependencies/pansphaira'),join(root,'dependencies/pansphaira'),{recursive:true});return root;}
function denied(p,code){assert.equal(p.error,undefined,'A timeout is a failure, not refusal');assert.equal(p.status,1,p.stdout+p.stderr);const r=JSON.parse(p.stdout);assert.equal(r.outcome,'DENIED');assert.equal(r.partialSuccess,false);assert.equal(r.table,null);assert.equal(r.export,null);if(code)assert.equal(r.reasonCode,code);}
test('K05 source bytes and bound fixture route cannot drift through the actual entry',()=>{const root=copy();try{const p=join(root,fixture);writeFileSync(p,readFileSync(p,'utf8')+' ');denied(run(root),'K05_SOURCE_DRIFT_DENIED');rmSync(p);symlinkSync(join(ROOT,fixture),p);denied(run(root),'K05_SOURCE_DENIED');}finally{rmSync(root,{recursive:true,force:true});}});
test('K05 FIFO and escaping parent-directory source are refused without blocking',()=>{const root=copy();try{rmSync(join(root,fixture));assert.equal(spawnSync('mkfifo',[join(root,fixture)]).status,0);denied(run(root),'K05_SOURCE_DENIED');rmSync(join(root,'examples/stock'),{recursive:true,force:true});symlinkSync(join(ROOT,'examples/stock'),join(root,'examples/stock'));denied(run(root),'K05_SOURCE_DENIED');}finally{rmSync(root,{recursive:true,force:true});}});
test('K05 aggregate fixture metadata cannot carry unrequested export or caller role rights',()=>{const root=copy();try{const p=join(root,route),r=JSON.parse(readFileSync(p));r.operations=['export'];writeFileSync(p,JSON.stringify(r));denied(run(root),'K05_SOURCE_DENIED');denied(run(ROOT,[...args,'--role','OWNER']));denied(run(ROOT,[...args,'--sql','SELECT private']));}finally{rmSync(root,{recursive:true,force:true});}});
