import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, chmodSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { request as httpsRequest } from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadH02PanSessionSourceV1, releaseH02PanOriginSourceV1 } from '../services/bi-control/src/runtime/pan-origin-source.mjs';
import { createH02OptionalNativeIngressV1 } from '../services/bi-control/src/hosting/origin-session-ingress.mjs';

// Real TLS/session/dispatch protocol regressions over controlled loopback HTTP
// responses. These are not the separately retained native KS browser journey.
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) {
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  return server.address().port;
}
async function close(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
}
async function setup() {
  const root = mkdtempSync(join(tmpdir(), 'ks293-https-network-'));
  let source; let gateway; let upstream; let destination; let reserved; let mode = 'allow'; let held; let releaseHeld;
  const calls = []; const followed = [];
  try {
    const keyPath = join(root, 'leaf.key'); const certPath = join(root, 'leaf.crt');
    const caKey = join(root, 'ca.key'); const caPath = join(root, 'ca.crt'); const csr = join(root, 'leaf.csr'); const ext = join(root, 'leaf.ext');
    const openssl = args => execFileSync('openssl', args, { stdio: 'ignore', timeout: 10000 });
    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', caKey, '-out', caPath, '-days', '1', '-subj', '/CN=ks293-owned-CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', csr, '-subj', '/CN=ks293.test']);
    writeFileSync(ext, 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=IP:127.0.0.1,DNS:ks293.test\n');
    openssl(['x509', '-req', '-in', csr, '-CA', caPath, '-CAkey', caKey, '-set_serial', '1', '-out', certPath, '-days', '1', '-sha256', '-extfile', ext]);
    for (const file of [keyPath, certPath, caKey, caPath, csr, ext]) chmodSync(file, 0o600);
    const ca = readFileSync(caPath);
    destination = http.createServer((request, response) => { followed.push(request.url); response.end('must not be reached'); });
    const foreignPort = await listen(destination);
    upstream = http.createServer((request, response) => {
      calls.push({ url: request.url, method: request.method, headers: request.headers });
      const reply = () => { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end('<title>KaleidoSphere</title>'); };
      if (mode === 'redirect') { response.writeHead(302, { location: `http://127.0.0.1:${foreignPort}/must-not-follow` }); response.end(); }
      else if (mode === 'hold') { releaseHeld = reply; held(); }
      else reply();
    });
    const upstreamPort = await listen(upstream);
    reserved = net.createServer(); const port = await listen(reserved); await close(reserved);
    source = await loadH02PanSessionSourceV1(process.env.KS293_PAN527_SESSION_SOURCE);
    const stateRoot = join(root, 'sessions'); mkdirSync(stateRoot, { mode: 0o700 });
    const origin = `https://127.0.0.1:${port}`;
    const routeBinding = { schemaVersion: 'pansphaira.hosted-origin-session/protected-route-binding/v1', componentId: 'kaleidosphere-bi-control',
      entrypointPath: 'services/bi-control/src/server.mjs', sourceCommit: '67c611c6b523d8d8ee329a65f8a00a589de81e1e', sourceTree: 'c36229b762bac232eb5cc942c9d68272076ee46c',
      entrypointSha256: '8b4e3bed4aec797dd4d556148c48530736fe991fa25cfaae1412c8b97319eda1', runtime: { name: 'node', version: process.version.slice(1) },
      instanceId: 'ks293-network-shape-fixture', tenantId: 'tenant-a', generation: 1 };
    gateway = createH02OptionalNativeIngressV1({ optIn: true, source, origin, tls: { keyPath, certPath }, tenants: [{ routeBinding, stateRoot, agentOrigin: `http://127.0.0.1:${upstreamPort}` }] });
    await new Promise((resolve, reject) => gateway.server.once('error', reject).listen(port, '127.0.0.1', resolve));
    function startRequest(target, headers = {}, method = 'GET') {
      let request;
      const result = new Promise((resolve, reject) => {
        request = httpsRequest({ hostname: '127.0.0.1', port, servername: 'ks293.test', ca, rejectUnauthorized: true, path: target, method, headers }, response => {
          let body = ''; response.setEncoding('utf8'); response.on('data', chunk => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode, body, headers: response.headers, tlsAuthorized: request.socket.authorized }));
        }); request.on('error', reject);
      });
      return { request, result };
    }
    async function request(target, headers, method = 'GET', body) { const started = startRequest(target, headers, method); started.request.end(body); return started.result; }
    function issue(expiresAtMs = Date.now() + 60000) { const issued = gateway.issueOwnerSession('tenant-a', { subjectId: 'synthetic-network-reader', role: 'reader', expiresAtMs });
      return { cookie: issued.cookieHeader, origin, 'x-pan527-csrf': issued.csrf }; }
    return { gateway, ca, origin, port, calls, followed, request, startRequest, issue,
      redirect() { mode = 'redirect'; }, hold() { mode = 'hold'; return new Promise(resolve => { held = resolve; }); }, release() { releaseHeld(); },
      async cleanup() { await close(gateway.server); await close(upstream); await close(destination); releaseH02PanOriginSourceV1(source); rmSync(root, { recursive: true, force: true }); } };
  } catch (error) {
    await close(gateway?.server); await close(upstream); await close(destination); await close(reserved);
    if (source) releaseH02PanOriginSourceV1(source); rmSync(root, { recursive: true, force: true }); throw error;
  }
}

