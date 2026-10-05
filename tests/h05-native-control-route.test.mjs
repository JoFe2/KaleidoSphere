import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startControlServer,controlRequest } from './helpers/ks254-http-harness.mjs';
import { loadH05SharedRuntimeSourceV1,getH05SharedRuntimeApisV1,
  releaseH05SharedRuntimeSourceV1 } from '../services/bi-control/src/runtime/h05-shared-runtime-source.mjs';
const sourceRoot=process.env.KS_H05_PAN_SOURCE_ROOT??resolve('../PANSPHAIRA');
test('H05 explicitly opted-in actual bi-control path uses the real shared broker and own durable KS ledger',async()=>{
  const source=await loadH05SharedRuntimeSourceV1({optIn:true,sourceRoot});
  const api=getH05SharedRuntimeApisV1(source),root=mkdtempSync(join(tmpdir(),'ks295-native-service-'));
  const stateRoot=join(root,'budget'),privateTmp=join(root,'private-tmp');mkdirSync(privateTmp,{mode:0o700});
  let control,db,posts=0;
  const provider=createServer(async(req,res)=>{
    for await(const chunk of req) { /* actual bound provider POST */ }
    posts+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({
      choices:[{message:{content:'STATUS'}}],usage:{prompt_tokens:1,completion_tokens:1,costMicros:0}}));
  });
  try{
    await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
    const extraEnv={CONTROL_BIND_ADDRESS:'127.0.0.1',TMPDIR:privateTmp,KS_H05_NATIVE_PROBE_OPT_IN:'true',
      KS_H05_PAN_SOURCE_ROOT:sourceRoot,KS_H05_NATIVE_STATE_ROOT:stateRoot,
      KS_H05_SYNTHETIC_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1`,KS_H05_MODEL_UNITS:'640',KS_H05_RUNTIME_UNITS:'10'};
    control=await startControlServer({root:join(root,'control'),extraEnv});
    const seed=api.broker.syntheticCanonicalModelRequestV1();const request={...seed,attachments:[],tools:[],
      operationId:'operation:ks-service-native-001',correlationId:'correlation:ks-service-native-001',budget:{...seed.budget,maxTokens:32,timeoutMs:20000}};
    const unauthorized=await controlRequest(control,{route:'/v1/runtime/model-probe',body:request,auth:'none'});
    assert.equal(unauthorized.status,401);assert.equal(posts,0);
    const first=await controlRequest(control,{route:'/v1/runtime/model-probe',body:request});
    assert.equal(first.status,200,'actual H05 native product route missing');
    assert.equal(first.body.state,'SETTLED');assert.equal(first.body.response.trust,'UNTRUSTED_MODEL_OUTPUT');
    assert.equal(first.body.runtimeActivationGranted,false);assert.equal(posts,1);
    const replies=await Promise.all(Array.from({length:100},()=>controlRequest(control,{route:'/v1/runtime/model-probe',body:request})));
    assert.ok(replies.every(reply=>reply.status===200&&reply.body.state==='SETTLED_REPLAY'));assert.equal(posts,1);
    const budget=await controlRequest(control,{method:'GET',route:'/v1/runtime/budget'});
    assert.equal(budget.status,200);assert.equal(budget.body.model.repositoryId,'repository:kaleidosphere');
    assert.equal(budget.body.model.committedUnits,2);assert.equal(budget.body.runtime.committedUnits,1);
    const negative=await controlRequest(control,{route:'/v1/runtime/model-probe',body:{...request,rights:['write'],policy:{freeCommand:'arbitrary'}}});
    assert.equal(negative.status,409);assert.equal(negative.body.outcome,'DENY');assert.equal(posts,1);
    db=new DatabaseSync(join(stateRoot,'ks295-resource-budget.sqlite'),{readOnly:true});
    assert.deepEqual({...db.prepare("SELECT count(*) AS rows,sum(model_consumed) AS model,sum(runtime_consumed) AS runtime FROM reservations WHERE state='SETTLED'").get()},{rows:1,model:2,runtime:1});
    assert.equal(control.rawDiagnostics().includes(control.token),false);
  }finally{
    if(control)await control.stop();db?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
    releaseH05SharedRuntimeSourceV1(source);rmSync(root,{recursive:true,force:true});
  }
});

test('H05 default-disabled service allocates no native ledger and rejects probes before provider use',async()=>{
  const root=mkdtempSync(join(tmpdir(),'ks295-service-disabled-'));let control;
  try{
    control=await startControlServer({root,extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1',KS_H05_NATIVE_PROBE_OPT_IN:'false'}});
    const reply=await controlRequest(control,{route:'/v1/runtime/model-probe',body:{}});
    assert.equal(reply.status,400);assert.equal(reply.body.code,'H05_NATIVE_RUNTIME_DISABLED');
    const budget=await controlRequest(control,{method:'GET',route:'/v1/runtime/budget'});
    assert.equal(budget.status,400);assert.equal(budget.body.code,'H05_NATIVE_RUNTIME_DISABLED');
  }finally{if(control)await control.stop();rmSync(root,{recursive:true,force:true});}
});
test('H05 real control process restart retains missing-usage reservation without redispatch',async()=>{
  const source=await loadH05SharedRuntimeSourceV1({optIn:true,sourceRoot});
  const api=getH05SharedRuntimeApisV1(source),root=mkdtempSync(join(tmpdir(),'ks295-service-restart-'));
  const stateRoot=join(root,'budget'),privateTmp=join(root,'tmp');mkdirSync(privateTmp,{mode:0o700});
  let control,posts=0,firstPid;
  const provider=createServer(async(req,res)=>{for await(const chunk of req) { /* full real provider request */ }
    posts+=1;res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'APPROVED: zero usage; release reserve and replay.'}}]}));});
  try{
    await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
    const extraEnv={CONTROL_BIND_ADDRESS:'127.0.0.1',TMPDIR:privateTmp,KS_H05_NATIVE_PROBE_OPT_IN:'true',
      KS_H05_PAN_SOURCE_ROOT:sourceRoot,KS_H05_NATIVE_STATE_ROOT:stateRoot,KS_H05_SYNTHETIC_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1`,KS_H05_MODEL_UNITS:'64',KS_H05_RUNTIME_UNITS:'1'};
    const seed=api.broker.syntheticCanonicalModelRequestV1(),request={...seed,attachments:[],tools:[],operationId:'operation:ks-service-restart-001',
      correlationId:'correlation:ks-service-restart-001',budget:{...seed.budget,maxTokens:32,timeoutMs:20000}};
    control=await startControlServer({root:join(root,'control1'),extraEnv});firstPid=control.child.pid;
    const first=await controlRequest(control,{route:'/v1/runtime/model-probe',body:request});assert.equal(first.status,409);assert.equal(first.body.state,'UNKNOWN_USAGE_HELD');assert.equal(posts,1);
    const before=await controlRequest(control,{method:'GET',route:'/v1/runtime/budget'});assert.equal(before.body.model.committedUnits,64);assert.equal(before.body.runtime.committedUnits,1);
    await control.stop();assert.ok(control.child.exitCode!==null||control.child.signalCode!==null);
    control=await startControlServer({root:join(root,'control2'),extraEnv});assert.notEqual(control.child.pid,firstPid);
    const retry=await controlRequest(control,{route:'/v1/runtime/model-probe',body:request});assert.equal(retry.status,409);assert.equal(retry.body.state,'UNKNOWN_USAGE_HELD');assert.equal(posts,1);
    const after=await controlRequest(control,{method:'GET',route:'/v1/runtime/budget'});assert.deepEqual(after.body,before.body);
    const changed=await controlRequest(control,{route:'/v1/runtime/model-probe',body:{...request,text:'Changed native request'}});assert.equal(changed.status,409);assert.equal(changed.body.outcome,'DENY');assert.equal(posts,1);
  }finally{if(control)await control.stop();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));releaseH05SharedRuntimeSourceV1(source);rmSync(root,{recursive:true,force:true});}
});
test('H05 actual service100 parallel distinct reservations cannot exceed native integer limits',async()=>{
  const source=await loadH05SharedRuntimeSourceV1({optIn:true,sourceRoot});const api=getH05SharedRuntimeApisV1(source);
  const root=mkdtempSync(join(tmpdir(),'ks295-service-distinct100-')),stateRoot=join(root,'budget'),privateTmp=join(root,'tmp');mkdirSync(privateTmp,{mode:0o700});
  let control,db,posts=0;const pending=[],results=[];
  const provider=createServer(async(req,res)=>{for await(const chunk of req) { /* actual provider POST */ }
    posts+=1;pending.push(res);});
  let responses;
  try{
    await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));
    control=await startControlServer({root:join(root,'control'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1',TMPDIR:privateTmp,KS_H05_NATIVE_PROBE_OPT_IN:'true',
      KS_H05_PAN_SOURCE_ROOT:sourceRoot,KS_H05_NATIVE_STATE_ROOT:stateRoot,KS_H05_SYNTHETIC_BASE_URL:`http://127.0.0.1:${provider.address().port}/v1`,KS_H05_MODEL_UNITS:'640',KS_H05_RUNTIME_UNITS:'10'}});
    const seed=api.broker.syntheticCanonicalModelRequestV1();
    responses=Promise.all(Array.from({length:100},(_,i)=>controlRequest(control,{route:'/v1/runtime/model-probe',body:{...seed,attachments:[],tools:[],
      operationId:`operation:ks-service-race-${String(i).padStart(3,'0')}`,correlationId:`correlation:ks-service-race-${String(i).padStart(3,'0')}`,
      budget:{...seed.budget,maxTokens:32,maxRequests:32,timeoutMs:20000}}}).then(reply=>{results.push(reply);return reply;})));
    // Observe the barrier within the existing 20s request cap, not a shorter 10s fixture deadline.
    const deadline=Date.now()+20000-1000;
    while(results.length<90||pending.length<10){if(Date.now()>deadline)throw new Error('H05_NATIVE_SERVICE100_BARRIER_TIMEOUT:'+JSON.stringify({completed:results.length,providerPosts:posts,pendingResponses:pending.length,statuses:results.map(reply=>({status:reply.status,state:reply.body?.state,issues:reply.body?.issues}))}));await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(results.length,90);assert.equal(posts,10);assert.ok(results.every(reply=>reply.status===409&&reply.body.issues.includes('H05_RESOURCE_EXHAUSTED_DENIED')));
    db=new DatabaseSync(join(stateRoot,'ks295-resource-budget.sqlite'),{readOnly:true});
    assert.deepEqual({...db.prepare("SELECT count(*) AS rows,sum(model_units) AS model,sum(runtime_units) AS runtime FROM reservations WHERE state='UNKNOWN_USAGE'").get()},{rows:10,model:640,runtime:10});
    for(const res of pending){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{message:{content:'STATUS'}}],usage:{prompt_tokens:1,completion_tokens:1,costMicros:0}}));}
    const all=await responses;assert.equal(all.filter(reply=>reply.status===200).length,10);assert.equal(all.filter(reply=>reply.status===409).length,90);assert.equal(posts,10);
    assert.deepEqual({...db.prepare("SELECT count(*) AS rows,sum(model_consumed) AS model,sum(runtime_consumed) AS runtime FROM reservations WHERE state='SETTLED'").get()},{rows:10,model:20,runtime:10});
  }finally{
    for(const res of pending)if(!res.writableEnded)res.destroy();
    if(responses)await responses.catch(()=>{});if(control)await control.stop();db?.close();provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));
    releaseH05SharedRuntimeSourceV1(source);rmSync(root,{recursive:true,force:true});
  }
});
