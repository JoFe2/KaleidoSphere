import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const moduleUrl = new URL('../scripts/lib/h01-owned-backup-guard.mjs', import.meta.url);

test('H01 owned restore accepts only existing confined generation-pointer symlinks', async () => {
  assert.ok(fs.existsSync(moduleUrl), 'H01 confined generation-pointer backup guard is missing');
  const { qualifyLocalDemoBackupMembers: qualify } = await import(moduleUrl.href);
  const digest = '94af323e53bac346e2625e62d61c4b6c30f0d6dc8fedeb695406916eb7f47b91';
  const members = [
    {name: 'metadata', type: '5', linkname: '', size: 0},
    {name: 'metadata/.ks254-generations', type: '5', linkname: '', size: 0},
    {name: 'metadata/.ks254-generations/generations', type: '5', linkname: '', size: 0},
    {name: `metadata/.ks254-generations/generations/${digest}`, type: '5', linkname: '', size: 0},
    {name: `metadata/.ks254-generations/generations/${digest}/metadata.db`, type: '0', linkname: '', size: 4096},
    {name: 'metadata/.ks254-generations/active', type: '2', linkname: `generations/${digest}`, size: 0},
  ];
  assert.equal(qualify(members).status, 'OWNED_BACKUP_MEMBER_LAYOUT_VERIFIED');
  for (const target of ['/etc', '../../foreign', 'generations/latest']) {
    const hostile = structuredClone(members);
    hostile.at(-1).linkname = target;
    assert.throws(() => qualify(hostile), /H01_OWNED_BACKUP_DENIED/);
  }
  const throughPointer = structuredClone(members);
  throughPointer.push({name: 'metadata/.ks254-generations/active/overwrite', type: '0', linkname: '', size: 1});
  assert.throws(() => qualify(throughPointer), /H01_OWNED_BACKUP_DENIED/);
});

test('H01 owned backup guard rejects input hooks before they execute', async () => {
  const { qualifyLocalDemoBackupMembers: qualify } = await import(moduleUrl.href);
  let calls = 0;
  const member = {type: '0', linkname: '', size: 1};
  Object.defineProperty(member, 'name', {enumerable: true, get() { calls += 1; return 'metadata/value'; }});
  assert.throws(() => qualify([member]), /H01_OWNED_BACKUP_DENIED/);
  assert.equal(calls, 0, 'Untrusted archive metadata accessor must not execute');
  const proxy = new Proxy([], {get() { calls += 1; return 0; }});
  assert.throws(() => qualify(proxy), /H01_OWNED_BACKUP_DENIED/);
  assert.equal(calls, 0, 'Untrusted archive metadata proxy must not execute');
});
