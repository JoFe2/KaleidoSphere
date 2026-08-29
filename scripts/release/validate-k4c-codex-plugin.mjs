#!/usr/bin/env node
// Fail-closed K4C Codex plugin manifest validation.
//
// The repository generator is the canonical authority for package bytes. This
// adapter runs its --check route before invoking the version-recorded
// @plugin-creator validator, and emits a deterministic validation receipt.
// No package publication or mutation is performed.

import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const generator = path.join(root, 'scripts', 'release', 'generate-k4c-codex-plugin.mjs');
const canonicalFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-canonical-skill-digests-v1.json');
const defaultTranscriptFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4c-plugin-creator-transcripts-v1.json');
const defaultValidator = '/home/jo/.openclaw/agents/main/agent/codex-home/skills/.system/plugin-creator/scripts/validate_plugin.py';
const RECEIPT_SCHEMA = 'kaleidosphere/k4c-manifest-validation-receipt/v1';
const TRANSCRIPT_SCHEMA = 'kaleidosphere/k4c-plugin-creator-transcripts/v1';
const PACKAGE_DIGEST_RE = /^[a-f0-9]{64}$/;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function digestFile(file) {
  return sha256(await readFile(file));
}

function parseArgs(argv) {
  const args = { fixture: defaultTranscriptFixture, out: path.join(root, 'packages', 'codex', 'kaleidosphere'), validator: null, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--fixture' || arg === '--out' || arg === '--validator') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--fixture') args.fixture = path.resolve(value);
      else if (arg === '--out') args.out = path.resolve(value);
      else args.validator = path.resolve(value);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

function readJson(file, label) {
  return readFile(file, 'utf8').then((contents) => {
    try {
      return JSON.parse(contents);
    } catch {
      throw new Error(`${label} denied: invalid JSON: ${file}`);
    }
  }).catch((error) => {
    if (error && error.code === 'ENOENT') throw new Error(`${label} denied: missing: ${file}`);
    if (error && error.message && error.message.startsWith(`${label} denied:`)) throw error;
    throw new Error(`${label} denied: unreadable: ${file}`);
  });
}

function assertTranscriptShape(fixture) {
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new Error('plugin-creator transcript fixture denied: expected object');
  if (fixture.schemaVersion !== TRANSCRIPT_SCHEMA) throw new Error('plugin-creator transcript fixture schema drift denied');
  if (fixture.adapter !== '@plugin-creator') throw new Error('plugin-creator adapter identity denied');
  const validator = fixture.validator;
  if (!validator || typeof validator !== 'object' || Array.isArray(validator)) throw new Error('plugin-creator validator record denied');
  if (typeof validator.path !== 'string' || !path.isAbsolute(validator.path)) throw new Error('plugin-creator validator path denied: must be absolute');
  if (typeof validator.toolVersion !== 'string' || validator.toolVersion.trim() === '') throw new Error('plugin-creator tool version missing');
  if (typeof validator.sha256 !== 'string' || !PACKAGE_DIGEST_RE.test(validator.sha256)) throw new Error('plugin-creator validator digest denied');
  const transcript = fixture.successTranscript;
  if (!transcript || typeof transcript !== 'object' || Array.isArray(transcript)) throw new Error('plugin-creator success transcript denied');
  if (transcript.exitCode !== 0) throw new Error('plugin-creator success transcript must record exit code 0');
  for (const field of ['command', 'stdout', 'stderr']) {
    if (typeof transcript[field] !== 'string') throw new Error(`plugin-creator success transcript field denied: ${field}`);
  }
  if (!transcript.command.includes('<validator>') || !transcript.command.includes('<plugin-root>')) throw new Error('plugin-creator transcript command must bind validator and package root');
  if (fixture.publicationPerformed !== false) throw new Error('publication claim denied');
}

function parseGeneratorReceipt(stdout) {
  const start = stdout.indexOf('{');
  if (start < 0) throw new Error('repository generator receipt denied: missing JSON receipt');
  try {
    return JSON.parse(stdout.slice(start));
  } catch {
    throw new Error('repository generator receipt denied: invalid JSON receipt');
  }
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function formatCommand(template, validator, outDir) {
  return template
    .replaceAll('<validator>', validator)
    .replaceAll('<plugin-root>', outDir);
}

async function verifyPluginCreator(fixture, validator, outDir) {
  let stat;
  try {
    stat = await lstat(validator);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`plugin-creator validator unavailable: infrastructure evidence: ENOENT: ${validator}`);
    }
    throw new Error(`plugin-creator validator unavailable: infrastructure evidence: ${error.message}`);
  }
  if (!stat.isFile()) throw new Error(`plugin-creator validator unavailable: infrastructure evidence: not a regular file: ${validator}`);

  let actualDigest;
  try {
    actualDigest = await digestFile(validator);
  } catch (error) {
    throw new Error(`plugin-creator validator unavailable: infrastructure evidence: ${error.code || error.message}`);
  }
  if (actualDigest !== fixture.validator.sha256) {
    throw new Error(`plugin-creator validator version drift denied: expected ${fixture.validator.sha256}, got ${actualDigest}`);
  }

  const result = run('python3', [validator, outDir], { cwd: root });
  if (result.error) {
    throw new Error(`plugin-creator validator unavailable: infrastructure evidence: ${result.error.code || result.error.message}`);
  }
  if (result.status === null) {
    throw new Error(`plugin-creator validator unavailable: infrastructure evidence: ${result.signal || 'process did not return an exit status'}`);
  }
  if (result.status !== 0) {
    throw new Error(`plugin-creator validator nonzero denied: exit ${result.status}\n${result.stdout}${result.stderr}`);
  }

  const expected = fixture.successTranscript;
  const expectedStdout = expected.stdout.replaceAll('<plugin-root>', outDir);
  const expectedStderr = expected.stderr.replaceAll('<plugin-root>', outDir);
  if (result.stdout !== expectedStdout || result.stderr !== expectedStderr) {
    throw new Error('plugin-creator validator transcript drift denied');
  }
  return {
    adapter: fixture.adapter,
    toolVersion: fixture.validator.toolVersion,
    validatorPath: fixture.validator.path,
    validatorSha256: actualDigest,
    transcript: {
      command: formatCommand(expected.command, validator, outDir),
      exitCode: result.status,
      stdout: expected.stdout,
      stderr: expected.stderr,
    },
  };
}

