import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdtempSync,mkdirSync,chmodSync,rmSync,readFileSync,writeFileSync,statSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startControlServer,controlRequest} from './helpers/ks254-http-harness.mjs';
import {readActiveProjectionGeneration} from '../services/bi-control/src/projection-generation.mjs';
import {canonicalJson} from '../services/bi-control/src/canonical-json.js';
let portable;
try{portable=await import('../services/bi-control/src/hosting/portable-runtime.mjs');}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const question={family:'largest_tables',scope:{schemas:['dbo']},object:null,limit:20};
async function observed(control){const response=await controlRequest(control,{route:'/v1/catalog/question',body:question});assert.equal(response.status,200);return response.body;}
test('H08 actual native catalog generation exports and restores into a distinct cold local product without operator account',async()=>{
 const root=mkdtempSync(join(tmpdir(),'ks296-native-roundtrip-'));let origin,target;
 try{
  origin=await startControlServer({root:join(root,'origin'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1'}});
  const analyzed=await controlRequest(origin,{route:'/v1/analyze',action:'analyze'});assert.equal(analyzed.status,200);
  const before=await observed(origin);assert.deepEqual(before.rows.filter(row=>row.relation_kind==='TABLE').map(row=>row.schema_name+'.'+row.relation_name).sort(),['dbo.customers','dbo.orders']);
  const active=readActiveProjectionGeneration({receiptDir:origin.receiptDir});assert.equal(active.ok,true);
  const originalBytes=readFileSync(active.projectionPath);await origin.stop();origin=null;
  assert.equal(typeof portable?.exportH08BundleV1,'function','H08 missing actual portable native generation export');
  const key=randomBytes(32),bundle=join(root,'retained.ksbundle');
  const exported=portable.exportH08BundleV1({optIn:true,receiptDir:join(root,'origin/receipts'),bundlePath:bundle,key});
  assert.equal(exported.operatorAccountRequired,false);assert.equal(exported.checkpoint.generationId,active.generationId);
  assert.equal(exported.checkpoint.runtime.version,process.versions.node);
  assert.notEqual(readFileSync(bundle).indexOf(originalBytes),0);
  const fresh=join(root,'fresh-restored');
  const restored=portable.restoreH08BundleV1({optIn:true,bundlePath:bundle,key,targetRoot:fresh,expectedGeneration:active.generationId});
  assert.equal(restored.state,'RESTORED_LOCAL');assert.equal(restored.runtimeReadyClaimed,false);
  assert.notEqual(statSync(restored.receiptDir).ino,statSync(join(root,'origin/receipts')).ino);
  assert.equal(hash(readFileSync(restored.projectionDb)),hash(originalBytes));
  target=await startControlServer({root:join(root,'new-control'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1',RECEIPT_DIR:restored.receiptDir,PROJECTION_DB:restored.projectionDb}});
  const after=await observed(target);assert.deepEqual(after.rows,before.rows);assert.deepEqual(after.provenance,before.provenance);
  const readback=await controlRequest(target,{route:'/v1/readback',action:'readback'});assert.equal(readback.status,200);assert.equal(readback.body.generationId,active.generationId);
  assert.equal(hash(readFileSync(active.projectionPath)),hash(originalBytes));
  assert.equal(origin,null);assert.equal(target.diagnostics(),'');assert.equal(readFileSync(bundle).includes(key),false);
 }finally{if(origin)await origin.stop();if(target)await target.stop();rmSync(root,{recursive:true,force:true});}
});

async function nativeBundle(){
 const root=mkdtempSync(join(tmpdir(),'ks296-negative-'));let control;
 try{control=await startControlServer({root:join(root,'origin'),extraEnv:{CONTROL_BIND_ADDRESS:'127.0.0.1'}});
 const response=await controlRequest(control,{route:'/v1/analyze',action:'analyze'});assert.equal(response.status,200);
 const active=readActiveProjectionGeneration({receiptDir:control.receiptDir});assert.equal(active.ok,true);
 const key=randomBytes(32),bundlePath=join(root,'backup.ksbundle');
 const exported=portable.exportH08BundleV1({optIn:true,receiptDir:control.receiptDir,bundlePath,key});
 await control.stop();control=null;
 return{root,key,bundlePath,exported,active,sourceSha256:hash(readFileSync(active.projectionPath)),cleanup:()=>rmSync(root,{recursive:true,force:true})};
 }catch(error){if(control)await control.stop();rmSync(root,{recursive:true,force:true});throw error;}
}
test('H08 absent restore key records quarantine rather than activating a candidate',async()=>{
 const f=await nativeBundle();try{
 const targetRoot=join(f.root,'missing-key');
 const result=portable.restoreH08BundleV1({optIn:true,bundlePath:f.bundlePath,targetRoot,expectedGeneration:f.active.generationId});
 assert.equal(result.state,'QUARANTINED');assert.equal(result.reason,'H08_KEY_REQUIRED');assert.equal(result.runtimeReadyClaimed,false);assert.equal(result.candidateActivated,false);
 assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceSha256);
 assert.equal(readActiveProjectionGeneration({receiptDir:join(targetRoot,'receipts')}).ok,false);
 assert.equal(JSON.parse(readFileSync(join(targetRoot,'quarantine.json'))).state,'QUARANTINED');
 }finally{f.cleanup();}
});

function reseal(f,change){
 const envelope=JSON.parse(readFileSync(f.bundlePath));
 const decipher=createDecipheriv('aes-256-gcm',f.key,Buffer.from(envelope.iv,'hex'));decipher.setAAD(Buffer.from(canonicalJson(envelope.checkpoint)));decipher.setAuthTag(Buffer.from(envelope.authTag,'hex'));
 const data=JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]));change(envelope.checkpoint,data);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',f.key,iv);cipher.setAAD(Buffer.from(canonicalJson(envelope.checkpoint)));
 envelope.iv=iv.toString('hex');envelope.ciphertext=Buffer.concat([cipher.update(Buffer.from(canonicalJson(data))),cipher.final()]).toString('base64');envelope.authTag=cipher.getAuthTag().toString('hex');
 writeFileSync(f.bundlePath,canonicalJson(envelope)+'\n');
}
test('H08 authenticated but incompatible configuration cannot activate a restored generation',async()=>{
 const f=await nativeBundle();try{
 reseal(f,checkpoint=>{checkpoint.configuration={engine:'oracle',sourceMode:'live',callerRole:'admin'};});
 const result=portable.restoreH08BundleV1({optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot:join(f.root,'wrong-config'),expectedGeneration:f.active.generationId});
 assert.equal(result.state,'QUARANTINED');assert.equal(result.reason,'H08_CONFIGURATION_DENIED');assert.equal(result.candidateActivated,false);
 assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceSha256);
 }finally{f.cleanup();}
});

for(const [label,change,options] of [
 ['wrong key',()=>{},f=>({key:randomBytes(32)})],
 ['wrong generation',()=>{},()=>({expectedGeneration:'f'.repeat(64)})],
 ['corrupt bundle',f=>{const wire=JSON.parse(readFileSync(f.bundlePath));wire.ciphertext='not-a-valid-complete-encrypted-bundle';writeFileSync(f.bundlePath,JSON.stringify(wire));},()=>({})],
 ['incomplete checkpoint',f=>reseal(f,checkpoint=>{checkpoint.files.pop();}),()=>({})],
 ['runtime version mismatch',f=>reseal(f,checkpoint=>{checkpoint.runtime.version='24.0.0';}),()=>({})],
 ['contract version mismatch',f=>reseal(f,checkpoint=>{checkpoint.contracts.projectionGeneration='chimpmaera.bi/projection-generation/v999';}),()=>({})],
 ['actual generation store mismatch',f=>reseal(f,checkpoint=>{checkpoint.generationManifest.label='receipt:wrong-real-generation';}),()=>({})],
 ])test('H08 '+label+' is quarantined before candidate activation and leaves origin intact',async()=>{
 const f=await nativeBundle();try{change(f);const targetRoot=join(f.root,'candidate');
 const result=portable.restoreH08BundleV1({optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot,expectedGeneration:f.active.generationId,...options(f)});
 assert.equal(result.state,'QUARANTINED');assert.equal(result.candidateActivated,false);assert.equal(result.runtimeReadyClaimed,false);
 assert.equal(readActiveProjectionGeneration({receiptDir:join(targetRoot,'receipts')}).ok,false);
 assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceSha256);
 }finally{f.cleanup();}
 });
