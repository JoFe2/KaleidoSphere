import { readBoundedObservedJson } from './h01-observed-json.mjs';

// Confined archive layout of the existing KS254 local generation store, not a
// portable RuntimeIdentity contract or new restore authority. The caller still
// owns/verifies the actual archive bytes, empty extraction target and project.
export function qualifyLocalDemoBackupMembers(members) {
  const deny = () => { throw new Error('H01_OWNED_BACKUP_DENIED'); };
  try { members = readBoundedObservedJson(members); }
  catch { deny(); }
  if (!Array.isArray(members) || members.length === 0 || members.length > 10000) deny();
  const byName = new Map();
  let bytes = 0;
  for (const m of members) {
    if (!m || typeof m !== 'object' || Array.isArray(m)
      || typeof m.name !== 'string' || m.name.length > 1024
      || !/^(metadata|projection|receipts)(?:\/[A-Za-z0-9_.-]+)*$/.test(m.name)
      || m.name.split('/').some(p => p === '.' || p === '..')
      || typeof m.linkname !== 'string'
      || !Number.isSafeInteger(m.size) || m.size < 0
      || !['0', '5', '1', '2'].includes(m.type) || byName.has(m.name)) deny();
    bytes += m.size;
    if (!Number.isSafeInteger(bytes) || bytes > 268435456) deny();
    byName.set(m.name, m);
  }
  const links = members.filter(m => m.type === '1' || m.type === '2');
  for (const m of members) {
    if (links.some(link => m.name.startsWith(`${link.name}/`))) deny();
    if (m.type === '0' || m.type === '5') {
      if (m.linkname !== '') deny();
    } else if (m.type === '1') {
      if (byName.get(m.linkname)?.type !== '0') deny();
    } else {
      const match = /^(metadata|receipts)\/\.ks254-generations\/active$/.exec(m.name);
      if (!match || !/^generations\/[0-9a-f]{64}$/.test(m.linkname) || m.size !== 0) deny();
      const target = `${match[1]}/.ks254-generations/${m.linkname}`;
      if (byName.get(target)?.type !== '5') deny();
    }
  }
  return {status: 'OWNED_BACKUP_MEMBER_LAYOUT_VERIFIED', memberCount: members.length,
    payloadBytes: bytes, scope: 'EXISTING_LOCAL_KS254_CONFINED_GENERATION_POINTERS_ONLY'};
}
