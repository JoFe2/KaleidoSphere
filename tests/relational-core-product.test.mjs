import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {execFileSync,spawnSync,spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';

const fixtureHelper=fileURLToPath(new URL('./helpers/relational-core-owned-fixture.py',import.meta.url));
const changeSchema=(operation)=>JSON.parse(execFileSync(process.env.KS288_RELATIONAL_PYTHON,['-I','-B',fixtureHelper,configPath,operation],{encoding:'utf8',timeout:15000}));
const nativeProbe=(mode)=>{
 const outcome=spawnSync(process.env.KS288_RELATIONAL_PYTHON,['-I','-B',fileURLToPath(new URL('./helpers/relational-core-native-worker-probe.py',import.meta.url)),configPath,mode],{encoding:'utf8',timeout:15000,env:{PATH:process.env.PATH??'',LANG:'C.UTF-8',CM_MARIADB_PASSWORD:process.env.CM_MARIADB_PASSWORD}});
 if(mode==='cancel'&&outcome.signal==='SIGTERM'){
  const start=JSON.parse(outcome.stdout);execFileSync(process.env.KS288_RELATIONAL_PYTHON,['-I','-B',fixtureHelper,configPath,'clean-abandoned-own-reader',String(start.connectionId)],{timeout:15000});
  return {missingWorkerCleanupReceipt:true,actualSignal:outcome.signal};
 }
 assert.equal(outcome.status,0,'Actual worker probe must finish normally');
 assert.equal(outcome.stderr,'','Actual worker cleanup must not emit hidden connection termination/reentrant errors');
 return JSON.parse(outcome.stdout.trim().split('\n').at(-1));
};
const execute=async(profile)=>{const dir=await mkdtemp(path.join(os.tmpdir(),'ks288-product-'));const file=path.join(dir,'profile.json');await writeFile(file,JSON.stringify(profile));return runAnalyzeProfile(file);};

const configPath=process.env.KS288_NATIVE_TEST_CONFIG;
assert.ok(configPath,'KS288_REAL_NATIVE_TEST_SETUP_REQUIRED');
const config=JSON.parse(await readFile(configPath,'utf8'));
const server=config.servers.mariadb;
process.env.CM_MARIADB_PASSWORD=(await readFile(config.secrets['maria-reader'],'utf8')).trim();
const fixture={schemaVersion:'kaleidosphere.db/relational-core-profile/v1',profileId:'ks288-real-mariadb-structure',engine:'mariadb',mode:'RUNTIME',scope:{database:'ks288',tables:['accounts','payments']},policy:{access:'READ_ONLY',allowRowSamples:false,maxQueryTimeoutMs:5000,maxMetadataRows:128},adapter:{kind:'sqlalchemy-core',host:server.host,port:server.port,user:'ks288_reader',passwordEnv:'CM_MARIADB_PASSWORD',ssl:false},approval:{state:'PREVIEW_ONLY',schemaSha256:null}};

test('K06 real workflow dispatch executes exact new MariaDB worker preview with composite keys and native collation',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'ks288-product-'));
 const file=path.join(dir,'profile.json');await writeFile(file,JSON.stringify(fixture));
 const result=await runAnalyzeProfile(file);
 assert.equal(result.engine,'mariadb');assert.equal(result.state,'PREVIEW');
 assert.ok(result.server.version.startsWith('11.8.3-MariaDB'));
 assert.deepEqual(result.metadata.tables.map(t=>t.name),['accounts','payments']);
 const payments=result.metadata.tables.find(t=>t.name==='payments');
 assert.deepEqual(payments.primaryKey,['tenant','id']);
 assert.deepEqual(payments.foreignKeys[0].columns,['tenant','account_id']);
 assert.deepEqual(payments.foreignKeys[0].targetColumns,['tenant','id']);
 const amount=payments.columns.find(c=>c.name==='amount');assert.equal(amount.precision,20);assert.equal(amount.scale,4);
 assert.equal(payments.columns.find(c=>c.name==='label').collation,'utf8mb4_bin');
 assert.match(result.schemaSha256,/^[0-9a-f]{64}$/);
 assert.equal(result.lifecycle.checkedOutAfter,0);assert.equal(result.lifecycle.poolDisposed,true);
 assert.equal(result.disclosure.rowMaterialPersisted,false);
 assert.ok(!JSON.stringify(result).includes(process.env.CM_MARIADB_PASSWORD));
});

