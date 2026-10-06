import sys,json,pathlib,subprocess,time,hashlib,os,re
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text());action=sys.argv[2]
assert re.fullmatch(r'ks282native[a-f0-9]{12}',cfg['owner'])
assert action in ['wrong-value','delay-a','await-child-a','kill-restart-control-a','epic-budget','epic-export-restore','epic-cleanup-reacquire']
state=pathlib.Path(cfg['state']);assert state.is_dir() and not state.is_symlink() and state.stat().st_uid==os.getuid() and state.stat().st_mode&0o077==0
root=state/'tenant-a';cid=cfg['controls']['tenant-a'];diagnostics=[]
def run(args,timeout=30,expected=0):
 r=subprocess.run(args,text=True,capture_output=True,timeout=timeout)
 if r.stderr:diagnostics.append({'command':args,'exit':r.returncode,'stderr':r.stderr})
 if r.returncode!=expected:raise RuntimeError(json.dumps({'command':args,'exit':r.returncode,'stdout':r.stdout,'stderr':r.stderr}))
 return r.stdout.strip()
def owned(container):
 v=json.loads(run(['docker','inspect',container]))[0]
 assert v['Id']==container and v['Config']['Labels']['ks.owner']==cfg['owner'] and v['Config']['Labels']['ks.issue']=='282'
 return v
owned(cid)
def observe(which):return json.loads(run(['docker','exec',cid,'node','/app/scripts/hosting/host-epic-native-owner-probe.mjs',which]))
def record(value):print(json.dumps({'owner':cfg['owner'],'controlContainerId':cid,'nativeDiagnostics':diagnostics,**value}))
def cli(command,target=None,generation=None,key='/task/h282-key32',expected=0):
 args=['docker','exec',cid,'node','/app/scripts/hosting/portable-runtime.mjs',command,'--local-synthetic-opt-in','--key-file',key,'--bundle','/task/h282-retained.ksbundle']
 args+=['--receipt-dir','/task/receipts'] if command=='export' else ['--target-root',target,'--generation',generation]
 if expected==0:return json.loads(run(args))
 r=subprocess.run(args,text=True,capture_output=True,timeout=30);assert r.returncode==expected
 diagnostics.append({'command':args,'exit':r.returncode,'stderr':r.stderr})
 lines=[line for line in r.stderr.splitlines() if line.startswith('{')];assert len(lines)==1
 return json.loads(lines[0])
def stop(signal='SIGTERM'):
 pid=(root/'control.pid').read_text().strip();assert pid.isdigit()
 run(['docker','exec',cid,'node','-e',"const f=require('fs'),p=process.argv[1];if(!f.readFileSync('/proc/'+p+'/cmdline','utf8').includes('/app/services/bi-control/src/server.mjs'))process.exit(3);process.kill(Number(p),process.argv[2]);",pid,signal])
 for _ in range(100):
  v=run(['docker','exec',cid,'node','-e',"const f=require('fs'),p=process.argv[1];let live=false;try{const s=f.readFileSync('/proc/'+p+'/stat','utf8');live=s.slice(s.lastIndexOf(')')+2).split(' ')[0]!=='Z'}catch{};console.log(JSON.stringify({executing:live}))",pid])
  if not json.loads(v)['executing']:break
  time.sleep(.05)
 else:raise RuntimeError('Owned source native control did not stop')
 return pid
def start(index,old,epoch):
 assert index in [1,2] and epoch in [2,3,4]
 directory='/task/h282-restore'+str(index)
 run(['docker','exec','--detach','--env','RECEIPT_DIR='+directory+'/receipts','--env','PROJECTION_DB='+directory+'/projection/analytics.db',cid,'node','--input-type=module','-e',"import{writeFileSync}from'node:fs';writeFileSync('/task/control.pid',String(process.pid));await import('/app/services/bi-control/src/server.mjs');"])
 for _ in range(100):
  check=subprocess.run(['docker','exec',cid,'node','-e',"fetch('http://127.0.0.1:18089/healthz',{signal:AbortSignal.timeout(500)}).then(r=>{if(r.status!==200)process.exit(3)}).catch(()=>process.exit(4))"],text=True,capture_output=True,timeout=10)
  if check.returncode==0 and (root/'control.pid').read_text().strip()!=old:break
  time.sleep(.05)
 else:raise RuntimeError('Owned restored native control not ready')
 new=(root/'control.pid').read_text().strip();assert new!=old
 (root/('sessions-epoch-'+str(epoch))).mkdir(mode=0o700)
 return {'oldPid':old,'newPid':new,'nativeControlGeneration':epoch,'agentRestarted':False,'restoredIndex':index}
