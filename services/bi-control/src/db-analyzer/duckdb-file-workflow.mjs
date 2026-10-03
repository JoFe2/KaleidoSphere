// Additive bounded file executor; existing native database paths and C2 operations are unchanged.
import { readFileSync, writeFileSync, lstatSync, realpathSync, readdirSync, rmSync, mkdtempSync, openSync, fstatSync, readSync, closeSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };
export function verifyDuckdbRuntime(root, runtimeRoot) {
  const lock = JSON.parse(readFileSync(join(root,'contracts/file-profile/duckdb-runtime-lock-v1.json')));
  const modules = join(runtimeRoot,'node_modules');
  const actual=[];
  function visit(base,prefix='') {
    for (const name of readdirSync(base).sort()) {
      const p=join(base,name),n=prefix+name,s=lstatSync(p);
      if (s.isSymbolicLink() || (!s.isFile()&&!s.isDirectory())) fail('K02_RUNTIME_IDENTITY_DENIED');
      if (s.isDirectory()) visit(p,n+'/');
      else if (n!=='.package-lock.json') actual.push(n);
    }
  }
  visit(modules);
  if (JSON.stringify(actual.sort())!==JSON.stringify(Object.keys(lock.files).sort())) fail('K02_RUNTIME_IDENTITY_DENIED');
  for (const [n,e] of Object.entries(lock.files)) {
    const p=join(modules,n),s=lstatSync(p);
    if (s.size!==e.size || Boolean(s.mode&0o111)!==e.executable || sha(readFileSync(p))!==e.sha256) fail('K02_RUNTIME_IDENTITY_DENIED');
  }
  return { modules:realpathSync(modules),lock };
}
export function runDuckdbFileProfile({ root, runtimeRoot, source, question, exportPath, mode='FULL_READ_ONLY' }) {
  const approved = {
    'examples/file-profile/approved.csv': {format:'csv',sha256:'2cf6c414b87860a6a3116f10d2f881cd2c2da1c68e9690efeda15b29aea88695'},
    'examples/file-profile/approved.parquet': {format:'parquet',sha256:'1bd5441401458bb564205829a7c1dc64cf3e0e714b410ac864bd476fdd9e1f26'},
  };
  if (!Object.hasOwn(approved,source) || question!=='sum-units-by-category') fail('K02_SCOPE_DENIED');
  if (!['METADATA_ONLY','SCHEMA_INFERENCE','FULL_READ_ONLY'].includes(mode)) fail('K02_RIGHTS_DENIED');
  const grant = approved[source];
  const input=join(root,source),stat=lstatSync(input);
  if (!stat.isFile() || realpathSync(input)!==resolve(input) || stat.size>1048576) fail('K02_FILE_DENIED');
  if (mode==='METADATA_ONLY') return {
    outcome:'METADATA_ONLY', operation:'FILE_METADATA_INSPECT', dataReadPerformed:false,
    source:{id:'synthetic.file-profile.'+grant.format+'/v1',size:stat.size,declaredSha256:grant.sha256,contentHashVerified:false},
    schema:{coverage:'DECLARED_NOT_INFERRED',inferenceReadsValues:false,declaredColumns:[{name:'category',type:'VARCHAR'},{name:'units',type:'BIGINT'}]},
    rightsUsed:['FILE_METADATA_STAT'],rightsRequiredForAnalysis:['SCHEMA_INFERENCE_READS_VALUES','READ_VALUES','READ_ONLY_QUERY','RESULT_EXPORT'],
    provenance:{observedMtimeMs:stat.mtimeMs},table:null,export:null,mutationPerformed:false,mutationScope:'SOURCE_DATA_ONLY',artifactWritesPerformed:false,
  };
  let bytes,fd;
  try {
    fd=openSync(input,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const opened=fstatSync(fd);
    if(!opened.isFile()||opened.dev!==stat.dev||opened.ino!==stat.ino||opened.size!==stat.size||opened.size>1048576) fail('K02_FILE_DENIED');
    const buffer=Buffer.alloc(1048577);let length=0,n;
    while(length<buffer.length&&(n=readSync(fd,buffer,length,buffer.length-length,null))>0)length+=n;
    if(length!==opened.size||length>1048576)fail('K02_FILE_DENIED');
    bytes=buffer.subarray(0,length);
  } catch {fail('K02_FILE_DENIED');} finally {if(fd!==undefined)closeSync(fd);}
  if (sha(bytes)!==grant.sha256) fail('K02_SOURCE_IDENTITY_DRIFT');
  const {modules}=verifyDuckdbRuntime(root,runtimeRoot);
  const scratch=mkdtempSync(join(tmpdir(),'ks284-executor-'));
  try {
    const snapshot=join(scratch,'source.'+grant.format);writeFileSync(snapshot,bytes);
    const args=['--unshare-all','--die-with-parent','--new-session','--clearenv',
      '--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind','/lib64','/lib64',
      '--proc','/proc','--dev','/dev','--ro-bind',realpathSync(process.execPath),'/runtime/node',
      '--ro-bind',modules,'/runtime/node_modules','--ro-bind',realpathSync(join(root,'scripts/run-duckdb-file-worker.mjs')),'/app/worker.mjs',
      '--ro-bind',snapshot,'/input/source.'+grant.format,'--chdir','/app','--remount-ro','/',
      '/runtime/node','--max-old-space-size=64','/app/worker.mjs',grant.format,mode];
    const p=spawnSync('/usr/bin/bwrap',args,{encoding:'utf8',timeout:5000,killSignal:'SIGKILL',maxBuffer:65536,env:{}});
    if (p.error||p.signal) fail('K02_EXECUTOR_DENIED');
    if (p.status!==0) {
      let reason='K02_EXECUTOR_DENIED';
      try {const denial=JSON.parse(p.stdout);if(denial.outcome==='DENIED'&&['K02_SCHEMA_DENIED','K02_ROW_BUDGET_DENIED','K02_ENGINE_IDENTITY_DENIED'].includes(denial.reasonCode))reason=denial.reasonCode;} catch {}
      fail(reason);
    }
    const result=JSON.parse(p.stdout);
    if (mode==='SCHEMA_INFERENCE') {
      if (result.outcome!=='SCHEMA_INFERRED') fail('K02_EXECUTOR_DENIED');
      return {...result,dataReadPerformed:true,
        source:{id:'synthetic.file-profile.'+grant.format+'/v1',sha256:sha(bytes),size:bytes.length,contentHashVerified:true},
        provenance:{observedMtimeMs:stat.mtimeMs,engineRuntimeByteIdentityVerified:true},
        rightsUsed:['SCHEMA_INFERENCE_READS_VALUES'],table:null,export:null,artifactWritesPerformed:false};
    }
    if (result.outcome!=='ACCEPTED') fail('K02_EXECUTOR_DENIED');
    const csv='category,sum_units,null_units\n'+result.table.rows.map(row=>[row.category,row.sum_units,row.null_units].join(',')).join('\n')+'\n';
    writeFileSync(exportPath,csv,{flag:'wx',mode:0o600});
    return {...result,dataReadPerformed:true,source:{id:'synthetic.file-profile.'+grant.format+'/v1',sha256:sha(bytes),size:bytes.length,contentHashVerified:true},
      budget:{inputBytesMax:1048576,sourceRowsMax:10000,resultRowsMax:100,wallTimeMs:5000,stdoutBytesMax:65536,engineMemory:'64MB',engineThreads:1,nodeHeapMiB:64},
      provenance:{observedMtimeMs:stat.mtimeMs,freshness:'LOCAL_FILE_MTIME_NOT_UPSTREAM_FRESHNESS',engineRuntimeByteIdentityVerified:true},
      artifactWritesPerformed:true,export:{format:'CSV',sha256:sha(csv),bytes:Buffer.byteLength(csv)},
      isolation:'PRIVATE_MOUNT_PID_NETWORK_NAMESPACE',rightsUsed:['SCHEMA_INFERENCE_READS_VALUES','READ_VALUES','READ_ONLY_QUERY','RESULT_EXPORT']};
  } finally {rmSync(scratch,{recursive:true,force:true});}
}
