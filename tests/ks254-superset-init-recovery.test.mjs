// KS254 (JoFe2/KaleidoSphere#254) — staged, receipt-bound install/recovery of the OWNED
// Superset runtime through the REAL one-shot entry point `services/superset/runtime/init.sh`.
//
// AC01 — reproduce interruption during dependency provisioning and before/after the
//        projection/receipt writes against the NATIVE paths: the real entry point is started
//        and the process really dies (SIGKILL, no unwinding) at every supported point of its
//        staging/commit sequence.
// AC02 — at each supported crash point a reader sees a COMPLETE old or COMPLETE new
//        generation — never mixed data/evidence and never a deleted-only dependency state.
// AC03 — exercise recovery and cleanup of OWNED staging paths without deleting the active
//        generation; retain exact source and native readback evidence.
//
// CLASS DISCLOSURE (required by the issue: a helper-only test must disclose its boundary):
//
//   * NATIVE arms drive the real entry point with the real pinned runtime commands
//     (`superset db upgrade`, `superset init`, `bootstrap.py` from apache-superset 6.1.0 with
//     the requirements/base.txt dependency pins). They SKIP — carrying that exact reason in the
//     skip message, never substituting or faking a `superset` executable — when the
//     environment has no Superset runtime. The evidence runner
//     `scripts/run-ks254-superset-init-evidence.mjs` records which class actually ran.
//   * HELPER arms (the node<->python generation-store parity arm and the synthetic-generation
//     recovery arm) are module/entry-point level only: they drive the RELEASED node generation
//     store and a synthetic generation, and never start Apache Superset. They are not
//     presented as native runtime proof.
//
// Non-claims: process death (SIGKILL) only; no storage power-loss/fsync or distributed
// transaction guarantee. The live metadata database is a working copy the runtime may mutate
// after activation; the immutable generation directory is the verified rollback point.
//
// Run: node --test tests/ks254-superset-init-recovery.test.mjs
// Native arms additionally need: SUPERSET_BIN=<pinned superset> PYTHON_BIN=<pinned python>

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  GENERATION_MANIFEST_FILE, OWNED_STAGING_DIRECTORY, OWNED_STORE_DIRECTORY,
  activateGeneration, cleanupGenerationStore, inspectGenerationStore, readActiveGeneration,
  recoverGenerationStore, stageGeneration, verifyGenerationManifest,
} from '../services/bi-control/src/generation-store.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const RUNTIME_DIR = path.join(REPO_ROOT, 'services/superset/runtime');
const INIT_SH = path.join(RUNTIME_DIR, 'init.sh');
const INSTALL_RECEIPT_FILE = 'install.receipt.json';
const METADATA_DATABASE_FILE = 'superset.db';
const REQUIRED_TABLES = ['alembic_version', 'ab_user', 'ab_role', 'ab_permission', 'dashboards',
  'slices', 'dbs', 'tables', 'key_value'];
const MANAGED_DATABASE_NAME = 'ChimpMaera BI managed projection';

// The supported interruption points of the install surface, each with the state a reader MUST
// observe afterwards: which complete generation the single pointer names, how many OWNED
// staging directories may be left, and whether the live working copy is still the committed
// generation's exact bytes.
const SUPPORTED_POINTS = Object.freeze([
  { point: 'metadata:before-staging', pointer: 'OLD', staging: 0, liveInSync: true },
  { point: 'metadata:during-build', pointer: 'OLD', staging: 1, liveInSync: true },
  { point: 'metadata:during-staging', pointer: 'OLD', staging: 1, liveInSync: true },
  { point: 'metadata:after-staging', pointer: 'OLD', staging: 1, liveInSync: true },
  { point: 'metadata:after-generation-publish', pointer: 'OLD', staging: 0, liveInSync: true },
  { point: 'metadata:after-activation', pointer: 'NEW', staging: 0, liveInSync: false },
  { point: 'metadata:after-mirror', pointer: 'NEW', staging: 0, liveInSync: true },
]);

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ---------------------------------------------------------------- environment / classes
const SUPERSET_BIN = process.env.SUPERSET_BIN ?? '';
const PYTHON_BIN = process.env.PYTHON_BIN ?? '';
const missingPrerequisites = [];
if (!SUPERSET_BIN) missingPrerequisites.push('SUPERSET_BIN is not set');
else if (!existsSync(SUPERSET_BIN)) missingPrerequisites.push(`SUPERSET_BIN=${SUPERSET_BIN} does not exist`);
if (!PYTHON_BIN) missingPrerequisites.push('PYTHON_BIN is not set');
else if (!existsSync(PYTHON_BIN)) missingPrerequisites.push(`PYTHON_BIN=${PYTHON_BIN} does not exist`);
const NATIVE_SKIP = missingPrerequisites.length === 0 ? false
  : `SUPERSET_RUNTIME_PREREQUISITE_UNAVAILABLE: ${missingPrerequisites.join('; ')} — the pinned `
    + 'apache/superset:6.1.0 runtime (python dependency pins from requirements/base.txt) is not '
    + 'installed in this environment. No fake superset executable is substituted and no native '
    + 'runtime proof is claimed. Re-run with SUPERSET_BIN=<pinned superset> PYTHON_BIN=<pinned python>.';

