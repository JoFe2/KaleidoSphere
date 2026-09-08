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
// destructive reset, down, state-changing up, state-changing setup,
// request-bearing analyze, request-bearing ask and search operand, read-only
// status, read-only logs, and zero-payload discovery argument boundaries. It
// does not start containers, uses only fake local stat, docker, openssl, and
// curl executables, and disposable synthetic sandbox state, and makes no
// production-compatibility claim.

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
  statSync,
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

function buildResetSandbox({ configured = true, respondToPort = false } = {}) {
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
  // else. It shadows any real docker because fake-bin is first on PATH. In
  // port-responding mode it additionally answers `compose port <service>
  // <port>` with a deterministic 127.0.0.1:<port> binding, modeling a healthy
  // local daemon so the exact valid up path is observable end-to-end.
  const dockerPath = path.join(fakeBin, 'docker');
  const dockerScript =
    `#!/bin/sh\n` +
    `{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\n` +
    (respondToPort ? `case "$4" in port) printf '127.0.0.1:%s\\n' "$6" ;; esac\n` : '') +
    'exit 0\n';
  writeFileSync(dockerPath, dockerScript);
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

// ---------------------------------------------------------------------------
// CLI-03 (KaleidoSphere issue #200) — the destructive down boundary must fail
// closed on every trailing argument form.
//
// down takes no arguments. Every case runs the same byte-identical disposable
// synthetic sandbox machinery as CLI-02: a fresh mkdtemp directory holding a
// copy of the shipped bin/bi, the documented owned .runtime sentinels, optional
// valid-looking setup sentinels (.env plus a mode-0600 control token), and a
// fake `docker` executable first on PATH that only appends its argv to a local
// call log. Each sandbox is removed when its test finishes. No real Docker,
// network, credential, database, or productive state is reached.
// ---------------------------------------------------------------------------

const DOWN_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi down\n';
// The usage diagnostic is a single-line stderr record: printable ASCII only and
// terminated by exactly one newline, so it is single-line and injection-free.
const DOWN_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;

test('CLI-03-AC01: a trailing argument after down fails closed with zero compose calls even with valid-looking setup sentinels', async (t) => {
  // A configured sandbox carries valid-looking setup sentinels (a synthetic
  // .env and a mode-0600 control token), so a trailing argument must be
  // rejected by the arity gate alone, never by passing into require_setup and
  // then Compose.
  const sandbox = buildResetSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['down', '--typo']);
  const observation = `exit ${result.status}, composeCalls=${JSON.stringify(
    dockerCalls(sandbox),
  )}, deletedSentinels=${JSON.stringify(deletedSentinels(sandbox))}`;
  assert.equal(
    result.status,
    1,
    `trailing down argument must fail closed before the shutdown boundary, observed: ${observation}`,
  );
  assert.equal(result.stdout, '', 'nothing to stdout on a failed down');
  assert.equal(result.stderr, DOWN_USAGE_DIAGNOSTIC, 'the deterministic bounded usage diagnostic');
  assert.match(result.stderr, DOWN_USAGE_DIAGNOSTIC_SHAPE, 'stderr stays printable ASCII with no control-byte injection');
  assert.ok(result.stderr.length < 512, `stderr must stay bounded, got ${result.stderr.length}`);
  assert.deepEqual(dockerCalls(sandbox), [], `zero Compose calls, observed: ${observation}`);
  assert.deepEqual(deletedSentinels(sandbox), [], `every sandbox sentinel must survive, ${observation}`);
});

