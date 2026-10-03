#!/usr/bin/env node
// Additive #76 directory-upload view. Frozen host generators and runtime claims stay unchanged.
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '../..');
const declaredOutput = path.join(root, 'dist/k4c-directory-upload');
const imageSource = 'services/bi-agent/assets/kaleidosphere-logo.svg';
const imagePath = 'assets/kaleidosphere.png';
const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('invalid package version');
const archiveName = `kaleidosphere-codex-directory-upload-v${version}.zip`;
const manifestPath = '.codex-plugin/plugin.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function noSymlinkComponents(absolute) {
  let cursor = path.parse(absolute).root;
  for (const component of absolute.slice(cursor.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      if ((await lstat(cursor)).isSymbolicLink()) throw new Error('symlinked path component denied');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function resolveOutput(value) {
  if (!value || /[\x00-\x1f]/.test(value)) throw new Error('unsafe output path denied');
  const absolute = path.resolve(value);
  const temporary = path.resolve(os.tmpdir());
  if (absolute !== declaredOutput && !absolute.startsWith(`${temporary}${path.sep}`)) throw new Error('output outside declared or scratch scope denied');
  if (absolute === root || root.startsWith(`${absolute}${path.sep}`) || absolute.startsWith(`${root}${path.sep}`) && absolute !== declaredOutput) throw new Error('output overlaps repository denied');
  await noSymlinkComponents(absolute);
  return absolute;
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' });
  if (result.error) throw new Error(`${path.basename(command)} unavailable: ${result.error.code}`);
  if (result.status !== 0) throw new Error(`build failed: ${result.stderr || result.stdout}`);
}

async function expectedFiles() {
  const staging = await mkdtemp(path.join(os.tmpdir(), 'ks76-upload-source-'));
  try {
    run(process.execPath, [path.join(root, 'scripts/build-agent-skill-distribution.mjs'), staging]);
    const source = path.join(staging, 'codex/kaleidosphere-agent-skill');
    const files = new Map();
    for (const file of ['SKILL.md', 'references/contract.json', 'scripts/validate-request.mjs', 'references/portable-companion-v1.json']) {
      files.set(`skills/kaleidosphere/${file}`, await readFile(path.join(source, 'skills/kaleidosphere', file)));
    }
    const plugin = JSON.parse(await readFile(path.join(source, manifestPath), 'utf8'));
    plugin.interface.composerIcon = `./${imagePath}`;
    plugin.interface.logo = `./${imagePath}`;
    files.set(manifestPath, Buffer.from(`${JSON.stringify(plugin, null, 2)}\n`));
    const absoluteImage = path.join(root, imageSource);
    await noSymlinkComponents(absoluteImage);
    const svg = await readFile(absoluteImage, 'utf8');
    const match = svg.match(/href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/);
    if (!match) throw new Error('canonical embedded PNG missing');
    const image = Buffer.from(match[1], 'base64');
    if (image.length < 24 || !image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || image.readUInt32BE(16) < 48 || image.readUInt32BE(16) !== image.readUInt32BE(20) || image.length > 5 * 1024 * 1024) throw new Error('canonical image size or PNG format denied');
    files.set(imagePath, image);
    return files;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function regularFiles(base, prefix = '', directories = null) {
  const result = [];
  for (const entry of await readdir(path.join(base, prefix), { withFileTypes: true })) {
    const file = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new Error('symlinked package entry denied');
    if (entry.isDirectory()) {
      if (directories && !directories.has(file)) throw new Error('package directory drift denied');
      result.push(...await regularFiles(base, file, directories));
    }
    else if (entry.isFile()) result.push(file);
    else throw new Error('non-regular package entry denied');
  }
  return result.sort();
}

async function verify(out, expected) {
  const base = path.join(out, 'plugin');
  await noSymlinkComponents(base);
  const directories = new Set();
  for (const file of expected.keys()) {
    const parts = file.split('/');
    for (let length = 1; length < parts.length; length += 1) directories.add(parts.slice(0, length).join('/'));
  }
  const actual = await regularFiles(base, '', directories);
  if (JSON.stringify(actual) !== JSON.stringify([...expected.keys()].sort())) throw new Error('package inventory drift denied');
  for (const [file, bytes] of expected) {
    const absolute = path.join(base, file);
    if ((await lstat(absolute)).mode & 0o111) throw new Error('executable mode denied');
    if (!(await readFile(absolute)).equals(bytes)) throw new Error(`package byte drift denied: ${file}`);
  }
}

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || !['--out', '--verify'].includes(args[0])) throw new Error('usage: --out <fresh scoped directory> | --verify <scoped directory>');
  const out = await resolveOutput(args[1]);
  const files = await expectedFiles();
  if (args[0] === '--out') {
    await mkdir(path.dirname(out), { recursive: true });
    await mkdir(out, { mode: 0o755 }); // EEXIST is intentional: never overwrite an existing tree.
    for (const [file, bytes] of files) {
      const absolute = path.join(out, 'plugin', file);
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes, { mode: 0o644, flag: 'wx' });
    }
  }
  await verify(out, files);
  const archive = path.join(out, archiveName);
  const python = path.join(root, 'scripts/release/k4c-directory-zip.py');
  if (args[0] === '--out') {
    run('python3', [python, '--create', path.join(out, 'plugin'), archive]);
    await writeFile(`${archive}.sha256`, `${digest(await readFile(archive))}  ${archiveName}\n`, { mode: 0o644, flag: 'wx' });
  }
  await noSymlinkComponents(archive);
  await noSymlinkComponents(`${archive}.sha256`);
  for (const target of [archive, `${archive}.sha256`]) {
    if (!(await lstat(target)).isFile()) throw new Error('non-regular ZIP or checksum sidecar denied');
  }
  run('python3', [python, '--verify', path.join(out, 'plugin'), archive]);
  const archiveDigest = digest(await readFile(archive));
  if (await readFile(`${archive}.sha256`, 'utf8') !== `${archiveDigest}  ${archiveName}\n`) throw new Error('ZIP checksum sidecar drift denied');
  process.stdout.write(`${JSON.stringify({ schemaVersion: 'kaleidosphere/k4c-directory-upload/v1', archive: { name: archiveName, sha256: archiveDigest }, files: Object.fromEntries([...files].sort(([a],[b]) => a.localeCompare(b)).map(([file, bytes]) => [file, digest(bytes)])), nonClaims: ['No authenticated model execution.', 'No verified publisher identity, Terms acceptance, submission or marketplace acceptance.', 'Frozen host archives and the closed skill contract are unchanged.'] }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`k4c-directory-upload: ${error.message}\n`);
  process.exitCode = 1;
}
