"""Verify every locked compiler tarball and installed file; preserve upstream licenses.
No npm lifecycle script, global install, account, provider or production action.
"""
import base64,hashlib,io,json,pathlib,tarfile,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1]
BASE=ROOT/'dependencies/ks303-owned-browser-build'
sha=lambda b:hashlib.sha256(b).hexdigest()
lockraw=(BASE/'package-lock.json').read_bytes();lock=json.loads(lockraw)
assert json.loads((BASE/'package.json').read_bytes())['dependencies']=={'terser':'5.51.2'}
assert lock['packages']['']['dependencies']=={'terser':'5.51.2'}
manifest=BASE/'compiler-integrity-v1.json';notice=BASE/'THIRD-PARTY-LICENSES.txt'
assert not manifest.exists() and not notice.exists(),'New immutable qualification required'
packages={};licenses=['KS303 code-owned browser BUILD dependencies only. None is a new runtime grant.\n']
for path,entry in lock['packages'].items():
 if not path:continue
 assert path.startswith('node_modules/') and '..'not in pathlib.PurePosixPath(path).parts
 url=entry['resolved'];assert url.startswith('https://registry.npmjs.org/')
 with urllib.request.urlopen(url,timeout=60)as response:
  assert response.geturl()==url
  raw=response.read(8*1024*1024);assert not response.read(1),'Archive over bound'
 algorithm,expected=entry['integrity'].split('-',1);assert algorithm=='sha512'
 assert hashlib.sha512(raw).digest()==base64.b64decode(expected,validate=True)
 pins={};license_paths=[]
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')as archive:
  for member in archive:
   assert member.name.startswith('package/')
   rel=pathlib.PurePosixPath(member.name).relative_to('package');assert not rel.is_absolute() and '..'not in rel.parts
   if member.isdir():continue
   assert member.isfile(),'No compiler archive links or devices'
   stream=archive.extractfile(member);assert stream is not None
   data=stream.read();target=BASE/path/str(rel)
   assert target.is_file() and not target.is_symlink() and target.read_bytes()==data,(path,str(rel))
   pins[str(rel)]={'bytes':len(data),'sha256':sha(data)}
   if rel.name.lower()in {'license','license.md','license.txt','copying'}:
    license_paths.append(str(rel));licenses.append('\n'+path+' @ '+entry['version']+' | '+entry['license']+'\n'+data.decode()+'\n')
 assert license_paths,'Actual upstream license required'
 installed=json.loads((BASE/path/'package.json').read_bytes());assert installed['version']==entry['version']
 packages[path]={'version':entry['version'],'resolved':url,'integrity':entry['integrity'],'actualArchiveSHA256':sha(raw),'actualArchiveBytes':len(raw),'license':entry['license'],'licensePaths':license_paths,'installedBytePins':pins}
 assert installed['license']==entry['license'],path
 print('Verified locked compiler tarball, installed bytes, upstream license:',path,entry['version'],len(pins),'files',flush=True)
assert len(packages)==11 and packages['node_modules/terser']['version']=='5.51.2'
noticeraw=('\n'.join(licenses)+'\n').encode();notice.write_bytes(noticeraw)
doc={'schemaVersion':'kaleidosphere/ks303-owned-build-compiler-integrity/v1','buildOnly':True,'onlyOwnedKSInput':True,'packageSHA256':sha((BASE/'package.json').read_bytes()),'packageLockSHA256':sha(lockraw),'noticeSHA256':sha(noticeraw),'packages':packages,'actualTarballIntegrityVerified':True,'allArchiveFilesEqualInstalledBytes':True,'noLifecycleScriptExecuted':True}
with manifest.open('x')as f:json.dump(doc,f,ensure_ascii=False,indent=2);f.write('\n')
print('Actual compiler dependency closure qualified:',len(packages),'packages')
