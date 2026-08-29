import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const RECEIPT = 'docs/evidence/conveyor/ks70-program-closure-v1.json';

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

test('KS70 program receipt closes the exact dependency-ordered M0a-M6 child set', async () => {
  const receipt = await readJson(RECEIPT);
  assert.equal(receipt.schemaVersion, 'kaleidosphere/evidence/ks70-program-closure/v1');
  assert.equal(receipt.issue, 70);
  assert.equal(receipt.currentMainBase, '60698b2888eac05c1bbea52411a2d10c4c676061');
  assert.deepEqual(receipt.criticalPath, ['plugin#4', 63, 64, 65, 66, 67, 68, 69]);
  assert.deepEqual(receipt.children.map(({issue}) => issue), [63, 64, 65, 66, 67, 68, 69]);
  assert.ok(receipt.children.every(({state}) => state === 'CLOSED'));
  assert.deepEqual(receipt.children.map(({dependsOn}) => dependsOn), [
    ['plugin#4'], [63], [64], [65], [66], [67], [68],
  ]);
});

test('each child records its real protected delivery and release disposition', async () => {
  const receipt = await readJson(RECEIPT);
  const byIssue = new Map(receipt.children.map((child) => [child.issue, child]));
  assert.deepEqual(byIssue.get(63).delivery, {repository: 'JoFe2/KaleidoSphere', pullRequest: 71, mergeSha: 'b4760f68fe942aee2aeca5e5a2e54f783c448df0', release: 'v0.18.1'});
  assert.deepEqual(byIssue.get(64).delivery, {repository: 'JoFe2/kaleidosphere-dsh-plugin', pullRequest: 9, release: 'v0.1.0-preview.4'});
  assert.deepEqual(byIssue.get(65).delivery, {repository: 'JoFe2/kaleidosphere-dsh-plugin', pullRequest: 12, mergeSha: 'a0c29c6c9c75dfc95924e4c6dbe1dd0bdfd721bd', release: null, noReleaseReason: 'IMMUTABLE_PREVIEW_TAG_PREDATES_CHANGE'});
  assert.deepEqual(byIssue.get(66).delivery, {repository: 'JoFe2/KaleidoSphere', pullRequest: 125, mergeSha: 'd77ed33d062268a8000ff9b0ef5ca9dc9ad3433b', release: 'v0.26.0'});
  assert.deepEqual(byIssue.get(67).delivery, {repository: 'JoFe2/KaleidoSphere', pullRequest: 127, mergeSha: 'c32d721bce1e022fa899a0fdfa54582d362211ab', release: '2026_08_29_v2'});
  assert.deepEqual(byIssue.get(68).delivery, {repository: 'JoFe2/KaleidoSphere', pullRequest: 128, mergeSha: '41a1f5fa1deff64836340d1efd3e8a292bbe34f7', release: '2026_08_29_v3'});
  assert.deepEqual(byIssue.get(69).delivery, {repository: 'JoFe2/KaleidoSphere', pullRequest: 129, mergeSha: '60698b2888eac05c1bbea52411a2d10c4c676061', release: '2026_08_29_v4'});
});

test('program closure preserves authority, privacy and promotion nonclaims', async () => {
  const receipt = await readJson(RECEIPT);
  assert.deepEqual(receipt.nonClaims, [
    'NO_PRODUCTION_READINESS',
    'NO_LIVE_CUSTOMER_VALIDATION',
    'NO_STABLE_DSH_ABI',
    'NO_HOST_WIDE_CONTAINMENT',
    'NO_ARBITRARY_SQL',
    'NO_AUTOMATIC_TUNING_OR_MUTATION',
    'NO_UNIVERSAL_ENGINE_OR_HARNESS_PARITY',
    'NO_MARKETPLACE_AVAILABILITY',
  ]);
  assert.equal(receipt.authority.mutation, false);
  assert.equal(receipt.authority.credentials, false);
  assert.equal(receipt.authority.rawRows, false);
  assert.equal(receipt.postgresql.disposition, 'BOUNDED_PILOT_NOT_PROMOTED');
  assert.equal(receipt.mysql.disposition, 'NOT_ADMITTED');
});