flowFile=root/'h282-native-flow-state.json'
if action=='epic-budget':
 record({'budget':observe('budget')})
elif action=='epic-export-restore':
 before=observe('readback');assert before['starter']['result']['journey']=='catalog'
 assert before['starter']['result']['evidence']['receiptId']==before['question']['provenance']['receiptId']
 assert before['starter']['result']['evidence']['snapshotSha256']==before['question']['provenance']['snapshotSha256']
 generation=before['readback']['generationId'];assert re.fullmatch('[a-f0-9]{64}',generation)
 old=stop();key=root/'h282-key32';fd=os.open(key,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 try:os.write(fd,os.urandom(32))
 finally:os.close(fd)
 exported=cli('export');assert exported['checkpoint']['generationId']==generation and exported['runtimeReadyClaimed'] is False
 projectionSha=exported['checkpoint']['files'][0]['sha256'];backupSha=exported['bundleSha256']
 wrong=root/'h282-wrong-key32';fd=os.open(wrong,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 try:os.write(fd,os.urandom(32))
 finally:os.close(fd)
 badKeyCli=cli('restore','/task/h282-bad-key',generation,key='/task/h282-wrong-key32',expected=1);assert badKeyCli['reason']=='H08_LIFECYCLE_RESTORE_DENIED'
 badKey=json.loads((root/'h282-bad-key/quarantine.json').read_text());assert badKey['state']=='QUARANTINED' and badKey['reason']=='H08_BUNDLE_INVALID' and badKey['candidateActivated'] is False and badKey['quarantinePersisted'] is True
 badKey['actualLifecycleCliDenial']=badKeyCli
 badGenerationCli=cli('restore','/task/h282-bad-generation','f'*64,expected=1);assert badGenerationCli['reason']=='H08_LIFECYCLE_RESTORE_DENIED'
 badGeneration=json.loads((root/'h282-bad-generation/quarantine.json').read_text());assert badGeneration['state']=='QUARANTINED' and badGeneration['reason']=='H08_CHECKPOINT_MISMATCH' and badGeneration['candidateActivated'] is False and badGeneration['quarantinePersisted'] is True
 badGeneration['actualLifecycleCliDenial']=badGenerationCli
 descendantCli=cli('restore','/task/receipts/forbidden-epic-child',generation,expected=1);assert descendantCli['reason']=='H08_LIFECYCLE_RESTORE_DENIED'
 descendant=json.loads(run(['docker','exec',cid,'node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{restoreH08BundleV1}from'/app/services/bi-control/src/hosting/portable-runtime.mjs';const key=readFileSync('/task/h282-key32');try{console.log(JSON.stringify(restoreH08BundleV1({optIn:true,key,bundlePath:'/task/h282-retained.ksbundle',targetRoot:'/task/receipts/forbidden-epic-child',expectedGeneration:process.argv[1]})))}finally{key.fill(0)}",generation]));assert descendant['reason']=='H08_ORIGINAL_STORE_RESTORE_DENIED' and descendant['quarantinePersisted'] is False
 descendant['actualLifecycleCliDenial']=descendantCli
 assert not (root/'receipts/forbidden-epic-child').exists()
 assert hashlib.sha256((root/'h282-retained.ksbundle').read_bytes()).hexdigest()==backupSha
 originProjection=root/'receipts/.ks254-generations/generations'/generation/'analytics.db';assert hashlib.sha256(originProjection.read_bytes()).hexdigest()==projectionSha
 restored=cli('restore','/task/h282-restore1',generation);assert restored['state']=='RESTORED_LOCAL' and restored['runtimeReadyClaimed'] is False
 restart=start(1,old,2);after=observe('readback')
 assert after['readback']['generationId']==generation and after['question']['rows']==before['question']['rows'] and after['question']['provenance']==before['question']['provenance']
 assert after['starter']==before['starter'] and after['nativeBudgetRows']==before['nativeBudgetRows']
 assert hashlib.sha256((root/'h282-restore1/projection/analytics.db').read_bytes()).hexdigest()==projectionSha
 flow={'generationId':generation,'originProjectionSha256':projectionSha,'backupSha256':backupSha,'originalReadback':before,'restoredReadback':after,'restart':restart,'restoredIndex':1,'controlEpoch':2}
 flowFile.write_text(json.dumps(flow)+'\n');flowFile.chmod(0o600)
 record({'before':before,'exported':exported,'badKey':badKey,'badGeneration':badGeneration,'descendant':descendant,'restored':restored,'restart':restart,'after':after,'sourceAndBackupByteIdentical':True})
elif action=='epic-cleanup-reacquire':
 flow=json.loads(flowFile.read_text());assert flow['restoredIndex']==1 and flow['controlEpoch']==2;generation=flow['generationId']
 wrong=cli('tombstone','/task/h282-restore1','f'*64,expected=1);assert wrong['reason']=='H08_LIFECYCLE_BINDING_DENIED'
 premature=cli('cleanup','/task/h282-restore1',generation,expected=1);assert premature['reason']=='H08_TOMBSTONE_REQUIRED'
 old=stop();tombstone=cli('tombstone','/task/h282-restore1',generation);assert tombstone['state']=='TOMBSTONED' and tombstone['restoredDataRemoved'] is False
 foreign=root/'h282-restore1/foreign-resource';foreign.write_text('OWNED_TEST_SENTINEL_NOT_ALLOWED_TO_CLEAN');foreign.chmod(0o600)
 denied=cli('cleanup','/task/h282-restore1',generation,expected=1);assert denied['reason']=='H08_FOREIGN_RESOURCE_DENIED' and foreign.read_text()=='OWNED_TEST_SENTINEL_NOT_ALLOWED_TO_CLEAN'
 assert (root/'h282-restore1/receipts').is_dir();foreign.unlink()
 cleaned=cli('cleanup','/task/h282-restore1',generation);assert cleaned['state']=='SCOPED_DATA_REMOVED' and cleaned['externalBackupErasure']=='UNKNOWN' and cleaned['declaredBackupRetained']
 assert not (root/'h282-restore1/receipts').exists() and not (root/'h282-restore1/projection').exists()
 assert hashlib.sha256((root/'h282-retained.ksbundle').read_bytes()).hexdigest()==flow['backupSha256']
 assert hashlib.sha256((root/'receipts/.ks254-generations/generations'/generation/'analytics.db').read_bytes()).hexdigest()==flow['originProjectionSha256']
 restored=cli('restore','/task/h282-restore2',generation);assert restored['state']=='RESTORED_LOCAL'
 restart=start(2,old,3);after=observe('readback')
 assert after['readback']['generationId']==generation and after['question']['rows']==flow['originalReadback']['question']['rows'] and after['question']['provenance']==flow['originalReadback']['question']['provenance']
 assert after['nativeBudgetRows']==flow['originalReadback']['nativeBudgetRows']
 flow.update({'restoredIndex':2,'controlEpoch':3,'reacquiredReadback':after,'reacquiredRestart':restart});flowFile.write_text(json.dumps(flow)+'\n')
 record({'wrongGeneration':wrong,'prematureCleanup':premature,'tombstone':tombstone,'foreignResourceDenial':denied,'cleaned':cleaned,'restored':restored,'restart':restart,'after':after,'sourceAndBackupByteIdentical':True,'qualifiedOriginalSourceRetained':True})
elif action=='kill-restart-control-a':
 flow=json.loads(flowFile.read_text());assert flow['restoredIndex']==2 and flow['controlEpoch']==3
 old=stop('SIGKILL');restart=start(2,old,4);record(restart)
elif action=='wrong-value':
 product=pathlib.Path(cfg['products']['tenant-b']);gp=product/'contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json'
 grants=json.loads(gp.read_text());grant=grants['sources']['COMMON-TRADE-01'];variant=grant['variants'][grant['defaultMapping']]
 file=product/variant['path'];data=json.loads(file.read_text());assert data['sales_documents'][0]['net_absolute_minor']==80000
 data['sales_documents'][0]['net_absolute_minor']+=1000;raw=(json.dumps(data)+'\n').encode();file.write_bytes(raw)
 variant['sha256']=hashlib.sha256(raw).hexdigest();gp.write_text(json.dumps(grants)+'\n')
elif action=='delay-a':
 file=pathlib.Path(cfg['products']['tenant-a'])/'scripts/run-invoice-date-o2c.mjs';text=file.read_text()
 needle="const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');";assert text.count(needle)==1
 text=text.replace(needle,needle+"\nimport{writeFileSync}from'node:fs';writeFileSync('/task/metric-child.pid',String(process.pid));await new Promise(r=>setTimeout(r,10000));");file.write_text(text)
elif action=='await-child-a':
 marker=root/'metric-child.pid'
 for _ in range(100):
  if marker.exists():
   pid=marker.read_text().strip();assert pid.isdigit()
   check=subprocess.run(['docker','exec',cid,'node','-e',"const f=require('fs'),p=process.argv[1];if(!f.readFileSync('/proc/'+p+'/cmdline','utf8').includes('/task/product/scripts/run-invoice-date-o2c.mjs'))process.exit(3)",pid],capture_output=True,text=True,timeout=10)
   if check.returncode==0:break
  time.sleep(.05)
 else:raise RuntimeError('Actual owned calculation child not observed')
