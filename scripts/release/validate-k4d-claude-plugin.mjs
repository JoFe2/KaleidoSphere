#!/usr/bin/env node
// Fail-closed K4D Claude Code plugin manifest validation.
//
// The repository generator is the canonical authority for package bytes. This
// adapter runs its --check route before validating the package layout against the
// official documented Claude Code plugin schema via the version-bound
// `claude plugin validate <path> --json --strict` command, and emits a
// deterministic validation receipt. The dry-run route reuses a recorded,
// location-normalized transcript so `npm test` stays deterministic and does not
// spawn the runtime. No package publication or mutation is performed.

import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const generator = path.join(root, 'scripts', 'release', 'generate-k4d-claude-plugin.mjs');
const canonicalFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-canonical-skill-digests-v1.json');
const defaultTranscriptFixture = path.join(root, 'tests', 'fixtures', 'release', 'k4d-plugin-validate-transcripts-v1.json');
const defaultOut = path.join(root, 'generated', 'claude', 'kaleidosphere');
const defaultReceipt = path.join(root, 'generated', 'claude', 'receipts', 'manifest-validation-receipt-v1.json');
const RECEIPT_SCHEMA = 'kaleidosphere/k4d-manifest-validation-receipt/v1';
const TRANSCRIPT_SCHEMA = 'kaleidosphere/k4d-plugin-validate-transcripts/v1';
const PACKAGE_DIGEST_RE = /^[a-f0-9]{64}$/;

function parseArgs(argv) {
  const args = {
    fixture: defaultTranscriptFixture,
    out: defaultOut,
    receipt: defaultReceipt,
    claude: 'claude',
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--fixture' || arg === '--out' || arg === '--receipt' || arg === '--claude') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--fixture') args.fixture = path.resolve(value);
      else if (arg === '--out') args.out = path.resolve(value);
      else if (arg === '--receipt') args.receipt = path.resolve(value);
      else args.claude = value;
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
  if (!fixture || typeof fixture !== 'object' || Array.isArray(fixture)) throw new Error('plugin-validate transcript fixture denied: expected object');
  if (fixture.schemaVersion !== TRANSCRIPT_SCHEMA) throw new Error('plugin-validate transcript fixture schema drift denied');
  if (fixture.adapter !== 'claude-code-plugin-validate') throw new Error('plugin-validate adapter identity denied');
  if (typeof fixture.adapterCommand !== 'string' || !fixture.adapterCommand.includes('<package-root>')) throw new Error('plugin-validate adapter command denied');
  if (typeof fixture.claudeVersion !== 'string' || fixture.claudeVersion.trim() === '') throw new Error('plugin-validate tool version missing');
  if (fixture.strict !== true) throw new Error('plugin-validate transcript strict flag denied');
  const transcript = fixture.successTranscript;
  if (!transcript || typeof transcript !== 'object' || Array.isArray(transcript)) throw new Error('plugin-validate success transcript denied');
  if (transcript.success !== true) throw new Error('plugin-validate success transcript must record success true');
  if (transcript.strict !== true) throw new Error('plugin-validate success transcript must be strict');
  const manifest = transcript.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('plugin-validate manifest record denied');
  if (manifest.type !== 'plugin') throw new Error('plugin-validate manifest type must be plugin');
  if (!Array.isArray(manifest.errors) || manifest.errors.length !== 0) throw new Error('plugin-validate transcript must record zero errors');
  if (!Array.isArray(transcript.contents) || transcript.contents.length !== 0) throw new Error('plugin-validate transcript contents must be empty');
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

function normalizeTranscript(transcript, label) {
  const text = JSON.stringify(transcript).replaceAll('<package-root>', label);
  return JSON.parse(text);
}

function packagePathLabel(outDir) {
  if (outDir.startsWith(`${root}${path.sep}`)) return path.relative(root, outDir).split(path.sep).join('/');
  return outDir;
}

// The committed receipt must be checkout-portable: no absolute paths. Replace the
// absolute output root with the repository-relative package label everywhere.
function portableReport(report, outDir, label) {
  const text = JSON.stringify(report).replaceAll(outDir, label);
  return JSON.parse(text);
}

function assertValidatedReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('plugin validate report denied: expected object');
  if (report.success !== true) throw new Error('plugin validate report denied: success must be true');
  if (report.strict !== true) throw new Error('plugin validate report denied: strict must be true');
  const manifest = report.manifest;
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('plugin validate manifest report denied');
  if (manifest.type !== 'plugin') throw new Error('plugin validate manifest type denied: must be plugin');
  if (!Array.isArray(manifest.errors) || manifest.errors.length !== 0) throw new Error('plugin validate errors denied: manifest has errors');
  if (!Array.isArray(report.contents) || report.contents.length !== 0) throw new Error('plugin validate contents denied: expected empty contents');
}

