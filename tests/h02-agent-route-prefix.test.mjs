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

test('H02 owner-configured agent route prefix keeps browser calls on the exact native tenant route', async () => {
  const work = await mkdtemp(path.join(tmpdir(), 'ks293-native-agent-prefix-'));
  let child; let stderr = '';
  try {
    child = spawn(process.execPath, ['services/bi-agent/src/server.mjs'], {
      cwd: root,
      env: { ...process.env, PORT: '0', CONTROL_BASE_URL: 'http://bi-control:18089',
        AGENT_ROUTE_PREFIX: '/t/tenant-a' },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    child.stderr.on('data', bytes => { stderr += bytes.toString(); });
    let socket;
    for (let i = 0; i < 100 && !socket; i += 1) {
      assert.equal(child.exitCode, null, `Native agent exited before readiness: ${stderr}`);
      socket = await listeningSocket(child.pid);
      if (!socket) await delay(25);
    }
    assert.ok(socket, `Native agent listener was not acquired: ${stderr}`);
    const port = Number.parseInt(socket[1].split(':')[1], 16);
    const origin = `http://127.0.0.1:${port}`;
    const page = await fetch(origin + '/t/tenant-a/');
    assert.equal(page.status, 200, 'Owner-configured native agent must serve its exact fixed prefix');
    const html = await page.text();
    assert.match(html, /fetch\('\/t\/tenant-a\/api\/chat'/);
    assert.match(html, /src="\/t\/tenant-a\/assets\/kaleidosphere-logo\.svg"/);
    assert.equal((await fetch(origin + '/t/tenant-a/assets/kaleidosphere-logo.svg')).status, 200);
    assert.equal((await fetch(origin + '/t/tenant-a/healthz')).status, 200);
    const denied = await fetch(origin + '/t/tenant-a/api/chat', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'SELECT * FROM secret_table' }) });
    assert.equal(denied.status, 400);
    assert.equal((await denied.json()).code, 'AGENT_UNSAFE_INPUT_DENIED');
    for (const bad of ['/', '/api/chat', '/t/tenant-b/', '/t/tenant-a/../tenant-b/',
      '/t/tenant-a%2f../tenant-b/', '/t/tenant-a/?redirect=https://not-owned.test']) {
      const response = await fetch(origin + bad);
      assert.equal(response.status, 400, `Foreign or alias route must remain denied: ${bad}`);
      assert.equal((await response.json()).code, 'AGENT_ROUTE_DENIED');
    }
  } finally {
    if (child) await stop(child);
    await rm(work, { recursive: true, force: true });
  }
});