test('CLI-03-AC02: option-looking, empty, whitespace, control-byte, and oversized trailing arguments all fail closed with the same diagnostic', async (t) => {
  const forms = Object.freeze([
    Object.freeze(['down', '--typo']),
    Object.freeze(['down', '--remove-orphans']),
    Object.freeze(['down', '-n']),
    Object.freeze(['down', '']),
    Object.freeze(['down', ' ']),
    Object.freeze(['down', '\u001b[2J\u001b[8m']),
    Object.freeze(['down', 'line1\nline2']),
    Object.freeze(['down', 'x'.repeat(5000)]),
    Object.freeze(['down', 'extra', 'more']),
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
      DOWN_USAGE_DIAGNOSTIC,
      `${JSON.stringify(form)}: the deterministic bounded usage diagnostic`,
    );
    assert.match(
      result.stderr,
      DOWN_USAGE_DIAGNOSTIC_SHAPE,
      `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(form)}`,
    );
    assert.ok(
      result.stderr.length < 512,
      `${JSON.stringify(form)}: stderr must stay bounded, got ${result.stderr.length}`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero Compose calls, ${observation}`);
    assert.deepEqual(deletedSentinels(sandbox), [], `${JSON.stringify(form)}: sentinels must survive, ${observation}`);
  }
});

test('CLI-03-AC03: the exact valid form retains bounded existing behavior: one compose down call, exit 0, no mutation', async (t) => {
  const sandbox = buildResetSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['down']);
  assert.equal(result.status, 0, `valid down must exit 0, stderr=${JSON.stringify(result.stderr)}`);
  assert.equal(result.stdout, '', 'nothing to stdout on a successful down');
  assert.equal(result.stderr, '', 'nothing to stderr on a successful down');
  assert.deepEqual(
    dockerCalls(sandbox),
    [`docker compose --file ${sandbox.root}/compose.yaml down --remove-orphans`],
    'exactly one repository-scoped compose down call',
  );
  // down must stop services only: no sandbox sentinel is deleted or touched.
  assert.deepEqual(deletedSentinels(sandbox), [], 'every sandbox sentinel must survive a successful down');
});

test('CLI-03-AC04: the down arity gate fails with the usage diagnostic before require_setup', async (t) => {
  // An unconfigured sandbox (no .env, no control token) proves the arity gate
  // runs before any setup check: a malformed down must report the usage
  // diagnostic, never the setup diagnostic.
  const sandbox = buildResetSandbox({ configured: false });
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['down', '--typo']);
  assert.equal(result.status, 1, 'malformed down must fail non-zero');
  assert.equal(result.stdout, '', 'nothing to stdout');
  assert.equal(result.stderr, DOWN_USAGE_DIAGNOSTIC, 'arity gate must precede require_setup');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero Compose calls');
});

// ---------------------------------------------------------------------------
// CLI-04 (KaleidoSphere issue #202) — the state-changing up boundary must fail
// closed on every trailing argument form.
//
// up takes no arguments. Every case runs the same byte-identical disposable
// synthetic sandbox machinery as CLI-02/CLI-03: a fresh mkdtemp directory
// holding a copy of the shipped bin/bi, the documented owned .runtime
// sentinels, optional valid-looking setup sentinels (.env plus a mode-0600
// control token), and a fake `docker` executable first on PATH that only
// appends its argv to a local call log. The up cases additionally run the fake
// docker in port-responding mode, where it answers `compose port <service>
// <port>` with a deterministic 127.0.0.1:<port> binding, so the exact valid
// startup path is observable end-to-end without a real daemon. Each sandbox is
// removed when its test finishes. No real Docker, network, credential,
// database, or productive state is reached.
// ---------------------------------------------------------------------------

const UP_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi up\n';
// The usage diagnostic is a single-line stderr record: printable ASCII only and
// terminated by exactly one newline, so it is single-line and injection-free.
const UP_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;
const UP_SUCCESS_OUTPUT =
  'Superset: http://127.0.0.1:8088\nKaleidoSphere: http://127.0.0.1:18790\n';

test('CLI-04-AC01: every trailing up argument form fails closed with one deterministic bounded printable diagnostic and zero docker calls', async (t) => {
  // Configured sandboxes carry valid-looking setup sentinels (a synthetic .env
  // and a mode-0600 control token), so every form must be rejected by the
  // zero-option arity gate alone — never by passing into require_setup and
  // then the Compose startup/build boundary.
  const forms = Object.freeze([
    Object.freeze(['up', '--typo']),
    Object.freeze(['up', '--build']),
    Object.freeze(['up', '--detach']),
    Object.freeze(['up', '-n']),
    Object.freeze(['up', '']),
    Object.freeze(['up', ' ']),
    Object.freeze(['up', '\u001b[2J\u001b[8m']),
    Object.freeze(['up', 'line1\nline2']),
    Object.freeze(['up', 'x'.repeat(5000)]),
    Object.freeze(['up', 'extra', 'more']),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const form of forms) {
    const sandbox = buildResetSandbox({ respondToPort: true });
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, form);
    const observation = `exit ${result.status}, stderr=${JSON.stringify(
      result.stderr,
    )}, dockerCalls=${JSON.stringify(dockerCalls(sandbox))}, deletedSentinels=${JSON.stringify(
      deletedSentinels(sandbox),
    )}`;
    assert.equal(result.status, 1, `${JSON.stringify(form)} must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${JSON.stringify(form)}: nothing to stdout`);
    assert.equal(
      result.stderr,
      UP_USAGE_DIAGNOSTIC,
      `${JSON.stringify(form)}: the deterministic bounded usage diagnostic`,
    );
    assert.match(
      result.stderr,
      UP_USAGE_DIAGNOSTIC_SHAPE,
      `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(form)}`,
    );
    assert.ok(
      result.stderr.length < 512,
      `${JSON.stringify(form)}: stderr must stay bounded, got ${result.stderr.length}`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero Docker calls, ${observation}`);
    assert.deepEqual(deletedSentinels(sandbox), [], `${JSON.stringify(form)}: sentinels must survive, ${observation}`);
  }
});

test('CLI-04-AC02: the up arity gate rejects before require_setup, Compose, build/start/wait, or port lookup, with zero fake-Docker calls in configured and unconfigured sandboxes', async (t) => {
  // A configured sandbox proves the gate is the arity gate (the exact usage
  // diagnostic, never a setup or port diagnostic) while valid-looking setup
  // sentinels are present; an unconfigured sandbox (no .env, no control token)
  // proves the arity gate runs before any setup check: a malformed up must
  // report the usage diagnostic, never the setup diagnostic.
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    const sandbox = buildResetSandbox({ configured, respondToPort: true });
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, ['up', '--typo']);
    const observation = `configured=${configured}, exit ${result.status}, stderr=${JSON.stringify(
      result.stderr,
    )}, dockerCalls=${JSON.stringify(dockerCalls(sandbox))}`;
    assert.equal(result.status, 1, `malformed up must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${observation}: nothing to stdout`);
    assert.equal(
      result.stderr,
      UP_USAGE_DIAGNOSTIC,
      `${observation}: the arity gate must precede require_setup, Compose, and port lookup`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${observation}: zero fake-Docker calls`);
  }
});

test('CLI-04-AC03: the exact valid up retains one repository-scoped startup call, the two expected port lookups, deterministic endpoint output, and a successful exit with no real effects', async (t) => {
  const sandbox = buildResetSandbox({ respondToPort: true });
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['up']);
  assert.equal(result.status, 0, `valid up must exit 0, stderr=${JSON.stringify(result.stderr)}`);
  assert.equal(result.stderr, '', 'nothing to stderr on a successful up');
  assert.equal(result.stdout, UP_SUCCESS_OUTPUT, 'the deterministic endpoint output');
  assert.deepEqual(
    dockerCalls(sandbox),
    [
      `docker compose --file ${sandbox.root}/compose.yaml up --detach --build --wait`,
      `docker compose --file ${sandbox.root}/compose.yaml port superset 8088`,
      `docker compose --file ${sandbox.root}/compose.yaml port bi-agent 18790`,
    ],
    'exactly one repository-scoped startup call followed by the two expected port lookups',
  );
  // up must start services only: the fake docker is the only docker reached
  // and no sandbox sentinel is deleted or touched.
  assert.deepEqual(deletedSentinels(sandbox), [], 'every sandbox sentinel must survive a successful up');
});

test('CLI-04-AC04: the up arity gate leaves the prior #196/#198/#200 boundaries byte-exact in the same sandbox machinery', async (t) => {
  // The port-responding sandbox variant must not perturb any other boundary:
  // #196 unknown-command dispatch, #198 exact reset confirmation, and #200
  // exact down arity all keep their byte-exact behavior and zero docker calls.
  const sandbox = buildResetSandbox({ respondToPort: true });
  t.after(sandbox.deleteAll);
  const down = await runBiInSandbox(sandbox, ['down', '--typo']);
  assert.equal(down.status, 1, 'trailing down argument must still fail non-zero');
  assert.equal(down.stderr, DOWN_USAGE_DIAGNOSTIC, 'the unchanged down usage diagnostic');
  const reset = await runBiInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  assert.equal(reset.status, 1, 'trailing reset argument must still fail non-zero');
  assert.equal(reset.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the unchanged reset confirmation diagnostic');
  const unknown = await runBiInSandbox(sandbox, ['definitely-not-a-command']);
  assert.equal(unknown.status, 1, 'unknown command must still fail non-zero');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
    'the unchanged unknown-command diagnostic',
  );
  assert.deepEqual(dockerCalls(sandbox), [], 'zero fake-Docker calls across the preserved boundaries');
});

// ---------------------------------------------------------------------------
// CLI-05 (KaleidoSphere issue #204) — the state-changing setup boundary must
// fail closed on every trailing argument form.
//
// setup takes no arguments. Every case runs a fresh disposable synthetic
// sandbox: a new mkdtemp directory holding a byte-identical copy of the
// shipped bin/bi, an optional synthetic .env, and two fake executables first
// on PATH — a `docker` recorder that only appends its argv to a local call
// log, and an `openssl` recorder that appends its argv and prints a
// deterministic synthetic payload for `rand`, so secret generation is
// observable end-to-end without real randomness. Each sandbox is removed when
// its test finishes. No real Docker, OpenSSL randomness, network, credential,
// database, or productive state is reached.
// ---------------------------------------------------------------------------

const SETUP_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi setup\n';
// The usage diagnostic is a single-line stderr record: printable ASCII only
// and terminated by exactly one newline, so it is single-line and
// injection-free.
const SETUP_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;
const SETUP_SUCCESS_OUTPUT = 'Setup complete. Runtime secrets stay in gitignored files.\n';
// The seven synthetic secret files the exact setup creates, in documented
// order: four internal runtime secrets (two hex, two base64) and three
// empty external connector secrets.
const SETUP_SECRET_FILES = Object.freeze([
  '.runtime/secrets/superset_secret_key',
  '.runtime/secrets/superset_admin_password',
  '.runtime/secrets/superset_analyst_password',
  '.runtime/secrets/control_token',
  '.secrets/mssql_password',
  '.secrets/oracle_password',
  '.secrets/llm_api_key',
]);
// Every runtime/secret path the setup branch is allowed to create: the six
// documented 0700 directories plus the seven secret files above.
const SETUP_CREATED_PATHS = Object.freeze([
  '.runtime',
  '.runtime/secrets',
  '.runtime/metadata',
  '.runtime/projection',
  '.runtime/receipts',
  '.secrets',
  ...SETUP_SECRET_FILES,
]);

function buildSetupSandbox({ configured = true } = {}) {
  const root = mkdtempSync(path.join(ROOT, '.bi-setup-sandbox-'));
  const fakeBin = path.join(root, 'fake-bin');
  const logPath = path.join(root, 'docker-calls.log');
  const opensslLogPath = path.join(root, 'openssl-calls.log');
  mkdirSync(fakeBin);
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  if (configured) writeFileSync(path.join(root, '.env'), 'SYNTHETIC=1\n');
  // The fake docker recorder: one line of joined argv per invocation, nothing
  // else. It shadows any real docker because fake-bin is first on PATH.
  const dockerPath = path.join(fakeBin, 'docker');
  const dockerScript =
    `#!/bin/sh\n` +
    `{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\n` +
    'exit 0\n';
  writeFileSync(dockerPath, dockerScript);
  chmodSync(dockerPath, 0o755);
  // The fake openssl recorder: logs the same way and answers `rand` on stdout
  // with a deterministic synthetic payload, so the documented hex/base64
  // secret generation is observable without real randomness.
  const opensslPath = path.join(fakeBin, 'openssl');
  const opensslScript =
    `#!/bin/sh\n` +
    `{ printf 'openssl'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${opensslLogPath}'\n` +
    'if [ "$1" = rand ]; then\n' +
    '  case "$2" in\n' +
    "    -hex) printf '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\\n' ;;\n" +
    "    -base64) printf 'c3ludGhldGljLXNlY3JldA==\\n' ;;\n" +
    '  esac\n' +
    'fi\n' +
    'exit 0\n';
  writeFileSync(opensslPath, opensslScript);
  chmodSync(opensslPath, 0o755);
  // Run the exact shipped script bytes from inside the sandbox so bi_here is
  // the disposable sandbox root, never this repository.
  const biPath = path.join(root, 'bin', 'bi');
  writeFileSync(biPath, readFileSync(path.join(ROOT, 'bin', 'bi')));
  chmodSync(biPath, 0o755);
  return Object.freeze({
    root,
    logPath,
    opensslLogPath,
    dotEnv: path.join(root, '.env'),
    deleteAll: () => rmSync(root, { recursive: true, force: true }),
  });
}

function opensslCalls(sandbox) {
  if (!existsSync(sandbox.opensslLogPath)) return [];
  return readFileSync(sandbox.opensslLogPath, 'utf8').split('\n').filter((line) => line.length > 0);
}

function setupCreatedPaths(sandbox) {
  return SETUP_CREATED_PATHS.filter((entry) => existsSync(path.join(sandbox.root, entry)));
}

test('CLI-05-AC01: every trailing setup argument form fails closed with one deterministic bounded printable diagnostic, empty stdout, zero fake-Docker and fake-OpenSSL calls, and zero setup-created runtime/secret paths even with a synthetic .env present', async (t) => {
  // Configured sandboxes carry a synthetic .env, so every form must be
  // rejected by the zero-option arity gate alone — never by passing into the
  // .env check and then the Docker/OpenSSL, daemon/Compose preflight,
  // directory creation, chmod, or secret-generation boundary.
  const forms = Object.freeze([
    Object.freeze(['setup', '--typo']),
    Object.freeze(['setup', '--force']),
    Object.freeze(['setup', '-n']),
    Object.freeze(['setup', '']),
    Object.freeze(['setup', ' ']),
    Object.freeze(['setup', '\u001b[2J\u001b[8m']),
    Object.freeze(['setup', 'line1\nline2']),
    Object.freeze(['setup', 'x'.repeat(5000)]),
    Object.freeze(['setup', 'extra', 'more']),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const form of forms) {
    const sandbox = buildSetupSandbox();
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, form);
    const observation = `exit ${result.status}, stderr=${JSON.stringify(
      result.stderr,
    )}, dockerCalls=${JSON.stringify(dockerCalls(sandbox))}, opensslCalls=${JSON.stringify(
      opensslCalls(sandbox),
    )}, setupCreatedPaths=${JSON.stringify(setupCreatedPaths(sandbox))}`;
    assert.equal(result.status, 1, `${JSON.stringify(form)} must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${JSON.stringify(form)}: nothing to stdout`);
    assert.equal(
      result.stderr,
      SETUP_USAGE_DIAGNOSTIC,
      `${JSON.stringify(form)}: the deterministic bounded usage diagnostic`,
    );
    assert.match(
      result.stderr,
      SETUP_USAGE_DIAGNOSTIC_SHAPE,
      `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(form)}`,
    );
    assert.ok(
      result.stderr.length < 512,
      `${JSON.stringify(form)}: stderr must stay bounded, got ${result.stderr.length}`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-Docker calls, ${observation}`);
    assert.deepEqual(opensslCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-OpenSSL calls, ${observation}`);
    assert.deepEqual(setupCreatedPaths(sandbox), [], `${JSON.stringify(form)}: zero setup-created runtime/secret paths, ${observation}`);
    assert.equal(existsSync(sandbox.dotEnv), true, `${JSON.stringify(form)}: the synthetic .env must be preserved`);
  }
});

test('CLI-05-AC02: the setup arity gate rejects before the .env check, the Docker/OpenSSL checks, and the daemon/Compose preflight, with zero tool calls in configured and unconfigured sandboxes', async (t) => {
  // A configured sandbox proves the gate is the arity gate (the exact usage
  // diagnostic, never the setup, Docker, or OpenSSL diagnostic) while a
  // valid-looking synthetic .env is present; an unconfigured sandbox (no
  // .env) proves the arity gate runs before any setup check: a malformed
  // setup must report the usage diagnostic, never the setup diagnostic.
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    const sandbox = buildSetupSandbox({ configured });
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, ['setup', '--typo']);
    const observation = `configured=${configured}, exit ${result.status}, stderr=${JSON.stringify(
      result.stderr,
    )}, dockerCalls=${JSON.stringify(dockerCalls(sandbox))}, opensslCalls=${JSON.stringify(
      opensslCalls(sandbox),
    )}`;
    assert.equal(result.status, 1, `malformed setup must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${observation}: nothing to stdout`);
    assert.equal(
      result.stderr,
      SETUP_USAGE_DIAGNOSTIC,
      `${observation}: the arity gate must precede the .env check, the Docker/OpenSSL checks, and the preflight`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${observation}: zero fake-Docker calls`);
    assert.deepEqual(opensslCalls(sandbox), [], `${observation}: zero fake-OpenSSL calls`);
    assert.deepEqual(setupCreatedPaths(sandbox), [], `${observation}: zero setup-created runtime/secret paths`);
  }
});

test('CLI-05-AC03: the exact valid setup retains the bounded existing behavior: the exact preflight/config calls, the documented directories and modes, the seven synthetic 0600 secret files, the deterministic success output, and a successful exit', async (t) => {
  const sandbox = buildSetupSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['setup']);
  assert.equal(result.status, 0, `valid setup must exit 0, stderr=${JSON.stringify(result.stderr)}`);
  assert.equal(result.stderr, '', 'nothing to stderr on a successful setup');
  assert.equal(result.stdout, SETUP_SUCCESS_OUTPUT, 'the deterministic success output');
  assert.deepEqual(
    dockerCalls(sandbox),
    [
      'docker info',
      'docker compose version',
      `docker compose --file ${sandbox.root}/compose.yaml config --quiet`,
    ],
    'exactly the daemon check, the Compose v2 check, and one repository-scoped compose config call',
  );
  for (const entry of [
    '.runtime',
    '.runtime/secrets',
    '.runtime/metadata',
    '.runtime/projection',
    '.runtime/receipts',
    '.secrets',
  ]) {
    assert.equal(
      statSync(path.join(sandbox.root, entry)).mode & 0o777,
      0o700,
      `${entry} must be mode 0700`,
    );
  }
  for (const file of SETUP_SECRET_FILES) {
    assert.equal(
      statSync(path.join(sandbox.root, file)).mode & 0o777,
      0o600,
      `${file} must be mode 0600`,
    );
  }
  assert.equal(existsSync(sandbox.dotEnv), true, 'the synthetic .env must be preserved');
});

test('CLI-05-AC04: the exact valid setup performs exactly the four expected fake-OpenSSL rand calls in documented order, with no other OpenSSL form and no real randomness', async (t) => {
  const sandbox = buildSetupSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['setup']);
  assert.equal(result.status, 0, `valid setup must exit 0, stderr=${JSON.stringify(result.stderr)}`);
  assert.deepEqual(
    opensslCalls(sandbox),
    [
      'openssl rand -hex 32',
      'openssl rand -base64 32',
      'openssl rand -base64 32',
      'openssl rand -hex 32',
    ],
    'exactly two hex and two base64 rand calls in the documented secret order',
  );
});

test('CLI-05-AC05: the setup arity gate leaves the prior #196/#198/#200/#202 boundaries byte-exact in the same sandbox machinery', async (t) => {
  // The setup-sandbox variant (fake docker plus fake openssl recorders) must
  // not perturb any other boundary: #196 unknown-command and known-command
  // dispatch, #198 exact reset confirmation, #200 exact down arity, and #202
  // exact up arity all keep their byte-exact behavior with zero tool calls.
  const sandbox = buildSetupSandbox();
  t.after(sandbox.deleteAll);
  const unknown = await runBiInSandbox(sandbox, ['definitely-not-a-command']);
  assert.equal(unknown.status, 1, 'unknown command must still fail non-zero');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
    'the unchanged unknown-command diagnostic',
  );
  const promotionBundle = await runBiInSandbox(sandbox, ['promotion-bundle']);
  assert.equal(promotionBundle.status, 1, 'known-command validation must still fail non-zero');
  assert.equal(
    promotionBundle.stderr,
    'KaleidoSphere ERROR: usage: ./bin/bi promotion-bundle {build|inspect|preflight} ...\n',
    'the unchanged promotion-bundle validation diagnostic',
  );
  const reset = await runBiInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  assert.equal(reset.status, 1, 'trailing reset argument must still fail non-zero');
  assert.equal(reset.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the unchanged reset confirmation diagnostic');
  const down = await runBiInSandbox(sandbox, ['down', '--typo']);
  assert.equal(down.status, 1, 'trailing down argument must still fail non-zero');
  assert.equal(down.stderr, DOWN_USAGE_DIAGNOSTIC, 'the unchanged down usage diagnostic');
  const up = await runBiInSandbox(sandbox, ['up', '--typo']);
  assert.equal(up.status, 1, 'trailing up argument must still fail non-zero');
  assert.equal(up.stderr, UP_USAGE_DIAGNOSTIC, 'the unchanged up usage diagnostic');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero fake-Docker calls across the preserved boundaries');
  assert.deepEqual(opensslCalls(sandbox), [], 'zero fake-OpenSSL calls across the preserved boundaries');
});

// ---------------------------------------------------------------------------
// CLI-06 (KaleidoSphere issue #206) — the request-bearing analyze boundary
// must fail closed on every trailing argument form.
//
// analyze takes no arguments. Every case runs a fresh disposable synthetic
// sandbox: a new mkdtemp directory holding a byte-identical copy of the
// shipped bin/bi, optional valid-looking setup sentinels (a synthetic .env
// plus a mode-0600 control token), and two fake executables first on PATH —
// a `docker` recorder that appends its argv to a local call log and answers
// `compose port <service> <port>` with a deterministic 127.0.0.1:<port>
// binding, and a `curl` recorder that appends its argv to a local call log
// and prints a deterministic synthetic downstream response, so the exact
// valid analyze request path is observable end-to-end without a real daemon,
// network, or service. Each sandbox is removed when its test finishes. No
// real Docker, curl/network, credential, database, or productive state is
// reached.
// ---------------------------------------------------------------------------

const ANALYZE_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi analyze\n';
// The usage diagnostic is a single-line stderr record: printable ASCII only
// and terminated by exactly one newline, so it is single-line and
// injection-free.
const ANALYZE_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;
// The deterministic synthetic downstream response the fake curl recorder
// returns for the exact valid analyze request.
const ANALYZE_FAKE_RESPONSE = '{"answer":"synthetic-analysis"}\n';

function buildAnalyzeSandbox({ configured = true } = {}) {
  const root = mkdtempSync(path.join(ROOT, '.bi-analyze-sandbox-'));
  const fakeBin = path.join(root, 'fake-bin');
  const logPath = path.join(root, 'docker-calls.log');
  const curlLogPath = path.join(root, 'curl-calls.log');
  const controlToken = path.join(root, '.runtime', 'secrets', 'control_token');
  mkdirSync(fakeBin);
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  if (configured) {
    // Valid-looking setup sentinels: a synthetic .env and a mode-0600 control
    // token, so a trailing argument must be rejected by the arity gate
    // alone, never by passing into require_setup and then the request path.
    writeFileSync(path.join(root, '.env'), 'SYNTHETIC=1\n');
    mkdirSync(path.dirname(controlToken), { recursive: true });
    writeFileSync(controlToken, '0123456789abcdef\n');
    chmodSync(controlToken, 0o600);
  }
  // The fake docker recorder: one line of joined argv per invocation, nothing
  // else. It shadows any real docker because fake-bin is first on PATH and
  // answers `compose port <service> <port>` with a deterministic 127.0.0.1:
  // <port> binding, modeling a healthy local daemon so the exact valid
  // analyze path is observable end-to-end.
  const dockerPath = path.join(fakeBin, 'docker');
  const dockerScript =
    `#!/bin/sh\n` +
    `{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\n` +
    `case "$4" in port) printf '127.0.0.1:%s\\n' "$6" ;; esac\n` +
    'exit 0\n';
  writeFileSync(dockerPath, dockerScript);
  chmodSync(dockerPath, 0o755);
  // The fake curl recorder: one line of joined argv per invocation, then the
  // deterministic synthetic downstream response on stdout. It shadows any
  // real curl because fake-bin is first on PATH, so the analyze request is
  // observable without a network or service.
  const curlPath = path.join(fakeBin, 'curl');
  const curlScript =
    `#!/bin/sh\n` +
    `{ printf 'curl'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${curlLogPath}'\n` +
    `printf '{"answer":"synthetic-analysis"}\\n'\n` +
    'exit 0\n';
  writeFileSync(curlPath, curlScript);
  chmodSync(curlPath, 0o755);
  // Run the exact shipped script bytes from inside the sandbox so bi_here is
  // the disposable sandbox root, never this repository.
  const biPath = path.join(root, 'bin', 'bi');
  writeFileSync(biPath, readFileSync(path.join(ROOT, 'bin', 'bi')));
  chmodSync(biPath, 0o755);
  return Object.freeze({
    root,
    logPath,
    curlLogPath,
    dotEnv: path.join(root, '.env'),
    controlToken,
    deleteAll: () => rmSync(root, { recursive: true, force: true }),
  });
}

function curlCalls(sandbox) {
  if (!existsSync(sandbox.curlLogPath)) return [];
  return readFileSync(sandbox.curlLogPath, 'utf8').split('\n').filter((line) => line.length > 0);
}

test('CLI-06-AC01: every trailing analyze argument form fails closed with one deterministic bounded printable diagnostic, empty stdout, and zero fake-Docker and fake-curl calls in configured and unconfigured sandboxes', async (t) => {
  // The configured sandboxes carry valid-looking setup sentinels (a synthetic
  // .env and a mode-0600 control token), so every form must be rejected by
  // the zero-option arity gate alone — never by passing into require_setup
  // and then the Compose/curl request path. The unconfigured sandboxes carry
  // no .env and no control token.
  const forms = Object.freeze([
    Object.freeze(['analyze', '--typo']),
    Object.freeze(['analyze', '--format', 'json']),
    Object.freeze(['analyze', '-n']),
    Object.freeze(['analyze', '']),
    Object.freeze(['analyze', ' ']),
    Object.freeze(['analyze', '\u001b[2J]\u001b[8m']),
    Object.freeze(['analyze', 'line1\nline2']),
    Object.freeze(['analyze', 'x'.repeat(5000)]),
    Object.freeze(['analyze', 'extra', 'more']),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    for (const form of forms) {
      const sandbox = buildAnalyzeSandbox({ configured });
      sandboxes.push(sandbox);
      const result = await runBiInSandbox(sandbox, form);
      const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
        result.stdout,
      )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
        dockerCalls(sandbox),
      )}, curlCalls=${JSON.stringify(curlCalls(sandbox))}`;
      assert.equal(result.status, 1, `${JSON.stringify(form)} must fail non-zero, observed: ${observation}`);
      assert.equal(result.stdout, '', `${JSON.stringify(form)}: nothing to stdout`);
      assert.equal(
        result.stderr,
        ANALYZE_USAGE_DIAGNOSTIC,
        `${JSON.stringify(form)}: the deterministic bounded usage diagnostic`,
      );
      assert.match(
        result.stderr,
        ANALYZE_USAGE_DIAGNOSTIC_SHAPE,
        `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(form)}`,
      );
      assert.ok(
        result.stderr.length < 512,
        `${JSON.stringify(form)}: stderr must stay bounded, got ${result.stderr.length}`,
      );
      assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-Docker calls, ${observation}`);
      assert.deepEqual(curlCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-curl calls, ${observation}`);
    }
  }
});

test('CLI-06-AC02: the analyze arity gate rejects before require_setup, stat, Compose, and curl, with zero fake-Docker and fake-curl calls in configured and unconfigured sandboxes', async (t) => {
  // A configured sandbox proves the gate is the arity gate (the exact usage
  // diagnostic, never a setup or request diagnostic) while valid-looking
  // setup sentinels are present; an unconfigured sandbox (no .env, no
  // control token) proves the arity gate runs before any setup check: a
  // malformed analyze must report the usage diagnostic, never the setup
  // diagnostic.
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    const sandbox = buildAnalyzeSandbox({ configured });
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, ['analyze', '--typo']);
    const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
      result.stdout,
    )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
      dockerCalls(sandbox),
    )}, curlCalls=${JSON.stringify(curlCalls(sandbox))}`;
    assert.equal(result.status, 1, `malformed analyze must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${observation}: nothing to stdout`);
    assert.equal(
      result.stderr,
      ANALYZE_USAGE_DIAGNOSTIC,
      `${observation}: the arity gate must precede require_setup, stat, Compose, and curl`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${observation}: zero fake-Docker calls`);
    assert.deepEqual(curlCalls(sandbox), [], `${observation}: zero fake-curl calls`);
  }
});

test('CLI-06-AC03: the exact valid analyze retains one repository-scoped Compose port lookup, exactly one fake-curl request carrying the fixed German analysis message to the discovered loopback endpoint, the unchanged fake response readback, empty stderr, and a successful exit', async (t) => {
  const sandbox = buildAnalyzeSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['analyze']);
  assert.equal(result.status, 0, `valid analyze must exit 0, stderr=${JSON.stringify(result.stderr)}`);
  assert.equal(result.stderr, '', 'nothing to stderr on a successful analyze');
  assert.equal(result.stdout, ANALYZE_FAKE_RESPONSE, 'the unchanged fake downstream response readback');
  assert.deepEqual(
    dockerCalls(sandbox),
    [`docker compose --file ${sandbox.root}/compose.yaml port bi-agent 18790`],
    'exactly one repository-scoped Compose port lookup',
  );
  assert.deepEqual(
    curlCalls(sandbox),
    [
      'curl --fail --silent --show-error --header content-type: application/json ' +
        '--data {"message":"Analysiere die konfigurierte Datenbank"} ' +
        'http://127.0.0.1:18790/api/chat',
    ],
    'exactly one fake-curl request carrying the fixed German analysis message to the discovered loopback endpoint',
  );
  // analyze must make no local mutation: the setup sentinels survive.
  assert.equal(existsSync(sandbox.dotEnv), true, 'the synthetic .env must be preserved');
  assert.equal(existsSync(sandbox.controlToken), true, 'the mode-0600 control token must be preserved');
});

test('CLI-06-AC04: the analyze arity gate leaves the prior #196/#198/#200/#202/#204 boundaries byte-exact in the same sandbox machinery', async (t) => {
  // The analyze-sandbox variant (fake docker plus fake curl recorders) must
  // not perturb any other boundary: #196 unknown-command and known-command
  // dispatch, #198 exact reset confirmation, #200 exact down arity, #202
  // exact up arity, and #204 exact setup arity all keep their byte-exact
  // behavior with zero tool calls.
  const sandbox = buildAnalyzeSandbox();
  t.after(sandbox.deleteAll);
  const unknown = await runBiInSandbox(sandbox, ['definitely-not-a-command']);
  assert.equal(unknown.status, 1, 'unknown command must still fail non-zero');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
    'the unchanged unknown-command diagnostic',
  );
  const promotionBundle = await runBiInSandbox(sandbox, ['promotion-bundle']);
  assert.equal(promotionBundle.status, 1, 'known-command validation must still fail non-zero');
  assert.equal(
    promotionBundle.stderr,
    'KaleidoSphere ERROR: usage: ./bin/bi promotion-bundle {build|inspect|preflight} ...\n',
    'the unchanged promotion-bundle validation diagnostic',
  );
  const reset = await runBiInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  assert.equal(reset.status, 1, 'trailing reset argument must still fail non-zero');
  assert.equal(reset.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the unchanged reset confirmation diagnostic');
  const down = await runBiInSandbox(sandbox, ['down', '--typo']);
  assert.equal(down.status, 1, 'trailing down argument must still fail non-zero');
  assert.equal(down.stderr, DOWN_USAGE_DIAGNOSTIC, 'the unchanged down usage diagnostic');
  const up = await runBiInSandbox(sandbox, ['up', '--typo']);
  assert.equal(up.status, 1, 'trailing up argument must still fail non-zero');
  assert.equal(up.stderr, UP_USAGE_DIAGNOSTIC, 'the unchanged up usage diagnostic');
  const setup = await runBiInSandbox(sandbox, ['setup', '--typo']);
  assert.equal(setup.status, 1, 'trailing setup argument must still fail non-zero');
  assert.equal(setup.stderr, SETUP_USAGE_DIAGNOSTIC, 'the unchanged setup usage diagnostic');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero fake-Docker calls across the preserved boundaries');
  assert.deepEqual(curlCalls(sandbox), [], 'zero fake-curl calls across the preserved boundaries');
});

// ---------------------------------------------------------------------------
// CLI-07 (KaleidoSphere issue #208) — the read-only status boundary must fail
// closed on every trailing argument form.
//
// status takes no arguments. Every case runs a fresh disposable synthetic
// sandbox: a new mkdtemp directory holding a byte-identical copy of the
// shipped bin/bi, optional valid-looking setup sentinels (a synthetic .env
// plus a mode-0600 control token), and a fake `docker` executable first on
// PATH that appends its argv to a local call log and answers `compose ps`
// with a deterministic synthetic status response, so the exact valid status
// read path is observable end-to-end without a real daemon. Each sandbox is
// removed when its test finishes. No real Docker, network, credential,
// database, or productive state is reached.
// ---------------------------------------------------------------------------

const STATUS_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi status\n';
// The usage diagnostic is a single-line stderr record: printable ASCII only
// and terminated by exactly one newline, so it is single-line and
// injection-free.
const STATUS_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;
// The deterministic synthetic Compose ps response the fake docker recorder
// returns for the exact valid status read.
const STATUS_FAKE_COMPOSE_PS = 'NAME        STATUS\nbi-agent  running\n';

function buildStatusSandbox({ configured = true } = {}) {
  const root = mkdtempSync(path.join(ROOT, '.bi-status-sandbox-'));
  const fakeBin = path.join(root, 'fake-bin');
  const logPath = path.join(root, 'docker-calls.log');
  const controlToken = path.join(root, '.runtime', 'secrets', 'control_token');
  mkdirSync(fakeBin);
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  if (configured) {
    // Valid-looking setup sentinels: a synthetic .env, a mode-0600 control
    // token, a mode-0600 external connector secret, and an unrelated root
    // file, so a trailing argument must be rejected by the arity gate
    // alone, never by passing into require_setup and then the Compose
    // status read.
    writeFileSync(path.join(root, '.env'), 'SYNTHETIC=1\n');
    mkdirSync(path.dirname(controlToken), { recursive: true });
    writeFileSync(controlToken, '0123456789abcdef\n');
    chmodSync(controlToken, 0o600);
    mkdirSync(path.join(root, '.secrets'), { recursive: true });
    writeFileSync(path.join(root, '.secrets', 'mssql_password'), '');
    chmodSync(path.join(root, '.secrets', 'mssql_password'), 0o600);
    writeFileSync(path.join(root, 'README-sentinel.md'), 'unrelated\n');
  }
  // The fake docker recorder: one line of joined argv per invocation,
  // nothing else. It shadows any real docker because fake-bin is first on
  // PATH and answers `compose ps` with a deterministic synthetic status
  // response, modeling a healthy local daemon so the exact valid status
  // read is observable end-to-end.
  const dockerPath = path.join(fakeBin, 'docker');
  const dockerScript =
    `#!/bin/sh\n` +
    `{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\n` +
    `case "$4" in ps) printf 'NAME        STATUS\\nbi-agent  running\\n' ;; esac\n` +
    'exit 0\n';
  writeFileSync(dockerPath, dockerScript);
  chmodSync(dockerPath, 0o755);
  // Run the exact shipped script bytes from inside the sandbox so bi_here is
  // the disposable sandbox root, never this repository.
  const biPath = path.join(root, 'bin', 'bi');
  writeFileSync(biPath, readFileSync(path.join(ROOT, 'bin', 'bi')));
  chmodSync(biPath, 0o755);
  return Object.freeze({
    root,
    logPath,
    sentinels: Object.freeze({
      dotEnv: path.join(root, '.env'),
      controlToken,
      externalSecret: path.join(root, '.secrets', 'mssql_password'),
      unrelatedRoot: path.join(root, 'README-sentinel.md'),
    }),
    deleteAll: () => rmSync(root, { recursive: true, force: true }),
  });
}

function missingSentinels(sandbox) {
  return Object.entries(sandbox.sentinels)
    .filter(([, file]) => !existsSync(file))
    .map(([name]) => name);
}

test('CLI-07-AC01: every trailing status argument form fails closed with one deterministic bounded printable diagnostic, empty stdout, and zero fake-Docker calls in configured and unconfigured sandboxes', async (t) => {
  // The configured sandboxes carry valid-looking setup sentinels (a synthetic
  // .env, a mode-0600 control token, a mode-0600 external connector secret,
  // and an unrelated root file), so every form must be rejected by the
  // zero-option arity gate alone — never by passing into require_setup and
  // then the Compose status read. The unconfigured sandboxes carry no .env
  // and no control token.
  const forms = Object.freeze([
    Object.freeze(['status', '--typo']),
    Object.freeze(['status', '--watch']),
    Object.freeze(['status', '-n']),
    Object.freeze(['status', '']),
    Object.freeze(['status', ' ']),
    Object.freeze(['status', '\u001b[2J\u001b[8m']),
    Object.freeze(['status', 'line1\nline2']),
    Object.freeze(['status', 'x'.repeat(5000)]),
    Object.freeze(['status', 'extra', 'more']),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    for (const form of forms) {
      const sandbox = buildStatusSandbox({ configured });
      sandboxes.push(sandbox);
      const result = await runBiInSandbox(sandbox, form);
      const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
        result.stdout,
      )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
        dockerCalls(sandbox),
      )}, missingSentinels=${JSON.stringify(missingSentinels(sandbox))}`;
      assert.equal(result.status, 1, `${JSON.stringify(form)} must fail non-zero, observed: ${observation}`);
      assert.equal(result.stdout, '', `${JSON.stringify(form)}: nothing to stdout`);
      assert.equal(
        result.stderr,
        STATUS_USAGE_DIAGNOSTIC,
        `${JSON.stringify(form)}: the deterministic bounded usage diagnostic`,
      );
      assert.match(
        result.stderr,
        STATUS_USAGE_DIAGNOSTIC_SHAPE,
        `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(form)}`,
      );
      assert.ok(
        result.stderr.length < 512,
        `${JSON.stringify(form)}: stderr must stay bounded, got ${result.stderr.length}`,
      );
      assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-Docker calls, ${observation}`);
      if (configured) {
        assert.deepEqual(missingSentinels(sandbox), [], `${JSON.stringify(form)}: sentinels must survive, ${observation}`);
      }
    }
  }
});

test('CLI-07-AC02: the status arity gate rejects before require_setup, stat, Compose, or any downstream action, with zero fake-Docker calls in configured and unconfigured sandboxes', async (t) => {
  // A configured sandbox proves the gate is the arity gate (the exact usage
  // diagnostic, never a setup or status-read diagnostic) while valid-looking
  // setup sentinels are present; an unconfigured sandbox (no .env, no
  // control token) proves the arity gate runs before any setup check: a
  // malformed status must report the usage diagnostic, never the setup
  // diagnostic.
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    const sandbox = buildStatusSandbox({ configured });
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, ['status', '--typo']);
    const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
      result.stdout,
    )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
      dockerCalls(sandbox),
    )}`;
    assert.equal(result.status, 1, `malformed status must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${observation}: nothing to stdout`);
    assert.equal(
      result.stderr,
      STATUS_USAGE_DIAGNOSTIC,
      `${observation}: the arity gate must precede require_setup, stat, and Compose`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${observation}: zero fake-Docker calls`);
  }
});

