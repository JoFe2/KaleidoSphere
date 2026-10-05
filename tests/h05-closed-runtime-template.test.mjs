import test from 'node:test';
import assert from 'node:assert/strict';
import { loadH01PanRuntimeSourceV1,releaseH01PanRuntimeSourceV1 } from '../services/bi-control/src/runtime/pan-runtime-source.mjs';
import { captureH01LocalRuntimeContextV1 } from '../services/bi-control/src/runtime/local-runtime-context.mjs';
import { loadH05SharedRuntimeSourceV1,getH05SharedRuntimeApisV1,releaseH05SharedRuntimeSourceV1 } from '../services/bi-control/src/runtime/h05-shared-runtime-source.mjs';
import { mkdtempSync,rmSync,existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createH05NativeBrokerRuntimeV1 } from '../services/bi-control/src/runtime/h05-native-broker-runtime.mjs';
const mod=await import('../services/bi-control/src/runtime/h05-closed-runtime-template.mjs').catch(()=>({}));
// These identity/readback/image fields are explicit SHAPE_ONLY unit fixtures,
// not current native observations, qualification, activation or source rights.
const identity = () => ({ schemaVersion: 'pansphaira.portable-runtime/identity/v1',
  componentId: 'kaleidosphere-bi-agent', sourceCommit: 'dfc7f2ae2399109b90fe8a101f2d4eed465a7cef',
  sourceTree: 'ff9949615ec27bb37d848b0b01ca41d55f6994b7', imageDigest: 'sha256:' + 'a'.repeat(64),
  architecture: 'x86_64', productVersion: '0.18.1', runtime: { name: 'node', version: '24.14.0' },
  contractVersion: '1.0.0', instanceId: 'ks-unit-only', tenantId: 'synthetic-unit-only', generation: 1,
  authorityProfile: 'SAFE_GUIDED', effectiveRights: ['bi.catalog.read'],
  configurationDigest: 'b'.repeat(64), templateDigest: 'c'.repeat(64),
  policyDigest: 'd'.repeat(64), networkDigest: 'e'.repeat(64) });
const unitReply = () => ({httpStatus: 200, body: {
  schemaVersion: 'chimpmaera.bi/readback/v1', generationId: 'a'.repeat(64),
  summary: {source_engine: 'mssql', source_database: 'CM_BI_FIXTURE', source_mode: 'fixture',
    runtime_validation: 'SYNTHETIC_UNVALIDATED', status: 'ANALYZED_READ_ONLY', source_read_only: 1,
    relation_count: 2, column_count: 3, constraint_count: 1, index_count: 1},
  detailCount: 3, catalogSnapshot: {snapshot_sha256: '293a896156d8f6269c4ad33e8d632da653ea180d35a4ea5f390b0be52ce3e44a'},
  technicalOverview: {systemSchemaRows: 1, tableCapacityRows: 2, codeDependencyRows: 0, coverageRows: 9, biCandidateRows: 2},
  publication: {datasets: 6, charts: 13, dashboards: 5},
  projectionMirror: {state: 'IN_SYNC', inSync: true}
}});
const unitPins = () => Object.fromEntries(['superset-init', 'superset', 'bi-control', 'bi-agent'].map(role => [role, 'sha256:' + 'a'.repeat(64)]));
const unitImages = () => Object.entries(unitPins()).map(([component, imageId]) => ({ component, imageId }));
const spec = () => ({ expectedIdentity: identity(), qualifiedReadback: unitReply(),
  heldGenerationId: 'a'.repeat(64), imagePins: unitPins(),
  secretReferences: [{ slot: 'control-auth', referenceId: 'opaque:' + '7'.repeat(32) }] });
const actualInput = () => ({ observedIdentity: identity(), readback: unitReply(), imageObservations: unitImages(),
  boundaryObservation: { loopbackOnly: true, privileged: false, dockerSocketMounted: false, ownedResourcesOnly: true },
  observedAtMs: 1791130000000 });


