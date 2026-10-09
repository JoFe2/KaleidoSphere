// Invocation-owned composition of the existing protected PAN shell and one
// unchanged KS K05 reader. An unkeyed hash is never runtime authority.
import {createHash} from 'node:crypto';
import {types} from 'node:util';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import closureJSON from '../../../../contracts/dependencies/pan549-stock-workspace-v1/workspace-byte-closure-v39.json' with {type:'json'};
import {createPan549K05StockReadPairV1} from './pan549-k05-stock-read-pair-v1.mjs';
const loaded=new WeakMap(),KSROOT=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
const closure=freeze(structuredClone(closureJSON));
const exact=(v,keys)=>{if(!v||typeof v!=='object'||types.isProxy(v)||Object.getPrototypeOf(v)!==Object.prototype)throw new Error('KS303_WORKSPACE_OPTIONS_DENIED');const descriptors=Object.getOwnPropertyDescriptors(v);if(Reflect.ownKeys(descriptors).length!==keys.length||Reflect.ownKeys(descriptors).some(k=>typeof k!=='string'||!keys.includes(k))||Object.values(descriptors).some(d=>!d.enumerable||!('value'in d)))throw new Error('KS303_WORKSPACE_OPTIONS_DENIED');};
function pinnedBytes(root,path,pin){
 if(!path||path.startsWith('/')||path.split('/').some(v=>!v||v==='.'||v==='..'))throw new Error('KS303_SOURCE_PATH_DENIED');
 let cursor=root;for(const part of path.split('/')){cursor=join(cursor,part);if(lstatSync(cursor).isSymbolicLink())throw new Error('KS303_SOURCE_LINK_DENIED');}
 if(!lstatSync(cursor).isFile())throw new Error('KS303_SOURCE_TYPE_DENIED');const raw=readFileSync(cursor);if(raw.length!==pin.bytes||sha(raw)!==pin.sha256)throw new Error('KS303_EXACT_SOURCE_BYTES_DENIED');return raw;
}
function sourceEntry(source){const entry=loaded.get(source);if(!entry)throw new Error('KS303_WORKSPACE_SOURCE_HANDLE_DENIED');entry.assertCurrent();return entry;}
export async function loadPan549ExistingWorkspaceInputV1(options){
 exact(options,['sourceRoot']);const {sourceRoot}=options;if(typeof sourceRoot!=='string'||!isAbsolute(sourceRoot)||resolve(sourceRoot)!==sourceRoot||realpathSync(sourceRoot)!==sourceRoot||!lstatSync(sourceRoot).isDirectory())throw new Error('KS303_EXACT_SOURCE_ROOT_DENIED');
 const git=args=>execFileSync('git',['-c','core.fsmonitor=false','-c','core.hooksPath=/dev/null','-C',sourceRoot,...args],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH,LANG:'C.UTF-8',LC_ALL:'C.UTF-8',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0'}}).trim();
 const assertCurrent=()=>{
  if(git(['rev-parse','HEAD'])!==closure.PANCommit||git(['rev-parse','HEAD^{tree}'])!==closure.PANTree||git(['status','--porcelain=v1','--untracked-files=no'])!=='')throw new Error('KS303_IMMUTABLE_CANDIDATE_SOURCE_DENIED');
  for(const [path,pin]of Object.entries(closure.PANBytePins))pinnedBytes(sourceRoot,path,pin);
  for(const [path,pin]of Object.entries(closure.ownedKSAdditionPins))pinnedBytes(KSROOT,path,pin);
 };
 assertCurrent();const modules={};for(const path of closure.existingNativeEntryPoints)modules[path]=await import(pathToFileURL(join(sourceRoot,path)).href);assertCurrent();
 const asset=key=>pinnedBytes(sourceRoot,closure.existingAssetPaths[key],closure.PANBytePins[closure.existingAssetPaths[key]]).toString('utf8');
 const token=Object.freeze({schemaVersion:'kaleidosphere/ks303-existing-workspace-input-handle/v1',portableAuthority:false});
 loaded.set(token,{assertCurrent,modules,assets:freeze({html:asset('html'),script:asset('script'),style:asset('style'),analysisStyle:asset('analysisStyle')}),binding:freeze({PANCommit:closure.PANCommit,PANTree:closure.PANTree,existingPANBundleSHA256:closure.existingPANBundleSHA256,ownedKSAdditionPins:closure.ownedKSAdditionPins})});return token;
}
export function mountExistingPan549K05WorkspaceV1(options){
 const keys=['source','ksSource','nativeRoot','gateway','tenantId','origin'];if(options&&!types.isProxy(options)&&Object.hasOwn(options,'ownerDiagnosticPlugins'))keys.push('ownerDiagnosticPlugins');exact(options,keys);const {source,ksSource,nativeRoot,gateway,tenantId,origin}=options;
 if(Object.hasOwn(options,'ownerDiagnosticPlugins')&&typeof options.ownerDiagnosticPlugins!=='boolean')throw new Error('KS303_CODE_OWNER_DIAGNOSTIC_PROFILE_DENIED');
 const entry=sourceEntry(source),m=entry.modules;
 const ingress=m['src/pan527/origin-session-adapter.mjs'];
 const sessions=gateway.sessionAdapter(tenantId);
 const owner=ingress.protectedGuidedOwnerContextV1(gateway,{optIn:true,tenantId,origin,identityDigest:sessions.binding.identityDigest});
 let pair,profiles,documentMount,analysisMount,closed=false;
 const cleanup=()=>{try{analysisMount?.close();}finally{try{documentMount?.close();}finally{try{pair?.close();}finally{profiles?.close();}}}};
 try{
 const nativeAnalysis=m['src/pan549/native-analysis-read.mjs'].createNativeAnalysisReadAdapterV1({optIn:true,root:nativeRoot,sessions});
 const nativeErv=m['src/pan541/native-erv-read-adapter.mjs'].createNativeErvReadAdapterV1({tenantId,root:nativeRoot});
 pair=createPan549K05StockReadPairV1({ksSource,nativeRoot,sessions,nativeReader:nativeAnalysis,isNativeReader:m['src/pan549/native-analysis-read.mjs'].isNativeAnalysisReadAdapterV1});
 const defaults=m['dist/packages/contracts/src/browser-profile-v1.js'].defaultBrowserProfileV1;
 profiles=m['src/pan543/profile-store.mjs'].createBrowserProfileStoreV1({root:owner.productRoot,catalog:()=>defaults().items.map(i=>({id:i.id,version:i.version,state:'AVAILABLE'}))});
 const addonPath=closure.ownedKSBrowserScriptPath,stylePath=closure.ownedKSBrowserStylePath;
 const addon=pinnedBytes(KSROOT,addonPath,closure.ownedKSAdditionPins[addonPath]).toString('utf8'),addonStyle=pinnedBytes(KSROOT,stylePath,closure.ownedKSAdditionPins[stylePath]).toString('utf8');
 // Preserve every original app byte; append static, code-owned KS presentation.
 // It shares the original analysis contribution, context, request and lifecycle.
 // Existing PAN-owned fault profile, opt-in only at code-owner construction;
 // no HTTP/query/DOM/caller plugin installer or replacement factory.
 const meta=JSON.parse(pinnedBytes(KSROOT,closure.ownedKSAttributionPath,closure.ownedKSAdditionPins[closure.ownedKSAttributionPath])),p=meta.PAN549,k=meta.existingKSConsumer;
 const values=[p.commit,p.tree,p.contractRuntimeSHA256,k.entry,k.sha256,k.sourceKSCommit,k.sourceKSTree,k.producerCommit,k.contract,'',''];let valueIndex=0;
 const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const template=pinnedBytes(KSROOT,closure.ownedKSTemplatePath,closure.ownedKSAdditionPins[closure.ownedKSTemplatePath]).toString('utf8').replace(/<dd><\/dd>/g,()=>'<dd>'+escape(values[valueIndex++])+'</dd>');
 if(valueIndex!==values.length||!entry.assets.html.includes('</body>')||closure.compositionDelimiter!==''||!entry.assets.script.endsWith('\n'))throw new Error('KS303_OWNED_DOCUMENT_FRAGMENT_DENIED');
 // Inert display-only template/JSON inside the SAME original document. No
 // inline executable script, eval, blob, iframe, second shell or CSP relaxation.
 const fragment=template+'<script type="application/json" id="ks303-existing-k05-read-companion-attribution">'+JSON.stringify(meta).replaceAll('<','\\u003c')+'</script>';
 const script=entry.assets.script+addon,html=entry.assets.html.replace('<body>','<body data-owner-analysis-reader="true"'+(options.ownerDiagnosticPlugins===true?' data-owner-diagnostic-plugins="true"':'')+'>').replace('</body>',fragment+'</body>'),style=entry.assets.style+entry.assets.analysisStyle+addonStyle;
 if(sha(Buffer.from(entry.assets.script))!==entry.binding.existingPANBundleSHA256||!script.startsWith(entry.assets.script)||Buffer.byteLength(script)>closure.publishedScriptByteBound)throw new Error('KS303_EXISTING_BROWSER_ENTRY_DENIED');
  documentMount=ingress.mountProtectedWorkspaceDocumentV1(gateway,{optIn:true,tenantId,origin,identityDigest:sessions.binding.identityDigest,html,script,style,readErv:(request,principal)=>{entry.assertCurrent();return nativeErv.read({tenantId:principal.tenantId,objectId:request.objectId,expectedRevision:request.expectedRevision});},profilesV1:{schemaVersion:'pansphaira.workspace-profile-adapter/v1',read:p=>{entry.assertCurrent();return profiles.read(p);},write:(c,p)=>{entry.assertCurrent();return profiles.write(p,c);}}});
  analysisMount=ingress.mountProtectedWorkspaceAnalysisV1(gateway,{optIn:true,tenantId,origin,identityDigest:sessions.binding.identityDigest,adapterVersion:'pan520-stock-analysis/v1',read:async(headers,selector)=>{entry.assertCurrent();const result=await pair.read(headers,selector);entry.assertCurrent();return result;}});
 return Object.freeze({
  binding:freeze({...entry.binding,schemaVersion:'kaleidosphere/ks303-existing-PAN-K05-workspace-composition/v1',existingPANEntryPreserved:true,secondShell:false,ownerDiagnosticProfile:options.ownerDiagnosticPlugins===true,protectedHTMLSHA256:sha(Buffer.from(html)),composedOwnedScriptSHA256:sha(Buffer.from(script)),composedStyleSHA256:sha(Buffer.from(style)),commonViewContribution:'pan.analysis.view',commonPanel:'kaleidosphere.ks303.k05-source-panel/v1',sessionActionsPersistent:false,authorityFromMetadata:false}),
  readPairEvidence(){if(closed)throw new Error('KS303_WORKSPACE_CLOSED');entry.assertCurrent();return pair.readPairEvidence();},
  // Process-owner lifecycle capability, never a browser route or portable grant.
  // Retire just this composition's read counterpart; retain other native modules.
  retireAnalysis(){if(closed)return;pair.close();analysisMount.close();},
  close(){if(closed)return;closed=true;cleanup();},
 });
 }catch(error){try{cleanup();}catch(cleanupError){throw new AggregateError([error,cleanupError],'KS303_WORKSPACE_CONSTRUCTION_AND_CLEANUP_FAILED');}throw error;}
}
