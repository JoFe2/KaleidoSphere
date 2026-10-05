import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { request as httpsRequest } from 'node:https';
import tls from 'node:tls';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';


const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
const requireBrowser = createRequire(pathToFileURL(path.join(config.browserWorkspace, 'package.json')));
const { default: puppeteer } = await import(pathToFileURL(requireBrowser.resolve('puppeteer-core')));
const consumer = await import(pathToFileURL(config.repo + '/services/bi-control/src/runtime/pan-origin-source.mjs'));
const { createH02OptionalNativeIngressV1 } = await import(pathToFileURL(config.repo + '/services/bi-control/src/hosting/origin-session-ingress.mjs'));
const source = await consumer.loadH02PanSessionSourceV1(config.sessionSource);
const profile = await mkdtemp(path.join(tmpdir(), 'ks293-owned-verified-tls-firefox-'));
const cases = []; const network = []; const navigations = []; const submissions = []; let browser; let gateway; let failure;
const cert = await readFile(config.caPath);
const origin = config.httpsOrigin; const port = Number(new URL(origin).port);
const options = { optIn: true, source, origin, tls: config.tls, tenants: config.tenants };
function request(target, headers = {}, method = 'GET', value) {
  return new Promise((resolve, reject) => {
    const body = value === undefined ? undefined : JSON.stringify(value);
    const req = httpsRequest({ hostname: '127.0.0.1', port, servername: 'ks293.test', ca: cert,
      rejectUnauthorized: true, path: target, method, headers: { ...(body === undefined ? {} : {
        'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }), ...headers } }, res => {
      let text = ''; res.setEncoding('utf8'); res.on('data', chunk => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text,
        tlsAuthorized: req.socket.authorized, tlsProtocol: req.socket.getProtocol() }));
    }); req.on('error', reject); req.end(body);
  });
}
function record(id, value) { cases.push({ id, status: 'PASS', value }); console.log(JSON.stringify({ case: id, status: 'PASS' })); }
async function navigateObserved(page, target, reload = false) {
  // Require a real matching HTTP response even if BiDi goto's independent
  // navigation/history event race returns null. Never infer an HTTP status.
  const pending = page.waitForResponse(r => r.url() === target && r.request().method() === 'GET'
    && r.request().isNavigationRequest(), { timeout: 30000 });
  const [reported, response] = await Promise.all([
    reload ? page.reload({ waitUntil: 'networkidle0' }) : page.goto(target, { waitUntil: 'networkidle0' }), pending,
  ]);
  navigations.push({ url: response.url(), status: response.status(), gotoReturnedNull: reported === null,
    navigationRequest: response.request().isNavigationRequest(), documentUrl: await page.evaluate(() => location.href),
    title: await page.title(), secureContext: await page.evaluate(() => isSecureContext) });
  assert.equal(await page.evaluate(() => location.href), target);
  return response;
}
async function submit(page, message) {
  await page.$eval('#m', (node, text) => { node.value = text; }, message);
  // Existing native analysis is allowed up to 180 seconds. Attach rejection
  // handling immediately: a timeout during a BiDi click must preserve cleanup.
  const pending = page.waitForResponse(r => r.url().endsWith('/api/chat') && r.request().method() === 'POST', { timeout: 180000 })
    .then(response => ({ response }), error => ({ error }));
  await page.click('#f button'); const observed = await pending;
  if (observed.error) {
    const diagnostic = await page.evaluate(() => ({ output: document.getElementById('o').textContent,
      cookies: document.cookie.split(';').map(c => { const at = c.indexOf('='); const v = c.slice(at + 1);
        return { name: c.slice(0, at).trim(), valueLength: v.length, validHex64: /^[a-f0-9]{64}$/.test(v) }; }) }));
    submissions.push({ path: new URL(page.url()).pathname, diagnostic }); throw observed.error;
  }
  const r = observed.response; const value = await r.json();
  await page.waitForFunction(() => document.querySelector('#o')?.textContent !== 'Arbeite…');
  submissions.push({ origin: new URL(page.url()).origin, path: new URL(page.url()).pathname,
    status: r.status(), code: value.code ?? null, intent: value.intent ?? null });
  return { status: r.status(), value };
}
async function seed(context, issued, expiresAtMs) {
  await context.setCookie({ name: '__Host-ks293-session', value: issued.cookieHeader.slice('__Host-ks293-session='.length),
    domain: '127.0.0.1', path: '/', secure: true, httpOnly: true, sameSite: 'Strict', expires: Math.floor(expiresAtMs / 1000) },
  { name: '__Host-ks293-csrf', value: issued.csrf, domain: '127.0.0.1', path: '/', secure: true,
    httpOnly: false, sameSite: 'Strict', expires: Math.floor(expiresAtMs / 1000) });
}
try {
  gateway = createH02OptionalNativeIngressV1(options);
  await new Promise((resolve, reject) => { gateway.server.once('error', reject); gateway.server.listen(port, '127.0.0.1', resolve); });
  const expiresAtMs = Date.now() + 600000;
  const issuedA = gateway.issueOwnerSession('tenant-a', { subjectId: 'synthetic-native-reader-a', role: 'reader', expiresAtMs });
  const issuedB = gateway.issueOwnerSession('tenant-b', { subjectId: 'synthetic-native-reviewer-b', role: 'reviewer', expiresAtMs });
  const validA = { cookie: issuedA.cookieHeader, origin, 'x-pan527-csrf': issuedA.csrf };
  const pageProbe = await request('/t/tenant-a/', validA);
  assert.equal(pageProbe.status, 200); assert.equal(pageProbe.tlsAuthorized, true); assert.equal(pageProbe.tlsProtocol, 'TLSv1.3');
  assert.match(pageProbe.body, /<title>KaleidoSphere<\/title>/);
  assert.match(pageProbe.headers['set-cookie'][0], /^__Host-ks293-session=[a-f0-9]{64}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=/);
  record('actual-verified-TLS-native-page-and-producer-cookie-response', { status: pageProbe.status, tlsAuthorized: true, tlsProtocol: pageProbe.tlsProtocol });
  assert.equal((await request('/t/tenant-a/')).status, 401);
  execFileSync(config.certutil, ['-N', '--empty-password', '-d', 'sql:' + profile], { stdio: 'ignore' });
  execFileSync(config.certutil, ['-A', '-d', 'sql:' + profile, '-n', 'KS293 owned test CA', '-t', 'CT,C,C', '-i', config.caPath], { stdio: 'ignore' });
  browser = await puppeteer.launch({ browser: 'firefox', executablePath: config.firefoxPath, headless: true,
    userDataDir: profile, acceptInsecureCerts: false, timeout: 30000,
    extraPrefsFirefox: { 'security.enterprise_roots.enabled': false, 'network.proxy.type': 0,
      'network.captive-portal-service.enabled': false, 'network.connectivity-service.enabled': false,
      'datareporting.healthreport.uploadEnabled': false, 'toolkit.telemetry.enabled': false } });
  const contextA = await browser.createBrowserContext(); const contextB = await browser.createBrowserContext();
  await seed(contextA, issuedA, expiresAtMs); await seed(contextB, issuedB, expiresAtMs);
  const a = await contextA.newPage(); const b = await contextB.newPage();
  const pageErrors = []; const consoleErrors = [];
  for (const [tenant, page] of [['tenant-a', a], ['tenant-b', b]]) {
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', req => network.push({ tenant, url: req.url(), method: req.method(),
      hasCsrfHeader: Boolean(req.headers()['x-pan527-csrf']) }));
    page.on('response', res => network.push({ tenant, kind: 'response', url: res.url(), status: res.status() }));
    page.on('requestfailed', req => network.push({ tenant, kind: 'requestfailed', url: req.url(), error: req.failure()?.errorText }));
  }
  await a.setViewport({ width: 1440, height: 1000 });
  const aResponse = await navigateObserved(a, origin + '/t/tenant-a/');
  const bResponse = await navigateObserved(b, origin + '/t/tenant-b/');
  assert.equal(aResponse.status(), 200); assert.equal(bResponse.status(), 200);
  assert.equal(await a.evaluate(() => isSecureContext), true); assert.equal(await a.evaluate(() => location.origin), origin);
  assert.equal(await a.evaluate(() => document.cookie.includes('__Host-ks293-session=')), false);
  const cookie = (await contextA.cookies()).find(item => item.name === '__Host-ks293-session');
  assert.ok(cookie.secure && cookie.httpOnly && cookie.sameSite === 'Strict' && cookie.path === '/');
  await a.waitForFunction(() => document.querySelector('.brand-logo')?.naturalWidth > 0);
  await a.screenshot({ path: config.output + '/native-protected-desktop.png', fullPage: true });
  record('actual-certificate-verifying-browser-native-page-cookie', { browser: await browser.version(),
    secureContext: true, sessionCookieHttpOnly: true, secure: true, sameSite: 'Strict', certificateErrorsIgnored: false });
  const beforeA = await submit(a, 'Status');
  assert.equal(beforeA.status, 200, 'Actual native click must attach owner-issued CSRF and pass the pinned protected read boundary');
  const beforeB = await submit(b, 'Status'); assert.equal(beforeB.status, 200);
  assert.equal(beforeA.value.status.latestReceiptId, null); assert.equal(beforeB.value.status.latestReceiptId, null);
  record('actual-native-prefixed-click-CSRF-status-two-tenants', { a: beforeA.value, b: beforeB.value });
  const analysis = await submit(a, 'Analysiere die konfigurierte Datenbank');
  assert.equal(analysis.status, 200); assert.equal(analysis.value.intent, 'ANALYZE');
  assert.equal(analysis.value.analysisReceipt.status, 'ANALYZED_READ_ONLY');
  assert.equal(analysis.value.providerMode, 'stub'); assert.equal(analysis.value.readback.summary.relation_count, 2);
  assert.equal(analysis.value.readback.summary.column_count, 3); assert.equal(analysis.value.publication.mutationPerformed, false);
  record('actual-existing-browser-analysis-and-native-readback', analysis.value);
  const afterB = await submit(b, 'Status'); assert.equal(afterB.status, 200); assert.equal(afterB.value.status.latestReceiptId, null);
  record('actual-native-B-remains-unchanged-after-protected-A', afterB.value);
  for (const [message, expected] of [['SELECT * FROM secret_table', 'AGENT_UNSAFE_INPUT_DENIED'],
    ['unbekannte Aktion ausfuehren', 'AGENT_UNKNOWN_ACTION_DENIED'], ['publish dashboard', 'AGENT_UNKNOWN_ACTION_DENIED']]) {
    const denied = await submit(a, message); assert.equal(denied.status, 400); assert.equal(denied.value.code, expected);
    record('native-closed-input-denied-' + expected + '-' + cases.length, { status: denied.status, code: denied.value.code });
  }
  const csrfNegative = await a.evaluate(async () => {
    const rows = [];
    for (const extra of [{}, { 'x-pan527-csrf': '0'.repeat(64) }, { 'x-role': 'owner' }]) {
      const r = await fetch('/t/tenant-a/api/chat', { method: 'POST', headers: { 'content-type': 'application/json', ...extra }, body: JSON.stringify({ message: 'Status' }) });
      rows.push({ status: r.status, body: await r.json() });
    } return rows;
  });
  assert.deepEqual(csrfNegative.map(row => row.status), [403, 403, 403]);
  record('actual-browser-missing-invalid-CSRF-and-role-spoof-denied', csrfNegative);
  const routesNegative = await a.evaluate(async () => {
    const rows = [];
    for (const target of ['/t/tenant-b/', '/t/tenant-b/assets/kaleidosphere-logo.svg', '/t/tenant-a/run/secrets/control-auth',
      '/t/tenant-a/?redirect=https://not-owned.invalid', '/t/tenant-a/v1/publish']) {
      const r = await fetch(target); rows.push({ target, status: r.status, location: r.headers.get('location'), body: await r.json() });
    } return rows;
  });
  assert.deepEqual(routesNegative.map(row => row.status), [401, 401, 404, 404, 404]);
  assert.ok(routesNegative.every(row => row.location === null)); record('actual-browser-foreign-file-effect-and-redirect-alias-denials', routesNegative);
  const networkNegatives = [];
  for (const extra of [{ host: 'not-owned.invalid' }, { origin: 'https://not-owned.invalid' }, { 'x-tenant': 'tenant-b' },
    { authorization: 'caller-spoof' }, { forwarded: 'host=not-owned.invalid' }]) {
    const r = await request('/t/tenant-a/', { ...validA, ...extra }); networkNegatives.push({ status: r.status, tlsAuthorized: r.tlsAuthorized });
  }
  assert.deepEqual(networkNegatives.map(row => row.status), [421, 403, 403, 403, 403]);
  record('actual-verified-TLS-host-origin-tenant-header-authority-denials', networkNegatives);
  const upgrade = await new Promise((resolve, reject) => {
    const socket = tls.connect({ host: '127.0.0.1', port, servername: 'ks293.test', ca: cert, rejectUnauthorized: true }, () => {
      socket.write('GET /t/tenant-a/api/chat HTTP/1.1\r\nHost: ' + new URL(origin).host + '\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n');
    }); let data = ''; socket.on('data', chunk => { data += chunk; }); socket.on('end', () => resolve({ response: data, tlsAuthorized: socket.authorized })); socket.on('error', reject);
  });
  assert.match(upgrade.response, /^HTTP\/1\.1 403 Forbidden/); assert.equal(upgrade.tlsAuthorized, true);
  record('actual-verified-TLS-WebSocket-upgrade-denied', { status: 403, tlsAuthorized: true });
  const stateRoot = config.tenants[0].stateRoot; const keyPath = path.join(stateRoot, 'session-auth.key');
  await rename(keyPath, keyPath + '.owned-outage');
  try { const r = await request('/t/tenant-a/', validA); assert.equal(r.status, 503); record('actual-auth-key-outage-fail-closed-no-portal-fallback', { status: r.status }); }
  finally { await rename(keyPath + '.owned-outage', keyPath); }
  assert.equal((await request('/t/tenant-a/', validA)).status, 200);
  const shortExpiry = Date.now() + 5000;
  const short = gateway.issueOwnerSession('tenant-a', { subjectId: 'synthetic-browser-expiry', role: 'reader', expiresAtMs: shortExpiry });
  const expiredContext = await browser.createBrowserContext(); await seed(expiredContext, short, shortExpiry);
  const expiryPage = await expiredContext.newPage(); assert.equal((await navigateObserved(expiryPage, origin + '/t/tenant-a/')).status(), 200);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, shortExpiry - Date.now() + 100)));
  const late = await navigateObserved(expiryPage, origin + '/t/tenant-a/', true); assert.equal(late.status(), 401);
  const replayExpired = await request('/t/tenant-a/', { cookie: short.cookieHeader, origin, 'x-pan527-csrf': short.csrf });
  assert.equal(replayExpired.status, 401); assert.equal(JSON.parse(replayExpired.body).code, 'HOSTED_SESSION_DENIED');
  record('actual-browser-cookie-and-persisted-session-expiry-denied', { status: late.status() });
  record('actual-verified-TLS-expired-cookie-replay-denied', { status: replayExpired.status, code: 'HOSTED_SESSION_DENIED' });
  // Owned synthetic-store adversarial probe only. Use the producer's exact
  // canonical encoder and an isolated test key to keep MAC valid while changing
  // audience; otherwise a bad MAC would test integrity, not audience binding.
  const { canonicalJson } = await import(pathToFileURL(config.sessionSource + '/dist/packages/contracts/src/canonical-json.js'));
  const storePath = path.join(stateRoot, 'sessions.json'); const originalStore = await readFile(storePath);
  const envelope = JSON.parse(originalStore); const row = Object.values(envelope.payload.sessions)
    .find(value => value.subjectId === 'synthetic-native-reader-a');
  assert.equal(row.binding.audience, 'kaleidosphere-protected-control-origin-v1');
  row.binding.audience = 'pansphaira-hosted-origin-v1';
  const ownedKey = Buffer.from((await readFile(keyPath, 'utf8')).trim(), 'hex');
  envelope.mac = createHmac('sha256', ownedKey).update(canonicalJson(envelope.payload)).digest('hex'); ownedKey.fill(0);
  try {
    await writeFile(storePath, canonicalJson(envelope) + '\n', { mode: 0o600 });
    const deniedAudience = await request('/t/tenant-a/', validA);
    assert.equal(deniedAudience.status, 401); assert.equal(JSON.parse(deniedAudience.body).code, 'HOSTED_SESSION_DENIED');
    record('actual-verified-TLS-valid-MAC-wrong-audience-denied', { status: 401, code: 'HOSTED_SESSION_DENIED',
      changedOnlyClaim: 'binding.audience', isolatedSyntheticStore: true, noSigningImplementationAddedToProduct: true });
  } finally { await writeFile(storePath, originalStore, { mode: 0o600 }); }
  assert.ok((await readFile(storePath)).equals(originalStore)); assert.equal((await request('/t/tenant-a/', validA)).status, 200);
  const sessions = consumer.createH02PanProtectedRouteSessionsV1(source, { optIn: true, origin,
    routeBinding: config.tenants[0].routeBinding, stateRoot });
  for (const mutation of [{ instanceId: 'other-owned-control-instance' }, { generation: 2 }, { entrypointSha256: 'e'.repeat(64) }]) {
    const other = consumer.createH02PanProtectedRouteSessionsV1(source, { optIn: true, origin, stateRoot,
      routeBinding: { ...config.tenants[0].routeBinding, ...mutation } });
    assert.throws(() => other.authenticate(validA), /HOSTED_SESSION_DENIED/);
  }
  assert.equal(sessions.authorizeMutation, undefined);
  record('actual-native-bound-store-instance-generation-source-mismatch-denied', { cases: 3, mutationAuthorizationAbsent: true });
  assert.ok(network.filter(item => item.method === 'POST' && item.url.endsWith('/api/chat') && item.hasCsrfHeader).length >= 5);
  assert.deepEqual(pageErrors, []);
} catch (error) { failure = error; }
finally {
  if (browser) await browser.close();
  if (gateway?.server.listening) { gateway.server.closeAllConnections(); await new Promise(resolve => gateway.server.close(resolve)); }
  await rm(profile, { recursive: true, force: true }); consumer.releaseH02PanOriginSourceV1(source);
  await writeFile(config.output + '/native-protected-request-network.json', JSON.stringify(network, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  const receipt = { scope: 'Actual pinned PAN v3 protected KS control-route session / verified TLS / native browser-click integration development run; existing images with read-only agent overlay, NOT release/delivery or real-model acceptance',
    producerCommit: source.producerCommit, nativeBindings: config.tenants.map(spec => spec.routeBinding),
    browserCertificateVerificationEnabled: true, systemTrustUnchanged: true, syntheticFixture: true, modelMode: 'stub',
    tests: cases.length + (failure ? 1 : 0), pass: cases.length, fail: failure ? 1 : 0, skipped: 0,
    cases, navigations, submissions, failure: failure ? String(failure.message) : null, browserProfileRemoved: true, ownedIngressClosed: true };
  await writeFile(config.output + '/native-protected-browser-receipt.json', JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ pass: receipt.pass, fail: receipt.fail, skipped: 0,
    receipt: config.output + '/native-protected-browser-receipt.json', failure: receipt.failure }, null, 2));
}
if (failure) throw failure;
