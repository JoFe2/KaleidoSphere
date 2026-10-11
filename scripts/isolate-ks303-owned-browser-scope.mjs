// Isolate only the already qualified additive KS artifact. PAN bytes, current
// runtime authority, same asset/CSP and inner KS guards are untouched.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),base='contracts/dependencies/pan549-stock-workspace-v1',sha=b=>createHash('sha256').update(b).digest('hex');
const manifestPath=base+'/workspace-byte-closure-v238.json',closure=JSON.parse(readFileSync(resolve(root,manifestPath)));
const innerPath=base+'/owned-browser/read-companion-v39.js',inner=readFileSync(resolve(root,innerPath));
assert.equal(inner.length,5486);assert.equal(sha(inner),'5e63b2cf949e75da951ea6a93a0a180f930e0627f9dbd1e2aa84db2e5aa872f1');
assert.equal(closure.compositionDelimiter,'');assert.equal(closure.publishedScriptByteBound,131072);
const prefix=Buffer.from('(()=>{\n'),suffix=Buffer.from('})();\n'),wrapped=Buffer.concat([prefix,inner,suffix]),out=base+'/owned-browser/read-companion-v242.js';
const total=closure.PANBytePins[closure.existingAssetPaths.script].bytes+wrapped.length;assert.ok(total<=closure.publishedScriptByteBound,'KS303_ORIGINAL_COMPOSED_BOUND_DENIED');
if(existsSync(resolve(root,out)))assert.deepEqual(readFileSync(resolve(root,out)),wrapped);else writeFileSync(resolve(root,out),wrapped,{flag:'wx'});
closure.ownedKSBrowserScriptPath=out;closure.currentComposedScriptBytes=total;
closure.ownedKSAdditionPins[out]={sha256:sha(wrapped),bytes:wrapped.length};closure.ownedKSAdditionPins['scripts/isolate-ks303-owned-browser-scope.mjs']={sha256:sha(readFileSync(import.meta.filename)),bytes:readFileSync(import.meta.filename).length};
closure.ownedBuildClosure.ownLexicalScopeIsolation={kind:'STATIC_IMMEDIATE_ARROW_FUNCTION_SCOPE_ONLY',innerPath,innerSHA256:sha(inner),innerBytes:inner.length,wrapperBytes:prefix.length+suffix.length,innerBytesRetainedExactly:true,nativeSourcePrefixAndAssetContractUnchanged:true,noEvalInlineExtraAssetOrCSPChange:true};
writeFileSync(resolve(root,manifestPath),JSON.stringify(closure,null,2)+'\n');
console.log(JSON.stringify({ownWrappedBytes:wrapped.length,wrapperBytes:prefix.length+suffix.length,actualTotal:total,originalBound:closure.publishedScriptByteBound,reserve:closure.publishedScriptByteBound-total,unchangedInnerKSBytes:inner.length,nativePrefixUnchanged:true,innerSHA256:sha(inner),wrappedSHA256:sha(wrapped)}));
