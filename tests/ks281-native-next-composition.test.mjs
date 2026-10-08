import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFileSync,writeFileSync,mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {runRelationalCoreProfile} from '../services/bi-control/src/db-analyzer/relational-core-workflow.mjs';
import {executeO2cInvestigationV1} from '../services/bi-control/src/business-bi/o2c-investigation-profile.mjs';
import {combinedBusinessFixture} from './fixtures/business-bi/ks281-combined-native-fixture.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const sourceRoot=process.env.KS285_PAN520_SOURCE;
const configPath=process.env.KS288_NATIVE_TEST_CONFIG;
assert.ok(sourceRoot&&configPath,'Exact actual native PAN520 and READY synthetic MariaDB fixtures required, no replacement or skip');
const config=JSON.parse(readFileSync(configPath,'utf8'));
assert.equal(config.declaredSyntheticOnly,true);
const server=config.servers.mariadb;
process.env.CM_MARIADB_PASSWORD=readFileSync(config.secrets['maria-reader'],'utf8').trim();
const coreProfile=()=>({schemaVersion:'kaleidosphere.db/relational-core-profile/v1',profileId:'ks281-owned-core',engine:'mariadb',mode:'RUNTIME',scope:{database:'ks288',tables:['accounts','payments']},policy:{access:'READ_ONLY',allowRowSamples:false,maxQueryTimeoutMs:5000,maxMetadataRows:128},adapter:{kind:'sqlalchemy-core',host:server.host,port:server.port,user:'ks288_reader',passwordEnv:'CM_MARIADB_PASSWORD',ssl:false},approval:{state:'PREVIEW_ONLY',schemaSha256:null}});
const period={start:'2026-06-01',end:'2026-08-01'},asOf='2026-06-30T23:59:59+02:00';
let api=null;
try{api=await import('../services/bi-control/src/business-bi/business-epic-composition-v1.mjs');}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!error.message.includes('business-epic-composition-v1.mjs'))throw error;}
async function ownInputs(t){
 const native=await combinedBusinessFixture(sourceRoot);
 const owned=mkdtempSync(join(tmpdir(),'ks281-next-'));
 const secret=randomBytes(32).toString('hex'),secretEnv='KS289_LOCAL_FIXTURE_'+randomBytes(8).toString('hex').toUpperCase();
 process.env[secretEnv]=secret;
 const observations=[];
 let reply=null;
 const rows=[{id:'one',category:'A',quantity:2},{id:'two',category:null,quantity:0},{id:'three',category:'B',quantity:4},{id:'four',category:'A',quantity:null}];
 const pages={FIRST:{snapshot:'fixture-revision-one',totalCount:4,items:rows.slice(0,2),nextCursor:'p2'},p2:{snapshot:'fixture-revision-one',totalCount:4,items:[rows[1],rows[2]],nextCursor:'p3'},p3:{snapshot:'fixture-revision-one',totalCount:4,items:[rows[3]],nextCursor:null}};
 const httpServer=http.createServer((request,response)=>{
  const url=new URL(request.url,'http://127.0.0.1');
  const observed={method:request.method,path:url.pathname,fields:url.searchParams.get('fields'),cursor:url.searchParams.get('cursor'),authorized:request.headers.authorization===`Bearer ${secret}`,ifMatch:request.headers['if-match']??null};observations.push(observed);
  if(!observed.authorized||observed.method!=='GET'||observed.path!=='/k07/v1/records'){response.writeHead(403);response.end('{}');return;}
  if(reply){reply({request,response,observed,pages});return;}
  response.writeHead(200,{'content-type':'application/json',etag:'"fixture-revision-one"'});response.end(JSON.stringify(pages[observed.cursor??'FIRST']));
 });
 await new Promise((resolve,reject)=>{httpServer.once('error',reject);httpServer.listen(0,'127.0.0.1',resolve);});
 const origin=`http://127.0.0.1:${httpServer.address().port}`;process.env[secretEnv+'_ORIGIN']=origin;
 t.after(async()=>{httpServer.closeAllConnections();await new Promise(resolve=>httpServer.close(resolve));delete process.env[secretEnv];delete process.env[secretEnv+'_ORIGIN'];native.close();rmSync(owned,{recursive:true,force:true});assert.equal(existsSync(native.root),false);assert.equal(existsSync(owned),false);});
 const relationalProfile=coreProfile();const preview=await runRelationalCoreProfile(relationalProfile);assert.equal(preview.state,'PREVIEW');relationalProfile.approval={state:'APPROVED_SCOPE',schemaSha256:preview.schemaSha256};
 const store=join(owned,'recipes');
 const saved=executeO2cInvestigationV1({root,values:{'profile-save':'monthly',store,fixture:'COMMON-TRADE-01','period-start':period.start,'period-end':period.end,view:'all'}});assert.equal(saved.outcome,'ACCEPTED');
 const apiProfile={schemaVersion:'kaleidosphere.api/bounded-read-profile/v1',profileId:'ks281-local-api',mode:'LOCAL_SYNTHETIC_FIXTURE',source:{kind:'k07-owned-rest-fixture-v1',origin,secretEnv},scope:{endpoint:'/k07/v1/records',fields:['id','category','quantity']},policy:{maxPages:8,maxObjects:16,maxPageBytes:4096,requestTimeoutMs:500,totalTimeoutMs:5000,minRequestIntervalMs:0}};
 return {native,observations,secret,secretEnv,store,saved,options:{firstWave:{sourceRoot,nativeRoot:native.root,asOf,period:{...period},fileRuntimeRoot:process.env.KS281_DUCKDB_RUNTIME??new URL('../.ks-file-runtime/',import.meta.url).pathname},relationalProfile,apiProfile,savedInvestigation:{store,profileId:'monthly',profileVersion:'1'}},setReply(value){reply=value;}};
}