test('CLI-07-AC03: the exact valid status retains one repository-scoped compose ps call, the unchanged fake response readback, empty stderr, a successful exit, and every sentinel preserved', async (t) => {
  const sandbox = buildStatusSandbox();
  t.after(sandbox.deleteAll);
  const result = await runBiInSandbox(sandbox, ['status']);
  assert.equal(result.status, 0, `valid status must exit 0, stderr=${JSON.stringify(result.stderr)}`);
  assert.equal(result.stderr, '', 'nothing to stderr on a successful status');
  assert.equal(result.stdout, STATUS_FAKE_COMPOSE_PS, 'the unchanged fake Compose response readback');
  assert.deepEqual(
    dockerCalls(sandbox),
    [`docker compose --file ${sandbox.root}/compose.yaml ps`],
    'exactly one repository-scoped compose ps call',
  );
  // status must perform no local mutation: every configured sentinel survives.
  assert.deepEqual(missingSentinels(sandbox), [], 'every configured sentinel must be preserved');
});

test('CLI-07-AC04: the status arity gate leaves the prior #196/#198/#200/#202/#204/#206 boundaries byte-exact in the same sandbox machinery', async (t) => {
  // The status-sandbox variant (fake docker recorder answering compose ps)
  // must not perturb any other boundary: #196 unknown-command and
  // known-command dispatch, #198 exact reset confirmation, #200 exact down
  // arity, #202 exact up arity, #204 exact setup arity, and #206 exact
  // analyze arity all keep their byte-exact behavior with zero tool calls.
  const sandbox = buildStatusSandbox();
  t.after(sandbox.deleteAll);
  const unknown = await runBiInSandbox(sandbox, ['definitely-not-a-command']);
  assert.equal(unknown.status, 1, 'unknown command must still fail non-zero');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
    'the unchanged unknown-command diagnostic',
  );
  const promotionBundle = await runBiInSandbox(sandbox, ['promotion-bundle']);
  assert.equal(promotionBundle.status, 1, 'known-command validation must still fail non-zero');
  assert.equal(
    promotionBundle.stderr,
    'KaleidoSphere ERROR: usage: ./bin/bi promotion-bundle {build|inspect|preflight} ...\n',
    'the unchanged promotion-bundle validation diagnostic',
  );
  const reset = await runBiInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  assert.equal(reset.status, 1, 'trailing reset argument must still fail non-zero');
  assert.equal(reset.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the unchanged reset confirmation diagnostic');
  const down = await runBiInSandbox(sandbox, ['down', '--typo']);
  assert.equal(down.status, 1, 'trailing down argument must still fail non-zero');
  assert.equal(down.stderr, DOWN_USAGE_DIAGNOSTIC, 'the unchanged down usage diagnostic');
  const up = await runBiInSandbox(sandbox, ['up', '--typo']);
  assert.equal(up.status, 1, 'trailing up argument must still fail non-zero');
  assert.equal(up.stderr, UP_USAGE_DIAGNOSTIC, 'the unchanged up usage diagnostic');
  const setup = await runBiInSandbox(sandbox, ['setup', '--typo']);
  assert.equal(setup.status, 1, 'trailing setup argument must still fail non-zero');
  assert.equal(setup.stderr, SETUP_USAGE_DIAGNOSTIC, 'the unchanged setup usage diagnostic');
  const analyze = await runBiInSandbox(sandbox, ['analyze', '--typo']);
  assert.equal(analyze.status, 1, 'trailing analyze argument must still fail non-zero');
  assert.equal(analyze.stderr, ANALYZE_USAGE_DIAGNOSTIC, 'the unchanged analyze usage diagnostic');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero fake-Docker calls across the preserved boundaries');
});

