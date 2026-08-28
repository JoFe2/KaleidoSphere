import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { classify } from '../../scripts/release/k4c-delivery-readback.mjs';

const root = path.resolve(import.meta.dirname, '..', '..');
const script = path.join(root, 'scripts/release/k4c-delivery-readback.mjs');
const fixture = path.join(root, 'tests/fixtures/release/k4c-delivery-readback-v1.json');
const committedReceipt = path.join(root, 'verification/k4c/delivery-readback-v1.json');
const schema = path.join(root, 'docs/release/k4c-resume-action-schema-v1.json');
const OWNER_RESUME_ACTION = 'Owner resumes in the official portal UI to verify owner authority and publisher identity.';

function run(args = []) {
  return spawnSync(process.execPath, ['--jitless', script, ...args], { cwd: root, encoding: 'utf8' });
}

function receipt(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return JSON.parse(result.stdout);
}

async function fixtureVariant(mutate) {
  const directory = await mkdtemp(path.join(tmpdir(), 'ks76-delivery-readback-'));
  const value = JSON.parse(await readFile(fixture, 'utf8'));
  mutate(value);
  const file = path.join(directory, 'fixture.json');
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function assertFailedClosed(result, name) {
  if (result.status !== 0) return;
  const value = JSON.parse(result.stdout);
  assert.equal(value.disposition, 'REJECTED_WITH_EVIDENCE', name);
  assert.deepEqual(value.resumeActions, [], name);
  assert.equal(value.evidence.length, 1, name);
}

test('complete same-digest fresh four-receipt set reproduces the committed RELEASED receipt byte-for-byte', async () => {
  const result = run(['--fixture', fixture, '--dry-run']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, await readFile(committedReceipt, 'utf8'));
  const value = JSON.parse(result.stdout);
  assert.equal(value.disposition, 'RELEASED');
  assert.equal(value.terminalDisposition, 'RELEASED');
  assert.deepEqual(value.resumeActions, []);
  assert.deepEqual(Object.keys(value.inputDigests), ['local', 'portal', 'anonymous', 'terminal']);
  for (const input of Object.values(value.inputDigests)) {
    assert.equal(input.sha256, input.observed_sha256);
    assert.equal(input.task_id, value.task.id);
    assert.equal(input.issue_id, value.task.issue);
  }
});

test('missing owner portal authority state has exactly one literal owner resume action', () => {
  const output = classify({ disposition: 'NOT_RELEASED' }, { disposition: 'NOT_SUBMITTED' });
  assert.equal(output.disposition, 'NOT_RELEASED');
  assert.deepEqual(output.resumeActions, [OWNER_RESUME_ACTION]);
  assert.equal(output.resumeActions.length, 1);
});

test('state transition table and freshness policy are encoded in the schema and match the pure transition', async () => {
  const document = JSON.parse(await readFile(schema, 'utf8'));
  assert.equal(document.additionalProperties, false);
  assert.equal(document.properties.generated_at['x-normalization'], 'canonical UTC ISO-8601 string; comparison may normalize this field only');
  assert.equal(document.freshnessPolicy.maximumWindowMilliseconds, 86_400_000);
  assert.equal(document.freshnessPolicy.noncesMustBeUnique, true);
  assert.equal(document.stateTransitionTable.length, 3);
  assert.deepEqual(classify({ disposition: 'RELEASED' }, { disposition: 'PRECHECK_READY' }).resumeActions, []);
  assert.throws(() => classify({ disposition: 'RELEASED' }, { disposition: 'NOT_SUBMITTED' }), /disagree/);
});

test('fails closed for missing input, malformed schema, task/issue mismatch, digest drift, stale/replayed freshness, and unsupported claims', async () => {
  const cases = [
    ['missing input', (value) => { delete value.inputs.local; }],
    ['malformed schema', (value) => { value.inputs.local.schemaVersion = 'invalid'; }],
    ['task mismatch', (value) => { value.inputs.portal.task_id = 'INT-OTHER'; }],
    ['digest drift', (value) => { value.inputs.terminal.sha256 = '0'.repeat(64); }],
    ['stale freshness', (value) => { value.inputs.anonymous.freshness.expires_at = '2026-08-28T18:05:00.000Z'; }],
    ['replayed freshness', (value) => { value.inputs.terminal.freshness.nonce = value.inputs.local.freshness.nonce; }],
    ['unsupported release claim', (value) => { value.requestedRelease = 'deliver-now'; }],
  ];
  for (const [name, mutate] of cases) {
    const file = await fixtureVariant(mutate);
    const result = run(['--fixture', file, '--dry-run']);
    assertFailedClosed(result, `${name}: ${result.stdout}\n${result.stderr}`);
  }
});

test('fails closed for anonymous/authenticated substitution, classifier disagreement, multiple actions, secret-like fields, and network-shaped input', async () => {
  const cases = [
    ['anonymous authenticated substitution', (value) => { value.inputs.anonymous.provenance = 'authenticated-directory'; }],
    ['classifier/readback disagreement', (value) => { value.expectedTerminalDisposition = 'NOT_RELEASED'; }],
    ['multiple actions', (value) => { value.inputs.portal.resumeActions = [OWNER_RESUME_ACTION, OWNER_RESUME_ACTION]; }],
    ['secret-like field', (value) => { value.inputs.local.token = 'do-not-print'; }],
    ['network attempt', (value) => { value.inputs.local.url = 'https://example.invalid'; }],
  ];
  for (const [name, mutate] of cases) {
    const file = await fixtureVariant(mutate);
    const result = run(['--fixture', file, '--dry-run']);
    assertFailedClosed(result, `${name}: ${result.stdout}\n${result.stderr}`);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /do-not-print/);
  }
  const source = await readFile(script, 'utf8');
  assert.doesNotMatch(source, /node:(?:http|https|net)|fetch\s*\(|node:child_process|spawn\s*\(|execFile\s*\(|setInterval\s*\(/);
});

test('rejected/released transitions contain no resume action', () => {
  assert.deepEqual(classify({ disposition: 'RELEASED' }, { disposition: 'PRECHECK_READY' }).resumeActions, []);
  assert.deepEqual(classify({ disposition: 'REJECTED_WITH_EVIDENCE' }, { disposition: 'PRECHECK_READY' }).resumeActions, []);
});
