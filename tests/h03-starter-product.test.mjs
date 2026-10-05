import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,cpSync,rmSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {startControlServer,controlRequest} from './helpers/ks254-http-harness.mjs';
const identity=()=>({schemaVersion:'pansphaira.portable-runtime/identity/v1',componentId:'kaleidosphere-bi-agent',
 sourceCommit:'cd8ab71200071b991a04067c2eb9518722ab5e1c',sourceTree:'e57177fb3654553bdbe31e12eb38e20cb0d80490',
 imageDigest:'sha256:'+'a'.repeat(64),architecture:'x86_64',productVersion:'0.26.0',runtime:{name:'node',version:process.versions.node},
 contractVersion:'1.0.0',instanceId:'ks-h03-shape-only-a',tenantId:'tenant-a',generation:1,authorityProfile:'SAFE_GUIDED',
 effectiveRights:['bi.catalog.read'],configurationDigest:'b'.repeat(64),templateDigest:'c'.repeat(64),policyDigest:'d'.repeat(64),networkDigest:'e'.repeat(64)});
// This HTTP scope has explicit SHAPE_ONLY identity input. Exact actual image/identity and
// protected non-admin browser journeys are a separate native execution, never inferred here.
async function product(t,options={}){const root=mkdtempSync(join(tmpdir(),'ks294-http-product-'));mkdirSync(join(root,'owner'),{mode:0o700});
 writeFileSync(join(root,'owner','identity.json'),JSON.stringify(identity()),{mode:0o400});
 const config={root:join(root,'control'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1',
 KS_H03_STARTER_OPT_IN:'true',KS_H03_OWNER_ROOT:join(root,'owner'),KS_H03_STATE_ROOT:join(root,'state'),
 KS_H03_TENANT_ID:'tenant-a',KS_H03_PAN_SOURCE_ROOT:process.env.KS_H05_PAN_SOURCE_ROOT,KS_H03_PRODUCT_ROOT:options.productRoot??join(import.meta.dirname,'..')}};
 const servers=[];const start=async()=>{const c=await startControlServer(config);servers.push(c);return c;};const c=await start();
 c.restart=start;c.ownedRoot=root;
 t.after(async()=>{for(const server of servers)await server.stop();if(options.productRoot){
 const marker=join(options.productRoot,'.ks294-probe-child-pid');if(existsSync(marker)){const pid=Number(readFileSync(marker,'utf8'));try{
 const cmd=readFileSync('/proc/'+pid+'/cmdline','utf8');if(cmd.includes(options.productRoot+'/scripts/run-invoice-date-o2c.mjs'))process.kill(pid,'SIGKILL');}catch{}}
 rmSync(options.productRoot,{recursive:true,force:true});}rmSync(root,{recursive:true,force:true});});return c;}
function privateDelayedProduct(delayMs=10000){const root=mkdtempSync(join(tmpdir(),'ks294-real-delayed-o2c-'));const original=join(import.meta.dirname,'..');
 for(const name of ['scripts','examples/o2c','contracts/business-bi','services/bi-control/src/business-bi']){
 mkdirSync(join(root,name),{recursive:true});if(name==='scripts')cpSync(join(original,name,'run-invoice-date-o2c.mjs'),join(root,name,'run-invoice-date-o2c.mjs'));
 else cpSync(join(original,name),join(root,name),{recursive:true});}
 const cli=join(root,'scripts/run-invoice-date-o2c.mjs');let text=readFileSync(cli,'utf8');
 text=text.replace("const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');","const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');\nimport{writeFileSync}from'node:fs';writeFileSync(resolve(ROOT,'.ks294-probe-child-pid'),String(process.pid));await new Promise(r=>setTimeout(r,10000));");
 text=text.replace('setTimeout(r,10000)','setTimeout(r,'+delayMs+')');writeFileSync(cli,text);return root;}
async function waitRunning(c){for(let i=0;i<100;i++){const s=await controlRequest(c,{route:'/v1/starter',body:command('status')});if(s.body.state==='running')return s.body;await new Promise(r=>setTimeout(r,20));}assert.fail('real pending starter not observed');}
const command=(action,extra={})=>({schemaVersion:'kaleidosphere/browser-starter-command/v1',action,...extra});
test('H03 actual authenticated catalog starter reconciles genuine catalog objects and shared held template',async(t)=>{
 const c=await product(t);const denied=await controlRequest(c,{route:'/v1/starter',auth:'none',body:command('status')});assert.equal(denied.status,401);
 const r=await controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'catalog',operationId:'catalog-001'})});
 assert.equal(r.status,200,'missing actual optional starter product route: '+r.text);assert.equal(r.body.state,'succeeded');
 assert.deepEqual(r.body.result.expectedValue,['dbo.customers','dbo.orders']);assert.deepEqual(r.body.result.observedValue,r.body.result.expectedValue);
 assert.equal(r.body.result.businessStatus,'VALUE_VERIFIED');assert.equal(r.body.result.journey,'catalog');
 assert.deepEqual(r.body.result.template.identity,identity());assert.match(r.body.result.template.runtimeTemplateDigest,/^[a-f0-9]{64}$/);
 assert.equal(r.body.result.source.mode,'BUNDLED_SYNTHETIC_METADATA');assert.equal(r.body.result.rights.sourceWriteAuthorized,false);
 assert.ok(r.body.result.firstValueMs>=0);assert.equal(r.body.result.humanUsability,'NOT_OBSERVED');assert.equal(c.rawDiagnostics().includes(c.token),false);
});