// ---------------------------------------------------------------------------
// CLI-08 (KaleidoSphere issue #210) — the read-only logs boundary must fail
// closed on every malformed operand form.
//
// logs takes at most one conservative service-name operand: logs [service].
// Every case runs a fresh disposable synthetic sandbox: a new mkdtemp
// directory holding a byte-identical copy of the shipped bin/bi, optional
// valid-looking setup sentinels (a synthetic .env plus a mode-0600 control
// token), and a fake `docker` executable first on PATH that appends its argv
// to a local call log and answers `compose logs` with a deterministic
// synthetic log readback, so the exact valid logs read path is observable
// end-to-end without a real daemon. Each sandbox is removed when its test
// finishes. No real Docker, network, credential, database, or productive
// state is reached.
// ---------------------------------------------------------------------------

const LOGS_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi logs [service]\n';
// The usage diagnostic is a single-line stderr record: printable ASCII only
// and terminated by exactly one newline, so it is single-line and
// injection-free.
const LOGS_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;
// The deterministic synthetic Compose logs readback the fake docker recorder
// returns for the exact valid logs reads.
const LOGS_FAKE_COMPOSE_LOGS = 'bi-agent  | synthetic log line 1\nbi-agent  | synthetic log line 2\n';

function buildLogsSandbox({ configured = true } = {}) {
  const root = mkdtempSync(path.join(ROOT, '.bi-logs-sandbox-'));
  const fakeBin = path.join(root, 'fake-bin');
  const logPath = path.join(root, 'docker-calls.log');
  const controlToken = path.join(root, '.runtime', 'secrets', 'control_token');
  mkdirSync(fakeBin);
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  if (configured) {
    // Valid-looking setup sentinels: a synthetic .env, a mode-0600 control
    // token, a mode-0600 external connector secret, and an unrelated root
    // file, so a malformed operand must be rejected by the operand gate
    // alone, never by passing into require_setup and then the Compose logs
    // read.
    writeFileSync(path.join(root, '.env'), 'SYNTHETIC=1\n');
    mkdirSync(path.dirname(controlToken), { recursive: true });
    writeFileSync(controlToken, '0123456789abcdef\n');
    chmodSync(controlToken, 0o600);
    mkdirSync(path.join(root, '.secrets'), { recursive: true });
    writeFileSync(path.join(root, '.secrets', 'mssql_password'), '');
    chmodSync(path.join(root, '.secrets', 'mssql_password'), 0o600);
    writeFileSync(path.join(root, 'README-sentinel.md'), 'unrelated\n');
  }
  // The fake docker recorder: one line of joined argv per invocation,
  // nothing else. It shadows any real docker because fake-bin is first on
  // PATH and answers `compose logs` with a deterministic synthetic log
  // readback, modeling a healthy local daemon so the exact valid logs read
  // is observable end-to-end.
  const dockerPath = path.join(fakeBin, 'docker');
  const dockerScript =
    `#!/bin/sh\n` +
    `{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\n` +
    `case "$4" in logs) printf 'bi-agent  | synthetic log line 1\\nbi-agent  | synthetic log line 2\\n' ;; esac\n` +
    'exit 0\n';
  writeFileSync(dockerPath, dockerScript);
  chmodSync(dockerPath, 0o755);
  // Run the exact shipped script bytes from inside the sandbox so bi_here is
  // the disposable sandbox root, never this repository.
  const biPath = path.join(root, 'bin', 'bi');
  writeFileSync(biPath, readFileSync(path.join(ROOT, 'bin', 'bi')));
  chmodSync(biPath, 0o755);
  return Object.freeze({
    root,
    logPath,
    sentinels: Object.freeze({
      dotEnv: path.join(root, '.env'),
      controlToken,
      externalSecret: path.join(root, '.secrets', 'mssql_password'),
      unrelatedRoot: path.join(root, 'README-sentinel.md'),
    }),
    deleteAll: () => rmSync(root, { recursive: true, force: true }),
  });
}

