// PAR-KS-01 — focused verification for the Consumer Support Manifest baseline.
// Derives every expected fact from the SAME executable runtime the builder uses, so the
// proof is "generated manifest versus service capability/readback", never a comparison
// against documentation. No server is started and no network/service is used.
//
//   AC01 — the manifest states the exact projection / semantic / analysis / result /
//          return-channel versions the runtime actually dispatches.
//   AC02 — PARTIAL / UNSUPPORTED / UNKNOWN are first-class and profile-specific; the
//          negative runtime matrix shows the runtime actually denies each surface.
//   AC03 — the manifest binds the consumer head/config and is deterministic on the same
//          head; a stale or substituted runtime (head, config, attestation, profile,
//          channel) is denied.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  CONSUMER_SUPPORT_ISSUE,
  CONSUMER_SUPPORT_MANIFEST_SCHEMA,
  CONSUMER_SUPPORT_MANIFEST_VERSION,
  CONSUMER_SUPPORT_NONCLAIMS,
  REASON,
  REASON_FOR_SURFACE,
  buildConfigIdentity,
  buildConsumerSupportManifest,
  gitHeads,
  verifyConsumerSupportManifest,
} from '../scripts/build-consumer-support-manifest.mjs';
import {
  canonicalJson,
  capabilityAttestationV2,
  executeExternalIntentV2,
  externalBiConsumerProfileV1,
  sha256Digest,
  validateExternalIntentV2,
} from '../services/bi-agent/src/external-api-v2.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const MANIFEST_PATH = path.join(ROOT, 'contracts/analytics/consumer-support-manifest-v1.json');
const INTENT_REQUEST_V2 = 'superset-bi-agent.external/intent-request/v2';
const CHANNEL_KEYS = ['analysis', 'projection', 'result', 'returnChannel', 'semantic'];
const HEX64 = '0'.repeat(64);

// Stub handlers that fully populate the runtime's public readback mappers so the
// analysis/return-channel schema versions are observed from a real dispatch.
const STUB_ANALYZE = {
  receiptId: 'test-receipt',
  status: 'COMPLETED',
  sourceMode: 'read-only',
  engine: 'oracle',
  scope: { schemas: [] },
  safety: { source_read_only: 1, queryPackSelectOnly: true },
  analysis: { runtimeValidation: 'ok', snapshotSha256: HEX64 },
  projection: { sha256: HEX64 },
};
const STUB_READBACK = {
  receiptId: 'test-receipt',
  summary: { source_engine: 'oracle', source_mode: 'read-only', status: 'COMPLETED', snapshot_sha256: HEX64, source_read_only: 1 },
  catalogSnapshot: { schemas: [] },
  technicalOverview: 'none',
  publication: { status: 'NOT_APPLIED' },
};
const HANDLERS = {
  status: async () => ({ providerMode: 'test-derivation', status: 'ok' }),
  analyze: async () => STUB_ANALYZE,
  readback: async () => STUB_READBACK,
};

// Recompute a tampered manifest's integrity so the tampering is self-consistent and the
// specific content check (support/attestation/consumer/channel/head/config) is the one
// that denies — i.e. a runtime-divergent manifest that is NOT caught by the digest.
function reSign(tampered) {
  const { integrity: _ignore, ...body } = tampered;
  tampered.integrity = { algorithm: 'sha256-canonical-json', digest: sha256Digest(body) };
  return tampered;
}
function flipHex(digest) {
  const prefix = digest.slice(0, 7);
  const hex = digest.slice(7);
  const c = hex[0] === '0' ? '1' : '0';
  return `${prefix}${c}${hex.slice(1)}`;
}
async function throws(promiseOrFn, code, message) {
  const promise = typeof promiseOrFn === 'function' ? Promise.resolve().then(promiseOrFn) : promiseOrFn;
  try {
    await promise;
  } catch (error) {
    assert.equal(error.code, code, `${message ?? code}: expected ${code} got ${error?.code ?? error?.message}`);
    return;
  }
  throw new assert.AssertionError({ message: `${message ?? code}: expected denial ${code} but it verified` });
}

const heads = gitHeads();
const { config, configSha256 } = buildConfigIdentity();
const baseline = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
const buildFresh = () => buildConsumerSupportManifest({ heads, config });
const verifyFresh = (manifest) => verifyConsumerSupportManifest(manifest, { expectedHead: heads, configSha256, strict: true });

// --------------------------------------------------------------------------- AC01

test('AC01 manifest carries the exact schema identity and nonclaims', async () => {
  const manifest = await buildFresh();
  assert.equal(manifest.schemaVersion, CONSUMER_SUPPORT_MANIFEST_SCHEMA);
  assert.equal(manifest.manifestVersion, CONSUMER_SUPPORT_MANIFEST_VERSION);
  assert.equal(manifest.issue, CONSUMER_SUPPORT_ISSUE);
  assert.deepEqual(manifest.nonclaims, CONSUMER_SUPPORT_NONCLAIMS);
});

