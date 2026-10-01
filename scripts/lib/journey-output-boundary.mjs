// The local journey/reader receipt boundary, not a general file-authority framework.
// Exactly two owner-selected roots: this checkout and os.tmpdir() for this process.
// A configured TMPDIR replaces (does not add to) an implicit system temporary root.
// Reject deterministic symlink components; final leaf open uses O_NOFOLLOW. No claim
// against a hostile actor concurrently swapping an ancestor after the component check.
import {lstat,realpath,open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';

export async function assertJourneyOutputPath(out,{root,code}) {
  const resolved=path.resolve(out);
  const roots=[path.resolve(root),path.resolve(tmpdir())];
  const matched=roots.find(r=>resolved===r || resolved.startsWith(`${r}${path.sep}`));
  const deny=(detail)=>{throw new Error(`${code}: ${detail}`);};
  if(!matched)deny('--out must be inside the repository or configured temporary directory');
  const canonical=await realpath(matched).catch(()=>null);
  if(canonical===null)deny('--out must be inside the repository or configured temporary directory');
  if(resolved===matched)deny('--out must name a regular receipt file');
  const parts=path.relative(matched,resolved).split(path.sep);
  let walked=canonical;
  for(let i=0;i<parts.length;i++){
    const candidate=path.join(walked,parts[i]);let st;
    try{st=await lstat(candidate);}catch(e){if(e.code==='ENOENT')break;throw e;}
    if(st.isSymbolicLink())deny('--out must not contain a symlink');
    if(i===parts.length-1 && !st.isFile())deny('--out must name a regular receipt file');
    if(i<parts.length-1 && !st.isDirectory())deny('--out ancestor must be a directory');
    walked=candidate;
  }
  return resolved;
}

export async function writeJourneyReceipt(resolved,payload) {
  const fd=await open(resolved,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o644);
  try{await fd.writeFile(payload);}finally{await fd.close();}
}