const helperPython = [PYTHON_BIN, 'python3', 'python'].filter(Boolean)
  .find((candidate) => spawnSync(candidate, ['-c', 'print(1)'], { encoding: 'utf8' }).status === 0) ?? null;
const HELPER_SKIP = helperPython === null
  ? 'PYTHON_INTERPRETER_UNAVAILABLE: the Superset-runtime python counterpart of the released node '
    + 'generation store cannot be exercised without a python interpreter.'
  : false;

const tempRoots = [];
function tempRoot(prefix = 'ks254-superset-init-') {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
}
test.after(() => { for (const root of tempRoots) rmSync(root, { recursive: true, force: true }); });

// A SYNTHETIC, credential-free isolated install harness: the secret root the runtime reads is a
// private temporary directory (0600, random values, never printed). The container's own
// /run/secrets mount is never created, read or claimed.
function syntheticSecretRoot() {
  const root = tempRoot('ks254-secrets-');
  for (const name of ['superset_secret_key', 'superset_admin_password', 'superset_analyst_password']) {
    writeFileSync(path.join(root, name), `${randomBytes(24).toString('hex')}\n`, { mode: 0o600 });
  }
  return root;
}

// Drive the REAL entry point. `crash` arms the product's OWN interruption hook, so the child
// really dies on a signal. `supersetBin` overrides the pinned command, used only by the
// fail-closed prerequisite negative.
function runInit(mode, { root, crash = null, secretRoot, supersetBin = null, pythonBin = null }) {
  const env = { ...process.env, CHIMPMAERA_BI_ROOT: root, CHIMPMAERA_BI_SECRET_ROOT: secretRoot };
  env.SUPERSET_BIN = supersetBin ?? SUPERSET_BIN;
  env.PYTHON_BIN = pythonBin ?? PYTHON_BIN;
  if (crash === null) delete env.KS254_INTERRUPT_AT;
  else env.KS254_INTERRUPT_AT = crash;
  const result = spawnSync('bash', [INIT_SH, mode], { encoding: 'utf8', cwd: REPO_ROOT, env });
  return { ...result, stdout: (result.stdout ?? '').trim(), stderr: (result.stderr ?? '').trim() };
}

const assertKilled = (result, label) => {
  assert.equal(result.signal, 'SIGKILL',
    `${label}: expected a real SIGKILL process death, got status=${result.status} signal=${result.signal} ${result.stderr}`);
  assert.equal(result.status, null, `${label}: a signal death carries no exit status`);
};

// ---------------------------------------------------------------- readers (released node store)
const storeOf = (root) => path.join(root, 'metadata');
const liveDatabaseOf = (root) => path.join(root, 'metadata', METADATA_DATABASE_FILE);

// The RELEASED node store reads the python store's own directories: the readback below is the
// released implementation resolving the Superset-runtime implementation's state.
function readState(root) {
  const store = storeOf(root);
  const active = readActiveGeneration({ root: store });
  const countOf = (directory) => {
    try { return readdirSync(directory).length; } catch { return 0; }
  };
  return {
    store: inspectGenerationStore(store),
    active,
    manifestVerified: active.ok ? verifyGenerationManifest(active.generationPath, active.manifest) : null,
    stagingCount: countOf(path.join(store, OWNED_STAGING_DIRECTORY)),
    generationCount: countOf(path.join(store, OWNED_STORE_DIRECTORY, 'generations')),
    live: verifyMetadataDatabase(liveDatabaseOf(root)),
    receipt: active.ok
      ? JSON.parse(readFileSync(path.join(active.generationPath, INSTALL_RECEIPT_FILE), 'utf8'))
      : null,
  };
}

// Structural completeness of a metadata database. The LIVE working copy legitimately drifts
// after activation, so it is judged structurally, never by a stale hash.
function verifyMetadataDatabase(file) {
  if (!existsSync(file)) return { ok: false, code: 'METADATA_DATABASE_MISSING', path: file };
  const digest = sha256(readFileSync(file));
  let database;
  try { database = new DatabaseSync(file, { readOnly: true }); }
  catch (error) { return { ok: false, code: 'METADATA_DATABASE_UNREADABLE', detail: String(error), sha256: digest }; }
  try {
    const integrity = Object.values(database.prepare('PRAGMA integrity_check').get())[0];
    if (integrity !== 'ok') return { ok: false, code: 'METADATA_INTEGRITY_FAILED', detail: integrity, sha256: digest };
    const tables = new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all().map((row) => row.name));
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length > 0) return { ok: false, code: 'METADATA_SCHEMA_INCOMPLETE', missing, sha256: digest };
    const revision = database.prepare('SELECT version_num FROM alembic_version').get()?.version_num;
    if (!revision) return { ok: false, code: 'METADATA_ALEMBIC_REVISION_MISSING', sha256: digest };
    return {
      ok: true, code: 'OK', sha256: digest, revision, bytes: readFileSync(file).length,
      counters: {
        users: database.prepare('SELECT COUNT(*) count FROM ab_user').get().count,
        roles: database.prepare('SELECT COUNT(*) count FROM ab_role').get().count,
        tables: tables.size,
        managedDatabases: database.prepare('SELECT COUNT(*) count FROM dbs WHERE database_name=?')
          .get(MANAGED_DATABASE_NAME).count,
      },
    };
  } catch (error) {
    return { ok: false, code: 'METADATA_SCHEMA_UNREADABLE', detail: String(error), sha256: digest };
  } finally {
    database.close();
  }
}

