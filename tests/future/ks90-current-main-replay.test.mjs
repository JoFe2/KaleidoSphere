import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import * as lib from '../../scripts/future/ks90-replay-receipt-lib.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const fixturePath = path.join(root, lib.RECEIPT_PATH);
const raw = await readFile(fixturePath, 'utf8');
const receipt = JSON.parse(raw);

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

function context(overrides = {}) {
  return {
    exactBaseSha: lib.EXACT_BASE_SHA,
    acceptedDocumentHeadSha: lib.ACCEPTED_DOCUMENT_HEAD_SHA,
    issue: lib.ISSUE,
    disposition: lib.DISPOSITION,
    packetDigests: Object.fromEntries(lib.PACKET.map(({ path, sha256 }) => [path, sha256])),
    ...overrides,
  };
}

function rejection(mutator, ctx = context()) {
  const candidate = structuredClone(receipt);
  mutator(candidate);
  return lib.validateReceipt(candidate, ctx);
}

function hasFailure(result, code) {
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes(code), `expected ${code}; got ${result.failures.join(', ')}`);
}

test('fixture binds the accepted current presentation and grants no execution permission', () => {
  assert.equal(receipt.status, 'REJECTED_WITH_EVIDENCE');
  assert.equal(receipt.presentation.exact_base_sha, lib.EXACT_BASE_SHA);
  assert.equal(receipt.presentation.accepted_document_head_sha, lib.ACCEPTED_DOCUMENT_HEAD_SHA);
  assert.equal(receipt.presentation.issue, lib.ISSUE);
  assert.equal(receipt.presentation.disposition, lib.DISPOSITION);
  assert.equal(receipt.authority.execution_permission_granted, false);
  assert.equal(receipt.authority.signature_is_execution_authority, false);
  assert.equal(receipt.authority.receipt_is_command_or_permission, false);
  assert.deepEqual(lib.validateReceipt(receipt, context()), { ok: true, failures: [] });
});

test('packet is complete and binds actual accepted-head bytes by sha256', () => {
  assert.deepEqual(receipt.packet, lib.PACKET);
  for (const entry of receipt.packet) {
    const bytes = execFileSync('git', ['show', `${lib.ACCEPTED_DOCUMENT_HEAD_SHA}:${entry.path}`], { cwd: root });
    const actual = execFileSync('sha256sum', { input: bytes, encoding: 'utf8' }).split(/\s+/)[0];
    assert.equal(actual, entry.sha256, entry.path);
  }
  assert.equal(git(['merge-base', '--is-ancestor', lib.EXACT_BASE_SHA, lib.ACCEPTED_DOCUMENT_HEAD_SHA]), '');
  assert.deepEqual(
    git(['diff', '--name-only', `${lib.EXACT_BASE_SHA}..${lib.ACCEPTED_DOCUMENT_HEAD_SHA}`]).split('\n'),
    ['docs/future/remote-connector/IDENTITY_AUTHORITY_RECEIPTS.md'],
  );
  assert.deepEqual(
    git(['rev-list', '--left-right', '--count', `${lib.EXACT_BASE_SHA}...${lib.ACCEPTED_DOCUMENT_HEAD_SHA}`]).split(/\s+/),
    ['0', '1'],
  );
});

test('fixture is canonical and builder reproduces it at the accepted document head', () => {
  assert.equal(lib.canonicalSerialize(receipt), raw);
  const run = spawnSync('/usr/bin/node', [
    'scripts/future/build-ks90-replay-receipt.mjs',
    '--base', lib.EXACT_BASE_SHA,
    '--document-head', lib.ACCEPTED_DOCUMENT_HEAD_SHA,
    '--check',
  ], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.match(run.stdout, /check: OK/);
});

test('empty or missing presentation context denies', () => {
  hasFailure(lib.validateReceipt(receipt), lib.REASONS.presentation_context_missing);
  hasFailure(lib.validateReceipt(receipt, {}), lib.REASONS.presentation_context_missing);
  for (const field of ['exactBaseSha', 'acceptedDocumentHeadSha', 'issue', 'disposition', 'packetDigests']) {
    const ctx = context();
    delete ctx[field];
    hasFailure(lib.validateReceipt(receipt, ctx), lib.REASONS.presentation_context_missing);
  }
});

test('omitting any required packet digest denies', () => {
  for (const entry of lib.PACKET) {
    const ctx = context();
    delete ctx.packetDigests[entry.path];
    hasFailure(lib.validateReceipt(receipt, ctx), lib.REASONS.packet_digest_set_mismatch);
  }
});

test('stale or cross-context base, head, issue, and disposition deny', () => {
  for (const override of [
    { exactBaseSha: '0'.repeat(40) },
    { acceptedDocumentHeadSha: '6be9ed41a0f2d1eefbde68dece11fbb7457d187e' },
    { issue: 89 },
    { disposition: 'RELEASED' },
  ]) {
    hasFailure(lib.validateReceipt(receipt, context(override)), lib.REASONS.presentation_context_mismatch);
  }
});

test('substituted memo or document denies', () => {
  hasFailure(rejection((r) => { r.packet[0].path = r.packet[1].path; }), lib.REASONS.packet_binding_mismatch);
  hasFailure(rejection((r) => { r.packet[1].path = 'docs/future/remote-connector/fixtures/ks90-current-main-replay-receipt.json'; }), lib.REASONS.packet_binding_mismatch);
});

test('re-digested forgery denies even when receipt and caller context agree', () => {
  const forged = structuredClone(receipt);
  const forgedDigest = 'f'.repeat(64);
  forged.packet[0].sha256 = forgedDigest;
  const ctx = context();
  ctx.packetDigests[forged.packet[0].path] = forgedDigest;
  hasFailure(lib.validateReceipt(forged, ctx), lib.REASONS.packet_binding_mismatch);
});

test('replay with a complete but foreign digest context denies', () => {
  const ctx = context();
  ctx.packetDigests = Object.fromEntries(lib.PACKET.map(({ path }) => [path, 'a'.repeat(64)]));
  hasFailure(lib.validateReceipt(receipt, ctx), lib.REASONS.packet_digest_set_mismatch);
});

test('bearer or secret material anywhere in the receipt denies', () => {
  hasFailure(rejection((r) => { r.notes = `Bearer ${'A'.repeat(32)}`; }), lib.REASONS.live_material_present);
  hasFailure(rejection((r) => { r.notes = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(32)}`; }), lib.REASONS.live_material_present);
});

test('signature-as-execution-authority and permission claims deny', () => {
  hasFailure(rejection((r) => { r.authority.signature_is_execution_authority = true; }), lib.REASONS.signature_as_execution_authority);
  hasFailure(rejection((r) => { r.authority.execution_permission_granted = true; }), lib.REASONS.execution_permission_claimed);
  hasFailure(rejection((r) => { r.authority.receipt_is_command_or_permission = true; }), lib.REASONS.execution_permission_claimed);
});
