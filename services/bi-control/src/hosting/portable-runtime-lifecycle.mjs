// Optional trusted-owner lifecycle around the exact native portable restore.
// A private authenticated owner marker binds one invocation-created root, its
// device/inode and generation. Metadata or model text alone is not cleanup rights.
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {openSync,closeSync,fstatSync,readSync,writeFileSync,renameSync,readdirSync,lstatSync,readlinkSync,rmSync,constants} from 'node:fs';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {canonicalJson} from '../canonical-json.js';
import {restoreH08BundleV1} from './portable-runtime.mjs';
import {readActiveProjectionGeneration} from '../projection-generation.mjs';
const SCHEMA='kaleidosphere/owned-portable-lifecycle/v1',MARKER='portable-lifecycle.json';
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
function directory(path){if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path||/[\x00-\x1f\x7f]/.test(path))fail('H08_LIFECYCLE_PATH_DENIED');let fd=openSync('/',constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{for(const part of path.split('/').filter(Boolean)){const next=openSync('/proc/self/fd/'+fd+'/'+part,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);closeSync(fd);fd=next;}return fd;}catch{closeSync(fd);fail('H08_LIFECYCLE_PATH_DENIED');}}
function bytes(path,maximum=32*1024*1024){let parent,fd;try{parent=directory(dirname(path));fd=openSync('/proc/self/fd/'+parent+'/'+path.split('/').at(-1),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);const stat=fstatSync(fd);
 if(!stat.isFile()||stat.nlink!==1||stat.uid!==process.getuid()||stat.size>maximum)fail('H08_LIFECYCLE_FILE_DENIED');const data=Buffer.alloc(stat.size+1);let n=0;while(n<data.length){const count=readSync(fd,data,n,data.length-n,null);if(!count)break;n+=count;}if(n!==stat.size)fail('H08_LIFECYCLE_FILE_DRIFT');return data.subarray(0,n);
 }finally{if(fd!==undefined)closeSync(fd);if(parent!==undefined)closeSync(parent);}}
function key(candidate){if(!Buffer.isBuffer(candidate)||candidate.length!==32)fail('H08_LIFECYCLE_KEY_REQUIRED');return Buffer.from(candidate);}
const authenticator=(key,body)=>createHmac('sha256',key).update(SCHEMA+'\0'+canonicalJson(body)).digest('hex');
function owner(fd,root){const st=fstatSync(fd);if(st.uid!==process.getuid()||(st.mode&0o077)!==0)fail('H08_LIFECYCLE_OWNER_REQUIRED');return{root,device:st.dev,inode:st.ino,uid:st.uid};}
function exactTree(root,relative,expected){const path=join(root,relative),st=lstatSync(path);if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid())fail('H08_FOREIGN_RESOURCE_DENIED');
 const actual=readdirSync(path).sort();if(canonicalJson(actual)!==canonicalJson([...expected].sort()))fail('H08_FOREIGN_RESOURCE_DENIED');}
