// KaleidoSphere #256 (KS-OPS-04) — focused acceptance suite for the READ-ONLY project
// lifecycle and transfer status projection.
//
// Every assertion is bound to an ACTUAL entry point: the module's public projection entry
// point, the module's rebind entry point, the released comparison attestation it executes,
// and the ONE runnable CLI.  Authored fixtures are declared test inputs; nothing here is a
// product execution and nothing claims a real environment.
//
// BOUNDARY DISCLOSURE (never hidden): the lifecycle/transfer/quarantine inputs are AUTHORED
// local-synthetic declarations. The single facet this slice actually EXECUTES is the released
// comparison attestation, and that is asserted as such. A helper-only or authored-fixture
// facet must not be read as an executed observation.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

import {
  PROJECT_STATUS_ALLOWED_ACTION,
  PROJECT_STATUS_CLASSIFICATION,
  PROJECT_STATUS_COVERAGE_V1,
  PROJECT_STATUS_DENIALS_V1,
  PROJECT_STATUS_FORMATS,
  PROJECT_STATUS_REFUSED_ACTIONS_V1,
  createProjectLifecycleTransferStatus,
  rebindProjectLifecycleTransferStatus,
  renderProjectLifecycleTransferStatus,
} from '../services/bi-control/src/business-bi/project-lifecycle-transfer-status-v1.mjs';
import { attestReleasedNetRevenueComparison } from '../services/bi-control/src/business-bi/order-source-consumption.mjs';
import { canonicalJson } from '../services/bi-control/src/business-bi/net-revenue-segment-comparison.mjs';

const FD = 'tests/fixtures/business-bi/ks256-lifecycle-transfer-status';
const DECLARATION = `${FD}/project-declaration-v1.json`;
const OBSERVED_V1 = `${FD}/observed-scope-v1.json`;
const OBSERVED_V2 = `${FD}/observed-scope-v2.json`;
const TRANSFER = `${FD}/transfer-v1.json`;
const QUARANTINE = `${FD}/quarantine-v1.json`;
const LIFECYCLE = `${FD}/lifecycle-observation-v1.json`;
const LIFECYCLE_PARTIAL = `${FD}/lifecycle-observation-partial-v1.json`;
// The RELEASED synthetic segment fixture: the declared SOURCE_ARCHIVE bytes AND the
// separately retained comparison rows. Unchanged, and reused rather than re-authored.
const RELEASED_ROWS = 'tests/fixtures/business-bi/net-revenue-segment-v1.json';
const REVISION_V1 = 'ks256-status-observation-v1';
const REVISION_V2 = 'ks256-status-observation-v2';
const NOW = '2026-09-23T00:00:00.000Z';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const clone = (value) => JSON.parse(JSON.stringify(value));
const fileSha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
// The suite DERIVES the retained rows itself; it never imports the module's reading.
const retainedRows = () => readJson(RELEASED_ROWS).rows;

