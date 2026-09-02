#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { spawn, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const sourceMap = JSON.parse(await readFile(path.join(root, 'SOURCE-MAP.json'), 'utf8'));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('release version must be semver x.y.z');

const archiveName = `KaleidoSphere-v${version}.tar.gz`;
const checksumName = `${archiveName}.sha256`;
const outputDir = path.resolve(process.argv[2] ?? path.join(root, 'dist', 'release'));
const archivePath = path.join(outputDir, archiveName);
const checksumPath = path.join(outputDir, checksumName);

function classifiedBusinessBiReleasePaths() {
  const classes = sourceMap.releasePathClasses?.businessBiFalsification;
  if (classes === null || typeof classes !== 'object' || Array.isArray(classes)) {
    throw new Error('business BI release path classification is required');
  }
  if (JSON.stringify(Object.keys(classes).sort()) !== JSON.stringify(['evidence', 'public'])) {
    throw new Error('business BI release path classes drifted');
  }
  for (const classifiedPaths of Object.values(classes)) {
    if (!Array.isArray(classifiedPaths)) {
      throw new Error('business BI release paths must be arrays');
    }
  }
  if (classes.public.length !== 1 || classes.evidence.length !== 4) {
    throw new Error('business BI release path class counts drifted');
  }

  const paths = [];
  for (const [classification, classifiedPaths] of Object.entries(classes)) {
    for (const relativePath of classifiedPaths) {
      if (typeof relativePath !== 'string'
        || path.isAbsolute(relativePath)
        || relativePath.split('/').includes('..')) {
        throw new Error('business BI release path classification is unsafe');
      }
      if (relativePath === 'SOURCE-MAP.json'
        || relativePath.startsWith('closure-audits/')) {
        throw new Error('business BI release path classification is self-referential');
      }
      if (!/^[a-f0-9]{64}$/.test(sourceMap.files?.[relativePath] ?? '')) {
        throw new Error(`business BI classified path is absent from source integrity: ${relativePath}`);
      }
      paths.push({ classification, relativePath });
    }
  }
  if (new Set(paths.map(({ relativePath }) => relativePath)).size !== paths.length) {
    throw new Error('business BI release path classifications overlap');
  }
  return paths;
}

const classifiedReleasePaths = classifiedBusinessBiReleasePaths();

function runGit(args, options = {}) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function isGitCheckout() {
  return spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root, encoding: 'utf8' }).status === 0;
}

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true, mode: 0o755 });

const gzip = createGzip({ mtime: 0, level: 9 });
if (isGitCheckout()) {
  const status = runGit(['status', '--porcelain', '--untracked-files=no']);
  if (status && process.env.CM_BI_RELEASE_ALLOW_DIRTY !== '1') {
    throw new Error('release archive requires a clean tracked worktree; set CM_BI_RELEASE_ALLOW_DIRTY=1 only for local regression tests');
  }
  const archive = spawn('git', ['archive', '--format=tar', `--prefix=KaleidoSphere-v${version}/`, 'HEAD'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  const archiveClosed = new Promise((resolve) => archive.on('close', resolve));
  await pipeline(archive.stdout, gzip, createWriteStream(archivePath, { mode: 0o644 }));
  const exitCode = await archiveClosed;
  if (exitCode !== 0) throw new Error(`git archive exited ${exitCode}`);
} else {
  const archive = spawn('tar', [
    '--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner',
    '--exclude=./.git', '--exclude=./node_modules', '--exclude=./.env', '--exclude=./dist',
    '--exclude=./.runtime/metadata', '--exclude=./.runtime/projection', '--exclude=./.runtime/receipts', '--exclude=./.runtime/secrets',
    '--exclude=./.secrets/llm_api_key', '--exclude=./.secrets/mssql_password', '--exclude=./.secrets/oracle_password',
    '--transform', `s#^\\.#KaleidoSphere-v${version}#`, '-cf', '-', '.',
  ], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  const archiveClosed = new Promise((resolve) => archive.on('close', resolve));
  await pipeline(archive.stdout, gzip, createWriteStream(archivePath, { mode: 0o644 }));
  const exitCode = await archiveClosed;
  if (exitCode !== 0) throw new Error(`tar archive exited ${exitCode}`);
}

const archiveListing = spawnSync('tar', ['-tzf', archivePath], {
  cwd: root,
  encoding: 'utf8',
});
if (archiveListing.status !== 0) {
  throw new Error(`release archive listing failed: ${archiveListing.stderr || archiveListing.stdout}`);
}
const archivedPaths = new Set(archiveListing.stdout.trim().split('\n'));
for (const { relativePath } of classifiedReleasePaths) {
  if (!archivedPaths.has(`KaleidoSphere-v${version}/${relativePath}`)) {
    throw new Error(`business BI classified release path missing: ${relativePath}`);
  }
}

const digest = createHash('sha256').update(await readFile(archivePath)).digest('hex');
const checksumLine = `${digest}  ${archiveName}\n`;
await writeFile(checksumPath, checksumLine, { mode: 0o644 });

const distribution = spawnSync(process.execPath, [
  path.join(root, 'scripts', 'build-agent-skill-distribution.mjs'),
  path.join(outputDir, 'agent-skill-distribution'),
], {
  cwd: root,
  encoding: 'utf8',
  env: process.env,
});
if (distribution.status !== 0) {
  throw new Error(`agent skill distribution build failed: ${distribution.stderr || distribution.stdout}`);
}

const publicPathCount = classifiedReleasePaths
  .filter(({ classification }) => classification === 'public').length;
const evidencePathCount = classifiedReleasePaths
  .filter(({ classification }) => classification === 'evidence').length;
process.stdout.write(
  `release-paths public=${publicPathCount} evidence=${evidencePathCount}\n`
  + `${checksumLine}${archivePath}\n${checksumPath}\n${distribution.stdout}`,
);
