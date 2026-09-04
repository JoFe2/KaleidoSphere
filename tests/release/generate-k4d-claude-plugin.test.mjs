import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..', '..');
const canonical = path.join(root, 'agent-skills', 'kaleidosphere');
const generator = path.join(root, 'scripts', 'release', 'generate-k4d-claude-plugin.mjs');
const fixturePath = path.join(root, 'tests', 'fixtures', 'release', 'k4d-canonical-skill-digests-v1.json');
const validatorAdapter = path.join(root, 'scripts', 'release', 'validate-k4d-claude-plugin.mjs');
const validatorTranscript = path.join(root, 'tests', 'fixtures', 'release', 'k4d-plugin-validate-transcripts-v1.json');
const FROZEN_MANIFEST_SHA256 = 'b8a53a99c90b10982ca7cd15291d000291dc6a0e511b6b6ff53b2222741ae42d';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function deny(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.notEqual(result.status, 0, `expected denial: ${command} ${args.join(' ')}\n${result.stdout}`);
  return result;
}

async function digest(file) {
  return createHash('sha256').update(await readFile(file)).digest('hex');
}

function parseReceipt(stdout) {
  return JSON.parse(stdout.slice(stdout.indexOf('{')));
}

async function build(prefix = 'ks77-k4d-') {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  const result = run(process.execPath, [generator, '--out', dir], { cwd: root });
  return { dir, receipt: parseReceipt(result.stdout) };
}

function checkArgs(dir, extra = []) {
  return [generator, '--check', '--fixture', fixturePath, ...extra, '--out', dir];
}

test('generated package view is an exact copied view of the canonical skill', async () => {
  const { dir, receipt } = await build();

  assert.equal(receipt.schemaVersion, 'kaleidosphere/k4d-claude-plugin-receipt/v1');
  assert.equal(receipt.packageVersion, '0.26.0');
  assert.equal(receipt.canonicalSource, 'agent-skills/kaleidosphere');
  assert.deepEqual(receipt.manifest, { path: '.claude-plugin/plugin.json', sha256: FROZEN_MANIFEST_SHA256 });
  assert.equal(receipt.manifest.sha256, FROZEN_MANIFEST_SHA256);

  assert.deepEqual(receipt.files.map((file) => file.path), [
    'skills/kaleidosphere/SKILL.md',
    'skills/kaleidosphere/references/contract.json',
    'skills/kaleidosphere/scripts/validate-request.mjs',
  ]);
  for (const file of receipt.files) {
    const relative = file.path.slice('skills/kaleidosphere/'.length);
    assert.equal(file.canonicalSha256, file.generatedSha256, file.path);
    assert.equal(file.canonicalSha256, await digest(path.join(canonical, relative)), `canonical ${file.path}`);
    assert.equal(await digest(path.join(dir, file.path)), await digest(path.join(canonical, relative)), `generated ${file.path}`);
  }
  assert.equal(await digest(path.join(dir, '.claude-plugin', 'plugin.json')), FROZEN_MANIFEST_SHA256);
  assert.equal(receipt.packageDigest.length, 64);
  assert.equal(receipt.nonClaims.length, 3);
  for (const nonClaim of receipt.nonClaims) assert(typeof nonClaim === 'string' && nonClaim.length > 0);
});

test('no-change rerun reports a stable package digest', async () => {
  const first = await build('ks77-k4d-stable-a-');
  const second = await build('ks77-k4d-stable-b-');

  assert.equal(first.receipt.packageDigest, second.receipt.packageDigest);
  for (let index = 0; index < first.receipt.files.length; index += 1) {
    assert.deepEqual(second.receipt.files[index], first.receipt.files[index]);
  }
});

test('check mode verifies the canonical digest fixture against the generated view', async () => {
  const { dir, receipt } = await build('ks77-k4d-check-');
  const result = run(process.execPath, checkArgs(dir), { cwd: root });
  assert.ok(result.stdout.startsWith(`verified ${dir}\n`), result.stdout);
  const checked = parseReceipt(result.stdout);
  assert.equal(checked.packageDigest, receipt.packageDigest);
  assert.deepEqual(checked.files, receipt.files);
  assert.equal(checked.manifest.sha256, FROZEN_MANIFEST_SHA256);
});

test('generated plugin manifest validates through the recorded Claude Code plugin validation route', async () => {
  const { dir } = await build('ks77-k4d-validator-');
  const receiptPath = path.join(await mkdtemp(path.join(tmpdir(), 'ks77-k4d-validator-receipt-')), 'receipt.json');
  const result = run(process.execPath, [validatorAdapter, '--fixture', validatorTranscript, '--out', dir, '--dry-run', '--receipt', receiptPath], { cwd: root });
  const receipt = parseReceipt(result.stdout);
  assert.equal(receipt.accepted, true);
  assert.equal(receipt.claudeSchemaValidation.adapter, 'claude-code-plugin-validate');
  assert.ok(['LIVE_VALIDATOR', 'RECORDED_TRANSCRIPT_DRY_RUN'].includes(receipt.claudeSchemaValidation.execution));
});

test('fail-closed: changed generated byte is denied before acceptance', async () => {
  const { dir } = await build('ks77-k4d-byte-');
  const skill = path.join(dir, 'skills', 'kaleidosphere', 'SKILL.md');
  await writeFile(skill, `${await readFile(skill, 'utf8')}\nmanual drift\n`);
  const result = deny(process.execPath, checkArgs(dir), { cwd: root });
  assert.match(result.stderr, /changed generated byte denied/);
});

