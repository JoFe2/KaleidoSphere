#!/usr/bin/env node
// Deterministic, source-local PostgreSQL C1 clean-room (KaleidoSphere issue #149 /
// PG-KS-02). It runs the regular Analyze-to-Readback product path against the frozen
// query pack and a synthetic result fixture, captures the fail-closed dispatch / auth /
// scope / policy codes, and writes the byte-deterministic C1 certificate.
//
// It performs no external command, network, database connection, publication, or release
// operation. Real-disposable-PostgreSQL execution (verified least-privilege principal
// connect, real-source positive run, live timeout/cancel/denied matrix) is not performed
// here and is recorded in the certificate as explicit BLOCKED_EXTERNAL non-claims; a
// separate credential-free worker gate owns that execution (scripts/run-postgresql-e2e.sh).

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  buildPostgresqlC1Evidence,
  validatePostgresqlC1Profile,
} from '../services/bi-control/src/db-analyzer/postgresql-c1.mjs';

const root = path.resolve(import.meta.dirname, '..');
const DEFAULT_PROFILE = path.join(root, 'contracts', 'connectors', 'postgresql', 'c1-profile-v1.json');
const DEFAULT_EVIDENCE = path.join(root, 'verification', 'postgresql', 'postgresql-c1-evidence-v1.json');

function inside(scope, candidate) {
  return candidate === scope || candidate.startsWith(`${scope}${path.sep}`);
}

function resolveInsideRoot(value, label) {
  const resolved = path.resolve(value);
  if (resolved.includes('\0') || (!inside(root, resolved) && !inside(os.tmpdir(), resolved))) {
    throw new Error(`${label} path outside repository or temporary scope denied`);
  }
  return resolved;
}

function parseArgs(argv) {
  const args = {profile: DEFAULT_PROFILE, evidence: DEFAULT_EVIDENCE, dryRun: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--profile' || arg === '--evidence') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--profile') args.profile = resolveInsideRoot(value, 'profile');
      else args.evidence = resolveInsideRoot(value, 'evidence');
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function readJsonWithBytes(file, label) {
  let bytes;
  try {
    bytes = await readFile(file);
  } catch (error) {
    throw new Error(`${label} denied: ${error.code || 'unreadable'}`);
  }
  try {
    return {bytes, value: JSON.parse(bytes.toString('utf8'))};
  } catch {
    throw new Error(`${label} denied: invalid JSON`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const {bytes: profileBytes, value: profile} = await readJsonWithBytes(args.profile, 'c1 profile');
  validatePostgresqlC1Profile(profile);
  const evidence = await buildPostgresqlC1Evidence({repoRoot: root, profile, profileBytes});
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (!args.dryRun) {
    await mkdir(path.dirname(args.evidence), {recursive: true});
    await writeFile(args.evidence, serialized, {mode: 0o644});
  }
  process.stdout.write(serialized);
}

try {
  await main();
} catch (error) {
  process.stderr.write(`run-postgresql-c1-clean-room: ${error.message}\n`);
  process.exitCode = 1;
}
