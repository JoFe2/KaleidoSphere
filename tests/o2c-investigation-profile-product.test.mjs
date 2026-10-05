import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,unlinkSync,symlinkSync,mkdirSync,readdirSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
const ROOT=process.cwd();
const entry='scripts/run-o2c-investigation-profile.mjs';
const base=['--fixture','COMMON-TRADE-01','--period-start','2026-06-01','--period-end','2026-08-01'];
function cli(args,root=ROOT,extraEnv={}){
 const p=spawnSync(process.execPath,[entry,...args],{cwd:root,env:{...process.env,...extraEnv},encoding:'utf8',timeout:5000,maxBuffer:1024*1024});
 assert.equal(p.error,undefined,p.error?.message);
 assert.equal(p.stderr,'');
 return {...p,value:p.stdout?JSON.parse(p.stdout):null};
}
function sandbox(t){const root=mkdtempSync(join(tmpdir(),'ks290-profiles-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;}
function privateProduct(t){
 const root=join(sandbox(t),'actual-product');
 for(const relative of ['package.json',entry,'scripts/run-invoice-date-o2c.mjs','services/bi-control/src/canonical-json.js',...['o2c-investigation-profile.mjs','invoice-date-o2c.mjs','invoice-date-o2c-views.mjs'].map(p=>'services/bi-control/src/business-bi/'+p),'contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json',...['ks-original-500-700.json','common-trade-01.json','common-trade-01-camel.json'].map(p=>'examples/o2c/'+p)]){
  const target=join(root,relative);mkdirSync(dirname(target),{recursive:true});copyFileSync(join(ROOT,relative),target);
 }
 return root;
}
test('K08 actual cold CLI saves and reloads the same versioned O2C run, not a cached fixture assertion',(t)=>{
 const store=join(sandbox(t),'profiles');
 const first=cli([...base,'--profile-save','monthly','--store',store]);
 assert.equal(first.status,0,first.stderr||first.stdout);
 assert.equal(first.value.outcome,'ACCEPTED');
 const replay=cli(['--profile-read','monthly','--store',store]);
 assert.equal(replay.status,0,replay.stderr||replay.stdout);
 assert.deepEqual(replay.value.table.rows,[{month:'2026-06',net_minor:80000,currency:'EUR'},{month:'2026-07',net_minor:10000,currency:'EUR'}]);
 assert.equal(replay.value.investigation.profileVersion,1);
 assert.equal(replay.value.investigation.resultReference,first.value.investigation.resultReference);
 assert.equal(replay.value.investigation.snapshotSha256,first.value.source.sha256);
 assert.equal(replay.value.investigation.humanUsability,'NOT_OBSERVED');
 assert.equal(replay.value.investigation.humanUsabilityTechnicalHold,false);
 const actualSaved=JSON.parse(readFileSync(join(store,'monthly','v1.json'),'utf8'));
 assert.equal(actualSaved.profile.profileVersion,1);
 assert.deepEqual(actualSaved.profile.period,{start:'2026-06-01',end:'2026-08-01'});
 assert.equal(actualSaved.profile.source.sourceRevision,1);
 assert.doesNotMatch(JSON.stringify(actualSaved),/net_minor|80000|10000|password|token/);
});
test('K08 existing table, actual SVG and actual CSV carry one result reference with visible version/time/source assumptions',(t)=>{
 const store=join(sandbox(t),'profiles');
 const p=cli([...base,'--profile-save','visible','--store',store]);assert.equal(p.status,0,p.stdout||p.stderr);
 const v=p.value,b=v.investigation;
 for(const view of [v.table,v.chart,v.export]){
  assert.equal(view.investigation.resultReference,b.resultReference);
  assert.equal(view.investigation.profileVersion,1);
  assert.deepEqual(view.investigation.period,{start:'2026-06-01',end:'2026-08-01'});
  assert.equal(view.investigation.mapping,'common-snake-reference/v1');
  assert.equal(view.investigation.freshness,'FRESH_BOUND_EXECUTION');
 }
 assert.match(v.chart.svg,new RegExp('data-result-reference="'+b.resultReference+'"'));
 assert.match(v.chart.svg,/Profile visible v1/);
 assert.match(v.chart.svg,/2026-06-01/);
 assert.match(v.chart.svg,/COMMON-TRADE-01 revision 1/);
 assert.match(v.export.csv,new RegExp('^# investigation '+b.resultReference+' '));
 const rows=v.export.csv.split('\n').filter(l=>l&&!l.startsWith('#')).slice(1).map(l=>{const [month,net,currency]=l.split(',');return {month,net_minor:Number(net),currency};});
 assert.deepEqual(rows,v.table.rows);
 assert.deepEqual(v.chart.series,v.table.rows.map(r=>({month:r.month,net_minor:r.net_minor})));
 assert.match(v.export.csv,/common-snake-reference\/v1/);
});
test('K08 a changed period creates immutable v2 and a distinguishable actual bound result',(t)=>{
 const store=join(sandbox(t),'profiles');
 const first=cli([...base,'--profile-save','versioned','--store',store]);assert.equal(first.status,0,first.stdout);
 const oldPath=join(store,'versioned','v1.json'),oldBytes=readFileSync(oldPath);
 const next=cli(['--profile-revise','versioned','--expected-version','1','--store',store,'--period-start','2026-07-01','--period-end','2026-08-01']);
 assert.equal(next.status,0,next.stderr||next.stdout);
 assert.equal(next.value.investigation.profileVersion,2);
 assert.notEqual(next.value.investigation.resultReference,first.value.investigation.resultReference);
 assert.deepEqual(next.value.table.rows,[{month:'2026-07',net_minor:10000,currency:'EUR'}]);
 assert.deepEqual(readFileSync(oldPath),oldBytes);
 const second=JSON.parse(readFileSync(join(store,'versioned','v2.json'),'utf8'));
 assert.equal(second.profile.predecessorSha256,JSON.parse(oldBytes).sha256);
 assert.equal(second.profile.profileVersion,2);
 const replay=cli(['--profile-read','versioned','--store',store]);assert.equal(replay.status,0,replay.stdout);
 assert.equal(replay.value.investigation.resultReference,next.value.investigation.resultReference);
});
test('K08 original different-window negative: read options cannot silently change or be ignored in a saved bound recipe',(t)=>{
 const store=join(sandbox(t),'profiles');
 const first=cli([...base,'--profile-save','monthly','--store',store]);assert.equal(first.status,0,first.stdout);
 const before=readFileSync(join(store,'monthly','v1.json'));
 for(const extra of [
  ['--period-start','2026-07-01','--period-end','2026-08-01'],
  ['--period-end','2026-07-01'],['--fixture','KS-ORIGINAL-500-700'],
  ['--mapping','ks-camel-fixture/v1'],['--view','drilldown'],['--expected-version','2']
 ]){
  const p=cli(['--profile-read','monthly','--store',store,...extra]);
  assert.equal(p.status,1,p.stdout||p.stderr);
  assert.equal(p.value.reasonCode,'K08_PROFILE_READ_OPTIONS_DENIED');
  for(const key of ['table','chart','export','drilldown'])assert.equal(p.value[key],null);
  assert.equal(p.value.partialSuccess,false);
  assert.doesNotMatch(p.stdout,/80000|10000/);
 }
 assert.deepEqual(readFileSync(join(store,'monthly','v1.json')),before);
 const valid=cli(['--profile-read','monthly','--store',store]);assert.equal(valid.status,0,valid.stdout);
 assert.equal(valid.value.investigation.resultReference,first.value.investigation.resultReference);
 assert.deepEqual(valid.value.investigation.period,{start:'2026-06-01',end:'2026-08-01'});
});
test('K08 a symlinked persisted head is refused rather than followed to another owned file',(t)=>{
 const root=sandbox(t),store=join(root,'profiles');
 const first=cli([...base,'--profile-save','pinned','--store',store]);assert.equal(first.status,0,first.stdout);
 const head=join(store,'pinned','head.json'),outside=join(root,'outside-head.json');
 const bytes=readFileSync(head);writeFileSync(outside,bytes);unlinkSync(head);symlinkSync(outside,head);
 const p=cli(['--profile-read','pinned','--store',store]);
 assert.equal(p.status,1,p.stdout||p.stderr);
 assert.equal(p.value.reasonCode,'K08_PROFILE_PATH_DENIED');
 assert.equal(p.value.table,null);assert.equal(p.value.partialSuccess,false);
 assert.deepEqual(readFileSync(outside),bytes);
});
test('K08 comparison of immutable versions names different windows and refuses a direct numeric delta',(t)=>{
 const store=join(sandbox(t),'profiles');
 assert.equal(cli([...base,'--profile-save','compare','--store',store]).status,0);
 const changed=cli(['--profile-revise','compare','--expected-version','1','--store',store,'--period-start','2026-07-01']);
 assert.equal(changed.status,0,changed.stdout);
 const p=cli(['--profile-compare','compare','--compare-with','compare','--left-version','1','--right-version','2','--store',store]);
 assert.equal(p.status,0,p.stdout||p.stderr);
 assert.equal(p.value.outcome,'COMPARISON');
 assert.deepEqual(p.value.comparison.changedDimensions,['PERIOD']);
 assert.deepEqual(p.value.comparison.left.period,{start:'2026-06-01',end:'2026-08-01'});
 assert.deepEqual(p.value.comparison.right.period,{start:'2026-07-01',end:'2026-08-01'});
 assert.equal(p.value.comparison.left.profileVersion,1);assert.equal(p.value.comparison.right.profileVersion,2);
 assert.notEqual(p.value.comparison.left.resultReference,p.value.comparison.right.resultReference);
 assert.equal(p.value.comparison.numericDelta,null);
 assert.equal(p.value.comparison.numericComparisonAllowed,false);
 assert.equal(p.value.comparison.sameBoundResult,false);
 assert.equal(p.value.table,null);assert.equal(p.value.partialSuccess,false);
 assert.doesNotMatch(p.stdout,/80000|10000|net_minor/);
});
test('K08 save refuses a symlinked profile directory without writing through it',(t)=>{
 const root=sandbox(t),store=join(root,'profiles'),outside=join(root,'outside');
 mkdirSync(store);mkdirSync(outside);writeFileSync(join(outside,'sentinel'),'owned-before');
 symlinkSync(outside,join(store,'unsafe'));
 const p=cli([...base,'--profile-save','unsafe','--store',store]);
 assert.equal(p.status,1,p.stdout||p.stderr);assert.equal(p.value.reasonCode,'K08_PROFILE_PATH_DENIED');
 assert.equal(p.value.table,null);assert.equal(p.value.partialSuccess,false);
 assert.deepEqual(readdirSync(outside),['sentinel']);assert.equal(readFileSync(join(outside,'sentinel'),'utf8'),'owned-before');
});
test('K08 a real changed snapshot invalidates cold replay instead of presenting cached totals as fresh',(t)=>{
 const root=privateProduct(t),store=join(sandbox(t),'profiles');
 const initial=cli([...base,'--profile-save','snapshot','--store',store],root);assert.equal(initial.status,0,initial.stdout);
 const firstBytes=readFileSync(join(store,'snapshot','v1.json'));
 const path=join(root,'examples/o2c/common-trade-01.json'),data=JSON.parse(readFileSync(path,'utf8'));
 data.revision=2;data.sales_documents.find(d=>d.id==='AR-02').net_absolute_minor=30000;
 const bytes=JSON.stringify(data)+'\n';writeFileSync(path,bytes);
 const grantPath=join(root,'contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json'),grant=JSON.parse(readFileSync(grantPath,'utf8'));
 grant.sources['COMMON-TRADE-01'].revision=2;
 grant.sources['COMMON-TRADE-01'].variants['common-snake-reference/v1'].sha256=createHash('sha256').update(bytes).digest('hex');
 writeFileSync(grantPath,JSON.stringify(grant)+'\n');
 const denied=cli(['--profile-read','snapshot','--store',store],root);
 assert.equal(denied.status,1,denied.stdout);assert.equal(denied.value.reasonCode,'K08_SOURCE_INVALIDATED');
 assert.equal(denied.value.freshness,'INVALIDATED');assert.equal(denied.value.invalidationReason,'K08_SOURCE_INVALIDATED');
 assert.equal(denied.value.table,null);assert.doesNotMatch(denied.stdout,/80000|10000|20000/);
 const revised=cli(['--profile-revise','snapshot','--expected-version','1','--store',store],root);
 assert.equal(revised.status,0,revised.stdout);assert.equal(revised.value.investigation.profileVersion,2);
 assert.equal(revised.value.investigation.sourceRevision,2);
 assert.notEqual(revised.value.investigation.resultReference,initial.value.investigation.resultReference);
 const independentJuly=data.sales_documents.filter(d=>d.invoice_date.startsWith('2026-07')).reduce((n,d)=>n+(d.type==='CREDIT'?-d.net_absolute_minor:d.net_absolute_minor),0);
 assert.deepEqual(revised.value.table.rows,[{month:'2026-06',net_minor:80000,currency:'EUR'},{month:'2026-07',net_minor:independentJuly,currency:'EUR'}]);
 assert.deepEqual(readFileSync(join(store,'snapshot','v1.json')),firstBytes);
 const replay=cli(['--profile-read','snapshot','--store',store],root);assert.equal(replay.status,0,replay.stdout);
 assert.equal(replay.value.investigation.resultReference,revised.value.investigation.resultReference);
 const compared=cli(['--profile-compare','snapshot','--compare-with','snapshot','--left-version','1','--right-version','2','--store',store],root);
 assert.equal(compared.status,0,compared.stdout);assert.deepEqual(compared.value.comparison.changedDimensions,['SOURCE']);
 assert.equal(compared.value.comparison.left.freshness,'INVALIDATED');assert.equal(compared.value.comparison.left.resultReference,null);
 assert.equal(compared.value.comparison.right.freshness,'FRESH_BOUND_EXECUTION');assert.equal(compared.value.comparison.numericDelta,null);
});
test('K08 semantic comparison shows the actual definition labels and invalidates the earlier implementation binding',(t)=>{
 const root=privateProduct(t),store=join(sandbox(t),'profiles');
 const before=cli([...base,'--profile-save','semantics','--store',store],root);assert.equal(before.status,0,before.stdout);
 const engine=join(root,'services/bi-control/src/business-bi/invoice-date-o2c.mjs');
 const original=readFileSync(engine,'utf8');assert.match(original,/dispatchBasis:'ORIGINAL_PROMISE_DISPATCH'/);
 writeFileSync(engine,original.replace("dispatchBasis:'ORIGINAL_PROMISE_DISPATCH'","dispatchBasis:'TEST_ONLY_CHANGED_DEFINITION'"));
 const old=cli(['--profile-read','semantics','--store',store],root);
 assert.equal(old.status,1,old.stdout);assert.equal(old.value.reasonCode,'K08_DEFINITION_INVALIDATED');assert.equal(old.value.table,null);
 const revised=cli(['--profile-revise','semantics','--expected-version','1','--store',store],root);
 assert.equal(revised.status,0,revised.stdout);
 const comparison=cli(['--profile-compare','semantics','--compare-with','semantics','--left-version','1','--right-version','2','--store',store],root);
 assert.equal(comparison.status,0,comparison.stdout);
 assert.deepEqual(comparison.value.comparison.changedDimensions,['SEMANTIC_DEFINITION']);
 assert.deepEqual(comparison.value.comparison.left.semanticDefinition,{id:'o2c-invoice-date-dispatch/v1',dateBasis:'INVOICE_DATE',dispatchBasis:'ORIGINAL_PROMISE_DISPATCH'});
 assert.equal(comparison.value.comparison.right.semanticDefinition.dispatchBasis,'TEST_ONLY_CHANGED_DEFINITION');
 assert.equal(comparison.value.comparison.left.invalidationReason,'K08_DEFINITION_INVALIDATED');
 assert.equal(comparison.value.comparison.left.resultReference,null);assert.equal(comparison.value.comparison.sameBoundResult,false);
 assert.equal(comparison.value.comparison.numericDelta,null);assert.doesNotMatch(comparison.stdout,/80000|10000|net_minor/);
});
test('K08 operator-disabled profile storage leaves the existing one-off product available',(t)=>{
 const root=sandbox(t),store=join(root,'profiles'),disabled={KS_O2C_PROFILES_DISABLED:'1'};
 const p=cli([...base,'--profile-save','disabled','--store',store],ROOT,disabled);
 assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K08_PROFILES_DISABLED');
 assert.deepEqual(readdirSync(root),[]);
 const one=spawnSync(process.execPath,['scripts/run-invoice-date-o2c.mjs',...base],{cwd:ROOT,env:{...process.env,...disabled},encoding:'utf8',timeout:5000});
 assert.equal(one.error,undefined);assert.equal(one.status,0,one.stdout||one.stderr);assert.equal(one.stderr,'');
 assert.deepEqual(JSON.parse(one.stdout).table.rows,[{month:'2026-06',net_minor:80000,currency:'EUR'},{month:'2026-07',net_minor:10000,currency:'EUR'}]);
});
test('K08 actual fixture operation withdrawal invalidates replay before any result is returned',(t)=>{
 const root=privateProduct(t),store=join(sandbox(t),'profiles');
 const first=cli([...base,'--profile-save','rights','--store',store],root);assert.equal(first.status,0,first.stdout);
 const original=readFileSync(join(store,'rights','v1.json'));
 const path=join(root,'contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json'),grants=JSON.parse(readFileSync(path,'utf8'));
 grants.sources['COMMON-TRADE-01'].operations=['aggregate'];writeFileSync(path,JSON.stringify(grants)+'\n');
 const p=cli(['--profile-read','rights','--store',store],root);
 assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K03_RIGHTS_DENIED');
 assert.equal(p.value.freshness,'INVALIDATED');assert.equal(p.value.invalidationReason,'K03_RIGHTS_DENIED');
 for(const key of ['table','chart','export','drilldown'])assert.equal(p.value[key],null);
 assert.equal(p.value.partialSuccess,false);assert.doesNotMatch(p.stdout,/80000|10000/);
 assert.deepEqual(readFileSync(join(store,'rights','v1.json')),original);
});
test('K08 a saved aggregate cannot acquire a forbidden drilldown through read or explicit revision',(t)=>{
 const root=privateProduct(t),store=join(sandbox(t),'profiles');
 const path=join(root,'contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json'),grants=JSON.parse(readFileSync(path,'utf8'));
 grants.sources['COMMON-TRADE-01'].operations=['aggregate'];writeFileSync(path,JSON.stringify(grants)+'\n');
 const first=cli([...base,'--view','aggregate','--profile-save','narrow','--store',store],root);assert.equal(first.status,0,first.stdout);
 assert.equal(first.value.drilldown,undefined);
 const head=readFileSync(join(store,'narrow','head.json'));
 const read=cli(['--profile-read','narrow','--store',store,'--view','drilldown'],root);
 assert.equal(read.status,1,read.stdout);assert.equal(read.value.reasonCode,'K08_PROFILE_READ_OPTIONS_DENIED');assert.equal(read.value.drilldown,null);
 const revise=cli(['--profile-revise','narrow','--expected-version','1','--store',store,'--view','drilldown'],root);
 assert.equal(revise.status,1,revise.stdout);assert.equal(revise.value.reasonCode,'K03_RIGHTS_DENIED');assert.equal(revise.value.drilldown,null);
 assert.deepEqual(readFileSync(join(store,'narrow','head.json')),head);assert.deepEqual(readdirSync(join(store,'narrow')).sort(),['head.json','v1.json']);
 const valid=cli(['--profile-read','narrow','--store',store],root);assert.equal(valid.status,0,valid.stdout);
 assert.equal(valid.value.investigation.resultReference,first.value.investigation.resultReference);assert.equal(valid.value.drilldown,undefined);
});
test('K08 supported mutations without an exact version never replace the saved generation',(t)=>{
 const store=join(sandbox(t),'profiles');assert.equal(cli([...base,'--profile-save','immutable','--store',store]).status,0);
 const path=join(store,'immutable','v1.json'),bytes=readFileSync(path),head=readFileSync(join(store,'immutable','head.json'));
 for(const args of [
  [...base,'--profile-save','immutable','--store',store,'--period-start','2026-07-01'],
  ['--profile-revise','immutable','--store',store,'--period-start','2026-07-01'],
  ['--profile-revise','immutable','--store',store,'--expected-version','01','--period-start','2026-07-01'],
  ['--profile-revise','immutable','--store',store,'--expected-version','2','--period-start','2026-07-01']
 ]){const p=cli(args);assert.equal(p.status,1,p.stdout);assert.equal(p.value.table,null);assert.equal(p.value.partialSuccess,false);}
 assert.deepEqual(readFileSync(path),bytes);assert.deepEqual(readFileSync(join(store,'immutable','head.json')),head);
 assert.deepEqual(readdirSync(join(store,'immutable')).sort(),['head.json','v1.json']);
 const record=JSON.parse(bytes);record.profile.period.start='2026-07-01';writeFileSync(path,JSON.stringify(record)+'\n');
 const corrupted=cli(['--profile-read','immutable','--store',store]);assert.equal(corrupted.status,1,corrupted.stdout);
 assert.equal(corrupted.value.reasonCode,'K08_PROFILE_RECORD_DENIED');assert.equal(corrupted.value.table,null);
});
test('K08 equivalent fixture mappings are named differences rather than unqualified number subtraction',(t)=>{
 const store=join(sandbox(t),'profiles');
 const left=cli([...base,'--profile-save','snake','--store',store]);assert.equal(left.status,0,left.stdout);
 const right=cli([...base,'--mapping','ks-camel-fixture/v1','--profile-save','camel','--store',store]);assert.equal(right.status,0,right.stdout);
 assert.deepEqual(left.value.table.rows,right.value.table.rows);
 const p=cli(['--profile-compare','snake','--compare-with','camel','--store',store]);assert.equal(p.status,0,p.stdout);
 assert.deepEqual(p.value.comparison.changedDimensions,['SOURCE','MAPPING']);
 assert.equal(p.value.comparison.left.mapping,'common-snake-reference/v1');assert.equal(p.value.comparison.right.mapping,'ks-camel-fixture/v1');
 assert.equal(p.value.comparison.sameBoundResult,false);assert.equal(p.value.comparison.numericComparisonAllowed,false);assert.equal(p.value.comparison.numericDelta,null);
 const same=cli(['--profile-compare','snake','--compare-with','snake','--store',store]);assert.equal(same.status,0,same.stdout);
 assert.deepEqual(same.value.comparison.changedDimensions,[]);assert.equal(same.value.comparison.sameBoundResult,true);
 assert.equal(same.value.comparison.left.resultReference,left.value.investigation.resultReference);
 assert.equal(same.value.comparison.right.resultReference,left.value.investigation.resultReference);
});
test('K08 bounded store reads reject FIFOs and oversized regular metadata without hanging',(t)=>{
 for(const kind of ['fifo','oversize']){
  const store=join(sandbox(t),'profiles');assert.equal(cli([...base,'--profile-save','special','--store',store]).status,0);
  const path=join(store,'special','head.json');unlinkSync(path);
  if(kind==='fifo'){const made=spawnSync('mkfifo',[path],{encoding:'utf8',timeout:1000});assert.equal(made.error,undefined);assert.equal(made.status,0,made.stderr);}
  else writeFileSync(path,Buffer.alloc(32768+1,32));
  const p=cli(['--profile-read','special','--store',store]);assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K08_PROFILE_PATH_DENIED');
  assert.equal(p.value.table,null);assert.equal(p.value.partialSuccess,false);
 }
});
test('K08 literal store paths are rejected rather than normalized into a different absolute write target',(t)=>{
 const root=sandbox(t),store=join(root,'profiles');
 for(const invalid of [store.slice(1),root+'/../'+root.split('/').at(-1)+'/profiles']){
  const p=cli([...base,'--profile-save','literal','--store',invalid]);
  assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K08_PROFILE_PATH_DENIED');
  assert.equal(p.value.table,null);assert.deepEqual(readdirSync(root),[]);
 }
});
test('K08 a new immutable lineage version is not advertised as the identical result reference',(t)=>{
 const store=join(sandbox(t),'profiles');
 const first=cli([...base,'--profile-save','lineage','--store',store]);assert.equal(first.status,0,first.stdout);
 const next=cli(['--profile-revise','lineage','--expected-version','1','--store',store]);assert.equal(next.status,0,next.stdout);
 const p=cli(['--profile-compare','lineage','--compare-with','lineage','--left-version','1','--right-version','2','--store',store]);
 assert.equal(p.status,0,p.stdout);assert.deepEqual(p.value.comparison.changedDimensions,[]);
 assert.notEqual(p.value.comparison.left.resultReference,p.value.comparison.right.resultReference);
 assert.equal(p.value.comparison.sameBoundResult,false);
});
test('K08 duplicated CLI read options never silently select the last supplied profile',(t)=>{
 const store=join(sandbox(t),'profiles');
 assert.equal(cli([...base,'--profile-save','first','--store',store]).status,0);
 assert.equal(cli([...base,'--profile-save','second','--store',store]).status,0);
 const p=cli(['--profile-read','first','--profile-read','second','--store',store]);
 assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K08_OPTIONS_DUPLICATE_DENIED');
 assert.equal(p.value.table,null);assert.equal(p.value.partialSuccess,false);
});
test('K08 the JSON saved-recipe entry explicitly rejects raw-only single-view protocols',(t)=>{
 const root=sandbox(t),store=join(root,'profiles');
 for(const view of ['chart','export']){
  const p=cli([...base,'--view',view,'--profile-save','protocol','--store',store]);
  assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K08_PROFILE_VIEW_DENIED');
  assert.equal(p.value.table,null);assert.deepEqual(readdirSync(root),[]);
 }
});
test('K08 real concurrent cold revisions publish one successor and preserve the qualified predecessor',async(t)=>{
 const store=join(sandbox(t),'profiles');assert.equal(cli([...base,'--profile-save','concurrent','--store',store]).status,0);
 const original=readFileSync(join(store,'concurrent','v1.json'));
 const jobs=Array.from({length:6},()=>new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,[entry,'--profile-revise','concurrent','--expected-version','1','--period-start','2026-07-01','--store',store],{cwd:ROOT,detached:true,stdio:['ignore','pipe','pipe']});
  let stdout='',stderr='',timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;try{process.kill(-child.pid,'SIGKILL');}catch{}},10000);
  child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);
  child.on('error',error=>{clearTimeout(timer);reject(error);});
  child.on('close',status=>{clearTimeout(timer);resolve({status,stdout,stderr,timedOut});});
 }));
 const results=await Promise.all(jobs);
 for(const r of results){assert.equal(r.timedOut,false);assert.equal(r.stderr,'');assert.ok([0,1].includes(r.status),r.stdout);}
 const winners=results.filter(r=>r.status===0),losers=results.filter(r=>r.status===1);assert.equal(winners.length,1);assert.equal(losers.length,5);
 for(const r of losers){const value=JSON.parse(r.stdout);assert.equal(value.table,null);assert.equal(value.partialSuccess,false);}
 const winner=JSON.parse(winners[0].stdout);assert.equal(winner.investigation.profileVersion,2);
 const replay=cli(['--profile-read','concurrent','--store',store]);assert.equal(replay.status,0,replay.stdout);
 assert.equal(replay.value.investigation.resultReference,winner.investigation.resultReference);
 assert.deepEqual(readFileSync(join(store,'concurrent','v1.json')),original);
 assert.deepEqual(readdirSync(join(store,'concurrent')).sort(),['head.json','v1.json','v2.json']);
});
test('K08 definition invalidation refuses a special source file instead of hanging while hashing it',(t)=>{
 const root=privateProduct(t),store=join(sandbox(t),'profiles');
 const first=cli([...base,'--profile-save','definition','--store',store],root);assert.equal(first.status,0,first.stdout);
 const path=join(root,'services/bi-control/src/business-bi/invoice-date-o2c.mjs');unlinkSync(path);
 const made=spawnSync('mkfifo',[path],{encoding:'utf8',timeout:1000});assert.equal(made.error,undefined);assert.equal(made.status,0,made.stderr);
 const p=cli(['--profile-read','definition','--store',store],root);
 assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K08_DEFINITION_INVALIDATED');assert.equal(p.value.table,null);
});
test('K08 a definition changed during real core execution cannot activate a newly bound profile',(t)=>{
 const root=privateProduct(t),storeRoot=sandbox(t),store=join(storeRoot,'profiles');
 const script=join(root,'scripts/run-invoice-date-o2c.mjs'),views=join(root,'services/bi-control/src/business-bi/invoice-date-o2c-views.mjs');
 writeFileSync(script,readFileSync(script,'utf8')+`\nconst {appendFileSync}=await import('node:fs');appendFileSync(${JSON.stringify(views)},'\\n// task-owned concurrent-definition probe\\n');\n`);
 const p=cli([...base,'--profile-save','changing','--store',store],root);
 assert.equal(p.status,1,p.stdout);assert.equal(p.value.reasonCode,'K08_DEFINITION_INVALIDATED');assert.equal(p.value.table,null);
 assert.equal(p.value.partialSuccess,false);assert.deepEqual(readdirSync(storeRoot),[]);
});