test('fail-closed: extra generated skill and stray generated file are denied', async () => {
  const rogue = await build('ks77-k4d-rogue-');
  await mkdir(path.join(rogue.dir, 'skills', 'rogue'), { recursive: true });
  await writeFile(path.join(rogue.dir, 'skills', 'rogue', 'SKILL.md'), 'name: rogue\n');
  let result = deny(process.execPath, checkArgs(rogue.dir), { cwd: root });
  assert.match(result.stderr, /extra generated skill denied/);

  const stray = await build('ks77-k4d-stray-');
  await writeFile(path.join(stray.dir, 'notes.txt'), 'stray\n');
  result = deny(process.execPath, checkArgs(stray.dir), { cwd: root });
  assert.match(result.stderr, /extra generated file denied/);

  const emptySkill = await build('ks77-k4d-empty-skill-');
  await mkdir(path.join(emptySkill.dir, 'skills', 'rogue'), { recursive: true });
  result = deny(process.execPath, checkArgs(emptySkill.dir), { cwd: root });
  assert.match(result.stderr, /extra generated directory denied/);
});

test('fail-closed: missing canonical skill file is denied against the fixture', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'ks77-k4d-missing-'));
  const canonicalCopy = path.join(scratch, 'canonical');
  await cp(canonical, canonicalCopy, { recursive: true });
  await rm(path.join(canonicalCopy, 'references', 'contract.json'));
  const result = deny(
    process.execPath,
    [generator, '--check', '--fixture', fixturePath, '--canonical', canonicalCopy, '--out', path.join(scratch, 'out')],
    { cwd: root },
  );
  assert.match(result.stderr, /missing canonical skill denied/);
});

test('fail-closed: canonical digest drift against the fixture is denied', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'ks77-k4d-canonical-drift-'));
  const canonicalCopy = path.join(scratch, 'canonical');
  await cp(canonical, canonicalCopy, { recursive: true });
  const skill = path.join(canonicalCopy, 'SKILL.md');
  await writeFile(skill, `${await readFile(skill, 'utf8')}\ndrift-marker\n`);
  const result = deny(
    process.execPath,
    [generator, '--check', '--fixture', fixturePath, '--canonical', canonicalCopy, '--out', path.join(scratch, 'out')],
    { cwd: root },
  );
  assert.match(result.stderr, /canonical skill digest drift denied/);
});

test('fail-closed: undeclared canonical skill file is denied against the fixture', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'ks77-k4d-undeclared-'));
  const canonicalCopy = path.join(scratch, 'canonical');
  await cp(canonical, canonicalCopy, { recursive: true });
  await writeFile(path.join(canonicalCopy, 'references', 'extra.md'), 'extra reference note\n');
  const result = deny(
    process.execPath,
    [generator, '--check', '--fixture', fixturePath, '--canonical', canonicalCopy, '--out', path.join(scratch, 'out')],
    { cwd: root },
  );
  assert.match(result.stderr, /undeclared canonical skill file denied/);
});

test('fail-closed: non-canonical source path is denied', async () => {
  const scratch = await mkdtemp(path.join(tmpdir(), 'ks77-k4d-scope-'));
  const out = path.join(scratch, 'out');
  let result = deny(process.execPath, [generator, '--canonical', '/etc', '--out', out], { cwd: root });
  assert.match(result.stderr, /non-canonical source path denied/);

  const link = path.join(scratch, 'canonical');
  await symlink(canonical, link);
  result = deny(process.execPath, [generator, '--check', '--fixture', fixturePath, '--canonical', link, '--out', out], { cwd: root });
  assert.match(result.stderr, /non-canonical source path denied/);

  result = deny(process.execPath, [generator, '--canonical', path.join(root, 'agent-skills'), '--out', out], { cwd: root });
  assert.match(result.stderr, /non-canonical source path denied/);
});

test('fail-closed: output scope cannot delete repository or overlap canonical source', async () => {
  let result = deny(process.execPath, [generator, '--out', root], { cwd: root });
  assert.match(result.stderr, /output root outside declared package scope denied/);

  const scratch = await mkdtemp(path.join(tmpdir(), 'ks77-k4d-overlap-'));
  result = deny(process.execPath, [generator, '--canonical', scratch, '--out', path.join(scratch, 'out')], { cwd: root });
  assert.match(result.stderr, /output root overlaps canonical source denied/);
});

test('fail-closed: symlinked generated package root is denied', async () => {
  const actual = await build('ks77-k4d-output-link-target-');
  const link = path.join(await mkdtemp(path.join(tmpdir(), 'ks77-k4d-output-link-')), 'out');
  await symlink(actual.dir, link);
  const result = deny(process.execPath, checkArgs(link), { cwd: root });
  assert.match(result.stderr, /unsafe generated path denied/);
});

test('fail-closed: plugin manifest drift and active plugin surfaces are denied', async () => {
  const drift = await build('ks77-k4d-drift-');
  const manifestPath = path.join(drift.dir, '.claude-plugin', 'plugin.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.description = 'mutated description';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  let result = deny(process.execPath, checkArgs(drift.dir), { cwd: root });
  assert.match(result.stderr, /plugin manifest drift denied/);

  const surface = await build('ks77-k4d-surface-');
  const surfacePath = path.join(surface.dir, '.claude-plugin', 'plugin.json');
  const surfaceManifest = JSON.parse(await readFile(surfacePath, 'utf8'));
  surfaceManifest.hooks = {};
  await writeFile(surfacePath, `${JSON.stringify(surfaceManifest, null, 2)}\n`);
  result = deny(process.execPath, checkArgs(surface.dir), { cwd: root });
  assert.match(result.stderr, /active plugin surface denied/);
});