test('H03 separate metric starter executes actual granted invoice-date calculation and independently held expected value',async(t)=>{
 const c=await product(t);const r=await controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-001'})});
 assert.equal(r.status,200,'missing genuine metric journey: '+r.text);assert.equal(r.body.state,'succeeded');
 assert.equal(r.body.result.expectedValue,90000);assert.equal(r.body.result.observedValue,90000);assert.equal(r.body.result.businessStatus,'VALUE_VERIFIED');
 assert.equal(r.body.result.unit,'EUR_MINOR');assert.equal(r.body.result.source.id,'COMMON-TRADE-01');
 assert.equal(r.body.result.rights.operationAuthority,'BUNDLED_EXACT_SYNTHETIC_FIXTURE_NOT_CALLER_ROLE');
 assert.match(r.body.result.source.sha256,/^[a-f0-9]{64}$/);assert.ok(r.body.result.firstValueMs>=0);
});

test('H03 own-tenant reset is bounded by exact instance and starter generation without source cleanup',async(t)=>{
 const c=await product(t);await controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-reset-001'})});
 const before=await controlRequest(c,{route:'/v1/starter',body:command('status')});assert.equal(before.body.starterGeneration,1,'missing held starter reset generation');
 const foreign=await controlRequest(c,{route:'/v1/starter',body:command('reset',{instanceId:'ks-h03-shape-only-b',expectedGeneration:1})});
 assert.equal(foreign.status,400);assert.equal(foreign.body.code,'H03_RESET_BINDING_DENIED');
 const reset=await controlRequest(c,{route:'/v1/starter',body:command('reset',{instanceId:identity().instanceId,expectedGeneration:1})});
 assert.equal(reset.status,200);assert.equal(reset.body.state,'idle');assert.equal(reset.body.result,null);assert.equal(reset.body.starterGeneration,2);
 assert.equal(reset.body.sourceResourcesRemoved,false);assert.equal(reset.body.foreignResourcesRemoved,false);
 const stale=await controlRequest(c,{route:'/v1/starter',body:command('reset',{instanceId:identity().instanceId,expectedGeneration:1})});assert.equal(stale.body.code,'H03_RESET_BINDING_DENIED');
});