test('one actual full epic activation executes the released first wave Core API and saved-investigation components without collapsing their scopes',async(t)=>{
 assert.equal(typeof api?.createBusinessEpicCompositionV1,'function','Missing actual whole existing-business composition, not independent PASS-file collation');
 const f=await ownInputs(t),beforeNative=f.native.combinedRows(),beforeRecipe=readFileSync(join(f.store,'monthly','v1.json'));
 const consumer=await api.createBusinessEpicCompositionV1(f.options);
 const result=await consumer.read();
 assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);
 assert.equal(result.stateVersion,1);assert.equal(result.partialSuccess,false);
 assert.equal(result.components.firstWave.firstWave.aggregate.numbers.currentNetMinorUnits,100059);
 assert.equal(result.components.firstWave.firstWave.nativeBusiness.components.o2c.facts.billedNetMinor.state,'UNAVAILABLE');
 assert.equal(result.components.relational.state,'ANALYZED');assert.equal(result.components.relational.engine,'mariadb');
 const payments=result.components.relational.aggregateFacts.find(table=>table.table==='payments');
 assert.equal(payments.rowCount,3);assert.equal(payments.columns.find(column=>column.column==='amount').exactDecimalSum,'1234567890123456.1235');
 assert.equal(result.components.relational.lifecycle.checkedOutAfter,0);assert.equal(result.components.relational.lifecycle.poolDisposed,true);
 assert.equal(result.components.api.state,'COMPLETE');assert.equal(result.components.api.coverage.pagesRead,3);assert.equal(result.components.api.facts.objectCount,4);assert.equal(result.components.api.facts.duplicateCount,1);
 assert.equal(result.components.api.actualVendorQualified,false);assert.equal(result.components.api.sourceRowsExported,false);
 assert.equal(f.observations.length,3);assert.ok(f.observations.every(observed=>observed.authorized&&observed.method==='GET'&&observed.fields==='id,category,quantity'));
 const investigation=result.components.savedInvestigation;
 assert.equal(investigation.investigation.freshness,'FRESH_BOUND_EXECUTION');assert.equal(investigation.investigation.profileVersion,1);
 assert.equal(investigation.investigation.resultReference,f.saved.investigation.resultReference);
 assert.deepEqual(investigation.table.rows,[{month:'2026-06',net_minor:80000,currency:'EUR'},{month:'2026-07',net_minor:10000,currency:'EUR'}]);
 assert.deepEqual(investigation.chart.series,investigation.table.rows.map(row=>({month:row.month,net_minor:row.net_minor})));
 const csvRows=investigation.export.csv.split('\n').filter(line=>line&&!line.startsWith('#')).slice(1).map(line=>{const [month,net,currency]=line.split(',');return {month,net_minor:Number(net),currency};});assert.deepEqual(csvRows,investigation.table.rows);
 assert.equal(result.sourceScopeClaim,'MULTIPLE_EXISTING_APPROVED_SCOPES_NOT_ONE_DATASET');assert.equal(result.atomicCrossSourceTransaction,false);assert.equal(result.sourceMutationPerformed,false);
 assert.deepEqual(f.native.combinedRows(),beforeNative);assert.deepEqual(readFileSync(join(f.store,'monthly','v1.json')),beforeRecipe);
 for(const forbidden of [f.secret,process.env.CM_MARIADB_PASSWORD])assert.equal(JSON.stringify(result).includes(forbidden),false,'no source credential may escape through a joined receipt');
});