const declaredMetadataSha = (active) => sha256(readFileSync(path.join(active.generationPath, METADATA_DATABASE_FILE)));

// ---------------------------------------------------------------- NATIVE: positive install

test('KS254 AC01/AC02 positive: the REAL entry point provisions the pinned runtime into an owned, verified, receipt-bound generation and the live database is that complete generation',
  { skip: NATIVE_SKIP }, () => {
    const root = tempRoot();
    const secrets = syntheticSecretRoot();
    const installed = runInit('install', { root, secretRoot: secrets });
    assert.equal(installed.status, 0, installed.stderr);
    assert.match(installed.stdout, /^INSTALL-ACTIVATED generation=[0-9a-f]{12} /);
    assert.match(installed.stdout, /published=PUBLISHED mirror=(REFRESHED|IN_SYNC) /);

    const state = readState(root);
    assert.equal(state.active.ok, true, state.active.code);
    assert.equal(state.active.state, 'ACTIVE');
    assert.equal(state.manifestVerified.ok, true);
    assert.equal(state.manifestVerified.fileCount, 2);
    assert.deepEqual(readdirSync(state.active.generationPath).sort(),
      [GENERATION_MANIFEST_FILE, INSTALL_RECEIPT_FILE, METADATA_DATABASE_FILE].sort());

    // The generation IS the pinned runtime's own provisioning output, with its exits recorded.
    const receipt = state.receipt;
    assert.equal(receipt.schemaVersion, 'chimpmaera.bi/superset-install-receipt/v1');
    assert.equal(receipt.contract, 'chimpmaera.bi/generation-store/v1');
    assert.deepEqual(receipt.steps.map((step) => step.command.slice(1).join(' ')),
      ['db upgrade', 'init', path.join(RUNTIME_DIR, 'bootstrap.py')]);
    assert.deepEqual(receipt.steps.map((step) => step.exitStatus), [0, 0, 0]);
    assert.equal(receipt.base.source, 'EMPTY', 'a first install starts from an empty candidate');
    assert.equal(receipt.metadata.sha256, declaredMetadataSha(state.active));
    assert.equal(sha256(readFileSync(path.join(state.active.generationPath, INSTALL_RECEIPT_FILE))),
      state.active.manifest.files.find((file) => file.path === INSTALL_RECEIPT_FILE).sha256);
    assert.equal(receipt.dependency.component, 'managed-projection');
    assert.equal(receipt.dependency.readOnly, true);

    // AC02: the fixed live path holds the COMPLETE new generation, byte-for-byte.
    assert.equal(state.live.ok, true, JSON.stringify(state.live));
    assert.equal(state.live.sha256, receipt.metadata.sha256);
    assert.equal(state.live.revision, receipt.metadata.revision);
    assert.equal(state.live.counters.managedDatabases, 1);
    assert.ok(state.live.counters.users >= 2, `expected the bootstrap users, got ${state.live.counters.users}`);
    assert.equal(state.stagingCount, 0, 'a completed install leaves no owned staging debris');

    // The native readback surface agrees.
    const verified = runInit('verify', { root, secretRoot: secrets });
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /^INSTALL-VERIFIED active=[0-9a-f]{12} filesVerified=True /);
    assert.match(verified.stdout, / mirror=IN_SYNC /);

    // A re-install is idempotent IN EFFECT: it succeeds, leaves no staging debris, and the
    // live working copy is again exactly the committed generation. (It is not byte-idempotent:
    // bootstrap re-derives the user password hashes, so the re-derived candidate is a
    // different content-addressed generation. `cleanup` prunes the superseded one.)
    const reinstall = runInit('install', { root, secretRoot: secrets });
    assert.equal(reinstall.status, 0, reinstall.stderr);
    const repeated = readState(root);
    assert.equal(repeated.live.ok, true);
    assert.equal(repeated.live.sha256, declaredMetadataSha(repeated.active));
    assert.equal(repeated.stagingCount, 0);
    assert.equal(repeated.manifestVerified.ok, true);
  });

test('KS254 AC01/AC02 positive: a later install migrates the live working copy through a NEW immutable generation and retains the previous complete one',
  { skip: NATIVE_SKIP }, () => {
    const root = tempRoot();
    const secrets = syntheticSecretRoot();
    assert.equal(runInit('install', { root, secretRoot: secrets }).status, 0);
    const seeded = readState(root);
    // Runtime state written to the live working copy after activation (which is exactly what
    // the owned runtime does) must survive the next install: the candidate is seeded from the
    // LIVE copy, and the live copy is only replaced by bytes that are still that exact seed.
    const database = new DatabaseSync(liveDatabaseOf(root));
    database.prepare("INSERT INTO key_value (id, resource, value) VALUES (987654321, 'ks254', ?)").run('kept');
    database.close();
    const drifted = readState(root);
    assert.notEqual(drifted.live.sha256, seeded.live.sha256);

    const second = runInit('install', { root, secretRoot: secrets });
    assert.equal(second.status, 0, second.stderr);
    const after = readState(root);
    assert.equal(after.receipt.base.source, 'LIVE_PATH', 'the candidate was seeded from the live working copy');
    assert.equal(after.receipt.base.sha256, drifted.live.sha256);
    assert.equal(after.generationCount, 2, 'the previous complete generation is retained');
    assert.equal(after.live.ok, true);
    assert.equal(after.live.sha256, after.receipt.metadata.sha256, 'the live copy is the committed generation');
    const survivor = new DatabaseSync(liveDatabaseOf(root), { readOnly: true });
    try {
      assert.equal(survivor.prepare("SELECT value FROM key_value WHERE id=987654321 AND resource='ks254'").get()?.value, 'kept');
    } finally { survivor.close(); }
    const older = after.store.generations.find((entry) => entry.generationId !== after.active.generationId);
    assert.equal(older.complete, true, 'the older generation is still a complete, verified rollback point');
    assert.equal(after.store.pointer.state, 'ACTIVE');
  });