test('CLI-08-AC01: every malformed logs operand form fails closed with one deterministic bounded printable diagnostic, empty stdout, and zero fake-Docker calls in configured and unconfigured sandboxes', async (t) => {
  // The configured sandboxes carry valid-looking setup sentinels (a synthetic
  // .env, a mode-0600 control token, a mode-0600 external connector secret,
  // and an unrelated root file), so every form must be rejected by the
  // operand gate alone — never by passing into require_setup and then the
  // Compose logs read. The unconfigured sandboxes carry no .env and no
  // control token.
  const forms = Object.freeze([
    Object.freeze(['logs', 'bi-agent', 'ignored']),
    Object.freeze(['logs', 'extra', 'more']),
    Object.freeze(['logs', '--follow']),
    Object.freeze(['logs', '--typo']),
    Object.freeze(['logs', '-n']),
    Object.freeze(['logs', '--']),
    Object.freeze(['logs', '']),
    Object.freeze(['logs', ' ']),
    Object.freeze(['logs', ' bi-agent']),
    Object.freeze(['logs', '\u001b[2J\u001b[8m']),
    Object.freeze(['logs', 'line1\nline2']),
    Object.freeze(['logs', 'bi-agent/extra']),
    Object.freeze(['logs', 'x'.repeat(5000)]),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    for (const form of forms) {
      const sandbox = buildLogsSandbox({ configured });
      sandboxes.push(sandbox);
      const result = await runBiInSandbox(sandbox, form);
      const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
        result.stdout,
      )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
        dockerCalls(sandbox),
      )}, missingSentinels=${JSON.stringify(missingSentinels(sandbox))}`;
      assert.equal(result.status, 1, `${JSON.stringify(form)} must fail non-zero, observed: ${observation}`);
      assert.equal(result.stdout, '', `${JSON.stringify(form)}: nothing to stdout`);
      assert.equal(
        result.stderr,
        LOGS_USAGE_DIAGNOSTIC,
        `${JSON.stringify(form)}: the deterministic bounded usage diagnostic`,
      );
      assert.match(
        result.stderr,
        LOGS_USAGE_DIAGNOSTIC_SHAPE,
        `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(form)}`,
      );
      assert.ok(
        result.stderr.length < 512,
        `${JSON.stringify(form)}: stderr must stay bounded, got ${result.stderr.length}`,
      );
      assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-Docker calls, ${observation}`);
      if (configured) {
        assert.deepEqual(missingSentinels(sandbox), [], `${JSON.stringify(form)}: sentinels must survive, ${observation}`);
      }
    }
  }
});

test('CLI-08-AC02: the logs operand gate rejects before require_setup, stat, Compose, or any downstream action, with zero fake-Docker calls in configured and unconfigured sandboxes', async (t) => {
  // A configured sandbox proves the gate is the operand gate (the exact
  // usage diagnostic, never a setup or logs-read diagnostic) while
  // valid-looking setup sentinels are present; an unconfigured sandbox (no
  // .env, no control token) proves the operand gate runs before any setup
  // check: a malformed logs must report the usage diagnostic, never the
  // setup diagnostic.
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    const sandbox = buildLogsSandbox({ configured });
    sandboxes.push(sandbox);
    const result = await runBiInSandbox(sandbox, ['logs', '--follow']);
    const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
      result.stdout,
    )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
      dockerCalls(sandbox),
    )}`;
    assert.equal(result.status, 1, `malformed logs must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${observation}: nothing to stdout`);
    assert.equal(
      result.stderr,
      LOGS_USAGE_DIAGNOSTIC,
      `${observation}: the operand gate must precede require_setup, stat, and Compose`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${observation}: zero fake-Docker calls`);
  }
});

test('CLI-08-AC03: the exact valid logs forms retain one repository-scoped bounded compose logs readback each — no service selector, or an explicit -- option terminator before bi-agent — with the unchanged fake response, empty stderr, a successful exit, and every sentinel preserved', async (t) => {
  // The no-operand form reads back without any service selector; the
  // single-operand form reads back with an explicit `--` option terminator
  // before the service so Compose can never reinterpret the documented
  // service slot as an option.
  const noService = await (async () => {
    const sandbox = buildLogsSandbox();
    const result = await runBiInSandbox(sandbox, ['logs']);
    const calls = dockerCalls(sandbox);
    const sentinels = missingSentinels(sandbox);
    sandbox.deleteAll();
    return { result, calls, sentinels, file: `${sandbox.root}/compose.yaml` };
  })();
  assert.equal(noService.result.status, 0, `valid logs must exit 0, stderr=${JSON.stringify(noService.result.stderr)}`);
  assert.equal(noService.result.stderr, '', 'nothing to stderr on a successful logs read');
  assert.equal(noService.result.stdout, LOGS_FAKE_COMPOSE_LOGS, 'the unchanged fake Compose response readback');
  assert.deepEqual(
    noService.calls,
    [`docker compose --file ${noService.file} logs --tail 200`],
    'exactly one repository-scoped bounded compose logs call with no service selector',
  );
  assert.deepEqual(noService.sentinels, [], 'every configured sentinel must be preserved');

  const withService = await (async () => {
    const sandbox = buildLogsSandbox();
    const result = await runBiInSandbox(sandbox, ['logs', 'bi-agent']);
    const calls = dockerCalls(sandbox);
    const sentinels = missingSentinels(sandbox);
    sandbox.deleteAll();
    return { result, calls, sentinels, file: `${sandbox.root}/compose.yaml` };
  })();
  assert.equal(withService.result.status, 0, `valid logs bi-agent must exit 0, stderr=${JSON.stringify(withService.result.stderr)}`);
  assert.equal(withService.result.stderr, '', 'nothing to stderr on a successful logs read');
  assert.equal(withService.result.stdout, LOGS_FAKE_COMPOSE_LOGS, 'the unchanged fake Compose response readback');
  assert.deepEqual(
    withService.calls,
    [`docker compose --file ${withService.file} logs --tail 200 -- bi-agent`],
    'exactly one repository-scoped bounded compose logs call with an explicit -- option terminator before bi-agent',
  );
  assert.deepEqual(withService.sentinels, [], 'every configured sentinel must be preserved');
});

test('CLI-08-AC04: the logs operand gate leaves the prior #196/#198/#200/#202/#204/#206/#208 boundaries byte-exact in the same sandbox machinery', async (t) => {
  // The logs-sandbox variant (fake docker recorder answering compose logs)
  // must not perturb any other boundary: #196 unknown-command and
  // known-command dispatch, #198 exact reset confirmation, #200 exact down
  // arity, #202 exact up arity, #204 exact setup arity, #206 exact analyze
  // arity, and #208 exact status arity all keep their byte-exact behavior
  // with zero tool calls.
  const sandbox = buildLogsSandbox();
  t.after(sandbox.deleteAll);
  const unknown = await runBiInSandbox(sandbox, ['definitely-not-a-command']);
  assert.equal(unknown.status, 1, 'unknown command must still fail non-zero');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
    'the unchanged unknown-command diagnostic',
  );
  const promotionBundle = await runBiInSandbox(sandbox, ['promotion-bundle']);
  assert.equal(promotionBundle.status, 1, 'known-command validation must still fail non-zero');
  assert.equal(
    promotionBundle.stderr,
    'KaleidoSphere ERROR: usage: ./bin/bi promotion-bundle {build|inspect|preflight} ...\n',
    'the unchanged promotion-bundle validation diagnostic',
  );
  const reset = await runBiInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  assert.equal(reset.status, 1, 'trailing reset argument must still fail non-zero');
  assert.equal(reset.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the unchanged reset confirmation diagnostic');
  const down = await runBiInSandbox(sandbox, ['down', '--typo']);
  assert.equal(down.status, 1, 'trailing down argument must still fail non-zero');
  assert.equal(down.stderr, DOWN_USAGE_DIAGNOSTIC, 'the unchanged down usage diagnostic');
  const up = await runBiInSandbox(sandbox, ['up', '--typo']);
  assert.equal(up.status, 1, 'trailing up argument must still fail non-zero');
  assert.equal(up.stderr, UP_USAGE_DIAGNOSTIC, 'the unchanged up usage diagnostic');
  const setup = await runBiInSandbox(sandbox, ['setup', '--typo']);
  assert.equal(setup.status, 1, 'trailing setup argument must still fail non-zero');
  assert.equal(setup.stderr, SETUP_USAGE_DIAGNOSTIC, 'the unchanged setup usage diagnostic');
  const analyze = await runBiInSandbox(sandbox, ['analyze', '--typo']);
  assert.equal(analyze.status, 1, 'trailing analyze argument must still fail non-zero');
  assert.equal(analyze.stderr, ANALYZE_USAGE_DIAGNOSTIC, 'the unchanged analyze usage diagnostic');
  const status = await runBiInSandbox(sandbox, ['status', '--typo']);
  assert.equal(status.status, 1, 'trailing status argument must still fail non-zero');
  assert.equal(status.stderr, STATUS_USAGE_DIAGNOSTIC, 'the unchanged status usage diagnostic');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero fake-Docker calls across the preserved boundaries');
});

