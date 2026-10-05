// Optional owner-local portable contract for the existing synthetic native
// projection/receipt generation. Never exports tokens, caller roles or a live
// source, and never converts stored facts into runtime READY or execution rights.
import {createHash,createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {openSync,fstatSync,readSync,closeSync,constants,mkdirSync,writeFileSync,readlinkSync} from 'node:fs';
import {resolve,dirname,basename,join,isAbsolute} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {canonicalJson} from '../canonical-json.js';
import {readActiveProjectionGeneration,mirrorActiveProjectionGeneration,PROJECTION_GENERATION_CONTRACT} from '../projection-generation.mjs';
import {stageGeneration,activateGeneration,GENERATION_STORE_CONTRACT} from '../generation-store.mjs';
export const H08_EXPORT_SCHEMA='kaleidosphere/export-bundle/v1';
export const H08_CHECKPOINT_SCHEMA='kaleidosphere/checkpoint-manifest/v1';
const MAX=16*1024*1024;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
function path(value){if(typeof value!=='string'||!isAbsolute(value)||resolve(value)!==value||value.length>4096||/[\x00-\x1f\x7f]/.test(value))fail('H08_PATH_DENIED');return value;}
function directory(value){path(value);let fd=openSync('/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{for(const part of value.split('/').filter(Boolean)){const next=openSync('/proc/self/fd/'+fd+'/'+part,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);closeSync(fd);fd=next;}return fd;}
 catch{closeSync(fd);fail('H08_PATH_DENIED');}}
function fileBytes(value,limit=MAX){let dir,fd;try{dir=directory(dirname(path(value)));fd=openSync('/proc/self/fd/'+dir+'/'+basename(value),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const st=fstatSync(fd);if(!st.isFile()||st.uid!==process.getuid()||st.nlink!==1||st.size>limit)fail('H08_FILE_DENIED');
 const bytes=Buffer.alloc(st.size+1);let n=0;while(n<bytes.length){const got=readSync(fd,bytes,n,bytes.length-n,null);if(!got)break;n+=got;}
 if(n!==st.size)fail('H08_FILE_DRIFT_DENIED');return bytes.subarray(0,n);
 }finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir);}}
function createPrivate(value){let fd;try{fd=directory(dirname(path(value)));const parent='/proc/self/fd/'+fd;mkdirSync(parent+'/'+basename(value),{mode:0o700});
 const owned=openSync(parent+'/'+basename(value),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const st=fstatSync(owned);
 if(st.uid!==process.getuid()||(st.mode&0o077)!==0){closeSync(owned);fail('H08_OWNER_REQUIRED');}return{fd:owned,device:st.dev,inode:st.ino,root:value};
 }catch{fail('H08_FRESH_TARGET_REQUIRED');}finally{if(fd!==undefined)closeSync(fd);}}
function writeNew(value,bytes){let dir,fd;try{dir=directory(dirname(path(value)));fd=openSync('/proc/self/fd/'+dir+'/'+basename(value),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);writeFileSync(fd,bytes);}finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir);}}
function contracts(){return{generationStore:GENERATION_STORE_CONTRACT,projectionGeneration:PROJECTION_GENERATION_CONTRACT};}
function runtime(){return{name:'node',version:process.versions.node,productVersion:'0.26.0'};}
function sourcePins(){return Object.fromEntries(['generation-store.mjs','projection-generation.mjs','catalog.mjs'].map(name=>[name,hash(fileBytes(resolve(import.meta.dirname,'..',name)))]));}
function inspectProjection(file,receipt){const db=new DatabaseSync(file,{readOnly:true});try{
 if(Object.values(db.prepare('PRAGMA quick_check').get())[0]!=='ok')fail('H08_STORE_CORRUPT');
 const rows=db.prepare('SELECT * FROM bi_analysis_summary').all();if(rows.length!==1||rows[0].receipt_id!==receipt.receiptId||rows[0].snapshot_sha256!==receipt.analysis.snapshotSha256||rows[0].source_mode!=='fixture')fail('H08_STORE_BINDING_DENIED');
 }finally{db.close();}}
