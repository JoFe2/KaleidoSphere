import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ingestCatalogReceipt } from '../services/bi-control/src/catalog.mjs';
import { canonicalJson } from '../services/bi-control/src/canonical-json.js';
import { handleDiscovery } from '../services/bi-control/src/discovery.mjs';
import { runAnalyzeProfile } from '../services/bi-control/src/db-analyzer/workflow.mjs';
import {
  buildPromotionBundle,
  createDeterministicZip,
  inspectPromotionBundle,
  preflightPromotionBundle,
  PROMOTION_BUNDLE_CONTRACT,
  readPromotionZip,
} from '../services/bi-control/src/promotion-bundle.mjs';
import { buildSupersetFingerprint } from '../services/bi-control/src/superset-fingerprint.mjs';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const UNSAFE_REVISION = MAX_SAFE + 1;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const jsonBytes = (value) => Buffer.from(`${canonicalJson(value)}\n`, 'utf8');
const fixedNow = new Date('2026-08-14T08:30:00.000Z');

async function confirmedBrief() {
  const analysis = await runAnalyzeProfile('services/bi-control/fixtures/mssql-profile-v1.json', { repositoryRoot: 'services/bi-control' });
  const receipt = {
    schemaVersion: 'chimpmaera.bi/analysis-receipt/v1',
    receiptId: `mssql-${analysis.snapshotSha256.slice(0, 24)}`,
    status: 'ANALYZED_READ_ONLY',
    analyzedAt: '2026-08-13T22:20:00.000Z',
    sourceMode: 'fixture',
    engine: 'mssql',
    scope: analysis.profile.scope,
    safety: { queryPackSelectOnly: true, rowSamples: false },
    analysis,
  };
  const db = new DatabaseSync(':memory:');
  ingestCatalogReceipt(db, receipt);
  const started = handleDiscovery(db, { action: 'start', sessionId: 'promotion_review' });
  const first = (group) => started.state.guidance.suggestions[group][0].id;
  const answer = (field, value) => handleDiscovery(db, { action: 'answer', sessionId: 'promotion_review', field, value });
  answer('audienceRole', 'Sales analyst');
  answer('businessQuestions', ['Which confirmed order value should be reviewed weekly?']);
  answer('confirmedKpiCandidates', [first('kpiCandidates')]);
  answer('dimensions', [first('dimensions')]);
  answer('timeGranularity', { candidateIds: [first('timeCandidates')], granularity: 'snapshot' });
  answer('filtersSegments', ['Active customer segment']);
  answer('drilldowns', [first('drilldownCandidates')]);
  answer('freshnessNeed', 'Refresh before weekly review');
  answer('accessConfidentiality', { classification: 'INTERNAL', constraints: ['No source row values'] });
  answer('openAssumptions', ['Business owner validation remains required']);
  handleDiscovery(db, { action: 'confirm', sessionId: 'promotion_review', confirmed: true });
  const brief = handleDiscovery(db, { action: 'export', sessionId: 'promotion_review' }).export;
  db.close();
  return brief;
}

async function validInput() {
  const discoveryBrief = await confirmedBrief();
  const runtime = JSON.parse(await readFile('services/bi-control/fixtures/superset-fingerprint-runtime-v1.json', 'utf8'));
  const supersetFingerprint = buildSupersetFingerprint(runtime);
  const references = discoveryBrief.provenance.evidenceSources.slice(0, 2);
  return {
    createdAt: '2026-08-14T08:30:00.000Z',
    discoveryBrief,
    catalogEvidence: {
      schemaVersion: 'chimpmaera.bi/catalog-promotion-evidence/v1',
      receiptId: discoveryBrief.catalog.receiptId,
      snapshotSha256: discoveryBrief.catalog.snapshotSha256,
      scope: structuredClone(discoveryBrief.catalog.scope),
      coverage: structuredClone(discoveryBrief.coverageBlindSpots),
      provenance: references,
      mutationPerformed: false,
    },
    supersetFingerprint,
    assets: [
      { kind: 'database', uuid: '11111111-1111-4111-8111-111111111111', title: 'Reviewed target placeholder', dependsOn: [], reviewSpec: { targetBinding: 'SANITIZED_TARGET_ONLY', sourceConnectionIncluded: false } },
      { kind: 'dataset', uuid: '22222222-2222-4222-8222-222222222222', title: 'Reviewed order metric dataset', dependsOn: ['11111111-1111-4111-8111-111111111111'], reviewSpec: { catalogReferences: references, semanticReviewRequired: true } },
      { kind: 'chart', uuid: '33333333-3333-4333-8333-333333333333', title: 'Reviewed weekly order value', dependsOn: ['22222222-2222-4222-8222-222222222222'], reviewSpec: { visualizationType: 'big_number', confirmedInterestIds: discoveryBrief.confirmedInterests.kpiCandidates.map((item) => item.id) } },
      { kind: 'chart', uuid: '55555555-5555-4555-8555-555555555555', title: 'Reviewed order trend', dependsOn: ['22222222-2222-4222-8222-222222222222'], reviewSpec: { visualizationType: 'time_series', confirmedInterestIds: discoveryBrief.confirmedInterests.timeCandidates.map((item) => item.id) } },
      { kind: 'dashboard', uuid: '44444444-4444-4444-8444-444444444444', title: 'Reviewed sales dashboard', dependsOn: ['33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555'], reviewSpec: { reviewLayout: 'two_charts', publicationState: 'NOT_AUTHORIZED' } },
    ],
  };
}