test('H02 real verified TLS protocol refuses redirects and duplicate authority headers without forwarding caller credentials', { timeout: 30000 }, async () => {
  const fixture = await setup();
  try {
    const headers = fixture.issue(); const good = await fixture.request('/t/tenant-a/', headers);
    assert.equal(good.status, 200); assert.equal(good.tlsAuthorized, true);
    assert.match(good.headers['set-cookie'][0], /; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=/);
    const actual = fixture.calls.at(-1); assert.equal(actual.url, '/t/tenant-a/');
    for (const field of ['cookie', 'authorization', 'x-role', 'x-tenant', 'x-pan527-csrf']) assert.equal(actual.headers[field], undefined);
    const before = fixture.calls.length;
    assert.equal((await fixture.request('/t/tenant-a/')).status, 401);
    assert.equal((await fixture.request('/t/tenant-a/', { ...headers, 'x-role': 'owner' })).status, 403);
    const noCsrf = await fixture.request('/t/tenant-a/api/chat', { cookie: headers.cookie, origin: fixture.origin, 'content-type': 'application/json' }, 'POST', '{"message":"Status"}');
    assert.equal(noCsrf.status, 403); assert.equal(JSON.parse(noCsrf.body).code, 'HOSTED_CSRF_DENIED');
    assert.equal(fixture.calls.length, before);
    const duplicate = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: '127.0.0.1', port: fixture.port, servername: 'ks293.test', ca: fixture.ca, rejectUnauthorized: true }, () => {
        socket.write(`GET /t/tenant-a/ HTTP/1.1\r\nHost: ${new URL(fixture.origin).host}\r\nCookie: ${headers.cookie}\r\nCookie: ${headers.cookie}\r\nConnection: close\r\n\r\n`);
      }); let body = ''; socket.on('data', chunk => { body += chunk; }); socket.on('end', () => resolve(body)); socket.on('error', reject);
    });
    assert.match(duplicate, /^HTTP\/1\.1 403 /); assert.match(duplicate, /H02_DUPLICATE_HEADER_DENIED/);
    assert.equal(fixture.calls.length, before);
    fixture.redirect(); const redirect = await fixture.request('/t/tenant-a/', headers);
    assert.equal(redirect.status, 503); assert.equal(redirect.headers.location, undefined);
    assert.equal(JSON.parse(redirect.body).code, 'H02_NATIVE_BOUNDARY_UNAVAILABLE'); assert.deepEqual(fixture.followed, []);
  } finally { await fixture.cleanup(); }
});

test('H02 session expiry during admitted async request body denies before native dispatch', { timeout: 30000 }, async () => {
  const fixture = await setup();
  try {
    const expiresAtMs = Date.now() + 6000; const headers = fixture.issue(expiresAtMs);
    const admitted = new Promise(resolve => fixture.gateway.server.once('request', (_request, response) => resolve({ headersSent: response.headersSent })));
    const started = fixture.startRequest('/t/tenant-a/api/chat', { ...headers, 'content-type': 'application/json' }, 'POST');
    started.request.write('{"message":');
    assert.equal((await admitted).headersSent, false, 'Session must pass initial admission and be awaiting the incomplete body');
    await delay(Math.max(0, expiresAtMs - Date.now() + 100)); started.request.end('"Status"}');
    const denied = await started.result; assert.equal(denied.status, 401); assert.equal(JSON.parse(denied.body).code, 'HOSTED_SESSION_DENIED');
    assert.equal(fixture.calls.length, 0);
  } finally { await fixture.cleanup(); }
});

test('H02 session expiry during actual upstream response await denies before native bytes or cookie release', { timeout: 30000 }, async () => {
  const fixture = await setup();
  try {
    const expiresAtMs = Date.now() + 6000; const headers = fixture.issue(expiresAtMs); const reached = fixture.hold();
    const pending = fixture.request('/t/tenant-a/', headers); await reached; assert.equal(fixture.calls.length, 1);
    await delay(Math.max(0, expiresAtMs - Date.now() + 100)); fixture.release();
    const denied = await pending; assert.equal(denied.status, 401); assert.equal(JSON.parse(denied.body).code, 'HOSTED_SESSION_DENIED');
    assert.equal(denied.headers['set-cookie'], undefined); assert.doesNotMatch(denied.body, /<title>/);
  } finally { await fixture.cleanup(); }
});
