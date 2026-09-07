import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { ingestCatalogReceipt } from '../services/bi-control/src/catalog.mjs';
import { handleDiscovery } from '../services/bi-control/src/discovery.mjs';
import { runAnalyzeProfile } from '../services/bi-control/src/db-analyzer/workflow.mjs';

// KS169: isolate immutable run generations and durable discovery state.
//
// A Discovery session is bound to the run generation it started from (one immutable
// catalog_snapshots row). That pinned generation stays authoritative for the session even
// after a newer generation is published; `latest` is only a checked pointer that reports
// currency. Sequential runs, barrier-controlled overlap, crash/restart, and stale-generation
// readback are the four focused scenarios below.

async function fixtureReceipt(receiptId = null, snapshotSha256 = null, analyzedAt = '2026-09-07T09:00:00.000Z') {
  const analysis = await runAnalyzeProfile('services/bi-control/fixtures/mssql-profile-v1.json', {repositoryRoot: 'services/bi-control'});
  if (snapshotSha256) analysis.snapshotSha256 = snapshotSha256;
  return {
    schemaVersion: 'chimpmaera.bi/analysis-receipt/v1',
    receiptId: receiptId ?? `mssql-${analysis.snapshotSha256.slice(0, 24)}`,
    status: 'ANALYZED_READ_ONLY',
    analyzedAt,
    sourceMode: 'fixture',
    engine: 'mssql',
    scope: analysis.profile.scope,
    safety: {queryPackSelectOnly: true, rowSamples: false},
    analysis,
  };
}

async function readyDb() {
  const db = new DatabaseSync(':memory:');
  ingestCatalogReceipt(db, await fixtureReceipt());
  return db;
}

// Answer every required field so the session becomes confirmable; returns the final state.
function answerAll(db, sessionId) {
  const state = handleDiscovery(db, {action: 'status', sessionId}).state;
  const first = (group) => state.guidance.suggestions[group][0].id;
  handleDiscovery(db, {action: 'answer', sessionId, field: 'audienceRole', value: 'Sales analyst'});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'businessQuestions', value: ['Which order value should be watched weekly?']});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'confirmedKpiCandidates', value: [first('kpiCandidates')]});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'dimensions', value: [first('dimensions')]});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'timeGranularity', value: {candidateIds: [first('timeCandidates')], granularity: 'snapshot'}});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'filtersSegments', value: ['Active customer segment']});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'drilldowns', value: [first('drilldownCandidates')]});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'freshnessNeed', value: 'Refresh before weekly review'});
  handleDiscovery(db, {action: 'answer', sessionId, field: 'accessConfidentiality', value: {classification: 'INTERNAL', constraints: ['No raw source rows']}});
  return handleDiscovery(db, {action: 'answer', sessionId, field: 'openAssumptions', value: ['Business owner must validate semantics before M5']});
}

test('KS169 sequential runs stay bound to one immutable run generation', async () => {
  const db = await readyDb();
  const started = handleDiscovery(db, {action: 'start', sessionId: 'seq_a'});
  const gen = started.runGeneration;
  assert.match(gen.generationId, /^[0-9a-f]{64}$/);
  assert.equal(gen.current, true);
  assert.equal(started.catalogSnapshotCurrent, true);
  assert.equal(gen.snapshotSha256, started.state.catalog.snapshotSha256);
  assert.equal(gen.receiptId, started.state.catalog.receiptId);

  const answered = answerAll(db, 'seq_a');
  const confirmed = handleDiscovery(db, {action: 'confirm', sessionId: 'seq_a', confirmed: true});
  const exported = handleDiscovery(db, {action: 'export', sessionId: 'seq_a'});

  // Every step of the sequential lifecycle reports the same immutable generation identity.
  assert.equal(answered.runGeneration.generationId, gen.generationId);
  assert.equal(confirmed.runGeneration.generationId, gen.generationId);
  assert.equal(exported.runGeneration.generationId, gen.generationId);
  assert.equal(exported.catalogSnapshotCurrent, true);
  assert.equal(exported.export.catalog.receiptId, gen.receiptId);
  assert.equal(exported.export.catalog.snapshotSha256, gen.snapshotSha256);
  db.close();
});