test('K06 schema changed after approval is denied before success and owned fixture is restored',async()=>{
 const original=await execute(fixture);
 const approved=structuredClone(fixture);approved.approval={state:'APPROVED_SCOPE',schemaSha256:original.schemaSha256};
 assert.equal(changeSchema('add-column').actualOwnSchemaReadback,true);
 try{
  await assert.rejects(execute(approved),error=>error.code==='K06_SCHEMA_CHANGED'&&error.partialSuccess===false&&error.lifecycle.checkedOutAfter===0&&error.lifecycle.poolDisposed===true);
 }finally{assert.equal(changeSchema('drop-column').actualOwnSchemaReadback,true);}
 const restored=await execute(fixture);assert.equal(restored.schemaSha256,original.schemaSha256);
});

test('K06 approved actual worker computes same-data counts and exact Decimal sum without assuming collation parity',async()=>{
 const preview=await execute(fixture);assert.equal(preview.aggregateFacts,undefined);
 const approved=structuredClone(fixture);approved.approval={state:'APPROVED_SCOPE',schemaSha256:preview.schemaSha256};
 const result=await execute(approved);assert.equal(result.state,'ANALYZED');
 const accounts=result.aggregateFacts.find(t=>t.table==='accounts');assert.equal(accounts.rowCount,2);
 const payments=result.aggregateFacts.find(t=>t.table==='payments');assert.equal(payments.rowCount,3);
 const amount=payments.columns.find(c=>c.column==='amount');assert.equal(amount.nullCount,1);assert.equal(amount.distinctCount,2);assert.equal(amount.exactDecimalSum,'1234567890123456.1235');assert.equal(amount.sumRepresentation,'DECIMAL_STRING_NOT_FLOAT');
 assert.equal(payments.columns.find(c=>c.column==='label').distinctCount,2);
 assert.equal(result.schemaSha256,preview.schemaSha256);
 assert.equal(result.lifecycle.checkedOutAfter,0);assert.equal(result.lifecycle.poolDisposed,true);
 assert.equal(result.disclosure.rowMaterialPersisted,false);
 assert.equal(result.disclosure.missingVendorMetadataInferred,false);
});

test('K06 actual worker physically refuses DML and DDL with pool returned and unchanged real data',()=>{
 const result=nativeProbe('read-only');assert.equal(result.noMock,true);assert.equal(result.actualDmlDdlCodes.length,2);assert.equal(result.sameDataAndNoDdlResidueReadback,true);assert.equal(result.lifecycle.checkedOutAfter,0);
});

test('K06 actual worker refuses cross-thread and inherited-process use while parent connection remains healthy',()=>{
 const result=nativeProbe('owner-boundary');assert.equal(result.threadCode,'K06_WORKER_OWNER_DENIED');assert.equal(result.fork.code,'K06_WORKER_OWNER_DENIED');assert.equal(result.parentLiveConnectionStillHealthy,true);assert.equal(result.lifecycle.checkedOutAfter,0);
});

test('K06 actual worker interrupts a real two-second server query at its bound with pool disposed',()=>{
 const result=nativeProbe('timeout');assert.equal(result.actualTimeoutCode,1969);assert.ok(result.elapsedSeconds<1.5);assert.equal(result.lifecycle.checkedOutAfter,0);assert.equal(result.lifecycle.poolDisposed,true);
});

test('K06 SIGTERM cancellation of actual live worker interrupts own query and returns its pool',()=>{
 const result=nativeProbe('cancel');assert.equal(result.reasonCode,'K06_CANCELLED');assert.equal(result.actualSigtermDeliveredToLiveWorker,true);assert.equal(result.lifecycle.checkedOutAfter,0);assert.equal(result.lifecycle.poolDisposed,true);assert.equal(result.lifecycle.ownQueryCancellationSent,true);assert.equal(result.lifecycle.cancelControlClosed,true);
});

test('K06 optional path fails closed on an actual interpreter with its driver absent',async()=>{
 const previous=process.env.KS288_RELATIONAL_PYTHON;
 try{process.env.KS288_RELATIONAL_PYTHON=config.missingDriverPython;await assert.rejects(execute(fixture),error=>error.code==='K06_DRIVER_UNAVAILABLE'&&error.partialSuccess===false);}
 finally{process.env.KS288_RELATIONAL_PYTHON=previous;}
});