// ---------------------------------------------------------------- NATIVE: interruptions

test('KS254 AC01/AC02: a REAL process death at every supported point still leaves one COMPLETE generation and a complete live database',
  { skip: NATIVE_SKIP }, () => {
    const secrets = syntheticSecretRoot();
    const observed = [];
    for (const expectation of SUPPORTED_POINTS) {
      const { point } = expectation;
      const root = tempRoot();
      const seeded = runInit('install', { root, secretRoot: secrets });
      assert.equal(seeded.status, 0, seeded.stderr);
      const before = readState(root);
      assert.equal(before.active.ok, true, before.active.code);

      const killed = runInit('install', { root, crash: point, secretRoot: secrets });
      assertKilled(killed, point);
      assert.equal(killed.stdout, '', `${point}: a killed install writes no success report`);

      const after = readState(root);
      // AC02: a reader always resolves a COMPLETE generation, old or new — never mixed.
      assert.equal(after.active.ok, true, `${point}: ${after.active.code}`);
      assert.equal(after.manifestVerified.ok, true, `${point}: the active generation is byte-verified`);
      assert.equal(after.live.ok, true, `${point}: the live database is a structurally complete metadata database`);
      const pointerGeneration = after.active.generationId === before.active.generationId ? 'OLD' : 'NEW';
      assert.equal(pointerGeneration, expectation.pointer,
        `${point}: the pointer must name the complete ${expectation.pointer} generation`);
      assert.ok(after.generationCount >= 1, `${point}: the last complete generation is retained`);
      assert.equal(after.store.generations.every((entry) => entry.complete || entry.code !== 'OK'), true,
        `${point}: every non-active generation directory is either complete or reported incomplete`);
      assert.equal(after.stagingCount, expectation.staging, `${point}: owned staging census`);
      const liveInSync = after.live.sha256 === declaredMetadataSha(after.active);
      assert.equal(liveInSync, expectation.liveInSync,
        `${point}: the live working copy is either the committed generation or the complete previous one`);
      // Never a deleted-only state: the pre-interruption complete generation is still complete.
      const older = after.store.generations.find((entry) => entry.generationId === before.active.generationId);
      assert.equal(older?.complete, true, `${point}: the previous generation is still complete`);
      observed.push({ point, pointerGeneration, stagingLeftover: after.stagingCount,
        generations: after.generationCount, liveRevision: after.live.revision, liveInSync });
    }
    assert.equal(observed.length, SUPPORTED_POINTS.length);
    assert.ok(observed.some((entry) => entry.pointerGeneration === 'OLD'));
    assert.ok(observed.some((entry) => entry.pointerGeneration === 'NEW'));
  });

// ---------------------------------------------------------------- NATIVE: recovery / cleanup