test('KS169 barrier-controlled overlap isolates two sessions on a shared stale generation', async () => {
  const db = await readyDb();
  const a = handleDiscovery(db, {action: 'start', sessionId: 'ovl_a'});
  const b = handleDiscovery(db, {action: 'start', sessionId: 'ovl_b'});
  assert.equal(a.runGeneration.generationId, b.runGeneration.generationId);

  handleDiscovery(db, {action: 'answer', sessionId: 'ovl_a', field: 'audienceRole', value: 'Finance analyst'});
  handleDiscovery(db, {action: 'answer', sessionId: 'ovl_b', field: 'audienceRole', value: 'Operations analyst'});

  // Barrier: a newer run generation is published while both sessions are still in progress.
  ingestCatalogReceipt(db, await fixtureReceipt('mssql-ovl-next', 'f'.repeat(64), '2026-09-07T10:00:00.000Z'));

  // Past the barrier both sessions still operate against their own pinned generation, report it
  // as stale, and remain isolated from one another and from the newer generation's content.
  const aResp = handleDiscovery(db, {action: 'answer', sessionId: 'ovl_a', field: 'businessQuestions', value: ['Weekly revenue by region?']});
  const bStatus = handleDiscovery(db, {action: 'status', sessionId: 'ovl_b'});
  assert.equal(aResp.runGeneration.current, false);
  assert.equal(bStatus.runGeneration.current, false);
  assert.equal(aResp.runGeneration.generationId, a.runGeneration.generationId);
  assert.equal(aResp.state.audienceRole, 'Finance analyst');
  assert.equal(bStatus.state.audienceRole, 'Operations analyst');
  assert.notEqual(aResp.audit.stateSha256, bStatus.audit.stateSha256);

  // A new session pins the newer generation as its own distinct immutable generation.
  const c = handleDiscovery(db, {action: 'start', sessionId: 'ovl_c'});
  assert.equal(c.catalogSnapshotCurrent, true);
  assert.notEqual(c.runGeneration.generationId, a.runGeneration.generationId);
  assert.equal(c.runGeneration.snapshotSha256, 'f'.repeat(64));
  db.close();
});

