import test from 'node:test';import assert from 'node:assert/strict';import {spawnSync} from 'node:child_process';import {randomBytes} from 'node:crypto';import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startControlServer,controlRequest,REPO_ROOT} from './helpers/ks254-http-harness.mjs';import {readActiveProjectionGeneration} from '../services/bi-control/src/projection-generation.mjs';
const command=(args)=>spawnSync(process.execPath,['scripts/hosting/portable-runtime.mjs',...args],{cwd:REPO_ROOT,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
test('H08 actual cold owner CLI exports reimports and persists scoped tombstone cleanup without operator account',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ks296-cli-'));let server;
 try{server=await startControlServer({root:join(root,'origin'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1'}});const analyzed=await controlRequest(server,{route:'/v1/analyze',action:'analyze'});assert.equal(analyzed.status,200);
 const active=readActiveProjectionGeneration({receiptDir:server.receiptDir});await server.stop();server=null;
 const keyFile=join(root,'key'),secret=randomBytes(32);writeFileSync(keyFile,secret,{mode:0o600});const bundle=join(root,'retained.ksbundle'),target=join(root,'restore');
 const common=['--local-synthetic-opt-in','--key-file',keyFile,'--bundle',bundle];
 const exported=command(['export',...common,'--receipt-dir',join(root,'origin/receipts')]);assert.equal(exported.status,0,'Actual portable export CLI missing: '+exported.stderr);assert.equal(exported.stderr,'');assert.equal(JSON.parse(exported.stdout).operatorAccountRequired,false);assert.equal(exported.stdout.includes(secret.toString('hex')),false);
 const flags=[...common,'--target-root',target,'--generation',active.generationId];
 const restored=command(['restore',...flags]);assert.equal(restored.status,0);assert.equal(restored.stderr,'');const restoredBody=JSON.parse(restored.stdout);assert.equal(restoredBody.state,'RESTORED_LOCAL');assert.equal(restoredBody.runtimeReadyClaimed,false);
 const tombstone=command(['tombstone',...flags]);assert.equal(tombstone.status,0);assert.equal(JSON.parse(tombstone.stdout).state,'TOMBSTONED');assert.equal(JSON.parse(tombstone.stdout).restoredDataRemoved,false);
 const cleanup=command(['cleanup',...flags]);assert.equal(cleanup.status,0);assert.equal(JSON.parse(cleanup.stdout).state,'SCOPED_DATA_REMOVED');assert.equal(JSON.parse(cleanup.stdout).declaredBackupRetained,true);assert.equal(JSON.parse(cleanup.stdout).externalBackupErasure,'UNKNOWN');
 assert.equal(readActiveProjectionGeneration({receiptDir:join(target,'receipts')}).ok,false);assert.equal(readFileSync(bundle).includes(secret),false);
 }finally{if(server)await server.stop();rmSync(root,{recursive:true,force:true});}
});