test('AC01 channel versions equal the live service capability/readback', async () => {
  const manifest = await buildFresh();
  const profile = externalBiConsumerProfileV1();

  // projection: the v2 request schema the gate accepts, and v1 is denied.
  const accepted = validateExternalIntentV2({ schemaVersion: INTENT_REQUEST_V2, requestId: 't-proj', action: 'status' });
  assert.equal(manifest.channels.projection.version, accepted.schemaVersion);
  await throws(
    () => validateExternalIntentV2({ schemaVersion: 'superset-bi-agent.external/intent-request/v1', requestId: 't-proj', action: 'status' }),
    'EXTERNAL_BI_REQUEST_IDENTITY_DENIED',
    'AC01 projection v1 must be denied',
  );
  // semantic: the consumer-profile schema the runtime emits.
  assert.equal(manifest.channels.semantic.version, profile.schemaVersion);
  // result: the intent-result envelope schema observed from a real status dispatch.
  const statusEnvelope = await executeExternalIntentV2({ schemaVersion: INTENT_REQUEST_V2, requestId: 't-status', action: 'status' }, HANDLERS);
  assert.equal(manifest.channels.result.version, statusEnvelope.schemaVersion);
  // analysis: the analysis-readback schema observed from a real analyze dispatch.
  const analyzeEnvelope = await executeExternalIntentV2({ schemaVersion: INTENT_REQUEST_V2, requestId: 't-analyze', action: 'analyze' }, HANDLERS);
  assert.equal(manifest.channels.analysis.version, analyzeEnvelope.result.schemaVersion);
  // returnChannel: the superset-readback schema observed from a real readback dispatch.
  const readbackEnvelope = await executeExternalIntentV2({ schemaVersion: INTENT_REQUEST_V2, requestId: 't-readback', action: 'readback' }, HANDLERS);
  assert.equal(manifest.channels.returnChannel.version, readbackEnvelope.result.schemaVersion);

  for (const key of CHANNEL_KEYS) assert.equal(manifest.channels[key].status, 'SUPPORTED');
});

test('AC01 manifest binds the live capability attestation + consumer profile', async () => {
  const manifest = await buildFresh();
  const attestation = capabilityAttestationV2();
  const profile = externalBiConsumerProfileV1();
  assert.equal(manifest.capabilityAttestationDigest, attestation.attestation.digest);
  assert.equal(manifest.consumer.profileDigest, profile.attestation.digest);
  assert.equal(manifest.consumer.product.id, 'superset-bi-agent');
  assert.equal(manifest.consumer.product.version, profile.product.version);
  assert.equal(manifest.consumer.contract.id, profile.contract.id);
  assert.equal(manifest.consumer.contract.version, profile.contract.version);
  assert.equal(manifest.consumer.profileSchema, profile.schemaVersion);
});

test('AC01 fresh manifest verifies VERIFIED against the live runtime', async () => {
  const result = await verifyFresh(await buildFresh());
  assert.deepEqual(result, { state: 'VERIFIED' });
});

test('AC01 committed baseline is faithful to the live runtime and verifies', async () => {
  const manifest = await buildFresh();
  for (const key of CHANNEL_KEYS) assert.equal(baseline.channels[key].version, manifest.channels[key].version);
  assert.equal(baseline.capabilityAttestationDigest, manifest.capabilityAttestationDigest);
  assert.equal(baseline.consumer.profileDigest, manifest.consumer.profileDigest);
  assert.match(baseline.bindings.kaleidosphereHead.commitOid, /^[a-f0-9]{40}$/);
  assert.match(baseline.bindings.kaleidosphereHead.treeOid, /^[a-f0-9]{40}$/);
  const result = await verifyConsumerSupportManifest(baseline, { expectedHead: baseline.bindings.kaleidosphereHead, configSha256, strict: true });
  assert.deepEqual(result, { state: 'VERIFIED' });
});

// --------------------------------------------------------------------------- AC02

test('AC02 PARTIAL is first-class and profile-specific', async () => {
  const manifest = await buildFresh();
  const partial = manifest.support.partial;
  assert.equal(partial.length, 3);
  for (const item of partial) {
    assert.equal(item.status, 'PARTIAL');
    assert.equal(item.externalIntent, false);
    assert.equal(item.authority, 'trusted-approval-only');
    assert.ok(typeof item.reasonCode === 'string' && item.reasonCode.length > 0, 'partial must carry a reason code');
    assert.ok(!('supported' in item), 'partial must not carry a supported: flag');
  }
  assert.deepEqual(
    partial.map((item) => item.id).sort(),
    externalBiConsumerProfileV1().partial.map((item) => item.id).sort(),
    'partial set must match the runtime consumer profile',
  );
  assert.equal(manifest.support.reasonCodes.partial, REASON.PARTIAL_EXTERNAL_INTENT_NOT_DISPATCHABLE);
});

