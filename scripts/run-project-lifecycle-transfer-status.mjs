#!/usr/bin/env node
// KaleidoSphere #256 (KS-OPS-04) — the ONE runnable LOCAL read-only project lifecycle and
// transfer status entry point.
//
// It projects a bounded, READ-ONLY status board from:
//   * the authored, bound LOCAL-SYNTHETIC declaration / observed-scope / quarantine /
//     lifecycle inputs the CALLER names, and
//   * the RELEASED comparison attestation, which this entry point actually EXECUTES over the
//     separately retained rows the caller names.
//
//   node scripts/run-project-lifecycle-transfer-status.mjs
//       EOF run: no input at all. Nothing is read, nothing is projected, and no fixture is
//       adopted.  Prints the fail-closed refusal.
//
//   node scripts/run-project-lifecycle-transfer-status.mjs \
//       --declaration <file> --observed-scope <file> --transfer <file> \
//       --quarantine <file> --lifecycle <file> --retained-rows <file> \
//       --evidence-revision <rev> [--format JSON|TABLE] [--request-action <ACTION>] \
//       [--repo-root <dir>]
//
//       EVERY input above is REQUIRED and is NEVER defaulted: a missing one is refused as
//       PROJECT_STATUS_INPUT_REQUIRED before any file is opened.  A caller that wants a
//       fixture must name it.
//
//   node scripts/run-project-lifecycle-transfer-status.mjs ... --rebind \
//       --carried-binding <file>
//       Re-execute the released comparison over the independently retained inputs and require
//       the carried binding to re-derive EXACTLY.  A substituted evidence revision, a resealed
//       observed-scope body, or a swapped retained-rows set is refused.
//
//   node scripts/run-project-lifecycle-transfer-status.mjs --negative
//       Execute the bounded negative gates and print each exact rejection code.  Every input
//       below is authored HERE, for the gate, and never adopted on the caller path.
//
// This CLI WRITES NOTHING: it prints to stdout, opens no socket, sends no SQL of its own,
// performs no update/restore/migration, and grants no authority beyond one local read-only
// synthetic projection.  It reports `mutationCount=0` after every projection and refuses any
// mutating `--request-action` by name before reading anything.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import {
  PROJECT_STATUS_FORMATS,
  PROJECT_STATUS_ALLOWED_ACTION,
  PROJECT_STATUS_DENIALS_V1,
  createProjectLifecycleTransferStatus,
  formatProjectStatusDenial,
  rebindProjectLifecycleTransferStatus,
  renderProjectLifecycleTransferStatus,
} from '../services/bi-control/src/business-bi/project-lifecycle-transfer-status-v1.mjs';

const FD = 'tests/fixtures/business-bi/ks256-lifecycle-transfer-status';
const DECLARATION_PATH = `${FD}/project-declaration-v1.json`;
const OBSERVED_SCOPE_V1_PATH = `${FD}/observed-scope-v1.json`;
const OBSERVED_SCOPE_V2_PATH = `${FD}/observed-scope-v2.json`;
const TRANSFER_PATH = `${FD}/transfer-v1.json`;
const QUARANTINE_PATH = `${FD}/quarantine-v1.json`;
const LIFECYCLE_PATH = `${FD}/lifecycle-observation-v1.json`;
const LIFECYCLE_PARTIAL_PATH = `${FD}/lifecycle-observation-partial-v1.json`;
// The RELEASED synthetic segment fixture, reused byte-for-byte as both the declared
// SOURCE_ARCHIVE bytes and the separately retained comparison rows.  No new source bytes are
// authored for the readback facet.
const RETAINED_ROWS_PATH = 'tests/fixtures/business-bi/net-revenue-segment-v1.json';
const EVIDENCE_REVISION_V1 = 'ks256-status-observation-v1';
const EVIDENCE_REVISION_V2 = 'ks256-status-observation-v2';

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index === -1 ? null : args[index + 1] ?? null;
};

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readRows = (file) => {
  const parsed = readJson(file);
  return Array.isArray(parsed) ? parsed : parsed.rows;
};
const sha256Bytes = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