test('H03 real killed control retains durable outcome_unknown and denies reset or redispatch after restart',async(t)=>{
 const productRoot=privateDelayedProduct();const c=await product(t,{productRoot});
 const pending=controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-real-interrupted-001'})}).catch(()=>null);
 await waitRunning(c);for(let i=0;i<100&&!existsSync(join(productRoot,'.ks294-probe-child-pid'));i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(existsSync(join(productRoot,'.ks294-probe-child-pid')),'actual child dispatch must precede interruption');
 c.child.kill('SIGKILL');await c.exit;await pending;
 const restarted=await c.restart();const read=await controlRequest(restarted,{route:'/v1/starter',body:command('status')});
 assert.equal(read.body.state,'outcome_unknown','interrupted actual run must survive fresh process as UNKNOWN');assert.equal(read.body.result,null);
 const reset=await controlRequest(restarted,{route:'/v1/starter',body:command('reset',{instanceId:identity().instanceId,expectedGeneration:1})});
 assert.equal(reset.status,400);assert.equal(reset.body.code,'H03_RESET_OUTCOME_UNKNOWN_DENIED');
 const replay=await controlRequest(restarted,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-real-interrupted-001'})});
 assert.equal(replay.status,400);assert.equal(replay.body.code,'H03_OUTCOME_UNKNOWN_HOLD');
});

test('H03 typed abort actually terminates its running child and permits own reset only after known completion',async(t)=>{
 const productRoot=privateDelayedProduct();const c=await product(t,{productRoot});
 const pending=controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-real-abort-001'})});
 await waitRunning(c);for(let i=0;i<100&&!existsSync(join(productRoot,'.ks294-probe-child-pid'));i++)await new Promise(r=>setTimeout(r,20));
 assert.ok(existsSync(join(productRoot,'.ks294-probe-child-pid')));const pid=Number(readFileSync(join(productRoot,'.ks294-probe-child-pid'),'utf8'));
 const abort=await controlRequest(c,{route:'/v1/starter',body:command('abort',{operationId:'metric-real-abort-001'})});
 assert.equal(abort.status,200,'missing real bounded abort: '+abort.text);assert.equal(abort.body.state,'abort_requested');
 const completed=await pending;assert.equal(completed.status,200);assert.equal(completed.body.state,'aborted');assert.equal(completed.body.result,null);
 assert.equal(existsSync('/proc/'+pid),false,'actual child must have exited, not merely client fetch aborted');
 const reset=await controlRequest(c,{route:'/v1/starter',body:command('reset',{instanceId:identity().instanceId,expectedGeneration:1})});
 assert.equal(reset.status,200);assert.equal(reset.body.state,'idle');
});

test('H03 optional guided helper returns only a typed closed proposal without dispatch or resource reservation',async(t)=>{
 const c=await product(t);const r=await controlRequest(c,{route:'/v1/starter',body:command('suggest',{journey:'metric'})});
 assert.equal(r.status,200,'missing bounded suggestion broker: '+r.text);assert.equal(r.body.suggestion.type,'STARTER_JOURNEY');
 assert.equal(r.body.suggestion.journey,'metric');assert.equal(r.body.dispatchAuthorized,false);assert.equal(r.body.modelCalled,false);
 assert.equal(r.body.suggestion.command.action,'run');assert.equal(r.body.suggestion.command.journey,'metric');
 const read=await controlRequest(c,{route:'/v1/starter',body:command('status')});assert.equal(read.body.state,'idle');assert.equal(read.body.result,null);
 for(const extra of [{shell:'arbitrary'},{url:'https://not-owned.invalid'},{upload:'bytes'},{role:'admin'},{modelKey:'not-a-key'},{controlToken:'not-a-token'}]){
 const denied=await controlRequest(c,{route:'/v1/starter',body:command('suggest',{journey:'metric',...extra})});assert.equal(denied.status,400);}
});

test('H03 actual backend rejects upload, shell, URL and caller-authority extras before a starter operation',async(t)=>{
 const c=await product(t);for(const extra of [{upload:{name:'data.csv',content:'unchecked'}},{shell:'arbitrary'},{url:'https://not-owned.invalid'},
 {tenantId:'tenant-b'},{instanceId:'foreign'},{role:'admin'},{expectedValue:0},{runtimeTemplateDigest:'f'.repeat(64)}]){
 const r=await controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-closed-001',...extra})});assert.equal(r.status,400);}
 const status=await controlRequest(c,{route:'/v1/starter',body:command('status')});assert.equal(status.body.state,'idle');assert.equal(status.body.result,null);
});

test('H03 changed actual synthetic invoice amount cannot produce success despite successful HTTP calculation',async(t)=>{
 const productRoot=privateDelayedProduct(0);const grantsPath=join(productRoot,'contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json');
 const grants=JSON.parse(readFileSync(grantsPath));const grant=grants.sources['COMMON-TRADE-01'];const variant=grant.variants[grant.defaultMapping];
 const path=join(productRoot,variant.path);const data=JSON.parse(readFileSync(path));data.sales_documents[0].net_absolute_minor+=1000;
 const bytes=JSON.stringify(data)+'\n';writeFileSync(path,bytes);variant.sha256=createHash('sha256').update(bytes).digest('hex');writeFileSync(grantsPath,JSON.stringify(grants));
 const c=await product(t,{productRoot});const r=await controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-wrong-value-001'})});
 assert.equal(r.status,200);assert.equal(r.body.state,'failed');assert.equal(r.body.result.businessStatus,'VALUE_MISMATCH');
 assert.equal(r.body.result.expectedValue,90000);assert.equal(r.body.result.observedValue,91000);
});
test('H03 completed operation replay uses persisted result and rejects changed request or replay across own reset',async(t)=>{
 const c=await product(t);const input=command('run',{journey:'metric',operationId:'metric-replay-001'});
 const first=await controlRequest(c,{route:'/v1/starter',body:input});const again=await controlRequest(c,{route:'/v1/starter',body:input});
 assert.equal(first.body.state,'succeeded');assert.equal(again.body.replayed,true);assert.deepEqual(again.body.result,first.body.result);
 const conflict=await controlRequest(c,{route:'/v1/starter',body:{...input,journey:'catalog'}});assert.equal(conflict.body.code,'H03_OPERATION_CONFLICT_DENIED');
 await controlRequest(c,{route:'/v1/starter',body:command('reset',{instanceId:identity().instanceId,expectedGeneration:1})});
 const old=await controlRequest(c,{route:'/v1/starter',body:input});assert.equal(old.body.code,'H03_OPERATION_RESET_DENIED');
});

test('H03 owner identity drift is rejected at use before any new starter dispatch or reset',async(t)=>{
 const c=await product(t);const path=join(c.ownedRoot,'owner/identity.json');rmSync(path);writeFileSync(path,JSON.stringify({...identity(),instanceId:'ks-h03-shape-only-changed'}),{mode:0o400});
 const r=await controlRequest(c,{route:'/v1/starter',body:command('run',{journey:'metric',operationId:'metric-drift-001'})});
 assert.equal(r.status,400,'a startup-held stale template must not dispatch after actual owner-file drift');assert.equal(r.body.code,'H03_IDENTITY_INVALIDATED');
});