test('AC02 UNSUPPORTED is first-class, profile-specific, never supported:false/empty/omitted', async () => {
  const manifest = await buildFresh();
  const unsupported = manifest.support.unsupported;
  assert.equal(unsupported.length, 5);
  assert.deepEqual(
    unsupported.map((item) => item.surface).sort(),
    ['directSupersetMutationIntent', 'freeSql', 'modelMutation', 'rawSourceRows', 'sourceDatabaseCredentials'].sort(),
  );
  assert.equal(new Set(unsupported.map((item) => item.reasonCode)).size, unsupported.length, 'reason codes must be distinct');
  for (const item of unsupported) {
    assert.equal(item.status, 'UNSUPPORTED');
    assert.equal(item.accepted, false, 'boundary surfaces remain accepted:false, never supported:false');
    assert.ok(typeof item.reasonCode === 'string' && item.reasonCode.length > 0, 'unsupported must carry a reason code');
    assert.ok(!('supported' in item), 'unsupported must not collapse to supported:false');
    assert.equal(REASON_FOR_SURFACE[item.surface], item.reasonCode, 'reason code is profile-specific to the surface');
  }
});

test('AC02 UNKNOWN is a first-class category (present, empty at this head)', async () => {
  const manifest = await buildFresh();
  assert.ok(Array.isArray(manifest.support.unknown), 'unknown must be a present array, not omitted');
  assert.equal(manifest.support.unknown.length, 0, 'no residual unknown at this head');
  assert.equal(manifest.support.reasonCodes.unknown, REASON.UNKNOWN_NO_RESIDUAL_AT_HEAD);
});

test('AC02 negative runtime matrix: the runtime actually denies each unsupported surface', async () => {
  const manifest = await buildFresh();
  const trigger = {
    freeSql: 'raw sql select 1',
    rawSourceRows: 'please return all raw rows',
    sourceDatabaseCredentials: 'password=hunter2',
    modelMutation: 'update the data model',
    directSupersetMutationIntent: 'drop the superset dashboard',
  };
  for (const surface of manifest.support.unsupported.map((item) => item.surface)) {
    await throws(
      () => validateExternalIntentV2({
        schemaVersion: INTENT_REQUEST_V2,
        requestId: 't-neg',
        action: 'discovery',
        input: { command: 'answer', sessionId: 'sid-001', field: 'note', value: trigger[surface] },
      }),
      'EXTERNAL_BI_UNSAFE_INPUT_DENIED',
      `runtime must deny the ${surface} surface`,
    );
  }
  // positive control: a safe answer is accepted, so the gate is live (not blanket-denying).
  const safe = validateExternalIntentV2({
    schemaVersion: INTENT_REQUEST_V2,
    requestId: 't-safe',
    action: 'discovery',
    input: { command: 'answer', sessionId: 'sid-001', field: 'note', value: 'the revenue is trending up' },
  });
  assert.equal(safe.action, 'discovery');
});

test('AC02 negative matrix: a tampered support partition is denied with a specific code', async () => {
  const base = await buildFresh();
  const tamper = (fn, code, message) => {
    const t = structuredClone(base);
    fn(t);
    reSign(t);
    return throws(verifyFresh(t), code, message);
  };

  // omitted — drop the unsupported key
  await tamper((t) => { delete t.support.unsupported; }, 'CONSUMER_SUPPORT_MANIFEST_SUPPORT_SHAPE_DENIED', 'omitted unsupported');
  // omitted — drop the unknown key
  await tamper((t) => { delete t.support.unknown; }, 'CONSUMER_SUPPORT_MANIFEST_SUPPORT_SHAPE_DENIED', 'omitted unknown');
  // emptied — unsupported becomes []
  await tamper((t) => { t.support.unsupported = []; }, 'CONSUMER_SUPPORT_MANIFEST_SUPPORT_DRIFT_DENIED', 'emptied unsupported');
  // collapsed to the falsified supported:false shape
  await tamper((t) => { t.support.unsupported = t.support.unsupported.map((item) => ({ surface: item.surface, supported: false })); }, 'CONSUMER_SUPPORT_MANIFEST_UNSUPPORTED_SHAPE_DENIED', 'collapsed to supported:false');
  // dropped a reason code
  await tamper((t) => { t.support.unsupported[0].reasonCode = null; }, 'CONSUMER_SUPPORT_MANIFEST_UNSUPPORTED_SHAPE_DENIED', 'dropped reason code');
  // partial merged into supported
  await tamper((t) => {
    const [moved] = t.support.partial.splice(0, 1);
    t.support.supported.push({ id: moved.id, action: moved.action, authority: moved.authority, status: 'SUPPORTED', reasonCode: null });
  }, 'CONSUMER_SUPPORT_MANIFEST_SUPPORT_DRIFT_DENIED', 'partial merged into supported');
  // duplicated reason code in the vocabulary
  await tamper((t) => { t.support.reasonCodes.unsupported = ['UNSUPPORTED_FREE_SQL', 'UNSUPPORTED_FREE_SQL']; }, 'CONSUMER_SUPPORT_MANIFEST_REASON_CODE_DENIED', 'duplicated reason code');
});

