// KS254 (#254) HTTP qualification harness. NOT a test suite: this is the shared driver the
// HTTP qualification suite and the native evidence runner use to start the REAL bi-control
// server (services/bi-control/src/server.mjs) on a free loopback port and speak to it over
// real HTTP.
//
// Boundaries this harness makes explicit:
//  * The server is the product entry point, not an extracted module: every assertion in the
//    suite observes an HTTP status/body produced by the running server.
//  * The control token is SYNTHETIC and generated per server start; it is written to a
//    0600 token file and is never echoed. Any captured server diagnostic that a caller
//    surfaces is passed through `redact` first, and the evidence runner scans its own
//    document for the token canary.
//  * The server binds the process's loopback interface inside the isolated container only;
//    no host install, port forward or external effect is performed.
//
// Nothing here grants publication or activation authority.

import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';

export const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
export const BI_CONTROL_ROOT = path.join(REPO_ROOT, 'services/bi-control');
export const CONTROL_SERVER_ENTRY = path.join(BI_CONTROL_ROOT, 'src', 'server.mjs');

// The synthetic control token is generated here and never logged. 24 random bytes (48 hex
// characters) is the same shape the product wiring uses.
export const syntheticControlToken = () => randomBytes(24).toString('hex');

export const freeLoopbackPort = () => new Promise((resolvePort, rejectPort) => {
  const probe = net.createServer();
  probe.once('error', rejectPort);
  probe.listen(0, '127.0.0.1', () => {
    const address = probe.address();
    probe.close(() => resolvePort(address.port));
  });
});

const delay = (ms) => new Promise((resolveDelay) => { const timer = setTimeout(resolveDelay, ms); timer.unref?.(); });

async function waitForHealth(url, child, deadlineMs) {
  const deadline = Date.now() + deadlineMs;
  for (;;) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    try {
      const response = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(500) });
      if (response.ok) return true;
    } catch { /* the listener is not up yet */ }
    if (Date.now() > deadline) return false;
    await delay(100);
  }
}

// Start the real server over loopback. `root` owns the receipt directory, the projection
// target and the synthetic token file; it must be outside the repository.
export async function startControlServer({
  root,
  serverRoot = BI_CONTROL_ROOT,
  engine = 'mssql',
  sourceMode = 'fixture',
  interruptAt = null,
  supersetMaterializerUrl = null,
  token = null,
  extraEnv = {},
} = {}) {
  mkdirSync(root, { recursive: true });
  const controlToken = token ?? syntheticControlToken();
  const tokenFile = path.join(root, 'control-token');
  writeFileSync(tokenFile, controlToken, { mode: 0o600 });
  const port = await freeLoopbackPort();
  const receiptDir = path.join(root, 'receipts');
  const projectionDb = path.join(root, 'projection', 'analytics.db');
  const env = {
    ...process.env,
    PORT: String(port),
    RECEIPT_DIR: receiptDir,
    PROJECTION_DB: projectionDb,
    REPOSITORY_ROOT: serverRoot,
    BI_ENGINE: engine,
    BI_SOURCE_MODE: sourceMode,
    CONTROL_TOKEN_FILE: tokenFile,
    ...extraEnv,
  };
  if (interruptAt === null) delete env.KS254_INTERRUPT_AT;
  else env.KS254_INTERRUPT_AT = interruptAt;
  if (supersetMaterializerUrl === null) delete env.SUPERSET_MATERIALIZER_URL;
  else env.SUPERSET_MATERIALIZER_URL = supersetMaterializerUrl;
  const child = spawn(process.execPath, [CONTROL_SERVER_ENTRY], {
    cwd: serverRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });
  let diagnostics = '';
  child.stdout.on('data', (chunk) => { diagnostics += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { diagnostics += chunk.toString('utf8'); });
  const exit = new Promise((resolveExit) => {
    child.once('exit', (code, signal) => resolveExit({ code, signal }));
  });
  const url = `http://127.0.0.1:${port}`;
  const redact = (text) => String(text).split(controlToken).join('[REDACTED]');
  const healthy = await waitForHealth(url, child, 20000);
  if (!healthy) {
    child.kill('SIGKILL');
    await exit;
    throw new Error(`KS254_HTTP_SERVER_UNAVAILABLE:${redact(diagnostics).slice(-500) || 'no diagnostics'}`);
  }
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await Promise.race([exit, delay(5000).then(() => { child.kill('SIGKILL'); })]);
    }
    return exit;
  };
  return {
    url, port, token: controlToken, tokenFile, receiptDir, projectionDb, child, exit, stop, redact,
    // `diagnostics` is redacted for safe surfacing; `rawDiagnostics` lets a caller prove the
    // synthetic token never appeared in the server's own output in the first place.
    diagnostics: () => redact(diagnostics),
    rawDiagnostics: () => diagnostics,
  };
}

// A real HTTP request against the running server. `auth` selects the Authorization header:
// 'bearer' (the product form), 'raw' (bare token), 'wrong' (a same-length non-token) or
// 'none'. The token itself is never returned in the result object.
export async function controlRequest(control, { method = 'POST', route, action, body, raw = null, auth = 'bearer', headers = {} } = {}) {
  const headerSet = { 'content-type': 'application/json', ...headers };
  if (auth === 'bearer') headerSet.authorization = `Bearer ${control.token}`;
  else if (auth === 'raw') headerSet.authorization = control.token;
  else if (auth === 'wrong') headerSet.authorization = `Bearer ${'0'.repeat(control.token.length)}`;
  else delete headerSet.authorization;
  const payload = raw !== null ? raw : (body !== undefined ? JSON.stringify(body) : (action !== undefined ? JSON.stringify({ action }) : undefined));
  const response = await fetch(`${control.url}${route}`, {
    method,
    headers: headerSet,
    body: payload,
    signal: AbortSignal.timeout(20000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: response.status, text, body: json };
}

// POST /v1/analyze against a server deliberately started with KS254_INTERRUPT_AT: the real
// server process really dies (SIGKILL) mid-request, so the client observes a transport
// failure and the awaited exit is a signal death. Both are returned for the assertion.
export async function analyzeIntoInterruption(control, point) {
  let transportError = null;
  try {
    await controlRequest(control, { route: '/v1/analyze', action: 'analyze' });
  } catch (error) {
    transportError = error;
  }
  const exit = await control.exit;
  return { point, transportError, exit };
}