// ---------------------------------------------------------------------------
// CLI-09 (KaleidoSphere issue #212) — the zero-payload discovery action
// boundary must fail closed on every fourth-or-later argv form.
//
// discovery <action> <session> (with action one of start, resume, status,
// confirm, or export) carries no payload and accepts exactly three total argv
// entries. Every case runs a fresh disposable synthetic sandbox: a new
// mkdtemp directory holding a byte-identical copy of the shipped bin/bi,
// optional valid-looking setup sentinels (a synthetic .env plus a mode-0600
// control token), and two fake executables first on PATH — a `docker`
// recorder that appends its argv to a local call log and answers `compose
// port <service> <port>` with a deterministic 127.0.0.1:<port> binding, and
// a `curl` recorder that appends its argv to a local call log, records the
// request stdin payload byte-for-byte, and prints a deterministic synthetic
// downstream response, so the exact valid discovery request path is
// observable end-to-end without a real daemon, network, or service. The
// sandbox PATH additionally provides the suite's own node executable,
// because the discovery branch is the only one in this suite that invokes
// node for local JSON payload encoding; the fakes remain exactly the local
// docker and curl argv recorders. Each sandbox is removed when its test
// finishes. No real Docker, network, credential, database, or productive
// state is reached.
// ---------------------------------------------------------------------------

const DISCOVERY_ACTIONS = Object.freeze(['start', 'resume', 'status', 'confirm', 'export']);
// The usage diagnostic is action-specific: it names the exact zero-payload
// action and session the operator attempted.
const discoveryUsageDiagnostic = (action) =>
  `KaleidoSphere ERROR: usage: ./bin/bi discovery ${action} demo\n`;
// The usage diagnostic is a single-line stderr record: printable ASCII only
// and terminated by exactly one newline, so it is single-line and
// injection-free.
const DISCOVERY_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;
// The deterministic synthetic downstream response the fake curl recorder
// returns for the exact valid discovery requests.
const DISCOVERY_FAKE_RESPONSE = '{"answer":"synthetic-discovery"}\n';

function buildDiscoverySandbox({ configured = true } = {}) {
  const root = mkdtempSync(path.join(ROOT, '.bi-discovery-sandbox-'));
  const fakeBin = path.join(root, 'fake-bin');
  const logPath = path.join(root, 'docker-calls.log');
  const curlLogPath = path.join(root, 'curl-calls.log');
  const payloadLogPath = path.join(root, 'curl-payloads.log');
  const controlToken = path.join(root, '.runtime', 'secrets', 'control_token');
  mkdirSync(fakeBin);
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  if (configured) {
    // Valid-looking setup sentinels: a synthetic .env, a mode-0600 control
    // token, a mode-0600 external connector secret, and an unrelated root
    // file, so a fourth-or-later entry must be rejected by the arity gate
    // alone, never by passing into require_setup and then the Compose/curl
    // request path.
    writeFileSync(path.join(root, '.env'), 'SYNTHETIC=1\n');
    mkdirSync(path.dirname(controlToken), { recursive: true });
    writeFileSync(controlToken, '0123456789abcdef\n');
    chmodSync(controlToken, 0o600);
    mkdirSync(path.join(root, '.secrets'), { recursive: true });
    writeFileSync(path.join(root, '.secrets', 'mssql_password'), '');
    chmodSync(path.join(root, '.secrets', 'mssql_password'), 0o600);
    writeFileSync(path.join(root, 'README-sentinel.md'), 'unrelated\n');
  }
  // The fake docker recorder: one line of joined argv per invocation,
  // nothing else. It shadows any real docker because fake-bin is first on
  // PATH and answers `compose port <service> <port>` with a deterministic
  // 127.0.0.1:<port> binding, modeling a healthy local daemon so the exact
  // valid discovery request path is observable end-to-end.
  const dockerPath = path.join(fakeBin, 'docker');
  const dockerScript =
    `#!/bin/sh\n` +
    `{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\n` +
    `case "$4" in port) printf '127.0.0.1:%s\\n' "$6" ;; esac\n` +
    'exit 0\n';
  writeFileSync(dockerPath, dockerScript);
  chmodSync(dockerPath, 0o755);
  // The fake curl recorder: one line of joined argv per invocation, the
  // request stdin payload appended byte-for-byte to its own log, then the
  // deterministic synthetic downstream response on stdout. It shadows any
  // real curl because fake-bin is first on PATH, so the discovery request
  // and its exact JSON payload are observable without a network or service.
  const curlPath = path.join(fakeBin, 'curl');
  const curlScript =
    `#!/bin/sh\n` +
    `{ printf 'curl'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${curlLogPath}'\n` +
    `cat >> '${payloadLogPath}'\n` +
    `printf '{"answer":"synthetic-discovery"}\\n'\n` +
    'exit 0\n';
  writeFileSync(curlPath, curlScript);
  chmodSync(curlPath, 0o755);
  // Run the exact shipped script bytes from inside the sandbox so bi_here is
  // the disposable sandbox root, never this repository.
  const biPath = path.join(root, 'bin', 'bi');
  writeFileSync(biPath, readFileSync(path.join(ROOT, 'bin', 'bi')));
  chmodSync(biPath, 0o755);
  return Object.freeze({
    root,
    logPath,
    curlLogPath,
    payloadLogPath,
    sentinels: Object.freeze({
      dotEnv: path.join(root, '.env'),
      controlToken,
      externalSecret: path.join(root, '.secrets', 'mssql_password'),
      unrelatedRoot: path.join(root, 'README-sentinel.md'),
    }),
    deleteAll: () => rmSync(root, { recursive: true, force: true }),
  });
}

function curlPayload(sandbox) {
  if (!existsSync(sandbox.payloadLogPath)) return '';
  return readFileSync(sandbox.payloadLogPath, 'utf8');
}

function runDiscoveryInSandbox(sandbox, args) {
  // The discovery branch is the only one in this suite that invokes node for
  // local JSON payload encoding, so its sandboxes additionally provide the
  // suite's own node executable on PATH; the fakes remain exactly the local
  // docker and curl argv recorders.
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(sandbox.root, 'bin', 'bi'), args, {
      cwd: sandbox.root,
      env: Object.freeze({
        PATH: `${path.join(sandbox.root, 'fake-bin')}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
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

test('CLI-09-AC01: every fourth-or-later discovery argument form for the zero-payload actions fails closed with the action-specific deterministic bounded printable diagnostic, empty stdout, and zero fake-Docker and fake-curl calls in configured and unconfigured sandboxes', async (t) => {
  // The configured sandboxes carry valid-looking setup sentinels (a synthetic
  // .env, a mode-0600 control token, a mode-0600 external connector secret,
  // and an unrelated root file), so every form must be rejected by the
  // arity gate alone — never by passing into require_setup and then the
  // Compose/curl request path. The unconfigured sandboxes carry no .env and
  // no control token. The explicit-empty fourth entry plus later values is
  // the form the prior ${4:-} emptiness check silently accepted.
  const fourthAndLaterForms = Object.freeze([
    Object.freeze(['']),
    Object.freeze(['', 'ignored']),
    Object.freeze(['ignored']),
    Object.freeze(['--typo']),
    Object.freeze([' ']),
    Object.freeze(['line1\nline2']),
    Object.freeze(['a', 'b', 'c']),
    Object.freeze(['x'.repeat(5000)]),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    for (const action of DISCOVERY_ACTIONS) {
      for (const form of fourthAndLaterForms) {
        const sandbox = buildDiscoverySandbox({ configured });
        sandboxes.push(sandbox);
        const args = ['discovery', action, 'demo', ...form];
        const result = await runDiscoveryInSandbox(sandbox, args);
        const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
          result.stdout,
        )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
          dockerCalls(sandbox),
        )}, curlCalls=${JSON.stringify(curlCalls(sandbox))}`;
        assert.equal(
          result.status,
          1,
          `${JSON.stringify(args.slice(0, 5))} must fail non-zero, observed: ${observation}`,
        );
        assert.equal(result.stdout, '', `${JSON.stringify(args.slice(0, 5))}: nothing to stdout`);
        assert.equal(
          result.stderr,
          discoveryUsageDiagnostic(action),
          `${JSON.stringify(args.slice(0, 5))}: the deterministic action-specific bounded usage diagnostic`,
        );
        assert.match(
          result.stderr,
          DISCOVERY_USAGE_DIAGNOSTIC_SHAPE,
          `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(
            args.slice(0, 5),
          )}`,
        );
        assert.ok(
          result.stderr.length < 512,
          `${JSON.stringify(args.slice(0, 5))}: stderr must stay bounded, got ${result.stderr.length}`,
        );
        assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(args.slice(0, 5))}: zero fake-Docker calls, ${observation}`);
        assert.deepEqual(curlCalls(sandbox), [], `${JSON.stringify(args.slice(0, 5))}: zero fake-curl calls, ${observation}`);
        assert.equal(curlPayload(sandbox), '', `${JSON.stringify(args.slice(0, 5))}: zero request payloads recorded, ${observation}`);
        if (configured) {
          assert.deepEqual(missingSentinels(sandbox), [], `${JSON.stringify(args.slice(0, 5))}: sentinels must survive, ${observation}`);
        }
      }
    }
  }
});

test('CLI-09-AC02: the zero-payload discovery arity gate rejects before require_setup, stat, Compose, curl, or any downstream action, with zero fake-Docker and fake-curl calls in configured and unconfigured sandboxes', async (t) => {
  // A configured sandbox proves the gate is the arity gate (the exact
  // action-specific usage diagnostic, never a setup or request diagnostic)
  // while valid-looking setup sentinels are present; an unconfigured sandbox
  // (no .env, no control token) proves the arity gate runs before any setup
  // check: a malformed discovery must report the usage diagnostic, never the
  // setup diagnostic.
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    const sandbox = buildDiscoverySandbox({ configured });
    sandboxes.push(sandbox);
    const result = await runDiscoveryInSandbox(sandbox, ['discovery', 'start', 'demo', '', 'ignored']);
    const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
      result.stdout,
    )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
      dockerCalls(sandbox),
    )}, curlCalls=${JSON.stringify(curlCalls(sandbox))}`;
    assert.equal(result.status, 1, `malformed discovery must fail non-zero, observed: ${observation}`);
    assert.equal(result.stdout, '', `${observation}: nothing to stdout`);
    assert.equal(
      result.stderr,
      discoveryUsageDiagnostic('start'),
      `${observation}: the arity gate must precede require_setup, stat, Compose, and curl`,
    );
    assert.deepEqual(dockerCalls(sandbox), [], `${observation}: zero fake-Docker calls`);
    assert.deepEqual(curlCalls(sandbox), [], `${observation}: zero fake-curl calls`);
    assert.equal(curlPayload(sandbox), '', `${observation}: zero request payloads recorded`);
  }
});

test('CLI-09-AC03: the exact valid zero-payload discovery forms retain exactly one repository-scoped fake-Compose port lookup and exactly one fake-curl request carrying the byte-exact Discovery <action> <session> JSON payload, the deterministic fake response readback, empty stderr, a successful exit, and every sentinel preserved', async (t) => {
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const action of DISCOVERY_ACTIONS) {
    const sandbox = buildDiscoverySandbox();
    sandboxes.push(sandbox);
    const result = await runDiscoveryInSandbox(sandbox, ['discovery', action, 'demo']);
    const observation = `exit ${result.status}, stdout=${JSON.stringify(
      result.stdout,
    )}, stderr=${JSON.stringify(result.stderr)}, dockerCalls=${JSON.stringify(
      dockerCalls(sandbox),
    )}, curlCalls=${JSON.stringify(curlCalls(sandbox))}, curlPayload=${JSON.stringify(
      curlPayload(sandbox),
    )}`;
    assert.equal(result.status, 0, `valid discovery ${action} must exit 0, observed: ${observation}`);
    assert.equal(result.stderr, '', `${action}: nothing to stderr on a successful discovery request`);
    assert.equal(result.stdout, DISCOVERY_FAKE_RESPONSE, `${action}: the deterministic fake downstream response readback`);
    assert.deepEqual(
      dockerCalls(sandbox),
      [`docker compose --file ${sandbox.root}/compose.yaml port bi-agent 18790`],
      `${action}: exactly one repository-scoped Compose port lookup`,
    );
    assert.deepEqual(
      curlCalls(sandbox),
      [
        'curl --fail --silent --show-error --header content-type: application/json ' +
          '--data-binary @- ' +
          'http://127.0.0.1:18790/api/chat',
      ],
      `${action}: exactly one fake-curl request to the discovered loopback endpoint`,
    );
    assert.equal(
      curlPayload(sandbox),
      `{"message":"Discovery ${action} demo"}`,
      `${action}: the byte-exact Discovery <action> <session> JSON payload`,
    );
    // discovery <action> <session> must make no local mutation: every
    // configured sentinel survives.
    assert.deepEqual(missingSentinels(sandbox), [], `${action}: every configured sentinel must be preserved`);
  }
});

