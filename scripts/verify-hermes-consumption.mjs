#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { copyFile, chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const builder = path.join(root, 'scripts', 'build-agent-skill-distribution.mjs');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;

const canonicalSkill = 'agent-skills/kaleidosphere';
const canonicalFiles = [
  'SKILL.md',
  'references/contract.json',
  'scripts/validate-request.mjs',
];
const portableReference = 'references/portable-companion-v1.json';
const viewFiles = [...canonicalFiles, portableReference];

const sourceFiles = [
  'agent-skills/host-contracts.json',
  ...canonicalFiles.map((file) => `${canonicalSkill}/${file}`),
  'contracts/portable-companion/v1/compatibility-matrix.json',
  'contracts/portable-companion/v1/portable-companion.schema.json',
  'contracts/portable-companion/v1/profile-template.schema.json',
  'contracts/portable-companion/v1/receipt-envelope.schema.json',
  'contracts/external-api/v2/external-bi-api.schema.json',
  'package.json',
  'scripts/build-agent-skill-distribution.mjs',
  'scripts/verify-hermes-consumption.mjs',
];

const requestSchema = 'superset-bi-agent.external/intent-request/v2';
const validatorProbes = [
  {
    id: 'allowed status',
    request: { schemaVersion: requestSchema, requestId: 'ks-75-hermes-proof-status', action: 'status', input: {} },
    expect: { exit: 0, valid: true, action: 'status', authority: 'read-only' },
  },
  {
    id: 'denied apply',
    request: { schemaVersion: requestSchema, requestId: 'ks-75-hermes-proof-apply', action: 'apply', input: {} },
    expect: { exit: 2, valid: false },
  },
  {
    id: 'denied plan-sql',
    request: { schemaVersion: requestSchema, requestId: 'ks-75-hermes-proof-plan-sql', action: 'plan', input: { objective: 'Run SQL', sql: 'select 1' } },
    expect: { exit: 2, valid: false },
  },
];

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function snapshotSources() {
  const snapshot = {};
  for (const file of sourceFiles) {
    const bytes = await readFile(path.join(root, file));
    snapshot[file] = { sha256: sha256(bytes), size: bytes.byteLength };
  }
  return snapshot;
}

function assertNoSourceMutation(before, after) {
  const drifted = sourceFiles.filter(
    (file) => before[file].sha256 !== after[file].sha256 || before[file].size !== after[file].size,
  );
  if (drifted.length > 0) throw new Error(`source mutation denied in: ${drifted.join(', ')}`);
}

function assertHostPathFree(text, label) {
  if (/\/home\//.test(text) || /\/Users\//.test(text) || /\/root\//.test(text) || /[A-Za-z]:[\\/]/.test(text) || text.includes('~')) {
    throw new Error(`${label}: host-specific path denied in emitted output`);
  }
  for (const token of text.split(/\s+/)) {
    if (token.includes('/') && (token.startsWith('/') || token.startsWith('\\') || token.includes('..'))) {
      throw new Error(`${label}: absolute or escaping path denied in emitted output`);
    }
  }
}

function assertWorkspaceSafe(workspace) {
  const distRoot = path.join(root, 'dist');
  const insideRepo = workspace === root || workspace.startsWith(`${root}${path.sep}`);
  if (insideRepo && !workspace.startsWith(`${distRoot}${path.sep}`)) {
    throw new Error('workspace must be outside the repository or under dist/');
  }
}

function runBuilder(args) {
  const result = spawnSync(process.execPath, [builder, ...args], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`distribution builder step failed with exit ${result.status}: ${(result.stderr || result.stdout).trim()}`);
  }
}

