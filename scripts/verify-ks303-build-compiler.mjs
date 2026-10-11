// Real isolated compiler drift negatives and exact source rebuild. No PAN or
// active-checkout file is mutated; fixtures and cleanup are invocation-owned.
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,cpSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [panArg,output]=process.argv.slice(2),root=resolve(import.meta.dirname,'..');assert.ok(panArg&&output&&process.env.TMPDIR);assert.ok(!existsSync(output));
const pan=resolve(panArg),base='contracts/dependencies/pan549-stock-workspace-v1',compiler='dependencies/ks303-owned-browser-build',sha=b=>createHash('sha256').update(b).digest('hex');
const audit=JSON.parse(readFileSync(join(root,compiler,'compiler-integrity-v1.json'))),panAudit=JSON.parse(readFileSync(join(root,compiler,'pan-esbuild-integrity-v2.json'))),current=JSON.parse(readFileSync(join(root,base,'workspace-byte-closure-v39.json')));
const dir=mkdtempSync(join(process.env.TMPDIR,'ks303-real-compiler-negatives-')),owned=join(dir,'own'),foreign=join(dir,'exact-public-pan-copy'),records=[];
const copy=(from,to)=>{mkdirSync(dirname(to),{recursive:true});copyFileSync(from,to);};
try{
 mkdirSync(join(owned,base,'owned-browser'),{recursive:true});
 for(const n of ['scripts/build-ks303-owned-browser.mjs',...Object.keys(current.ownedKSAdditionPins)])copy(join(root,n),join(owned,n));
 for(const n of Object.keys(audit.packages))cpSync(join(root,compiler,n),join(owned,compiler,n),{recursive:true});
 for(const n of ['package.json','package-lock.json','dist/browser-workspace/app.js'])copy(join(pan,n),join(foreign,n));
 for(const n of Object.keys(panAudit.packages))cpSync(join(pan,n),join(foreign,n),{recursive:true});
 const exercise=(label,version)=>{const p=spawnSync(process.execPath,[join(owned,'scripts/build-ks303-owned-browser.mjs'),foreign,version],{cwd:owned,encoding:'utf8',timeout:60000,env:{...process.env,ESBUILD_BINARY_PATH:join(dir,'never-exists-untrusted-wrapper-override')}});records.push({label,actualExit:p.status,actualStdout:p.stdout,actualStderr:p.stderr});return p;};
 const positive=exercise('ACTUAL_EXACT_REBUILD_VERIFIED_NATIVE_EXECUTABLE_IGNORES_WRAPPER_OVERRIDE','v971');assert.equal(positive.status,0,positive.stderr);const actual=JSON.parse(positive.stdout);assert.equal(actual.actualComposedBytes,current.currentComposedScriptBytes);assert.ok(actual.actualComposedBytes<=131072);assert.equal(actual.publishedByteBound,131072);assert.equal(actual.ownBundleSHA256,current.ownedKSAdditionPins[current.ownedKSBrowserScriptPath].sha256);assert.equal(sha(readFileSync(join(foreign,'dist/browser-workspace/app.js'))),current.existingPANBundleSHA256);
 for(const [label,path,version,code]of [['ACTUAL_ESBUILD_NATIVE_BYTE_DRIFT_REFUSED_BEFORE_EXECUTION',join(foreign,panAudit.executablePath),'v972','KS303_PAN_COMPILER_BYTES_DENIED'],['ACTUAL_TERSER_INSTALLED_BYTE_DRIFT_REFUSED_BEFORE_IMPORT',join(owned,compiler,'node_modules/terser/lib/ast.js'),'v973','KS303_COMPILER_BYTES_DENIED']]){
  const before=readFileSync(path),changed=Buffer.from(before);changed[changed.length-1]^=1;writeFileSync(path,changed);
  try{const p=exercise(label,version);assert.notEqual(p.status,0);assert.ok(p.stderr.includes(code));assert.equal(existsSync(join(owned,base,'owned-browser/read-companion-'+version+'.js')),false);assert.equal(existsSync(join(owned,base,'workspace-byte-closure-'+version+'.json')),false);}finally{writeFileSync(path,before);}
 }
}finally{rmSync(dir,{recursive:true,force:true});}
assert.equal(existsSync(dir),false);assert.equal(records.length,3);
writeFileSync(output,JSON.stringify({atUtc:new Date().toISOString(),schemaVersion:'kaleidosphere/ks303-real-own-build-compiler-probe/v1',actualCases:records.length,records,originalPANAndActiveCheckoutUnmodified:true,actualOwnBundleByteExact:true,actualPublishedByteBoundUnchanged:131072,ownFixtureRemoved:true,newLifecycleScriptsGlobalConfigModelOrRights:false},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({actualCompilerProbePass:records.length,actualPositiveRebuild:JSON.parse(records[0].actualStdout),nativeExecutableOverrideIgnored:true,esbuildDriftDeniedBeforeExecution:true,terserDriftDeniedBeforeImport:true,ownFixtureRemoved:!existsSync(dir)}));