function inputsFromArgs() {
  const declarationFile = valueOf('--declaration');
  const observedScopeFile = valueOf('--observed-scope');
  const transferFile = valueOf('--transfer');
  const quarantineFile = valueOf('--quarantine');
  const lifecycleFile = valueOf('--lifecycle');
  const retainedRowsFile = valueOf('--retained-rows');
  const evidenceRevision = valueOf('--evidence-revision');
  const missing = [];
  if (declarationFile === null) missing.push('declaration');
  if (observedScopeFile === null) missing.push('observed-scope');
  if (transferFile === null) missing.push('transfer');
  if (quarantineFile === null) missing.push('quarantine');
  if (lifecycleFile === null) missing.push('lifecycle');
  if (retainedRowsFile === null) missing.push('retained-rows');
  if (evidenceRevision === null) missing.push('evidence-revision');
  if (missing.length > 0) return { denial: { outcome: 'DENIED', code: 'PROJECT_STATUS_INPUT_REQUIRED', missing } };
  return {
    declaredProject: readJson(declarationFile),
    observedScope: readJson(observedScopeFile),
    transfer: readJson(transferFile),
    quarantine: readJson(quarantineFile),
    lifecycleObservation: readJson(lifecycleFile),
    retainedComparisonRows: readRows(retainedRowsFile),
    evidenceRevision,
    repoRoot: process.cwd(),
  };
}

function receipt(status) {
  return {
    outcome: status.outcome,
    lifecycleState: status.lifecycle?.state ?? null,
    denominator: status.progress?.denominator ?? null,
    observedCompletedCount: status.progress?.observedCompletedCount ?? null,
    progressFraction: status.progress?.fraction ?? null,
    coverageStates: [...new Set((status.coverage ?? []).map((entry) => entry.coverage))].sort(),
    readbackCoverage: status.readback?.coverage ?? null,
    readbackCode: status.readback?.code ?? null,
    executedFacets: status.executionFacets?.executed ?? [],
    displayAuthority: status.authority?.displayAuthority ?? null,
    writeAuthority: status.authority?.writeAuthority ?? null,
    mutationCount: status.authority?.mutationCount ?? null,
    secretValuesExported: status.secretValuesExported ?? null,
    rawPersonPayloadsIncluded: status.rawPersonPayloadsIncluded ?? null,
    bindingDigest: status.bindingDigest ?? null,
  };
}