function qualifiedTree(body){const root=body.owner.root,g=body.restore.generationId;exactTree(root,'',['receipts','projection','portable-state.json',MARKER]);
 exactTree(root,'receipts',['.ks254-generations','.ks254-staging']);exactTree(root,'receipts/.ks254-staging',[]);exactTree(root,'receipts/.ks254-generations',['generations','active']);exactTree(root,'receipts/.ks254-generations/generations',[g]);exactTree(root,'receipts/.ks254-generations/generations/'+g,['analytics.db','receipt.json','generation.manifest.json']);exactTree(root,'projection',['analytics.db']);
 if(readlinkSync(join(root,'receipts/.ks254-generations/active'))!=='generations/'+g)fail('H08_FOREIGN_RESOURCE_DENIED');
 const active=readActiveProjectionGeneration({receiptDir:body.restore.receiptDir});if(!active.ok||active.generationId!==g||hash(bytes(body.restore.projectionDb))!==active.receipt.projection.sha256)fail('H08_LIFECYCLE_GENERATION_DRIFT');
 for(const relative of ['portable-state.json',MARKER,'projection/analytics.db','receipts/.ks254-generations/generations/'+g+'/analytics.db','receipts/.ks254-generations/generations/'+g+'/receipt.json','receipts/.ks254-generations/generations/'+g+'/generation.manifest.json'])bytes(join(root,relative));
}
function hold(options,initial=null){if(options.optIn!==true)fail('H08_LIFECYCLE_OPT_IN_REQUIRED');const secret=key(options.key),fd=directory(options.targetRoot);let closed=false;
 try{const identity=owner(fd,options.targetRoot);let body=initial;
 const write=next=>{const envelope={body:next,authenticator:authenticator(secret,next)},temporary='.'+MARKER+'.'+randomBytes(8).toString('hex')+'.pending',base='/proc/self/fd/'+fd;let file;
 try{file=openSync(base+'/'+temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW|constants.O_NONBLOCK,0o600);writeFileSync(file,canonicalJson(envelope)+'\n');}finally{if(file!==undefined)closeSync(file);}renameSync(base+'/'+temporary,base+'/'+MARKER);body=next;};
 const read=()=>{if(closed)fail('H08_LIFECYCLE_CLOSED');const current=directory(identity.root);try{if(canonicalJson(owner(current,identity.root))!==canonicalJson(identity)||canonicalJson(owner(fd,identity.root))!==canonicalJson(identity))fail('H08_LIFECYCLE_IDENTITY_DRIFT');}finally{closeSync(current);}
 const envelope=JSON.parse(bytes(join(identity.root,MARKER),32768));if(typeof envelope.authenticator!=='string'||! /^[0-9a-f]{64}$/.test(envelope.authenticator)||!timingSafeEqual(Buffer.from(envelope.authenticator,'hex'),Buffer.from(authenticator(secret,envelope.body),'hex')))fail('H08_LIFECYCLE_AUTHENTICATION_DENIED');
 body=envelope.body;if(body.schemaVersion!==SCHEMA||canonicalJson(body.owner)!==canonicalJson(identity)||body.restore.generationId!==options.expectedGeneration||body.bundlePath!==options.bundlePath||body.restore.receiptDir!==join(identity.root,'receipts')||body.restore.projectionDb!==join(identity.root,'projection','analytics.db')||body.restore.runtime.version!==process.versions.node||!['RESTORED_LOCAL','TOMBSTONED','SCOPED_DATA_REMOVED'].includes(body.state))fail('H08_LIFECYCLE_BINDING_DENIED');
 if(hash(bytes(body.bundlePath))!==body.restore.bundleSha256)fail('H08_RETAINED_BACKUP_DRIFT');return body;};
 if(body){body={schemaVersion:SCHEMA,owner:identity,state:'RESTORED_LOCAL',bundlePath:options.bundlePath,restore:body,runtimeReadyClaimed:false,restoredDataRemoved:false,declaredBackupRetained:true,externalBackupErasure:'UNKNOWN'};write(body);}else read();
 const inspect=()=>{const held=read();return{...held.restore,state:held.state,restoredDataRemoved:held.restoredDataRemoved,declaredBackupRetained:true,externalBackupErasure:'UNKNOWN',runtimeReadyClaimed:false};};
 const generation=value=>{const held=read();if(value!==held.restore.generationId)fail('H08_LIFECYCLE_GENERATION_DENIED');return held;};
 return Object.freeze({inspect,tombstone(expectedGeneration){const held=generation(expectedGeneration);if(held.state==='SCOPED_DATA_REMOVED')return inspect();qualifiedTree(held);write({...held,state:'TOMBSTONED',restoredDataRemoved:false});return inspect();},
 cleanup(expectedGeneration){const held=generation(expectedGeneration);if(held.state==='SCOPED_DATA_REMOVED')return inspect();if(held.state!=='TOMBSTONED')fail('H08_TOMBSTONE_REQUIRED');qualifiedTree(held);
 // Fixed, byte-qualified owned restored paths only. The source and retained
 // bundle sit outside this authenticated root and are never cleanup targets.
 rmSync('/proc/self/fd/'+fd+'/receipts',{recursive:true});rmSync('/proc/self/fd/'+fd+'/projection',{recursive:true});write({...held,state:'SCOPED_DATA_REMOVED',restoredDataRemoved:true});return inspect();},
 close(){if(!closed){closed=true;secret.fill(0);closeSync(fd);}}});
 }catch(error){secret.fill(0);closeSync(fd);throw error;}}
export function createH08PortableLifecycleV1(options){if(options.optIn!==true)fail('H08_LIFECYCLE_OPT_IN_REQUIRED');const restored=restoreH08BundleV1(options);if(restored.state!=='RESTORED_LOCAL')fail('H08_LIFECYCLE_RESTORE_DENIED');return hold(options,restored);}
export function openH08PortableLifecycleV1(options){return hold(options);}
