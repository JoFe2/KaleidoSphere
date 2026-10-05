import test from 'node:test';import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {startControlServer,controlRequest} from './helpers/ks254-http-harness.mjs';
import {exportH08BundleV1} from '../services/bi-control/src/hosting/portable-runtime.mjs';
import {readActiveProjectionGeneration} from '../services/bi-control/src/projection-generation.mjs';
let lifecycle;try{lifecycle=await import('../services/bi-control/src/hosting/portable-runtime-lifecycle.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function actualBundle(){const root=mkdtempSync(join(tmpdir(),'ks296-lifecycle-'));let server;
 try{server=await startControlServer({root:join(root,'origin'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1'}});
 const response=await controlRequest(server,{route:'/v1/analyze',action:'analyze'});assert.equal(response.status,200);
 const active=readActiveProjectionGeneration({receiptDir:server.receiptDir});assert.equal(active.ok,true);const key=randomBytes(32),bundlePath=join(root,'retained.ksbundle');
 exportH08BundleV1({optIn:true,receiptDir:server.receiptDir,bundlePath,key});await server.stop();server=null;
 return{root,key,bundlePath,active,backupHash:hash(readFileSync(bundlePath)),sourceHash:hash(readFileSync(active.projectionPath))};
 }catch(error){if(server)await server.stop();rmSync(root,{recursive:true,force:true});throw error;}}
test('H08 tombstone retains data until scoped cleanup and retained backup supports real fresh local reacquisition',async()=>{
 const f=await actualBundle();let first,reopened,next,server;
 try{
 assert.equal(typeof lifecycle?.createH08PortableLifecycleV1,'function','H08 missing actual owned restore lifecycle');
 const options={optIn:true,bundlePath:f.bundlePath,key:f.key,expectedGeneration:f.active.generationId,targetRoot:join(f.root,'first-restored')};
 first=lifecycle.createH08PortableLifecycleV1(options);const initial=first.inspect();assert.equal(initial.state,'RESTORED_LOCAL');assert.equal(initial.runtimeReadyClaimed,false);
 first.close();first=null;reopened=lifecycle.openH08PortableLifecycleV1(options);
 const tombstone=reopened.tombstone(f.active.generationId);assert.equal(tombstone.state,'TOMBSTONED');assert.equal(tombstone.restoredDataRemoved,false);assert.equal(tombstone.declaredBackupRetained,true);
 assert.equal(readActiveProjectionGeneration({receiptDir:join(options.targetRoot,'receipts')}).ok,true);
 const cleanup=reopened.cleanup(f.active.generationId);assert.equal(cleanup.state,'SCOPED_DATA_REMOVED');assert.equal(cleanup.restoredDataRemoved,true);assert.equal(cleanup.declaredBackupRetained,true);assert.equal(cleanup.externalBackupErasure,'UNKNOWN');
 assert.equal(existsSync(join(options.targetRoot,'receipts')),false);assert.equal(existsSync(join(options.targetRoot,'projection')),false);assert.equal(hash(readFileSync(f.bundlePath)),f.backupHash);assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceHash);
 reopened.close();reopened=null;next=lifecycle.createH08PortableLifecycleV1({...options,targetRoot:join(f.root,'fresh-reacquired')});
 const revived=next.inspect();assert.equal(revived.state,'RESTORED_LOCAL');assert.equal(revived.generationId,f.active.generationId);
 server=await startControlServer({root:join(f.root,'reacquired-control'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1',RECEIPT_DIR:revived.receiptDir,PROJECTION_DB:revived.projectionDb}});
 const readback=await controlRequest(server,{route:'/v1/readback',action:'readback'});assert.equal(readback.status,200);assert.equal(readback.body.generationId,f.active.generationId);assert.equal(server.diagnostics(),'');
 }finally{if(server)await server.stop();for(const handle of [first,reopened,next])if(handle)handle.close();rmSync(f.root,{recursive:true,force:true});}
});

test('H08 foreign resource inside cleanup scope prevents any removal',async()=>{
 const f=await actualBundle();let handle;try{
 const targetRoot=join(f.root,'restore');handle=lifecycle.createH08PortableLifecycleV1({optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot,expectedGeneration:f.active.generationId});
 handle.tombstone(f.active.generationId);writeFileSync(join(targetRoot,'foreign-resource'),'DO_NOT_REMOVE',{mode:0o600});
 assert.throws(()=>handle.cleanup(f.active.generationId),/H08_FOREIGN_RESOURCE_DENIED/);
 assert.equal(readFileSync(join(targetRoot,'foreign-resource'),'utf8'),'DO_NOT_REMOVE');assert.equal(readActiveProjectionGeneration({receiptDir:join(targetRoot,'receipts')}).ok,true);
 assert.equal(hash(readFileSync(f.bundlePath)),f.backupHash);assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceHash);
 }finally{if(handle)handle.close();rmSync(f.root,{recursive:true,force:true});}
});
test('H08 cleanup without tombstone and wrong generation are both refused',async()=>{
 const f=await actualBundle();let handle;try{
 const targetRoot=join(f.root,'restore');handle=lifecycle.createH08PortableLifecycleV1({optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot,expectedGeneration:f.active.generationId});
 assert.throws(()=>handle.cleanup(f.active.generationId),/H08_TOMBSTONE_REQUIRED/);assert.throws(()=>handle.tombstone('f'.repeat(64)),/H08_LIFECYCLE_GENERATION_DENIED/);
 assert.equal(readActiveProjectionGeneration({receiptDir:join(targetRoot,'receipts')}).ok,true);
 }finally{if(handle)handle.close();rmSync(f.root,{recursive:true,force:true});}
});
test('H08 persisted owner marker requires the real owner key and cannot be forged with edited facts',async()=>{
 const f=await actualBundle();let handle;try{
 const options={optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot:join(f.root,'restore'),expectedGeneration:f.active.generationId};handle=lifecycle.createH08PortableLifecycleV1(options);handle.close();handle=null;
 assert.throws(()=>lifecycle.openH08PortableLifecycleV1({...options,key:randomBytes(32)}),/H08_LIFECYCLE_AUTHENTICATION_DENIED/);
 const file=join(options.targetRoot,'portable-lifecycle.json'),marker=JSON.parse(readFileSync(file));marker.body.state='TOMBSTONED';writeFileSync(file,JSON.stringify(marker));
 assert.throws(()=>lifecycle.openH08PortableLifecycleV1(options),/H08_LIFECYCLE_AUTHENTICATION_DENIED/);
 assert.equal(readActiveProjectionGeneration({receiptDir:join(options.targetRoot,'receipts')}).ok,true);assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceHash);
 }finally{if(handle)handle.close();rmSync(f.root,{recursive:true,force:true});}
});
test('H08 copied marker on another real directory cannot acquire cleanup ownership',async()=>{
 const f=await actualBundle();let handle;try{
 const options={optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot:join(f.root,'restore'),expectedGeneration:f.active.generationId};handle=lifecycle.createH08PortableLifecycleV1(options);handle.close();handle=null;
 const foreign=join(f.root,'other-owner');mkdirSync(foreign,{mode:0o700});writeFileSync(join(foreign,'portable-lifecycle.json'),readFileSync(join(options.targetRoot,'portable-lifecycle.json')),{mode:0o600});writeFileSync(join(foreign,'untouched'),'FOREIGN',{mode:0o600});
 assert.throws(()=>lifecycle.openH08PortableLifecycleV1({...options,targetRoot:foreign}),/H08_LIFECYCLE_BINDING_DENIED/);assert.equal(readFileSync(join(foreign,'untouched'),'utf8'),'FOREIGN');
 assert.equal(readActiveProjectionGeneration({receiptDir:join(options.targetRoot,'receipts')}).ok,true);
 }finally{if(handle)handle.close();rmSync(f.root,{recursive:true,force:true});}
});
