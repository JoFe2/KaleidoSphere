import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createBrowserContextOwnerV1} from '../contracts/dependencies/pan541-browser-shell-v1/runtime/packages/browser-shell/src/context-owner-v1.js';
import {createBrowserShellRegistryV1} from '../contracts/dependencies/pan541-browser-shell-v1/runtime/packages/browser-shell/src/registry-v1.js';
import {buildBrowserDeepLinkV1,parseBrowserDeepLinkV1} from '../contracts/dependencies/pan541-browser-shell-v1/runtime/packages/browser-shell/src/deep-link-v1.js';
const subjectURL=new URL('../services/bi-control/src/assistant-foundation/pan541-ui-state-consumer-v1.mjs',import.meta.url);
const context=()=>({schemaVersion:'pansphaira.browser-context/v1',tenantId:'tenant-local',sessionId:'session-local',objectId:'ks-existing-ui',revision:7});
const manifest=()=>({schemaVersion:'chimpmaera.bi/dashboard-capability-manifest/v1',dashboardId:'ks-existing-ui',stateVersion:1,allowedActions:['select_tab','explain_current_view'],resources:{chartIds:[],filterKeys:[],tabIds:['table','details'],seriesIds:[],dimensions:[],segmentIds:[],tableColumns:[]},persistentMutationAllowed:false,directDomControl:false});
const request=(version=1)=>({schemaVersion:'chimpmaera.bi/ui-action/v1',actionId:'local-select',idempotencyKey:'local-select-1',action:'select_tab',args:{tabId:'details'},stateVersion:version,preconditions:{dashboardId:'ks-existing-ui'}});
async function fixture(overrides={}) {
  const module=await import(subjectURL);
  assert.equal(typeof module.createPan541UIStateConsumerV1,'function','missing concrete thin existing-UIState binding');
  const owner=createBrowserContextOwnerV1({initialContext:context(),readBackend:async()=>({status:403,value:null})});
  const authorizations=[];const views=[];const panels=[];const faults=[];
  const consumer=module.createPan541UIStateConsumerV1({contextOwner:owner,manifest:manifest(),authorizeSession:async(c,operation)=>{authorizations.push({context:c,operation});return true;},renderView:({target,presentation})=>{views.push(presentation);target.presentation=presentation;},renderPanel:({target,presentation})=>{panels.push(presentation);target.presentation=presentation;},...overrides});
  const registry=createBrowserShellRegistryV1({factories:consumer.factories,reportFault:fault=>faults.push(fault)});
  return {module,owner,consumer,registry,views,panels,faults,authorizations};
}
test('existing KS UIState thin consumer renders via actual published PAN541 registry and stays reversible-session-only',async()=>{
  const f=await fixture();try {
    const registered=f.registry.register(f.consumer.descriptor);assert.equal(registered.outcome,'REGISTERED');assert.deepEqual(registered.grantedRights,[]);
    const result=await f.registry.render('ks.session-state.view',{});assert.equal(result.outcome,'RENDERED');
    assert.equal(f.views[0].outcome,'SESSION_VIEW');assert.equal(f.views[0].state.version,1);assert.equal(f.views[0].binding.context.revision,7);
    const action=await f.consumer.applySession(request());assert.equal(action.status,'applied');assert.equal(action.persistentSupersetMutation,false);assert.equal(action.sideEffect,'reversible_session');
    assert.equal(f.consumer.readSession().tab,'details');assert.equal(f.consumer.readSession().version,2);
    const panel=await f.registry.render('ks.session-state.panel',{});assert.equal(panel.outcome,'RENDERED');assert.equal(f.panels[0].state.tab,'details');
    const undone=await f.consumer.undoSession(action.undoToken,2);assert.equal(undone.status,'undone');assert.equal(f.consumer.readSession().tab,null);
    assert.deepEqual(f.authorizations.map(x=>x.operation),['OPEN_VIEW','APPLY_SESSION','OPEN_PANEL','UNDO_SESSION']);
    assert.equal(f.consumer.binding().PAN549ResultCapability,false);assert.equal(f.consumer.binding().dataResultRevision,null);
  } finally {f.consumer.close();f.registry.close();f.owner.close();}
});

