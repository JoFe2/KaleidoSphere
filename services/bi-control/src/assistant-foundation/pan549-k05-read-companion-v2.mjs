// Own static read-only contribution. The genuine native view/result and every
// action still use the protected opaque server pair, never DOM/hash authority.
// Canonical encoding here has ONLY parsed plain protected JSON input; full
// native type/source/rights verification remains on the opaque server pair and
// original native consumer. Digests are byte checks, never authority.
const canon=v=>v&&typeof v==='object'?Array.isArray(v)?'['+v.map(canon).join()+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canon(v[k])).join()+'}':JSON.stringify(v);

const id='ks303-existing-k05-read-companion',obj='analysis:common-trade-01:stock',schema='pansphaira.workspace-analysis/',revisionKey='resultRevision';
const el=(tag,value='',props={})=>Object.assign(document.createElement(tag),{textContent:value,...props}),mark=(e,k,v)=>e.setAttribute('data-ks303-'+k,v);
const fail=(state='UNKNOWN')=>{throw {state};};
export function startPan549K05ReadCompanionV1(){
 const meta=JSON.parse(document.getElementById(id+'-attribution').textContent),template=document.getElementById(id+'-template'),states=meta.states;
 const route=location.pathname.match(/^\/t\/([a-z0-9][a-z0-9-]{0,63})\/workspace$/);if(!route||location.protocol!=='https:'||!isSecureContext)fail('DENIED');
 const body=document.body,ds=body.dataset,tenant=route[1],base='/t/'+tenant+'/workspace',root=()=>document.getElementById(id),stamp=()=>ds.analysisResultRevision;
 let epoch=0,abort,closed=false,attached,ancestors=[];
 const withdraw=s=>{for(const k of ['result-revision','session','session-action'])s.removeAttribute('data-ks303-'+k);};
 const retire=()=>{epoch++;abort?.abort();if(attached){withdraw(attached);attached.replaceChildren();attached.remove();attached=null;ancestors=[];}};
 const status=s=>el('h2',s,{role:'status'});
 const terminal=(s,state)=>{withdraw(s);mark(s,'state',state);s.replaceChildren(status('KS-K05: '+state+' — '+states[state]),el('p','Keine Altwerte/Effekte.'));};
 // Every private context value is a validated nonempty session for THIS exact
 // tenant: the tenant is independently checked on every protected JSON read.
 async function context(signal){const r=await fetch(base+'/context',{credentials:'same-origin',cache:'no-store',signal});if(r.status!==200)fail([401,403].includes(r.status)?'DENIED':'UNKNOWN');const c=await r.json();if(c?.tenantId!==tenant||typeof c.sessionId!=='string'||!c.sessionId)fail('DENIED');return c.sessionId;}
 const initial=context().catch(()=>{});
 async function confirmed(revision,alive,target,signal){
  const first=await initial,before=await context(signal),h=new URLSearchParams(location.hash.split('?')[1]);if(first&&first!==before)fail('STALE');
  if(!first||!alive()||!/^#\/workspace\/analysis(?:\?|$)/.test(location.hash)||h.has('sessionId')&&h.get('sessionId')!==before||h.has('tenantId')&&h.get('tenantId')!==tenant||!/^[a-f0-9]{64}$/.test(revision))fail();
  const r=await fetch(base+'/analysis',{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json','x-pan549-context':before},body:JSON.stringify({schemaVersion:schema+'read/v1',objectId:obj,expectedNativeRevision:null,expectedResultRevision:revision,asOf:meta.cutoff}),signal});
  if(r.status!==200)fail(r.status===409?'STALE':[400,401,403].includes(r.status)?'DENIED':r.status===404?'UNAVAILABLE':'UNKNOWN');const v=await r.json(),unsigned={...v};delete unsigned[revisionKey];
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canon(unsigned)))),b=>b.toString(16).padStart(2,'0')).join('');
  // Full closed native type, selector/cutoff/snapshot/grain/six-fact pair and
  // false-effect policies are verified on EVERY protected server read before
  // serialization, including after integrity await/opaque reauthorization.
  // The original native renderer independently verifies its own matching read.
  if(v.binding.origin!==location.origin||v.binding.tenantId!==tenant||v[revisionKey]!==hash||hash!==revision)fail('DENIED');
  const after=await context(signal);if(before!==after)fail('STALE');
  for(const row of v.rows){const tr=target.querySelector('tr[data-analysis-key="'+row.key+'"]');if(!tr||canon([...tr.children].slice(1,4).map(c=>c.textContent))!==canon([row.state,row.state==='KNOWN'?String(row.value):'Nicht verfügbar',row.unit]))fail('DENIED');}
  return [v,after];
 }
 async function activate(){
  retire();const n=epoch,revision=stamp(),hash=location.hash,contextRevision=ds.contextRevision,target=document.querySelector('.workspace-analysis');if(closed||!revision||!contextRevision||!target)return;
  abort=new AbortController();const signal=abort.signal,s=el('section','',{id,tabIndex:-1});mark(s,'state','CHECKING');s.append(status('KS-K05: Prüfe Quelle'));target.append(s);
  attached=s;for(let node=s;node;node=node.parentNode)ancestors.push(node);
  // Drain same-turn removals before every asynchronous commit. A reinserted
  // identical attachment/ancestor never resurrects its retired transaction.
  const alive=()=>{changes(observer.takeRecords());return !closed&&body===document.body&&n===epoch&&stamp()===revision&&location.hash===hash&&ds.contextRevision===contextRevision&&s.isConnected&&s.parentElement===target&&root()===s;};
  const failure=e=>{if(!alive())return;const state=states[e.state]?e.state:'UNKNOWN',focus=s.contains(document.activeElement);terminal(s,state);target.dataset.outcome=state;for(const node of [...target.childNodes])if(node!==s)node.remove();delete ds.analysisResultRevision;if(focus)s.focus();};
  try{
   const [v,c]=await confirmed(revision,alive,target,signal);if(!alive())return;
   s.replaceChildren(template.content.cloneNode(true));mark(s,'state','CURRENT');mark(s,'result-revision',revision);mark(s,'session',c);
   // This order is part of our exact pinned inert template, not foreign shape
   // matching or source authority. Protected result validation stays unchanged.
   const [,figure,controls,panel]=s.children,chart=figure.children[1];chart.dataset[revisionKey]=revision;
   const known=v.rows.filter(r=>r.state==='KNOWN'&&r.unit==='STK'),max=Math.max(1,...known.map(r=>Math.abs(r.value)));
   for(const r of known){const track=el('div'),bar=el('span');for(const k of ['key','value','unit'])mark(bar,k,r[k]);bar.style.width=100*Math.abs(r.value)/max+'%';track.append(bar);chart.append(el('p',r.label+': '+r.value+' '+r.unit),track);}
   for(const r of v.rows.filter(r=>r.state!=='KNOWN'))figure.append(el('p',r.label+': '+r.state+' — '+r.reason));
   const buttons=[...controls.children],[show,hide,undo]=buttons;mark(panel,'result-revision',revision);mark(panel,'session',c);
   const values=s.querySelectorAll('dd');values[9].textContent=revision;values[10].textContent=c;
   let visible=false,prior=null,pending=false;
   const setVisible=x=>{visible=x;panel.hidden=!x;hide.disabled=!x;show.disabled=x;undo.disabled=prior===null;show.ariaExpanded=x;};setVisible(false);
   // confirmed already checks the full result hash against this exact revision;
   // each caller checks drained attachment liveness after its final await.
   const act=async action=>{if(pending)return;pending=true;s.ariaBusy='true';for(const b of buttons)b.ariaDisabled='true';try{const [,fctx]=await confirmed(revision,alive,target,signal);if(!alive()||c!==fctx)fail('STALE');const focus=controls.contains(document.activeElement);if(action==='UNDO'){const old=prior;prior=null;setVisible(old);}else{prior=visible;setVisible(action==='SHOW');}mark(s,'session-action',action);if(focus)(visible?hide:show).focus();}catch(e){failure(e);}finally{pending=false;s.ariaBusy=null;for(const b of buttons)b.ariaDisabled=null;}};
   show.onclick=()=>act('SHOW');hide.onclick=()=>act('HIDE');undo.onclick=()=>act('UNDO');
  }catch(e){failure(e);}
 }
 // Released PAN's ORIGINAL terminal already contains its real uppercase state
 // and accessible status. Do not replace it with another native renderer/hint.
 // Start a NEW attachment only after the original renderer's same-task profile
 // layout. Later removals still permanently retire every existing attachment.
 // Every original ancestor itself is captured; any reparenting first removes
 // one of those nodes. Match actual removed nodes, as the native owner does.
 const changes=records=>{let changed=false;for(const c of records){for(const node of c.removedNodes)if(ancestors.includes(node))retire();if(c.target===body&&c.type==='attributes'){changed=true;if(c.attributeName==='data-context-revision')retire();}}if(changed){if(stamp())requestAnimationFrame(activate);else if(['CHECKING','CURRENT'].includes(attached?.dataset.ks303State))retire();}};
 const observer=new MutationObserver(changes);observer.observe(document,{attributes:true,attributeFilter:['data-analysis-result-revision','data-context-revision'],childList:true,subtree:true});
 const close=()=>{closed=true;retire();observer.disconnect();removeEventListener('hashchange',retire);};addEventListener('hashchange',retire);addEventListener('pagehide',close,{once:true});addEventListener('pageshow',e=>{if(e.persisted)location.reload();});void activate();return Object.freeze({close});
}
if(typeof document!=='undefined'&&typeof window!=='undefined')startPan549K05ReadCompanionV1();
