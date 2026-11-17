// Explicit SYNTHETIC single-host fixture. Actual KS servers/SQLite/HTTP, no PAN runtime.
import {InMemoryEvidenceStore,sha256Digest} from '../../services/bi-control/src/assistant-foundation/core-contracts.mjs';
import {readFileSync,writeFileSync,mkdtempSync,createWriteStream,rmSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
export async function startProcessViewFixtureV1({seed=true,configured=true}={}){
 const repo=process.cwd(),root=mkdtempSync(join(tmpdir(),'ks324-SYNTHETIC-'));
 const base=JSON.parse(readFileSync('services/bi-control/fixtures/assistant-foundation/event-envelope-v1.json','utf8'));
 const binding={scope:{tenantId:'SYNTHETIC-local',principalDigest:'c'.repeat(64),privacyEpoch:1},sourceId:'pan548.signed-native-context-outbox/v1',sourceEpoch:'a'.repeat(64),streamId:'ks324:SYNTHETIC-stream',producer:base.version.producer};
 const stateRoot=join(root,'inbox');
 const store=new InMemoryEvidenceStore({agentProcess:{stateRoot,binding,authorizeRead:()=>true,maxEvents:128}});
 const make=(id,seq,task,phase,revision,time,cause=null)=>{
  const e=structuredClone(base);Object.assign(e,{eventType:'pan.workspace.action.observed',eventId:'ks324:SYNTHETIC-'+id,streamId:binding.streamId,seq,correlationId:'ks324:SYNTHETIC-case',causationId:cause?'ks324:SYNTHETIC-'+cause:null});e.version.contract='workspace-action-observation';
  e.payload={schemaVersion:'kaleidosphere.agent-process/action-observation/v1',scope:structuredClone(binding.scope),source:{sourceId:binding.sourceId,sourceEpoch:binding.sourceEpoch,eventDigest:sha256Digest({SYNTHETIC:id}).slice(7),sourceTimeMs:time},action:{taskId:'invocation:SYNTHETIC-'+task,stepId:'step:SYNTHETIC-'+task,attempt:1,capability:'pan.workspace.view.preview/v1',taskRevision:revision},mode:'PREVIEW',phase,result:phase==='RESULT_CONFIRMED'?{resultPhase:'PREVIEW_VALIDATED',proofRef:'context-proof:'+'f'.repeat(64),proofKind:'PAN546_PREVIEW_VALIDATED'}:null,readbackRef:phase==='RESULT_CONFIRMED'?'invocation:SYNTHETIC-'+task:null,processFacts:'NOT_OBSERVED',humanFacts:'NOT_OBSERVED',grantFacts:'NOT_OBSERVED'};
  e.payloadDigest=sha256Digest(e.payload);return e;
 };
 const events=seed?[make('pending',1,'preview','PENDING',1,100),make('confirmed',2,'preview','RESULT_CONFIRMED',2,350,'pending'),make('unknown',3,'readback','UNKNOWN',1,null)]:[];
 const acks=events.map(e=>store.importBytes(Buffer.from(JSON.stringify(e))));
 const token=randomBytes(32).toString('hex'),tokenFile=join(root,'SYNTHETIC-control-token'),configFile=join(root,'process-owner.json');
 writeFileSync(tokenFile,token,{mode:0o600});writeFileSync(configFile,JSON.stringify({stateRoot,binding,maxEvents:128}),{mode:0o600});
 const transport=join(root,'SYNTHETIC-container-address-transport.mjs');
 writeFileSync(transport,`// Exact container address translation only: real HTTP/body/auth; no response synthesis.\nconst real=globalThis.fetch;globalThis.fetch=(input,init)=>{const s=String(input);return real(s.startsWith('http://bi-control:18089/')?process.env.KS324_TEST_CONTROL_BASE+s.slice('http://bi-control:18089'.length):input,init);};\n`);
 const port=()=>new Promise((resolve,reject)=>{const s=createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const controlPort=await port(),agentPort=await port(),control='http://127.0.0.1:'+controlPort,origin='http://127.0.0.1:'+agentPort;
 const children=[];
 const launch=(name,script,env)=>{const log=createWriteStream(join(root,name+'.log'));const p=spawn(process.execPath,[script],{cwd:repo,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});p.stdout.pipe(log);p.stderr.pipe(log);children.push(p);return p;};
 const common={CONTROL_TOKEN_FILE:tokenFile,RECEIPT_DIR:join(root,'receipts'),PROJECTION_DB:join(root,'projection.sqlite'),REPOSITORY_ROOT:resolve('services/bi-control'),BI_FIXTURE_DIR:resolve('services/bi-control/fixtures'),BI_ENGINE:'mssql',BI_SOURCE_MODE:'fixture',CONTROL_BIND_ADDRESS:'127.0.0.1',KS_H03_STARTER_OPT_IN:'false',KS_H05_NATIVE_PROBE_OPT_IN:'false'};
 const backend=launch('control','services/bi-control/src/server.mjs',{...common,PORT:String(controlPort),...(configured?{KS324_PROCESS_INBOX_CONFIG_FILE:configFile}:{})});
 const agent=launch('agent','services/bi-agent/src/server.mjs',{...common,PORT:String(agentPort),CONTROL_BASE_URL:'http://bi-control:18089',AGENT_ROUTE_PREFIX:'',KS324_TEST_CONTROL_BASE:control,NODE_OPTIONS:'--import='+transport});
 const stop=async()=>{store.close();await Promise.all(children.map(p=>new Promise(resolve=>{if(p.exitCode!==null)return resolve();p.once('exit',resolve);p.kill('SIGTERM');})));rmSync(tokenFile,{force:true});};
 const wait=async(url,p)=>{for(let i=0;i<100;i++){if(p.exitCode!==null)throw Error('Fixture process exited; see '+root);try{if((await fetch(url+'/healthz')).ok)return;}catch{}await new Promise(r=>setTimeout(r,30));}throw Error('Fixture readiness timeout; see '+root);};
 try{await Promise.all([wait(control,backend),wait(origin,agent)]);}catch(error){await stop();throw error;}
 return{root,origin,control,store,events,acks,binding,stateRoot,configFile,tokenFile,
  request:async(body={phase:'ALL'})=>fetch(control+'/v1/process-view/read',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)}),
  appendUnknown(){const e=make('later-unknown',store.durableEvents().length+1,'preview','UNKNOWN',3,450,'confirmed');store.append(e);return e;},close:stop};
}
