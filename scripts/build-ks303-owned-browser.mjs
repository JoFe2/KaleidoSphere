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
const pan=resolve(panArg),root=resolve(import.meta.dirname,'..'),base='contracts/dependencies/pan549-stock-workspace-v1',source='services/bi-control/src/assistant-foundation/pan549-k05-read-companion-v1.mjs';
const dest=base+'/owned-browser/read-companion-'+version+'.js',manifestPath=base+'/workspace-byte-closure-'+version+'.json';assert.ok(!existsSync(join(root,dest))&&!existsSync(join(root,manifestPath)),'KS303_NEW_BUILD_VERSION_REQUIRED');
const sha=b=>createHash('sha256').update(b).digest('hex');
const compiler=join(root,'dependencies/ks303-owned-browser-build');
const audit=JSON.parse(readFileSync(join(compiler,'compiler-integrity-v1.json')));
for(const [path,key]of [['package.json','packageSHA256'],['package-lock.json','packageLockSHA256'],['THIRD-PARTY-LICENSES.txt','noticeSHA256']])assert.equal(sha(readFileSync(join(compiler,path))),audit[key]);
assert.equal(audit.packages['node_modules/terser'].version,'5.51.2');
for(const [path,pkg]of Object.entries(audit.packages))for(const [name,pin]of Object.entries(pkg.installedBytePins)){const raw=readFileSync(join(compiler,path,name));assert.equal(raw.length,pin.bytes);assert.equal(sha(raw),pin.sha256,'KS303_COMPILER_BYTES_DENIED');}
assert.equal(JSON.parse(readFileSync(join(compiler,'node_modules/terser/package.json'))).version,'5.51.2');
const {minify}=await import(pathToFileURL(join(compiler,'node_modules/terser/main.js')).href);
const built=spawnSync(join(pan,'node_modules/.bin/esbuild'),[join(root,source),'--bundle','--minify','--format=esm','--platform=browser','--target=es2022'],{cwd:root,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});assert.equal(built.status,0,built.stderr);
const result=await minify(built.stdout,{ecma:2022,module:true,compress:{passes:3,unsafe:false},mangle:true,format:{comments:false}});assert.ok(result.code);
const own=Buffer.from(result.code+'\n'),original=readFileSync(join(pan,'dist/browser-workspace/app.js'));
const current=JSON.parse(readFileSync(join(root,base+'/workspace-byte-closure-v28.json')));
assert.equal(sha(original),current.existingPANBundleSHA256);const bytes=original.length+3+own.length;assert.ok(bytes<=131072,'KS303_PUBLIC_BYTE_BOUND_EXCEEDED: '+bytes);
writeFileSync(join(root,dest),own,{flag:'wx'});current.ownedKSAdditionPins={};
for(const path of [source,dest,base+'/ui-attribution-v1.json','services/bi-control/src/assistant-foundation/pan549-k05-read-companion-v1.css',...['package.json','package-lock.json','THIRD-PARTY-LICENSES.txt','compiler-integrity-v1.json'].map(p=>'dependencies/ks303-owned-browser-build/'+p)]){const raw=readFileSync(join(root,path));current.ownedKSAdditionPins[path]={sha256:sha(raw),bytes:raw.length};}
current.ownedKSBrowserScriptPath=dest;current.currentComposedScriptBytes=bytes;
current.ownedBuildClosure={esbuildFromExactLockedPAN:true,terserVersion:'5.51.2',ownOnlyMinified:true,propertyMangling:false,unsafeOptimizations:false,packageLockSHA256:sha(readFileSync(join(compiler,'package-lock.json')))};
writeFileSync(join(root,manifestPath),JSON.stringify(current,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({actualComposedBytes:bytes,ownBytes:own.length,publishedByteBound:131072,originalPANBundleUnchanged:true,ownBundleSHA256:sha(own),sourceSHA256:sha(readFileSync(join(root,source))),manifestPath}));
