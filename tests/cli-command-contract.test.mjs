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
// Nonclaim: this suite exercises only the top-level dispatch boundary and the
// destructive reset argument boundary. It does not start containers, uses only a
// fake local docker executable and disposable synthetic sandbox state, and makes
// no production-compatibility claim.

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

// ---------------------------------------------------------------------------
// CLI-02 (KaleidoSphere issue #198) — the destructive reset boundary must fail
// closed on every malformed argument form.
//
// Every case runs a byte-identical copy of the shipped bin/bi from a disposable
// synthetic sandbox: a fresh mkdtemp directory (under the repository root, an
// executable filesystem, since the host tmp may be mounted noexec) holding the
// four documented owned .runtime directories seeded with sentinel top-level
// regular files, nested content, and a symlink; source config, an external
// .secrets entry, and unrelated paths that reset must never touch; and a fake
// `docker` executable first on PATH that only appends its argv to a local call
// log. Each sandbox is removed when its test finishes. No real Docker, network,
// credential, database, or productive state is reached.
// ---------------------------------------------------------------------------

const RESET_CONFIRMATION_DIAGNOSTIC =
  'KaleidoSphere ERROR: reset deletes only this repo runtime state; confirm with: ./bin/bi reset --yes-i-understand\n';
const RESET_SUCCESS_LINE =
  'Owned runtime metadata, projections, receipts, and generated internal secrets removed. Source config and external secret files retained.\n';

function buildResetSandbox({ configured = true } = {}) {
  const root = mkdtempSync(path.join(ROOT, '.bi-reset-sandbox-'));
  const fakeBin = path.join(root, 'fake-bin');
  const logPath = path.join(root, 'docker-calls.log');
  const owned = Object.freeze({
    metadata: path.join(root, '.runtime', 'metadata'),
    projection: path.join(root, '.runtime', 'projection'),
    receipts: path.join(root, '.runtime', 'receipts'),
    secrets: path.join(root, '.runtime', 'secrets'),
  });
  const externalSecretsDir = path.join(root, '.secrets');
  const sentinels = Object.freeze({
    metadataTop: path.join(owned.metadata, 'metadata-sentinel.json'),
    projectionTop: path.join(owned.projection, 'projection-sentinel.bin'),
    receiptsTop: path.join(owned.receipts, 'receipt-sentinel.json'),
    secretsTop: path.join(owned.secrets, 'internal-sentinel.txt'),
    controlToken: path.join(owned.secrets, 'control_token'),
    nestedDir: path.join(owned.metadata, 'nested'),
    nestedFile: path.join(owned.metadata, 'nested', 'inner.txt'),
    symlink: path.join(owned.receipts, 'nested-link'),
    sourceConfig: path.join(root, 'config', 'source-config.json'),
    dotEnv: path.join(root, '.env'),
    externalSecret: path.join(externalSecretsDir, 'mssql_password'),
    runtimeStray: path.join(root, '.runtime', 'stray.txt'),
    unrelatedRoot: path.join(root, 'README-sentinel.md'),
  });
  for (const directory of Object.values(owned)) mkdirSync(directory, { recursive: true });
  mkdirSync(fakeBin);
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  mkdirSync(path.dirname(sentinels.sourceConfig), { recursive: true });
  mkdirSync(externalSecretsDir, { recursive: true });
  // Nested content and a symlink inside owned directories: reset deletes only
  // top-level regular files, so nested entries and non-regular entries survive.
  mkdirSync(sentinels.nestedDir);
  writeFileSync(sentinels.nestedFile, 'nested synthetic content\n');
  symlinkSync(sentinels.nestedFile, sentinels.symlink);
  // Top-level regular-file sentinels: the only entries a valid reset removes.
  writeFileSync(sentinels.metadataTop, '{}\n');
  writeFileSync(sentinels.projectionTop, 'projection-sentinel\n');
  writeFileSync(sentinels.receiptsTop, '{}\n');
  writeFileSync(sentinels.secretsTop, 'internal sentinel\n');
  // Preserve-target sentinels outside the owned top-level regular-file surface.
  writeFileSync(sentinels.sourceConfig, '{ "source": true }\n');
  writeFileSync(sentinels.runtimeStray, 'stray\n');
  writeFileSync(sentinels.unrelatedRoot, 'unrelated\n');
  if (configured) {
    writeFileSync(sentinels.dotEnv, 'SYNTHETIC=1\n');
    writeFileSync(sentinels.controlToken, '0123456789abcdef\n');
    writeFileSync(sentinels.externalSecret, '');
    // require_setup demands mode 0600 on every existing secret file.
    for (const directory of [owned.secrets, externalSecretsDir]) {
      for (const entry of readdirSync(directory)) {
        chmodSync(path.join(directory, entry), 0o600);
      }
    }
  }
  // The fake docker recorder: one line of joined argv per invocation, nothing
  // else. It shadows any real docker because fake-bin is first on PATH.
  const dockerPath = path.join(fakeBin, 'docker');
  writeFileSync(
    dockerPath,
    `#!/bin/sh\n{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\nexit 0\n`,
  );
  chmodSync(dockerPath, 0o755);
  // Run the exact shipped script bytes from inside the sandbox so bi_here is
  // the disposable sandbox root, never this repository.
  const biPath = path.join(root, 'bin', 'bi');
  writeFileSync(biPath, readFileSync(path.join(ROOT, 'bin', 'bi')));
  chmodSync(biPath, 0o755);
  return Object.freeze({
    root,
    logPath,
    sentinels,
    deleteAll: () => rmSync(root, { recursive: true, force: true }),
  });
}