export function exportH08BundleV1({optIn,receiptDir,bundlePath,key}){
 if(optIn!==true)fail('H08_OPT_IN_REQUIRED');
 const dir=directory(receiptDir);let checkpoint;
 try{
  const st=fstatSync(dir);if(st.uid!==process.getuid())fail('H08_OWNER_REQUIRED');
  const active=readActiveProjectionGeneration({receiptDir});if(!active.ok)fail('H08_STORE_CORRUPT');
  const receipt=active.receipt;if(receipt.sourceMode!=='fixture'||receipt.engine!=='mssql'||receipt.analysis.runtimeValidation!=='SYNTHETIC_UNVALIDATED')fail('H08_SYNTHETIC_SCOPE_REQUIRED');
  inspectProjection(active.projectionPath,receipt);
  const generationManifest=JSON.parse(fileBytes(join(active.generationPath,'generation.manifest.json')));
  const files=['analytics.db','receipt.json'].map(name=>{const bytes=fileBytes(join(active.generationPath,name));return{path:name,sha256:hash(bytes),bytes:bytes.length,content:bytes.toString('base64')};});
  if(generationManifest.files.length!==2||generationManifest.files.some((entry,i)=>entry.path!==files[i].path||entry.sha256!==files[i].sha256))fail('H08_STORE_BINDING_DENIED');
  checkpoint={schemaVersion:H08_CHECKPOINT_SCHEMA,generationId:active.generationId,generationManifest,configuration:{engine:'mssql',sourceMode:'fixture'},contracts:contracts(),runtime:runtime(),sourcePins:sourcePins(),origin:{receiptDir,device:st.dev,inode:st.ino},files:files.map(({content,...entry})=>entry),scope:'OWNED_SYNTHETIC_NATIVE_PROJECTION_RECEIPT_NOT_FULL_APP',runtimeReadyClaimed:false,operatorAccountRequired:false};
  const fresh=readActiveProjectionGeneration({receiptDir});if(!fresh.ok||fresh.generationId!==active.generationId||files.some(entry=>hash(fileBytes(join(active.generationPath,entry.path)))!==entry.sha256))fail('H08_SOURCE_DRIFT_DENIED');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});cipher.setAAD(Buffer.from(canonicalJson(checkpoint)));
  const payload=Buffer.from(canonicalJson({files}));const encrypted=Buffer.concat([cipher.update(payload),cipher.final()]);
  const envelope={schemaVersion:H08_EXPORT_SCHEMA,checkpoint,iv:iv.toString('hex'),authTag:cipher.getAuthTag().toString('hex'),ciphertext:encrypted.toString('base64')};
  writeNew(bundlePath,canonicalJson(envelope)+'\n');return{state:'EXPORTED_LOCAL',operatorAccountRequired:false,checkpoint,bundleSha256:hash(fileBytes(bundlePath,MAX*2)),runtimeReadyClaimed:false};
 }finally{closeSync(dir);}}
export function restoreH08BundleV1(options){
 if(options.optIn!==true)fail('H08_OPT_IN_REQUIRED');
 const custody={target:null,quarantineAllowed:false,bundle:null};
 try{
  const bundleBytes=fileBytes(options.bundlePath,MAX*2),envelope=JSON.parse(bundleBytes),checkpoint=envelope.checkpoint;
  // Unauthenticated metadata can only restrict a destination, never authorize
  // activation. Establish the source exclusion before any error-path mkdir,
  // including missing/wrong keys. Unknown source bounds permit no target writes.
  if(envelope.schemaVersion!==H08_EXPORT_SCHEMA||checkpoint?.schemaVersion!==H08_CHECKPOINT_SCHEMA)fail('H08_CHECKPOINT_MISMATCH');
  const sourceRoot=path(checkpoint?.origin?.receiptDir),targetRoot=path(options.targetRoot);
  if(targetRoot===sourceRoot||targetRoot.startsWith(sourceRoot+'/')||sourceRoot.startsWith(targetRoot+'/'))fail('H08_ORIGINAL_STORE_RESTORE_DENIED');
  custody.bundle={bundleBytes,envelope,checkpoint};custody.quarantineAllowed=true;
  if(!Buffer.isBuffer(options.key)||options.key.length!==32)fail('H08_KEY_REQUIRED');return restoreNative(options,custody);
 }
 catch(error){const result={state:'QUARANTINED',reason:/^H08_[A-Z0-9_]+$/.test(error.code??'')?error.code:'H08_BUNDLE_INVALID',candidateActivated:false,runtimeReadyClaimed:false,lastQualifiedGenerationRetained:true,quarantinePersisted:false};
  try{
   // Only this invocation's newly created directory can be reused after a
   // late failure. An arbitrary preexisting target remains refused.
   if(!custody.quarantineAllowed)fail('H08_QUARANTINE_LOCATION_DENIED');
   custody.target??=createPrivate(options.targetRoot);
   const own=custody.target;let current,output;
   try{current=directory(own.root);const live=fstatSync(current),held=fstatSync(own.fd);
    if(live.dev!==own.device||live.ino!==own.inode||held.dev!==own.device||held.ino!==own.inode||held.uid!==process.getuid()||(held.mode&0o077)!==0)fail('H08_TARGET_IDENTITY_DRIFT');
    output=openSync('/proc/self/fd/'+own.fd+'/quarantine.json',constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);
    writeFileSync(output,canonicalJson({...result,quarantinePersisted:true})+'\n');result.quarantinePersisted=true;
   }finally{if(output!==undefined)closeSync(output);if(current!==undefined)closeSync(current);}
  }catch{/* Refuse foreign/replaced/preexisting targets rather than overwrite them. */}
  return result;
 }finally{if(custody.target)closeSync(custody.target.fd);}}