test('KS254 AC03: recovery completes a verified uncommitted staging, discards an incomplete one, and never deletes the active generation',
  { skip: NATIVE_SKIP }, () => {
    const secrets = syntheticSecretRoot();

    // (a) interrupted after the staging was complete and verified but before the commit.
    const completing = tempRoot();
    assert.equal(runInit('install', { root: completing, secretRoot: secrets }).status, 0);
    const seeded = readState(completing);
    assertKilled(runInit('install', { root: completing, crash: 'metadata:after-staging', secretRoot: secrets }), 'after-staging');
    const staged = readState(completing);
    assert.equal(staged.active.generationId, seeded.active.generationId, 'before recovery the complete OLD generation is active');
    assert.equal(staged.stagingCount, 1, 'the owned staging is left behind by the kill');
    const recovered = runInit('recover', { root: completing, secretRoot: secrets });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /^INSTALL-RECOVERED activated=1 discarded=0 pointer=ACTIVE/);
    const completed = readState(completing);
    assert.notEqual(completed.active.generationId, seeded.active.generationId, 'recovery COMPLETED the interrupted activation');
    assert.equal(completed.manifestVerified.ok, true);
    assert.equal(completed.stagingCount, 0, 'the owned staging was consumed, not left as debris');
    assert.equal(completed.live.sha256, completed.receipt.metadata.sha256,
      'recovery re-bound the live path to the completed generation');
    assert.equal(readState(completing).store.generations.every((entry) => entry.complete), true);

    // (b) interrupted while the candidate was still being provisioned: nothing was ever
    // verified, so recovery discards the owned staging and the active generation is untouched.
    const discarding = tempRoot();
    assert.equal(runInit('install', { root: discarding, secretRoot: secrets }).status, 0);
    const beforeDiscard = readState(discarding);
    assertKilled(runInit('install', { root: discarding, crash: 'metadata:during-build', secretRoot: secrets }), 'during-build');
    assert.equal(readState(discarding).stagingCount, 1);
    const discarded = runInit('recover', { root: discarding, secretRoot: secrets });
    assert.equal(discarded.status, 0, discarded.stderr);
    assert.match(discarded.stdout, /^INSTALL-RECOVERED activated=0 discarded=1 /);
    const afterDiscard = readState(discarding);
    assert.equal(afterDiscard.active.generationId, beforeDiscard.active.generationId, 'recovery never promotes an unverified staging');
    assert.equal(afterDiscard.stagingCount, 0, 'incomplete owned staging was discarded');
    assert.equal(afterDiscard.live.ok, true);
    assert.deepEqual(discarded.stdout.match(/discarded=\d+/)[0], 'discarded=1');

    // (c) cleanup: unrelated files survive, owned staging debris and non-active generations go,
    // and the active generation stays byte-verified.
    writeFileSync(path.join(discarding, 'unrelated-notes.txt'), 'keep me\n');
    mkdirSync(path.join(discarding, 'metadata', OWNED_STAGING_DIRECTORY), { recursive: true });
    writeFileSync(path.join(discarding, 'metadata', OWNED_STAGING_DIRECTORY, 'not-a-staging-name'), 'kept\n');
    const activeBefore = readState(discarding).active.generationId;
    const cleaned = runInit('cleanup', { root: discarding, secretRoot: secrets });
    assert.equal(cleaned.status, 0, cleaned.stderr);
    assert.match(cleaned.stdout, new RegExp(`^INSTALL-CLEANED generations=\\d+ staging=\\d+ active=${activeBefore.slice(0, 12)}`));
    const afterCleanup = readState(discarding);
    assert.equal(afterCleanup.active.generationId, activeBefore, 'cleanup never removes the active generation');
    assert.equal(afterCleanup.manifestVerified.ok, true, 'the active generation still verifies byte-for-byte');
    assert.equal(afterCleanup.generationCount, 1);
    assert.equal(readFileSync(path.join(discarding, 'unrelated-notes.txt'), 'utf8'), 'keep me\n');
    assert.equal(existsSync(path.join(discarding, 'metadata', OWNED_STAGING_DIRECTORY, 'not-a-staging-name')), true,
      'cleanup removes only names the store owns');

    // (d) cleanup refuses to delete anything when the active generation cannot be resolved.
    const unresolved = tempRoot();
    assert.equal(runInit('install', { root: unresolved, secretRoot: secrets }).status, 0);
    rmSync(path.join(storeOf(unresolved), OWNED_STORE_DIRECTORY, 'active'));
    const refused = runInit('cleanup', { root: unresolved, secretRoot: secrets });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /INSTALL-DENIED GENERATION_CLEANUP_ACTIVE_UNRESOLVED/);
    assert.equal(readState(unresolved).generationCount, 1, 'nothing was removed');
  });

// ---------------------------------------------------------------- fail-closed negative

test('KS254 AC01 fail-closed: with the pinned prerequisite unavailable the REAL entry point refuses, publishes nothing and destroys nothing', () => {
  const secrets = syntheticSecretRoot();
  const root = tempRoot();
  const refused = runInit('install', { root, secretRoot: secrets, supersetBin: path.join(root, 'no-such-superset') });
  assert.equal(refused.status, 1, `${refused.stdout}${refused.stderr}`);
  assert.match(refused.stderr, /INSTALL-DENIED METADATA_STEP_UNAVAILABLE/);
  assert.equal(refused.stdout, '', 'a refused install writes no success report');
  const state = readState(root);
  assert.equal(state.active.state, 'ABSENT', 'nothing was published without the prerequisite');
  assert.equal(state.generationCount, 0);
  assert.equal(state.stagingCount, 0, 'the refused staging is cleaned up, not left as debris');
  assert.equal(existsSync(liveDatabaseOf(root)), false, 'the live path was never touched');

  if (NATIVE_SKIP === false) {
    // The same refusal keeps a previously complete generation active and its live copy intact.
    const seededRoot = tempRoot();
    assert.equal(runInit('install', { root: seededRoot, secretRoot: secrets }).status, 0);
    const seeded = readState(seededRoot);
    const again = runInit('install', { root: seededRoot, secretRoot: secrets,
      supersetBin: path.join(seededRoot, 'no-such-superset') });
    assert.equal(again.status, 1);
    const kept = readState(seededRoot);
    assert.equal(kept.active.generationId, seeded.active.generationId);
    assert.equal(kept.live.sha256, seeded.live.sha256);
    assert.equal(kept.manifestVerified.ok, true);
  }
});

// ---------------------------------------------------------------- native tamper refusal (independent acceptance)