function runBiInSandbox(sandbox, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(sandbox.root, 'bin', 'bi'), args, {
      cwd: sandbox.root,
      env: Object.freeze({
        PATH: `${path.join(sandbox.root, 'fake-bin')}${path.delimiter}/usr/bin:/bin`,
      }),
    });
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

function dockerCalls(sandbox) {
  if (!existsSync(sandbox.logPath)) return [];
  return readFileSync(sandbox.logPath, 'utf8').split('\n').filter((line) => line.length > 0);
}

function deletedSentinels(sandbox) {
  return Object.entries(sandbox.sentinels)
    .filter(([, file]) => !existsSync(file))
    .map(([name]) => name);
}

test('CLI-02-AC01: a trailing argument after the exact confirmation flag fails closed with zero compose calls', async (t) => {
  const sandbox = buildResetSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  const observation = `exit ${result.status}, composeCalls=${JSON.stringify(
    dockerCalls(sandbox),
  )}, deletedSentinels=${JSON.stringify(deletedSentinels(sandbox))}`;
  assert.equal(
    result.status,
    1,
    `trailing reset argument must fail closed before the mutation boundary, observed: ${observation}`,
  );
  assert.equal(result.stdout, '', 'nothing to stdout on a failed reset');
  assert.equal(result.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the existing deterministic confirmation diagnostic');
  assert.deepEqual(dockerCalls(sandbox), [], `zero Compose calls, observed: ${observation}`);
  assert.deepEqual(deletedSentinels(sandbox), [], `every sandbox sentinel must survive, ${observation}`);
});

test('CLI-02-AC02: missing, wrong, non-byte-exact, or extra reset arguments all fail closed with the same diagnostic', async (t) => {
  const forms = Object.freeze([
    Object.freeze(['reset']),
    Object.freeze(['reset', '--no']),
    Object.freeze(['reset', 'yes']),
    Object.freeze(['reset', '--YES-i-understand']),
    Object.freeze(['reset', 'extra', '--yes-i-understand']),
    Object.freeze(['reset', '--yes-i-understand', '--typo']),
    Object.freeze(['reset', '--yes-i-understand', 'extra']),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const form of forms) {
    const sandbox = buildResetSandbox();
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, form);
    const observation = `exit ${result.status}, composeCalls=${JSON.stringify(
      dockerCalls(sandbox),
    )}, deletedSentinels=${JSON.stringify(deletedSentinels(sandbox))}`;
    assert.equal(result.status, 1, `${JSON.stringify(form)} must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${JSON.stringify(form)}: nothing to stdout`);
    assert.equal(
      result.stderr,
      RESET_CONFIRMATION_DIAGNOSTIC,
      `${JSON.stringify(form)}: the existing deterministic confirmation diagnostic`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero Compose calls, ${observation}`);
    assert.deepEqual(deletedSentinels(sandbox), [], `${JSON.stringify(form)}: sentinels must survive, ${observation}`);
  }
});

test('CLI-02-AC03: the exact valid form retains bounded existing behavior: one compose down, owned top-level regular files only', async (t) => {
  const sandbox = buildResetSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['reset', '--yes-i-understand']);
  assert.equal(result.status, 0, `valid reset must exit 0, stderr=${JSON.stringify(result.stderr)}`);
  assert.equal(result.stderr, '', 'nothing to stderr on a successful reset');
  assert.equal(result.stdout, RESET_SUCCESS_LINE, 'the existing deterministic success line');
  assert.deepEqual(
    dockerCalls(sandbox),
    [`docker compose --file ${sandbox.root}/compose.yaml down --remove-orphans`],
    'exactly one repository-scoped compose down call',
  );
  // Only top-level regular files in the four documented owned directories are
  // removed (including the generated internal control token).
  for (const name of ['metadataTop', 'projectionTop', 'receiptsTop', 'secretsTop', 'controlToken']) {
    assert.equal(existsSync(sandbox.sentinels[name]), false, `${name} must be removed`);
  }
  // Nested content, symlinks and other non-regular entries, source config, the
  // external .secrets entry, and unrelated paths all survive.
  for (const name of ['nestedDir', 'nestedFile', 'symlink', 'sourceConfig', 'dotEnv', 'externalSecret', 'runtimeStray', 'unrelatedRoot']) {
    assert.equal(existsSync(sandbox.sentinels[name]), true, `${name} must be preserved`);
  }
});

test('CLI-02-AC04: malformed reset arguments fail with the confirmation diagnostic before require_setup', async (t) => {
  // An unconfigured sandbox (no .env, no control token) proves the arity and
  // confirmation gate runs before any setup check: a malformed reset must
  // report the confirmation diagnostic, never the setup diagnostic.
  const sandbox = buildResetSandbox({ configured: false });
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['reset', '--typo']);
  assert.equal(result.status, 1, 'malformed reset must fail non-zero');
  assert.equal(result.stdout, '', 'nothing to stdout');
  assert.equal(result.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'confirmation gate must precede require_setup');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero Compose calls');
});