function restoreNative({bundlePath,key,targetRoot,expectedGeneration},custody){
 const {bundleBytes,envelope,checkpoint}=custody.bundle;
 const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(envelope.iv,'hex'),{authTagLength:16});decipher.setAAD(Buffer.from(canonicalJson(checkpoint)));decipher.setAuthTag(Buffer.from(envelope.authTag,'hex'));
 const plaintext=Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]);const data=JSON.parse(plaintext);
 if(canonicalJson(checkpoint.configuration)!==canonicalJson({engine:'mssql',sourceMode:'fixture'}))fail('H08_CONFIGURATION_DENIED');
 if(envelope.schemaVersion!==H08_EXPORT_SCHEMA||checkpoint.schemaVersion!==H08_CHECKPOINT_SCHEMA||checkpoint.generationId!==expectedGeneration||canonicalJson(checkpoint.contracts)!==canonicalJson(contracts())||canonicalJson(checkpoint.runtime)!==canonicalJson(runtime())||canonicalJson(checkpoint.sourcePins)!==canonicalJson(sourcePins()))fail('H08_CHECKPOINT_MISMATCH');
 if(data.files.length!==2||checkpoint.files.length!==2||data.files.some((entry,i)=>entry.path!==['analytics.db','receipt.json'][i]||entry.sha256!==checkpoint.files[i].sha256||entry.bytes!==checkpoint.files[i].bytes||entry.sha256!==hash(Buffer.from(entry.content,'base64'))))fail('H08_CHECKPOINT_INCOMPLETE');
 path(targetRoot);if(targetRoot===checkpoint.origin.receiptDir||targetRoot.startsWith(checkpoint.origin.receiptDir+'/')||checkpoint.origin.receiptDir.startsWith(targetRoot+'/'))fail('H08_ORIGINAL_STORE_RESTORE_DENIED');
 custody.target=createPrivate(targetRoot);const receiptDir=join(targetRoot,'receipts'),projectionDb=join(targetRoot,'projection','analytics.db');
 mkdirSync(receiptDir,{mode:0o700});mkdirSync(dirname(projectionDb),{mode:0o700});
 const staged=stageGeneration({root:receiptDir,target:'portable',build:directory=>{for(const entry of data.files)writeNew(join(directory,entry.path),Buffer.from(entry.content,'base64'));return{label:checkpoint.generationManifest.label,files:checkpoint.generationManifest.files};}});
 if(staged.generationId!==checkpoint.generationId)fail('H08_GENERATION_MISMATCH');
 inspectProjection(join(staged.stagingPath,'analytics.db'),JSON.parse(fileBytes(join(staged.stagingPath,'receipt.json'))));
 activateGeneration({root:receiptDir,staged,target:'portable'});mirrorActiveProjectionGeneration({receiptDir,projectionDb});
 const result={state:'RESTORED_LOCAL',receiptDir,projectionDb,generationId:staged.generationId,bundleSha256:hash(bundleBytes),configuration:checkpoint.configuration,contracts:checkpoint.contracts,runtime:checkpoint.runtime,runtimeReadyClaimed:false,operatorAccountRequired:false,otherInfrastructureTested:false};
 writeNew(join(targetRoot,'portable-state.json'),canonicalJson(result)+'\n');return result;
}