test('KS254 AC02: native verify refuses a tampered active receipt without trusting its live working copy',
  { skip: NATIVE_SKIP }, () => {
    const root = tempRoot();
    const secrets = syntheticSecretRoot();
    const installed = runInit('install', { root, secretRoot: secrets });
    assert.equal(installed.status, 0, installed.stderr);
    const before = readState(root);
    assert.equal(before.active.ok, true);
    const receiptPath = path.join(before.active.generationPath, INSTALL_RECEIPT_FILE);
    writeFileSync(receiptPath, `${readFileSync(receiptPath, 'utf8')}tampered\n`);
    const refused = runInit('verify', { root, secretRoot: secrets });
    assert.equal(refused.status, 1, refused.stdout);
    assert.match(refused.stderr, /INSTALL-DENIED GENERATION_INCOMPLETE/);
    assert.equal(refused.stdout, '', 'no success report on incomplete evidence');
    const after = readState(root);
    assert.equal(after.active.ok, false);
    assert.equal(after.active.state, 'INCOMPLETE');
    assert.equal(after.live.ok, true, 'verification never mutates the still-complete live copy');
  });

// ---------------------------------------------------------------- RED arm: pre-fix boundary

// The pre-fix one-shot entry point, replayed: it runs the three provisioning commands straight
// against the LIVE metadata database. It has no staging area, no receipt and no pointer, so a
// process death during it has no supported point and nothing to recover.
const PRE_FIX_INIT = `#!/usr/bin/env bash
set -euo pipefail
umask 077
mkdir -p "$CHIMPMAERA_BI_ROOT/metadata" "$CHIMPMAERA_BI_ROOT/projection"
"$SUPERSET_BIN" db upgrade
"$SUPERSET_BIN" init
"$PYTHON_BIN" "$CHIMPMAERA_BI_BOOTSTRAP"
`;

test('KS254 AC01/AC02 RED/GREEN at the original failure boundary: the PRE-FIX entry point leaves no complete generation and no recovery surface, the candidate preserves the complete old one',
  { skip: NATIVE_SKIP }, async () => {
    const secrets = syntheticSecretRoot();
    const root = tempRoot();
    assert.equal(runInit('install', { root, secretRoot: secrets }).status, 0);
    const seeded = readState(root);
    const script = path.join(root, 'pre-fix-init.sh');
    writeFileSync(script, PRE_FIX_INIT, { mode: 0o700 });

    // A REAL process death inside the pre-fix sequence, while its migration child runs.
    const child = spawn('bash', [script], {
      cwd: REPO_ROOT,
      env: {
        ...process.env, CHIMPMAERA_BI_ROOT: root, CHIMPMAERA_BI_SECRET_ROOT: secrets,
        SUPERSET_BIN, PYTHON_BIN,
        SUPERSET_CONFIG_PATH: path.join(RUNTIME_DIR, 'superset_config.py'),
        CHIMPMAERA_BI_BOOTSTRAP: path.join(RUNTIME_DIR, 'bootstrap.py'),
      },
    });
    const exit = await new Promise((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      const timer = setTimeout(() => child.kill('SIGKILL'), 4000);
      timer.unref?.();
    });
    assert.equal(exit.signal, 'SIGKILL', `the pre-fix sequence really died on a signal: ${JSON.stringify(exit)}`);

    // RED: no staging, no receipt, no recovery surface for that death.
    const red = readState(root);
    assert.equal(red.stagingCount, 0, 'PRE-FIX: no owned staging exists for the interrupted provisioning');
    assert.equal(red.receipt.installedAt, seeded.receipt.installedAt, 'PRE-FIX: no receipt records the interrupted run');
    assert.equal(red.active.generationId, seeded.active.generationId, 'PRE-FIX: the interrupted run published nothing');
    const redRecover = runInit('recover', { root, secretRoot: secrets });
    assert.equal(redRecover.status, 0, redRecover.stderr);
    assert.match(redRecover.stdout, /^INSTALL-RECOVERED activated=0 discarded=0 /,
      'PRE-FIX: the interrupted provisioning is not recoverable at all');

    // GREEN: the SAME boundary of the candidate (the parent dies while the pinned
    // `superset db upgrade` child runs) leaves the complete OLD generation active, an OWNED
    // staging leftover, and a working recovery.
    const green = tempRoot();
    assert.equal(runInit('install', { root: green, secretRoot: secrets }).status, 0);
    const greenSeeded = readState(green);
    assertKilled(runInit('install', { root: green, crash: 'metadata:during-build', secretRoot: secrets }), 'metadata:during-build');
    const greenAfter = readState(green);
    assert.equal(greenAfter.active.generationId, greenSeeded.active.generationId, 'GREEN: the complete OLD generation stays active');
    assert.equal(greenAfter.manifestVerified.ok, true);
    assert.equal(greenAfter.live.ok, true, 'GREEN: the live database stays complete');
    assert.equal(greenAfter.stagingCount, 1, 'GREEN: the interruption leaves an OWNED staging directory');
    const greenRecover = runInit('recover', { root: green, secretRoot: secrets });
    assert.match(greenRecover.stdout, /^INSTALL-RECOVERED activated=0 discarded=1 /);
    assert.equal(readState(green).active.generationId, greenSeeded.active.generationId);
  });

