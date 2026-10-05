import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {join} from 'node:path';
import {freeLoopbackPort} from './helpers/ks254-http-harness.mjs';
import {Script} from 'node:vm';
// Actual served HTML and closed native POST surface only. A separate real
// certificate-verifying browser executes the business/lifecycle journeys.
async function pageServer(t,optIn=true){const port=await freeLoopbackPort();const child=spawn(process.execPath,
 [join(import.meta.dirname,'../services/bi-agent/src/server.mjs')],{env:{...process.env,PORT:String(port),
 CONTROL_BASE_URL:'http://bi-control:18089',AGENT_ROUTE_PREFIX:'/t/tenant-a',KS_H03_STARTER_OPT_IN:String(optIn)},stdio:['ignore','pipe','pipe']});
 let diagnostics='';child.stderr.on('data',c=>diagnostics+=c);const exit=new Promise(r=>child.once('exit',r));
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await exit;}});
 const url='http://127.0.0.1:'+port+'/t/tenant-a';
 for(let i=0;i<100;i++){assert.equal(child.exitCode,null,diagnostics);try{const r=await fetch(url+'/healthz');if(r.ok)return{url,child};}catch{}await new Promise(r=>setTimeout(r,20));}assert.fail('actual agent not ready');}
test('H03 optional native browser serves two usable distinct starter controls and visible non-JSON result fields',async(t)=>{
 const {url}=await pageServer(t);const response=await fetch(url+'/');assert.equal(response.status,200);const html=await response.text();
 for(const text of ['Katalog-Demo','Kennzahlen-Demo','id="helper"','id="suggestion"','id="catalog-run"','id="metric-run"','id="abort"','id="reset"',
 'id="expected"','id="observed"','id="business-status"','id="template-identity"','id="first-value"','__Host-ks293-csrf'])assert.ok(html.includes(text),'missing real starter surface '+text);
 assert.equal(html.includes('type="file"'),false);assert.equal(html.includes('localStorage'),false);
 assert.match(response.headers.get('content-security-policy'),/connect-src 'self'/);
 assert.match(html,/mode:'same-origin',referrerPolicy:'same-origin'/,'the protected same-origin POST must preserve exact Origin under the ingress no-referrer policy');
});

// Served-script timing regression only; native browser acceptance is separate.
test('H03 technical first-value freezes at first DOM result instead of growing on status refresh',async(t)=>{
 const {url}=await pageServer(t);const html=await (await fetch(url+'/')).text();const script=/<script>([\s\S]*?)<\/script>/.exec(html)[1];
 const nodes=new Map(),listeners=new Map();let clock=0,result=null;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',className:'',disabled:false,addEventListener(_type,fn){listeners.set(id,fn);}});return nodes.get(id);};
 const status=()=>({state:result?'succeeded':'idle',result,starterGeneration:1,instanceId:'unit-a',template:{identity:{instanceId:'unit-a'}}});
 const fetchProbe=async(_url,options)=>{const input=JSON.parse(options.body);if(input.action==='run'){clock+=10;result={businessStatus:'VALUE_VERIFIED',expectedValue:90000,observedValue:90000,unit:'EUR_MINOR',firstValueMs:2,source:{},rights:{},evidence:{},template:status().template};}else clock+=1;return{ok:true,json:async()=>status()};};
 new Script(script,{filename:'actual-served-h03-script'}).runInNewContext({document:{cookie:'__Host-ks293-csrf='+'a'.repeat(64),getElementById:node},fetch:fetchProbe,performance:{now:()=>clock},crypto:{randomUUID:()=> 'unit-timing-001'}});
 await new Promise(setImmediate);await listeners.get('metric-run')();
 const first=node('first-value').textContent;assert.match(first,/Browser 10.00 ms/,'first DOM measurement must not grow on automatic status read');
 clock+=100;await listeners.get('refresh')();assert.equal(node('first-value').textContent,first,'manual status read must not rewrite first-value timing');
});