test('constructor refuses nested caller accessors before evaluating them or awaiting a source',async()=>{
 let evaluated=0;
 const options={firstWave:{},relationalProfile:{approval:{state:'APPROVED_SCOPE'}},apiProfile:{},savedInvestigation:{}};
 Object.defineProperty(options.relationalProfile,'scope',{enumerable:true,get(){evaluated++;throw new Error('CALLER_ACCESSOR_EXECUTED');}});
 await assert.rejects(api.createBusinessEpicCompositionV1(options),/KS281_INPUT_DENIED/);
 assert.equal(evaluated,0);
});

test('a caller cannot rewrite an already qualified whole-epic receipt or its held client generation',async(t)=>{
 const f=await ownInputs(t),consumer=await api.createBusinessEpicCompositionV1(f.options);
 const first=await consumer.read();assert.equal(first.stateVersion,1);
 assert.throws(()=>{first.components.api.facts.objectCount=777;},TypeError);
 assert.throws(()=>{first.stateVersion=777;},TypeError);
 const repeated=await consumer.read();
 assert.equal(repeated.stateVersion,first.stateVersion,'a fresh native worker PID is execution evidence, not a new business client state');
 assert.equal(repeated.stateDigest,first.stateDigest);
 assert.deepEqual(repeated.components.api.facts,first.components.api.facts);
 assert.notEqual(repeated.components.relational.lifecycle.workerPid,first.components.relational.lifecycle.workerPid,'retain each actual fresh worker observation instead of returning an older PID as fresh');
 f.native.revoke();const denied=await consumer.read();
 assert.equal(denied.outcome,'DENIED');assert.equal(denied.stateVersion,1);assert.equal(denied.previousQualifiedHeld,true);assert.equal(denied.components,null);
});

test('a preview-only Core profile cannot authorize a whole-epic activation',async(t)=>{
 const f=await ownInputs(t);
 f.options.relationalProfile.approval={state:'PREVIEW_ONLY',schemaSha256:null};
 await assert.rejects(api.createBusinessEpicCompositionV1(f.options),/KS281_CORE_APPROVAL_DENIED/);
 assert.equal(f.observations.length,0);
});

test('extra caller authority fields are denied rather than interpreted or ignored as a grant',async(t)=>{
 const f=await ownInputs(t);
 await assert.rejects(api.createBusinessEpicCompositionV1({...f.options,role:'admin'}),/KS281_INPUT_DENIED/);
 assert.equal(f.observations.length,0);
});