// The pre-fix surface has no staging/receipt/pointer BY CONSTRUCTION; the interruption class
// above is structural, not a property of the kill timing.
test('KS254 AC01 RED source contract: the delivered entry point carries the staging/receipt/pointer surface and the manual installation semantics', () => {
  assert.equal(/ks254-staging|ks254-generations|INSTALL-RECEIPT/.test(PRE_FIX_INIT), false,
    'the pre-fix sequence knows no staging/receipt/pointer surface');
  const delivered = readFileSync(INIT_SH, 'utf8');
  assert.match(delivered, /ks254_install\.py/);
  assert.match(delivered, /RUNTIME_ROOT="\$\{CHIMPMAERA_BI_ROOT:-\/var\/lib\/chimpmaera-bi\}"/);
  assert.match(delivered, /^set -euo pipefail$/m);
  assert.match(delivered, /^umask 077$/m);
  assert.match(delivered, /mkdir -p "\$RUNTIME_ROOT\/metadata" "\$RUNTIME_ROOT\/projection"/);
  for (const surface of ['ks254_install.py', 'generation_store.py']) {
    assert.equal(existsSync(path.join(RUNTIME_DIR, surface)), true, surface);
  }
  // The same three provisioning commands are still the ones the install runs.
  const installer = readFileSync(path.join(RUNTIME_DIR, 'ks254_install.py'), 'utf8');
  for (const call of ['"db", "upgrade"', '"init"', 'bootstrap.py']) {
    assert.ok(installer.includes(call), `the deliverer still runs ${call}`);
  }
});

// ---------------------------------------------------------------- HELPER: store parity

const PY = (body) => spawnSync(helperPython, ['-c', body], { encoding: 'utf8', cwd: REPO_ROOT });
const baseManifest = () => ({ contract: 'chimpmaera.bi/generation-store/v1', generationId: 'a'.repeat(64), label: 'synthetic' });

test('KS254 HELPER parity: the Superset-runtime python store is contract-equivalent to the RELEASED node store',
  { skip: HELPER_SKIP }, () => {
    const nodeRoot = tempRoot('ks254-parity-node-');
    const pythonRoot = tempRoot('ks254-parity-python-');
    const emptyRoot = tempRoot('ks254-parity-empty-');
    const body = Buffer.from('parity-artifact-bytes\n');
    const digest = sha256(body);
    const files = [{ path: 'artifact.bin', sha256: digest }];
    const staged = stageGeneration({
      root: nodeRoot, target: 'parity',
      build: (directory) => {
        writeFileSync(path.join(directory, 'artifact.bin'), body);
        return { label: 'parity', files };
      },
    });
    const activated = activateGeneration({ root: nodeRoot, staged, target: 'parity' });

    const python = PY(`
import hashlib, json, sys
sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})
import generation_store as store
body = ${JSON.stringify(body.toString('binary'))}.encode('latin-1')
def build(staging):
    (staging / 'artifact.bin').write_bytes(body)
    return {'label': 'parity', 'files': [{'path': 'artifact.bin', 'sha256': hashlib.sha256(body).hexdigest()}]}
staged = store.stage_generation(${JSON.stringify(pythonRoot)}, 'parity', build)
activated = store.activate_generation(${JSON.stringify(pythonRoot)}, staged, 'parity')
active = store.read_active_generation(${JSON.stringify(pythonRoot)})
print(json.dumps({'generationId': activated['generationId'], 'manifest': staged['manifest'],
                  'activeState': active['state'], 'fileCount': store.verify_generation_manifest(
                      active['generationPath'], active['manifest'])['fileCount']}))
`);
    assert.equal(python.status, 0, python.stderr);
    const parity = JSON.parse(python.stdout.trim().split('\n').pop());
    // Identical content-addressed identity and identical declared manifest for identical inputs.
    assert.equal(parity.generationId, activated.generationId, 'identical generation identity');
    assert.deepEqual(parity.manifest.files, activated.manifest.files);
    assert.equal(parity.manifest.contract, activated.manifest.contract);
    assert.equal(parity.manifest.label, activated.manifest.label);
    assert.equal(parity.activeState, 'ACTIVE');
    assert.equal(parity.fileCount, 1);

    // Cross-implementation readback both ways: the released node store byte-verifies the
    // generation the python store published, and the python store byte-verifies the node one.
    const nodeReadingPython = readActiveGeneration({ root: pythonRoot });
    assert.equal(nodeReadingPython.ok, true, nodeReadingPython.code);
    assert.equal(nodeReadingPython.generationId, activated.generationId);
    assert.equal(verifyGenerationManifest(nodeReadingPython.generationPath, nodeReadingPython.manifest).ok, true);
    const pythonReadingNode = PY(`
import json, sys
sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})
import generation_store as store
active = store.read_active_generation(${JSON.stringify(nodeRoot)})
verified = store.verify_generation_manifest(active['generationPath'], active['manifest']) if active['ok'] else {'ok': False}
print(json.dumps({'ok': active['ok'], 'state': active['state'], 'generationId': active.get('generationId'),
                  'verified': verified['ok'], 'fileCount': verified.get('fileCount')}))
`);
    assert.equal(pythonReadingNode.status, 0, pythonReadingNode.stderr);
    assert.deepEqual(JSON.parse(pythonReadingNode.stdout.trim().split('\n').pop()),
      { ok: true, state: 'ACTIVE', generationId: activated.generationId, verified: true, fileCount: 1 });

    // Identical refusal semantics on the same negative inputs.
    writeFileSync(path.join(nodeRoot, 'outside.txt'), 'outside\n');
    const negativeParity = PY(`
import hashlib, json, sys
sys.path.insert(0, ${JSON.stringify(RUNTIME_DIR)})
import generation_store as store
digest = hashlib.sha256(b'outside\\n').hexdigest()
base = {'contract': store.GENERATION_STORE_CONTRACT, 'generationId': 'a'*64, 'label': 'synthetic'}
out = {'unsafe': [], 'absentPointer': store.read_active_generation(${JSON.stringify(emptyRoot)})['state']}
for relative in ['../outside.txt', '/outside.txt', 'child/../outside.txt', 'child//outside.txt']:
    result = store.verify_generation_manifest(${JSON.stringify(nodeRoot)}, {**base, 'files': [{'path': relative, 'sha256': digest}]})
    out['unsafe'].append([result['ok'], result['code']])
result = store.verify_generation_manifest(${JSON.stringify(activated.generationPath)}, {**base, 'files': [{'path': 'artifact.bin', 'sha256': '0'*64}]})
out['tampered'] = [result['ok'], result['code']]
print(json.dumps(out))
`);
    assert.equal(negativeParity.status, 0, negativeParity.stderr);
    const negatives = JSON.parse(negativeParity.stdout.trim().split('\n').pop());
    assert.deepEqual(negatives.unsafe, Array.from({ length: 4 }, () => [false, 'GENERATION_MANIFEST_INVALID']));
    assert.equal(negatives.absentPointer, 'ABSENT');
    assert.deepEqual(negatives.tampered, [false, 'GENERATION_INCOMPLETE']);
    const nodeUnsafe = ['../outside.txt', '/outside.txt', 'child/../outside.txt', 'child//outside.txt']
      .map((relative) => verifyGenerationManifest(nodeRoot, { ...baseManifest(), files: [{ path: relative, sha256: digest }] }))
      .map((result) => [result.ok, result.code]);
    assert.deepEqual(nodeUnsafe, negatives.unsafe, 'identical unsafe-path refusal in both stores');
    const nodeTampered = verifyGenerationManifest(activated.generationPath,
      { ...baseManifest(), files: [{ path: 'artifact.bin', sha256: '0'.repeat(64) }] });
    assert.deepEqual([nodeTampered.ok, nodeTampered.code], negatives.tampered, 'identical tamper refusal in both stores');
  });

