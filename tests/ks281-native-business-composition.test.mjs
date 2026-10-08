import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {combinedBusinessFixture} from './fixtures/business-bi/ks281-combined-native-fixture.mjs';
const sourceRoot=process.env.KS285_PAN520_SOURCE;
assert.ok(sourceRoot,'Exact qualified native PAN520 required; no stub/skip');
let api=null;
try{api=await import('../services/bi-control/src/business-bi/native-business-composition-v1.mjs');}
catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!error.message.includes('native-business-composition-v1.mjs'))throw error;}
const asOf='2026-06-30T23:59:59+02:00',period={start:'2026-06-01',end:'2026-08-01'};
test('constructor rejects caller accessors without evaluating them',async()=>{
 let calls=0;
 const options={nativeRoot:'/owned-not-used',asOf,period};
 Object.defineProperty(options,'sourceRoot',{enumerable:true,get(){calls++;throw new Error('CALLER_ACCESSOR_EXECUTED');}});
 await assert.rejects(api.createNativeBusinessCompositionV1(options),/KS281_INPUT_DENIED/);
 assert.equal(calls,0);
});
test('constructor captures period scalars before asynchronous source loading',async()=>{
 const f=await combinedBusinessFixture(sourceRoot);
 try{
  const mutablePeriod={...period};
  const pending=api.createNativeBusinessCompositionV1({sourceRoot,nativeRoot:f.root,asOf,period:mutablePeriod});
  mutablePeriod.start='2026-01-01';
  const consumer=await pending;
  assert.deepEqual(consumer.read().components.o2c.requestedPeriod,period,'caller alias rewrote the admitted period after constructor entry');
 }finally{f.close();assert.equal(existsSync(f.root),false);}
});
test('one actual COMMON root composes O2C procurement and stock without promoting unavailable billing',async()=>{
 const f=await combinedBusinessFixture(sourceRoot);
 try{
  const before=f.combinedRows();
  assert.equal(typeof api?.createNativeBusinessCompositionV1,'function','Missing joined native business consumer over actual existing components');
  const consumer=await api.createNativeBusinessCompositionV1({sourceRoot,nativeRoot:f.root,asOf,period});
  const result=consumer.read();
  assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);
  assert.equal(result.stateVersion,1);
  assert.equal(result.sharedSnapshot.asOf,asOf);
  assert.equal(result.sharedSnapshot.nativeRevision,7);
  assert.equal(result.readOnly,true);assert.equal(result.persistentMutation,false);
  assert.equal(result.components.o2c.facts.onTimeDispatchedQuantity.value,8);
  assert.equal(result.components.p2p.facts.acceptedQuantity.value,10);
  assert.equal(result.components.stock.facts.physical.value,2);
  assert.equal(result.components.stock.facts.reserved.value,2);
  assert.equal(result.components.o2c.facts.billedNetMinor.state,'UNAVAILABLE');
  assert.equal(result.components.o2c.facts.billedNetMinor.value,null);
  assert.deepEqual(result.components.o2c.table.rows,result.components.o2c.chart.rows);
  assert.deepEqual(result.components.o2c.table.rows,result.components.o2c.export.rows);
  assert.deepEqual(result.components.o2c.table.rows,result.components.o2c.drilldown.rows);
  assert.deepEqual(consumer.read(),result,'unchanged shared native state must be idempotent');
  assert.deepEqual(f.combinedRows(),before);
 }finally{f.close();assert.equal(existsSync(f.root),false);}
});

test('actual use-time revoke denies the whole candidate and retains only the prior client version',async()=>{
 const f=await combinedBusinessFixture(sourceRoot);
 try{
  const consumer=await api.createNativeBusinessCompositionV1({sourceRoot,nativeRoot:f.root,asOf,period});
  const prior=consumer.read();assert.equal(prior.stateVersion,1);
  f.revoke();const afterRevoke=f.combinedRows();
  const denied=consumer.read();
  assert.equal(denied.outcome,'DENIED','a failed native component must not activate or leak partial business results');
  assert.match(denied.reasonCode,/STOP_OR_REVOKE_DENIED$/);
  assert.equal(denied.components,null);assert.equal(denied.sharedSnapshot,null);
  assert.equal(denied.stateVersion,prior.stateVersion);
  assert.equal(denied.previousQualifiedHeld,true);
  assert.equal(denied.persistentMutation,false);
  assert.equal(denied.partialSuccess,false);
  assert.deepEqual(f.combinedRows(),afterRevoke);
  assert.equal(prior.components.o2c.facts.onTimeDispatchedQuantity.value,8);
 }finally{f.close();assert.equal(existsSync(f.root),false);}
});

test('a real native change between component reads refuses mixed shared snapshots and keeps the prior generation',async()=>{
 const f=await combinedBusinessFixture(sourceRoot);let barrier;
 try{
  const consumer=await api.createNativeBusinessCompositionV1({sourceRoot,nativeRoot:f.root,asOf:'2026-07-03T23:59:59+02:00',period});
  const prior=consumer.read();
  const {installNativeReadBarrier}=await import('./fixtures/business-bi/ks281-native-read-barrier.mjs');
  barrier=installNativeReadBarrier(sourceRoot,f.root);
  const denied=consumer.read();
  assert.equal(barrier.observation().actualNativeReturnApplied,true);
  assert.equal(denied.outcome,'DENIED','mixed actual native revisions became one active business result');
  assert.equal(denied.reasonCode,'KS281_SHARED_SNAPSHOT_DRIFT_DENIED');
  assert.equal(denied.components,null);assert.equal(denied.sharedSnapshot,null);
  assert.equal(denied.stateVersion,prior.stateVersion);assert.equal(denied.previousQualifiedHeld,true);
  assert.equal(denied.persistentMutation,false);assert.equal(denied.partialSuccess,false);
 }finally{barrier?.close();f.close();assert.equal(existsSync(f.root),false);}
});

