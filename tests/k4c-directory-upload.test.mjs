import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, mkdir, writeFile, chmod, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import test from 'node:test';
const root = path.resolve(import.meta.dirname, '..');
const builder = path.join(root, 'scripts/release/build-k4c-directory-upload.mjs');
const run = (args) => spawnSync(process.execPath, [builder, ...args], { cwd: root, encoding: 'utf8' });
// Kill the entire test-private process group on timeout, including the Python child.
const boundedRun = (command, args) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
  child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
  const timer = setTimeout(() => {
    timedOut = true;
    try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
  }, 3000);
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (status, signal) => { clearTimeout(timer); resolve({ status, signal, stdout, stderr, timedOut }); });
});
for (const probe of ['zip', 'sidecar']) {
  test(`directory upload verifier denies ${probe} FIFO without blocking`, async (t) => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'ks76-upload-fifo-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const out = path.join(scratch, 'upload');
    assert.equal(run(['--out', out]).status, 0);
    const archive = path.join(out, 'kaleidosphere-codex-directory-upload-v0.26.0.zip');
    const target = probe === 'zip' ? archive : `${archive}.sha256`;
    await rm(target);
    const fifo = spawnSync('mkfifo', [target], { encoding: 'utf8' });
    assert.equal(fifo.status, 0, fifo.stderr);
    const result = await boundedRun(process.execPath, [builder, '--verify', out]);
    assert.equal(result.timedOut, false, `${probe} FIFO must be rejected before any blocking read`);
    assert.equal(result.status, 1, result.stdout);
    assert.match(result.stderr, /non-regular.*denied/);
    assert.equal(result.stdout, '');
  });
}
test('directory ZIP helper denies FIFO without blocking when invoked directly', async (t) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ks76-upload-python-fifo-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const out = path.join(scratch, 'upload');
  assert.equal(run(['--out', out]).status, 0);
  const archive = path.join(out, 'kaleidosphere-codex-directory-upload-v0.26.0.zip');
  await rm(archive);
  const fifo = spawnSync('mkfifo', [archive], { encoding: 'utf8' });
  assert.equal(fifo.status, 0, fifo.stderr);
  const result = await boundedRun('python3', [path.join(root, 'scripts/release/k4c-directory-zip.py'), '--verify', path.join(out, 'plugin'), archive]);
  assert.equal(result.timedOut, false, 'direct Python ZIP verification must reject FIFO before read');
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, /non-regular.*denied/);
  assert.equal(result.stdout, '');
});
for (const probe of ['manifest', 'image', 'zip', 'sidecar', 'executable', 'symlink', 'extra-file', 'extra-empty-directory']) {
  test(`directory upload verifier denies ${probe} drift`, async (t) => {
    const scratch = await mkdtemp(path.join(os.tmpdir(), 'ks76-upload-denial-'));
    t.after(() => rm(scratch, { recursive: true, force: true }));
    const out = path.join(scratch, 'upload');
    assert.equal(run(['--out', out]).status, 0);
    const image = path.join(out, 'plugin/assets/kaleidosphere.png');
    const archive = path.join(out, 'kaleidosphere-codex-directory-upload-v0.26.0.zip');
    if (probe === 'manifest') await writeFile(path.join(out, 'plugin/.codex-plugin/plugin.json'), '{}');
    if (probe === 'image') await writeFile(image, 'not the canonical image');
    if (probe === 'zip') await writeFile(archive, Buffer.from('altered ZIP'));
    if (probe === 'sidecar') await writeFile(`${archive}.sha256`, '0'.repeat(64));
    if (probe === 'executable') await chmod(image, 0o755);
    if (probe === 'symlink') { await rm(image); await symlink(path.join(root, 'package.json'), image); }
    if (probe === 'extra-file') await writeFile(path.join(out, 'plugin/extra.json'), '{}');
    if (probe === 'extra-empty-directory') await mkdir(path.join(out, 'plugin/hooks'));
    const result = run(['--verify', out]);
    assert.notEqual(result.status, 0, result.stdout);
    assert.match(result.stderr, /denied/);
  });
}
test('directory upload refuses overwrite, source overlap, unknown arguments and symlink parents', async (t) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ks76-upload-path-denial-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const existing = path.join(scratch, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'sentinel'), 'preserved');
  assert.notEqual(run(['--out', existing]).status, 0);
  assert.equal(await readFile(path.join(existing, 'sentinel'), 'utf8'), 'preserved');
  assert.notEqual(run(['--out', root]).status, 0);
  assert.notEqual(run(['--unknown', path.join(scratch, 'x')]).status, 0);
  const link = path.join(scratch, 'link');
  await symlink(existing, link);
  assert.notEqual(run(['--out', path.join(link, 'x')]).status, 0);
});
test('directory upload ZIP is byte-deterministic, root-correct and independently readable', async (t) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ks76-upload-zip-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const outputs = [path.join(scratch, 'a'), path.join(scratch, 'b')];
  for (const out of outputs) assert.equal(run(['--out', out]).status, 0);
  const name = 'kaleidosphere-codex-directory-upload-v0.26.0.zip';
  const bytes = await Promise.all(outputs.map((out) => readFile(path.join(out, name))));
  assert.deepEqual(bytes[0], bytes[1]);
  const check = spawnSync('python3', ['-c', 'import zipfile,sys,json;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({"names":z.namelist(),"modes":[x.external_attr>>16 for x in z.infolist()],"dates":[list(x.date_time) for x in z.infolist()]}))', path.join(outputs[0], name)], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
  const listing = JSON.parse(check.stdout);
  assert.equal(listing.names.length, 6);
  assert(listing.names.includes('.codex-plugin/plugin.json'));
  assert(listing.names.includes('assets/kaleidosphere.png'));
  assert(listing.names.every((name) => !name.includes('..') && !name.startsWith('/') && !name.includes('\\\\')));
  assert(listing.modes.every((mode) => mode === 0o100644));
  assert(listing.dates.every((value) => JSON.stringify(value) === '[1980,1,1,0,0,0]'));
});
test('directory upload includes required local Codex icons while retaining the canonical skill', async (t) => {
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'ks76-upload-test-'));
  t.after(() => rm(scratch, { recursive: true, force: true }));
  const out = path.join(scratch, 'upload');
  const result = run(['--out', out]);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(await readFile(path.join(out, 'plugin/.codex-plugin/plugin.json'), 'utf8'));
  assert.equal(manifest.interface.composerIcon, './assets/kaleidosphere.png');
  assert.equal(manifest.interface.logo, './assets/kaleidosphere.png');
  const image = await readFile(path.join(out, 'plugin/assets/kaleidosphere.png'));
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(image.readUInt32BE(16), image.readUInt32BE(20));
  assert(image.readUInt32BE(16) >= 48);
  assert(image.length <= 5 * 1024 * 1024);
  for (const file of ['SKILL.md', 'references/contract.json', 'scripts/validate-request.mjs']) {
    assert.deepEqual(await readFile(path.join(out, 'plugin/skills/kaleidosphere', file)), await readFile(path.join(root, 'agent-skills/kaleidosphere', file)));
  }
  for (const key of ['apps', 'mcpServers', 'hooks', 'commands', 'agents']) assert(!(key in manifest));
});
