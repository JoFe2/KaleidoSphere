const fail=()=>{throw new Error('H03_BROWSER_COMMAND_DENIED');};
export function validateH03BrowserCommandV1(value){
 if(!value||Object.getPrototypeOf(value)!==Object.prototype||value.schemaVersion!=='kaleidosphere/browser-starter-command/v1')fail();
 const keys={status:['schemaVersion','action'],suggest:['schemaVersion','action','journey'],run:['schemaVersion','action','journey','operationId'],
 abort:['schemaVersion','action','operationId'],reset:['schemaVersion','action','instanceId','expectedGeneration']}[value.action];
 if(!keys||Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))fail();
 if(value.action==='suggest'&&!['catalog','metric'].includes(value.journey))fail();
 if(value.action==='run'&&(!['catalog','metric'].includes(value.journey)||! /^(catalog|metric)-[a-z0-9-]{1,48}$/.test(value.operationId??'')))fail();
 if(value.action==='abort'&&! /^(catalog|metric)-[a-z0-9-]{1,48}$/.test(value.operationId??''))fail();
 if(value.action==='reset'&&(typeof value.instanceId!=='string'||! /^[a-z][a-z0-9-]{0,63}$/.test(value.instanceId)||!Number.isSafeInteger(value.expectedGeneration)||value.expectedGeneration<1||value.expectedGeneration>1000000))fail();
 return value;
}
export function renderH03BrowserStarterV1(prefix){
 if(! /^\/t\/[a-z0-9][a-z0-9-]{0,63}$/.test(prefix))throw new Error('H03_PROTECTED_PREFIX_REQUIRED');
 return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <title>KaleidoSphere · Synthetischer Einstieg</title><link rel="icon" href="${prefix}/assets/kaleidosphere-logo.svg" type="image/svg+xml">
 <style>body{font:16px system-ui,sans-serif;color:#172033;background:#f5f7fb;margin:0}main{max-width:960px;margin:2rem auto;padding:1.5rem;background:white;border:1px solid #dce3ee;border-radius:12px}.brand{display:flex;align-items:center;gap:1rem}.brand img{width:76px;height:76px;object-fit:contain;flex:none}h1{font-size:1.8rem;margin:0}h2{font-size:1.2rem}.journeys{display:grid;grid-template-columns:1fr 1fr;gap:1rem}.journey{padding:1rem;border:1px solid #dce3ee;border-radius:8px}button{padding:.75rem 1rem;color:white;background:#1677ff;border:0;border-radius:6px;font:600 1rem system-ui;cursor:pointer}button:focus-visible{outline:3px solid #172033;outline-offset:3px}button:disabled{opacity:.5;cursor:not-allowed}.actions{display:flex;gap:.7rem;flex-wrap:wrap;margin:1rem 0}.secondary{background:#46566f}.result{padding:1rem;background:#f5f7fb;border-radius:8px}dl{display:grid;grid-template-columns:minmax(7rem,1fr) 3fr;gap:.65rem}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere;min-width:0}.verified{color:#14653e}.failed{color:#9f2525}pre{font:13px ui-monospace,monospace;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}.note{color:#596579;font-size:.9rem}#notice{min-height:1.5rem}@media(max-width:640px){main{margin:0;border-radius:0;padding:1rem}.journeys{grid-template-columns:1fr}.brand img{width:60px;height:60px}h1{font-size:1.4rem}dl{grid-template-columns:1fr}dd{margin-bottom:.5rem}}</style></head><body><main>
 <header class="brand"><img src="${prefix}/assets/kaleidosphere-logo.svg" alt=""><div><h1>KaleidoSphere</h1><p>Synthetischer Einstieg · Nicht-Admin-Kontext</p></div></header>
 <p>Zwei getrennte, begrenzte Produktstrecken. Keine Produktivdaten, Veröffentlichung oder Adminrechte.</p>
 <div class="journeys"><section class="journey"><h2>Katalog-Demo</h2><p>Die gebündelte synthetische Metadatenanalyse ausführen und die Tabellen dbo.customers und dbo.orders im echten lokalen Katalog prüfen.</p><button id="catalog-run">Katalog prüfen</button></section>
 <section class="journey"><h2>Kennzahlen-Demo</h2><p>COMMON-TRADE-01: Rechnungsdatum Juni–Juli 2026. Netto = Rechnungen minus Gutschriften. Erwartung: 90000 EUR minor units.</p><button id="metric-run">Kennzahl berechnen</button></section></div>
 <div class="actions"><button class="secondary" id="abort" disabled>Eigene Ausführung abbrechen</button><button class="secondary" id="refresh">Status prüfen</button><button class="secondary" id="reset" disabled>Eigenen Starter zurücksetzen</button></div>
 <p><button class="secondary" id="helper">Typisierten Kennzahlen-Vorschlag lesen</button></p><p id="suggestion" class="note" aria-live="polite">Optionaler Helper: nur Vorschläge, keine Ausführung.</p>
 <p id="notice" role="status" aria-live="polite">Gebundene Identität wird gelesen …</p>
 <section class="result" aria-labelledby="result-heading"><h2 id="result-heading">Prüfbares Fachresultat</h2><dl>
 <dt>Ergebnisstatus</dt><dd id="business-status">Noch nicht ausgeführt</dd><dt>Erwartet</dt><dd id="expected">—</dd><dt>Beobachtet</dt><dd id="observed">—</dd>
 <dt>Quelle / Zeitraum</dt><dd id="source">—</dd><dt>Rechtebezug</dt><dd id="rights">—</dd><dt>Technische First-value-Zeit</dt><dd id="first-value">Noch nicht gemessen</dd>
 <dt>Laufzeit / Template</dt><dd><pre id="template-identity">—</pre></dd><dt>Begrenzter Nachweis</dt><dd><pre id="evidence">—</pre></dd></dl></section>
 <p class="note">Reset löscht nur das eigene Starterresultat und erhöht dessen Generation. Quelldaten, analytische Generationen, Sessions und fremde Instanzen bleiben unverändert. Bei outcome_unknown ist Reset gesperrt. Technische Browserprobe, keine Human-PASS- oder Verständnismessung.</p>
 <script>
 const byId=id=>document.getElementById(id);let held=null,operationId=null,started=null;
 const pendingStates=['running','abort_requested','outcome_unknown'];
 function show(data){held=data.template?data:{...held,...data};const r=data.result??null;
 byId('reset').disabled=!held?.instanceId||pendingStates.includes(data.state);byId('abort').disabled=!operationId||!['running','abort_requested'].includes(data.state);
 for(const id of ['catalog-run','metric-run'])byId(id).disabled=pendingStates.includes(data.state);
 byId('notice').textContent='Starter: '+data.state+' · eigene Generation '+(held?.starterGeneration??'unbekannt');
 const verified=data.state==='succeeded'&&r?.businessStatus==='VALUE_VERIFIED'&&JSON.stringify(r.expectedValue)===JSON.stringify(r.observedValue);
 byId('business-status').textContent=verified?'VALUE_VERIFIED · Fachwert stimmt':r?.businessStatus??data.state;
 byId('business-status').className=verified?'verified':r?'failed':'';
 const format=v=>Array.isArray(v)?v.join(', '):String(v);byId('expected').textContent=r?format(r.expectedValue)+(r.unit?' '+r.unit:''):'—';byId('observed').textContent=r?format(r.observedValue)+(r.unit?' '+r.unit:''):'—';
 byId('source').textContent=r?JSON.stringify({source:r.source,period:r.period??null}):'—';byId('rights').textContent=r?JSON.stringify(r.rights):'—';
 byId('first-value').textContent=r?'Server '+r.firstValueMs.toFixed(2)+' ms'+(started===null?'':' · Browser '+(performance.now()-started).toFixed(2)+' ms')+' · humanUsability: NOT_OBSERVED':'Noch nicht gemessen';
 byId('template-identity').textContent=JSON.stringify(r?.template??held?.template??null,null,2);byId('evidence').textContent=r?JSON.stringify(r.evidence,null,2):'—';
 }
 async function send(action,extra={}){const cs=document.cookie.split(';').map(s=>s.trim()).filter(s=>s.startsWith('__Host-ks293-csrf='));const csrf=cs.length===1?cs[0].slice('__Host-ks293-csrf='.length):'';if(!/^[a-f0-9]{64}$/.test(csrf))throw new Error('AGENT_CSRF_TOKEN_DENIED');
 const response=await fetch('${prefix}/api/chat',{method:'POST',credentials:'same-origin',mode:'same-origin',referrerPolicy:'same-origin',redirect:'error',headers:{'content-type':'application/json','x-pan527-csrf':csrf},body:JSON.stringify({schemaVersion:'kaleidosphere/browser-starter-command/v1',action,...extra})});const data=await response.json();if(!response.ok)throw new Error(data.code??'STARTER_REQUEST_DENIED');return data;}
 function denied(error){show({state:'outcome_unknown',result:null});byId('notice').textContent=error.message+' · Ausgang nicht bestätigt; Status prüfen, kein automatischer Retry/Reset.';}
 async function refresh(){try{const data=await send('status');show(data);}catch(error){denied(error);}}
 async function run(journey){operationId=journey+'-'+crypto.randomUUID();started=performance.now();show({state:'running',result:null});try{const data=await send('run',{journey,operationId});operationId=null;show(data);await refresh();}catch(error){operationId=null;denied(error);}}
 byId('catalog-run').addEventListener('click',()=>run('catalog'));byId('metric-run').addEventListener('click',()=>run('metric'));
 byId('refresh').addEventListener('click',refresh);
 byId('helper').addEventListener('click',async()=>{try{const data=await send('suggest',{journey:'metric'});byId('suggestion').textContent=JSON.stringify(data.suggestion)+' · dispatchAuthorized: false · modelCalled: false';}catch(error){byId('suggestion').textContent=error.message;}});
 byId('abort').addEventListener('click',async()=>{try{show(await send('abort',{operationId}));}catch(error){denied(error);}});
 byId('reset').addEventListener('click',async()=>{try{show(await send('reset',{instanceId:held.instanceId,expectedGeneration:held.starterGeneration}));started=null;}catch(error){denied(error);}});
 refresh();
 </script></main></body></html>`;
}