test('H05 plans the unchanged shared closed template from an opaque captured H01 owner context, with no activation',async()=>{
  assert.equal(typeof mod.captureH05ServerRuntimeTemplateV1,'function','missing actual shared-template KS owner adapter');
  const legacy=await loadH01PanRuntimeSourceV1(process.env.KS292_PAN526_SOURCE);
  const shared=await loadH05SharedRuntimeSourceV1({optIn:true,sourceRoot:process.env.KS_H05_PAN_SOURCE_ROOT});
  try{
    const owner=captureH01LocalRuntimeContextV1(legacy,spec());
    const held=mod.captureH05ServerRuntimeTemplateV1(shared,owner);
    const template=mod.readH05ServerRuntimeTemplateV1(held);
    const api=getH05SharedRuntimeApisV1(shared);
    assert.deepEqual(template,api.templates.bindRuntimeTemplateV1(identity()));
    const command={schemaVersion:api.templates.RUNTIME_TEMPLATE_PLAN_REQUEST_SCHEMA_V1,
      operationId:'operation:ks-template-plan-001',componentId:template.identity.componentId,
      templateId:template.templateId,identityDigest:template.identityDigest,runtimeTemplateDigest:template.runtimeTemplateDigest};
    const plan=mod.planH05ClosedRuntimeTemplateV1(held,command,null);
    assert.deepEqual(plan,api.templates.planRuntimeTemplateV1(command,identity(),null));
    assert.equal(plan.planOnly,true);assert.equal(plan.activationAuthorized,false);
    assert.deepEqual(plan.diff.effectiveRights,identity().effectiveRights);
    assert.equal(plan.diff.policyDigest,identity().policyDigest);assert.equal(plan.diff.networkDigest,identity().networkDigest);
    assert.match(plan.humanReadableDiff,/Plan only: no activation, budget reservation, dispatch or rights grant/);
    for(const extra of [{freeCommand:'arbitrary'},{url:'http://127.0.0.1:1/'},{sql:'SELECT arbitrary'},
      {rights:['bi.catalog.read','bi.write']},{policyDigest:'f'.repeat(64)},{activationAuthorized:true}])
      assert.throws(()=>mod.planH05ClosedRuntimeTemplateV1(held,{...command,...extra},null),/RUNTIME_TEMPLATE_PLAN_DENIED/);
    const changedComponent={...command,componentId:'unknown-component'};
    assert.throws(()=>mod.planH05ClosedRuntimeTemplateV1(held,changedComponent,null),/RUNTIME_TEMPLATE_PLAN_DENIED/);
    assert.throws(()=>mod.captureH05ServerRuntimeTemplateV1(shared,{...owner}),/H01_LOCAL_CONTEXT_DENIED/);
    assert.throws(()=>mod.readH05ServerRuntimeTemplateV1({...held}),/H05_TEMPLATE_CONTEXT_DENIED/);
    const stateRoot=mkdtempSync(join(tmpdir(),'ks295-bound-template-resource-'));
    let bound;
    try{
      const opts={optIn:true,stateRoot,baseUrl:'http://127.0.0.1:12345/v1',limits:{modelUnits:64,runtimeUnits:1}};
      assert.throws(()=>createH05NativeBrokerRuntimeV1(shared,opts,{...held}),/H05_TEMPLATE_CONTEXT_DENIED/);
      assert.equal(existsSync(join(stateRoot,'ks295-resource-budget.sqlite')),false,'untrusted template must fail before DB creation');
      assert.throws(()=>createH05NativeBrokerRuntimeV1(shared,{...opts,limits:{modelUnits:64,runtimeUnits:33}},held),/H05_TEMPLATE_RESOURCE_CLASS_DENIED/);
      bound=createH05NativeBrokerRuntimeV1(shared,opts,held);
      assert.equal(bound.snapshot().reservations,0);
      const seed=api.broker.syntheticCanonicalModelRequestV1();
      const oversized={...seed,attachments:[],tools:[],operationId:'operation:bound-class-denial',
        budget:{...seed.budget,maxTokens:template.resourceClass.maxTokens+1}};
      assert.deepEqual((await bound.invoke(oversized)).issues,['H05_TEMPLATE_RESOURCE_CLASS_DENIED']);
      assert.equal(bound.snapshot().reservations,0,'class denial cannot reserve or dispatch');
    }finally{bound?.close();rmSync(stateRoot,{recursive:true,force:true});}
    assert.equal(Object.hasOwn(mod,'activateRuntime'),false);
    assert.equal(Object.hasOwn(mod,'ownerCompletionEvidence'),false);
  }finally{releaseH05SharedRuntimeSourceV1(shared);releaseH01PanRuntimeSourceV1(legacy);}
});