// ---------------------------------------------------------------- HELPER: entry-point recovery

test('KS254 AC03 HELPER: the REAL entry point completes and cleans a SYNTHETIC staged generation without deleting the active one',
  { skip: HELPER_SKIP }, () => {
    const root = tempRoot('ks254-synthetic-recover-');
    const secrets = syntheticSecretRoot();
    const store = storeOf(root);
    // A synthetic generation written through the RELEASED node store: structurally a valid
    // generation whose content is NOT an Apache Superset database. This arm proves the entry
    // point's recovery/cleanup plumbing only and claims no runtime proof.
    const build = (label, body) => (directory) => {
      writeFileSync(path.join(directory, METADATA_DATABASE_FILE), body);
      writeFileSync(path.join(directory, INSTALL_RECEIPT_FILE), `${JSON.stringify({ synthetic: label })}\n`);
      return { label, files: [
        { path: METADATA_DATABASE_FILE, sha256: sha256(body) },
        { path: INSTALL_RECEIPT_FILE, sha256: sha256(readFileSync(path.join(directory, INSTALL_RECEIPT_FILE))) },
      ] };
    };
    const first = stageGeneration({ root: store, target: 'metadata', build: build('synthetic-a', Buffer.from('synthetic-a\n')) });
    activateGeneration({ root: store, staged: first, target: 'metadata' });
    const uncommittedBody = Buffer.from('synthetic-uncommitted-generation\n');
    const uncommitted = stageGeneration({ root: store, target: 'metadata', build: build('synthetic-uncommitted', uncommittedBody) });

    const before = readState(root);
    assert.equal(before.active.generationId, first.generationId);
    assert.equal(before.stagingCount, 1, 'the verified uncommitted staging is left for recovery');
    const recovered = runInit('recover', { root, secretRoot: secrets });
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stdout, /^INSTALL-RECOVERED activated=1 discarded=0 pointer=ACTIVE/);
    const afterRecover = readState(root);
    assert.equal(afterRecover.active.generationId, uncommitted.generationId, 'recovery completed the staged generation');
    assert.equal(afterRecover.stagingCount, 0);
    assert.equal(afterRecover.manifestVerified.ok, true);
    assert.equal(afterRecover.live.sha256, sha256(uncommittedBody), 'the live path holds the completed generation');

    const cleaned = runInit('cleanup', { root, secretRoot: secrets });
    assert.equal(cleaned.status, 0, cleaned.stderr);
    assert.match(cleaned.stdout, /^INSTALL-CLEANED generations=1 staging=0 /);
    const afterCleanup = readState(root);
    assert.equal(afterCleanup.generationCount, 1);
    assert.equal(afterCleanup.active.generationId, uncommitted.generationId);
    assert.equal(afterCleanup.manifestVerified.ok, true);
    // The released node store operates on the same owned store directly: identical outcome.
    assert.deepEqual(recoverGenerationStore({ root: store, target: 'metadata' }).activated, []);
    assert.equal(cleanupGenerationStore({ root: store }).activeGenerationId, uncommitted.generationId);
    assert.equal(readState(root).active.ok, true);
  });
