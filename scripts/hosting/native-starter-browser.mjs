import assert from 'node:assert/strict';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
const executeOwnedHelper=promisify(execFile);
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const cfg=JSON.parse(await readFile(process.argv[2],'utf8'));
const requireBrowser=createRequire(pathToFileURL(path.join(cfg.browserWorkspace,'package.json')));
const {default:puppeteer}=await import(pathToFileURL(requireBrowser.resolve('puppeteer-core')));
const consumer=await import(pathToFileURL(cfg.repo+'/services/bi-control/src/runtime/pan-origin-source.mjs'));
const {createH02OptionalNativeIngressV1}=await import(pathToFileURL(cfg.repo+'/services/bi-control/src/hosting/origin-session-ingress.mjs'));
const source=await consumer.loadH02PanSessionSourceV1(cfg.sessionSource);
const profile=await mkdtemp(path.join(tmpdir(),'ks294-private-firefox-'));
const cases=[],network=[],responses=[],phases=[],activePages=[],errors=[];let browser,gateway,failure;
const origin=cfg.httpsOrigin;
async function mutate(action){phases.push({action,event:'start',atMs:performance.now()});const r=await executeOwnedHelper('python3',[cfg.mutationHelper,cfg.driverState,action],{timeout:30000,maxBuffer:262144});phases.push({action,event:'end',atMs:performance.now()});return r.stdout;}
const command=(action,extra={})=>({schemaVersion:'kaleidosphere/browser-starter-command/v1',action,...extra});
function record(id,value){cases.push({id,status:'PASS',value});console.log(JSON.stringify({case:id,status:'PASS'}));}
async function seed(context,issued,expiresAtMs){await context.setCookie(
 {name:'__Host-ks293-session',value:issued.cookieHeader.slice('__Host-ks293-session='.length),domain:'127.0.0.1',path:'/',secure:true,httpOnly:true,sameSite:'Strict',expires:Math.floor(expiresAtMs/1000)},
 {name:'__Host-ks293-csrf',value:issued.csrf,domain:'127.0.0.1',path:'/',secure:true,httpOnly:false,sameSite:'Strict',expires:Math.floor(expiresAtMs/1000)});}
async function post(page,input,target){return page.evaluate(async({input,target})=>{
 const csrf=document.cookie.split(';').map(v=>v.trim()).filter(v=>v.startsWith('__Host-ks293-csrf='))[0]?.slice('__Host-ks293-csrf='.length);
 const r=await fetch(target??location.pathname+'api/chat',{method:'POST',headers:{'content-type':'application/json','x-pan527-csrf':csrf},body:JSON.stringify(input)});
 return{status:r.status,body:await r.json()};},{input,target});}