test('H08 a claimed restore into the original store is denied without writing or replacing it',async()=>{
 const f=await nativeBundle();try{
 const result=portable.restoreH08BundleV1({optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot:join(f.root,'origin/receipts'),expectedGeneration:f.active.generationId});
 assert.equal(result.state,'QUARANTINED');assert.equal(result.reason,'H08_ORIGINAL_STORE_RESTORE_DENIED');
 assert.equal(readActiveProjectionGeneration({receiptDir:join(f.root,'origin/receipts')}).generationId,f.active.generationId);
 assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceSha256);
 }finally{f.cleanup();}
});
test('H08 corrupt current source store cannot produce a usable export',async()=>{
 const f=await nativeBundle();try{writeFileSync(f.active.projectionPath,Buffer.from('corrupt native SQLite generation'));
 assert.throws(()=>portable.exportH08BundleV1({optIn:true,receiptDir:join(f.root,'origin/receipts'),bundlePath:join(f.root,'corrupt-export'),key:f.key}),/H08_STORE_CORRUPT/);
 }finally{f.cleanup();}
});

test('H08 late generation failure persists quarantine inside only its invocation-created target',async()=>{
 const f=await nativeBundle();try{
 reseal(f,checkpoint=>{checkpoint.generationId='0'.repeat(64);});
 const targetRoot=join(f.root,'late-quarantine');
 const result=portable.restoreH08BundleV1({optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot,expectedGeneration:'0'.repeat(64)});
 assert.equal(result.state,'QUARANTINED');assert.equal(result.reason,'H08_GENERATION_MISMATCH');assert.equal(result.candidateActivated,false);
 assert.equal(JSON.parse(readFileSync(join(targetRoot,'quarantine.json'))).reason,'H08_GENERATION_MISMATCH');
 assert.equal(readActiveProjectionGeneration({receiptDir:join(targetRoot,'receipts')}).ok,false);assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceSha256);
 }finally{f.cleanup();}
});
test('H08 preexisting foreign target remains refused and receives no quarantine file',async()=>{
 const f=await nativeBundle();try{
 const foreign=join(f.root,'foreign');mkdirSync(foreign,{mode:0o700});writeFileSync(join(foreign,'unrelated'),'foreign-owner-evidence',{mode:0o600});
 const result=portable.restoreH08BundleV1({optIn:true,bundlePath:f.bundlePath,key:f.key,targetRoot:foreign,expectedGeneration:f.active.generationId});
 assert.equal(result.state,'QUARANTINED');assert.equal(result.reason,'H08_FRESH_TARGET_REQUIRED');
 assert.throws(()=>readFileSync(join(foreign,'quarantine.json')),error=>error.code==='ENOENT');assert.equal(readFileSync(join(foreign,'unrelated'),'utf8'),'foreign-owner-evidence');
 }finally{f.cleanup();}
});

test('H08 denied source descendant receives no target or quarantine writes even with absent or wrong key',async()=>{
 const f=await nativeBundle();try{
 const receiptDir=join(f.root,'origin/receipts');const before=readdirSync(receiptDir).sort();
 for(const [name,key] of [['valid',f.key],['absent',undefined],['wrong',randomBytes(32)]]){
 const targetRoot=join(receiptDir,'forbidden-'+name);
 const result=portable.restoreH08BundleV1({optIn:true,bundlePath:f.bundlePath,key,targetRoot,expectedGeneration:f.active.generationId});
 assert.equal(result.state,'QUARANTINED');assert.equal(result.reason,'H08_ORIGINAL_STORE_RESTORE_DENIED');assert.equal(result.quarantinePersisted,false);
 assert.equal(existsSync(targetRoot),false,'original source descendant created: '+name);assert.deepEqual(readdirSync(receiptDir).sort(),before);
 assert.equal(readActiveProjectionGeneration({receiptDir}).generationId,f.active.generationId);assert.equal(hash(readFileSync(f.active.projectionPath)),f.sourceSha256);
 }
 }finally{f.cleanup();}
});