async function listViewFiles(base) {
  const out = [];
  async function walk(prefix) {
    const dir = prefix === '' ? base : path.join(base, prefix);
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix === '' ? entry.name : path.posix.join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink denied in generated host view: ${relative}`);
      if (entry.isDirectory()) await walk(relative);
      else if (entry.isFile()) out.push(relative);
      else throw new Error(`non-regular path denied in generated host view: ${relative}`);
    }
  }
  await walk('');
  return out;
}

const args = process.argv.slice(2);
if (args.length > 1) throw new Error('usage: verify-hermes-consumption.mjs [workspace]');
let workspace;
let selfManaged = false;
if (args.length === 0) {
  workspace = await mkdtemp(path.join(tmpdir(), 'ks-hermes-consumption-'));
  selfManaged = true;
} else {
  workspace = path.resolve(args[0]);
}

let failed = false;
try {
  assertWorkspaceSafe(workspace);
  await mkdir(workspace, { recursive: true, mode: 0o755 });

  const lines = ['ks-hermes-consumption-proof v1', `package-version ${version}`];
  const before = await snapshotSources();
  lines.push(`source-snapshot ok files ${sourceFiles.length}`);

  const distDir = path.join(workspace, 'dist');
  runBuilder([distDir]);
  runBuilder(['--verify', distDir]);
  lines.push('build ok');
  lines.push('dist-verify ok');

  const manifest = JSON.parse(await readFile(path.join(distDir, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 'kaleidosphere/agent-skill-distribution/v2') throw new Error('distribution manifest v2 required');
  if (manifest.canonicalSource !== canonicalSkill) throw new Error('distribution canonical source drift denied');

  const viewBase = path.join(distDir, 'clawhub', 'kaleidosphere');
  const viewList = await listViewFiles(viewBase);
  const byName = (a, b) => a.localeCompare(b);
  if (JSON.stringify([...viewList].sort(byName)) !== JSON.stringify([...viewFiles].sort(byName))) {
    throw new Error('generated host view file set drift denied');
  }

  const stagedRoot = path.join(workspace, 'hermes', 'skills', 'kaleidosphere');
  const digests = {};
  for (const file of viewFiles) {
    const distBytes = await readFile(path.join(viewBase, file));
    await mkdir(path.dirname(path.join(stagedRoot, file)), { recursive: true });
    await copyFile(path.join(viewBase, file), path.join(stagedRoot, file));
    await chmod(path.join(stagedRoot, file), 0o644);
    const stagedBytes = await readFile(path.join(stagedRoot, file));
    if (!distBytes.equals(stagedBytes)) throw new Error(`staged byte drift denied: ${file}`);
    if (file !== portableReference) {
      const sourceBytes = await readFile(path.join(root, canonicalSkill, file));
      if (!sourceBytes.equals(stagedBytes)) throw new Error(`canonical byte drift denied: ${file}`);
    }
    digests[file] = sha256(stagedBytes);
    if (file === portableReference && digests[file] !== manifest.portableReference.sha256) {
      throw new Error('portable reference digest drift denied');
    }
  }
  lines.push(`stage ok files ${viewFiles.length}`);
  for (const file of viewFiles) lines.push(`digest ${file} ${digests[file]}`);

  const stagedValidator = path.join(stagedRoot, 'scripts', 'validate-request.mjs');
  for (const probe of validatorProbes) {
    const result = spawnSync(process.execPath, [stagedValidator], {
      input: JSON.stringify(probe.request),
      encoding: 'utf8',
      cwd: workspace,
    });
    if (result.status !== probe.expect.exit) throw new Error(`validator probe ${probe.id} exit ${result.status} denied`);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error(`validator probe ${probe.id} malformed output denied`);
    }
    if (parsed.valid !== probe.expect.valid) throw new Error(`validator probe ${probe.id} validity drift denied`);
    if (probe.expect.action && parsed.action !== probe.expect.action) throw new Error(`validator probe ${probe.id} action drift denied`);
    if (probe.expect.authority && parsed.authority !== probe.expect.authority) throw new Error(`validator probe ${probe.id} authority drift denied`);
    lines.push(`validator ${probe.id} ok exit ${probe.expect.exit}${probe.expect.authority ? ` authority ${probe.expect.authority}` : ''}`);
  }

  const after = await snapshotSources();
  assertNoSourceMutation(before, after);
  lines.push(`source-mutation none files ${sourceFiles.length}`);

  const evidence = {
    schemaVersion: 'kaleidosphere/hermes-consumption-proof/v1',
    packageVersion: version,
    host: 'hermes',
    layout: 'hermes/skills/kaleidosphere',
    layoutMirror: 'temporary mirror of the documented Hermes skills directory layout; no real home directory is touched',
    singleSource: true,
    generatedView: 'clawhub/kaleidosphere',
    stagedFiles: viewFiles,
    digests,
    validator: {
      stagedPath: 'hermes/skills/kaleidosphere/scripts/validate-request.mjs',
      probes: validatorProbes.map((probe) => ({
        id: probe.id,
        action: probe.request.action,
        exit: probe.expect.exit,
        valid: probe.expect.valid,
        authority: probe.expect.authority ?? null,
      })),
    },
    sourceMutation: {
      policy: 'digest-and-size snapshot of the closed input set before and after the proof',
      checked: sourceFiles.length,
      mutated: 0,
    },
    pathPolicy: 'temporary local workspace only; emitted output records relative paths and digests only',
    nonClaims: [
      'No ClawHub publication, authentication or marketplace listing or approval claim.',
      'No external dispatch, transport activation or Hermes runtime execution claim.',
      'No production readiness or host runtime compatibility claim.',
      'No second maintained skill copy; canonical single-source bytes are unchanged.',
    ],
  };
  const evidenceText = `${JSON.stringify(evidence, null, 2)}\n`;
  assertHostPathFree(evidenceText, 'evidence');
  await writeFile(path.join(workspace, 'hermes-consumption-proof.json'), evidenceText);
  lines.push('evidence hermes-consumption-proof.json');

  lines.push('result ok');
  const stdout = `${lines.join('\n')}\n`;
  assertHostPathFree(stdout, 'stdout');
  process.stdout.write(stdout);
} catch (error) {
  failed = true;
  process.stderr.write(`hermes-consumption proof failed: ${error?.message ?? error}\n`);
} finally {
  if (selfManaged) await rm(workspace, { recursive: true, force: true });
}
if (failed) process.exit(1);