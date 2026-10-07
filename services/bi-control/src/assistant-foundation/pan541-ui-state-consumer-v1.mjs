// Thin existing-KS UIState binding, not an analysis renderer or backend grant.
import {types} from 'node:util';
import {InMemoryDashboardStateAdapter,assertDashboardCapabilityManifest} from './ui-state-adapter.mjs';
import sourceBinding from '../../../../contracts/dependencies/pan541-browser-shell-v1/binding.json' with {type:'json'};
import {validateBrowserShellPluginV1} from '../../../../contracts/dependencies/pan541-browser-shell-v1/runtime/packages/contracts/src/browser-shell-plugin-v1.js';

import {buildBrowserDeepLinkV1,parseBrowserDeepLinkV1} from '../../../../contracts/dependencies/pan541-browser-shell-v1/runtime/packages/browser-shell/src/deep-link-v1.js';

export const KS303_SESSION_CONSUMER_SCHEMA_V1='kaleidosphere/pan541-ui-state-consumer/v1';
const ids={view:'ks.session-state.view',panel:'ks.session-state.panel'};
const denied=()=>({status:'denied',denialReason:'KS303_SESSION_AUTHORIZATION_DENIED',sideEffect:'none',persistentSupersetMutation:false});

function dataRecord(value,required,optional=[]) {
  if(!value||typeof value!=='object'||types.isProxy(value)||Object.getPrototypeOf(value)!==Object.prototype)return false;
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  return required.every(key=>Object.hasOwn(fields,key))&&keys.every(key=>typeof key==='string'&&[...required,...optional].includes(key)&&fields[key].enumerable&&'value' in fields[key]);
}
function captureData(value) {
  let nodes=0;
  function inspect(v,depth) {
    if(++nodes>1024||depth>12)throw new Error('KS303_SESSION_REQUEST_DENIED');
    if(v===null||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v))return;
    if(typeof v==='string'&&v.length<=4096)return;
    if(!v||typeof v!=='object'||types.isProxy(v))throw new Error('KS303_SESSION_REQUEST_DENIED');
    const fields=Object.getOwnPropertyDescriptors(v),keys=Reflect.ownKeys(fields);
    if(Array.isArray(v)) {
      if(Object.getPrototypeOf(v)!==Array.prototype||v.length>64||keys.length!==v.length+1)throw new Error('KS303_SESSION_REQUEST_DENIED');
      for(let i=0;i<v.length;i++){const d=fields[String(i)];if(!d||!d.enumerable||!('value' in d))throw new Error('KS303_SESSION_REQUEST_DENIED');inspect(d.value,depth+1);}
    } else {
      if(Object.getPrototypeOf(v)!==Object.prototype||keys.some(key=>typeof key!=='string'||!fields[key].enumerable||!('value' in fields[key])))throw new Error('KS303_SESSION_REQUEST_DENIED');
      for(const d of Object.values(fields))inspect(d.value,depth+1);
    }
  }
  inspect(value,0);return structuredClone(value);
}

