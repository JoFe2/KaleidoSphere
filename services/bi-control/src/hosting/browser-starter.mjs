import {openSync,fstatSync,readSync,closeSync,constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {createH03OwnedStarterStoreV1} from './browser-starter-store.mjs';
const execute=promisify(execFile);
import {exactObject,coded} from '../policy.mjs';
import {loadH05SharedRuntimeSourceV1,getH05SharedRuntimeApisV1,releaseH05SharedRuntimeSourceV1} from '../runtime/h05-shared-runtime-source.mjs';
const fail=code=>{throw coded(code);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function ownedIdentity(root){let dir,fd;try{
 dir=openSync(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const ds=fstatSync(dir);if(ds.uid!==process.getuid()||(ds.mode&0o077)!==0)fail('H03_OWNER_CONTEXT_DENIED');
 fd=openSync('/proc/self/fd/'+dir+'/identity.json',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 const st=fstatSync(fd);if(!st.isFile()||st.uid!==process.getuid()||(st.mode&0o077)!==0||st.nlink!==1||st.size>32768)fail('H03_OWNER_CONTEXT_DENIED');
 const bytes=Buffer.alloc(st.size+1);let offset=0;for(;;){const n=readSync(fd,bytes,offset,bytes.length-offset,null);if(!n)break;offset+=n;if(offset===bytes.length)fail('H03_OWNER_CONTEXT_DENIED');}
 if(offset!==st.size)fail('H03_OWNER_CONTEXT_DENIED');return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,offset)));
 }finally{if(fd!==undefined)closeSync(fd);if(dir!==undefined)closeSync(dir);}}
export async function loadH03BrowserStarterV1({panRoot,ownerRoot,tenantId,stateRoot,productRoot,analyze,catalogQuestion}){
 const source=await loadH05SharedRuntimeSourceV1({optIn:true,sourceRoot:panRoot});
 try{
 const api=getH05SharedRuntimeApisV1(source);const template=api.templates.bindRuntimeTemplateV1(ownedIdentity(ownerRoot));
 if(template.identity.componentId!=='kaleidosphere-bi-agent'||template.identity.tenantId!==tenantId||template.identity.runtime.name!=='node'||template.identity.runtime.version!==process.versions.node)fail('H03_IDENTITY_BINDING_DENIED');
 const store=createH03OwnedStarterStoreV1(stateRoot,JSON.stringify({instanceId:template.identity.instanceId,tenantId,identityDigest:template.identityDigest,runtimeTemplateDigest:template.runtimeTemplateDigest}));
 let activeOperation=null;
 return Object.freeze({close(){store.close();releaseH05SharedRuntimeSourceV1(source);},async invoke(value){
 let {state,result,starterGeneration}=store.read();if(state==='outcome_unknown'&&activeOperation)state=activeOperation.abortWanted?'abort_requested':'running';
 exactObject(value,['schemaVersion','action','journey','operationId','instanceId','expectedGeneration'],['schemaVersion','action']);
 if(value.schemaVersion!=='kaleidosphere/browser-starter-command/v1')fail('H03_COMMAND_DENIED');
 const currentTemplate=getH05SharedRuntimeApisV1(source).templates.bindRuntimeTemplateV1(ownedIdentity(ownerRoot));
 if(currentTemplate.identityDigest!==template.identityDigest||currentTemplate.runtimeTemplateDigest!==template.runtimeTemplateDigest)fail('H03_IDENTITY_INVALIDATED');
 if(value.action==='status'){exactObject(value,['schemaVersion','action']);return{state,result,template,starterGeneration,tenantId,instanceId:template.identity.instanceId};}
 if(value.action==='suggest'){
 exactObject(value,['schemaVersion','action','journey']);if(!['catalog','metric'].includes(value.journey))fail('H03_COMMAND_DENIED');
 return{state,result,starterGeneration,template,tenantId,instanceId:template.identity.instanceId,
 suggestion:{type:'STARTER_JOURNEY',journey:value.journey,command:{schemaVersion:'kaleidosphere/browser-starter-command/v1',action:'run',journey:value.journey}},
 dispatchAuthorized:false,modelCalled:false};
 }
 if(value.action==='abort'){
 exactObject(value,['schemaVersion','action','operationId']);
 if(!activeOperation||value.operationId!==activeOperation.operationId)fail('H03_ABORT_BINDING_DENIED');
 activeOperation.abortWanted=true;activeOperation.controller.abort();return{state:'abort_requested',result:null,starterGeneration};
 }
 if(value.action==='reset'){
 exactObject(value,['schemaVersion','action','instanceId','expectedGeneration']);
 if(value.instanceId!==template.identity.instanceId||value.expectedGeneration!==starterGeneration||!Number.isSafeInteger(value.expectedGeneration))fail('H03_RESET_BINDING_DENIED');
 if(['running','abort_requested','outcome_unknown'].includes(state))fail('H03_RESET_OUTCOME_UNKNOWN_DENIED');
 ({state,result,starterGeneration}=store.reset(value.instanceId,value.expectedGeneration));
 return{state,result,template,starterGeneration,tenantId,instanceId:template.identity.instanceId,sourceResourcesRemoved:false,foreignResourcesRemoved:false};
 }
 if(value.action!=='run'||!['catalog','metric'].includes(value.journey)||! /^(catalog|metric)-[a-z0-9-]{1,48}$/.test(value.operationId??''))fail('H03_COMMAND_DENIED');
 exactObject(value,['schemaVersion','action','journey','operationId']);
 const reservation=store.begin(value);if(!reservation.dispatch)return{...reservation,replayed:true};
 const started=performance.now();state='running';activeOperation={operationId:value.operationId,controller:new AbortController(),abortWanted:false};
 const operation=activeOperation;
 try{
 if(value.journey==='metric'){
 const pending=execute(process.execPath,[join(productRoot,'scripts/run-invoice-date-o2c.mjs'),'--fixture','COMMON-TRADE-01','--period-start','2026-06-01','--period-end','2026-08-01','--view','aggregate'],
 {cwd:productRoot,timeout:10000,maxBuffer:262144,signal:operation.controller.signal,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR}});
 const exited=new Promise(resolve=>pending.child.once('close',resolve));let wire;try{wire=await pending;}finally{await exited;}
 if(operation.abortWanted){store.complete(value.operationId,'aborted',null);activeOperation=null;return{state:'aborted',result:null,sourceEffectsPerformed:false};}
 if(wire.stderr)fail('H03_METRIC_DIAGNOSTIC_DENIED');const calculation=JSON.parse(wire.stdout);
 if(calculation.outcome!=='ACCEPTED'||calculation.partialSuccess!==false||calculation.source?.syntheticOnly!==true||calculation.operationAuthority!=='BUNDLED_EXACT_SYNTHETIC_FIXTURE_NOT_CALLER_ROLE')fail('H03_METRIC_RESULT_DENIED');
 const observedValue=calculation.table.rows.reduce((n,row)=>{if(row.currency!=='EUR'||!Number.isSafeInteger(row.net_minor))fail('H03_METRIC_RESULT_DENIED');return n+row.net_minor;},0);
 const expectedValue=90000;const businessStatus=observedValue===expectedValue?'VALUE_VERIFIED':'VALUE_MISMATCH';
 result={schemaVersion:'kaleidosphere/browser-starter-result/v1',journey:'metric',expectedValue,observedValue,businessStatus,unit:'EUR_MINOR',template,
 source:calculation.source,period:{start:'2026-06-01',end:'2026-08-01',dateBasis:'INVOICE_DATE'},
 rights:{principal:'NON_ADMIN_READER',scope:'OWNED_SYNTHETIC_STARTER',sourceWriteAuthorized:false,adminAuthorized:false,templateIsNotGrant:true,operationAuthority:calculation.operationAuthority},
 evidence:{table:calculation.table,observedValueSha256:digest(observedValue),rawSourceReturned:false,producerPairing:calculation.producerPairing},
 firstValueMs:performance.now()-started,humanUsability:'NOT_OBSERVED',runtimeReadinessClaimed:false};
 state=businessStatus==='VALUE_VERIFIED'?'succeeded':'failed';store.complete(value.operationId,state,result);activeOperation=null;return{state,result};
 }
 const analysis=await analyze();const answer=await catalogQuestion({family:'largest_tables',scope:{schemas:['dbo']},object:null,limit:20});
 if(operation.abortWanted){store.complete(value.operationId,'aborted',null);activeOperation=null;return{state:'aborted',result:null,sourceEffectsPerformed:false,localCatalogPreparationMayHaveCompleted:true};}
 const expectedValue=['dbo.customers','dbo.orders'];const observedValue=answer.rows.filter(row=>row.relation_kind==='TABLE').map(row=>row.schema_name+'.'+row.relation_name).sort();
 const businessStatus=JSON.stringify(expectedValue)===JSON.stringify(observedValue)?'VALUE_VERIFIED':'VALUE_MISMATCH';
 result={schemaVersion:'kaleidosphere/browser-starter-result/v1',journey:'catalog',expectedValue,observedValue,businessStatus,template,
 source:{mode:'BUNDLED_SYNTHETIC_METADATA',database:analysis.scope.database,schemas:['dbo'],snapshotSha256:analysis.analysis.snapshotSha256},
 rights:{principal:'NON_ADMIN_READER',scope:'OWNED_SYNTHETIC_STARTER',sourceWriteAuthorized:false,adminAuthorized:false,templateIsNotGrant:true},
 evidence:{receiptId:analysis.receiptId,snapshotSha256:answer.provenance.snapshotSha256,observedValueSha256:digest(observedValue),rawSourceReturned:false},
 firstValueMs:performance.now()-started,humanUsability:'NOT_OBSERVED',runtimeReadinessClaimed:false};
 state=businessStatus==='VALUE_VERIFIED'?'succeeded':'failed';store.complete(value.operationId,state,result);activeOperation=null;return{state,result};
 }catch(error){
 if(operation.abortWanted){store.complete(value.operationId,'aborted',null);activeOperation=null;return{state:'aborted',result:null,sourceEffectsPerformed:false};}
 activeOperation=null;state='outcome_unknown';throw error;}

 }});
 }catch(error){releaseH05SharedRuntimeSourceV1(source);throw error;}}
