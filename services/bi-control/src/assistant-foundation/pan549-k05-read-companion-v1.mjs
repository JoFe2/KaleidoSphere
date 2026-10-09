// Read-only code-owned contribution in the ORIGINAL PAN analysis view. Native
// ingress and PAN renderer retain full runtime validation. No shell/factory,
// prototype/fetch patch, fetched code, BI engine or mutation endpoint.
import {canonicalJson} from '../../../../contracts/dependencies/pan549-stock-workspace-v1/runtime/canonical-json.js';
import attribution from '../../../../contracts/dependencies/pan549-stock-workspace-v1/ui-attribution-v1.json' with {type:'json'};
const ks=attribution.existingKSConsumer,pan=attribution.PAN549,id='ks303-existing-k05-read-companion';
const text=(tag,value='')=>{const e=document.createElement(tag);e.textContent=String(value);return e;};
const same=(a,b)=>a.tenantId===b.tenantId&&a.sessionId===b.sessionId;
const fail=(state='UNKNOWN')=>{throw Object.assign(new Error('KS303_UNCONFIRMED'),{state});};
const states={DENIED:'Zugriff verweigert',STALE:'Revision veraltet',UNAVAILABLE:'Quelle nicht verfügbar',UNKNOWN:'Readback unbekannt'};
const status=value=>{const e=text('h2',value);e.setAttribute('role','status');return e;};
const terminal=(section,state)=>{for(const key of ['ks303ResultRevision','ks303Session','ks303SessionAction'])delete section.dataset[key];section.dataset.ks303State=state;section.replaceChildren(status('KS-K05: '+state+' — '+states[state]),text('p','Keine Altwerte/Änderung.'));};
export function startPan549K05ReadCompanionV1(){
 const route=location.pathname.match(/^\/t\/([A-Za-z0-9][A-Za-z0-9_.-]*)\/workspace$/);
 if(!route||location.protocol!=='https:'||!window.isSecureContext)fail('DENIED');
 const tenant=route[1],base='/t/'+tenant+'/workspace';let epoch=0,controller,closed=false;
 const root=()=>document.getElementById(id),stamp=()=>document.body.dataset.analysisResultRevision;
 const retire=()=>{++epoch;controller?.abort();root()?.remove();};
 async function context(signal){const r=await fetch(base+'/context',{credentials:'same-origin',cache:'no-store',signal});if(r.status!==200)fail([401,403].includes(r.status)?'DENIED':'UNKNOWN');const c=await r.json();if(c?.tenantId!==tenant||typeof c.sessionId!=='string'||!c.sessionId)fail('DENIED');return {tenantId:c.tenantId,sessionId:c.sessionId};}
 const initial=context().catch(()=>null);
 async function confirmed(captured,alive,target,signal){
  const first=await initial,before=await context(signal),hint=new URLSearchParams(location.hash.split('?')[1]??'');
  if(first&&!same(first,before))fail('STALE');
  if(!first||!alive()||!/^#\/workspace\/analysis(?:\?|$)/.test(location.hash)||(hint.has('sessionId')&&hint.get('sessionId')!==before.sessionId)||(hint.has('tenantId')&&hint.get('tenantId')!==tenant)||!/^[a-f0-9]{64}$/.test(captured))fail();
  const r=await fetch(base+'/analysis',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-pan549-context':before.sessionId},body:JSON.stringify({schemaVersion:'pansphaira.workspace-analysis/read/v1',objectId:'analysis:common-trade-01:stock',expectedNativeRevision:null,expectedResultRevision:captured,asOf:attribution.cutoff}),signal});
  if(r.status!==200)fail(r.status===409?'STALE':[400,401,403].includes(r.status)?'DENIED':r.status===404?'UNAVAILABLE':'UNKNOWN');const value=await r.json();
  // Consistency with the fully validated current peer is not authentication.
  // Each use still crosses the live protected opaque server-side K05 pair.
  const unsigned=Object.fromEntries(Object.entries(value).filter(([k])=>k!=='resultRevision'));
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalJson(unsigned)))),b=>b.toString(16).padStart(2,'0')).join('');
  if(value.schemaVersion!=='pansphaira.workspace-analysis/result/v1'||value.binding.origin!==location.origin||value.binding.tenantId!==tenant||value.resultRevision!==digest||digest!==captured||['proposalOnly','effectsProduced','executionAuthorityGranted','consentChanged','transportEnabled'].some(k=>value[k]!==false))fail('DENIED');
  const after=await context(signal);
  if(!same(before,after)||!alive()||value.objectId!=='analysis:common-trade-01:stock'||value.source.snapshot.asOf!==attribution.cutoff||value.source.coverage!==attribution.coverage)fail('STALE');
  if(canonicalJson(value.source.grain)!==canonicalJson(attribution.boundedProjectionRequest.scope)||value.rows.map(r=>r.key).join()!=='physical,reserved,quarantined,free,stockRunwayDays,stockValueMinor')fail('DENIED');
  for(const row of value.rows){const tr=target.querySelector('tr[data-analysis-key="'+row.key+'"]');if(!tr||tr.querySelector('[data-analysis-value]')?.textContent!==(row.state==='KNOWN'?String(row.value):'Nicht verfügbar')||tr.children[1]?.textContent!==row.state||tr.children[3]?.textContent!==row.unit)fail('DENIED');}
  return {value,context:after};
 }
 function plot(section,value){
  const figure=text('figure');figure.append(text('figcaption','K05: STK; keine Summe.'));
  const values=value.rows.filter(r=>r.state==='KNOWN'&&r.unit==='STK'),maximum=Math.max(1,...values.map(r=>Math.abs(r.value)));
  const chart=text('div');chart.className='ks303-bars';chart.dataset.ks303Chart='';chart.dataset.resultRevision=value.resultRevision;chart.tabIndex=0;chart.setAttribute('role','group');chart.setAttribute('aria-label','K05: STK aus Tabelle');
  for(const row of values){const label=text('p',row.label+': '+row.value+' '+row.unit),track=text('div'),bar=text('span');bar.dataset.ks303Key=row.key;bar.dataset.ks303Value=row.value;bar.dataset.ks303Unit=row.unit;bar.style.width=100*Math.abs(row.value)/maximum+'%';track.append(bar);chart.append(label,track);}
  figure.append(chart);for(const row of value.rows.filter(r=>r.state!=='KNOWN'))figure.append(text('p',row.label+': '+row.state+' — '+row.reason+'; kein 0/Balken.'));section.append(figure);
 }
 async function activate(){
  retire();const n=epoch,captured=stamp(),hash=location.hash,revision=document.body.dataset.contextRevision;if(!captured||closed||!revision)return;
  const target=document.querySelector('.workspace-analysis:has(tr[data-analysis-key="physical"])');if(!target)return;
  controller=new AbortController();const signal=controller.signal,section=text('section');section.id=id;section.tabIndex=-1;section.dataset.ks303State='CHECKING';section.append(status('KS-K05 — Prüfe Quelle'));target.append(section);
  // No stale callback may replace a detached section, another route/module,
  // another context generation, or a newer native analysis view.
  const alive=()=>!closed&&epoch===n&&stamp()===captured&&location.hash===hash&&document.body.dataset.contextRevision===revision&&section.isConnected&&section.parentElement===target&&root()===section;
  const failure=error=>{if(!alive())return;const state=states[error.state]?error.state:'UNKNOWN',focused=section.contains(document.activeElement);terminal(section,state);target.dataset.outcome=state;target.replaceChildren(section);delete document.body.dataset.analysisResultRevision;if(focused)section.focus();};
  try{
   const {value,context:capturedContext}=await confirmed(captured,alive,target,signal);if(!alive())return;
   section.replaceChildren(text('h2','KS-K05 — Read-only'));section.dataset.ks303State='CURRENT';section.dataset.ks303ResultRevision=value.resultRevision;section.dataset.ks303Session=capturedContext.sessionId;
   plot(section,value);
   const controls=text('div'),show=text('button','Quell- und Pairidentitäten anzeigen'),hide=text('button','Identitätspanel schließen'),undo=text('button','Sessionansicht zurücknehmen'),buttons=[show,hide,undo];controls.className='ks303-controls';for(const b of buttons)b.type='button';controls.append(...buttons);section.append(controls);
   let visible=false,prior=null,pending=false;const panel=text('aside');panel.id=id+'-panel';panel.dataset.ks303PanelContract='kaleidosphere.ks303.k05-source-panel/v1';panel.dataset.ks303ResultRevision=value.resultRevision;panel.dataset.ks303Session=capturedContext.sessionId;panel.setAttribute('aria-label','KS/PAN-Quellen');section.append(panel);show.setAttribute('aria-controls',panel.id);
   const list=text('dl');for(const [label,v] of [['PAN-Commit',pan.commit],['PAN-Tree',pan.tree],['PAN-Vertrag',pan.contractRuntimeSHA256],['KS-Readconsumer',ks.entry],['KS-Bytes',ks.sha256],['KS-Commit',ks.sourceKSCommit],['KS-Tree',ks.sourceKSTree],['Separater PAN520-Input',ks.producerCommit],['KS-Resultatvertrag',ks.contract],['PAN-Resultatrevision',value.resultRevision],['Session',capturedContext.sessionId]])list.append(text('dt',label),text('dd',v));panel.append(text('h3','KS/PAN-Quellen'),list,text('p','Scope/Units/Cutoff: Tabelle. Nur Session-Undo.'));
   const setVisible=v=>{visible=v;panel.hidden=!v;hide.disabled=!v;show.disabled=v;undo.disabled=prior===null;show.setAttribute('aria-expanded',String(v));};setVisible(false);
   const recheck=async(action)=>{
    if(pending)return;pending=true;section.setAttribute('aria-busy','true');for(const b of buttons)b.setAttribute('aria-disabled','true');
    try{const fresh=await confirmed(captured,alive,target,signal);if(!alive()||!same(capturedContext,fresh.context)||fresh.value.resultRevision!==value.resultRevision)fail('STALE');const focus=controls.contains(document.activeElement);if(action==='UNDO'){const old=prior;prior=null;setVisible(old);}else{prior=visible;setVisible(action==='SHOW');}section.dataset.ks303SessionAction=action;if(focus)(visible?hide:show).focus();}
    catch(error){failure(error);}
    finally{pending=false;section.removeAttribute('aria-busy');for(const b of buttons)b.removeAttribute('aria-disabled');}
   };
   show.onclick=()=>void recheck('SHOW');hide.onclick=()=>void recheck('HIDE');undo.onclick=()=>void recheck('UNDO');
  }catch(error){failure(error);}
 }
 // Native outcomes below are display hints only, never a grant or authenticated
 // result. Add explicit terminal text in this SAME view without changing PAN.
 const nativeTerminal=()=>{if(closed||stamp()||!/^#\/workspace\/analysis(?:\?|$)/.test(location.hash))return;const target=document.querySelector('.workspace-analysis[data-backend="analysis"]'),state=target?.dataset.outcome;if(!states[state]||!target.isConnected||root()?.parentElement===target&&root().dataset.ks303State===state)return;retire();const section=text('section');section.id=id;section.tabIndex=-1;terminal(section,state);target.append(section);};
 const observer=new MutationObserver(changes=>{const body=changes.filter(c=>c.target===document.body&&c.type==='attributes');if(body.some(c=>c.attributeName==='data-context-revision'))retire();if(body.some(c=>['data-analysis-result-revision','data-context-revision'].includes(c.attributeName))){if(stamp())void activate();else if(['CHECKING','CURRENT'].includes(root()?.dataset.ks303State))retire();}nativeTerminal();});
 observer.observe(document.body,{attributes:true,attributeFilter:['data-analysis-result-revision','data-context-revision','data-outcome'],childList:true,subtree:true});
 const close=()=>{closed=true;retire();observer.disconnect();window.removeEventListener('hashchange',retire);};
 // A restored cached native shell may already have retired its owners. Fetch a
 // fresh protected document; never re-grant from cached DOM/session markers.
 window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
 window.addEventListener('hashchange',retire);window.addEventListener('pagehide',close,{once:true});void activate();return Object.freeze({close});
}
if(typeof document!=='undefined'&&typeof window!=='undefined')startPan549K05ReadCompanionV1();
