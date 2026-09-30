// KS256: observe a caller-provisioned, explicitly synthetic receipt snapshot.
// This is file observation, NOT an installation, transfer execution or host probe.
// Every expected artifact comes from the just-executed qualified source read; the
// target cannot declare its own expected digests or completion. No writes here.
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalJson } from '../canonical-json.js';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const deny = code => ({ outcome: 'DENIED', code, mutationCount: 0 });
const contractBytes = readFileSync(new URL('../../../../contracts/business-bi/v1/net-revenue.metric.json', import.meta.url));
const targetId = 'synthetic-receipt-target';
const revisions = ['synthetic-target-r1', 'synthetic-target-r2'];
const slots = ['metric-contract', 'read-task', 'read-result', 'result-lineage', 'qualification'];

// Public sample provisioners may use these bytes, but provision is NOT a status action.
// Only the existing paired CLI qualifies read authority before calling the observer.
export function syntheticTargetArtifacts(read) {
  return {
    'metric-contract': contractBytes,
    'read-task': Buffer.from(canonicalJson(read.pairedRead.task)),
    'read-result': Buffer.from(canonicalJson(read.pairedRead)),
    'result-lineage': Buffer.from(canonicalJson(read.lineage)),
    qualification: Buffer.from(canonicalJson(read.pairedQualification)),
  };
}
export function syntheticTargetMarker(read, revision) {
  return { schemaVersion: 'ks256.synthetic-receipt-target/v1',
    classification: 'LOCAL_SYNTHETIC_NOT_INSTALLATION', identity: targetId,
    targetRevision: revision, sourceRevision: read.pairedQualification.sourceRevision,
    sourceSha256: read.pairedQualification.sourceSha256, taskRef: read.pairedQualification.taskRef };
}

function observeFile(root, name) {
  let fd;
  try {
    fd = openSync(join(root, name), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 4 * 1024 * 1024) return { state: 'UNKNOWN', reason: 'UNSUPPORTED_FILE' };
    // Honor a denied mode even under an elevated disposable test process.
    if ((stat.mode & 0o444) === 0) return { state: 'DENIED', reason: 'READ_PERMISSION_DENIED' };
    return { state: 'READ', bytes: readFileSync(fd) };
  } catch (error) {
    if (error.code === 'ENOENT') return { state: 'OBSERVED_ABSENT', reason: 'FILE_NOT_PRESENT' };
    if (['EACCES', 'EPERM'].includes(error.code)) return { state: 'DENIED', reason: 'READ_PERMISSION_DENIED' };
    return { state: 'UNKNOWN', reason: 'FILE_NOT_OBSERVABLE' };
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function observeSyntheticTarget({ root, revision, read, expectedObservationSha256 } = {}) {
  if (!revisions.includes(revision) || typeof root !== 'string'
      || (expectedObservationSha256 !== undefined && !/^[a-f0-9]{64}$/.test(expectedObservationSha256))) {
    return deny('KS256_TARGET_INPUT_DENIED');
  }
  try {
    // Root and artifact symlinks are not admitted. Paths/contents never reach output.
    if (realpathSync(root) !== resolve(root)) return deny('KS256_TARGET_INPUT_DENIED');
    const marker = observeFile(root, 'target.json');
    if (marker.state !== 'READ') return deny('KS256_TARGET_IDENTITY_UNOBSERVED');
    const expectedMarker = syntheticTargetMarker(read, revision);
    if (canonicalJson(JSON.parse(marker.bytes)) !== canonicalJson(expectedMarker)) {
      return deny('KS256_TARGET_SOURCE_OR_REVISION_MISMATCH');
    }
    const expected = syntheticTargetArtifacts(read);
    const observations = slots.map(id => observeFile(root, `${id}.json`));
    const scope = slots.map((id, index) => {
      const observed = observations[index];
      const matches = observed.state === 'READ' && observed.bytes.equals(expected[id]);
      return { id, ownerRole: 'TARGET_CONTRACT_OWNER', requiredCount: 1,
        coverage: matches ? 'AVAILABLE' : observed.state === 'READ' ? 'PARTIAL' : observed.state,
        verifiedCount: matches ? 1 : 0,
        reason: matches ? 'EXACT_QUALIFIED_SOURCE_BYTES' : observed.state === 'READ' ? 'ARTIFACT_BYTES_MISMATCH' : observed.reason,
        expectedSha256: digest(expected[id]),
        observedSha256: observed.state === 'READ' ? digest(observed.bytes) : null };
    });
    // Refuse a changing snapshot instead of mixing generations. This is bounded local
    // double-read stability, not a filesystem transaction or remote attestation.
    const again = [observeFile(root, 'target.json'), ...slots.map(id => observeFile(root, `${id}.json`))];
    const fingerprint = values => canonicalJson(values.map(v => ({ state: v.state, reason: v.reason ?? null,
      sha256: v.bytes ? digest(v.bytes) : null })));
    if (fingerprint([marker, ...observations]) !== fingerprint(again)) return deny('KS256_TARGET_CHANGED_DURING_READ');
    const body = { marker: expectedMarker, scope };
    const observationSha256 = digest(canonicalJson(body));
    if (expectedObservationSha256 !== undefined && observationSha256 !== expectedObservationSha256) {
      return deny('KS256_TARGET_CARRIED_OBSERVATION_MISMATCH');
    }
    const complete = scope.every(s => s.coverage === 'AVAILABLE');
    const known = scope.every(s => ['AVAILABLE', 'OBSERVED_ABSENT'].includes(s.coverage));
    const verifiedCount = scope.reduce((n, s) => n + s.verifiedCount, 0);
    return { outcome: 'OBSERVED_LOCAL_SYNTHETIC_TARGET',
      target: { identity: targetId, observed: true, revision,
        scope: 'RECEIPT_SNAPSHOT_NOT_INSTALLATION', responsibleRole: 'TARGET_CONTRACT_OWNER',
        sourceRevision: expectedMarker.sourceRevision, sourceSha256: expectedMarker.sourceSha256,
        observationSha256, byteObservation: 'READ_FROM_LOCAL_FILES_AND_COMPARED_TO_FRESH_QUALIFIED_READ',
        currentness: 'REQUESTED_REVISION_ONLY_NOT_WALL_CLOCK_OR_HOST_ATTESTATION' },
      ownedScope: scope, denominator: { value: slots.length, unit: 'QUALIFIED_RECEIPT_ARTIFACTS', basis: 'FIXED_VERSIONED_CONSUMER_CONTRACT' },
      progress: { state: complete ? 'COMPLETE' : 'PARTIAL', verifiedCount,
        fraction: known ? verifiedCount / slots.length : null,
        unknownCount: scope.filter(s => ['UNKNOWN', 'DENIED', 'PARTIAL'].includes(s.coverage)).length },
      unknownOutcomes: scope.filter(s => s.coverage !== 'AVAILABLE').map(s => ({ id: s.id, coverage: s.coverage,
        reason: s.reason, nextResponsibleRole: s.ownerRole })),
      quarantine: scope.filter(s => s.coverage === 'PARTIAL').map(s => ({ id: s.id,
        reason: s.reason, retainedEvidenceSha256: s.observedSha256, includedInProgress: false,
        nextResponsibleRole: s.ownerRole })),
      nextResponsibleRole: complete ? 'NONE_OPEN' : 'TARGET_CONTRACT_OWNER', mutationCount: 0 };
  } catch { return deny('KS256_TARGET_INPUT_DENIED'); }
}