function waitActionResponse(page,action){return page.waitForResponse(async r=>{if(!r.url().endsWith('/api/chat')||r.request().method()!=='POST')return false;const d=await r.json();
 if(!r.ok())return true;if(action==='suggest')return Boolean(d.suggestion);if(action==='reset')return d.sourceResourcesRemoved===false;
 if(action==='abort')return d.state==='abort_requested';if(action==='status')return Boolean(d.template)&&d.sourceResourcesRemoved===undefined;
 return Object.hasOwn(d,'result')&&!d.template&&d.state!=='abort_requested';
},{timeout:45000});}
async function clickObserved(page,selector,action){const pending=waitActionResponse(page,action);await page.click(selector);const response=await pending;return{status:response.status(),body:await response.json()};}
async function fieldRead(page){return page.evaluate(()=>Object.fromEntries(['notice','business-status','expected','observed','first-value','template-identity','source','rights','evidence'].map(id=>[id,document.getElementById(id).textContent])));}
try{
 gateway=createH02OptionalNativeIngressV1({optIn:true,source,origin,tls:cfg.tls,tenants:cfg.tenants});
 await new Promise((resolve,reject)=>gateway.server.once('error',reject).listen(Number(new URL(origin).port),'127.0.0.1',resolve));
 execFileSync(cfg.certutil,['-N','--empty-password','-d','sql:'+profile],{stdio:'ignore'});
 execFileSync(cfg.certutil,['-A','-d','sql:'+profile,'-n','KS294 owned root','-t','CT,C,C','-i',cfg.caPath],{stdio:'ignore'});
 browser=await puppeteer.launch({browser:'firefox',executablePath:cfg.firefoxPath,headless:true,userDataDir:profile,acceptInsecureCerts:false,timeout:30000,
 extraPrefsFirefox:{'security.enterprise_roots.enabled':false,'network.proxy.type':0,'network.captive-portal-service.enabled':false,'network.connectivity-service.enabled':false,'datareporting.healthreport.uploadEnabled':false,'toolkit.telemetry.enabled':false}});
 const contexts={},pages={};const expiresAtMs=Date.now()+900000;
 for(const tenant of ['tenant-a','tenant-b']){
  const issued=gateway.issueOwnerSession(tenant,{subjectId:'synthetic-h03-reader-'+tenant,role:'reader',expiresAtMs});
  const context=await browser.createBrowserContext();await seed(context,issued,expiresAtMs);const page=await context.newPage();activePages.push({tenant,page});
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>network.push({tenant,atMs:performance.now(),path:new URL(r.url()).pathname,method:r.method(),origin:r.headers().origin??null,fetchSite:r.headers()['sec-fetch-site']??null,referer:r.headers().referer??null,hasCsrfHeader:Boolean(r.headers()['x-pan527-csrf'])}));
  page.on('response',async r=>{if(r.url().endsWith('/api/chat')){const body=await r.json();responses.push({tenant,httpStatus:r.status(),body});}});
  await page.setViewport({width:1440,height:1000});const url=origin+'/t/'+tenant+'/';const observed=page.waitForResponse(r=>r.url()===url&&r.request().isNavigationRequest(),{timeout:30000});
  const initial=page.waitForResponse(r=>r.url().endsWith('/api/chat')&&r.request().method()==='POST',{timeout:30000});
  await page.goto(url,{waitUntil:'networkidle0'});const response=await observed;assert.equal(response.status(),200);const initialResponse=await initial;const initialData=await initialResponse.json();assert.equal(initialResponse.status(),200,JSON.stringify(initialData));assert.equal(initialData.state,'idle',JSON.stringify(initialData));await page.waitForFunction(()=>document.getElementById('notice').textContent.includes('Starter: idle'));
  assert.equal(await page.evaluate(()=>isSecureContext),true);assert.equal(await page.evaluate(()=>document.cookie.includes('__Host-ks293-session=')),false);
  const cookie=(await context.cookies()).find(v=>v.name==='__Host-ks293-session');assert.ok(cookie.secure&&cookie.httpOnly&&cookie.sameSite==='Strict');
  const fields=await fieldRead(page);const template=JSON.parse(fields['template-identity']);assert.deepEqual(template.identity,cfg.identities[tenant]);
  contexts[tenant]=context;pages[tenant]=page;
  record('actual-verified-TLS-non-admin-browser-'+tenant,{httpStatus:200,browser:await browser.version(),secureContext:true,sessionHttpOnly:true,certificateVerificationDisabled:false,actualHeldTemplate:template});
 }
 const a=pages['tenant-a'],b=pages['tenant-b'];
 const catalog=await clickObserved(a,'#catalog-run','run');assert.equal(catalog.status,200);assert.equal(catalog.body.state,'succeeded');assert.deepEqual(catalog.body.result.observedValue,['dbo.customers','dbo.orders']);
 await a.waitForFunction(()=>document.getElementById('business-status').textContent.startsWith('VALUE_VERIFIED'));
 assert.ok((await fieldRead(a)).observed.includes('dbo.orders'));assert.equal((await post(b,command('status'))).body.state,'idle');
 await a.screenshot({path:cfg.output+'/actual-catalog-desktop.png',fullPage:true});record('actual-separate-catalog-browser-and-native-result',{response:catalog,renderedFields:await fieldRead(a)});
 const metric=await clickObserved(a,'#metric-run','run');assert.equal(metric.status,200);assert.equal(metric.body.state,'succeeded');assert.equal(metric.body.result.expectedValue,90000);assert.equal(metric.body.result.observedValue,90000);
 await a.waitForFunction(()=>document.getElementById('observed').textContent==='90000 EUR_MINOR');
 const metricFields=await fieldRead(a);assert.ok(metricFields['first-value'].includes('Browser'));assert.ok(metricFields['first-value'].includes('humanUsability: NOT_OBSERVED'));
 await a.screenshot({path:cfg.output+'/actual-metric-desktop.png',fullPage:true});record('actual-separate-metric-browser-and-bound-result',{response:metric,renderedFields:metricFields});
 const repeatedStatus=await clickObserved(a,'#refresh','status');assert.equal(repeatedStatus.status,200);assert.equal((await fieldRead(a))['first-value'],metricFields['first-value']);record('actual-browser-first-value-frozen-after-status-refresh',{firstValue:metricFields['first-value']});
 const helper=await clickObserved(a,'#helper','suggest');assert.equal(helper.status,200);assert.equal(helper.body.dispatchAuthorized,false);assert.equal(helper.body.modelCalled,false);assert.equal(helper.body.suggestion.type,'STARTER_JOURNEY');
 await a.waitForFunction(()=>document.getElementById('suggestion').textContent.includes('dispatchAuthorized: false'));record('actual-typed-proposal-only-helper-browser',{response:helper,rendered:await a.$eval('#suggestion',n=>n.textContent)});
 const admin=await a.evaluate(async()=>{const r=await fetch(location.pathname+'v1/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'publish'})});return{status:r.status,body:await r.json()};});assert.equal(admin.status,404);record('actual-browser-admin-route-denied',admin);
 for(const [id,extra] of [['unchecked-upload',{upload:{name:'unchecked.csv',content:'synthetic'}}],['free-shell',{shell:'arbitrary'}],['free-url',{url:'https://not-owned.invalid'}],['caller-role',{role:'admin'}]]){
  const denied=await post(a,command('run',{journey:'metric',operationId:'metric-browser-negative-'+id,...extra}));assert.equal(denied.status,400);assert.equal(denied.body.code,'H03_BROWSER_COMMAND_DENIED');record('actual-browser-'+id+'-denied',denied);
 }
 const foreign=await post(a,command('reset',{instanceId:cfg.identities['tenant-b'].instanceId,expectedGeneration:1}));assert.equal(foreign.status,400);assert.equal(foreign.body.code,'H03_RESET_BINDING_DENIED');record('actual-browser-foreign-instance-reset-denied',foreign);
 const bBefore=await post(b,command('status'));const reset=await clickObserved(a,'#reset','reset');assert.equal(reset.status,200);assert.equal(reset.body.state,'idle');assert.equal(reset.body.starterGeneration,2);
 await a.waitForFunction(()=>document.getElementById('observed').textContent==='—');assert.deepEqual((await post(b,command('status'))).body,bBefore.body);record('actual-browser-own-reset-other-tenant-unchanged',reset);
 // Owned harness modification of the existing calculation input, never a mock
 // response, replacement calculation engine, client authority or production data.
 await mutate('wrong-value');
 const wrong=await clickObserved(b,'#metric-run','run');assert.equal(wrong.status,200);assert.equal(wrong.body.state,'failed');assert.equal(wrong.body.result.expectedValue,90000);assert.equal(wrong.body.result.observedValue,91000);
 await b.waitForFunction(()=>document.getElementById('business-status').textContent==='VALUE_MISMATCH');assert.equal((await b.$eval('#business-status',n=>n.className)),'failed');
 await b.screenshot({path:cfg.output+'/actual-wrong-value-browser.png',fullPage:true});record('actual-browser-wrong-actual-business-value-not-UI-success',{response:wrong,renderedFields:await fieldRead(b)});
 await mutate('delay-a');
 await a.bringToFront();
 const running=waitActionResponse(a,'run').then(async r=>({status:r.status(),body:await r.json()}));
 await a.click('#metric-run');await a.waitForFunction(()=>!document.getElementById('abort').disabled);
 await mutate('await-child-a');
 const abort=await clickObserved(a,'#abort','abort');assert.equal(abort.status,200);assert.equal(abort.body.state,'abort_requested');const aborted=await running;assert.equal(aborted.body.state,'aborted');assert.equal(aborted.body.result,null);
 await a.waitForFunction(()=>!document.getElementById('reset').disabled);record('actual-non-admin-browser-abort-known-child-completion',{abort,aborted});
 await clickObserved(a,'#reset','reset');await a.waitForFunction(()=>document.getElementById('notice').textContent.includes('Generation 3'));
 const interrupted=waitActionResponse(a,'run').then(async r=>({status:r.status(),body:await r.json()}));
 await a.click('#metric-run');await a.waitForFunction(()=>!document.getElementById('abort').disabled);await mutate('await-child-a');
 const restartObservation=JSON.parse(await mutate('kill-restart-control-a'));await interrupted;
 // Reacquire the real control process epoch; never reuse old generation-1
 // session authority against a new generation-2 native control process.
 await new Promise(resolve=>gateway.server.close(resolve));
 const newTenants=cfg.tenants.map(t=>t.routeBinding.tenantId==='tenant-a'?{...t,stateRoot:path.join(cfg.driverOwnedState,'tenant-a/sessions-start2'),routeBinding:{...t.routeBinding,generation:2}}:t);
 gateway=createH02OptionalNativeIngressV1({optIn:true,source,origin,tls:cfg.tls,tenants:newTenants});
 await new Promise((resolve,reject)=>gateway.server.once('error',reject).listen(Number(new URL(origin).port),'127.0.0.1',resolve));
 assert.equal((await post(a,command('status'))).status,401);
 const renewed=gateway.issueOwnerSession('tenant-a',{subjectId:'synthetic-h03-reader-tenant-a',role:'reader',expiresAtMs});await seed(contexts['tenant-a'],renewed,expiresAtMs);
 record('actual-control-process-reacquisition-old-session-denied',{...restartObservation,oldGenerationSessionStatus:401,newGeneration:2,agentNativeGeneration:1});
 const unknown=await clickObserved(a,'#refresh','status');assert.equal(unknown.status,200);assert.equal(unknown.body.state,'outcome_unknown');assert.equal(unknown.body.result,null);
 await a.waitForFunction(()=>document.getElementById('reset').disabled&&document.getElementById('notice').textContent.includes('outcome_unknown'));
 const unknownReset=await post(a,command('reset',{instanceId:cfg.identities['tenant-a'].instanceId,expectedGeneration:3}));assert.equal(unknownReset.status,400);assert.equal(unknownReset.body.code,'H03_RESET_OUTCOME_UNKNOWN_DENIED');
 await a.screenshot({path:cfg.output+'/actual-outcome-unknown-hold.png',fullPage:true});record('actual-browser-real-interruption-restart-UNKNOWN-reset-hold',{unknown,unknownReset,renderedFields:await fieldRead(a)});
 await b.setViewport({width:390,height:844});await b.screenshot({path:cfg.output+'/actual-browser-390px.png',fullPage:true});
 const geometry=await b.evaluate(()=>({width:innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,buttons:[...document.querySelectorAll('button')].map(e=>({id:e.id,x:e.getBoundingClientRect().x,right:e.getBoundingClientRect().right}))}));
 assert.ok(geometry.scrollWidth<=geometry.width,'no horizontal overflow; vertical scrollbar may reduce client width');assert.ok(geometry.buttons.every(e=>e.x>=0&&e.right<=390));record('actual-mobile-contained-390px-browser',geometry);
 assert.deepEqual(errors,[]);record('actual-browser-no-page-errors',{pageErrors:errors});
}catch(error){failure={name:error.name,message:error.message,stack:error.stack};for(const {tenant,page} of activePages){try{await page.screenshot({path:cfg.output+'/failure-'+tenant+'.png',fullPage:true});await writeFile(cfg.output+'/failure-'+tenant+'-rendered.txt',await page.$eval('body',n=>n.innerText));}catch{}}throw error;}
finally{
 if(browser)await browser.close();if(gateway)await new Promise(resolve=>gateway.server.close(resolve));consumer.releaseH02PanOriginSourceV1(source);await rm(profile,{recursive:true,force:true});
 await writeFile(cfg.output+'/actual-native-starter-browser-receipt.json',JSON.stringify({scope:'ACTUAL_CERTIFICATE_VERIFYING_FIREFOX_PROTECTED_NON_ADMIN_CATALOG_METRIC_AND_LIFECYCLE',tests:cases.length+(failure?1:0),pass:cases.length,fail:failure?1:0,skipped:0,cases,network,responses,phases,pageErrors:errors,failure,humanUsability:'NOT_OBSERVED',certificateErrorsIgnored:false,profileRemoved:true},null,2)+'\n');
}