function recordedPluginCreatorVerification(fixture, validator, outDir) {
  const expected = fixture.successTranscript;
  return {
    adapter: fixture.adapter,
    toolVersion: fixture.validator.toolVersion,
    validatorPath: fixture.validator.path,
    validatorSha256: fixture.validator.sha256,
    transcript: {
      command: formatCommand(expected.command, validator, outDir),
      exitCode: expected.exitCode,
      stdout: expected.stdout,
      stderr: expected.stderr,
    },
    execution: 'RECORDED_TRANSCRIPT_DRY_RUN',
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // The fixture is read before any external command, while the generator check
  // is deliberately first in the acceptance sequence. A plugin-creator pass
  // can never substitute for canonical digest verification.
  const fixture = await readJson(args.fixture, 'plugin-creator transcript fixture');
  assertTranscriptShape(fixture);
  const validator = args.validator || fixture.validator.path || defaultValidator;
  if (!path.isAbsolute(validator)) throw new Error('plugin-creator validator path denied: must be absolute');

  const generatorResult = run(process.execPath, [
    generator,
    '--check',
    '--fixture',
    canonicalFixture,
    '--out',
    args.out,
  ], { cwd: root });
  if (generatorResult.error) {
    throw new Error(`repository generator unavailable: infrastructure evidence: ${generatorResult.error.code || generatorResult.error.message}`);
  }
  if (generatorResult.status === null) {
    throw new Error(`repository generator unavailable: infrastructure evidence: ${generatorResult.signal || 'process did not return an exit status'}`);
  }
  if (generatorResult.status !== 0) {
    throw new Error(`repository generator validation denied: exit ${generatorResult.status}\n${generatorResult.stdout}${generatorResult.stderr}`);
  }
  const generatorReceipt = parseGeneratorReceipt(generatorResult.stdout);
  if (!generatorReceipt.manifest || !PACKAGE_DIGEST_RE.test(generatorReceipt.manifest.sha256 || '')) {
    throw new Error('repository generator receipt denied: manifest digest missing');
  }
  if (!PACKAGE_DIGEST_RE.test(generatorReceipt.packageDigest || '')) {
    throw new Error('repository generator receipt denied: package digest missing');
  }

  let pluginCreator;
  try {
    pluginCreator = await verifyPluginCreator(fixture, validator, args.out);
    pluginCreator.execution = 'LIVE_VALIDATOR';
  } catch (error) {
    const portableDryRun = args.dryRun && args.validator === null
      && /plugin-creator validator unavailable: infrastructure evidence: ENOENT/.test(error.message);
    if (!portableDryRun) throw error;
    pluginCreator = recordedPluginCreatorVerification(fixture, validator, args.out);
  }
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    packageVersion: generatorReceipt.packageVersion,
    packagePath: generatorReceipt.packagePath,
    packageDigest: generatorReceipt.packageDigest,
    manifest: generatorReceipt.manifest,
    canonicalVerification: {
      route: 'repository-generator',
      status: 'passed',
      generator: 'scripts/release/generate-k4c-codex-plugin.mjs',
      fixture: 'tests/fixtures/release/k4c-canonical-skill-digests-v1.json',
      receiptSchemaVersion: generatorReceipt.schemaVersion,
    },
    pluginCreatorVerification: pluginCreator,
    publicationPerformed: false,
    dryRun: args.dryRun,
    accepted: true,
    nonClaims: [
      'No package publication, submission or portal mutation performed.',
      'No marketplace listing, approval or runtime execution claimed.',
    ],
  };
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4c-manifest-validation: ${error.message}\n`);
  process.exitCode = 1;
}
