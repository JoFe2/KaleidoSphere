// CLI-01 (KaleidoSphere issue #196) — fail closed on unknown bin/bi commands.
//
// Focused subprocess regression for the shipped operator CLI dispatch contract:
// explicit help (no argument, `help`, `--help`) succeeds side-effect-free with one
// deterministic usage contract on stdout and nothing on stderr, and every unknown
// top-level command exits non-zero with a bounded, escaped diagnostic on stderr and
// nothing on stdout. Every case runs `bin/bi` from a minimal clean environment, so
// the help/unknown paths are proven to require no setup, Docker, network, credential,
// or runtime-state action.
//
// Nonclaim: this suite exercises only the top-level dispatch boundary. It does not
// execute the known command bodies (setup/up/analyze/...), does not start containers,
// and makes no production-compatibility claim.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '..');
const BI = path.join(ROOT, 'bin', 'bi');
const USAGE =
  'Usage: ./bin/bi {setup|up|analyze|ask "question"|search term|discovery ...|superset-fingerprint ...|promotion-bundle ...|status|logs [service]|down|reset --yes-i-understand}';

// Minimal clean environment: only PATH is provided, so a help/unknown invocation
// that attempted to reach docker, curl, openssl, or any credential-bearing variable
// would fail visibly instead of silently inheriting the worker environment.
const CLEAN_ENV = Object.freeze({ PATH: process.env.PATH ?? '/usr/bin:/bin' });

function runBi(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(BI, args, { cwd: ROOT, env: CLEAN_ENV });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => reject(error));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// The unknown-command diagnostic is a two-line stderr record: the KaleidoSphere ERROR
// line naming the rejected command, then the usage contract. Printable-ASCII-only with
// exactly these two newlines is the single-line, injection-free shape.
const DIAGNOSTIC_SHAPE = /^[\x20-\x7E]*\n[\x20-\x7E]*\n$/;

test('CLI-01-AC01: no-argument, help, and --help all exit 0 with the same stdout-only usage', async () => {
  const none = await runBi([]);
  assert.equal(none.status, 0, 'no-argument help must exit 0');
  assert.equal(none.stdout, `${USAGE}\n`);
  assert.equal(none.stderr, '');

  const help = await runBi(['help']);
  assert.equal(help.status, 0, '`help` must exit 0');
  assert.equal(help.stdout, none.stdout, '`help` must print the identical usage contract');
  assert.equal(help.stderr, '');

  const dashHelp = await runBi(['--help']);
  assert.equal(dashHelp.status, 0, '`--help` must exit 0');
  assert.equal(dashHelp.stdout, none.stdout, '`--help` must print the identical usage contract');
  assert.equal(dashHelp.stderr, '');
});

test('CLI-01-AC02: an unknown top-level command exits non-zero with a stderr-only diagnostic naming it and the usage', async () => {
  const result = await runBi(['definitely-not-a-command']);
  assert.notEqual(result.status, 0, 'unknown command must not report success');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '', 'unknown command must print nothing to stdout');
  assert.equal(
    result.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
  );

  const repeat = await runBi(['definitely-not-a-command']);
  assert.equal(repeat.stderr, result.stderr, 'diagnostic must be deterministic');
});

test('CLI-01-AC03: unknown-command handling is argument-safe and bounded for spaces, globs, dashes, and control characters', async () => {
  const cases = Object.freeze([
    ['foo bar', 'unknown command: "foo bar"'],
    ['a*b?[c]!', 'unknown command: "a*b?[c]!"'],
    ['--bogus-flag', 'unknown command: "--bogus-flag"'],
    ['-n', 'unknown command: "-n"'],
    ['$(reboot)', 'unknown command: "$(reboot)"'],
    ['`id`', 'unknown command: "`id`"'],
    ['back\\slash "quoted"', 'unknown command: "back\\\\slash \\"quoted\\""'],
    ['\u001b[2J\u001b[8m', 'unknown command: "\\x1b[2J\\x1b[8m"'],
    ['line1\nline2', 'unknown command: "line1\\x0aline2"'],
    ['tab\there', 'unknown command: "tab\\x09here"'],
    ['\u0001\u0002\u007f', 'unknown command: "\\x01\\x02\\x7f"'],
  ]);
  for (const [command, expectedLine] of cases) {
    const result = await runBi([command]);
    assert.notEqual(result.status, 0, `unknown command must fail: ${JSON.stringify(command)}`);
    assert.equal(result.stdout, '', `nothing to stdout: ${JSON.stringify(command)}`);
    assert.equal(
      result.stderr,
      `KaleidoSphere ERROR: ${expectedLine}\n${USAGE}\n`,
      `deterministic escaped diagnostic: ${JSON.stringify(command)}`,
    );
    assert.match(
      result.stderr,
      DIAGNOSTIC_SHAPE,
      `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(command)}`,
    );
  }
});

test('CLI-01-AC03: the diagnostic stays bounded for oversized arguments', async () => {
  const oversized = 'x'.repeat(5000);
  const result = await runBi([oversized]);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, `KaleidoSphere ERROR: unknown command: "${'x'.repeat(64)}"\n${USAGE}\n`);
  assert.ok(result.stderr.length < 512, `stderr must stay bounded, got ${result.stderr.length}`);
});

test('CLI-01-AC04: known-command dispatch and argument validation remain unchanged', async () => {
  // promotion-bundle validates its action before any setup, Docker, network, or
  // credential path, so its exact legacy validation is observable from a clean
  // environment without invoking the command body.
  const result = await runBi(['promotion-bundle']);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(
    result.stderr,
    'KaleidoSphere ERROR: usage: ./bin/bi promotion-bundle {build|inspect|preflight} ...\n',
  );

  // The unknown-command diagnostic is distinct from known-command validation, so
  // automation can tell an invalid top-level command from a missing sub-argument.
  const unknown = await runBi(['promotion-bundlez']);
  assert.notEqual(unknown.status, 0);
  assert.equal(unknown.stdout, '');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "promotion-bundlez"\n${USAGE}\n`,
  );
});