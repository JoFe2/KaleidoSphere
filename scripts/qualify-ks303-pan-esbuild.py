"""Qualify the actual locked PAN esbuild entry/native executable before own build.
No install/lifecycle, producer change, compiler execution or global configuration.
"""
import base64,hashlib,io,json,pathlib,sys,tarfile,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[1];PAN=pathlib.Path(sys.argv[1]).resolve();BASE=ROOT/'dependencies/ks303-owned-browser-build'
sha=lambda b:hashlib.sha256(b).hexdigest()
lockraw=(PAN/'package-lock.json').read_bytes();lock=json.loads(lockraw);trusted=json.loads((ROOT/'contracts/dependencies/pan549-stock-workspace-v1/workspace-byte-closure-v28.json').read_bytes())
assert sha(lockraw)==trusted['PANBytePins']['package-lock.json']['sha256']
assert sha((PAN/'package.json').read_bytes())==trusted['PANBytePins']['package.json']['sha256']
manifest=BASE/'pan-esbuild-integrity-v1.json';notice=BASE/'ESBUILD-THIRD-PARTY-LICENSES.txt';assert not manifest.exists()and not notice.exists(),'Immutable output already exists'
packages={};licenses=['Existing locked PAN esbuild, used only on the own additive KS browser input.\n']
for path in ['node_modules/esbuild','node_modules/@esbuild/linux-x64']:
 entry=lock['packages'][path];url=entry['resolved'];assert url.startswith('https://registry.npmjs.org/')
 with urllib.request.urlopen(url,timeout=60)as response:
  assert response.geturl()==url;raw=response.read(16*1024*1024);assert not response.read(1)
 algorithm,expected=entry['integrity'].split('-',1);assert algorithm=='sha512'and hashlib.sha512(raw).digest()==base64.b64decode(expected,validate=True)
 pins={};upstream=[]
 with tarfile.open(fileobj=io.BytesIO(raw),mode='r:gz')as archive:
  for member in archive:
   assert member.name.startswith('package/');rel=pathlib.PurePosixPath(member.name).relative_to('package');assert not rel.is_absolute()and '..'not in rel.parts
   if member.isdir():continue
   assert member.isfile();stream=archive.extractfile(member);assert stream is not None;data=stream.read();target=PAN/path/str(rel)
   assert target.is_file()and not target.is_symlink()and target.read_bytes()==data,(path,str(rel))
   pins[str(rel)]={'bytes':len(data),'sha256':sha(data)}
   if rel.name.lower()in {'license','license.md','license.txt','copying'}:upstream.append(str(rel));licenses.append('\n'+path+' @ '+entry['version']+' | '+entry['license']+'\n'+data.decode()+'\n')
 if not upstream:
  assert path=='node_modules/@esbuild/linux-x64'and entry['license']=='MIT'and entry['version']==packages['node_modules/esbuild']['version']
  # The platform tarball carries SPDX MIT but no license file. Preserve the
  # real version-matched esbuild upstream LICENSE, never manufacture one.
  licenses.append('\n'+path+' @ '+entry['version']+' declares MIT; license text inherited from the exact version-matched esbuild archive above.\n')
 installed=json.loads((PAN/path/'package.json').read_bytes());assert installed['version']==entry['version']and installed['license']==entry['license']
 packages[path]={'version':entry['version'],'resolved':url,'integrity':entry['integrity'],'actualArchiveSHA256':sha(raw),'actualArchiveBytes':len(raw),'license':entry['license'],'licensePaths':upstream,'installedBytePins':pins}
 print('Verified exact locked PAN compiler archive/installed bytes/license:',path,entry['version'],flush=True)
assert packages['node_modules/esbuild']['version']==packages['node_modules/@esbuild/linux-x64']['version']=='0.25.12'
noticeraw=('\n'.join(licenses)+'\n').encode();notice.open('xb').write(noticeraw)
doc={'schemaVersion':'kaleidosphere/ks303-locked-pan-esbuild-integrity/v1','PANCommit':trusted['PANCommit'],'PANTree':trusted['PANTree'],'buildOnly':True,'onlyOwnedKSInput':True,'packageSHA256':sha((PAN/'package.json').read_bytes()),'packageLockSHA256':sha(lockraw),'noticeSHA256':sha(noticeraw),'executablePath':'node_modules/@esbuild/linux-x64/bin/esbuild','hostPlatform':'linux','hostArch':'x64','packages':packages,'actualTarballIntegrityVerified':True,'allArchiveFilesEqualInstalledBytes':True,'noLifecycleScriptExecuted':True,'compilerExecutedDuringQualification':False}
with manifest.open('x')as f:json.dump(doc,f,ensure_ascii=False,indent=2);f.write('\n')
