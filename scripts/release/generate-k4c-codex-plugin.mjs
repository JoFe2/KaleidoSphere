#!/usr/bin/env node
// Deterministic K4C Codex plugin generator (KaleidoSphere, KS76).
//
// Builds the skills-only package view `packages/codex/kaleidosphere` whose
// `skills/kaleidosphere` tree is an exact copied view of the canonical
// `agent-skills/kaleidosphere` skill, plus the frozen `.codex-plugin/plugin.json`
// manifest. Every run prints a digest receipt recording the canonical/generated
// sha256 pair for every copied file and a stable package digest. The receipt is
// deterministic: no timestamps, no random values.
//
// Frozen contract: docs/evidence/conveyor/plan-ks76-codex-directory-contract-01.json
//
// Usage:
//   node scripts/release/generate-k4c-codex-plugin.mjs
//   node scripts/release/generate-k4c-codex-plugin.mjs --check --fixture tests/fixtures/release/k4c-canonical-skill-digests-v1.json
// Optional: --out <dir> and --canonical <dir>, scoped to this repository or the
// system temp directory.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { chmod, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = packageJson.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`package version must be semver x.y.z, got ${version}`);

const CANONICAL_SOURCE = 'agent-skills/kaleidosphere';
const PACKAGE_REL = 'packages/codex/kaleidosphere';
const MANIFEST_REL = '.codex-plugin/plugin.json';
const SKILL_NAME = 'kaleidosphere';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-codex-plugin-receipt/v1';
const FIXTURE_SCHEMA = 'kaleidosphere/k4c-canonical-skill-digests/v1';
const PACKAGE_DIGEST_SCHEMA = 'kaleidosphere/k4c-codex-plugin-package-digest/v1';
const FORBIDDEN_SURFACES = ['hooks', 'mcpServers', 'apps', 'commands', 'agents'];
const FROZEN_MANIFEST = {
  version: '0.24.0',
  sha256: 'beb78cef8fbedb1817fbf3fc61c96177a7e1a7e28b910838b7bf5070eb47fc75',
};
const denySecret = /(?:sk-[A-Za-z0-9]{20,}|hf_[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9_]{20,}|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|password\s*=|token\s*=|secret\s*=)/i;
const remoteExecution = /(?:curl|wget)\s+[^|;&\n]+[|]\s*(?:sh|bash)|npx\s+-?y\s+[^@\s]+@latest/i;
const activeHostPath = /(?:^|\/)(?:hooks?(?:\.json)?|mcp(?:-?servers?)?(?:\.json)?)(?:\/|$)/i;
const executableArtifact = /\.(?:sh|bash|zsh|fish|exe|dll|so|dylib|wasm|node)$/i;

function relSafe(file) {
  const normalized = path.posix.normalize(file);
  if (normalized.startsWith('../') || normalized === '..' || path.isAbsolute(file) || normalized.includes('\0')) {
    throw new Error(`unsafe relative path: ${file}`);
  }
  return normalized;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function comparePath(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function buildManifestBytes(packageVersion) {
  const manifest = {
    name: 'kaleidosphere-agent-skill',
    version: packageVersion,
    description: 'KaleidoSphere bounded BI AgentSkill distribution',
    author: {
      name: 'JoFe2',
      url: 'https://github.com/JoFe2',
    },
    homepage: 'https://github.com/JoFe2/KaleidoSphere',
    repository: 'https://github.com/JoFe2/KaleidoSphere',
    license: 'Apache-2.0',
    keywords: ['kaleidosphere', 'agent-skill', 'business-intelligence', 'openclaw'],
    skills: './skills/',
    interface: {
      displayName: 'KaleidoSphere',
      shortDescription: 'Bounded BI skill',
      longDescription: 'Use the KaleidoSphere AgentSkill for bounded status, discovery, analyze, plan, preview and readback requests under the closed authority-free contract.',
      developerName: 'JoFe2',
      category: 'Data & Analytics',
      capabilities: ['Bounded BI workflows', 'Closed action validation', 'Readback evidence review'],
      websiteURL: 'https://github.com/JoFe2/KaleidoSphere',
      defaultPrompt: [
        'Use KaleidoSphere for BI status.',
        'Plan a bounded BI preview.',
        'Review KaleidoSphere readback evidence.',
      ],
      brandColor: '#0F766E',
    },
  };
  return Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
}

function parseArgs(argv) {
  const args = { check: false, fixture: null, out: null, canonical: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--check') {
      args.check = true;
    } else if (arg === '--fixture' || arg === '--out' || arg === '--canonical') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--fixture') args.fixture = value;
      else if (arg === '--out') args.out = value;
      else args.canonical = value;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (args.check && args.fixture === null) throw new Error('--fixture is required with --check');
  return args;
}

function insideAllowedScope(resolved) {
  return [root, os.tmpdir()].some((scope) => resolved === scope || resolved.startsWith(`${scope}${path.sep}`));
}

function resolveCanonicalScope(value) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || !insideAllowedScope(resolved)) {
    throw new Error('non-canonical source path denied: outside allowed scope');
  }
  return resolved;
}

