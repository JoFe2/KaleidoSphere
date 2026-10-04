import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,unlinkSync,symlinkSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync,execFileSync} from 'node:child_process';
const catalogPath='contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json';
const sourcePath='examples/o2c/ks-original-500-700.json';
const closure=['scripts/run-invoice-date-o2c.mjs','services/bi-control/src/business-bi/invoice-date-o2c.mjs','services/bi-control/src/business-bi/invoice-date-o2c-views.mjs',catalogPath,sourcePath,'examples/o2c/common-trade-01.json','examples/o2c/common-trade-01-camel.json'];
function privateEntry(t){
  const root=mkdtempSync(join(tmpdir(),'ks285-boundary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  for(const path of closure){mkdirSync(dirname(join(root,path)),{recursive:true});copyFileSync(path,join(root,path));}
  return root;
}
function run(root,extra=[]){return spawnSync(process.execPath,['scripts/run-invoice-date-o2c.mjs','--fixture','KS-ORIGINAL-500-700','--period-start','2026-06-01','--period-end','2026-08-01',...extra],{cwd:root,encoding:'utf8',timeout:5000});}
function denied(p,reason){assert.equal(p.error,undefined,p.error?.message);assert.equal(p.status,1,p.stdout||p.stderr);const v=JSON.parse(p.stdout);assert.equal(v.outcome,'DENIED');assert.equal(v.reasonCode,reason);assert.equal(v.table,null);assert.equal(v.chart,null);assert.equal(v.export,null);assert.equal(v.partialSuccess,false);assert.doesNotMatch(p.stdout,/50000|70000|PRIVATE_SENTINEL/);}
test('K03 regular-file checks include source-grant metadata, not only source data',(t)=>{
  const root=privateEntry(t),path=join(root,catalogPath);unlinkSync(path);execFileSync('mkfifo',[path]);
  denied(run(root),'K03_SOURCE_DENIED');
});
test('K03 revoked display/export/drilldown rights refuse before opening even a FIFO source',(t)=>{
  const root=privateEntry(t),path=join(root,catalogPath),catalog=JSON.parse(readFileSync(path));catalog.sources['KS-ORIGINAL-500-700'].operations=['aggregate'];writeFileSync(path,JSON.stringify(catalog));
  unlinkSync(join(root,sourcePath));execFileSync('mkfifo',[join(root,sourcePath)]);
  for(const view of ['chart','export','drilldown','all'])denied(run(root,['--view',view]),'K03_RIGHTS_DENIED');
});
test('K03 source FIFO is refused without a blocking read',(t)=>{
  const root=privateEntry(t),path=join(root,sourcePath);unlinkSync(path);execFileSync('mkfifo',[path]);denied(run(root),'K03_SOURCE_DENIED');
});
test('K03 metadata cannot select absolute or traversing source paths',(t)=>{
  const root=privateEntry(t),outside=mkdtempSync(join(tmpdir(),'ks285-outside-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  const target=join(outside,'public-original-copy.json');copyFileSync(join(root,sourcePath),target);
  for(const path of [target,relative(root,target)]){
    const catalog=JSON.parse(readFileSync(join(root,catalogPath)));catalog.sources['KS-ORIGINAL-500-700'].path=path;writeFileSync(join(root,catalogPath),JSON.stringify(catalog));
    denied(run(root),'K03_SOURCE_DENIED');
  }
});
test('K03 symlinked source parent cannot escape the approved fixture subtree',(t)=>{
  const root=privateEntry(t),outside=mkdtempSync(join(tmpdir(),'ks285-outside-parent-'));t.after(()=>rmSync(outside,{recursive:true,force:true}));
  copyFileSync(join(root,sourcePath),join(outside,'ks-original-500-700.json'));rmSync(join(root,'examples/o2c'),{recursive:true});symlinkSync(outside,join(root,'examples/o2c'));
  denied(run(root),'K03_SOURCE_DENIED');
});
test('K03 source byte drift cannot expose partial views or raw diagnostic values',(t)=>{
  const root=privateEntry(t);writeFileSync(join(root,sourcePath),'PRIVATE_SENTINEL');denied(run(root),'K03_SOURCE_DRIFT_DENIED');
});
test('K03 source symlink is refused without following its target',(t)=>{
  const root=privateEntry(t),path=join(root,sourcePath),target=join(root,'private-sentinel');writeFileSync(target,'PRIVATE_SENTINEL');unlinkSync(path);symlinkSync(target,path);denied(run(root),'K03_SOURCE_DENIED');
});
test('K03 caller role, free input path and unsupported view never grant authority',(t)=>{
  const root=privateEntry(t);
  for(const extra of [['--role','admin'],['--input','/private/source']])denied(run(root,extra),'K03_ENTRY_DENIED');
  denied(run(root,['--view','admin']),'K03_VIEW_DENIED');
  denied(run(root,['--mapping','universal-erp/v1']),'K03_MAPPING_DENIED');
});