async function verifyLiveClaude(fixtures, args) {
  let probe;
  try {
    probe = run(args.claude, ['--version'], { cwd: root });
  } catch (error) {
    throw new Error(`claude runtime unavailable: infrastructure evidence: ${error.code || error.message}`);
  }
  if (probe.error) throw new Error(`claude runtime unavailable: infrastructure evidence: ${probe.error.code || probe.error.message}`);
  if (probe.status === null || probe.status !== 0) throw new Error(`claude runtime unavailable: infrastructure evidence: ${probe.signal || `exit ${probe.status}`}`);
  const observedVersion = probe.stdout.trim();
  const observedSemver = observedVersion.match(/^\d+\.\d+\.\d+/);
  if (!observedSemver || observedSemver[0] !== fixtures.claudeVersion) {
    throw new Error(`claude validator version drift denied: expected ${fixtures.claudeVersion}, got ${observedVersion}`);
  }

  let stat;
  try {
    stat = await lstat(args.out);
  } catch (error) {
    if (error && error.code === 'ENOENT') throw new Error('package root unavailable: infrastructure evidence: ENOENT');
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('package root unavailable: infrastructure evidence: not a plain directory');

  const result = run(args.claude, ['plugin', 'validate', args.out, '--json', '--strict'], { cwd: root });
  if (result.error) throw new Error(`claude validate unavailable: infrastructure evidence: ${result.error.code || result.error.message}`);
  if (result.status === null) throw new Error(`claude validate unavailable: infrastructure evidence: ${result.signal || 'no exit status'}`);
  // The CLI exits 0 even on validation failure; the JSON `success` field is authoritative.
  let report;
  try {
    report = JSON.parse(result.stdout.slice(result.stdout.indexOf('{')));
  } catch {
    throw new Error('claude validate report denied: malformed JSON report');
  }
  assertValidatedReport(report);
  const label = packagePathLabel(args.out);
  return {
    adapter: fixtures.adapter,
    toolVersion: fixtures.claudeVersion,
    observedVersion,
    command: fixtures.adapterCommand.replaceAll('<package-root>', label),
    execution: 'LIVE_VALIDATOR',
    report: portableReport(report, args.out, label),
  };
}

function recordedValidation(fixtures, outDir) {
  const label = packagePathLabel(outDir);
  const report = normalizeTranscript(fixtures.successTranscript, label);
  assertValidatedReport(report);
  return {
    adapter: fixtures.adapter,
    toolVersion: fixtures.claudeVersion,
    command: fixtures.adapterCommand.replaceAll('<package-root>', label),
    execution: 'RECORDED_TRANSCRIPT_DRY_RUN',
    report,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = await readJson(args.fixture, 'plugin-validate transcript fixture');
  assertTranscriptShape(fixture);

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

  const claudeValidation = args.dryRun
    ? recordedValidation(fixture, args.out)
    : await verifyLiveClaude(fixture, args);

  const receipt = {
    schemaVersion: RECEIPT_SCHEMA,
    packageVersion: generatorReceipt.packageVersion,
    packagePath: generatorReceipt.packagePath,
    packageDigest: generatorReceipt.packageDigest,
    manifest: generatorReceipt.manifest,
    canonicalVerification: {
      route: 'repository-generator',
      status: 'passed',
      generator: 'scripts/release/generate-k4d-claude-plugin.mjs',
      fixture: 'tests/fixtures/release/k4d-canonical-skill-digests-v1.json',
      receiptSchemaVersion: generatorReceipt.schemaVersion,
    },
    claudeSchemaValidation: claudeValidation,
    publicationPerformed: false,
    dryRun: args.dryRun,
    accepted: true,
    nonClaims: [
      'No package publication, submission or portal mutation performed.',
      'No marketplace listing, approval or authenticated runtime use claimed.',
    ],
  };

  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  await mkdir(path.dirname(args.receipt), { recursive: true });
  await writeFile(args.receipt, serialized, { mode: 0o644 });
  process.stdout.write(serialized);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`k4d-manifest-validation: ${error.message}\n`);
  process.exitCode = 1;
}