test('KS169 durable discovery state survives crash/restart and stale-generation readback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ks169-run-state-'));
  const file = join(dir, 'projection.db');
  try {
    // Process 1: pin a generation, advance the session, then crash (handle dropped).
    let db = new DatabaseSync(file);
    ingestCatalogReceipt(db, await fixtureReceipt('mssql-crash-1', 'c'.repeat(64), '2026-09-07T11:00:00.000Z'));
    const started = handleDiscovery(db, {action: 'start', sessionId: 'crash_a'});
    const gen = started.runGeneration;
    handleDiscovery(db, {action: 'answer', sessionId: 'crash_a', field: 'audienceRole', value: 'Sales analyst'});
    db.close();

    // While the process is down a newer run generation is published against the same durable store.
    const writer = new DatabaseSync(file);
    ingestCatalogReceipt(writer, await fixtureReceipt('mssql-crash-2', 'd'.repeat(64), '2026-09-07T12:00:00.000Z'));
    writer.close();

    // Restart: the durable session and its pinned generation binding read back unchanged.
    db = new DatabaseSync(file);
    const status = handleDiscovery(db, {action: 'status', sessionId: 'crash_a'});
    assert.equal(status.runGeneration.generationId, gen.generationId);
    assert.equal(status.runGeneration.snapshotSha256, gen.snapshotSha256);
    assert.equal(status.runGeneration.current, false);
    assert.equal(status.state.audienceRole, 'Sales analyst');
    assert.equal(status.state.catalog.receiptId, gen.receiptId);

    // The pinned (now stale) generation is still operable after the restart.
    const resumed = handleDiscovery(db, {action: 'resume', sessionId: 'crash_a'});
    assert.equal(resumed.runGeneration.current, false);
    const answered = handleDiscovery(db, {action: 'answer', sessionId: 'crash_a', field: 'businessQuestions', value: ['Weekly revenue by region?']});
    assert.equal(answered.runGeneration.generationId, gen.generationId);
    db.close();
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('KS169 stale-generation readback: an older isolated generation stays fully operable', async () => {
  const db = await readyDb();
  const started = handleDiscovery(db, {action: 'start', sessionId: 'stale_a'});
  const gen = started.runGeneration;
  answerAll(db, 'stale_a');
  const confirmed = handleDiscovery(db, {action: 'confirm', sessionId: 'stale_a', confirmed: true});
  assert.equal(confirmed.runGeneration.current, true);

  // Publish a newer run generation: this session's generation is now stale but intact.
  ingestCatalogReceipt(db, await fixtureReceipt('mssql-stale-next', 'b'.repeat(64), '2026-09-07T13:00:00.000Z'));

  // Stale readback: status reports the pinned generation as stale but keeps it fully readable.
  const status = handleDiscovery(db, {action: 'status', sessionId: 'stale_a'});
  assert.equal(status.runGeneration.current, false);
  assert.equal(status.runGeneration.generationId, gen.generationId);
  assert.equal(status.state.status, 'CONFIRMED');

  // The stale generation is still writable and exportable, isolated from the newer generation.
  const revised = handleDiscovery(db, {action: 'answer', sessionId: 'stale_a', field: 'freshnessNeed', value: 'Refresh before monthly review'});
  assert.equal(revised.runGeneration.generationId, gen.generationId);
  assert.equal(revised.runGeneration.current, false);
  assert.equal(revised.state.revision, 2);
  const reconfirmed = handleDiscovery(db, {action: 'confirm', sessionId: 'stale_a', confirmed: true});
  assert.equal(reconfirmed.state.status, 'CONFIRMED');
  const exported = handleDiscovery(db, {action: 'export', sessionId: 'stale_a'});
  assert.equal(exported.export.catalog.receiptId, gen.receiptId);
  assert.equal(exported.export.catalog.snapshotSha256, gen.snapshotSha256);
  assert.notEqual(exported.export.catalog.snapshotSha256, 'b'.repeat(64));
  assert.match(exported.export.markdown, /M5 Boundary/);
  db.close();
});

test('KS169 a pinned generation that is removed or tampered with fails closed', async () => {
  // Removed run generation: a second generation is published first so `latest` still resolves,
  // then the pinned generation's row is gone, so its provenance can no longer be verified.
  {
    const db = await readyDb();
    const started = handleDiscovery(db, {action: 'start', sessionId: 'gone_a'});
    const pinned = started.state.catalog.snapshotSha256;
    ingestCatalogReceipt(db, await fixtureReceipt('mssql-gone-next', 'a'.repeat(64), '2026-09-07T14:00:00.000Z'));
    db.exec('PRAGMA foreign_keys=OFF');
    db.prepare('DELETE FROM catalog_snapshots WHERE snapshot_sha256=?').run(pinned);
    assert.throws(() => handleDiscovery(db, {action: 'status', sessionId: 'gone_a'}), /DISCOVERY_CATALOG_SNAPSHOT_MISMATCH/, 'status denies removed generation');
    assert.throws(() => handleDiscovery(db, {action: 'answer', sessionId: 'gone_a', field: 'audienceRole', value: 'Sales analyst'}), /DISCOVERY_CATALOG_SNAPSHOT_MISMATCH/, 'answer denies removed generation');
    db.close();
  }
  // Tampered run generation identity: the pinned generation is no longer immutable/intact.
  {
    const db = await readyDb();
    const started = handleDiscovery(db, {action: 'start', sessionId: 'tamper_a'});
    db.prepare('UPDATE catalog_snapshots SET receipt_id=? WHERE snapshot_sha256=?').run('forged-receipt', started.state.catalog.snapshotSha256);
    assert.throws(() => handleDiscovery(db, {action: 'export', sessionId: 'tamper_a'}), /DISCOVERY_CATALOG_SNAPSHOT_MISMATCH/, 'export denies tampered generation');
    db.close();
  }
});