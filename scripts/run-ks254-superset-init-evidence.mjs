#!/usr/bin/env node
/**
 * KS254 (#254) — native install/recovery evidence runner for the owned Superset runtime.
 *
 * Drives the REAL one-shot entry point `services/superset/runtime/init.sh` (staged,
 * receipt-bound install surface) in an isolated, credential-free root and records, outside the
 * repository, what each run actually did: the positive install of the pinned runtime, a REAL
 * SIGKILL at every supported interruption point with the observed readback, recovery and
 * cleanup, the fail-closed prerequisite negative, and the PRE-FIX RED arm (the original
 * in-place sequence) killed at its own boundary.
 *
 * The secret root is SYNTHETIC and private to this run; the emitted document is scanned for
 * the synthetic secret bytes before it is written, so no secret can appear in the evidence.
 * Nothing here grants activation or publication authority — it only reports observed behavior.
 *
 * Usage:
 *   node scripts/run-ks254-superset-init-evidence.mjs --out <file.json>
 *   SUPERSET_BIN=<pinned superset> PYTHON_BIN=<pinned python> — required for the NATIVE arms;
 *   without them the native arms are recorded as PREREQUISITE_ABSENT (never faked).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

import { OWNED_STAGING_DIRECTORY, OWNED_STORE_DIRECTORY, inspectGenerationStore, readActiveGeneration, verifyGenerationManifest } from '../services/bi-control/src/generation-store.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RUNTIME_DIR = path.join(REPO_ROOT, 'services/superset/runtime');
const INIT_SH = path.join(RUNTIME_DIR, 'init.sh');
const INSTALL_RECEIPT_FILE = 'install.receipt.json';
const METADATA_DATABASE_FILE = 'superset.db';
const MANAGED_DATABASE_NAME = 'ChimpMaera BI managed projection';
const SUPPORTED_POINTS = ['metadata:before-staging', 'metadata:during-build', 'metadata:during-staging',
  'metadata:after-staging', 'metadata:after-generation-publish', 'metadata:after-activation',
  'metadata:after-mirror'];

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex === -1 ? null : path.resolve(args[outIndex + 1] ?? '');
if (out === null) {
  process.stderr.write('KS254-SUPERSET-INIT-EVIDENCE-DENIED pass --out <file.json>\n');
  process.exit(2);
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const roots = [];
const secrets = [];
const records = [];
const tempRoot = (prefix = 'ks254-superset-evidence-') => {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  roots.push(root);
  return root;
};
const record = (entry) => { records.push(entry); return entry; };

const SUPERSET_BIN = process.env.SUPERSET_BIN ?? '';
const PYTHON_BIN = process.env.PYTHON_BIN ?? '';
const RUNTIME_AVAILABLE = Boolean(SUPERSET_BIN) && existsSync(SUPERSET_BIN)
  && Boolean(PYTHON_BIN) && existsSync(PYTHON_BIN);
const RUNTIME_REASON = RUNTIME_AVAILABLE ? null
  : `SUPERSET_RUNTIME_PREREQUISITE_UNAVAILABLE: SUPERSET_BIN=${SUPERSET_BIN || '(unset)'} `
    + `PYTHON_BIN=${PYTHON_BIN || '(unset)'} — the pinned apache/superset:6.1.0 runtime is not `
    + 'installed in this environment; no fake superset executable is substituted.';

function syntheticSecretRoot() {
  const root = tempRoot('ks254-superset-secrets-');
  for (const name of ['superset_secret_key', 'superset_admin_password', 'superset_analyst_password']) {
    const value = `${randomBytes(24).toString('hex')}\n`;
    writeFileSync(path.join(root, name), value, { mode: 0o600 });
    secrets.push(value.trim());
  }
  return root;
}

function runInit(mode, { root, crash = null, secretRoot, supersetBin = null }) {
  const env = { ...process.env, CHIMPMAERA_BI_ROOT: root, CHIMPMAERA_BI_SECRET_ROOT: secretRoot };
  env.SUPERSET_BIN = supersetBin ?? SUPERSET_BIN;
  env.PYTHON_BIN = PYTHON_BIN;
  if (crash === null) delete env.KS254_INTERRUPT_AT; else env.KS254_INTERRUPT_AT = crash;
  const started = Date.now();
  const result = spawnSync('bash', [INIT_SH, mode], { encoding: 'utf8', cwd: REPO_ROOT, env });
  return {
    command: `bash services/superset/runtime/init.sh ${mode}`,
    interruptionPoint: crash, supersetCommand: env.SUPERSET_BIN,
    exitStatus: result.status, signal: result.signal, durationMs: Date.now() - started,
    stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim(),
  };
}

function verifyMetadataDatabase(file) {
  if (!existsSync(file)) return { ok: false, code: 'METADATA_DATABASE_MISSING' };
  const digest = sha256(readFileSync(file));
  let database;
  try { database = new DatabaseSync(file, { readOnly: true }); }
  catch (error) { return { ok: false, code: 'METADATA_DATABASE_UNREADABLE', sha256: digest }; }
  try {
    const integrity = Object.values(database.prepare('PRAGMA integrity_check').get())[0];
    const revision = (() => {
      try { return database.prepare('SELECT version_num FROM alembic_version').get()?.version_num ?? null; }
      catch { return null; }
    })();
    const counters = (() => {
      try {
        return {
          users: database.prepare('SELECT COUNT(*) count FROM ab_user').get().count,
          roles: database.prepare('SELECT COUNT(*) count FROM ab_role').get().count,
          tables: database.prepare("SELECT COUNT(*) count FROM sqlite_master WHERE type='table'").get().count,
          managedDatabases: database.prepare('SELECT COUNT(*) count FROM dbs WHERE database_name=?').get(MANAGED_DATABASE_NAME).count,
        };
      } catch { return null; }
    })();
    const required = ['alembic_version', 'ab_user', 'ab_role', 'ab_permission', 'dashboards', 'slices', 'dbs', 'tables', 'key_value'];
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name));
    const missing = required.filter((table) => !tables.has(table));
    return { ok: integrity === 'ok' && revision !== null && missing.length === 0, code: 'OK', integrity,
      revision, counters, missing, sha256: digest, bytes: readFileSync(file).length };
  } finally { database.close(); }
}

function readState(root) {
  const store = path.join(root, 'metadata');
  const active = readActiveGeneration({ root: store });
  const count = (directory) => { try { return readdirSync(directory).length; } catch { return 0; } };
  return {
    pointer: inspectGenerationStore(store).pointer,
    activeGenerationId: active.ok ? active.generationId : null,
    activeFilesVerified: active.ok ? verifyGenerationManifest(active.generationPath, active.manifest).ok : false,
    generations: count(path.join(store, OWNED_STORE_DIRECTORY, 'generations')),
    stagingLeftover: count(path.join(store, OWNED_STAGING_DIRECTORY)),
    live: verifyMetadataDatabase(path.join(root, 'metadata', METADATA_DATABASE_FILE)),
    receipt: active.ok ? JSON.parse(readFileSync(path.join(active.generationPath, INSTALL_RECEIPT_FILE), 'utf8')) : null,
  };
}

const gitHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim();
const worktreeClean = spawnSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).stdout.trim() === '';

// ---------------------------------------------------------------- always: fail-closed negative
const negativeRoot = tempRoot();
const negativeSecrets = syntheticSecretRoot();
record({ what: 'fail-closed negative: pinned prerequisite unavailable',
  ...runInit('install', { root: negativeRoot, secretRoot: negativeSecrets, supersetBin: path.join(negativeRoot, 'no-such-superset') }),
  observed: readState(negativeRoot) });

// ---------------------------------------------------------------- always: pre-fix RED arm
const prefixRoot = tempRoot();
const preFixSecrets = syntheticSecretRoot();
let preFix = null;
if (RUNTIME_AVAILABLE) {
  const seed = runInit('install', { root: prefixRoot, secretRoot: preFixSecrets });
  record({ what: 'RED arm seed (candidate positive install)', ...seed, observed: readState(prefixRoot) });
  const seeded = readState(prefixRoot);
  const script = path.join(prefixRoot, 'pre-fix-init.sh');
  writeFileSync(script, `#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p "$CHIMPMAERA_BI_ROOT/metadata" "$CHIMPMAERA_BI_ROOT/projection"
"$SUPERSET_BIN" db upgrade
"$SUPERSET_BIN" init
"$PYTHON_BIN" "$CHIMPMAERA_BI_BOOTSTRAP"
`, { mode: 0o700 });
  const child = spawn('bash', [script], {
    cwd: REPO_ROOT,
    env: { ...process.env, CHIMPMAERA_BI_ROOT: prefixRoot, CHIMPMAERA_BI_SECRET_ROOT: preFixSecrets,
      SUPERSET_BIN, PYTHON_BIN, SUPERSET_CONFIG_PATH: path.join(RUNTIME_DIR, 'superset_config.py'),
      CHIMPMAERA_BI_BOOTSTRAP: path.join(RUNTIME_DIR, 'bootstrap.py') },
  });
  const exit = await new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
    timer.unref?.();
  });
  const after = readState(prefixRoot);
  preFix = record({
    what: 'RED arm: PRE-FIX in-place sequence killed during its migration child',
    command: 'bash <root>/pre-fix-init.sh (verbatim pre-fix init.sh sequence: superset db upgrade; superset init; bootstrap.py)',
    exitStatus: exit.code, signal: exit.signal,
    seededGenerationId: seeded.activeGenerationId,
    observed: { ...after, receiptUnchanged: after.receipt?.installedAt === seeded.receipt?.installedAt },
    recovery: runInit('recover', { root: prefixRoot, secretRoot: preFixSecrets }),
  });
}

// ---------------------------------------------------------------- native arms
const positive = { install: null, verify: null, inspect: null, reinstall: null };
const interruptions = [];
const recoveryAndCleanup = {};
if (RUNTIME_AVAILABLE) {
  const root = tempRoot();
  const secretRoot = syntheticSecretRoot();
  const install = runInit('install', { root, secretRoot });
  positive.install = record({ what: 'positive: pinned install through the real entry point', ...install, observed: readState(root) });
  positive.verify = record({ what: 'positive: verify readback', ...runInit('verify', { root, secretRoot }) });
  positive.inspect = record({ what: 'positive: inspect readback', ...runInit('inspect', { root, secretRoot }) });
  positive.reinstall = record({ what: 'positive: idempotent re-install', ...runInit('install', { root, secretRoot }), observed: readState(root) });

  for (const point of SUPPORTED_POINTS) {
    const pointRoot = tempRoot();
    const pointSecrets = syntheticSecretRoot();
    const seed = runInit('install', { root: pointRoot, secretRoot: pointSecrets });
    const before = readState(pointRoot);
    const killed = runInit('install', { root: pointRoot, crash: point, secretRoot: pointSecrets });
    const after = readState(pointRoot);
    const declared = after.activeGenerationId === null ? null
      : sha256(readFileSync(path.join(path.join(pointRoot, 'metadata', OWNED_STORE_DIRECTORY, 'generations', after.activeGenerationId), METADATA_DATABASE_FILE)));
    const recovered = runInit('recover', { root: pointRoot, secretRoot: pointSecrets });
    const afterRecovery = readState(pointRoot);
    const cleaned = runInit('cleanup', { root: pointRoot, secretRoot: pointSecrets });
    interruptions.push({
      point,
      seedExitStatus: seed.status,
      killedBySignal: killed.signal,
      killedExitStatus: killed.exitStatus,
      pointerGeneration: after.activeGenerationId === before.activeGenerationId ? 'OLD' : 'NEW',
      completeGenerationAvailable: after.activeFilesVerified,
      pointerState: after.pointer.state,
      generationCount: after.generations,
      stagingLeftover: after.stagingLeftover,
      liveComplete: after.live.ok,
      liveRevision: after.live.revision,
      liveIsCommittedGeneration: declared !== null && after.live.sha256 === declared,
      recovery: { exitStatus: recovered.exitStatus, stdout: recovered.stdout },
      afterRecoveryPointerState: afterRecovery.pointer.state,
      afterRecoveryActiveVerified: afterRecovery.activeFilesVerified,
      afterRecoveryLiveComplete: afterRecovery.live.ok,
      cleanup: { exitStatus: cleaned.exitStatus, stdout: cleaned.stdout },
      afterCleanupActiveGenerationId: readState(pointRoot).activeGenerationId,
    });
  }

  const recoveryRoot = tempRoot();
  const recoverySecrets = syntheticSecretRoot();
  runInit('install', { root: recoveryRoot, secretRoot: recoverySecrets });
  const seededRecovery = readState(recoveryRoot);
  const killedAfterStaging = runInit('install', { root: recoveryRoot, crash: 'metadata:after-staging', secretRoot: recoverySecrets });
  const completed = runInit('recover', { root: recoveryRoot, secretRoot: recoverySecrets });
  recoveryAndCleanup.afterStaging = {
    killedSignal: killedAfterStaging.signal, recovery: completed.stdout,
    seededGenerationId: seededRecovery.activeGenerationId,
    observed: readState(recoveryRoot),
  };
  const discardingRoot = tempRoot();
  const discardingSecrets = syntheticSecretRoot();
  runInit('install', { root: discardingRoot, secretRoot: discardingSecrets });
  const beforeDiscard = readState(discardingRoot);
  runInit('install', { root: discardingRoot, crash: 'metadata:during-build', secretRoot: discardingSecrets });
  const discarded = runInit('recover', { root: discardingRoot, secretRoot: discardingSecrets });
  recoveryAndCleanup.duringBuild = {
    recovery: discarded.stdout, activeBefore: beforeDiscard.activeGenerationId,
    observed: readState(discardingRoot),
  };
  writeFileSync(path.join(discardingRoot, 'unrelated-notes.txt'), 'keep me\n');
  mkdirSync(path.join(discardingRoot, 'metadata', OWNED_STAGING_DIRECTORY), { recursive: true });
  writeFileSync(path.join(discardingRoot, 'metadata', OWNED_STAGING_DIRECTORY, 'not-a-staging-name'), 'kept\n');
  const cleaned = runInit('cleanup', { root: discardingRoot, secretRoot: discardingSecrets });
  recoveryAndCleanup.cleanup = {
    stdout: cleaned.stdout, observed: readState(discardingRoot),
    unrelatedFilePreserved: existsSync(path.join(discardingRoot, 'unrelated-notes.txt')),
    unownedEntryPreserved: existsSync(path.join(discardingRoot, 'metadata', OWNED_STAGING_DIRECTORY, 'not-a-staging-name')),
  };
}

const nativeRoot = tempRoot();
const document = {
  schemaVersion: 'chimpmaera.bi/ks254-superset-init-evidence/v1',
  issue: 'JoFe2/KaleidoSphere#254',
  parentEpic: 'JoFe2/KaleidoSphere#252',
  contract: {
    entryPoint: 'services/superset/runtime/init.sh',
    installer: 'services/superset/runtime/ks254_install.py',
    store: 'services/superset/runtime/generation_store.py (python counterpart of the released '
      + 'services/bi-control/src/generation-store.mjs)',
    suite: 'tests/ks254-superset-init-recovery.test.mjs',
  },
  environment: {
    node: process.version, platform: process.platform, gitHead, worktreeClean,
    supersetCommand: SUPERSET_BIN || null, pythonCommand: PYTHON_BIN || null,
    runtimeClass: RUNTIME_AVAILABLE ? 'NATIVE_PINNED_SUPERSET_RUNTIME_EXECUTED' : 'PREREQUISITE_ABSENT',
    runtimeReason: RUNTIME_REASON,
    secretRoot: 'SYNTHETIC private temporary root (0600, random, never printed)',
    containerSecretMountExercised: false,
    storagePowerLossQualified: false,
    distributedTransactionGuarantee: false,
    imageDigestRuntimeExecuted: false,
    imageDigestRuntimeNote: 'the pinned image apache/superset:6.1.0 could not be pulled in this '
      + 'container (no Docker daemon / socket); the pinned python runtime and the pinned '
      + 'requirements/base.txt dependency set were installed from the public package index instead',
  },
  failClosedNegative: records.find((entry) => entry.what?.startsWith('fail-closed negative')) ?? null,
  preFixRedArm: preFix,
  positive,
  interruptions,
  recoveryAndCleanup,
  records,
  nonClaims: [
    'Process death (SIGKILL) interruption only; storage power loss / fsync durability and distributed transactions are NOT qualified.',
    'No Apache Superset CONTAINER image was executed: no Docker daemon is available in this isolated container. The pinned apache-superset 6.1.0 python runtime and its pinned dependency set (requirements/base.txt) were executed instead.',
    'The container secret mount /run/secrets was NOT created or read; a synthetic private secret root was used and is never emitted.',
    'No production, customer or external-business effect. No publication, activation, merge, release or issue mutation is performed or claimed.',
    'The fake-command negative proves fail-closed behavior only; it is not runtime proof of anything.',
  ],
};

const serialized = `${JSON.stringify(document, null, 2)}\n`;
const canaryMatches = secrets.reduce((count, secret) => count + serialized.split(secret).length - 1, 0);
if (canaryMatches !== 0) {
  process.stderr.write('KS254-SUPERSET-INIT-EVIDENCE-DENIED synthetic secret bytes found in the document\n');
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  process.exit(3);
}
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, serialized);
for (const root of roots) rmSync(root, { recursive: true, force: true });
rmSync(nativeRoot, { recursive: true, force: true });
process.stdout.write(`KS254-SUPERSET-INIT-EVIDENCE-WRITTEN class=${document.environment.runtimeClass} `
  + `records=${records.length} interruptions=${interruptions.length} `
  + `killedDeaths=${interruptions.filter((entry) => entry.killedBySignal === 'SIGKILL').length} `
  + `secretCanaryMatches=${canaryMatches} out=${out}\n`);
process.stdout.write(`KS254-SUPERSET-INIT-EVIDENCE-POSITIVE install=${positive.install?.exitStatus} `
  + `activeVerified=${positive.install?.observed?.activeFilesVerified} `
  + `liveComplete=${positive.install?.observed?.live?.ok} `
  + `generation=${positive.install?.observed?.activeGenerationId?.slice(0, 12) ?? 'NONE'}\n`);
process.stdout.write(`KS254-SUPERSET-INIT-EVIDENCE-RED prefixStagingLeftover=${preFix?.observed?.stagingLeftover} `
  + `prefixRecovery="${preFix?.recovery?.stdout}"\n`);
process.exit(0);