// --------------------------------------------------------------------------- AC03

test('AC03 repeat generation is deterministic on the same head', async () => {
  const a = await buildFresh();
  const b = await buildFresh();
  assert.equal(a.integrity.digest, b.integrity.digest, 'identical digest on repeat generation');
  assert.equal(canonicalJson(a), canonicalJson(b), 'identical canonical bytes');
});

test('AC03 the committed baseline is byte-reproducible at its recorded head', async () => {
  const fresh = await buildConsumerSupportManifest({ heads: baseline.bindings.kaleidosphereHead, config });
  assert.equal(fresh.integrity.digest, baseline.integrity.digest, 'baseline is deterministic on its head');
});

test('AC03 the manifest never carries a digest of itself', async () => {
  const manifest = await buildFresh();
  const { integrity, ...body } = manifest;
  assert.equal(integrity.digest, sha256Digest(body), 'integrity is the body digest');
  assert.notEqual(integrity.digest, sha256Digest(manifest), 'integrity is not a self-digest');
  const baselineBody = { ...baseline }; delete baselineBody.integrity;
  assert.equal(baseline.integrity.digest, sha256Digest(baselineBody), 'baseline is self-consistent');
});

test('AC03 a stale head is denied', async () => {
  const manifest = await buildFresh();
  await throws(
    verifyConsumerSupportManifest(manifest, { expectedHead: { commitOid: '0'.repeat(40), treeOid: '0'.repeat(40) }, configSha256, strict: true }),
    'CONSUMER_SUPPORT_MANIFEST_HEAD_DENIED',
    'stale (all-zero) head',
  );
  const mutatedCommit = heads.commitOid.slice(0, -1) + (heads.commitOid.at(-1) === '0' ? '1' : '0');
  await throws(
    verifyConsumerSupportManifest(manifest, { expectedHead: { commitOid: mutatedCommit, treeOid: heads.treeOid }, configSha256, strict: true }),
    'CONSUMER_SUPPORT_MANIFEST_HEAD_DENIED',
    'mutated commit head',
  );
});

test('AC03 a substituted runtime attestation is denied', async () => {
  const t = structuredClone(await buildFresh());
  t.capabilityAttestationDigest = flipHex(t.capabilityAttestationDigest);
  reSign(t);
  await throws(verifyFresh(t), 'CONSUMER_SUPPORT_MANIFEST_ATTESTATION_STALE_DENIED', 'substituted capability attestation');
});

test('AC03 a substituted consumer profile is denied', async () => {
  const t = structuredClone(await buildFresh());
  t.consumer.profileDigest = flipHex(t.consumer.profileDigest);
  reSign(t);
  await throws(verifyFresh(t), 'CONSUMER_SUPPORT_MANIFEST_CONSUMER_DRIFT_DENIED', 'substituted consumer profile');
});

test('AC03 a substituted channel version is denied', async () => {
  const t = structuredClone(await buildFresh());
  t.channels.semantic.version = 'superset-bi-agent.external/consumer-profile/v9';
  reSign(t);
  await throws(verifyFresh(t), 'CONSUMER_SUPPORT_MANIFEST_CHANNEL_DRIFT_DENIED', 'substituted channel version');
});

test('AC03 a substituted runtime config is denied', async () => {
  const manifest = await buildFresh();
  await throws(
    verifyConsumerSupportManifest(manifest, { expectedHead: heads, configSha256: '0'.repeat(64), strict: true }),
    'CONSUMER_SUPPORT_MANIFEST_CONFIG_DENIED',
    'substituted runtime config',
  );
});

test('AC03 a corrupted manifest (integrity mismatch) is denied', async () => {
  const t = structuredClone(await buildFresh());
  t.channels.result.version = 'tampered/v9'; // breaks the body digest, NOT re-signed
  await throws(verifyFresh(t), 'CONSUMER_SUPPORT_MANIFEST_INTEGRITY_DENIED', 'corrupted manifest');
});