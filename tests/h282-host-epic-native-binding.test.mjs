import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
let qualification;
try { qualification=await import('../scripts/hosting/host-epic-native-receipt.mjs'); }
catch(error) { if(error.code!=='ERR_MODULE_NOT_FOUND') throw error; }
test('H282 standalone child PASS receipts cannot qualify a connected native hosting epic',()=>{
  assert.equal(typeof qualification?.bindHostEpicNativeEvidenceV1,'function','H282 missing fail-closed connected native evidence binder');
  assert.throws(()=>qualification.bindHostEpicNativeEvidenceV1({status:'PASS_ACTUAL_NATIVE_DEVELOPMENT_SCOPE'},
    {tests:19,pass:19,fail:0,skipped:0,cases:[]}),/H282_CONNECTED_NATIVE_FLOW_REQUIRED/);
});

test('H282 ships one connected native runner with actual owner helpers instead of a PASS-file collage',()=>{
 for(const file of ['run-native-host-epic.py','native-host-epic-browser.mjs','native-host-epic-owner.py','host-epic-native-owner-probe.mjs']){
  const url=new URL('../scripts/hosting/'+file,import.meta.url);
  assert.equal(existsSync(fileURLToPath(url)),true,'H282 missing actual connected native runner: '+file);
  assert.ok(readFileSync(url).length>100,'native runner must be executable implementation, not an empty stub');
 }
});

const observed=JSON.parse(readFileSync(new URL('./fixtures/h282-actual-native-development-observation.json',import.meta.url),'utf8'));
test('H282 binder consumes a real observed connected native development trace without granting runtime rights',()=>{
 const result=qualification.bindHostEpicNativeEvidenceV1(observed.native,observed.browser);
 assert.equal(result.state,'BOUND_EVIDENCE_NOT_RUNTIME_AUTHORITY');assert.equal(result.pass,25);assert.equal(result.runtimeActivationGranted,false);
});
test('H282 connected evidence denies mismatched exported and reacquired generations',()=>{
 const changed=structuredClone(observed);changed.browser.hostEpicFlow.reacquiredGenerationId='f'.repeat(64);
 assert.throws(()=>qualification.bindHostEpicNativeEvidenceV1(changed.native,changed.browser),/H282_NATIVE_GENERATION_MISMATCH/);
});

test('H282 connected evidence denies a browser receipt detached from the actual native export origin',()=>{
 const changed=structuredClone(observed);changed.browser.hostEpicFlow.browserOriginReceiptId='detached-receipt';
 assert.throws(()=>qualification.bindHostEpicNativeEvidenceV1(changed.native,changed.browser),/H282_NATIVE_ORIGIN_RECEIPT_MISMATCH/);
});

test('H282 connected evidence refuses a foreign native owner',()=>{
 const changed=structuredClone(observed);changed.browser.hostEpicFlow.owner='foreign-owner';
 assert.throws(()=>qualification.bindHostEpicNativeEvidenceV1(changed.native,changed.browser),/H282_NATIVE_SOURCE_OWNER_MISMATCH/);
});
test('H282 connected evidence refuses a removed native phase',()=>{
 const changed=structuredClone(observed);changed.browser.cases=changed.browser.cases.filter(c=>c.id!=='actual-epic-retained-backup-reacquisition');
 assert.throws(()=>qualification.bindHostEpicNativeEvidenceV1(changed.native,changed.browser),/H282_CONNECTED_NATIVE_PHASE_REQUIRED/);
});
test('H282 connected evidence refuses incomplete owned cleanup',()=>{
 const changed=structuredClone(observed);changed.native.cleanup.remainingOwnedContainers=1;
 assert.throws(()=>qualification.bindHostEpicNativeEvidenceV1(changed.native,changed.browser),/H282_NATIVE_CLEANUP_INCOMPLETE/);
});
test('H282 authored native inputs and public limits are bound in the source map',async()=>{
 const {createHash}=await import('node:crypto');
 const map=JSON.parse(readFileSync(new URL('../SOURCE-MAP.json',import.meta.url),'utf8'));
 for(const file of ['scripts/hosting/run-native-host-epic.py','scripts/hosting/native-host-epic-browser.mjs',
  'scripts/hosting/native-host-epic-owner.py','scripts/hosting/host-epic-native-owner-probe.mjs',
  'scripts/hosting/host-epic-native-budget-request.mjs','scripts/hosting/host-epic-native-receipt.mjs',
  'tests/h282-host-epic-native-binding.test.mjs','tests/h282-host-epic-budget-request.test.mjs',
  'tests/fixtures/h282-actual-native-development-observation.json','docs/hosting/ks282/README.md','scripts/update-h282-source-map.mjs']){
  assert.equal(map.files[file],createHash('sha256').update(readFileSync(new URL('../'+file,import.meta.url))).digest('hex'),file);
 }
});
