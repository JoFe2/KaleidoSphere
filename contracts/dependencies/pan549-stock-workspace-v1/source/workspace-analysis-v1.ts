// Browser-safe closed read/result profile; these facts grant no execution rights.
import {canonicalJson} from './canonical-json.js';
export const WORKSPACE_ANALYSIS_READ_V1='pansphaira.workspace-analysis/read/v1' as const;
export const WORKSPACE_ANALYSIS_RESULT_V1='pansphaira.workspace-analysis/result/v1' as const;
export const WORKSPACE_ANALYSIS_STOCK_OBJECT_V1='analysis:common-trade-01:stock' as const;
export interface WorkspaceAnalysisBindingV1 {readonly origin:string;readonly tenantId:string;readonly instanceId:string;readonly generation:number;readonly identityDigest:string;}
export interface WorkspaceAnalysisReadV1 {readonly schemaVersion:typeof WORKSPACE_ANALYSIS_READ_V1;readonly objectId:typeof WORKSPACE_ANALYSIS_STOCK_OBJECT_V1;readonly expectedNativeRevision:number|null;readonly expectedResultRevision:string|null;readonly asOf:string|null;}
export type WorkspaceAnalysisStockKeyV1='physical'|'reserved'|'quarantined'|'free'|'stockRunwayDays'|'stockValueMinor';
export type WorkspaceAnalysisStockRowV1={readonly key:WorkspaceAnalysisStockKeyV1;readonly label:string;readonly unit:'STK'|'DAYS'|'EUR_MINOR'} & ({readonly state:'KNOWN';readonly value:number;readonly reason:null;readonly basis:string}|{readonly state:'UNAVAILABLE';readonly value:null;readonly reason:string;readonly basis:null});
export interface WorkspaceAnalysisLocalCohortV1 {
 readonly entrypoint:'packages/usage-insights/src/index.ts#UsageInsightsLocalServiceV1.localReport';
 readonly populationDenominator:null;readonly denominatorState:'UNKNOWN';
 readonly report:{readonly schemaVersion:'chimpmaera.usage-insights/report/v1';readonly cohortLabel:'EXPLICIT_OPT_IN_ONLY';readonly coverageLabel:'PARTIAL_NON_REPRESENTATIVE_COHORT';readonly coverageNonclaims:readonly ['DOES_NOT_REPRESENT_ALL_INSTALLATIONS','NO_PRODUCTION_OR_ADOPTION_CLAIM'];readonly smallCellPolicy:'ALL_OR_NOTHING_DISTINCT_INSTALLATIONS_THRESHOLD_5';readonly minCellSize:5;readonly publicationState:'EMPTY'|'SUPPRESSED';readonly installationsSeen:0|null;readonly suppressionReason:'ONE_OR_MORE_COHORTS_BELOW_THRESHOLD'|null;readonly metrics:null;readonly generatedAtMs:number;readonly reportDigest:string};
}
export interface WorkspaceAnalysisStockResultV1 {
 readonly schemaVersion:typeof WORKSPACE_ANALYSIS_RESULT_V1;readonly objectId:typeof WORKSPACE_ANALYSIS_STOCK_OBJECT_V1;readonly resultRevision:string;readonly binding:WorkspaceAnalysisBindingV1;
 readonly source:{readonly entrypoint:'src/pan515/trade-state.mjs#readPan515TradeState';readonly schemaVersion:'pansphaira.pan520/projection-snapshot/v1';readonly profile:'STOCK';readonly projectionDigest:string;readonly snapshot:{readonly asOf:string|null;readonly nativeRevision:number;readonly bindingDigest:string;readonly nativeEventSetDigest:string};readonly grain:{readonly sourceId:'SYN-COMMON';readonly tenantId:'SYN-TENANT-01';readonly entityId:'SYN-ENTITY-01';readonly orderId:'SO-01';readonly lineId:'1';readonly articleId:'ARTICLE-A';readonly warehouseId:'WH-01';readonly currency:'EUR';readonly unit:'STK'};readonly coverage:string};
 readonly rows:readonly WorkspaceAnalysisStockRowV1[];readonly cohort:WorkspaceAnalysisLocalCohortV1|null;readonly availability:'KNOWN'|'PARTIAL';readonly proposalOnly:false;readonly effectsProduced:false;readonly executionAuthorityGranted:false;readonly consentChanged:false;readonly transportEnabled:false;
}
const denied=():never=>{throw new Error('ANALYSIS_RESULT_CONTRACT_DENIED');};
function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)return denied();
 const ds=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(ds).length!==keys.length||Reflect.ownKeys(ds).some(k=>typeof k!=='string'||!keys.includes(k))||Object.values(ds).some(d=>!d.enumerable||!('value' in d)))return denied();
 return value as Record<string,unknown>;
}
function array(value:unknown,max:number):readonly unknown[]{
 if(!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype)return denied();
 const ds=Object.getOwnPropertyDescriptors(value),size=Object.getOwnPropertyDescriptor(value,'length')?.value;
 if(!Number.isSafeInteger(size)||size<0||size>max||Reflect.ownKeys(ds).length!==size+1||Reflect.ownKeys(ds).some(k=>typeof k!=='string'||(k!=='length'&&(!/^(0|[1-9][0-9]*)$/.test(k)||Number(k)>=size)))||Object.entries(ds).some(([k,d])=>k!=='length'&&(!d.enumerable||!('value' in d))))return denied();
 return value;
}
const integer=(v:unknown):boolean=>Number.isSafeInteger(v)&&(v as number)>=0;
const hex=(v:unknown):boolean=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const token=(v:unknown):boolean=>typeof v==='string'&&/^[A-Z0-9_]{1,100}$/.test(v);
function instant(v:unknown):boolean{return v===null||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v));}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
const clone=<T>(v:unknown):T=>freeze(structuredClone(v)) as T;
function binding(value:unknown):WorkspaceAnalysisBindingV1{
 const b=record(value,['origin','tenantId','instanceId','generation','identityDigest']);
 if(typeof b.origin!=='string'||!/^https:\/\/[a-z0-9.-]+(?::[1-9][0-9]{0,4})?$/.test(b.origin)||typeof b.tenantId!=='string'||!/^[a-z0-9][a-z0-9-]{0,63}$/.test(b.tenantId)||typeof b.instanceId!=='string'||!/^[a-z0-9][a-z0-9:_-]{0,127}$/.test(b.instanceId)||!integer(b.generation)||b.generation===0||!hex(b.identityDigest))return denied();
 return clone(value);
}
export function validateWorkspaceAnalysisReadV1(value:unknown):WorkspaceAnalysisReadV1{
 const s=record(value,['schemaVersion','objectId','expectedNativeRevision','expectedResultRevision','asOf']);
 if(s.schemaVersion!==WORKSPACE_ANALYSIS_READ_V1||s.objectId!==WORKSPACE_ANALYSIS_STOCK_OBJECT_V1||(s.expectedNativeRevision!==null&&!integer(s.expectedNativeRevision))||(s.expectedResultRevision!==null&&!hex(s.expectedResultRevision))||!instant(s.asOf))return denied();
 return clone(value);
}
const grain={sourceId:'SYN-COMMON',tenantId:'SYN-TENANT-01',entityId:'SYN-ENTITY-01',orderId:'SO-01',lineId:'1',articleId:'ARTICLE-A',warehouseId:'WH-01',currency:'EUR',unit:'STK'} as const;
const labels={physical:'Physischer Bestand',reserved:'Reservierter Bestand',quarantined:'Gesperrter Bestand',free:'Frei verfügbarer Bestand',stockRunwayDays:'Bestandsreichweite',stockValueMinor:'Qualifizierter Bestandswert'} as const;
export function validateWorkspaceAnalysisResultV1(value:unknown,expectedBinding:WorkspaceAnalysisBindingV1):WorkspaceAnalysisStockResultV1{
 const r=record(value,['schemaVersion','objectId','resultRevision','binding','source','rows','cohort','availability','proposalOnly','effectsProduced','executionAuthorityGranted','consentChanged','transportEnabled']);
 const actual=binding(r.binding),expected=binding(expectedBinding);
 if(Object.keys(expected).some(k=>actual[k as keyof WorkspaceAnalysisBindingV1]!==expected[k as keyof WorkspaceAnalysisBindingV1])||r.schemaVersion!==WORKSPACE_ANALYSIS_RESULT_V1||r.objectId!==WORKSPACE_ANALYSIS_STOCK_OBJECT_V1||!hex(r.resultRevision)||r.proposalOnly!==false||r.effectsProduced!==false||r.executionAuthorityGranted!==false||r.consentChanged!==false||r.transportEnabled!==false)return denied();
 const s=record(r.source,['entrypoint','schemaVersion','profile','projectionDigest','snapshot','grain','coverage']);
 if(s.entrypoint!=='src/pan515/trade-state.mjs#readPan515TradeState'||s.schemaVersion!=='pansphaira.pan520/projection-snapshot/v1'||s.profile!=='STOCK'||!hex(s.projectionDigest)||!token(s.coverage))return denied();
 const snap=record(s.snapshot,['asOf','nativeRevision','bindingDigest','nativeEventSetDigest']),g=record(s.grain,Object.keys(grain));
 if(!instant(snap.asOf)||!integer(snap.nativeRevision)||!hex(snap.bindingDigest)||!hex(snap.nativeEventSetDigest)||Object.keys(grain).some(k=>g[k]!==grain[k as keyof typeof grain]))return denied();
 const rows=array(r.rows,6);if(rows.length!==6)return denied();
 rows.forEach((value,index)=>{
  const row=record(value,['key','label','state','value','unit','reason','basis']),key=Object.keys(labels)[index] as WorkspaceAnalysisStockKeyV1;
  if(row.key!==key||row.label!==labels[key]||row.unit!==(key==='stockRunwayDays'?'DAYS':key==='stockValueMinor'?'EUR_MINOR':'STK'))return denied();
  if(index<4){if(row.state!=='KNOWN'||!integer(row.value)||row.reason!==null||row.basis!=='ACTUAL_NATIVE_PAN515_EVENT_STOCK_READBACK')return denied();}
  else if(row.state!=='UNAVAILABLE'||row.value!==null||row.basis!==null||row.reason!==(key==='stockRunwayDays'?'MISSING_NATIVE_CONSUMPTION_HISTORY':'MISSING_QUALIFIED_VALUATION_PROFILE'))return denied();
 });
 if(r.availability!=='PARTIAL')return denied();
 if(r.cohort!==null){
  const cohort=record(r.cohort,['entrypoint','populationDenominator','denominatorState','report']);
  if(cohort.entrypoint!=='packages/usage-insights/src/index.ts#UsageInsightsLocalServiceV1.localReport'||cohort.populationDenominator!==null||cohort.denominatorState!=='UNKNOWN')return denied();
  const report=record(cohort.report,['schemaVersion','cohortLabel','coverageLabel','coverageNonclaims','smallCellPolicy','minCellSize','publicationState','installationsSeen','suppressionReason','metrics','generatedAtMs','reportDigest']);
  const nonclaims=array(report.coverageNonclaims,2);
  if(report.schemaVersion!=='chimpmaera.usage-insights/report/v1'||report.cohortLabel!=='EXPLICIT_OPT_IN_ONLY'||report.coverageLabel!=='PARTIAL_NON_REPRESENTATIVE_COHORT'||nonclaims.length!==2||nonclaims[0]!=='DOES_NOT_REPRESENT_ALL_INSTALLATIONS'||nonclaims[1]!=='NO_PRODUCTION_OR_ADOPTION_CLAIM'||report.smallCellPolicy!=='ALL_OR_NOTHING_DISTINCT_INSTALLATIONS_THRESHOLD_5'||report.minCellSize!==5||!integer(report.generatedAtMs)||!hex(report.reportDigest)||report.metrics!==null)return denied();
  if(report.publicationState==='EMPTY'){if(report.installationsSeen!==0||report.suppressionReason!==null)return denied();}
  else if(report.publicationState==='SUPPRESSED'){if(report.installationsSeen!==null||report.suppressionReason!=='ONE_OR_MORE_COHORTS_BELOW_THRESHOLD')return denied();}
  else return denied();
 }
 return clone(value);
}

// Unkeyed byte integrity, never provenance or an authentication/rights grant.
async function digestWithout(value:Record<string,unknown>,key:string):Promise<string>{
 const unsigned=Object.fromEntries(Object.entries(value).filter(([k])=>k!==key));
 const bytes=await globalThis.crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(unsigned)));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export async function verifyWorkspaceAnalysisResultIntegrityV1(value:unknown,expectedBinding:WorkspaceAnalysisBindingV1):Promise<WorkspaceAnalysisStockResultV1>{
 const result=validateWorkspaceAnalysisResultV1(value,expectedBinding);
 if(await digestWithout(result as unknown as Record<string,unknown>,'resultRevision')!==result.resultRevision)return denied();
 if(result.cohort&&await digestWithout(result.cohort.report as unknown as Record<string,unknown>,'reportDigest')!==result.cohort.report.reportDigest)return denied();
 return result;
}