// ---------------------------------------------------------------------------
// EOF mode.
// ---------------------------------------------------------------------------
if (args.length === 0) {
  process.stdout.write('mode=eof status=null executed=false mutationCount=0 authority=READ_ONLY\n');
  process.stdout.write('STATUS-DENIED PROJECT_STATUS_INPUT_REQUIRED missing=declaration,observed-scope,transfer,quarantine,lifecycle,retained-rows,evidence-revision\n');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Negative gates.
// ---------------------------------------------------------------------------
if (has('--negative')) {
  const base = {
    declaredProject: readJson(DECLARATION_PATH),
    observedScope: readJson(OBSERVED_SCOPE_V1_PATH),
    transfer: readJson(TRANSFER_PATH),
    quarantine: readJson(QUARANTINE_PATH),
    lifecycleObservation: readJson(LIFECYCLE_PATH),
    retainedComparisonRows: readRows(RETAINED_ROWS_PATH),
    evidenceRevision: EVIDENCE_REVISION_V1,
    repoRoot: process.cwd(),
    now: '2026-09-23T00:00:00.000Z',
  };
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const gates = [];
  const addGate = (name, expected, run) => gates.push({ name, expected, run });

  addGate('eof-input-required', 'PROJECT_STATUS_INPUT_REQUIRED',
    () => createProjectLifecycleTransferStatus({ evidenceRevision: EVIDENCE_REVISION_V1 }));
  addGate('missing-evidence-revision', 'PROJECT_STATUS_INPUT_REQUIRED',
    () => createProjectLifecycleTransferStatus({ ...base, evidenceRevision: undefined }));
  addGate('declaration-malformed', 'PROJECT_STATUS_DECLARATION_MALFORMED', () => {
    const declaredProject = clone(base.declaredProject);
    delete declaredProject.denominatorUnit;
    return createProjectLifecycleTransferStatus({ ...base, declaredProject });
  });
  addGate('observed-scope-malformed-state', 'PROJECT_STATUS_OBSERVED_SCOPE_MALFORMED', () => {
    const observedScope = clone(base.observedScope);
    observedScope.scope[0].state = 'PROBABLY_FINE';
    return createProjectLifecycleTransferStatus({ ...base, observedScope });
  });
  addGate('fabricated-count-on-denied', 'PROJECT_STATUS_OBSERVED_SCOPE_MALFORMED', () => {
    const observedScope = clone(base.observedScope);
    const denied = observedScope.scope.find((entry) => entry.state === 'DENIED');
    denied.completedCount = 3; // a DENIED entry may never carry a fabricated count
    return createProjectLifecycleTransferStatus({ ...base, observedScope });
  });
  addGate('observed-scope-digest-mismatch', 'PROJECT_STATUS_OBSERVED_SCOPE_DIGEST_MISMATCH', () => {
    const observedScope = clone(base.observedScope);
    observedScope.scope[0].completedCount = 2; // body changed, carried digest not re-derived
    return createProjectLifecycleTransferStatus({ ...base, observedScope });
  });
  addGate('stale-evidence-revision', 'PROJECT_STATUS_EVIDENCE_REVISION_STALE',
    () => createProjectLifecycleTransferStatus({ ...base, evidenceRevision: EVIDENCE_REVISION_V2 }));
  addGate('transfer-malformed', 'PROJECT_STATUS_TRANSFER_MALFORMED', () => {
    const transfer = clone(base.transfer);
    transfer.target.installable = true; // an unexpected key is refused, not ignored
    return createProjectLifecycleTransferStatus({ ...base, transfer });
  });
  addGate('source-archive-unreadable', 'PROJECT_STATUS_SOURCE_ARCHIVE_UNREADABLE', () => {
    const transfer = clone(base.transfer);
    transfer.sourceArchive.path = `${FD}/does-not-exist.json`;
    return createProjectLifecycleTransferStatus({ ...base, transfer });
  });
  addGate('source-archive-bytes-mismatch', 'PROJECT_STATUS_SOURCE_ARCHIVE_BYTES_MISMATCH', () => {
    const transfer = clone(base.transfer);
    transfer.sourceArchive.declaredSha256 = createHash('sha256').update('not the bytes').digest('hex');
    return createProjectLifecycleTransferStatus({ ...base, transfer });
  });
  addGate('source-archive-role-invalid', 'PROJECT_STATUS_SOURCE_ARCHIVE_ROLE_INVALID', () => {
    const transfer = clone(base.transfer);
    transfer.sourceArchive.role = 'IMAGE'; // a source archive is never an installable target
    return createProjectLifecycleTransferStatus({ ...base, transfer });
  });
  addGate('quarantine-malformed', 'PROJECT_STATUS_QUARANTINE_MALFORMED', () => {
    const quarantine = clone(base.quarantine);
    quarantine.entries[0].ownerRole = 'WHOEVER';
    return createProjectLifecycleTransferStatus({ ...base, quarantine });
  });
  addGate('secret-value-included', 'PROJECT_STATUS_SECRET_VALUE_INCLUDED', () => {
    const declaredProject = clone(base.declaredProject);
    declaredProject.secretToken = 'hunter2';
    return createProjectLifecycleTransferStatus({ ...base, declaredProject });
  });
  addGate('raw-person-payload-included', 'PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED', () => {
    const quarantine = clone(base.quarantine);
    quarantine.entries[0].customerName = 'Jane Doe';
    return createProjectLifecycleTransferStatus({ ...base, quarantine });
  });
  for (const action of ['UPDATE', 'RESTORE', 'MIGRATE', 'APPROVE_TRANSFER', 'EXECUTE']) {
    addGate(`write-authority-${action.toLowerCase()}`, 'PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED',
      () => createProjectLifecycleTransferStatus({ ...base, requestedAction: action }));
  }
  addGate('unknown-authority-action', 'PROJECT_STATUS_UNKNOWN_AUTHORITY_ACTION',
    () => createProjectLifecycleTransferStatus({ ...base, requestedAction: 'INSPECT' }));
  addGate('released-readback-not-an-array', 'PROJECT_STATUS_RELEASED_READBACK_INPUT_REQUIRED',
    () => createProjectLifecycleTransferStatus({ ...base, retainedComparisonRows: 'rows' }));
  addGate('released-readback-malformed-rows', 'NET_REVENUE_COMPOSITION_REFUSED', () => {
    // The released comparison refuses a malformed row itself. The board is still PROJECTED and
    // the DENIED readback facet is PRESERVED (never deleted, never silently a number).
    const rows = clone(readRows(RETAINED_ROWS_PATH));
    rows[0].amount_minor_units = 'one hundred';
    const status = createProjectLifecycleTransferStatus({ ...base, retainedComparisonRows: rows });
    return { outcome: status.outcome, code: status.readback?.code };
  });
  addGate('rebind-substituted-retained-rows', 'PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH', () => {
    // A ONE-CENT mutation of the separately retained rows must fail the independent checker:
    // the released comparison re-executed over the mutated rows no longer re-derives the
    // carried binding.  This is the anti-substitution boundary on the readback facet.
    const status = createProjectLifecycleTransferStatus({ ...base });
    const rows = clone(readRows(RETAINED_ROWS_PATH));
    rows[0].amount_minor_units += 1;
    return rebindProjectLifecycleTransferStatus({
      ...base, retainedComparisonRows: rows, status, bindingDigest: status.bindingDigest,
    });
  });
  addGate('rebind-substituted-evidence-revision', 'PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH', () => {
    // A NEWER evidence revision substituted under an older carried binding is not current.
    const status = createProjectLifecycleTransferStatus({ ...base });
    return rebindProjectLifecycleTransferStatus({
      ...base,
      observedScope: readJson(OBSERVED_SCOPE_V2_PATH),
      evidenceRevision: EVIDENCE_REVISION_V2,
      status,
      bindingDigest: status.bindingDigest,
    });
  });
  addGate('rebind-stale-evidence-revision', 'PROJECT_STATUS_EVIDENCE_REVISION_STALE', () => {
    const status = createProjectLifecycleTransferStatus({ ...base });
    return rebindProjectLifecycleTransferStatus({
      ...base, evidenceRevision: EVIDENCE_REVISION_V2, status, bindingDigest: status.bindingDigest,
    });
  });
  addGate('rebind-resealed-observed-scope', 'PROJECT_STATUS_OBSERVED_SCOPE_DIGEST_MISMATCH', () => {
    const status = createProjectLifecycleTransferStatus({ ...base });
    const observedScope = clone(base.observedScope);
    observedScope.scope[0].completedCount = 1;
    return rebindProjectLifecycleTransferStatus({
      ...base, observedScope, status, bindingDigest: status.bindingDigest,
    });
  });
  addGate('rebind-carried-binding-malformed', 'PROJECT_STATUS_SERIALIZED_BINDING_MALFORMED',
    () => rebindProjectLifecycleTransferStatus({ ...base, status: { binding: {} }, bindingDigest: 'not-a-digest' }));
  addGate('rebind-carried-status-binding-swapped', 'PROJECT_STATUS_SERIALIZED_EVIDENCE_MISMATCH', () => {
    // The carried digest re-derives, but the CARRIED status bytes are not those of the
    // re-executed projection: a resealed serialized status is refused.
    const status = createProjectLifecycleTransferStatus({ ...base });
    const resealed = clone(status);
    resealed.binding.lifecycleState = 'RUNNING_UNVERIFIED';
    return rebindProjectLifecycleTransferStatus({ ...base, status: resealed, bindingDigest: status.bindingDigest });
  });
  addGate('projection-failed-throwing-input', 'PROJECT_STATUS_PROJECTION_FAILED', () => {
    // A hostile input whose own property access throws is reported as a projection failure,
    // never escaping as an uncaught exception.
    const declaredProject = { ...clone(base.declaredProject) };
    Object.defineProperty(declaredProject, 'ownedScope', {
      enumerable: true,
      get() { throw new Error('hostile accessor'); },
    });
    return createProjectLifecycleTransferStatus({ ...base, declaredProject });
  });
  addGate('rendered-format-unsupported', 'PROJECT_STATUS_FORMAT_UNSUPPORTED', () => {
    const status = createProjectLifecycleTransferStatus({ ...base });
    const rendered = renderProjectLifecycleTransferStatus(status, 'CSV');
    return { outcome: rendered.outcome, code: rendered.code };
  });

  let failures = 0;
  for (const gate of gates) {
    let observed;
    try {
      observed = gate.run();
    } catch (error) {
      observed = { outcome: 'THREW', code: String(error?.message ?? error) };
    }
    const observedCode = observed?.code ?? observed?.readback?.code ?? null;
    const ok = observedCode === gate.expected;
    if (!ok) failures += 1;
    process.stdout.write(
      `gate=${gate.name.padEnd(44)} expected=${gate.expected} observed=${observedCode} ${ok ? 'OK' : 'UNEXPECTEDLY_ACCEPTED'}\n`,
    );
  }
  process.stdout.write(`negative gates: ${gates.length} executed, ${failures} unexpected\n`);
  process.stdout.write(`declared denial codes: ${PROJECT_STATUS_DENIALS_V1.length}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Rebind mode.
// ---------------------------------------------------------------------------
if (has('--rebind')) {
  const loaded = inputsFromArgs();
  if (loaded.denial) {
    process.stdout.write(`STATUS-DENIED ${loaded.denial.code} missing=${(loaded.denial.missing ?? []).join(',')}\n`);
    process.exit(0);
  }
  const carriedFile = valueOf('--carried-binding');
  if (carriedFile === null) {
    process.stdout.write('STATUS-DENIED PROJECT_STATUS_SERIALIZED_BINDING_MALFORMED missing=carried-binding\n');
    process.exit(0);
  }
  const carried = readJson(carriedFile);
  const rebound = rebindProjectLifecycleTransferStatus({
    ...loaded,
    now: carried.now,
    status: carried,
    bindingDigest: carried.bindingDigest,
  });
  process.stdout.write(`rebind=${rebound.outcome} code=${rebound.code} derived=${rebound.bindingDigest ?? rebound.derived ?? null}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Status projection mode.
// ---------------------------------------------------------------------------
const loaded = inputsFromArgs();
if (loaded.denial) {
  process.stdout.write(`STATUS-DENIED ${loaded.denial.code} missing=${(loaded.denial.missing ?? []).join(',')}\n`);
  process.exit(0);
}

const format = valueOf('--format') ?? 'JSON';
if (!PROJECT_STATUS_FORMATS.includes(format)) {
  process.stdout.write(`STATUS-DENIED PROJECT_STATUS_FORMAT_UNSUPPORTED format=${format}\n`);
  process.exit(0);
}
const requestedAction = valueOf('--request-action') ?? PROJECT_STATUS_ALLOWED_ACTION;

const status = createProjectLifecycleTransferStatus({
  ...loaded,
  now: valueOf('--now') ?? '2026-09-23T00:00:00.000Z',
  requestedAction,
});

if (status.outcome !== 'PROJECTED') {
  process.stdout.write(`STATUS-DENIED ${formatProjectStatusDenial(status)} requestedAction=${requestedAction} executed=false mutationCount=0\n`);
  process.exit(0);
}

const rendered = renderProjectLifecycleTransferStatus(status, format);
process.stdout.write(rendered.text);
process.stdout.write(`STATUS-RECEIPT ${JSON.stringify(receipt(status))}\n`);
process.stdout.write(`sourceArchiveObservedSha256=${status.transfer.sourceArchive.observedSha256}\n`);
process.stdout.write(`sourceArchiveOnDiskSha256=${sha256Bytes(loaded.transfer.sourceArchive.path)}\n`);