function code(error) {
  return error?.code ?? error?.message;
}

function clone(value) {
  return structuredClone(value);
}

async function expectBuildCode(change, expected) {
  const input = await validInput();
  change(input);
  await assert.rejects(() => buildPromotionBundle(input, { now: fixedNow }), (error) => code(error) === expected, expected);
}

// Re-digest a discovery revision change through every dependent digest (evidence bytes,
// manifest discovery binding, file inventory and bundle_id) so the revision boundary is
// the only thing that can still explain acceptance or denial.
function redigestRevision(archive, revision) {
  const entries = readPromotionZip(archive);
  const manifest = JSON.parse(entries.get('promotion-bundle.yaml').toString('utf8'));
  const discovery = JSON.parse(entries.get('evidence/discovery-brief.json').toString('utf8'));
  discovery.revision = revision;
  entries.set('evidence/discovery-brief.json', jsonBytes(discovery));
  manifest.discovery.revision = revision;
  manifest.discovery.sha256 = sha256(entries.get('evidence/discovery-brief.json'));
  for (const file of manifest.files) if (file.path === 'evidence/discovery-brief.json') { file.sha256 = manifest.discovery.sha256; file.bytes = entries.get('evidence/discovery-brief.json').length; }
  delete manifest.bundle_id;
  manifest.bundle_id = sha256(canonicalJson(manifest));
  entries.set('promotion-bundle.yaml', jsonBytes(manifest));
  return createDeterministicZip([...entries].map(([name, data]) => ({ name, data })));
}

function repack(archive, mutator, { refresh = true } = {}) {
  const entries = readPromotionZip(archive);
  const manifest = JSON.parse(entries.get('promotion-bundle.yaml'));
  mutator(entries, manifest);
  if (refresh) {
    const existing = new Map(manifest.files.map((item) => [item.path, item]));
    manifest.files = [...entries.entries()]
      .filter(([name]) => name !== 'promotion-bundle.yaml' && existing.has(name))
      .sort(([left], [right]) => left.localeCompare(right, 'en'))
      .map(([name, bytes]) => ({ path: name, sha256: sha256(bytes), bytes: bytes.length }));
    for (const asset of manifest.assets) {
      if (entries.has(asset.path)) asset.sha256 = sha256(entries.get(asset.path));
    }
    if (entries.has('evidence/discovery-brief.json')) manifest.discovery.sha256 = sha256(entries.get('evidence/discovery-brief.json'));
    if (entries.has('evidence/catalog-evidence.json')) manifest.catalog.sha256 = sha256(entries.get('evidence/catalog-evidence.json'));
    if (entries.has('evidence/superset-fingerprint.json')) manifest.fingerprint.sha256 = sha256(entries.get('evidence/superset-fingerprint.json'));
  }
  delete manifest.bundle_id;
  manifest.bundle_id = sha256(canonicalJson(manifest));
  entries.set('promotion-bundle.yaml', jsonBytes(manifest));
  return createDeterministicZip([...entries].map(([name, data]) => ({ name, data })));
}

test('RED anchor: fully bound confirmed discovery brief at MAX_SAFE_INTEGER + 1 must be denied before any promotion artifact is accepted', async () => {
  const input = await validInput();
  assert.equal(input.discoveryBrief.status, 'EXPORTED_CONFIRMED_DISCOVERY_BRIEF');
  input.discoveryBrief.revision = UNSAFE_REVISION;
  await assert.rejects(
    () => buildPromotionBundle(input, { now: fixedNow }),
    (error) => code(error) === 'PROMOTION_DISCOVERY_IDENTITY_INVALID',
    'unsafe discovery revision must be denied at bundle construction',
  );
  const base = await buildPromotionBundle(clone(await validInput()), { now: fixedNow });
  const report = preflightPromotionBundle(redigestRevision(base.archive, UNSAFE_REVISION), { now: fixedNow });
  assert.equal(report.status, 'BLOCKED', 'fully re-digested unsafe revision bundle must not be inspected as valid');
  assert.equal(report.reasons[0], 'PROMOTION_DISCOVERY_IDENTITY_INVALID');
  assert.equal(report.mutation_performed, false);
});