test('actual JSON CLI returns the joined native product and denies caller roles without source mutation',async()=>{
 const f=await combinedBusinessFixture(sourceRoot);
 const {spawnSync}=await import('node:child_process');
 const {writeFileSync,mkdtempSync,rmSync}=await import('node:fs');
 const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const owned=mkdtempSync(join(tmpdir(),'ks281-cli-')),file=join(owned,'request.json');
 try{
  const before=f.combinedRows();
  writeFileSync(file,JSON.stringify({sourceRoot,nativeRoot:f.root,asOf,period}),{flag:'wx',mode:0o600});
  const cli=spawnSync(process.execPath,['scripts/run-native-business-composition.mjs','--request-file',file],{encoding:'utf8',timeout:10000});
  assert.equal(cli.status,0,'Missing or failed actual joined-native CLI: '+cli.stderr);
  assert.equal(cli.stderr,'');
  const actual=JSON.parse(cli.stdout);assert.equal(actual.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS');
  assert.equal(actual.components.o2c.facts.onTimeDispatchedQuantity.value,8);
  assert.equal(actual.components.p2p.facts.acceptedQuantity.value,10);
  assert.equal(actual.components.stock.facts.physical.value,2);
  assert.equal(actual.components.o2c.facts.billedNetMinor.state,'UNAVAILABLE');
  writeFileSync(file,JSON.stringify({sourceRoot,nativeRoot:f.root,asOf,period,role:'admin'}));
  const denied=spawnSync(process.execPath,['scripts/run-native-business-composition.mjs','--request-file',file],{encoding:'utf8',timeout:10000});
  assert.equal(denied.status,2);assert.equal(denied.stderr,'');
  const refusal=JSON.parse(denied.stdout);assert.equal(refusal.outcome,'DENIED');assert.equal(refusal.reasonCode,'KS281_INPUT_DENIED');
  assert.equal(refusal.components,null);assert.equal(refusal.persistentMutation,false);
  assert.deepEqual(f.combinedRows(),before);
 }finally{rmSync(owned,{recursive:true,force:true});f.close();assert.equal(existsSync(f.root),false);}
});

test('one live first-wave activation binds real aggregate file-profile mappings and native components without merging their source scopes',async()=>{
 const f=await combinedBusinessFixture(sourceRoot);
 try{
  let waveApi=null;try{waveApi=await import('../services/bi-control/src/business-bi/business-first-wave-v1.mjs');}catch(error){if(error.code!=='ERR_MODULE_NOT_FOUND'||!error.message.includes('business-first-wave-v1.mjs'))throw error;}
  assert.equal(typeof waveApi?.createBusinessFirstWaveConsumerV1,'function','Missing actual first-wave source/profile/analysis/output coordinator');
  const before=f.combinedRows();
  const wave=await waveApi.createBusinessFirstWaveConsumerV1({sourceRoot,nativeRoot:f.root,asOf,period,fileRuntimeRoot:process.env.KS281_DUCKDB_RUNTIME??new URL('../.ks-file-runtime/',import.meta.url).pathname});
  const result=wave.read();
  assert.equal(result.outcome,'READ_COMPLETE_WITH_UNAVAILABLE_FACTS',result.reasonCode);
  assert.equal(result.stateVersion,1);
  assert.equal(result.firstWave.aggregate.numbers.currentNetMinorUnits,100059);
  assert.equal(result.firstWave.aggregate.drilldownPermitted,false);
  assert.deepEqual(result.firstWave.fileProfile.table.rows,[{category:'alpha',sum_units:'11',null_units:1},{category:'beta',sum_units:'5',null_units:0}]);
  assert.equal(result.firstWave.fileProfile.export.sha256,'be03d17b92fdcb375f5bc6f2565985a79e339358685da3e3fb1a3b14a7c3ddf2');
  for(const mapped of Object.values(result.firstWave.knownReferenceMappings))assert.deepEqual(mapped.table.rows,[{month:'2026-06',net_minor:80000,currency:'EUR'},{month:'2026-07',net_minor:10000,currency:'EUR'}]);
  assert.deepEqual(result.firstWave.knownReferenceMappings['common-snake-reference/v1'].table,result.firstWave.knownReferenceMappings['ks-camel-fixture/v1'].table);
  assert.equal(result.firstWave.nativeBusiness.components.o2c.facts.billedNetMinor.state,'UNAVAILABLE','known reference billing must never promote absent native billing');
  assert.equal(result.firstWave.nativeBusiness.components.o2c.facts.onTimeDispatchedQuantity.value,8);
  assert.equal(result.firstWave.nativeBusiness.components.p2p.facts.acceptedQuantity.value,10);
  assert.equal(result.sourceScopeClaim,'MULTIPLE_EXISTING_SYNTHETIC_GRANTS_NOT_ONE_PRODUCTION_SOURCE');
  assert.equal(result.sourceMutationPerformed,false);assert.equal(result.ownedTemporaryArtifactsRemoved,true);
  assert.deepEqual(f.combinedRows(),before);
  assert.deepEqual(wave.read(),result,'unchanged first-wave receipts must retain their qualified client version');
  f.revoke();const afterRevoke=f.combinedRows();
  const denied=wave.read();assert.equal(denied.outcome,'DENIED');
  assert.equal(denied.firstWave,null);assert.equal(denied.partialSuccess,false);
  assert.equal(denied.stateVersion,result.stateVersion);assert.equal(denied.previousQualifiedHeld,true);
  assert.deepEqual(f.combinedRows(),afterRevoke);
 }finally{f.close();assert.equal(existsSync(f.root),false);}
});
