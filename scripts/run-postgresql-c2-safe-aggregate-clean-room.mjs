#!/usr/bin/env node
// Deterministic, source-local PostgreSQL C2 safe-aggregate clean-room (KaleidoSphere
// issue #150 / PG-KS-03). It layers exactly one net-revenue safe-aggregate operation
// (bi-ks-01-net-revenue/v1) on the certified C1 profile and runs it through the regular
// PostgreSQL product path with a SYNTHETIC read (the committed holdout bytes), captures
// the fail-closed dispatch / auth / scope / policy / typed-plan codes, and writes the
// byte-deterministic separately-versioned C2 certificate.
//
// It performs no external command, network, database connection, publication, or release
// operation. Real-disposable-PostgreSQL execution (verified least-privilege principal
// connect, the real-source positive run, and the real timeout/cancel/denied matrix) is
// NOT performed here and is recorded in the certificate as explicit BLOCKED_EXTERNAL
// non-claims; a separate parent-executed clean-room owns that execution. The certified
// route is the frozen C1 profile (re-asserted by raw digest on every run), so the
// clean-room refuses a substituted substrate and never bypasses the C1 identity/scope.

import {readFile, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  C1_CERTIFICATE_PATH,
  C1_PROFILE_PATH,
  C2_CERTIFICATE_PATH,
  C2_CONTRACT_PATH,
  HOLDOUT_FIXTURE_PATH,
  METRIC_CONTRACT_PATH,
  ORACLE_FIXTURE_PATH,
  buildPostgresqlC2Evidence,
  runPostgresqlC2FailClosedProbes,
  runPostgresqlC2SafeAggregate,
  verifyHoldoutSerializerBinding,
} from '../services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs';

const root = path.resolve(import.meta.dirname, '..');
const DEFAULT_PROFILE = path.join(root, C1_PROFILE_PATH);
const DEFAULT_HOLDOUT = path.join(root, HOLDOUT_FIXTURE_PATH);
const DEFAULT_EVIDENCE = path.join(root, C2_CERTIFICATE_PATH);

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
  const args = {profile: DEFAULT_PROFILE, holdout: DEFAULT_HOLDOUT, dryRun: false};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      args.dryRun = true;
      continue;
    }
    if (arg === '--profile' || arg === '--holdout') {
      const value = argv[index += 1];
      if (value === undefined || value.startsWith('-')) throw new Error(`missing value for ${arg}`);
      if (arg === '--profile') args.profile = resolveInsideRoot(value, 'profile');
      else args.holdout = resolveInsideRoot(value, 'holdout');
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [
    contract,
    profileBytes,
    certBytes,
    metricContractBytes,
    oracleBytes,
    holdoutBytes,
    pkg,
  ] = await Promise.all([
    readFile(path.join(root, C2_CONTRACT_PATH), 'utf8').then((s) => JSON.parse(s)),
    readFile(args.profile),
    readFile(path.join(root, C1_CERTIFICATE_PATH)),
    readFile(path.join(root, METRIC_CONTRACT_PATH)),
    readFile(path.join(root, ORACLE_FIXTURE_PATH)),
    readFile(args.holdout),
    readFile(path.join(root, 'package.json'), 'utf8').then((s) => JSON.parse(s)),
  ]);

  // The committed holdout must be reproduced byte-exactly by the serializer. The real
  // clean-room SELECT must re-serialize to these bytes or the holdout digest gate
  // rejects it; this source-local check de-risks that binding before any real read.
  verifyHoldoutSerializerBinding(holdoutBytes);

  // The synthetic source-local read returns the committed holdout bytes — the digest-bound
  // read the real clean-room performs against real PG (the same closed, digest-bound read
  // surface; only the transport differs).
  const fixture = JSON.parse(holdoutBytes.toString('utf8'));
  const syntheticRead = async () => ({
    state: 'COMPLETE',
    reasonCode: null,
    bytes: holdoutBytes,
    evidence: {
      accessMode: 'READ_ONLY',
      mutationCount: 0,
      bounded: true,
      relation: 'synthetic_bi.orders',
      rowsRead: fixture.rows.length,
    },
  });

  // The regular product path (descriptor route + C1 substrate re-asserted + typed plan).
  const result = await runPostgresqlC2SafeAggregate({
    contract,
    profileBytes,
    certBytes,
    metricContractBytes,
    oracleBytes,
    read: syntheticRead,
  });
  const failClosed = await runPostgresqlC2FailClosedProbes({
    contract,
    profileBytes,
    certBytes,
    metricContractBytes,
    oracleBytes,
    holdoutBytes,
  });

  const evidence = buildPostgresqlC2Evidence({
    descriptor: result.descriptor,
    profileBinding: result.profileBinding,
    contract,
    plan: result.plan,
    receipt: result.receipt,
    failClosed,
    release: {version: pkg.version},
  });
  const out = `${JSON.stringify(evidence, null, 2)}\n`;
  if (args.dryRun) {
    process.stdout.write(out);
  } else {
    await writeFile(path.join(root, C2_CERTIFICATE_PATH), out, {mode: 0o644});
  }
}

main().catch((error) => {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exit(1);
});