import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const legacyPageSha256 = 'fb9be352665c1fce4cabc1bf9881c2c8ec410dc46f117a0020c6750c7c724777';
async function acquirePage(prefix) {
  const reserved = net.createServer();
  await new Promise((resolve, reject) => reserved.once('error', reject).listen(0, '127.0.0.1', resolve));
  const port = reserved.address().port;
  await new Promise(resolve => reserved.close(resolve));
  const env = { ...process.env, PORT: String(port), CONTROL_BASE_URL: 'http://bi-control:18089' };
  if (prefix) env.AGENT_ROUTE_PREFIX = prefix; else delete env.AGENT_ROUTE_PREFIX;
  const child = spawn(process.execPath, ['services/bi-agent/src/server.mjs'], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes.toString(); });
  try {
    let response;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      assert.equal(child.exitCode, null, stderr);
      try { response = await fetch(`http://127.0.0.1:${port}${prefix}/`); if (response.status === 200) break; } catch {}
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(response?.status, 200);
    return await response.text();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await exited; } finally { clearTimeout(timer); }
    }
  }
}
function renderedSubmission(html, cookieValue, denyCookieRead = false) {
  const calls = []; const output = { textContent: 'Bereit.' }; const input = { value: 'Status' }; let handler;
  const document = { getElementById(id) {
    if (id === 'f') return { addEventListener(event, fn) { assert.equal(event, 'submit'); handler = fn; } };
    return id === 'm' ? input : output;
  } };
  Object.defineProperty(document, 'cookie', { get() { if (denyCookieRead) throw Error('Legacy page must not read cookies'); return cookieValue; } });
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]; assert.equal(scripts.length, 1);
  vm.runInNewContext(scripts[0][1], { document, fetch: async (url, options) => {
    calls.push({ url, ...JSON.parse(JSON.stringify(options)) });
    return { json: async () => ({ intent: 'STATUS' }) };
  } });
  assert.equal(typeof handler, 'function');
  return { calls, output, setCookie(value) { cookieValue = value; }, click: () => handler({ preventDefault() {} }) };
}

test('H02 prefixed native form copies only its exact current owner-issued anti-CSRF token into the same native POST', { timeout: 10000 }, async () => {
  const html = await acquirePage('/t/tenant-a'); const first = 'a'.repeat(64); const next = 'b'.repeat(64);
  const page = renderedSubmission(html, 'unrelated=ignored; __Host-ks293-csrf=' + first);
  await page.click();
  assert.equal(page.calls.length, 1);
  assert.deepEqual(page.calls[0], { url: '/t/tenant-a/api/chat', method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pan527-csrf': first }, body: '{"message":"Status"}' });
  page.setCookie('__Host-ks293-csrf=' + next); await page.click();
  assert.equal(page.calls[1].headers['x-pan527-csrf'], next);
  for (const invalid of ['', 'csrf=' + first, '__Host-ks293-csrf=bad', '__Host-ks293-csrf=' + first.toUpperCase(),
    '__Host-ks293-csrf=' + first + '; __Host-ks293-csrf=' + next, '__Host-ks293-session=' + first]) {
    page.setCookie(invalid); const before = page.calls.length; await page.click();
    assert.equal(page.calls.length, before, 'Malformed/missing/duplicate tokens must not dispatch a request');
    assert.match(page.output.textContent, /AGENT_CSRF_TOKEN_DENIED/);
  }
});

test('H02 absent hosted prefix preserves accepted local HTML bytes and original cookie-free form submission', { timeout: 10000 }, async () => {
  const html = await acquirePage(''); assert.equal(createHash('sha256').update(html).digest('hex'), legacyPageSha256);
  const page = renderedSubmission(html, '', true); await page.click();
  assert.deepEqual(page.calls, [{ url: '/api/chat', method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"Status"}' }]);
  assert.match(page.output.textContent, /STATUS/);
});
