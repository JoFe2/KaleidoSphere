import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function listeningSocket(pid) {
  const inodes = new Set();
  for (const name of await readdir(`/proc/${pid}/fd`)) {
    const target = await readlink(`/proc/${pid}/fd/${name}`).catch(() => '');
    const inode = /^socket:\[(\d+)\]$/.exec(target)?.[1];
    if (inode) inodes.add(inode);
  }
  const rows = (await readFile(`/proc/${pid}/net/tcp`, 'utf8')).trim().split('\n').slice(1);
  return rows.map(row => row.trim().split(/\s+/)).find(row => row[3] === '0A' && inodes.has(row[9]));
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
  try { await exited; } finally { clearTimeout(timer); }
}

test('H02 task-owned native control can bind only loopback without changing its local HTTP product', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'ks293-native-loopback-'));
  let child; let stderr = '';
  try {
    const tokenFile = path.join(work, 'control-auth');
    const token = randomBytes(32).toString('hex');
    await writeFile(tokenFile, token, { mode: 0o600, flag: 'wx' });
    child = spawn(process.execPath, ['services/bi-control/src/server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: '0', CONTROL_BIND_ADDRESS: '127.0.0.1', CONTROL_TOKEN_FILE: tokenFile,
        RECEIPT_DIR: path.join(work, 'receipts'), PROJECTION_DB: path.join(work, 'projection.db'),
        REPOSITORY_ROOT: path.join(root, 'services/bi-control'), BI_SOURCE_MODE: 'fixture', BI_ENGINE: 'mssql' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', bytes => { stderr += bytes.toString(); });
    let socket;
    for (let i = 0; i < 100 && !socket; i += 1) {
      assert.equal(child.exitCode, null, `Native control exited before readiness: ${stderr}`);
      socket = await listeningSocket(child.pid);
      if (!socket) await delay(25);
    }
    assert.ok(socket, `Native control listener was not acquired: ${stderr}`);
    assert.equal(socket[1].split(':')[0], '0100007F',
      'Explicit H02 task-owned control must not open a wildcard HTTP listener');
    const port = Number.parseInt(socket[1].split(':')[1], 16);
    const origin = `http://127.0.0.1:${port}`;
    assert.deepEqual(await (await fetch(origin + '/healthz')).json(), { status: 'ok' });
    assert.equal((await fetch(origin + '/v1/status')).status, 401);
    const status = await fetch(origin + '/v1/status', { headers: { authorization: `Bearer ${token}` } });
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.status, 'READY');
    assert.equal(body.engine, 'mssql');
    assert.equal(body.sourceMode, 'fixture');
  } finally {
    if (child) await stop(child);
    await rm(work, { recursive: true, force: true });
  }
});