test('consumer is object-bound and retires its state on actual PAN context change without closing another module',async()=>{
  const f=await fixture();try {
    f.registry.register(f.consumer.descriptor);
    await f.consumer.applySession(request());
    const other={...structuredClone(f.consumer.descriptor),id:'ks.other-state',contributions:f.consumer.descriptor.contributions.map(c=>({...c,id:c.id.replace('ks.session-state','ks.other-state'),routeId:c.routeId.replace('ks.session-state','ks.other-state'),path:c.path===null?null:'/workspace/other-state'}))};
    assert.equal(f.registry.register(other).outcome,'REGISTERED');
    f.owner.switchContext({...context(),sessionId:'session-next',revision:8});
    assert.throws(()=>f.consumer.readSession(),/KS303_CONSUMER_CLOSED/);
    assert.equal(f.registry.status('ks.other-state').outcome,'REGISTERED');
    await assert.rejects(f.consumer.applySession(request(2)),/KS303_CONSUMER_CLOSED/);
  } finally {f.consumer.close();f.registry.close();f.owner.close();}
  const badOwner=createBrowserContextOwnerV1({initialContext:{...context(),objectId:'foreign-object'},readBackend:async()=>({status:200,value:null})});
  try {const module=await import(subjectURL);assert.throws(()=>module.createPan541UIStateConsumerV1({contextOwner:badOwner,manifest:manifest(),authorizeSession:async()=>true,renderView:()=>{},renderPanel:()=>{}}),/KS303_CONTEXT_OBJECT_DENIED/);} finally {badOwner.close();}
});

test('async authorization cannot observe a caller-mutated action in place of the captured session request',async()=>{
  let release;let observed;const gate=new Promise(resolve=>{release=resolve;});
  const f=await fixture({authorizeSession:async()=>{observed=true;return gate;}});
  try {const original=request();const pending=f.consumer.applySession(original);assert.equal(observed,true);original.args.tabId='table';release(true);const result=await pending;assert.equal(result.status,'applied');assert.equal(f.consumer.readSession().tab,'details');}
  finally {f.consumer.close();f.registry.close();f.owner.close();}
});

test('closed owner options and data-only requests reject arbitrary URL metadata or accessors without invoking them',async()=>{
  const module=await import(subjectURL);const owner=createBrowserContextOwnerV1({initialContext:context(),readBackend:async()=>({status:403,value:null})});let getters=0;
  const options={contextOwner:owner,manifest:manifest(),authorizeSession:async()=>true,renderView:()=>{},renderPanel:()=>{}};
  try {assert.throws(()=>module.createPan541UIStateConsumerV1({...options,iframeUrl:'https://untrusted.invalid/'}),/KS303_OPTIONS_DENIED/);}
  finally {owner.close();}
  const f=await fixture();try {
    const bad=request();Object.defineProperty(bad.args,'tabId',{enumerable:true,get(){getters++;return 'details';}});
    const result=await f.consumer.applySession(bad);assert.equal(result.status,'denied');assert.equal(result.denialReason,'KS303_SESSION_REQUEST_DENIED');assert.equal(getters,0);assert.equal(f.consumer.readSession().version,1);
    const extra=await f.consumer.applySession({...request(),iframeUrl:'https://untrusted.invalid/'});assert.equal(extra.status,'denied');assert.equal(f.authorizations.length,0);
  } finally {f.consumer.close();f.registry.close();f.owner.close();}
});

test('trusted authorization callback is captured at construction, never changed by later options metadata',async()=>{
  const module=await import(subjectURL);const owner=createBrowserContextOwnerV1({initialContext:context(),readBackend:async()=>({status:403,value:null})});
  const options={contextOwner:owner,manifest:manifest(),authorizeSession:async()=>false,renderView:()=>{},renderPanel:()=>{}};const consumer=module.createPan541UIStateConsumerV1(options);
  try {options.authorizeSession=async()=>true;const result=await consumer.applySession(request());assert.equal(result.status,'denied');assert.equal(consumer.readSession().version,1);}
  finally {consumer.close();owner.close();}
});

test('exposed source identity is immutable and cannot poison later context bindings',async()=>{
  const f=await fixture();try {const identity=f.consumer.binding();const expected=identity.consumerSource.sha256;assert.throws(()=>{identity.consumerSource.sha256='0'.repeat(64);},TypeError);assert.equal(f.consumer.binding().consumerSource.sha256,expected);assert.deepEqual(identity.grantedRights,[]);assert.equal(identity.dataResultRevision,null);assert.equal(identity.PAN549ResultCapability,false);}
  finally {f.consumer.close();f.registry.close();f.owner.close();}
});