test('canonical positive safe revisions 1 and MAX_SAFE_INTEGER retain deterministic review-only bundle behavior', async () => {
  for (const revision of [1, MAX_SAFE]) {
    const input = await validInput();
    input.discoveryBrief.revision = revision;
    const first = await buildPromotionBundle(clone(input), { now: fixedNow });
    const second = await buildPromotionBundle(clone(input), { now: fixedNow });
    assert.equal(first.sha256, second.sha256, `revision ${revision} build must be byte-deterministic`);
    assert.deepEqual(first.archive, second.archive, `revision ${revision} archive must be byte-deterministic`);
    assert.equal(first.manifest.contract_version, PROMOTION_BUNDLE_CONTRACT);
    assert.equal(first.manifest.artifact_mode, 'REVIEW_ONLY');
    assert.equal(first.manifest.mutation_performed, false);
    assert.equal(first.manifest.discovery.revision, revision);
    assert.equal(first.manifest.discovery.session_id, input.discoveryBrief.sessionId);
    assert.equal(first.manifest.discovery.status, 'EXPORTED_CONFIRMED_DISCOVERY_BRIEF');
    assert.equal(first.manifest.discovery.sha256, sha256(jsonBytes(input.discoveryBrief)));
    assert.equal(first.manifest.catalog.receipt_id, input.discoveryBrief.catalog.receiptId);
    assert.equal(first.manifest.catalog.snapshot_sha256, input.discoveryBrief.catalog.snapshotSha256);
    const inspection = inspectPromotionBundle(first.archive, { now: fixedNow });
    assert.equal(inspection.status, 'VALID_REVIEW_ARTIFACT');
    assert.equal(inspection.bundle_id, first.manifest.bundle_id);
    assert.equal(inspection.archive_sha256, first.sha256);
    assert.equal(inspection.mutation_performed, false);
    assert.deepEqual(inspection.disclosure, first.manifest.disclosure);
    const preflight = preflightPromotionBundle(first.archive, { now: fixedNow });
    assert.equal(preflight.status, 'PASS_REVIEW_ONLY');
    assert.equal(preflight.mutation_performed, false);
  }
});

test('zero, negative, fractional, negative-zero, non-finite and unsafe integer revisions deny before bundle acceptance', async () => {
  const cases = [
    ['zero', 0],
    ['negative', -1],
    ['negative zero', -0],
    ['fractional', 1.5],
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['unsafe integer above MAX_SAFE_INTEGER', UNSAFE_REVISION],
  ];
  for (const [name, revision] of cases) {
    await expectBuildCode((input) => { input.discoveryBrief.revision = revision; }, 'PROMOTION_DISCOVERY_IDENTITY_INVALID')
      .catch((error) => { error.message = `${name}: ${error.message}`; throw error; });
  }
});

test('fully re-digested bundles with recomputed dependent digests still deny unsafe and non-positive revisions on inspection', async () => {
  const base = await buildPromotionBundle(await validInput(), { now: fixedNow });
  for (const [name, revision] of [['unsafe integer', UNSAFE_REVISION], ['zero', 0], ['negative', -1]]) {
    const report = preflightPromotionBundle(redigestRevision(base.archive, revision), { now: fixedNow });
    assert.equal(report.status, 'BLOCKED', name);
    assert.equal(report.reasons[0], 'PROMOTION_DISCOVERY_IDENTITY_INVALID', name);
    assert.equal(report.mutation_performed, false, name);
  }
});