// authorizeSession is trusted owner code, never descriptor/request metadata.
// Its boolean qualifies only this reversible client session, not any backend effect.
export function createPan541UIStateConsumerV1(options) {
  if(!dataRecord(options,['contextOwner','manifest','authorizeSession','renderView','renderPanel'])||['authorizeSession','renderView','renderPanel'].some(key=>typeof options[key]!=='function')||!options.contextOwner||['context','onDispose'].some(key=>typeof options.contextOwner[key]!=='function'))throw new Error('KS303_OPTIONS_DENIED');
  const {authorizeSession,renderView,renderPanel}=options;
  const ownedManifest=captureData(options.manifest);
  assertDashboardCapabilityManifest(ownedManifest);
  const owner=options.contextOwner;
  if(owner.context().objectId!==ownedManifest.dashboardId)throw new Error('KS303_CONTEXT_OBJECT_DENIED');
  let adapter=new InMemoryDashboardStateAdapter(ownedManifest);
  let closed=false;
  const lifetime=new AbortController();
  let unsubscribe=()=>{};
  function close(){if(closed)return;closed=true;lifetime.abort();adapter=null;unsubscribe();}
  unsubscribe=owner.onDispose(close);
  const ensureActive=()=>{if(closed)throw new Error('KS303_CONSUMER_CLOSED');};
  const descriptor={schemaVersion:'pansphaira.browser-plugin/v1',id:'ks.session-state',version:'1.0.0',shellVersion:'1.0.0',enabled:true,trustBoundary:'TRUSTED_IN_PROCESS_CODE_OWNED_FACTORIES',needs:{data:['ks.session-state'],context:['tenantId','sessionId','objectId','revision'],rights:[],dependencies:[]},contributions:[
    {id:'ks.session-state.route',kind:'ROUTE',slot:'shell.routes',factoryId:null,routeId:'ks.session-state.route',path:'/workspace/ks-session-state',label:'Vorhandene KS-Sessionansicht — keine persistente Änderung'},
    {id:ids.view,kind:'VIEW',slot:'shell.main',factoryId:ids.view,routeId:'ks.session-state.route',path:null,label:'KS-Sessionansicht'},
    {id:ids.panel,kind:'PANEL',slot:'shell.panels',factoryId:ids.panel,routeId:'ks.session-state.route',path:null,label:'Kontext und reversible Sessionänderung'},
  ]};
  const validated=validateBrowserShellPluginV1(descriptor,new Set(Object.values(ids)));
  if(validated.outcome!=='DESCRIPTOR_VALID')throw new Error('KS303_DESCRIPTOR_BINDING_DENIED');
  function binding() {
    ensureActive();return Object.freeze({schemaVersion:KS303_SESSION_CONSUMER_SCHEMA_V1,context:owner.context(),sessionStateVersion:adapter.read().version,consumerContract:'chimpmaera.bi/ui-action/v1',consumerSource:Object.freeze({...sourceBinding.KSExistingConsumer}),producerCommit:sourceBinding.producerCommit,producerTree:sourceBinding.producerTree,producerContractSha256:sourceBinding.upstreamSourceSha256['packages/contracts/src/browser-shell-plugin-v1.ts'],dataResultRevision:null,PAN549ResultCapability:false,grantedRights:Object.freeze([]),persistentMutationAuthority:false});
  }
  async function authorize(operation,signal=lifetime.signal) {
    ensureActive();const context=owner.context();
    try {const allowed=await authorizeSession(context,operation,signal);return allowed===true&&!closed&&!signal.aborted&&owner.context()===context;}
    catch {return false;}
  }
  const factory=(kind,operation,render)=>({kind,async render(frame){
    const allowed=await authorize(operation,frame.signal);
    if(frame.signal.aborted||closed)return;
    const presentation=allowed?{outcome:'SESSION_VIEW',binding:binding(),state:adapter.read(),persistentSupersetMutation:false,analysisResult:null}:{outcome:'DENIED',binding:null,state:null,persistentSupersetMutation:false,analysisResult:null};
    return render({target:frame.target,signal:frame.signal,presentation});
  }});
  return Object.freeze({
    descriptor:validated.descriptor,
    factories:new Map([[ids.view,factory('VIEW','OPEN_VIEW',renderView)],[ids.panel,factory('PANEL','OPEN_PANEL',renderPanel)]]),
    binding,
    sessionDeepLink(){ensureActive();const context=owner.context();return buildBrowserDeepLinkV1({path:'/workspace/ks-session-state',tenantId:context.tenantId,sessionId:context.sessionId,objectId:context.objectId,revision:adapter.read().version});},
    acceptSessionDeepLink(hash){ensureActive();const context=owner.context();const parsed=parseBrowserDeepLinkV1(hash,context,['/workspace/ks-session-state']);if(parsed.objectId!==context.objectId||parsed.revision!==adapter.read().version)throw new Error('KS303_SESSION_LINK_DENIED');return parsed;},
    readSession(){ensureActive();return adapter.read();},
    async applySession(request){
      ensureActive();let captured;
      try {if(!dataRecord(request,['schemaVersion','actionId','idempotencyKey','action','args','stateVersion','preconditions']))throw new Error('KS303_SESSION_REQUEST_DENIED');captured=captureData(request);if(!dataRecord(captured.preconditions,['dashboardId'])||captured.preconditions.dashboardId!==ownedManifest.dashboardId)throw new Error('KS303_SESSION_REQUEST_DENIED');}
      catch {return {...denied(),denialReason:'KS303_SESSION_REQUEST_DENIED'};}
      if(!await authorize('APPLY_SESSION'))return denied();return adapter.attempt(captured);
    },
    async undoSession(token,version){if(!await authorize('UNDO_SESSION'))return denied();return adapter.undo(token,version);},
    close,
  });
}