test('typed session deep links use UIState version separately from shell-context revision and deny wrong object/source route',async()=>{
  const f=await fixture();try {
    assert.equal(typeof f.consumer.sessionDeepLink,'function','session deep-link binding absent');
    const link=f.consumer.sessionDeepLink();const value=f.consumer.acceptSessionDeepLink(link);assert.equal(value.revision,1);assert.equal(f.consumer.binding().context.revision,7);
    assert.throws(()=>f.consumer.acceptSessionDeepLink(link.replace('ks-existing-ui','foreign-object')),/KS303_SESSION_LINK_DENIED/);
    assert.throws(()=>f.consumer.acceptSessionDeepLink(link.replace('tenant-local','tenant-foreign')),/DEEP_LINK_DENIED/);
    assert.throws(()=>f.consumer.acceptSessionDeepLink(link.replace('revision=1','revision=7')),/KS303_SESSION_LINK_DENIED/);
    assert.throws(()=>f.consumer.acceptSessionDeepLink('https://untrusted.invalid/'),/DEEP_LINK_DENIED/);
    const action=await f.consumer.applySession(request());assert.equal(action.status,'applied');assert.throws(()=>f.consumer.acceptSessionDeepLink(link),/KS303_SESSION_LINK_DENIED/);assert.equal(f.consumer.acceptSessionDeepLink(f.consumer.sessionDeepLink()).revision,2);
  } finally {f.consumer.close();f.registry.close();f.owner.close();}
});

test('session action requires an exact declared dashboard precondition, not optional ambient scope',async()=>{
  const f=await fixture();try {for(const preconditions of [{},{dashboardId:'foreign-dashboard'},{dashboardId:'ks-existing-ui',tenantId:'spoofed'}]){const result=await f.consumer.applySession({...request(),preconditions});assert.equal(result.status,'denied');assert.equal(result.denialReason,'KS303_SESSION_REQUEST_DENIED');}assert.equal(f.consumer.readSession().version,1);assert.equal(f.authorizations.length,0);}
  finally {f.consumer.close();f.registry.close();f.owner.close();}
});