function project(overrides = {}) {
  return createProjectLifecycleTransferStatus({
    declaredProject: readJson(DECLARATION),
    observedScope: readJson(OBSERVED_V1),
    transfer: readJson(TRANSFER),
    quarantine: readJson(QUARANTINE),
    lifecycleObservation: readJson(LIFECYCLE),
    retainedComparisonRows: retainedRows(),
    evidenceRevision: REVISION_V1,
    now: NOW,
    repoRoot: process.cwd(),
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// AC01 — identity, owned scope, denominator, progress, unknown outcomes, quarantine and the
// next responsible role, with no secret value and no raw person payload.
// ---------------------------------------------------------------------------
test('KS256 AC01: the board carries source/target identity, owned scope, denominator, progress, unknown outcomes, quarantine and the next responsible role', () => {
  const status = project();
  assert.equal(status.outcome, 'PROJECTED');
  assert.equal(status.code, 'OK');
  assert.equal(status.classification, PROJECT_STATUS_CLASSIFICATION);

  const declaration = readJson(DECLARATION);
  const expectedDenominator = declaration.ownedScope.reduce((sum, item) => sum + item.requiredCount, 0);
  assert.equal(status.progress.denominator, expectedDenominator);
  assert.equal(status.progress.unit, declaration.denominatorUnit);
  assert.deepEqual(status.projectIdentity.ownedScope, declaration.ownedScope.map((item) => item.scopeId));
  assert.equal(status.projectIdentity.projectId, declaration.projectId);

  // Source/target identity: the declared ARCHIVE bytes and the declared transfer target.
  assert.equal(status.transfer.sourceArchive.role, 'SOURCE_ARCHIVE');
  assert.equal(status.transfer.target.role, 'IMAGE');
  assert.equal(status.transfer.sourceArchive.artifactId, readJson(TRANSFER).sourceArchive.artifactId);
  assert.equal(status.transfer.target.declaredDigest, readJson(TRANSFER).target.declaredDigest);

  // Unknown outcomes and quarantine are NAMED, not omitted, and each names its next role.
  assert.ok(status.unknownOutcomes.length > 0);
  for (const entry of status.unknownOutcomes) {
    assert.ok(entry.itemId.length > 0);
    assert.ok(entry.coverage !== 'AVAILABLE');
    assert.ok(typeof entry.nextResponsibleRole === 'string' && entry.nextResponsibleRole.length > 0);
  }
  assert.equal(status.quarantine.length, readJson(QUARANTINE).entries.length);
  assert.ok(status.nextResponsibleRole.length > 0);

  // No secret value and no raw person payload is exported by the board itself.
  assert.equal(status.secretValuesExported, false);
  assert.equal(status.rawPersonPayloadsIncluded, false);
  const serialized = JSON.stringify(status);
  for (const forbidden of ['hunter2', 'api_key"', '"password"', 'customerName']) {
    assert.equal(serialized.includes(forbidden), false, `board leaked ${forbidden}`);
  }
});

test('KS256 AC01: the source archive bytes are read by the module itself and re-derived independently by this suite', () => {
  const status = project();
  const declared = readJson(TRANSFER).sourceArchive;
  const independent = fileSha256(declared.path);
  assert.equal(status.transfer.sourceArchive.observedSha256, independent);
  assert.equal(status.transfer.sourceArchive.declaredSha256, independent);
  assert.equal(status.transfer.sourceArchive.matches, true);
  // The SOURCE_ARCHIVE is never an installable target.
  assert.equal(status.transfer.sourceArchive.installable, false);
  assert.equal(status.transfer.sourceArchive.byteObservation, 'READ_BY_THIS_MODULE_FROM_THE_NAMED_FILE');
});

test('KS256 AC01: an unobserved scope item leaves the progress fraction UNAVAILABLE by name instead of contributing a zero', () => {
  const status = project();
  const observation = readJson(OBSERVED_V1);
  const quarantined = new Set(readJson(QUARANTINE).entries.map((entry) => entry.itemId));
  const observableIds = observation.scope
    .filter((entry) => !quarantined.has(entry.scopeId))
    .map((entry) => entry.scopeId);
  const nonAvailable = observation.scope
    .filter((entry) => !quarantined.has(entry.scopeId) && entry.state !== 'AVAILABLE');
  assert.ok(nonAvailable.length > 0);
  assert.equal(status.progress.observedCompletedCount, null);
  assert.equal(status.progress.fraction, null);
  assert.ok(status.progress.fractionUnavailableReason.startsWith('NON_AVAILABLE_SCOPE_ITEMS:'));
  for (const entry of nonAvailable) {
    assert.ok(status.progress.fractionUnavailableReason.includes(`${entry.scopeId}=${entry.state}`));
  }
  assert.deepEqual(status.progress.denominatorScope.sort(), observation.scope.map((e) => e.scopeId).sort());
  assert.deepEqual(status.progress.quarantinedExcludedFromProgress, [...quarantined].sort());
  assert.equal(observableIds.length, observation.scope.length - quarantined.size);
  assert.equal(status.progress.basis, 'OBSERVED_SCOPE_AT_CURRENT_EVIDENCE_REVISION');
});

test('KS256 AC01: a secret VALUE or a raw person payload anywhere in an input is refused by name', () => {
  const declaredWithSecret = clone(readJson(DECLARATION));
  declaredWithSecret.secretToken = 'hunter2';
  assert.equal(project({ declaredProject: declaredWithSecret }).code, 'PROJECT_STATUS_SECRET_VALUE_INCLUDED');

  const declaredWithApiKey = clone(readJson(DECLARATION));
  declaredWithApiKey.api_key = 'abc123';
  assert.equal(project({ declaredProject: declaredWithApiKey }).code, 'PROJECT_STATUS_SECRET_VALUE_INCLUDED');

  const quarantineWithPerson = clone(readJson(QUARANTINE));
  quarantineWithPerson.entries[0].customerName = 'Jane Doe';
  assert.equal(project({ quarantine: quarantineWithPerson }).code, 'PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED');

  const observedWithEmail = clone(readJson(OBSERVED_V1));
  observedWithEmail.scope[0].email = 'someone@example.invalid';
  assert.equal(project({ observedScope: observedWithEmail }).code, 'PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED');

  // A declared `...Ref` field carrying a REFERENCE is legitimate; the same field carrying a
  // real value is not.
  const referenceOnly = clone(readJson(TRANSFER));
  referenceOnly.sourceArchive.secretRef = 'vault://ks256/source-archive';
  assert.equal(project({ transfer: referenceOnly }).code, 'PROJECT_STATUS_TRANSFER_MALFORMED'); // unexpected key, refused
});

// ---------------------------------------------------------------------------
// AC02 — UNKNOWN / DENIED / PARTIAL / observed absence survive a source change, and stale or
// substituted evidence can never appear current.
// ---------------------------------------------------------------------------
test('KS256 AC02: UNKNOWN, DENIED, PARTIAL and OBSERVED_ABSENT are all preserved on the board', () => {
  const status = project();
  const states = new Set(status.coverage.map((entry) => entry.coverage));
  for (const state of ['AVAILABLE', 'DENIED', 'PARTIAL', 'OBSERVED_ABSENT']) {
    assert.ok(states.has(state), `board dropped coverage state ${state}`);
  }
  for (const state of states) {
    assert.ok(PROJECT_STATUS_COVERAGE_V1.includes(state), `undeclared coverage state ${state}`);
  }
  // DENIED is denied visibility, not absence: the item is present with its own state.
  const denied = status.scopeCoverage.find((item) => item.coverage === 'DENIED');
  assert.ok(denied);
  assert.equal(denied.observedCompletedCount, null);
  assert.equal(denied.unavailableReason, 'OBSERVED_STATE_DENIED');
  const absent = status.scopeCoverage.find((item) => item.coverage === 'OBSERVED_ABSENT');
  assert.ok(absent);
  assert.equal(absent.unavailableReason, 'OBSERVED_STATE_OBSERVED_ABSENT');
  // The quarantined item is preserved as PARTIAL with its retained evidence digest.
  const quarantined = status.scopeCoverage.find((item) => item.quarantined);
  assert.ok(quarantined);
  assert.equal(quarantined.coverage, 'PARTIAL');
  assert.equal(quarantined.unavailableReason, 'QUARANTINED_ITEM');
  assert.equal(status.quarantine[0].retainedEvidenceSha256, readJson(QUARANTINE).entries[0].retainedEvidenceSha256);
  assert.equal(status.quarantine[0].includedInProgress, false);
});

test('KS256 AC02: a changed evidence revision is re-projected from its own observation, never re-used from the older reading', () => {
  const before = project();
  const after = project({
    observedScope: readJson(OBSERVED_V2),
    evidenceRevision: REVISION_V2,
  });
  assert.equal(before.evidenceRevisionProbe ?? before.projectIdentity.evidenceRevision, REVISION_V1);
  assert.equal(after.projectIdentity.evidenceRevision, REVISION_V2);
  assert.notEqual(before.bindingDigest, after.bindingDigest);
  assert.notEqual(before.projectIdentity.evidenceRevision, after.projectIdentity.evidenceRevision);

  const v1 = readJson(OBSERVED_V1);
  const v2 = readJson(OBSERVED_V2);
  const byId = (entries) => new Map(entries.map((entry) => [entry.scopeId, entry]));
  const beforeById = byId(before.scopeCoverage.map((item) => ({ ...item })));
  const afterById = byId(after.scopeCoverage.map((item) => ({ ...item })));
  let changed = 0;
  for (const entry of v2.scope) {
    const previous = beforeById.get(entry.scopeId);
    const next = afterById.get(entry.scopeId);
    if (previous.coverage !== next.coverage) {
      changed += 1;
      // The change is the OBSERVED change, carried through verbatim.
      assert.equal(next.coverage, previous.quarantined ? 'PARTIAL' : entry.state);
    }
  }
  assert.ok(changed > 0, 'the source change produced no observable coverage change');
  assert.equal(v1.observedRevision, REVISION_V1);
  assert.equal(v2.observedRevision, REVISION_V2);
});

test('KS256 AC02: a stale evidence revision is refused by name', () => {
  const stale = project({ evidenceRevision: REVISION_V2 });
  assert.equal(stale.outcome, 'DENIED');
  assert.equal(stale.code, 'PROJECT_STATUS_EVIDENCE_REVISION_STALE');
  assert.equal(stale.observedRevision, REVISION_V1);
  assert.equal(stale.requestedEvidenceRevision, REVISION_V2);
});

test('KS256 AC02: a resealed observed-scope body whose carried digest was not re-derived is refused', () => {
  const resealed = clone(readJson(OBSERVED_V1));
  resealed.scope[0].completedCount = 2;
  const refused = project({ observedScope: resealed });
  assert.equal(refused.code, 'PROJECT_STATUS_OBSERVED_SCOPE_DIGEST_MISMATCH');
  assert.equal(refused.declaredSha256, readJson(OBSERVED_V1).evidenceSha256);
  assert.notEqual(refused.derivedSha256, refused.declaredSha256);
});

test('KS256 AC02: substituted evidence cannot re-derive a carried binding — a one-cent row mutation and a newer revision both fail', () => {
  const carried = project();
  assert.equal(carried.outcome, 'PROJECTED');

  // (a) the carried projection re-derives exactly from its own inputs.
  const rebound = rebindProjectLifecycleTransferStatus({
    declaredProject: readJson(DECLARATION),
    observedScope: readJson(OBSERVED_V1),
    transfer: readJson(TRANSFER),
    quarantine: readJson(QUARANTINE),
    lifecycleObservation: readJson(LIFECYCLE),
    retainedComparisonRows: retainedRows(),
    evidenceRevision: REVISION_V1,
    now: NOW,
    status: carried,
    bindingDigest: carried.bindingDigest,
    repoRoot: process.cwd(),
  });
  assert.equal(rebound.outcome, 'REBOUND');
  assert.equal(rebound.bindingDigest, carried.bindingDigest);

  // (b) ONE CENT of substitution in the separately retained rows is refused.
  const mutatedRows = retainedRows();
  mutatedRows[0].amount_minor_units += 1;
  const centDiff = rebindProjectLifecycleTransferStatus({
    declaredProject: readJson(DECLARATION),
    observedScope: readJson(OBSERVED_V1),
    transfer: readJson(TRANSFER),
    quarantine: readJson(QUARANTINE),
    lifecycleObservation: readJson(LIFECYCLE),
    retainedComparisonRows: mutatedRows,
    evidenceRevision: REVISION_V1,
    now: NOW,
    status: carried,
    bindingDigest: carried.bindingDigest,
    repoRoot: process.cwd(),
  });
  assert.equal(centDiff.outcome, 'DENIED');
  assert.equal(centDiff.code, 'PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH');
  assert.notEqual(centDiff.derived, carried.bindingDigest);

  // (c) a NEWER evidence revision substituted under the older carried binding is refused.
  const substitutedRevision = rebindProjectLifecycleTransferStatus({
    declaredProject: readJson(DECLARATION),
    observedScope: readJson(OBSERVED_V2),
    transfer: readJson(TRANSFER),
    quarantine: readJson(QUARANTINE),
    lifecycleObservation: readJson(LIFECYCLE),
    retainedComparisonRows: retainedRows(),
    evidenceRevision: REVISION_V2,
    now: NOW,
    status: carried,
    bindingDigest: carried.bindingDigest,
    repoRoot: process.cwd(),
  });
  assert.equal(substitutedRevision.code, 'PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH');

  // (d) a resealed SERIALIZED status whose own binding bytes were rewritten is refused.
  const resealed = clone(carried);
  resealed.binding.readbackCode = 'OK_FORGED';
  const resealedRefused = rebindProjectLifecycleTransferStatus({
    declaredProject: readJson(DECLARATION),
    observedScope: readJson(OBSERVED_V1),
    transfer: readJson(TRANSFER),
    quarantine: readJson(QUARANTINE),
    lifecycleObservation: readJson(LIFECYCLE),
    retainedComparisonRows: retainedRows(),
    evidenceRevision: REVISION_V1,
    now: NOW,
    status: resealed,
    bindingDigest: carried.bindingDigest,
    repoRoot: process.cwd(),
  });
  assert.equal(resealedRefused.code, 'PROJECT_STATUS_SERIALIZED_EVIDENCE_MISMATCH');
});

// ---------------------------------------------------------------------------
// AC03 — a verified display neither approves nor executes an update, restore or migration.
// ---------------------------------------------------------------------------
test('KS256 AC03: every mutating authority escalation is refused by name before anything is read', () => {
  for (const action of PROJECT_STATUS_REFUSED_ACTIONS_V1) {
    const refused = project({ requestedAction: action });
    assert.equal(refused.outcome, 'DENIED', `action ${action} was not refused`);
    assert.equal(refused.code, 'PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED');
    assert.equal(refused.requestedAction, action);
    assert.equal(refused.grantedAuthority, 'READ_ONLY');
    assert.equal(refused.executed, false);
    assert.equal(refused.mutationCount, 0);
  }
  const unknown = project({ requestedAction: 'INSPECT' });
  assert.equal(unknown.code, 'PROJECT_STATUS_UNKNOWN_AUTHORITY_ACTION');
  // The one permitted action still projects.
  assert.equal(project({ requestedAction: PROJECT_STATUS_ALLOWED_ACTION }).outcome, 'PROJECTED');
});

test('KS256 AC03: the positive projection grants no write authority, approves nothing and mutates nothing on disk', () => {
  const archivePath = readJson(TRANSFER).sourceArchive.path;
  const before = { archive: fileSha256(archivePath), rows: fileSha256(RELEASED_ROWS) };
  const status = project();
  const after = { archive: fileSha256(archivePath), rows: fileSha256(RELEASED_ROWS) };

  assert.deepEqual(after, before, 'the read-only projection mutated an input on disk');
  assert.equal(status.authority.displayAuthority, 'READ_ONLY');
  assert.equal(status.authority.writeAuthority, 'NOT_GRANTED');
  assert.deepEqual(status.authority.approvedActions, []);
  assert.deepEqual(status.authority.allowedActions, [PROJECT_STATUS_ALLOWED_ACTION]);
  assert.equal(status.authority.executesUpdate, false);
  assert.equal(status.authority.executesRestore, false);
  assert.equal(status.authority.executesMigration, false);
  assert.equal(status.authority.executesTransfer, false);
  assert.equal(status.authority.mutationCount, 0);
  assert.deepEqual(status.authority.refusedAuthorityActions, [...PROJECT_STATUS_REFUSED_ACTIONS_V1]);
});

test('KS256 AC03: the verified readback facet is an ACTUAL released execution, and a forged label-only report is refused by the released checker', () => {
  const status = project();
  assert.equal(status.readback.facet, 'RELEASED_NET_REVENUE_COMPARISON_ATTESTATION');
  assert.equal(status.readback.coverage, 'AVAILABLE');
  assert.equal(status.readback.executed, true);
  assert.equal(status.readback.attestationBasis, 'IN_PROCESS_RELEASED_COMPOSITION');
  assert.equal(status.readback.code, 'OK');
  assert.deepEqual(status.executionFacets.executed, ['RELEASED_NET_REVENUE_COMPARISON_ATTESTATION']);

  // A JSON round-trip loses the released execution provenance: released labels plus a
  // self-consistent digest are NOT execution evidence.
  const labelOnly = {
    schemaVersion: 'kaleidosphere.business-bi/net-revenue-segment-comparison/v1',
    sourceRelation: 'xra_projection_orders',
    digest: status.readback.digest,
  };
  const labelOnlyVerdict = attestReleasedNetRevenueComparison(labelOnly);
  assert.equal(labelOnlyVerdict.ok, false);
  assert.equal(labelOnlyVerdict.state, 'DENIED');
  assert.match(labelOnlyVerdict.code, /^NET_REVENUE_/);

  // A genuine composed report that was JSON round-tripped is a DIFFERENT object and is refused
  // unless the separately retained rows reproduce its digest.
  const roundTripped = clone(status.readback);
  const roundTrippedVerdict = attestReleasedNetRevenueComparison(roundTripped);
  assert.equal(roundTrippedVerdict.ok, false);

  // The same forged object IS re-derivable from separately retained rows, which is the only
  // route by which a serialized report may be credited.
  const genuine = project();
  const reExecuted = createProjectLifecycleTransferStatus({
    declaredProject: readJson(DECLARATION),
    observedScope: readJson(OBSERVED_V1),
    transfer: readJson(TRANSFER),
    quarantine: readJson(QUARANTINE),
    lifecycleObservation: readJson(LIFECYCLE),
    retainedComparisonRows: retainedRows(),
    evidenceRevision: REVISION_V1,
    now: NOW,
    repoRoot: process.cwd(),
  });
  assert.equal(reExecuted.readback.digest, genuine.readback.digest);
  assert.equal(reExecuted.bindingDigest, genuine.bindingDigest);
});

test('KS256 AC03: a released readback refusal is PRESERVED on the board as DENIED rather than deleted or turned into a number', () => {
  const malformed = retainedRows();
  malformed[0].amount_minor_units = 'one hundred';
  const status = project({ retainedComparisonRows: malformed });
  assert.equal(status.outcome, 'PROJECTED');
  assert.equal(status.readback.coverage, 'DENIED');
  assert.equal(status.readback.code, 'NET_REVENUE_COMPOSITION_REFUSED');
  assert.equal(status.readback.executed, false);
  const readbackCoverage = status.coverage.find((entry) => entry.subjectKind === 'RELEASED_READBACK');
  assert.equal(readbackCoverage.coverage, 'DENIED');
});

// ---------------------------------------------------------------------------
// Contract shapes, rendering, and the fail-closed catch.
// ---------------------------------------------------------------------------
test('KS256: every required input has no default and no implicit fixture adoption', () => {
  const required = ['declaredProject', 'observedScope', 'transfer', 'quarantine',
    'lifecycleObservation', 'retainedComparisonRows', 'evidenceRevision', 'now'];
  for (const key of required) {
    const partial = {
      declaredProject: readJson(DECLARATION),
      observedScope: readJson(OBSERVED_V1),
      transfer: readJson(TRANSFER),
      quarantine: readJson(QUARANTINE),
      lifecycleObservation: readJson(LIFECYCLE),
      retainedComparisonRows: retainedRows(),
      evidenceRevision: REVISION_V1,
      now: NOW,
    };
    delete partial[key];
    const refused = createProjectLifecycleTransferStatus(partial);
    assert.equal(refused.code, 'PROJECT_STATUS_INPUT_REQUIRED', `${key} was silently defaulted`);
    assert.ok(refused.missing.includes(key));
  }
  assert.equal(createProjectLifecycleTransferStatus().code, 'PROJECT_STATUS_INPUT_REQUIRED');
});

test('KS256: JSON and TABLE render the board; an unsupported format is refused', () => {
  const status = project();
  for (const format of PROJECT_STATUS_FORMATS) {
    const rendered = renderProjectLifecycleTransferStatus(status, format);
    assert.equal(rendered.outcome, 'RENDERED');
    assert.ok(rendered.text.includes(status.bindingDigest));
    assert.ok(rendered.text.includes('READ_ONLY'));
  }
  const json = renderProjectLifecycleTransferStatus(status, 'JSON');
  assert.equal(JSON.parse(json.text).bindingDigest, status.bindingDigest);
  const table = renderProjectLifecycleTransferStatus(status, 'TABLE');
  for (const item of status.scopeCoverage) assert.ok(table.text.includes(item.scopeId));
  assert.equal(renderProjectLifecycleTransferStatus(status, 'CSV').code, 'PROJECT_STATUS_FORMAT_UNSUPPORTED');
});

test('KS256: lifecycle classification follows the closed decision table (partial facets stay PARTIALLY_INSTALLED, never inferred)', () => {
  const running = project();
  assert.equal(running.lifecycle.state, 'RUNNING');
  assert.equal(running.lifecycle.observationValidity, 'VALID');
  const partial = project({ lifecycleObservation: readJson(LIFECYCLE_PARTIAL) });
  assert.equal(partial.lifecycle.state, 'PARTIALLY_INSTALLED');
  const driftedTransfer = clone(readJson(TRANSFER));
  driftedTransfer.target.observedDigest = createHash('sha256').update('drifted').digest('hex');
  const drifted = project({ transfer: driftedTransfer });
  assert.equal(drifted.lifecycle.state, 'LOCALLY_MODIFIED');
  assert.equal(drifted.transfer.target.generationValidity, 'DRIFTED');
  assert.equal(drifted.transfer.target.installable, false);
});

test('KS256: a hostile input whose own property access throws is reported as a projection failure, not an uncaught exception', () => {
  const declaredProject = { ...clone(readJson(DECLARATION)) };
  Object.defineProperty(declaredProject, 'ownedScope', {
    enumerable: true,
    get() { throw new Error('hostile accessor'); },
  });
  const refused = project({ declaredProject });
  assert.equal(refused.outcome, 'DENIED');
  assert.equal(refused.code, 'PROJECT_STATUS_PROJECTION_FAILED');
});

test('KS256: the declared denial contract is closed and contains no duplicate', () => {
  assert.equal(new Set(PROJECT_STATUS_DENIALS_V1).size, PROJECT_STATUS_DENIALS_V1.length);
  assert.ok(PROJECT_STATUS_DENIALS_V1.includes('PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED'));
  assert.ok(PROJECT_STATUS_DENIALS_V1.includes('PROJECT_STATUS_EVIDENCE_REVISION_STALE'));
  assert.ok(!PROJECT_STATUS_DENIALS_V1.includes('OK'));
});

// ---------------------------------------------------------------------------
// The runnable CLI on the actual entry point.
// ---------------------------------------------------------------------------
const CLI = 'scripts/run-project-lifecycle-transfer-status.mjs';
const runCli = (args) => execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

test('KS256 CLI: EOF projects nothing and refuses without adopting any fixture', () => {
  const out = runCli([]);
  assert.match(out, /mode=eof status=null executed=false mutationCount=0 authority=READ_ONLY/);
  assert.match(out, /STATUS-DENIED PROJECT_STATUS_INPUT_REQUIRED/);
  assert.match(out, /missing=declaration,observed-scope,transfer,quarantine,lifecycle,retained-rows,evidence-revision/);
});

test('KS256 CLI: the positive projection renders and reports the receipt, and a missing input is refused before any read', () => {
  const out = runCli([
    '--declaration', DECLARATION, '--observed-scope', OBSERVED_V1, '--transfer', TRANSFER,
    '--quarantine', QUARANTINE, '--lifecycle', LIFECYCLE, '--retained-rows', RELEASED_ROWS,
    '--evidence-revision', REVISION_V1, '--format', 'TABLE',
  ]);
  assert.match(out, /STATUS-RECEIPT \{/);
  assert.match(out, /"outcome":"PROJECTED"/);
  assert.match(out, /"mutationCount":0/);
  assert.match(out, /"writeAuthority":"NOT_GRANTED"/);
  assert.match(out, /"readbackCoverage":"AVAILABLE"/);
  assert.match(out, /sourceArchiveObservedSha256=([a-f0-9]{64})/);
  assert.match(out, /authority=READ_ONLY writeAuthority=NOT_GRANTED mutationCount=0/);

  const partial = runCli(['--declaration', DECLARATION]);
  assert.match(partial, /STATUS-DENIED PROJECT_STATUS_INPUT_REQUIRED/);
  assert.match(partial, /missing=observed-scope,transfer,quarantine,lifecycle,retained-rows,evidence-revision/);

  const escalation = runCli([
    '--declaration', DECLARATION, '--observed-scope', OBSERVED_V1, '--transfer', TRANSFER,
    '--quarantine', QUARANTINE, '--lifecycle', LIFECYCLE, '--retained-rows', RELEASED_ROWS,
    '--evidence-revision', REVISION_V1, '--request-action', 'RESTORE',
  ]);
  assert.match(escalation, /STATUS-DENIED PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED requestedAction=RESTORE executed=false mutationCount=0/);
});

test('KS256 CLI: the negative gates all print their exact intended rejection code', () => {
  const out = runCli(['--negative']);
  assert.match(out, /negative gates: 30 executed, 0 unexpected/);
  assert.equal(out.includes('UNEXPECTEDLY_ACCEPTED'), false);
  for (const gate of [
    'secret-value-included', 'raw-person-payload-included', 'write-authority-update',
    'write-authority-migrate', 'stale-evidence-revision', 'rebind-substituted-retained-rows',
  ]) {
    assert.ok(out.includes(`gate=${gate}`), `gate ${gate} missing`);
  }
});

test('KS256 CLI: rebind re-derives the carried binding exactly, and refuses a newer evidence revision', () => {
  const scratch = mkdtempSync(path.join(tmpdir(), 'ks256-carried-'));
  try {
    const carried = project();
    const carriedFile = path.join(scratch, 'carried-status.json');
    writeFileSync(carriedFile, JSON.stringify(carried, null, 2));
    const common = [
      '--declaration', DECLARATION, '--transfer', TRANSFER,
      '--quarantine', QUARANTINE, '--lifecycle', LIFECYCLE, '--retained-rows', RELEASED_ROWS,
      '--rebind', '--carried-binding', carriedFile,
    ];
    const rebound = runCli([...common, '--observed-scope', OBSERVED_V1, '--evidence-revision', REVISION_V1]);
    assert.match(rebound, /rebind=REBOUND code=OK/);
    assert.ok(rebound.includes(carried.bindingDigest));

    const stale = runCli([...common, '--observed-scope', OBSERVED_V2, '--evidence-revision', REVISION_V2]);
    assert.match(stale, /rebind=DENIED code=PROJECT_STATUS_SERIALIZED_BINDING_MISMATCH/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// RED/GREEN at the intended boundaries. Each disposable variant is written to a
// dot-prefixed scratch path inside the module's directory (so its relative imports resolve),
// DRIVEN to show the boundary is RED on the variant, then removed in a finally. The candidate
// is driven on the same input and must be GREEN. No variant file remains on disk.
// ---------------------------------------------------------------------------
const MODULE_DIR = path.dirname('services/bi-control/src/business-bi/project-lifecycle-transfer-status-v1.mjs');
const MODULE_SRC = 'services/bi-control/src/business-bi/project-lifecycle-transfer-status-v1.mjs';
const CLI_SRC = 'scripts/run-project-lifecycle-transfer-status.mjs';
const moduleUrl = (relative) => pathToFileURL(path.resolve(process.cwd(), relative)).href;

// The observed-scope digest is INTEGRITY, not authority: a caller can legitimately re-derive
// it. Re-sealing a body therefore isolates the SEMANTIC boundary a variant removes.
const resealObservedScope = (scope) => {
  const body = {
    schemaVersion: readJson(OBSERVED_V1).schemaVersion,
    classification: readJson(OBSERVED_V1).classification,
    observedRevision: readJson(OBSERVED_V1).observedRevision,
    scope,
  };
  return { ...body, evidenceSha256: sha256Of(body) };
};
const sha256Of = (value) => createHash('sha256')
  .update(JSON.stringify(canonicalJson(value)), 'utf8').digest('hex');

async function driveVariant(name, mutate, drive) {
  const variantPath = `${MODULE_DIR}/.ks256-variant-${name}.mjs`;
  const original = readFileSync(MODULE_SRC, 'utf8');
  const mutated = mutate(original);
  assert.notEqual(mutated, original, `variant ${name} did not change the source`);
  writeFileSync(variantPath, mutated);
  try {
    const variant = await import(moduleUrl(variantPath));
    return drive(variant);
  } finally {
    rmSync(variantPath, { force: true });
    assert.equal(existsSync(variantPath), false, `variant ${name} was left on disk`);
  }
}

function variantInput(overrides = {}) {
  return {
    declaredProject: readJson(DECLARATION),
    observedScope: readJson(OBSERVED_V1),
    transfer: readJson(TRANSFER),
    quarantine: readJson(QUARANTINE),
    lifecycleObservation: readJson(LIFECYCLE),
    retainedComparisonRows: retainedRows(),
    evidenceRevision: REVISION_V1,
    now: NOW,
    repoRoot: process.cwd(),
    ...overrides,
  };
}

test('KS256 RED/GREEN: without the fabricated-count guard a DENIED item may carry a fabricated count on the variant; the candidate refuses it', async () => {
  const scope = clone(readJson(OBSERVED_V1)).scope;
  scope.find((entry) => entry.state === 'DENIED').completedCount = 3;
  const observedScope = resealObservedScope(scope);
  const red = await driveVariant(
    'no-count-guard',
    (source) => source.replace(
      "    if (entry.state !== 'AVAILABLE' && entry.completedCount !== null) {",
      "    if (false && entry.state !== 'AVAILABLE' && entry.completedCount !== null) {"),
    (variant) => variant.createProjectLifecycleTransferStatus(variantInput({ observedScope })),
  );
  assert.equal(red.outcome, 'PROJECTED', 'the broken variant rejected the resealed fabricated count');
  assert.equal(red.scopeCoverage.find((item) => item.coverage === 'DENIED').coverage, 'DENIED');
  assert.equal(project({ observedScope }).code, 'PROJECT_STATUS_OBSERVED_SCOPE_MALFORMED');
});

test('KS256 RED/GREEN: without the stale-revision guard a stale revision appears current on the variant; the candidate refuses it', async () => {
  const red = await driveVariant(
    'no-stale-guard',
    (source) => source.replace(
      '  if (observedScope.observedRevision !== evidenceRevision) {',
      '  if (false && observedScope.observedRevision !== evidenceRevision) {'),
    (variant) => variant.createProjectLifecycleTransferStatus(variantInput({ evidenceRevision: REVISION_V2 })),
  );
  assert.equal(red.outcome, 'PROJECTED', 'the broken variant did not treat the stale revision as current');
  assert.equal(red.projectIdentity.evidenceRevision, REVISION_V2);
  assert.equal(project({ evidenceRevision: REVISION_V2 }).code, 'PROJECT_STATUS_EVIDENCE_REVISION_STALE');
});

test('KS256 RED/GREEN: without the authority-escalation guard a mutating action is accepted on the variant; the candidate refuses it', async () => {
  const red = await driveVariant(
    'no-escalation-guard',
    (source) => source.replace(
      '  if (requestedAction !== PROJECT_STATUS_ALLOWED_ACTION) {',
      '  if (false && requestedAction !== PROJECT_STATUS_ALLOWED_ACTION) {'),
    (variant) => variant.createProjectLifecycleTransferStatus(variantInput({ requestedAction: 'MIGRATE' })),
  );
  assert.equal(red.outcome, 'PROJECTED', 'the broken variant did not accept the mutating action');
  assert.equal(red.authority.writeAuthority, 'NOT_GRANTED');
  assert.equal(project({ requestedAction: 'MIGRATE' }).code, 'PROJECT_STATUS_WRITE_AUTHORITY_NOT_GRANTED');
});

test('KS256 RED/GREEN: without the raw-person gate the injected payload is NOT named on the variant; the candidate names it', async () => {
  const quarantine = clone(readJson(QUARANTINE));
  quarantine.entries[0].customerName = 'Jane Doe';
  const red = await driveVariant(
    'no-payload-gate',
    (source) => source.replace(
      '    if (RAW_PERSON_KEY.test(normalisedKey(key)))',
      '    if (false && RAW_PERSON_KEY.test(normalisedKey(key)))'),
    (variant) => variant.createProjectLifecycleTransferStatus(variantInput({ quarantine })),
  );
  assert.notEqual(red.code, 'PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED',
    'the broken variant still named the raw-person payload boundary');
  assert.equal(project({ quarantine }).code, 'PROJECT_STATUS_RAW_PERSON_PAYLOAD_INCLUDED');
});

test('KS256 RED/GREEN: a CLI that IMPLICITLY defaults the evidence revision is RED through the real entry point; the candidate is GREEN', () => {
  const variantCli = 'scripts/.ks256-variant-cli-implicit-revision.mjs';
  const original = readFileSync(CLI_SRC, 'utf8');
  const mutated = original.replace(
    "const evidenceRevision = valueOf('--evidence-revision');",
    "const evidenceRevision = valueOf('--evidence-revision') ?? EVIDENCE_REVISION_V1;");
  assert.notEqual(mutated, original, 'the CLI variant did not change the source');
  writeFileSync(variantCli, mutated);
  try {
    const out = execFileSync(process.execPath, [variantCli, '--declaration', DECLARATION], { encoding: 'utf8' });
    assert.match(out, /STATUS-DENIED PROJECT_STATUS_INPUT_REQUIRED/);
    assert.equal(out.includes('evidence-revision'), false,
      'the broken CLI still refused the implicitly defaulted evidence revision');
  } finally {
    rmSync(variantCli, { force: true });
    assert.equal(existsSync(variantCli), false);
  }
  const green = execFileSync(process.execPath, [CLI_SRC, '--declaration', DECLARATION], { encoding: 'utf8' });
  assert.match(green, /missing=observed-scope,transfer,quarantine,lifecycle,retained-rows,evidence-revision/);
});