function resolveOutputScope(value) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || !insideAllowedScope(resolved)) {
    throw new Error('output root outside allowed scope denied');
  }
  return resolved;
}

async function walkRegularFiles(base, label) {
  const out = [];
  const walk = async (prefix) => {
    const entries = (await readdir(path.join(base, prefix || '.'), { withFileTypes: true }))
      .sort((a, b) => comparePath(a.name, b.name));
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`${label} denied: ${relative}`);
      if (entry.isDirectory()) {
        await walk(relative);
        continue;
      }
      const stat = await lstat(path.join(base, relative));
      if (!stat.isFile()) throw new Error(`${label} denied: ${relative}`);
      out.push(relative);
    }
  };
  await walk('');
  return out;
}

function scanText(text, relative, context) {
  if (denySecret.test(text)) throw new Error(`secret-like value denied in ${context}: ${relative}`);
  if (remoteExecution.test(text)) throw new Error(`remote executable pattern denied in ${context}: ${relative}`);
}

async function loadCanonicalRecords(canonicalDir) {
  let stat;
  try {
    stat = await lstat(canonicalDir);
  } catch {
    throw new Error('non-canonical source path denied: canonical root is missing');
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error('non-canonical source path denied: canonical root is not a plain directory');
  }
  const relatives = await walkRegularFiles(canonicalDir, 'non-canonical source path');
  if (relatives.length === 0) throw new Error('empty canonical skill denied');
  const records = [];
  for (const relative of relatives) {
    if (activeHostPath.test(relative)) throw new Error(`hook or MCP path denied in canonical skill: ${relative}`);
    if (executableArtifact.test(relative)) throw new Error(`executable artifact denied in canonical skill: ${relative}`);
    const bytes = await readFile(path.join(canonicalDir, relative));
    scanText(bytes.toString('utf8'), relative, 'canonical skill');
    records.push({ relative, bytes, digest: sha256(bytes) });
  }
  if (!records.some((record) => record.relative === 'SKILL.md')) {
    throw new Error('canonical skill must contain SKILL.md');
  }
  return records;
}

async function writeViewFile(base, file, bytes) {
  const relative = relSafe(file);
  const absolute = path.join(base, relative);
  if (!absolute.startsWith(`${base}${path.sep}`)) throw new Error(`path escaped output root: ${file}`);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, bytes, { mode: 0o644 });
  await chmod(absolute, 0o644);
}

async function chmodDirs(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(dir, entry.name);
    await chmod(absolute, 0o755);
    await chmodDirs(absolute);
  }
}

async function verifyView(outDir, records, manifestBytes) {
  const expected = new Map([[MANIFEST_REL, manifestBytes]]);
  for (const record of records) expected.set(`skills/${SKILL_NAME}/${record.relative}`, record.bytes);

  let files;
  try {
    files = await walkRegularFiles(outDir, 'unsafe generated path');
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error(`missing generated package view denied: ${outDir}`);
    throw error;
  }

  const generated = {};
  for (const file of files) {
    const absolute = path.join(outDir, file);
    const stat = await lstat(absolute);
    if ((stat.mode & 0o111) !== 0) throw new Error(`executable mode denied in generated file: ${file}`);
    const bytes = await readFile(absolute);
    scanText(bytes.toString('utf8'), file, 'generated file');
    const expectedBytes = expected.get(file);
    if (!expectedBytes) {
      if (file.startsWith('skills/')) {
        const skill = file.slice('skills/'.length).split('/')[0];
        if (skill !== SKILL_NAME) throw new Error(`extra generated skill denied: ${skill}`);
      }
      throw new Error(`extra generated file denied: ${file}`);
    }
    if (file === MANIFEST_REL) {
      let plugin;
      try {
        plugin = JSON.parse(bytes.toString('utf8'));
      } catch {
        throw new Error('plugin manifest drift denied');
      }
      if (typeof plugin !== 'object' || plugin === null || Array.isArray(plugin)) {
        throw new Error('plugin manifest drift denied');
      }
      for (const key of FORBIDDEN_SURFACES) {
        if (key in plugin) throw new Error(`active plugin surface denied: ${key}`);
      }
    }
    if (!bytes.equals(expectedBytes)) {
      throw new Error(file === MANIFEST_REL ? 'plugin manifest drift denied' : `changed generated byte denied: ${file}`);
    }
    generated[file] = sha256(bytes);
  }
  for (const file of expected.keys()) {
    if (!(file in generated)) {
      throw new Error(file === MANIFEST_REL ? 'plugin manifest drift denied' : `missing generated file denied: ${file}`);
    }
  }
  return generated;
}