test('CLI-09-AC04: the discovery arity gate leaves the prior #196/#198/#200/#202/#204/#206/#208/#210 boundaries byte-exact in the same sandbox machinery', async (t) => {
  // The discovery-sandbox variant (fake docker plus fake curl recorders)
  // must not perturb any other boundary: #196 unknown-command and
  // known-command dispatch, #198 exact reset confirmation, #200 exact down
  // arity, #202 exact up arity, #204 exact setup arity, #206 exact analyze
  // arity, #208 exact status arity, and #210 exact logs operand all keep
  // their byte-exact behavior with zero tool calls.
  const sandbox = buildDiscoverySandbox();
  t.after(sandbox.deleteAll);
  const unknown = await runDiscoveryInSandbox(sandbox, ['definitely-not-a-command']);
  assert.equal(unknown.status, 1, 'unknown command must still fail non-zero');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
    'the unchanged unknown-command diagnostic',
  );
  const promotionBundle = await runDiscoveryInSandbox(sandbox, ['promotion-bundle']);
  assert.equal(promotionBundle.status, 1, 'known-command validation must still fail non-zero');
  assert.equal(
    promotionBundle.stderr,
    'KaleidoSphere ERROR: usage: ./bin/bi promotion-bundle {build|inspect|preflight} ...\n',
    'the unchanged promotion-bundle validation diagnostic',
  );
  const reset = await runDiscoveryInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  assert.equal(reset.status, 1, 'trailing reset argument must still fail non-zero');
  assert.equal(reset.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the unchanged reset confirmation diagnostic');
  const down = await runDiscoveryInSandbox(sandbox, ['down', '--typo']);
  assert.equal(down.status, 1, 'trailing down argument must still fail non-zero');
  assert.equal(down.stderr, DOWN_USAGE_DIAGNOSTIC, 'the unchanged down usage diagnostic');
  const up = await runDiscoveryInSandbox(sandbox, ['up', '--typo']);
  assert.equal(up.status, 1, 'trailing up argument must still fail non-zero');
  assert.equal(up.stderr, UP_USAGE_DIAGNOSTIC, 'the unchanged up usage diagnostic');
  const setup = await runDiscoveryInSandbox(sandbox, ['setup', '--typo']);
  assert.equal(setup.status, 1, 'trailing setup argument must still fail non-zero');
  assert.equal(setup.stderr, SETUP_USAGE_DIAGNOSTIC, 'the unchanged setup usage diagnostic');
  const analyze = await runDiscoveryInSandbox(sandbox, ['analyze', '--typo']);
  assert.equal(analyze.status, 1, 'trailing analyze argument must still fail non-zero');
  assert.equal(analyze.stderr, ANALYZE_USAGE_DIAGNOSTIC, 'the unchanged analyze usage diagnostic');
  const status = await runDiscoveryInSandbox(sandbox, ['status', '--typo']);
  assert.equal(status.status, 1, 'trailing status argument must still fail non-zero');
  assert.equal(status.stderr, STATUS_USAGE_DIAGNOSTIC, 'the unchanged status usage diagnostic');
  const logs = await runDiscoveryInSandbox(sandbox, ['logs', '--follow']);
  assert.equal(logs.status, 1, 'malformed logs operand must still fail non-zero');
  assert.equal(logs.stderr, LOGS_USAGE_DIAGNOSTIC, 'the unchanged logs usage diagnostic');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero fake-Docker calls across the preserved boundaries');
  assert.deepEqual(curlCalls(sandbox), [], 'zero fake-curl calls across the preserved boundaries');
});

// ---------------------------------------------------------------------------
// CLI-10 (KaleidoSphere issue #214) — the request-bearing ask and search
// boundaries must fail closed on every missing or explicit-empty required
// operand form.
//
// ask "question" and search term each require one or more operand tokens.
// Every case runs a fresh disposable synthetic sandbox: a new mkdtemp
// directory holding a byte-identical copy of the shipped bin/bi, optional
// valid-looking setup sentinels (a synthetic .env plus a mode-0600 control
// token), and three fake executables first on PATH — a `stat` recorder that
// appends its argv to a local call log and answers the require_setup
// secret-mode probe with a deterministic 600, a `docker` recorder that
// appends its argv to a local call log and answers `compose port <service>
// <port>` with a deterministic 127.0.0.1:<port> binding, and a `curl`
// recorder that appends its argv to a local call log, records the request
// stdin payload byte-for-byte, and prints a deterministic synthetic
// downstream response, so the exact valid ask/search request path is
// observable end-to-end without a real daemon, network, or service. The
// sandbox PATH additionally provides the suite's own node executable,
// because the ask and search branches (alongside the discovery branch)
// invoke node for local JSON payload encoding; the fakes remain exactly the
// local stat, docker, and curl argv recorders. Each sandbox is removed when
// its test finishes. No real Docker, network, credential, database, or
// productive state is reached.
// ---------------------------------------------------------------------------

const ASK_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi ask "Largest tables by size"\n';
const SEARCH_USAGE_DIAGNOSTIC = 'KaleidoSphere ERROR: usage: ./bin/bi search orders\n';
// The usage diagnostic is command-specific: a missing or explicit-empty
// operand names the exact ask or search form the operator attempted.
const requestUsageDiagnostic = (command) =>
  command === 'ask' ? ASK_USAGE_DIAGNOSTIC : SEARCH_USAGE_DIAGNOSTIC;
// The usage diagnostic is a single-line stderr record: printable ASCII only
// and terminated by exactly one newline, so it is single-line and
// injection-free.
const REQUEST_USAGE_DIAGNOSTIC_SHAPE = /^[\x20-\x7E]+\n$/;
// The deterministic synthetic downstream response the fake curl recorder
// returns for the exact valid ask/search requests.
const REQUEST_FAKE_RESPONSE = '{"answer":"synthetic-request"}\n';

function buildRequestSandbox({ configured = true } = {}) {
  const root = mkdtempSync(path.join(ROOT, '.bi-request-sandbox-'));
  const fakeBin = path.join(root, 'fake-bin');
  const statLogPath = path.join(root, 'stat-calls.log');
  const logPath = path.join(root, 'docker-calls.log');
  const curlLogPath = path.join(root, 'curl-calls.log');
  const payloadLogPath = path.join(root, 'curl-payloads.log');
  const controlToken = path.join(root, '.runtime', 'secrets', 'control_token');
  mkdirSync(fakeBin);
  mkdirSync(path.join(root, 'bin'), { recursive: true });
  if (configured) {
    // Valid-looking setup sentinels: a synthetic .env, a mode-0600 control
    // token, a mode-0600 external connector secret, and an unrelated root
    // file, so a missing or explicit-empty operand must be rejected by the
    // operand gate alone, never by passing into require_setup and then the
    // Compose/curl request path.
    writeFileSync(path.join(root, '.env'), 'SYNTHETIC=1\n');
    mkdirSync(path.dirname(controlToken), { recursive: true });
    writeFileSync(controlToken, '0123456789abcdef\n');
    chmodSync(controlToken, 0o600);
    mkdirSync(path.join(root, '.secrets'), { recursive: true });
    writeFileSync(path.join(root, '.secrets', 'mssql_password'), '');
    chmodSync(path.join(root, '.secrets', 'mssql_password'), 0o600);
    writeFileSync(path.join(root, 'README-sentinel.md'), 'unrelated\n');
  }
  // The fake stat recorder: one line of joined argv per invocation, then the
  // deterministic 600 the require_setup secret-mode probe expects. It
  // shadows any real stat because fake-bin is first on PATH, so the setup
  // secret-mode inspection is observable without the real filesystem tool.
  const statPath = path.join(fakeBin, 'stat');
  const statScript =
    `#!/bin/sh\n` +
    `{ printf 'stat'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${statLogPath}'\n` +
    "printf '600\\n'\n" +
    'exit 0\n';
  writeFileSync(statPath, statScript);
  chmodSync(statPath, 0o755);
  // The fake docker recorder: one line of joined argv per invocation,
  // nothing else. It shadows any real docker because fake-bin is first on
  // PATH and answers `compose port <service> <port>` with a deterministic
  // 127.0.0.1:<port> binding, modeling a healthy local daemon so the exact
  // valid ask/search request path is observable end-to-end.
  const dockerPath = path.join(fakeBin, 'docker');
  const dockerScript =
    `#!/bin/sh\n` +
    `{ printf 'docker'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${logPath}'\n` +
    `case "$4" in port) printf '127.0.0.1:%s\\n' "$6" ;; esac\n` +
    'exit 0\n';
  writeFileSync(dockerPath, dockerScript);
  chmodSync(dockerPath, 0o755);
  // The fake curl recorder: one line of joined argv per invocation, the
  // request stdin payload appended byte-for-byte to its own log, then the
  // deterministic synthetic downstream response on stdout. It shadows any
  // real curl because fake-bin is first on PATH, so the ask/search request
  // and its exact JSON payload are observable without a network or service.
  const curlPath = path.join(fakeBin, 'curl');
  const curlScript =
    `#!/bin/sh\n` +
    `{ printf 'curl'; for a in "$@"; do printf ' %s' "$a"; done; printf '\\n'; } >> '${curlLogPath}'\n` +
    `cat >> '${payloadLogPath}'\n` +
    `printf '{"answer":"synthetic-request"}\\n'\n` +
    'exit 0\n';
  writeFileSync(curlPath, curlScript);
  chmodSync(curlPath, 0o755);
  // Run the exact shipped script bytes from inside the sandbox so bi_here is
  // the disposable sandbox root, never this repository.
  const biPath = path.join(root, 'bin', 'bi');
  writeFileSync(biPath, readFileSync(path.join(ROOT, 'bin', 'bi')));
  chmodSync(biPath, 0o755);
  return Object.freeze({
    root,
    statLogPath,
    logPath,
    curlLogPath,
    payloadLogPath,
    sentinels: Object.freeze({
      dotEnv: path.join(root, '.env'),
      controlToken,
      externalSecret: path.join(root, '.secrets', 'mssql_password'),
      unrelatedRoot: path.join(root, 'README-sentinel.md'),
    }),
    deleteAll: () => rmSync(root, { recursive: true, force: true }),
  });
}

function statCalls(sandbox) {
  if (!existsSync(sandbox.statLogPath)) return [];
  return readFileSync(sandbox.statLogPath, 'utf8').split('\n').filter((line) => line.length > 0);
}

