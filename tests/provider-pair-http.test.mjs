import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';

// Run the unchanged service entry in a private mount/PID/network namespace.
// The listener cannot reach the host network; no credentials or control token are mounted.
const runner=String.raw`
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {externalBiProviderProfileV1} from './services/bi-agent/src/external-api-v2.mjs';
const registry='contracts/pansphaira-analytics/v1/release-registry.v1.json';
const before=readFileSync(registry);
const child=spawn(process.execPath,['services/bi-agent/src/server.mjs'],{stdio:['ignore','ignore','pipe'],env:{PORT:'30391',CONTROL_BASE_URL:'http://bi-control:18089',TMPDIR:'/scratch',HOME:'/scratch'}});
let stderr='';child.stderr.on('data',b=>stderr+=b);
const base='http://127.0.0.1:30391';
try{
  let ready=false;
  for(let n=0;n<60;n++){
    if(child.exitCode!==null)throw new Error('service exited:'+stderr);
    try{const r=await fetch(base+'/healthz',{signal:AbortSignal.timeout(100)});if(r.ok){ready=true;break;}}catch{}
    await new Promise(r=>setTimeout(r,25));
  }
  assert.equal(ready,true,stderr);
  const r=await fetch(base+'/v2/provider-profile');assert.equal(r.status,200);const profile=await r.json();
  assert.deepEqual(profile,externalBiProviderProfileV1());
  const old=await (await fetch(base+'/v2/capabilities')).json();assert.deepEqual(old,profile.attestations[0]);
  const again=await (await fetch(base+'/v2/provider-profile')).json();assert.deepEqual(again,profile);
  const noRight=await fetch(base+'/v2/intents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({schemaVersion:'superset-bi-agent.external/intent-request/v2',requestId:'j02.no-rights',action:'analyze',input:{}})});
  const denial=await noRight.json();assert.equal(noRight.status,400);assert.equal(denial.code,'AGENT_CONTROL_TOKEN_MISSING');
  for(const body of [
    {schemaVersion:'superset-bi-agent.external/intent-request/v2',requestId:'j02.unknown',action:'undocumented'},
    {schemaVersion:'superset-bi-agent.external/intent-request/v2',requestId:'j02.held-promote',action:'trusted-apply'},
    {schemaVersion:'superset-bi-agent.external/intent-request/v2',requestId:'j02.identity',action:'status',product:{id:'user',version:'v999'}},
  ]){
    const q=await fetch(base+'/v2/intents',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    const v=await q.json();assert.equal(q.status,400);assert.equal(v.status,'DENIED');
    assert.match(v.code,/EXTERNAL_BI_(ACTION_DENIED|REQUEST_SURFACE_DENIED)/);
  }
  const spoof=await fetch(base+'/v2/provider-profile?productVersion=v999');assert.equal(spoof.status,400);
  assert.equal((await spoof.json()).code,'AGENT_ROUTE_DENIED');
  assert(before.equals(readFileSync(registry)));assert.equal(JSON.parse(before).entries[0].status,'HELD');
  process.stdout.write(JSON.stringify({outcome:'PASS',isolation:'PRIVATE_MOUNT_PID_NETWORK_NAMESPACE',profileDigest:profile.integrity.digest,sourceRequest:'DENIED_MISSING_RIGHTS',registry:'HELD_UNCHANGED',hostNetworkAccessible:false})+'\n');
}finally{
  const done=once(child,'exit');child.kill('SIGTERM');await done;
}
`;
test('J02 real HTTP provider binds identity and denies source rights, unknown operations and automatic HELD promotion',()=>{
  const args=['--unshare-all','--die-with-parent','--new-session','--clearenv',
    '--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64','--proc','/proc','--dev','/dev',
    '--ro-bind',realpathSync(process.cwd()),'/app','--ro-bind',realpathSync(process.execPath),'/runtime/node',
    '--tmpfs','/scratch','--setenv','TMPDIR','/scratch','--setenv','HOME','/scratch','--chdir','/app','--remount-ro','/',
    '/runtime/node','--input-type=module','-e',runner];
  const p=spawnSync('/usr/bin/bwrap',args,{encoding:'utf8',timeout:10000,maxBuffer:65536,env:{},killSignal:'SIGKILL'});
  assert.equal(p.error,undefined,p.stderr);assert.equal(p.signal,null,p.stderr);assert.equal(p.status,0,p.stderr);
  const evidence=JSON.parse(p.stdout);assert.equal(evidence.outcome,'PASS');assert.equal(evidence.registry,'HELD_UNCHANGED');
});
