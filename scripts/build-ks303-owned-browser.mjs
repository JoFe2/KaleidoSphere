// Minify only the code-owned KS addition. The original PAN app is never passed
// to either compiler. Locked esbuild is consumed from the qualified PAN input;
// the separate Terser dependency closure is committed and version-pinned.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const [panArg,version]=process.argv.slice(2);assert.ok(panArg&&/^v\d+$/.test(version??''),'KS303_OWN_BUILD_INPUT_REQUIRED');
const pan=resolve(panArg),root=resolve(import.meta.dirname,'..'),base='contracts/dependencies/pan549-stock-workspace-v1',source='services/bi-control/src/assistant-foundation/pan549-k05-read-companion-v2.entry.mjs';
const dest=base+'/owned-browser/read-companion-'+version+'.js',manifestPath=base+'/workspace-byte-closure-'+version+'.json';assert.ok(!existsSync(join(root,dest))&&!existsSync(join(root,manifestPath)),'KS303_NEW_BUILD_VERSION_REQUIRED');
const sha=b=>createHash('sha256').update(b).digest('hex');
const compiler=join(root,'dependencies/ks303-owned-browser-build');
const audit=JSON.parse(readFileSync(join(compiler,'compiler-integrity-v1.json')));
for(const [path,key]of [['package.json','packageSHA256'],['package-lock.json','packageLockSHA256'],['THIRD-PARTY-LICENSES.txt','noticeSHA256']])assert.equal(sha(readFileSync(join(compiler,path))),audit[key]);
assert.equal(audit.packages['node_modules/terser'].version,'5.51.2');
for(const [path,pkg]of Object.entries(audit.packages))for(const [name,pin]of Object.entries(pkg.installedBytePins)){const raw=readFileSync(join(compiler,path,name));assert.equal(raw.length,pin.bytes);assert.equal(sha(raw),pin.sha256,'KS303_COMPILER_BYTES_DENIED');}
assert.equal(JSON.parse(readFileSync(join(compiler,'node_modules/terser/package.json'))).version,'5.51.2');
const current=JSON.parse(readFileSync(join(root,base+'/released-workspace-input-byte-closure-v1.json')));
const panAudit=JSON.parse(readFileSync(join(compiler,'pan-esbuild-integrity-v2.json')));
assert.equal(process.platform,panAudit.hostPlatform);assert.equal(process.arch,panAudit.hostArch);
assert.equal(panAudit.PANCommit,current.PANCommit);assert.equal(panAudit.PANTree,current.PANTree);
for(const [name,key]of [['package.json','packageSHA256'],['package-lock.json','packageLockSHA256']]){const digest=sha(readFileSync(join(pan,name)));assert.equal(digest,current.PANBytePins[name].sha256);assert.equal(digest,panAudit[key]);}
assert.equal(sha(readFileSync(join(compiler,'ESBUILD-THIRD-PARTY-LICENSES.txt'))),panAudit.noticeSHA256);
const panLock=JSON.parse(readFileSync(join(pan,'package-lock.json')));
for(const [path,pkg]of Object.entries(panAudit.packages)){
 for(const key of ['version','resolved','integrity'])assert.equal(pkg[key],panLock.packages[path][key]);
 for(const [name,pin]of Object.entries(pkg.installedBytePins)){const raw=readFileSync(join(pan,path,name));assert.equal(raw.length,pin.bytes);assert.equal(sha(raw),pin.sha256,'KS303_PAN_COMPILER_BYTES_DENIED');}
}
assert.equal(panAudit.executablePath,'node_modules/@esbuild/linux-x64/bin/esbuild');assert.ok(panAudit.packages['node_modules/@esbuild/linux-x64'].installedBytePins['bin/esbuild']);
const {minify}=await import(pathToFileURL(join(compiler,'node_modules/terser/main.js')).href);
// Invoke the verified native binary itself: no .bin link or ESBUILD_BINARY_PATH wrapper override.
const built=spawnSync(join(pan,panAudit.executablePath),[join(root,source),'--bundle','--minify','--format=esm','--platform=browser','--target=es2022'],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});assert.equal(built.status,0,built.stderr);
const result=await minify(built.stdout,{ecma:2022,module:true,compress:{passes:10,unsafe:false},mangle:true,format:{comments:false}});assert.ok(result.code);
const own=Buffer.from(result.code+'\n'),original=readFileSync(join(pan,'dist/browser-workspace/app.js'));
assert.equal(sha(original),current.existingPANBundleSHA256);assert.equal(current.compositionDelimiter,'');assert.equal(original.at(-1),10,'KS303_ORIGINAL_TERMINATING_NEWLINE_REQUIRED');const bytes=original.length+own.length;assert.ok(bytes<=131072,'KS303_PUBLIC_BYTE_BOUND_EXCEEDED: '+bytes);
writeFileSync(join(root,dest),own,{flag:'wx'});current.ownedKSAdditionPins={};
for(const path of [source,source.replace('.entry.mjs','.mjs'),dest,current.ownedKSTemplatePath,current.ownedKSAttributionPath,current.sourceBindingPath,base+'/released-workspace-input-byte-closure-v1.json',...['workspace-analysis-v1.js','workspace-analysis-v1.ts','canonical-json.js','canonical-json.ts','package.json'].map(n=>base+'/released-runtime-v2/'+n),'services/bi-control/src/assistant-foundation/pan549-k05-read-companion-v1.css',...['package.json','package-lock.json','THIRD-PARTY-LICENSES.txt','compiler-integrity-v1.json','pan-esbuild-integrity-v2.json','ESBUILD-THIRD-PARTY-LICENSES.txt'].map(p=>'dependencies/ks303-owned-browser-build/'+p)]){const raw=readFileSync(join(root,path));current.ownedKSAdditionPins[path]={sha256:sha(raw),bytes:raw.length};}
current.ownedKSBrowserScriptPath=dest;current.currentComposedScriptBytes=bytes;
current.ownedBuildClosure={esbuildFromExactLockedPAN:true,esbuildCompilerIntegritySHA256:sha(readFileSync(join(compiler,'pan-esbuild-integrity-v2.json'))),esbuildActualExecutableSHA256:panAudit.packages['node_modules/@esbuild/linux-x64'].installedBytePins['bin/esbuild'].sha256,esbuildVerifiedBeforeExecution:true,esbuildWrapperOrEnvironmentOverrideUsed:false,terserVersion:'5.51.2',terserCompressionPasses:10,ownOnlyMinified:true,propertyMangling:false,unsafeOptimizations:false,packageLockSHA256:sha(readFileSync(join(compiler,'package-lock.json'))),inertOwnedTemplateAndJSONInOriginalProtectedDocument:true,additionalScriptAssetInlineExecutionEvalBlobCSPOrAuthRelaxation:false,compositionDelimiterBytes:0};
writeFileSync(join(root,manifestPath),JSON.stringify(current,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({actualComposedBytes:bytes,ownBytes:own.length,publishedByteBound:131072,originalPANBundleUnchanged:true,ownBundleSHA256:sha(own),sourceSHA256:sha(readFileSync(join(root,source))),manifestPath}));
