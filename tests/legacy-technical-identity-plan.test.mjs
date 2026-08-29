import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const INVENTORY = 'docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json';
const PLAN = 'docs/evidence/legacy-identity/compatibility-migration-plan-v1.json';
const FIXTURE = 'fixtures/evidence/legacy-identity/existing-installation-v1.json';
const EXCLUDED_GENERATED = new Set([INVENTORY, PLAN, FIXTURE, 'tests/legacy-technical-identity-plan.test.mjs']);
const root = process.cwd();

const patterns = {
  contractAuthority: /https:\/\/contracts\.chimpmaera\.local\/[A-Za-z0-9._~:/?#\[\]@!$&'()*+,;=%-]*/g,
  schemaIdentity: /chimpmaera\.(?:bi|db)\/[A-Za-z0-9._/-]+/g,
  environment: /\bCM_[A-Z0-9_]+\b/g,
  packageContainer: /\bchimpmaera-bi(?:[/-][a-z0-9._-]+)?\b/g,
  persistedPath: /(?:\/var\/lib\/chimpmaera|\.chimpmaera)(?:\/[A-Za-z0-9._/-]+)?/g,
};

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function scanTrackedIdentities() {
  const files = execFileSync('git', ['ls-files', '-z'], {encoding: 'utf8'}).split('\0').filter(Boolean);
  const found = [];
  for (const path of files) {
    if (EXCLUDED_GENERATED.has(path) || path.startsWith('closure-audits/')) continue;
    let text;
    try { text = await readFile(path, 'utf8'); } catch { continue; }
    for (const [identityClass, pattern] of Object.entries(patterns)) {
      for (const match of text.matchAll(pattern)) found.push({identityClass, value: match[0], path});
    }
  }
  const compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  return found.sort((a, b) => compare(a.identityClass, b.identityClass) || compare(a.value, b.value) || compare(a.path, b.path));
}

test('tracked legacy technical identities exactly match the classified inventory', async () => {
  const [inventory, scanned] = await Promise.all([readJson(INVENTORY), scanTrackedIdentities()]);
  assert.equal(inventory.schemaVersion, 'kaleidosphere/evidence/legacy-technical-identity-inventory/v1');
  assert.equal(inventory.baseCommit, 'a709582278c0d5bc35c09cd2f89808b6b1d242d6');
  assert.deepEqual(inventory.occurrences, scanned);
  assert.ok(inventory.occurrences.length > 0);
  assert.ok(inventory.occurrences.every(({identityClass}) => Object.hasOwn(patterns, identityClass)));
});

test('compatibility matrix is closed, ordered and supplies adapters, windows and negative probes', async () => {
  const plan = await readJson(PLAN);
  assert.equal(plan.schemaVersion, 'kaleidosphere/evidence/legacy-identity-compatibility-plan/v1');
  assert.equal(plan.issue, 53);
  assert.equal(plan.executionAuthorized, false);
  assert.deepEqual(plan.phaseOrder, ['INVENTORY_FREEZE', 'DISPLAY_LABEL_GATE', 'VERSIONED_SCHEMA_SUCCESSORS', 'ENV_PATH_ADAPTERS', 'PACKAGE_CONTAINER_SUCCESSORS', 'LEGACY_RETIREMENT_REVIEW']);
  assert.deepEqual(Object.keys(plan.matrix).sort(), Object.keys(patterns).sort());
  for (const [identityClass, contract] of Object.entries(plan.matrix)) {
    assert.equal(contract.identityClass, identityClass);
    assert.ok(['PRESERVE_IMMUTABLE', 'MIGRATE_ONLY_IN_VERSIONED_SUCCESSOR'].includes(contract.disposition));
    assert.ok(contract.adapter.length > 0);
    assert.ok(contract.deprecationWindow.length > 0);
    assert.ok(contract.negativeProbes.length >= 3);
    assert.equal(contract.rollback, 'RESTORE_EXACT_LEGACY_READER_AND_BYTES');
  }
  assert.equal(plan.releaseDecision, 'SOURCE_ONLY_PLAN_RELEASE_NO_RUNTIME_MIGRATION');
});

test('existing-installation fixture proves deterministic upgrade compatibility and exact rollback', async () => {
  const fixture = await readJson(FIXTURE);
  assert.equal(fixture.schemaVersion, 'kaleidosphere/evidence/legacy-existing-installation/v1');
  assert.deepEqual(fixture.afterUpgrade.legacyReaderOutput, fixture.before.legacyReaderOutput);
  assert.deepEqual(fixture.afterUpgrade.persistedLegacyBytes, fixture.before.persistedLegacyBytes);
  assert.deepEqual(fixture.afterRollback, fixture.before);
  assert.equal(fixture.afterUpgrade.conflictProbe, 'DENIED_MISMATCH');
  assert.equal(fixture.afterUpgrade.unknownIdentityProbe, 'DENIED_UNKNOWN');
  assert.equal(fixture.externalEffects, false);
});

test('plan preserves legal, provenance, frozen evidence and stable IDs while display labels remain KaleidoSphere', async () => {
  const plan = await readJson(PLAN);
  assert.deepEqual(plan.preserveWithoutRewrite, ['LEGAL_PROVENANCE', 'FROZEN_EVIDENCE', 'PERSISTED_RECEIPTS', 'STABLE_SCHEMA_IDS', 'EXTERNAL_ACCOUNT_HANDLES']);
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /^# KaleidoSphere/m);
  assert.equal(plan.activeDisplayLabel, 'KaleidoSphere');
  assert.equal(plan.bulkReplacementAuthorized, false);
});
