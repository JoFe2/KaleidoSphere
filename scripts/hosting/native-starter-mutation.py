import sys,json,pathlib,subprocess,time,hashlib,os
cfg=json.loads(pathlib.Path(sys.argv[1]).read_text());action=sys.argv[2]
def run(args):
 r=subprocess.run(args,text=True,capture_output=True,timeout=30)
 if r.returncode:raise RuntimeError('Owned mutation helper command failed: '+r.stderr)
 return r.stdout.strip()
def owned(cid):
 v=json.loads(run(['docker','inspect',cid]))[0]
 assert v['Id']==cid and v['Config']['Labels']['ks.owner']==cfg['owner'] and v['Config']['Labels']['ks.issue']=='294'
 return v
if action=='wrong-value':
 root=pathlib.Path(cfg['products']['tenant-b']);gp=root/'contracts/business-bi/v1/synthetic-o2c-fixture-grants-v1.json'
 grants=json.loads(gp.read_text());grant=grants['sources']['COMMON-TRADE-01'];variant=grant['variants'][grant['defaultMapping']]
 path=root/variant['path'];data=json.loads(path.read_text());assert data['sales_documents'][0]['net_absolute_minor']==80000
 data['sales_documents'][0]['net_absolute_minor']+=1000;raw=(json.dumps(data)+'\n').encode();path.write_bytes(raw)
 variant['sha256']=hashlib.sha256(raw).hexdigest();gp.write_text(json.dumps(grants)+'\n')
elif action=='delay-a':
 root=pathlib.Path(cfg['products']['tenant-a']);path=root/'scripts/run-invoice-date-o2c.mjs';text=path.read_text()
 needle="const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');";assert text.count(needle)==1
 text=text.replace(needle,needle+"\nimport{writeFileSync}from'node:fs';writeFileSync('/task/metric-child.pid',String(process.pid));await new Promise(r=>setTimeout(r,10000));")
 path.write_text(text)
elif action=='await-child-a':
 cid=cfg['controls']['tenant-a'];owned(cid);marker=pathlib.Path(cfg['state'])/'tenant-a/metric-child.pid'
 for _ in range(100):
  if marker.exists():
   pid=marker.read_text().strip();assert pid.isdigit()
   r=subprocess.run(['docker','exec',cid,'node','-e',"const f=require('fs');const p=process.argv[1];if(!f.readFileSync('/proc/'+p+'/cmdline','utf8').includes('/task/product/scripts/run-invoice-date-o2c.mjs'))process.exit(3)",pid],capture_output=True,text=True,timeout=10)
   if r.returncode==0:break
  time.sleep(.05)
 else:raise RuntimeError('Actual owned calculation child not observed')
elif action=='kill-restart-control-a':
 cid=cfg['controls']['tenant-a'];owned(cid);marker=pathlib.Path(cfg['state'])/'tenant-a/control.pid';pid=marker.read_text().strip();assert pid.isdigit()
 run(['docker','exec',cid,'node','-e',"const f=require('fs');const p=process.argv[1];const cmd=f.readFileSync('/proc/'+p+'/cmdline','utf8');if(!cmd.includes('/app/services/bi-control/src/server.mjs'))process.exit(3);process.kill(Number(p),'SIGKILL')",pid])
 run(['docker','exec','--detach',cid,'node','--input-type=module','-e',"import{writeFileSync}from'node:fs';writeFileSync('/task/control.pid',String(process.pid));await import('/app/services/bi-control/src/server.mjs');"])
 for _ in range(100):
  r=subprocess.run(['docker','exec',cid,'node','-e',"fetch('http://127.0.0.1:18089/healthz').then(r=>{if(r.status!==200)process.exit(3)}).catch(()=>process.exit(4))"],capture_output=True,text=True,timeout=10)
  if r.returncode==0 and marker.read_text().strip()!=pid:break
  time.sleep(.05)
 else:raise RuntimeError('Actual new control process not ready')
 new=marker.read_text().strip();assert new!=pid
 (pathlib.Path(cfg['state'])/'tenant-a/sessions-start2').mkdir(mode=0o700)
 print(json.dumps({'oldPid':pid,'newPid':new,'nativeControlGeneration':2,'agentRestarted':False}))
else:raise RuntimeError('Unknown owned test operation')
