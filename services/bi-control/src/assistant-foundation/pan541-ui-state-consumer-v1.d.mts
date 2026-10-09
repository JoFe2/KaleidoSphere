import type {BrowserContextV1,createBrowserContextOwnerV1} from '../../../../contracts/dependencies/pan541-browser-shell-v1/source/packages/browser-shell/src/context-owner-v1.js';
import type {BrowserShellFactoryV1} from '../../../../contracts/dependencies/pan541-browser-shell-v1/source/packages/browser-shell/src/registry-v1.js';
import type {BrowserShellPluginV1} from '../../../../contracts/dependencies/pan541-browser-shell-v1/source/packages/contracts/src/browser-shell-plugin-v1.js';
import type {BrowserDeepLinkV1} from '../../../../contracts/dependencies/pan541-browser-shell-v1/source/packages/browser-shell/src/deep-link-v1.js';
export const KS303_SESSION_CONSUMER_SCHEMA_V1:'kaleidosphere/pan541-ui-state-consumer/v1';
export type KS303SessionOperation='OPEN_VIEW'|'OPEN_PANEL'|'APPLY_SESSION'|'UNDO_SESSION';
export interface KS303ExistingManifestV1 {
  readonly schemaVersion:'chimpmaera.bi/dashboard-capability-manifest/v1';
  readonly dashboardId:string;
  readonly stateVersion:number;
  readonly allowedActions:readonly string[];
  readonly resources:Readonly<Record<'chartIds'|'filterKeys'|'tabIds'|'seriesIds'|'dimensions'|'segmentIds'|'tableColumns',readonly string[]>>;
  readonly persistentMutationAllowed:false;
  readonly directDomControl:false;
}
export type KS303SessionStateV1=Readonly<Record<string,unknown>> & {readonly version:number;readonly tab:string|null};
export interface KS303SessionBindingV1 {
  readonly schemaVersion:typeof KS303_SESSION_CONSUMER_SCHEMA_V1;
  readonly context:BrowserContextV1;
  readonly sessionStateVersion:number;
  readonly consumerContract:'chimpmaera.bi/ui-action/v1';
  readonly consumerSource:{readonly entry:string;readonly sha256:string;readonly sourceBaseCommit:string;readonly sourceBaseTree:string};
  readonly producerCommit:string;
  readonly producerTree:string;
  readonly producerContractSha256:string;
  readonly dataResultRevision:null;
  readonly PAN549ResultCapability:false;
  readonly grantedRights:readonly [];
  readonly persistentMutationAuthority:false;
}
export type KS303SessionPresentationV1=
  | {readonly outcome:'SESSION_VIEW';readonly binding:KS303SessionBindingV1;readonly state:KS303SessionStateV1;readonly persistentSupersetMutation:false;readonly analysisResult:null}
  | {readonly outcome:'DENIED';readonly binding:null;readonly state:null;readonly persistentSupersetMutation:false;readonly analysisResult:null};
export interface KS303UIStateConsumerOptionsV1<Target> {
  readonly contextOwner:ReturnType<typeof createBrowserContextOwnerV1>;
  readonly manifest:KS303ExistingManifestV1;
  // Trusted current-owner callback, not a PAN backend grant or metadata role.
  readonly authorizeSession:(context:BrowserContextV1,operation:KS303SessionOperation,signal:AbortSignal)=>Promise<boolean>;
  readonly renderView:(frame:{readonly target:Target;readonly signal:AbortSignal;readonly presentation:KS303SessionPresentationV1})=>void|(()=>void)|Promise<void|(()=>void)>;
  readonly renderPanel:KS303UIStateConsumerOptionsV1<Target>['renderView'];
}
export interface KS303SessionReceiptV1 {
  readonly status:'applied'|'already_applied'|'denied'|'undone';
  readonly persistentSupersetMutation:false;
  readonly stateVersion?:number;
  readonly sideEffect?:'none'|'reversible_session';
  readonly denialReason?:string;
  readonly undoToken?:string|null;
}
export interface KS303UIStateConsumerV1<Target> {
  readonly descriptor:BrowserShellPluginV1;
  readonly factories:ReadonlyMap<string,BrowserShellFactoryV1<Target>>;
  binding():KS303SessionBindingV1;
  readSession():KS303SessionStateV1;
  sessionDeepLink():string;
  acceptSessionDeepLink(hash:string):BrowserDeepLinkV1;
  applySession(request:unknown):Promise<KS303SessionReceiptV1>;
  undoSession(token:string,expectedStateVersion:number):Promise<KS303SessionReceiptV1>;
  close():void;
}
export function createPan541UIStateConsumerV1<Target>(options:KS303UIStateConsumerOptionsV1<Target>):KS303UIStateConsumerV1<Target>;
