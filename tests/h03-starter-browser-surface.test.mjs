import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {join} from 'node:path';
import {freeLoopbackPort} from './helpers/ks254-http-harness.mjs';
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
});
