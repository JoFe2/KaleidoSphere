import test from 'node:test';
import assert from 'node:assert/strict';
let builder;
try{builder=await import('../scripts/hosting/host-epic-native-budget-request.mjs');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('H282 local synthetic two-dispatch scenario uses the unchanged held template caps, not the one-request seed default',()=>{
 assert.equal(typeof builder?.buildHostEpicNativeBudgetRequestV1,'function','actual owner request builder missing');
 const seed={budget:{maxInputBytes:8192,maxOutputBytes:8192,maxTokens:512,maxCostMicros:1000,maxRequests:1,timeoutMs:2000},attachments:['unused'],tools:['unused'],operationId:'operation:seed',correlationId:'correlation:seed'};
 const template={resourceClass:{maxInputBytes:4096,maxOutputBytes:8192,maxTokens:32,maxRequests:32,timeoutMs:20000}};
 const before=structuredClone({seed,template});const request=builder.buildHostEpicNativeBudgetRequestV1(seed,template);
 assert.equal(request.budget.maxRequests,2);
 for(const key of ['maxInputBytes','maxOutputBytes','maxTokens','maxRequests','timeoutMs'])assert.ok(request.budget[key]<=template.resourceClass[key],key);
 assert.equal(request.budget.timeoutMs,2000);assert.equal(request.budget.maxTokens,32);assert.equal(request.budget.maxCostMicros,1000);
 assert.deepEqual(request.attachments,[]);assert.deepEqual(request.tools,[]);
 assert.equal(request.operationId,'operation:epic282-native-model-001');assert.equal(request.correlationId,'correlation:epic282-native-model-001');
 assert.deepEqual({seed,template},before);
});