function buildReceipt(records, generated, manifestDigest, packagePath) {
  const files = records
    .map((record) => ({
      path: `skills/${SKILL_NAME}/${record.relative}`,
      canonicalSha256: record.digest,
      generatedSha256: generated[`skills/${SKILL_NAME}/${record.relative}`],
    }))
    .sort((a, b) => comparePath(a.path, b.path));
  const packageDigest = sha256(JSON.stringify({
    schemaVersion: PACKAGE_DIGEST_SCHEMA,
    packageVersion: version,
    canonicalSource: CANONICAL_SOURCE,
    manifest: { path: MANIFEST_REL, sha256: manifestDigest },
    skillFiles: files.map((file) => ({ path: file.path, sha256: file.canonicalSha256 })),
  }, null, 2));
  return {
    schemaVersion: RECEIPT_SCHEMA,
    packageVersion: version,
    canonicalSource: CANONICAL_SOURCE,
    packagePath,
    manifest: { path: MANIFEST_REL, sha256: manifestDigest },
    files,
    packageDigest,
    nonClaims: [
      'No remote install, submission or portal mutation performed.',
      'No marketplace listing, approval or runtime execution claimed.',
      'No widening of the closed KaleidoSphere action contract.',
    ],
  };
}

function loadFixture(fixturePath) {
  let fixture;
  try {
    fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));
  } catch {
    throw new Error(`canonical digest fixture denied: unreadable or invalid: ${fixturePath}`);
  }
  if (fixture && fixture.schemaVersion !== FIXTURE_SCHEMA) throw new Error('fixture schema drift denied');
  if (fixture.canonicalSource !== CANONICAL_SOURCE) throw new Error('fixture canonical source drift denied');
  const files = fixture.files;
  if (typeof files !== 'object' || files === null || Array.isArray(files) || Object.keys(files).length === 0) {
    throw new Error('fixture canonical file digest map denied');
  }
  for (const [relative, digest] of Object.entries(files)) {
    relSafe(relative);
    if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw new Error(`fixture canonical digest denied: ${relative}`);
  }
  return fixture;
}

function packagePathLabel(outDir) {
  if (outDir.startsWith(`${root}${path.sep}`)) return path.relative(root, outDir).split(path.sep).join('/');
  return outDir;
}

function assertFrozenManifest(manifestBytes, manifestDigest) {
  if (version === FROZEN_MANIFEST.version && manifestDigest !== FROZEN_MANIFEST.sha256) {
    throw new Error('frozen plugin manifest digest drift denied');
  }
}

async function runGenerate(outDir, canonicalDir) {
  const records = await loadCanonicalRecords(canonicalDir);
  const manifestBytes = buildManifestBytes(version);
  const manifestDigest = sha256(manifestBytes);
  assertFrozenManifest(manifestBytes, manifestDigest);

  try {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true, mode: 0o755 });
    await chmod(outDir, 0o755);
    await writeViewFile(outDir, MANIFEST_REL, manifestBytes);
    for (const record of records) {
      await writeViewFile(outDir, `skills/${SKILL_NAME}/${record.relative}`, record.bytes);
    }
    await chmodDirs(outDir);
    const generated = await verifyView(outDir, records, manifestBytes);
    const receipt = buildReceipt(records, generated, manifestDigest, packagePathLabel(outDir));
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
  } catch (error) {
    try {
      await rm(outDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup; the original failure below is authoritative.
    }
    throw error;
  }
}

async function runCheck(fixturePath, outDir, canonicalDir) {
  const fixture = loadFixture(fixturePath);
  const records = await loadCanonicalRecords(canonicalDir);
  for (const [relative, digest] of Object.entries(fixture.files)) {
    const record = records.find((item) => item.relative === relative);
    if (!record) throw new Error(`missing canonical skill denied: ${relative}`);
    if (record.digest !== digest) throw new Error(`canonical skill digest drift denied: ${relative}`);
  }
  for (const record of records) {
    if (!(record.relative in fixture.files)) {
      throw new Error(`undeclared canonical skill file denied: ${record.relative}`);
    }
  }
  const manifestBytes = buildManifestBytes(version);
  const manifestDigest = sha256(manifestBytes);
  assertFrozenManifest(manifestBytes, manifestDigest);
  const generated = await verifyView(outDir, records, manifestBytes);
  const receipt = buildReceipt(records, generated, manifestDigest, packagePathLabel(outDir));
  process.stdout.write(`verified ${outDir}\n`);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

const args = parseArgs(process.argv.slice(2));
const outDir = args.out === null ? path.join(root, PACKAGE_REL) : resolveOutputScope(args.out);
const canonicalDir = args.canonical === null ? path.join(root, CANONICAL_SOURCE) : resolveCanonicalScope(args.canonical);
try {
  if (args.check) await runCheck(args.fixture, outDir, canonicalDir);
  else await runGenerate(outDir, canonicalDir);
} catch (error) {
  process.stderr.write(`k4c-codex-plugin: ${error.message}\n`);
  process.exitCode = 1;
}