test('revision and session substitution, forged envelopes, stale evidence, disclosure and authority widening remain denied', async () => {
  const base = await buildPromotionBundle(await validInput(), { now: fixedNow });

  // Unchanged-digest substitution: the manifest claims a revision or session that the
  // authoritative evidence file does not carry.
  const revisionSub = repack(base.archive, (_entries, manifest) => { manifest.discovery.revision = base.manifest.discovery.revision + 1; });
  assert.equal(preflightPromotionBundle(revisionSub, { now: fixedNow }).reasons[0], 'PROMOTION_DISCOVERY_BINDING_MISMATCH');
  const sessionSub = repack(base.archive, (_entries, manifest) => { manifest.discovery.session_id = 'other_session'; });
  assert.equal(preflightPromotionBundle(sessionSub, { now: fixedNow }).reasons[0], 'PROMOTION_DISCOVERY_BINDING_MISMATCH');

  // Evidence-file revision substitution with the manifest digest left unchanged.
  const evidenceSub = repack(base.archive, (entries) => {
    const discovery = JSON.parse(entries.get('evidence/discovery-brief.json').toString('utf8'));
    discovery.revision = base.manifest.discovery.revision + 1;
    entries.set('evidence/discovery-brief.json', jsonBytes(discovery));
  }, { refresh: false });
  assert.equal(preflightPromotionBundle(evidenceSub, { now: fixedNow }).reasons[0], 'PROMOTION_FILE_HASH_MISMATCH');

  // Claim-bearing session identifiers are denied at construction.
  await expectBuildCode((input) => { input.discoveryBrief.sessionId = 'PROMOTION_REVIEW'; }, 'PROMOTION_DISCOVERY_IDENTITY_INVALID');
  await expectBuildCode((input) => { input.discoveryBrief.sessionId = 'promotion.review'; }, 'PROMOTION_DISCOVERY_IDENTITY_INVALID');

  // Fully re-digested forged discovery envelope beside unchanged authoritative catalog/snapshot evidence.
  const forgedDiscovery = repack(base.archive, (entries) => {
    const discovery = JSON.parse(entries.get('evidence/discovery-brief.json').toString('utf8'));
    discovery.catalog.receiptId = `mssql-${'f'.repeat(24)}`;
    discovery.provenance.receiptId = discovery.catalog.receiptId;
    entries.set('evidence/discovery-brief.json', jsonBytes(discovery));
  });
  assert.equal(preflightPromotionBundle(forgedDiscovery, { now: fixedNow }).reasons[0], 'PROMOTION_CATALOG_BINDING_MISMATCH');

  // Fully re-digested forged catalog envelope beside unchanged authoritative discovery evidence.
  const forgedCatalog = repack(base.archive, (entries) => {
    const catalog = JSON.parse(entries.get('evidence/catalog-evidence.json').toString('utf8'));
    catalog.receiptId = `mssql-${'e'.repeat(24)}`;
    entries.set('evidence/catalog-evidence.json', jsonBytes(catalog));
  });
  assert.equal(preflightPromotionBundle(forgedCatalog, { now: fixedNow }).reasons[0], 'PROMOTION_CATALOG_BINDING_MISMATCH');

  // Tampered authoritative evidence scope with recomputed digests.
  const tamperedScope = repack(base.archive, (entries) => {
    const catalog = JSON.parse(entries.get('evidence/catalog-evidence.json').toString('utf8'));
    catalog.scope.schemas = ['tampered'];
    entries.set('evidence/catalog-evidence.json', jsonBytes(catalog));
  });
  assert.equal(preflightPromotionBundle(tamperedScope, { now: fixedNow }).reasons[0], 'PROMOTION_CATALOG_SCOPE_MISMATCH');

  // Stale Superset evidence.
  const stale = preflightPromotionBundle(base.archive, { now: new Date('2026-08-16T08:30:00.000Z') });
  assert.equal(stale.status, 'BLOCKED');
  assert.equal(stale.reasons[0], 'SUPERSET_FINGERPRINT_STALE');

  // Disclosure denials: raw SQL, source rows, credentials, callback carrying a secret.
  await expectBuildCode((input) => { input.discoveryBrief.businessQuestions = ['SELECT amount FROM orders']; }, 'PROMOTION_RAW_SQL_DENIED');
  await expectBuildCode((input) => { input.discoveryBrief.confirmedInterests.rows = [{ amount: 1 }]; }, 'PROMOTION_SOURCE_ROWS_DENIED');
  await expectBuildCode((input) => { input.assets[0].reviewSpec.credentials = 'none'; }, 'PROMOTION_SECRET_KEY_DENIED');
  await expectBuildCode((input) => { input.assets[0].reviewSpec.callbackUrl = `https://example.com/callback?api_key=ghp_${'a'.repeat(24)}`; }, 'PROMOTION_SECRET_VALUE_DENIED');

  // Execution and publication-authority widening is denied.
  const execute = repack(base.archive, (_entries, manifest) => { manifest.artifact_mode = 'EXECUTE'; });
  assert.equal(preflightPromotionBundle(execute, { now: fixedNow }).reasons[0], 'PROMOTION_MANIFEST_CONTRACT_DENIED');
  const mutate = repack(base.archive, (_entries, manifest) => { manifest.mutation_performed = true; });
  assert.equal(preflightPromotionBundle(mutate, { now: fixedNow }).reasons[0], 'PROMOTION_MANIFEST_CONTRACT_DENIED');
});