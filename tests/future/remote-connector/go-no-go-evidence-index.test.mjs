import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const index = JSON.parse(await readFile('docs/future/remote-connector/GO_NO_GO_EVIDENCE_INDEX.json'));
const expected = [
  ['FRC.0', 89, '2026_08_30_v1', 'eb200aa4c3bb206c4bec70a6b92b73a89453d55e', 'docs/future/remote-connector/PRODUCT_BOUNDARY_THREAT_MODEL.md', 'sha256:97ca82d288050233e50eac314e080afb43352b516bd4816e422f76eb18e604ce'],
  ['FRC.1', 90, '2026_08_30_v2', '5f75e1261585bf5464ef8b3fa3d4d220c21dde9a', 'docs/future/remote-connector/IDENTITY_AUTHORITY_RECEIPTS.md', 'sha256:8bcf41343763ef9c38ffbe7f51671d8e8c5ee52c415960138cde092c689fda30'],
  ['FRC.2', 91, '2026_08_30_v3', '664447988841eed2f9023f29ab7ba7025562e524', 'docs/future/remote-connector/TENANT_DATA_SECRET_EGRESS.md', 'sha256:fffe23a0f386601e5cc502219bef2f462b13fd487b09aa3dfe5642d7e41e6a84'],
  ['FRC.3', 92, '2026_08_30_v4', 'f5a1363e3f29114def0054d4d817abb93818a2a1', 'docs/future/remote-connector/SYNTHETIC_SPIKE_AUTHORIZATION_PACKET.md', 'sha256:21d7524b7faf0fd677609d57ce69de83de92f51dc644dce920d565cdeaabb4ce'],
];
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

test('index binds exact released #89-#92 provenance to current-checkout bytes', async () => {
  assert.deepEqual(index.citations.map((slot) => slot.artifactId), expected.map(([id]) => id));
  for (const [slot, [id, , , revision, path, digest]] of index.citations.map((slot, i) => [slot, expected[i]])) {
    assert.equal(slot.artifactId, id);
    assert.equal(slot.sourceCommit, revision);
    assert.equal(slot.artifactPath, path);
    assert.equal(slot.artifactSha256, digest);
    assert.equal(sha256(await readFile(path)), digest);
    assert.ok((await readFile(path, 'utf8')).includes(slot.citationAnchor.locator));
  }
});

test('index terminalizes REJECT while preserving future requirements', () => {
  assert.equal(index.decision.verdict, 'REJECT');
  assert.equal(index.decision.goEvidenceSatisfied, false);
  assert.equal(index.decision.implementationSuccessClaimed, false);
  assert.ok(Object.values(index.assessments).every((assessment) => assessment.status === 'FAIL'));
  assert.ok(index.scopeEvaluation.every((rule) => rule.policy === 'REJECT' && rule.status === 'VIOLATION'));
});

test('index separates internal validation from terminal implementation result', () => {
  assert.equal(index.reviewReceipt.schemaValidation, 'PASS');
  assert.equal(index.reviewReceipt.citationVerification, 'PASS');
  assert.equal(index.reviewReceipt.referenceResolution, 'PASS');
  assert.equal(index.reviewReceipt.assessmentEvaluation, 'PASS');
  assert.equal(index.reviewReceipt.rejectRuleEvaluation, 'VIOLATION');
  assert.notEqual(index.decision.verdict, 'GO');
});