test('closing the actual client lifetime cancels its live bounded HTTP request and cannot activate a late whole result',async(t)=>{
 const f=await ownInputs(t),consumer=await api.createBusinessEpicCompositionV1(f.options);
 const first=await consumer.read();assert.equal(first.stateVersion,1);
 assert.equal(typeof consumer.close,'function','Missing lifetime retirement for a pending whole-epic read');
 let observedRequest,observedClose;
 const requested=new Promise(resolve=>{observedRequest=resolve;}),closed=new Promise(resolve=>{observedClose=resolve;});
 f.setReply(({request})=>{request.socket.once('close',observedClose);observedRequest();});
 const pending=consumer.read();await requested;consumer.close();consumer.close();
 const denied=await pending;await closed;
 assert.equal(denied.outcome,'DENIED');assert.equal(denied.reasonCode,'KS281_COMPOSITION_CLOSED');
 assert.equal(denied.components,null);assert.equal(denied.stateVersion,first.stateVersion);assert.equal(denied.previousQualifiedHeld,true);assert.equal(denied.partialSuccess,false);
 const requestCount=f.observations.length;
 assert.equal((await consumer.read()).reasonCode,'KS281_COMPOSITION_CLOSED');assert.equal(f.observations.length,requestCount);
});

for(const scenario of ['incomplete','snapshot-change','native-revoke'])test(`a real combined ${scenario} refuses the whole new candidate and holds the prior client generation`,async(t)=>{
 const f=await ownInputs(t),consumer=await api.createBusinessEpicCompositionV1(f.options);
 const prior=await consumer.read();let afterRevoke;
 f.setReply(({response,observed,pages})=>{
  if(scenario==='native-revoke'&&observed.cursor===null){f.native.revoke();afterRevoke=f.native.combinedRows();}
  if(scenario==='incomplete'){response.writeHead(429,{'content-type':'application/json'});response.end('{}');return;}
  const page=structuredClone(pages[observed.cursor??'FIRST']);
  if(scenario==='snapshot-change'&&observed.cursor!==null)page.snapshot='fixture-revision-two';
  response.writeHead(200,{'content-type':'application/json',etag:`"${page.snapshot}"`});response.end(JSON.stringify(page));
 });
 const denied=await consumer.read();
 assert.equal(denied.outcome,'DENIED');assert.equal(denied.components,null);assert.equal(denied.partialSuccess,false);assert.equal(denied.previousQualifiedHeld,true);assert.equal(denied.stateVersion,prior.stateVersion);
 if(scenario==='incomplete')assert.equal(denied.reasonCode,'K07_RATE_LIMITED');
 if(scenario==='snapshot-change')assert.equal(denied.reasonCode,'K07_SNAPSHOT_CHANGED');
 if(scenario==='native-revoke'){assert.match(denied.reasonCode,/STOP_OR_REVOKE_DENIED$/);assert.deepEqual(f.native.combinedRows(),afterRevoke);}
});

test('unselected vendor authority is still refused in the composed runtime before any real request',async(t)=>{
 const f=await ownInputs(t);f.options.apiProfile.mode='LIVE_VENDOR';
 const consumer=await api.createBusinessEpicCompositionV1(f.options),denied=await consumer.read();
 assert.equal(denied.outcome,'DENIED');assert.equal(denied.reasonCode,'K07_SOURCE_NOT_AUTHORIZED');assert.equal(denied.components,null);assert.equal(denied.stateVersion,0);assert.equal(f.observations.length,0);
});

test('constructor captures every nested input before source awaits, not only the first-wave period',async(t)=>{
 const f=await ownInputs(t),pending=api.createBusinessEpicCompositionV1(f.options);
 f.options.relationalProfile.scope.database='not_authorized';f.options.apiProfile.mode='LIVE_VENDOR';f.options.savedInvestigation.profileId='not-selected';f.options.firstWave.period.start='2026-01-01';
 const consumer=await pending,result=await consumer.read();
 assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);assert.equal(result.components.relational.metadata.database,'ks288');assert.equal(result.components.api.actualVendorQualified,false);assert.equal(result.components.savedInvestigation.investigation.profileId,'monthly');assert.deepEqual(result.components.savedInvestigation.investigation.period,period);
});