test('every view/panel/apply/undo use rechecks owner authorization and denial keeps state unchanged',async()=>{
  let permitted=true;const f=await fixture({authorizeSession:async()=>permitted});try {
    f.registry.register(f.consumer.descriptor);const action=await f.consumer.applySession(request());permitted=false;
    assert.equal((await f.registry.render('ks.session-state.view',{})).outcome,'RENDERED');assert.equal(f.views[0].outcome,'DENIED');assert.equal(f.views[0].state,null);
    await f.registry.render('ks.session-state.panel',{});assert.equal(f.panels[0].outcome,'DENIED');
    assert.equal((await f.consumer.applySession({...request(2),actionId:'next',idempotencyKey:'next'})).status,'denied');assert.equal((await f.consumer.undoSession(action.undoToken,2)).status,'denied');assert.equal(f.consumer.readSession().version,2);assert.equal(f.consumer.readSession().tab,'details');
  } finally {f.consumer.close();f.registry.close();f.owner.close();}
});
test('late authorization after context retirement cannot revive old session state',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const f=await fixture({authorizeSession:async()=>gate});
  try {const pending=f.consumer.applySession(request());f.owner.switchContext({...context(),revision:8});release(true);assert.equal((await pending).status,'denied');assert.throws(()=>f.consumer.binding(),/KS303_CONSUMER_CLOSED/);}
  finally {f.consumer.close();f.registry.close();f.owner.close();}
});
test('actual PAN render lifetime abort discards a late owner authorization before view callback',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const f=await fixture({authorizeSession:async()=>gate});
  try {f.registry.register(f.consumer.descriptor);const pending=f.registry.render('ks.session-state.view',{});f.registry.retireAll();release(true);assert.equal((await pending).outcome,'STALE_RENDER');assert.equal(f.views.length,0);}
  finally {f.consumer.close();f.registry.close();f.owner.close();}
});
test('authorization failure or expiry produces no local apply and no partial success',async()=>{
  for(const authorizeSession of [async()=>false,async()=>{throw new Error('expired-session');}]){const f=await fixture({authorizeSession});try {const result=await f.consumer.applySession(request());assert.equal(result.status,'denied');assert.equal(result.sideEffect,'none');assert.equal(result.persistentSupersetMutation,false);assert.equal(f.consumer.readSession().version,1);}finally {f.consumer.close();f.registry.close();f.owner.close();}}
});
test('stale/replayed/different-idempotency actions retain existing adapter guarantees',async()=>{
  const f=await fixture();try {const first=await f.consumer.applySession(request());assert.equal(first.status,'applied');assert.equal((await f.consumer.applySession(request())).status,'already_applied');const altered={...request(),args:{tabId:'table'}};assert.equal((await f.consumer.applySession(altered)).denialReason,'UI_ACTION_IDEMPOTENCY_MISMATCH');const stale={...request(),actionId:'stale',idempotencyKey:'stale'};assert.equal((await f.consumer.applySession(stale)).denialReason,'DASHBOARD_STATE_STALE');assert.equal(f.consumer.readSession().tab,'details');}
  finally {f.consumer.close();f.registry.close();f.owner.close();}
});
test('persistent mutation/direct DOM permission cannot be enabled through a consumer manifest',async()=>{
  for(const forbidden of [{persistentMutationAllowed:true},{directDomControl:true}]){await assert.rejects(fixture({manifest:{...manifest(),...forbidden}}),/DASHBOARD_MUTATION_BOUNDARY_INVALID/);}
  const f=await fixture();try {const result=await f.consumer.applySession({...request(),action:'persist_dashboard'});assert.equal(result.status,'denied');assert.equal(result.denialReason,'UI_ACTION_UNSAFE');assert.equal(f.consumer.readSession().version,1);}finally {f.consumer.close();f.registry.close();f.owner.close();}
});
test('a failed trusted KS renderer leaves actual registry and independent other-module rendering usable',async()=>{
  const f=await fixture({renderView:()=>{throw new Error('owned-renderer-fault');}});
  const factories=new Map([...f.consumer.factories,['ks.unaffected.view',{kind:'VIEW',render:({target})=>{target.ready=true;}}]]);
  const registry=createBrowserShellRegistryV1({factories,reportFault:x=>f.faults.push(x)});
  const other={schemaVersion:'pansphaira.browser-plugin/v1',id:'ks.unaffected',version:'1.0.0',shellVersion:'1.0.0',enabled:true,trustBoundary:'TRUSTED_IN_PROCESS_CODE_OWNED_FACTORIES',needs:{data:[],context:[],rights:[],dependencies:[]},contributions:[{id:'ks.unaffected.route',kind:'ROUTE',slot:'shell.routes',factoryId:null,routeId:'ks.unaffected.route',path:'/workspace/unaffected',label:'Weiterhin bedienbares Modul'},{id:'ks.unaffected.view',kind:'VIEW',slot:'shell.main',factoryId:'ks.unaffected.view',routeId:'ks.unaffected.route',path:null,label:'Weiterhin bedienbare Ansicht'}]};
  try {assert.equal(registry.register(f.consumer.descriptor).outcome,'REGISTERED');assert.equal(registry.register(other).outcome,'REGISTERED');assert.equal((await registry.render('ks.session-state.view',{})).outcome,'RENDER_FAILED');const target={};assert.equal((await registry.render('ks.unaffected.view',target)).outcome,'RENDERED');assert.equal(target.ready,true);assert.equal(f.faults[0].reason,'OWNED_RENDERER_FAILED');}
  finally {f.consumer.close();registry.close();f.registry.close();f.owner.close();}
});
test('all public source and compiled pins match their exact package files and existing KS consumer is unchanged',()=>{
  const root=new URL('../contracts/dependencies/pan541-browser-shell-v1/',import.meta.url);const binding=JSON.parse(readFileSync(new URL('binding.json',root),'utf8'));
  assert.equal(binding.producerCommit,'6153161c3d9510bab305a28a20c7099dbba6a7ff');assert.equal(binding.producerTree,'1a63a35acd9c3fee0b7a9cba1a335cdd177adaa6');
  for(const [path,digest] of Object.entries(binding.upstreamSourceSha256))assert.equal(createHash('sha256').update(readFileSync(new URL('source/'+path,root))).digest('hex'),digest);
  for(const [path,digest] of Object.entries(binding.compiledRuntimeSha256))assert.equal(createHash('sha256').update(readFileSync(new URL('runtime/'+path,root))).digest('hex'),digest);
  assert.equal(createHash('sha256').update(readFileSync(new URL('../'+binding.KSExistingConsumer.entry,import.meta.url))).digest('hex'),binding.KSExistingConsumer.sha256);assert.equal(binding.PAN549ResultCapabilityIncluded,false);assert.equal(binding.whole303CompositionQualified,false);
});
