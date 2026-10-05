import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

export const RELATIONAL_CORE_PROFILE_SCHEMA='kaleidosphere.db/relational-core-profile/v1';
const workerFile=fileURLToPath(new URL('./sqlalchemy-core-worker.py',import.meta.url));
const fail=(code,lifecycle)=>{const error=new Error(code);error.code=code;error.partialSuccess=false;if(lifecycle)error.lifecycle=lifecycle;throw error;};
const object=(value)=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;
const keys=(value,allowed)=>object(value)&&Object.keys(value).length===allowed.length&&Object.keys(value).every(k=>allowed.includes(k));
const identifier=(v)=>typeof v==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(v);
export function validateRelationalCoreProfile(p){
 if(!keys(p,['schemaVersion','profileId','engine','mode','scope','policy','adapter','approval'])||p.schemaVersion!==RELATIONAL_CORE_PROFILE_SCHEMA||typeof p.profileId!=='string'||!identifier(p.profileId.replaceAll('-','_'))||p.engine!=='mariadb'||p.mode!=='RUNTIME')fail('K06_PROFILE_DENIED');
 if(!keys(p.scope,['database','tables'])||!identifier(p.scope.database)||!Array.isArray(p.scope.tables)||p.scope.tables.length<1||p.scope.tables.length>8||p.scope.tables.some(t=>!identifier(t))||new Set(p.scope.tables).size!==p.scope.tables.length)fail('K06_SCOPE_DENIED');
 if(!keys(p.policy,['access','allowRowSamples','maxQueryTimeoutMs','maxMetadataRows'])||p.policy.access!=='READ_ONLY'||p.policy.allowRowSamples!==false||!Number.isInteger(p.policy.maxQueryTimeoutMs)||p.policy.maxQueryTimeoutMs<100||p.policy.maxQueryTimeoutMs>10000||!Number.isInteger(p.policy.maxMetadataRows)||p.policy.maxMetadataRows<1||p.policy.maxMetadataRows>256)fail('K06_POLICY_DENIED');
 if(!keys(p.adapter,['kind','host','port','user','passwordEnv','ssl'])||p.adapter.kind!=='sqlalchemy-core'||typeof p.adapter.host!=='string'||!/^[A-Za-z0-9][A-Za-z0-9.\-]{0,252}$/.test(p.adapter.host)||!Number.isInteger(p.adapter.port)||p.adapter.port<1||p.adapter.port>65535||!identifier(p.adapter.user)||p.adapter.passwordEnv!=='CM_MARIADB_PASSWORD'||typeof p.adapter.ssl!=='boolean')fail('K06_ADAPTER_DENIED');
 if(!keys(p.approval,['state','schemaSha256'])||!['PREVIEW_ONLY','APPROVED_SCOPE'].includes(p.approval.state)||(p.approval.state==='PREVIEW_ONLY'?p.approval.schemaSha256!==null:typeof p.approval.schemaSha256!=='string'||!/^([0-9a-f]{64})$/.test(p.approval.schemaSha256)))fail('K06_APPROVAL_DENIED');
 return p;
}
export async function runRelationalCoreProfile(input,{signal}={}){
 const profile=validateRelationalCoreProfile(input);
 if(signal!==undefined&&(typeof signal?.aborted!=='boolean'||typeof signal?.addEventListener!=='function'||typeof signal?.removeEventListener!=='function'))fail('K06_CANCELLATION_INVALID');
 if(signal?.aborted)fail('K06_CANCELLED');
 const python=process.env.KS288_RELATIONAL_PYTHON;
 if(process.platform!=='linux'||process.arch!=='x64'||typeof python!=='string'||!path.isAbsolute(python))fail('K06_PYTHON_RUNTIME_DENIED');
 const secret=process.env[profile.adapter.passwordEnv];
 if(typeof secret!=='string'||secret.length<8||secret.length>1024)fail('K06_CREDENTIAL_MISSING');
 return await new Promise((resolve,reject)=>{
  const child=spawn(python,['-I','-B',workerFile],{stdio:['pipe','pipe','pipe'],env:{PATH:process.env.PATH??'',LANG:'C.UTF-8',CM_MARIADB_PASSWORD:secret}});
  let stdout='',stderrBytes=0,reason=null,settled=false;
  const abort=()=>{reason='K06_CANCELLED';child.kill('SIGTERM');};
  const timer=setTimeout(()=>{reason='K06_WORKER_TIMEOUT';child.kill('SIGKILL');},profile.policy.maxQueryTimeoutMs+10000);
  const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(result);};
  child.on('error',()=>{try{fail('K06_PYTHON_RUNTIME_DENIED');}catch(e){finish(e);}});
  child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{stdout+=chunk.toString('utf8');if(Buffer.byteLength(stdout)>262144){reason='K06_OUTPUT_DENIED';child.kill('SIGKILL');}});
  child.stderr.on('data',chunk=>{stderrBytes+=chunk.length;if(stderrBytes>65536){reason='K06_OUTPUT_DENIED';child.kill('SIGKILL');}});
  child.on('close',code=>{
   try{
    if(reason&&reason!=='K06_CANCELLED')fail(reason);
    if(stdout.includes(secret))fail('K06_SECRET_DISCLOSURE_DENIED');
    let packet;try{packet=JSON.parse(stdout);}catch{fail(reason==='K06_CANCELLED'?'K06_CANCELLED_UNVERIFIED_CLEANUP':'K06_WORKER_PROTOCOL_DENIED');}
    if(reason==='K06_CANCELLED'){
     if(code!==0&&packet.ok===false&&packet.reasonCode==='K06_CANCELLED'&&packet.lifecycle?.checkedOutAfter===0&&packet.lifecycle.poolDisposed===true&&packet.lifecycle.cancelControlClosed===true&&stderrBytes===0)fail('K06_CANCELLED',packet.lifecycle);
     fail('K06_CANCELLED_UNVERIFIED_CLEANUP');
    }
    if(stderrBytes!==0)fail('K06_WORKER_PROTOCOL_DENIED');
    if(code!==0||packet.ok!==true){if(!/^K06_[A-Z0-9_]+$/.test(packet.reasonCode))fail('K06_WORKER_PROTOCOL_DENIED');fail(packet.reasonCode,packet.lifecycle);}
    if(packet.result?.schemaVersion!=='kaleidosphere.db/relational-core-evidence/v1'||packet.result.engine!=='mariadb'||packet.result.lifecycle?.checkedOutAfter!==0||packet.result.lifecycle.poolDisposed!==true)fail('K06_WORKER_PROTOCOL_DENIED');
    finish(null,packet.result);
   }catch(error){finish(error);}
  });
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  child.stdin.end(JSON.stringify({profile}));
 });
}