test('an older actual pending API snapshot cannot replace a newer whole-client activation',async(t)=>{
 const f=await ownInputs(t);f.options.apiProfile.policy.requestTimeoutMs=2000;
 const consumer=await api.createBusinessEpicCompositionV1(f.options);
 let heldResponse,notifyHeld;const held=new Promise(resolve=>{notifyHeld=resolve;});
 f.setReply(({response,observed,pages})=>{
  if(!heldResponse&&observed.cursor===null){heldResponse=response;notifyHeld();return;}
  const page=structuredClone(pages[observed.cursor??'FIRST']);
  page.snapshot=observed.ifMatch==='"fixture-revision-one"'?'fixture-revision-one':'fixture-revision-two';
  response.writeHead(200,{'content-type':'application/json',etag:`"${page.snapshot}"`});response.end(JSON.stringify(page));
 });
 const older=consumer.read();await held;
 const latest=await consumer.read();assert.equal(latest.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS');assert.equal(latest.stateVersion,1);
 heldResponse.writeHead(200,{'content-type':'application/json',etag:'"fixture-revision-one"'});heldResponse.end(JSON.stringify({snapshot:'fixture-revision-one',totalCount:4,items:[{id:'one',category:'A',quantity:2},{id:'two',category:null,quantity:0}],nextCursor:'p2'}));
 const denied=await older;
 assert.equal(denied.outcome,'DENIED','an older real API snapshot activated after the newer complete generation');
 assert.equal(denied.reasonCode,'KS281_COMPOSITION_SUPERSEDED');assert.equal(denied.components,null);assert.equal(denied.stateVersion,latest.stateVersion);assert.equal(denied.previousQualifiedHeld,true);
 assert.equal((await consumer.read()).stateVersion,latest.stateVersion);
});

test('actual owned Core schema drift refuses all combined output and restores the same approved source',async(t)=>{
 const f=await ownInputs(t),consumer=await api.createBusinessEpicCompositionV1(f.options),prior=await consumer.read();
 const helper=fileURLToPath(new URL('./helpers/relational-core-owned-fixture.py',import.meta.url));
 const change=operation=>JSON.parse(execFileSync(process.env.KS288_RELATIONAL_PYTHON,['-I','-B',helper,configPath,operation],{encoding:'utf8',timeout:15000}));
 assert.equal(change('add-column').actualOwnSchemaReadback,true);
 try{
  const previousRequests=f.observations.length,denied=await consumer.read();
  assert.equal(denied.outcome,'DENIED');assert.equal(denied.reasonCode,'K06_SCHEMA_CHANGED');assert.equal(denied.components,null);assert.equal(denied.stateVersion,prior.stateVersion);assert.equal(denied.previousQualifiedHeld,true);assert.equal(f.observations.length,previousRequests);
 }finally{assert.equal(change('drop-column').actualOwnSchemaReadback,true);}
 const restored=await consumer.read();assert.equal(restored.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS');assert.equal(restored.stateVersion,prior.stateVersion);assert.equal(restored.components.relational.schemaSha256,prior.components.relational.schemaSha256);
});

test('an actually corrupted saved recipe cannot join otherwise successful Core API and native results',async(t)=>{
 const f=await ownInputs(t),consumer=await api.createBusinessEpicCompositionV1(f.options),prior=await consumer.read();
 const file=join(f.store,'monthly','v1.json'),before=readFileSync(file),record=JSON.parse(before);record.profile.profileVersion=4;writeFileSync(file,JSON.stringify(record));
 try{
  const denied=await consumer.read();assert.equal(denied.outcome,'DENIED');assert.equal(denied.reasonCode,'K08_PROFILE_RECORD_DENIED');assert.equal(denied.components,null);assert.equal(denied.previousQualifiedHeld,true);assert.equal(denied.stateVersion,prior.stateVersion);assert.equal(denied.partialSuccess,false);
 }finally{writeFileSync(file,before);}
 assert.equal((await consumer.read()).stateVersion,prior.stateVersion);assert.deepEqual(readFileSync(file),before);
});

test('sparse arrays with replacement named fields are not silently normalized into an approved scope',async(t)=>{
 const f=await ownInputs(t);
 const malformed=['accounts','payments'];delete malformed[1];malformed.extra='payments';
 f.options.relationalProfile.scope.tables=malformed;
 await assert.rejects(api.createBusinessEpicCompositionV1(f.options),/KS281_INPUT_DENIED/);
 assert.equal(f.observations.length,0);
});
