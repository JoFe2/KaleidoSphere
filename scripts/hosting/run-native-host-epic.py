import datetime,hashlib,json,os,pathlib,secrets,shutil,socket,subprocess,sys,tempfile,time,uuid
REPO=pathlib.Path(os.environ.get('KS282_REPO',pathlib.Path(__file__).resolve().parents[2])).resolve();OUT=pathlib.Path(os.environ['KS282_OUTPUT']).resolve()
OUT.mkdir(parents=True,exist_ok=False,mode=0o700)
SCRATCH=pathlib.Path(os.environ['TMPDIR']).resolve();STATE=pathlib.Path(tempfile.mkdtemp(prefix='ks294-native-owned-',dir=SCRATCH));STATE.chmod(0o700)
OWNER='ks282native'+uuid.uuid4().hex[:12]
CONTROL_IMAGE='sha256:b9829bd06c4dcd03b70ae9365058a95fb9fa9ef8cc9bf84f5890e2a02bf04e86'
AGENT_IMAGE='sha256:8d36d93aa4c04bd1578432744df073a8d7963c415f628d79013cf32df25ed386'
PAN=pathlib.Path(os.environ['KS_H05_PAN_SOURCE_ROOT']).resolve();SESSION=os.environ['KS293_PAN527_SESSION_SOURCE']
BROWSER_ROOT=pathlib.Path(os.environ['KS282_BROWSER_WORKSPACE']).resolve();CERTUTIL=os.environ['KS282_CERTUTIL']
BROWSER=pathlib.Path(os.environ.get('KS282_BROWSER_PROBE',REPO/'scripts/hosting/native-host-epic-browser.mjs')).resolve();MUTATION=pathlib.Path(os.environ.get('KS282_MUTATION_HELPER',REPO/'scripts/hosting/native-host-epic-owner.py')).resolve()
containers=[];networks=[];identities={};tenants=[];controls={};products={};tokens=[]
receipt={'scope':'OWNED_CONNECTED_NATIVE_HOST_EPIC_WITH_EXACT_READ_ONLY_SOURCE_OVERLAYS_NOT_REBUILT_IMAGE_OR_RELEASE','owner':OWNER,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'IN_PROGRESS','images':{'agent':AGENT_IMAGE,'control':CONTROL_IMAGE},'actualNativeProcesses':[],'humanUsability':'NOT_OBSERVED','extraWorkers':False}
def run(args,timeout=60):
 r=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if r.returncode:raise RuntimeError(json.dumps({'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}))
 return r.stdout.strip()
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def sha(value):return hashlib.sha256(json.dumps(value,sort_keys=True).encode()).hexdigest()
def inspect(cid):
 v=json.loads(run(['docker','inspect',cid]))[0];assert v['Id']==cid and v['Config']['Labels']['ks.owner']==OWNER and v['Config']['Labels']['ks.issue']=='282';return v
try:
 supplied=[os.environ.get('KS282_SOURCE_COMMIT'),os.environ.get('KS282_SOURCE_TREE')]
 gitRoot=subprocess.run(['git','-C',str(REPO),'rev-parse','--show-toplevel'],capture_output=True,text=True)
 if gitRoot.returncode==0:
  assert gitRoot.stdout.strip()==str(REPO),'Native source must be the exact checkout root, not its outer repository'
  head=run(['git','-C',str(REPO),'rev-parse','HEAD']);tree=run(['git','-C',str(REPO),'rev-parse','HEAD^{tree}']);assert run(['git','-C',str(REPO),'status','--porcelain=v1','--untracked-files=no'])==''
  if any(supplied):assert supplied==[head,tree],'Supplied source binding differs from actual Git input'
  receipt['sourceIdentityAcquisition']='EXACT_CLEAN_GIT_CHECKOUT'
 else:
  # Archive mode is an owner-side declaration for an independently byte-bound
  # anonymous source artifact, never a browser authority or native readiness grant.
  import re
  assert all(isinstance(v,str) and re.fullmatch('[a-f0-9]{40}',v) for v in supplied),'Anonymous extracted product requires exact owner-bound commit AND tree'
  head,tree=supplied;receipt['sourceIdentityAcquisition']='OWNER_BOUND_ANONYMOUS_ARCHIVE_REQUIRES_SEPARATE_FULL_BYTE_READBACK'
 receipt.update({'sourceCommit':head,'sourceTree':tree})
 pins={name:digest(REPO/name) for name in ['services/bi-agent/src/server.mjs','services/bi-agent/src/browser-starter-page.mjs','services/bi-control/src/server.mjs','services/bi-control/src/hosting/browser-starter.mjs','services/bi-control/src/hosting/browser-starter-store.mjs','services/bi-control/src/hosting/origin-session-ingress.mjs','services/bi-control/src/runtime/pan-origin-source.mjs','scripts/run-invoice-date-o2c.mjs']}
 receipt['exactProductPins']=pins
 receipt['exactEpicInputPins']={name:digest(REPO/name) for name in ['scripts/hosting/run-native-host-epic.py','scripts/hosting/native-host-epic-browser.mjs','scripts/hosting/native-host-epic-owner.py','scripts/hosting/host-epic-native-owner-probe.mjs','scripts/hosting/host-epic-native-budget-request.mjs','scripts/hosting/host-epic-native-receipt.mjs','services/bi-control/src/hosting/portable-runtime.mjs','services/bi-control/src/hosting/portable-runtime-lifecycle.mjs','services/bi-control/src/runtime/h05-native-broker-runtime.mjs']}
 for tenant in ['tenant-a','tenant-b']:
  root=STATE/tenant;root.mkdir(mode=0o700)
  for name in ['owner','starter-state','receipts','projection','sessions','tmp','product']:(root/name).mkdir(mode=0o700)
  product=root/'product';products[tenant]=str(product)
  for name in ['scripts','examples/o2c','contracts/business-bi','services/bi-control/src/business-bi']:
   (product/name).parent.mkdir(parents=True,exist_ok=True)
   if name=='scripts':(product/name).mkdir();shutil.copy2(REPO/name/'run-invoice-date-o2c.mjs',product/name/'run-invoice-date-o2c.mjs')
   else:shutil.copytree(REPO/name,product/name)
  token=secrets.token_hex(32);tokens.append(token);(root/'control-auth').write_text(token);(root/'control-auth').chmod(0o600)
  network=run(['docker','network','create','--label','ks.owner='+OWNER,'--label','ks.issue=282',OWNER+'-'+tenant]);networks.append(network)
  identity={'schemaVersion':'pansphaira.portable-runtime/identity/v1','componentId':'kaleidosphere-bi-agent','sourceCommit':head,'sourceTree':tree,'imageDigest':AGENT_IMAGE,'architecture':'x86_64','productVersion':'0.26.0','runtime':{'name':'node','version':'24.14.0'},'contractVersion':'1.0.0','instanceId':OWNER+'-'+tenant+'-agent','tenantId':tenant,'generation':1,'authorityProfile':'SAFE_GUIDED','effectiveRights':['bi.catalog.read'],'configurationDigest':sha({'tenant':tenant,'starterBound':128}),'templateDigest':sha(pins),'policyDigest':sha({'source':'BUNDLED_SYNTHETIC_ONLY','admin':False,'model':False,'reset':'OWN_STARTER_ONLY'}),'networkDigest':sha({'network':network,'internal':False,'hostExposure':'LOOPBACK_ONLY','control':'loopback'})}
  identities[tenant]=identity;(root/'owner/identity.json').write_text(json.dumps(identity));(root/'owner/identity.json').chmod(0o400)
  common=['--detach','--read-only','--user',f'{os.getuid()}:{os.getgid()}','--memory','512m','--cpus','1','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges','--label','ks.issue=282','--label','ks.owner='+OWNER,'--label','ks.tenant='+tenant,'--tmpfs','/tmp:rw,nosuid,nodev,size=32m']
  control=run(['docker','run','--name',OWNER+'-'+tenant+'-control',*common,'--network',network,'--add-host','bi-control:127.0.0.1','--publish','127.0.0.1::18790',
   '--mount',f'type=bind,src={root},dst=/task','--mount',f'type=bind,src={REPO / "services/bi-control/src"},dst=/app/services/bi-control/src,readonly',
   '--mount',f'type=bind,src={REPO / "scripts"},dst=/app/scripts,readonly','--mount',f'type=bind,src={REPO / "contracts"},dst=/app/contracts,readonly',
   '--mount',f'type=bind,src={PAN},dst={PAN},readonly',
   '--env','CONTROL_TOKEN_FILE=/task/control-auth','--env','RECEIPT_DIR=/task/receipts','--env','PROJECTION_DB=/task/projection/analytics.db',
   '--env','REPOSITORY_ROOT=/app/services/bi-control','--env','CONTROL_BIND_ADDRESS=127.0.0.1','--env','BI_SOURCE_MODE=fixture','--env','BI_ENGINE=mssql',
   '--env','KS_H03_STARTER_OPT_IN=true','--env','KS_H03_OWNER_ROOT=/task/owner','--env','KS_H03_STATE_ROOT=/task/starter-state','--env','KS_H03_TENANT_ID='+tenant,
   '--env','KS_H03_PAN_SOURCE_ROOT='+str(PAN),'--env','KS_H03_PRODUCT_ROOT=/task/product','--env','TMPDIR=/task/tmp',CONTROL_IMAGE,'node','-e','setInterval(()=>{},60000)'])
  containers.append(control);controls[tenant]=control
  run(['docker','exec','--detach',control,'node','--input-type=module','-e',"import{writeFileSync}from'node:fs';writeFileSync('/task/control.pid',String(process.pid));await import('/app/services/bi-control/src/server.mjs');"])
  agent=run(['docker','run','--name',identity['instanceId'],*common,'--network','container:'+control,
   '--mount',f'type=bind,src={REPO / "services/bi-agent/src"},dst=/app/src,readonly','--mount',f'type=bind,src={root / "control-auth"},dst=/run/secrets/control-auth,readonly',
   '--env','CONTROL_TOKEN_FILE=/run/secrets/control-auth','--env','CONTROL_BASE_URL=http://bi-control:18089','--env','AGENT_ROUTE_PREFIX=/t/'+tenant,'--env','KS_H03_STARTER_OPT_IN=true',AGENT_IMAGE])
  containers.append(agent)
  for attempt in range(100):
   r=subprocess.run(['docker','exec',control,'node','-e',"fetch('http://127.0.0.1:18089/healthz').then(r=>{if(r.status!==200)process.exit(3)}).catch(()=>process.exit(4))"],text=True,capture_output=True,timeout=10)
   if r.returncode==0:break
   time.sleep(.1)
  else:raise RuntimeError('Actual H03 control not ready for '+tenant)
  for cid,role in [(control,'control'),(agent,'agent')]:
   data=inspect(cid);version=run(['docker','exec',cid,'node','--version']);assert version=='v24.14.0';assert data['Image']==(CONTROL_IMAGE if role=='control' else AGENT_IMAGE)
   entry='/app/services/bi-control/src/server.mjs' if role=='control' else '/app/src/server.mjs'
   actual=run(['docker','exec',cid,'node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{createHash}from'node:crypto';console.log(createHash('sha256').update(readFileSync(process.argv[1])).digest('hex'))",entry])
   assert actual==pins['services/bi-'+role+'/src/server.mjs']
   receipt['actualNativeProcesses'].append({'containerId':cid,'imageId':data['Image'],'name':data['Name'],'role':role,'tenantId':tenant,'node':version,'entrypointSha256':actual,'sourceOverlayReadOnly':True})
  exposure=inspect(control)['NetworkSettings']['Ports']['18790/tcp'];assert len(exposure)==1 and exposure[0]['HostIp']=='127.0.0.1'
  binding={'schemaVersion':'pansphaira.hosted-origin-session/protected-route-binding/v1','componentId':'kaleidosphere-bi-control','entrypointPath':'services/bi-control/src/server.mjs','sourceCommit':head,'sourceTree':tree,'entrypointSha256':pins['services/bi-control/src/server.mjs'],'runtime':identity['runtime'],'instanceId':OWNER+'-'+tenant+'-control','tenantId':tenant,'generation':1}
  tenants.append({'routeBinding':binding,'stateRoot':str(root/'sessions'),'agentOrigin':'http://127.0.0.1:'+exposure[0]['HostPort']})
 key,cert,ca_key,ca,csr=[STATE/name for name in ['tls.key','tls.crt','ca.key','ca.crt','tls.csr']]
 run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(ca_key),'-out',str(ca),'-days','1','-subj','/CN=ks294-owned-test-CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'])
 run(['openssl','req','-new','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(csr),'-subj','/CN=ks294.test'])
 extensions=STATE/'leaf.cnf';extensions.write_text('basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:ks294.test\n')
 run(['openssl','x509','-req','-in',str(csr),'-CA',str(ca),'-CAkey',str(ca_key),'-set_serial','1','-out',str(cert),'-days','1','-sha256','-extfile',str(extensions)])
 for p in [key,cert,ca_key,ca,csr,extensions]:p.chmod(0o600)
 assert run(['openssl','verify','-CAfile',str(ca),'-purpose','sslserver','-verify_ip','127.0.0.1',str(cert)])==str(cert)+': OK'
 receipt['verifiedTLS']={'caSha256':digest(ca),'leafSha256':digest(cert),'systemTrustChanged':False,'certificateVerificationDisabled':False}
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
 stateInput=OUT/'owned-mutation-input.json';stateInput.write_text(json.dumps({'owner':OWNER,'state':str(STATE),'controls':controls,'products':products}));stateInput.chmod(0o400)
 cfg={'repo':str(REPO),'sessionSource':SESSION,'browserWorkspace':str(BROWSER_ROOT),'firefoxPath':'/usr/bin/firefox','certutil':CERTUTIL,'httpsOrigin':'https://127.0.0.1:'+str(port),'caPath':str(ca),'tls':{'keyPath':str(key),'certPath':str(cert)},'tenants':tenants,'identities':identities,'output':str(OUT),'mutationHelper':str(MUTATION),'driverState':str(stateInput),'driverOwnedState':str(STATE)}
 config=OUT/'browser-input.json';config.write_text(json.dumps(cfg,indent=2)+'\n');config.chmod(0o400)
 receipt['protectedBindings']=tenants;receipt['identityInputs']=identities
 r=subprocess.run(['node',str(BROWSER),str(config)],text=True,capture_output=True,timeout=300)
 (OUT/'browser.stdout').write_text(r.stdout);(OUT/'browser.stderr').write_text(r.stderr)
 assert not any(t in r.stdout+r.stderr for t in tokens),'Synthetic token canary leaked'
 if r.returncode:raise RuntimeError('Actual protected native browser failed: '+r.stderr)
 browser=json.loads((OUT/'actual-native-starter-browser-receipt.json').read_text());assert browser['fail']==0 and browser['skipped']==0 and browser['pass']==browser['tests']==len(browser['cases'])
 assert pins=={name:digest(REPO/name) for name in pins}
 assert browser['hostEpicFlow']['owner']==OWNER and browser['hostEpicFlow']['sourceCommit']==head and browser['hostEpicFlow']['sourceTree']==tree
 assert len(browser['cases'])==25
 assert receipt['exactEpicInputPins']=={name:digest(REPO/name) for name in receipt['exactEpicInputPins']}
 receipt.update({'status':'PASS_ACTUAL_NATIVE_DEVELOPMENT_SCOPE','browserPass':browser['pass'],'browserFail':0,'browserSkip':0,'connectedHostEpicFlow':browser['hostEpicFlow']})
 print(r.stdout)
except Exception as error:
 receipt['status']='FAIL_PRESERVED';receipt['failure']=str(error);raise
finally:
 diagnostics=[]
 for tenant,cid in controls.items():
  try:
   data=inspect(cid)
   actual=run(['docker','exec',cid,'node','--input-type=module','-e',"import{DatabaseSync}from'node:sqlite';const d=new DatabaseSync('/task/starter-state/ks294-starter.sqlite',{readOnly:true});console.log(JSON.stringify({owner:d.prepare('SELECT generation,state,operation_id FROM owner').get(),operations:d.prepare('SELECT operation_id,generation,state FROM operations').all()}));d.close();"]) if data['State']['Running'] and (STATE/tenant/'starter-state/ks294-starter.sqlite').is_file() else None
   if actual:(OUT/(tenant+'-actual-native-state-readback.json')).write_text(actual+'\n')
  except Exception as error:diagnostics.append({'tenant':tenant,'phase':'state-readback','error':str(error)})
 # Recover only exact labels from this invocation, including a failed Docker
 # start that created an owned stopped container before returning an error.
 remaining=run(['docker','ps','-a','--no-trunc','--filter','label=ks.owner='+OWNER,'--format','{{.ID}}']).splitlines()
 for cid in remaining:
  data=inspect(cid);r=subprocess.run(['docker','logs',cid],text=True,capture_output=True,timeout=20)
  text=r.stdout+r.stderr
  if any(token in text for token in tokens):diagnostics.append({'container':cid,'phase':'logs','error':'TOKEN_CANARY_LEAK_LOG_NOT_PERSISTED'})
  else:
   (OUT/(data['Name'].lstrip('/')+'.stdout')).write_text(r.stdout);(OUT/(data['Name'].lstrip('/')+'.stderr')).write_text(r.stderr)
  run(['docker','rm','--force',cid])
 for net in networks:
  v=json.loads(run(['docker','network','inspect',net]))[0];assert v['Id']==net and v['Labels']['ks.owner']==OWNER and v['Labels']['ks.issue']=='282';run(['docker','network','rm',net])
 receipt['diagnosticErrors']=diagnostics
 if diagnostics and receipt['status']=='PASS_ACTUAL_NATIVE_DEVELOPMENT_SCOPE':receipt['status']='FAIL_REQUIRED_DIRECT_NATIVE_READBACK'
 assert run(['docker','ps','-a','--filter','label=ks.owner='+OWNER,'--format','{{.ID}}'])==''
 assert run(['docker','network','ls','--filter','label=ks.owner='+OWNER,'--format','{{.ID}}'])==''
 shutil.rmtree(STATE);assert not STATE.exists()
 receipt['cleanup']={'remainingOwnedContainers':0,'remainingOwnedNetworks':0,'transientOwnedStateRemoved':True,'foreignResourcesRemoved':False,'exactOwnedReadback':True}
 receipt['endedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();(OUT/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps({'status':receipt['status'],'evidence':str(OUT),'cleanup':receipt['cleanup']}))

if receipt['status']!='PASS_ACTUAL_NATIVE_DEVELOPMENT_SCOPE':raise RuntimeError('Native starter scope not complete; preserved receipt: '+str(OUT/'receipt.json'))

qualified=run(['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{bindHostEpicNativeEvidenceV1}from'./scripts/hosting/host-epic-native-receipt.mjs';console.log(JSON.stringify(bindHostEpicNativeEvidenceV1(JSON.parse(readFileSync(process.argv[1])),JSON.parse(readFileSync(process.argv[2])))));",str(OUT/'receipt.json'),str(OUT/'actual-native-starter-browser-receipt.json')]);(OUT/'connected-epic-binding.json').write_text(qualified+'\n');print(qualified)