test('K06 actual authentication refusal never exposes either actual or invalid credentials',async()=>{
 const previous=process.env.CM_MARIADB_PASSWORD;
 const invalid='negative_'+crypto.randomUUID();
 try{process.env.CM_MARIADB_PASSWORD=invalid;await assert.rejects(execute(fixture),error=>error.code==='K06_WORKER_FAILED'&&!JSON.stringify(error).includes(invalid)&&!String(error).includes(invalid)&&!String(error).includes(previous));}
 finally{process.env.CM_MARIADB_PASSWORD=previous;}
});

test('K06 actual MariaDB target rejects a MySQL profile instead of reclassifying it as MariaDB success',async()=>{
 const mysql=structuredClone(fixture);mysql.engine='mysql';await assert.rejects(execute(mysql),error=>error.code==='K06_PROFILE_DENIED');
});

test('K06 profile rejects malformed identity as a typed refusal before driver or connection',async()=>{
 const malformed=structuredClone(fixture);malformed.profileId=null;await assert.rejects(execute(malformed),error=>error.code==='K06_PROFILE_DENIED');
});

test('K06 workflow AbortSignal cancels an observed live worker query with verified child pool cleanup',async()=>{
 const original=await execute(fixture);const approved=structuredClone(fixture);approved.approval={state:'APPROVED_SCOPE',schemaSha256:original.schemaSha256};
 const dir=await mkdtemp(path.join(os.tmpdir(),'ks288-abort-'));const file=path.join(dir,'profile.json');await writeFile(file,JSON.stringify(approved));
 const locker=spawn(process.env.KS288_RELATIONAL_PYTHON,['-I','-B',fixtureHelper,configPath,'hold-write-lock'],{stdio:['pipe','pipe','pipe']});
 let lockOutput='',lockError='';locker.stdout.on('data',data=>{lockOutput+=data.toString();});locker.stderr.on('data',data=>{lockError+=data.toString();});
 const closed=once(locker,'close');const deadline=setTimeout(()=>locker.kill('SIGKILL'),15000);
 const controller=new AbortController();let call;
 try{
  for(let attempt=0;attempt<100&&!lockOutput.includes('exactOwnWriteLock');attempt++)await new Promise(resolve=>setTimeout(resolve,20));
  assert.ok(lockOutput.includes('exactOwnWriteLock'),'Actual own fixture lock must be ready');
  call=runAnalyzeProfile(file,{signal:controller.signal});call.catch(()=>{});
  let observed=false;
  for(let attempt=0;attempt<30&&!observed;attempt++){
   observed=changeSchema('check-waiting-reader').waitingOwnReaderQueries===1;
   if(!observed)await new Promise(resolve=>setTimeout(resolve,20));
  }
  assert.equal(observed,true,'Actual waiting reader query must be observed before abort');
  controller.abort();
  await assert.rejects(call,error=>error.code==='K06_CANCELLED'&&error.lifecycle?.checkedOutAfter===0&&error.lifecycle.poolDisposed===true&&error.lifecycle.ownQueryCancellationSent===true&&error.lifecycle.cancelControlClosed===true);
 }finally{
  if(call){controller.abort();await call.catch(()=>{});}
  locker.stdin.end('release\n');const [code]=await closed;clearTimeout(deadline);assert.equal(code,0);assert.equal(lockError,'');
 }
 assert.equal(changeSchema('check-no-reader-residue').actualOwnReaderConnections,0);
 assert.equal((await execute(fixture)).schemaSha256,original.schemaSha256);
});

for(const field of ['decimal','collation']){
 test(`K06 real ${field} change cannot reuse old approved parity and exact owned data is restored`,async()=>{
  const original=await execute(fixture);const approved=structuredClone(fixture);approved.approval={state:'APPROVED_SCOPE',schemaSha256:original.schemaSha256};
  assert.equal(changeSchema(`change-${field}`).actualOwnSchemaReadback,true);
  try{await assert.rejects(execute(approved),error=>error.code==='K06_SCHEMA_CHANGED'&&error.partialSuccess===false&&error.lifecycle.checkedOutAfter===0);}
  finally{assert.equal(changeSchema(`restore-${field}`).actualOwnSchemaReadback,true);}
  const restored=await execute(approved);assert.equal(restored.schemaSha256,original.schemaSha256);
  const payments=restored.aggregateFacts.find(t=>t.table==='payments');assert.equal(payments.rowCount,3);assert.equal(payments.columns.find(c=>c.column==='amount').exactDecimalSum,'1234567890123456.1235');assert.equal(payments.columns.find(c=>c.column==='label').distinctCount,2);
 });
}