function runRequestInSandbox(sandbox, args) {
  // The ask and search branches invoke node for local JSON payload encoding
  // (alongside the discovery branch), so their sandboxes additionally
  // provide the suite's own node executable on PATH; the fakes remain
  // exactly the local stat, docker, and curl argv recorders.
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(sandbox.root, 'bin', 'bi'), args, {
      cwd: sandbox.root,
      env: Object.freeze({
        PATH: `${path.join(sandbox.root, 'fake-bin')}:${path.dirname(process.execPath)}:/usr/bin:/bin`,
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

test('CLI-10-AC01: every missing or explicit-empty ask/search operand form fails closed with the command-specific deterministic bounded printable diagnostic, empty stdout, and zero fake-stat, fake-Docker, and fake-curl calls in configured and unconfigured sandboxes', async (t) => {
  // The configured sandboxes carry valid-looking setup sentinels (a synthetic
  // .env, a mode-0600 control token, a mode-0600 external connector secret,
  // and an unrelated root file), so every form must be rejected by the
  // operand gate alone — never by passing into require_setup and then the
  // Compose/curl request path. The unconfigured sandboxes carry no .env and
  // no control token. The explicit-empty operand plus a later value is the
  // form whose empty second entry the prior gate could only catch after
  // require_setup had already run.
  const operandForms = Object.freeze([
    Object.freeze(['ask']),
    Object.freeze(['ask', '']),
    Object.freeze(['ask', '', 'ignored']),
    Object.freeze(['search']),
    Object.freeze(['search', '']),
    Object.freeze(['search', '', 'ignored']),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    for (const form of operandForms) {
      const sandbox = buildRequestSandbox({ configured });
      sandboxes.push(sandbox);
      const result = await runRequestInSandbox(sandbox, form);
      const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
        result.stdout,
      )}, stderr=${JSON.stringify(result.stderr)}, statCalls=${JSON.stringify(
        statCalls(sandbox),
      )}, dockerCalls=${JSON.stringify(dockerCalls(sandbox))}, curlCalls=${JSON.stringify(
        curlCalls(sandbox),
      )}`;
      assert.equal(result.status, 1, `${JSON.stringify(form)} must fail non-zero, observed: ${observation}`);
      assert.equal(result.stdout, '', `${JSON.stringify(form)}: nothing to stdout`);
      assert.equal(
        result.stderr,
        requestUsageDiagnostic(form[0]),
        `${JSON.stringify(form)}: the deterministic command-specific bounded usage diagnostic`,
      );
      assert.match(
        result.stderr,
        REQUEST_USAGE_DIAGNOSTIC_SHAPE,
        `stderr stays printable ASCII with no control-byte injection: ${JSON.stringify(form)}`,
      );
      assert.ok(
        result.stderr.length < 512,
        `${JSON.stringify(form)}: stderr must stay bounded, got ${result.stderr.length}`,
      );
      assert.deepEqual(statCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-stat calls, ${observation}`);
      assert.deepEqual(dockerCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-Docker calls, ${observation}`);
      assert.deepEqual(curlCalls(sandbox), [], `${JSON.stringify(form)}: zero fake-curl calls, ${observation}`);
      assert.equal(curlPayload(sandbox), '', `${JSON.stringify(form)}: zero request payloads recorded, ${observation}`);
      if (configured) {
        assert.deepEqual(missingSentinels(sandbox), [], `${JSON.stringify(form)}: sentinels must survive, ${observation}`);
      }
    }
  }
});

test('CLI-10-AC02: the ask and search required-operand gate rejects before require_setup, stat, Compose, Node, curl, or any downstream action, with zero fake-stat, fake-Docker, and fake-curl calls in configured and unconfigured sandboxes', async (t) => {
  // A configured sandbox proves the gate is the operand gate (the exact
  // command-specific usage diagnostic, never a setup or request diagnostic,
  // and no secret-mode inspection) while valid-looking setup sentinels are
  // present; an unconfigured sandbox (no .env, no control token) proves the
  // operand gate runs before any setup check: a malformed ask or search must
  // report the usage diagnostic, never the setup diagnostic.
  const forms = Object.freeze([
    Object.freeze(['ask']),
    Object.freeze(['search']),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const configured of [true, false]) {
    for (const form of forms) {
      const sandbox = buildRequestSandbox({ configured });
      sandboxes.push(sandbox);
      const result = await runRequestInSandbox(sandbox, form);
      const observation = `configured=${configured}, exit ${result.status}, stdout=${JSON.stringify(
        result.stdout,
      )}, stderr=${JSON.stringify(result.stderr)}, statCalls=${JSON.stringify(
        statCalls(sandbox),
      )}, dockerCalls=${JSON.stringify(dockerCalls(sandbox))}, curlCalls=${JSON.stringify(
        curlCalls(sandbox),
      )}`;
      assert.equal(result.status, 1, `malformed ${form[0]} must fail non-zero, observed: ${observation}`);
      assert.equal(result.stdout, '', `${observation}: nothing to stdout`);
      assert.equal(
        result.stderr,
        requestUsageDiagnostic(form[0]),
        `${observation}: the operand gate must precede require_setup, stat, Compose, Node, and curl`,
      );
      assert.deepEqual(statCalls(sandbox), [], `${observation}: zero fake-stat calls`);
      assert.deepEqual(dockerCalls(sandbox), [], `${observation}: zero fake-Docker calls`);
      assert.deepEqual(curlCalls(sandbox), [], `${observation}: zero fake-curl calls`);
      assert.equal(curlPayload(sandbox), '', `${observation}: zero request payloads recorded`);
    }
  }
});

test('CLI-10-AC03: the exact valid single- and multi-token ask/search forms retain exactly one repository-scoped fake-Compose port lookup and exactly one fake-curl request carrying the byte-exact JSON message serialization, the deterministic fake response readback, empty stderr, a successful exit, and every sentinel preserved', async (t) => {
  const validForms = Object.freeze([
    Object.freeze({ args: Object.freeze(['ask', 'Largest tables by size']), payload: '{"message":"Largest tables by size"}' }),
    Object.freeze({ args: Object.freeze(['ask', 'Largest', 'tables']), payload: '{"message":"Largest tables"}' }),
    Object.freeze({ args: Object.freeze(['search', 'orders']), payload: '{"message":"Suche orders"}' }),
    Object.freeze({ args: Object.freeze(['search', 'orders', 'by', 'customer']), payload: '{"message":"Suche orders by customer"}' }),
  ]);
  const sandboxes = [];
  t.after(() => {
    for (const sandbox of sandboxes) sandbox.deleteAll();
  });
  for (const form of validForms) {
    const sandbox = buildRequestSandbox();
    sandboxes.push(sandbox);
    const label = JSON.stringify(form.args);
    const result = await runRequestInSandbox(sandbox, form.args);
    const observation = `exit ${result.status}, stdout=${JSON.stringify(result.stdout)}, stderr=${JSON.stringify(
      result.stderr,
    )}, statCalls=${JSON.stringify(statCalls(sandbox))}, dockerCalls=${JSON.stringify(
      dockerCalls(sandbox),
    )}, curlCalls=${JSON.stringify(curlCalls(sandbox))}, curlPayload=${JSON.stringify(curlPayload(sandbox))}`;
    assert.equal(result.status, 0, `valid ${label} must exit 0, observed: ${observation}`);
    assert.equal(result.stderr, '', `${label}: nothing to stderr on a successful request`);
    assert.equal(result.stdout, REQUEST_FAKE_RESPONSE, `${label}: the deterministic fake downstream response readback`);
    assert.deepEqual(
      dockerCalls(sandbox),
      [`docker compose --file ${sandbox.root}/compose.yaml port bi-agent 18790`],
      `${label}: exactly one repository-scoped Compose port lookup`,
    );
    assert.deepEqual(
      curlCalls(sandbox),
      [
        'curl --fail --silent --show-error --header content-type: application/json ' +
          '--data-binary @- ' +
          'http://127.0.0.1:18790/api/chat',
      ],
      `${label}: exactly one fake-curl request to the discovered loopback endpoint`,
    );
    assert.equal(
      curlPayload(sandbox),
      form.payload,
      `${label}: the byte-exact JSON message serialization`,
    );
    assert.deepEqual(
      statCalls(sandbox),
      [
        `stat -c %a ${sandbox.root}/.runtime/secrets/control_token`,
        `stat -c %a ${sandbox.root}/.secrets/mssql_password`,
      ],
      `${label}: exactly the two require_setup secret-mode probes on the configured sentinels`,
    );
    // ask/search must make no local mutation: every configured sentinel
    // survives.
    assert.deepEqual(missingSentinels(sandbox), [], `${label}: every configured sentinel must be preserved`);
  }
});

test('CLI-10-AC04: the ask/search operand gate leaves the prior #196/#198/#200/#202/#204/#206/#208/#210/#212 boundaries byte-exact in the same sandbox machinery', async (t) => {
  // The request-sandbox variant (fake stat, docker, and curl recorders) must
  // not perturb any other boundary: #196 unknown-command and known-command
  // dispatch, #198 exact reset confirmation, #200 exact down arity, #202
  // exact up arity, #204 exact setup arity, #206 exact analyze arity, #208
  // exact status arity, #210 exact logs operand, and #212 exact discovery
  // arity all keep their byte-exact behavior with zero tool calls.
  const sandbox = buildRequestSandbox();
  t.after(sandbox.deleteAll);
  const unknown = await runRequestInSandbox(sandbox, ['definitely-not-a-command']);
  assert.equal(unknown.status, 1, 'unknown command must still fail non-zero');
  assert.equal(
    unknown.stderr,
    `KaleidoSphere ERROR: unknown command: "definitely-not-a-command"\n${USAGE}\n`,
    'the unchanged unknown-command diagnostic',
  );
  const promotionBundle = await runRequestInSandbox(sandbox, ['promotion-bundle']);
  assert.equal(promotionBundle.status, 1, 'known-command validation must still fail non-zero');
  assert.equal(
    promotionBundle.stderr,
    'KaleidoSphere ERROR: usage: ./bin/bi promotion-bundle {build|inspect|preflight} ...\n',
    'the unchanged promotion-bundle validation diagnostic',
  );
  const reset = await runRequestInSandbox(sandbox, ['reset', '--yes-i-understand', '--typo']);
  assert.equal(reset.status, 1, 'trailing reset argument must still fail non-zero');
  assert.equal(reset.stderr, RESET_CONFIRMATION_DIAGNOSTIC, 'the unchanged reset confirmation diagnostic');
  const down = await runRequestInSandbox(sandbox, ['down', '--typo']);
  assert.equal(down.status, 1, 'trailing down argument must still fail non-zero');
  assert.equal(down.stderr, DOWN_USAGE_DIAGNOSTIC, 'the unchanged down usage diagnostic');
  const up = await runRequestInSandbox(sandbox, ['up', '--typo']);
  assert.equal(up.status, 1, 'trailing up argument must still fail non-zero');
  assert.equal(up.stderr, UP_USAGE_DIAGNOSTIC, 'the unchanged up usage diagnostic');
  const setup = await runRequestInSandbox(sandbox, ['setup', '--typo']);
  assert.equal(setup.status, 1, 'trailing setup argument must still fail non-zero');
  assert.equal(setup.stderr, SETUP_USAGE_DIAGNOSTIC, 'the unchanged setup usage diagnostic');
  const analyze = await runRequestInSandbox(sandbox, ['analyze', '--typo']);
  assert.equal(analyze.status, 1, 'trailing analyze argument must still fail non-zero');
  assert.equal(analyze.stderr, ANALYZE_USAGE_DIAGNOSTIC, 'the unchanged analyze usage diagnostic');
  const status = await runRequestInSandbox(sandbox, ['status', '--typo']);
  assert.equal(status.status, 1, 'trailing status argument must still fail non-zero');
  assert.equal(status.stderr, STATUS_USAGE_DIAGNOSTIC, 'the unchanged status usage diagnostic');
  const logs = await runRequestInSandbox(sandbox, ['logs', '--follow']);
  assert.equal(logs.status, 1, 'malformed logs operand must still fail non-zero');
  assert.equal(logs.stderr, LOGS_USAGE_DIAGNOSTIC, 'the unchanged logs usage diagnostic');
  const discovery = await runRequestInSandbox(sandbox, ['discovery', 'start', 'demo', '', 'ignored']);
  assert.equal(discovery.status, 1, 'fourth-or-later discovery entry must still fail non-zero');
  assert.equal(discovery.stderr, discoveryUsageDiagnostic('start'), 'the unchanged discovery usage diagnostic');
  assert.deepEqual(statCalls(sandbox), [], 'zero fake-stat calls across the preserved boundaries');
  assert.deepEqual(dockerCalls(sandbox), [], 'zero fake-Docker calls across the preserved boundaries');
  assert.deepEqual(curlCalls(sandbox), [], 'zero fake-curl calls across the preserved boundaries');
});
