import { constants, openSync, fstatSync, readFileSync, closeSync } from 'node:fs';
import { createServer } from 'node:https';
import { isAbsolute, resolve } from 'node:path';
import { isProxy } from 'node:util/types';
import { createH02PanProtectedRouteSessionsV1, validateH02PanOriginV1 } from '../runtime/pan-origin-source.mjs';
import { resolveH02NativeBrowserRouteV1 } from '../../../bi-agent/src/hosted-route-policy.mjs';

function deny(code) { throw new Error(code); }
function exact(value, keys, code) {
  if (!value || typeof value !== 'object' || isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) deny(code);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).some(key => typeof key !== 'string')
    || Object.keys(fields).length !== keys.length || keys.some(key => !Object.hasOwn(fields, key))
    || Object.values(fields).some(field => field.get || field.set || !field.enumerable)) deny(code);
}
function tlsBytes(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) deny('H02_TLS_FILE_DENIED');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.uid !== process.getuid() || stat.nlink !== 1
      || (stat.mode & 0o777) !== 0o600 || stat.size < 1 || stat.size > 262144) deny('H02_TLS_FILE_DENIED');
    return readFileSync(fd);
  } finally { closeSync(fd); }
}
function reply(response, status, code) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ status: 'DENIED', code }));
}
async function readBody(request) {
  if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? '')) deny('H02_NATIVE_CONTENT_TYPE_DENIED');
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) deny('H02_NATIVE_BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function principalAtUse(product, headers, operation) {
  // Route selection is not authorization. The shared producer rechecks the
  // protected session, and explicitly checks CSRF for each read POST.
  const principal = operation ? product.sessions.authorizeReadOperation(headers) : product.sessions.authenticate(headers);
  const expected = product.sessions.binding;
  if (principal.tenantId !== expected.tenantId || principal.instanceId !== expected.instanceId
    || principal.generation !== expected.generation || principal.componentId !== 'kaleidosphere-bi-control'
    || !['reader', 'reviewer'].includes(principal.role)) deny('H02_NATIVE_PRINCIPAL_DENIED');
  return principal;
}

// KS-owned HTTPS-to-existing-native-page dispatch only. Common origin/session/
// signature/storage/CSRF semantics come exclusively from the pinned PAN source.
// There is no HTTP issuance/login route, arbitrary proxy, OIDC fallback, direct
// control-token forwarding from a caller, or trusted mutation endpoint.
export function createH02OptionalNativeIngressV1(options) {
  if (!options || isProxy(options) || Object.getOwnPropertyDescriptor(options, 'optIn')?.value !== true) deny('H02_HOSTED_OPT_IN_REQUIRED');
  exact(options, ['optIn', 'source', 'origin', 'tls', 'tenants'], 'H02_HOSTED_OPTIONS_DENIED');
  const origin = validateH02PanOriginV1(options.source, options.origin);
  const originUrl = new URL(origin);
  exact(options.tls, ['keyPath', 'certPath'], 'H02_TLS_OPTIONS_DENIED');
  if (!Array.isArray(options.tenants) || isProxy(options.tenants)
    || Object.getPrototypeOf(options.tenants) !== Array.prototype
    || options.tenants.length < 1 || options.tenants.length > 8) deny('H02_NATIVE_TENANTS_DENIED');
  const products = new Map(); const stateRoots = []; const upstreams = new Set();
  for (const tenant of options.tenants) {
    exact(tenant, ['routeBinding', 'stateRoot', 'agentOrigin'], 'H02_NATIVE_TENANTS_DENIED');
    if (typeof tenant.agentOrigin !== 'string' || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(tenant.agentOrigin)
      || new URL(tenant.agentOrigin).origin !== tenant.agentOrigin || new URL(tenant.agentOrigin).port === '') deny('H02_NATIVE_UPSTREAM_DENIED');
    // A PAN-only predecessor or copied source fails here, before TLS/listener
    // creation. No missing capability is silently replaced with a KS session.
    const sessions = createH02PanProtectedRouteSessionsV1(options.source,
      { optIn: true, origin, routeBinding: tenant.routeBinding, stateRoot: tenant.stateRoot });
    const tenantId = sessions.binding.tenantId;
    resolveH02NativeBrowserRouteV1(tenantId, 'GET', '/t/' + tenantId + '/');
    if (products.has(tenantId) || upstreams.has(tenant.agentOrigin)
      || stateRoots.some(root => root === tenant.stateRoot || root.startsWith(tenant.stateRoot + '/') || tenant.stateRoot.startsWith(root + '/'))) deny('H02_NATIVE_TENANTS_DENIED');
    products.set(tenantId, { sessions, agentOrigin: tenant.agentOrigin });
    upstreams.add(tenant.agentOrigin); stateRoots.push(tenant.stateRoot);
  }
  const server = createServer({ key: tlsBytes(options.tls.keyPath), cert: tlsBytes(options.tls.certPath),
    minVersion: 'TLSv1.3', maxHeaderSize: 8192 }, async (request, response) => {
    response.setHeader('cache-control', 'no-store'); response.setHeader('x-content-type-options', 'nosniff');
    response.setHeader('referrer-policy', 'no-referrer'); response.setHeader('strict-transport-security', 'max-age=86400');
    response.setHeader('x-frame-options', 'DENY');
    try {
      const address = server.address();
      if (!request.socket.encrypted || address?.address !== '127.0.0.1' || request.socket.remoteAddress !== '127.0.0.1'
        || request.socket.localPort !== Number(originUrl.port || 443)) return reply(response, 403, 'H02_NATIVE_LOOPBACK_BOUNDARY_DENIED');
      if (request.headers.host !== originUrl.host) return reply(response, 421, 'HOSTED_HOST_DENIED');
      for (const key of ['host', 'origin', 'cookie', 'content-type', 'content-length', 'x-pan527-csrf']) {
        if (request.rawHeaders.filter((_, i) => i % 2 === 0 && request.rawHeaders[i].toLowerCase() === key).length > 1) return reply(response, 403, 'H02_DUPLICATE_HEADER_DENIED');
      }
      if ((request.headers.origin !== undefined && request.headers.origin !== origin)
        || (request.headers['sec-fetch-site'] !== undefined && !['same-origin', 'none'].includes(request.headers['sec-fetch-site']))) return reply(response, 403, 'HOSTED_ORIGIN_DENIED');
      const tenantId = /^\/t\/([a-z0-9][a-z0-9-]{0,63})\//.exec(request.url ?? '')?.[1];
      const product = products.get(tenantId);
      if (!product) return reply(response, 401, 'HOSTED_SESSION_DENIED');
      const route = resolveH02NativeBrowserRouteV1(tenantId, request.method, request.url);
      const operation = route.kind === 'read-operation';
      principalAtUse(product, request.headers, operation);
      const body = operation ? await readBody(request) : undefined;
      principalAtUse(product, request.headers, operation);
      // Only fixed loopback upstreams and exact native scoped targets. Browser
      // cookies/roles/auth headers never become internal control credentials.
      const native = await fetch(product.agentOrigin + route.requestTarget, { method: request.method,
        redirect: 'manual', headers: operation ? { 'content-type': 'application/json' } : {},
        ...(operation ? { body } : {}), signal: AbortSignal.timeout(180000) });
      if (native.status >= 300 && native.status <= 399) {
        await native.body?.cancel(); deny('H02_NATIVE_REDIRECT_DENIED');
      }
      const chunks = []; let size = 0;
      if (native.body) for await (const chunk of native.body) {
        size += chunk.length;
        if (size > 2097152) deny('H02_NATIVE_RESPONSE_TOO_LARGE');
        chunks.push(Buffer.from(chunk));
      }
      principalAtUse(product, request.headers, operation);
      const bytes = Buffer.concat(chunks);
      response.setHeader('set-cookie', product.sessions.responseCookie(request.headers));
      const contentType = native.headers.get('content-type');
      if (!contentType || !/^(?:text\/html|application\/(?:json|manifest\+json)|image\/(?:png|svg\+xml))(?:; charset=utf-8)?$/i.test(contentType)) deny('H02_NATIVE_RESPONSE_TYPE_DENIED');
      response.setHeader('content-type', contentType); response.setHeader('content-length', bytes.length);
      // The native page retains its existing bounded script/style behavior;
      // transport still forbids foreign connections, frames and base rewrites.
      response.setHeader('content-security-policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'");
      response.writeHead(native.status); response.end(bytes);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const code = String(error?.message ?? 'H02_NATIVE_UPSTREAM_UNAVAILABLE');
      if (code === 'HOSTED_SESSION_DENIED') reply(response, 401, code);
      else if (['HOSTED_CSRF_DENIED', 'HOSTED_HEADER_AUTHORITY_DENIED', 'H02_NATIVE_PRINCIPAL_DENIED'].includes(code)) reply(response, 403, code);
      else if (code === 'H02_PRODUCT_ROUTE_DENIED') reply(response, 404, code);
      else if (code.startsWith('H02_NATIVE_BODY_') || code === 'H02_NATIVE_CONTENT_TYPE_DENIED') reply(response, 400, code);
      else reply(response, 503, code === 'HOSTED_AUTH_UNAVAILABLE' ? code : 'H02_NATIVE_BOUNDARY_UNAVAILABLE');
    }
  });
  server.maxHeadersCount = 32; server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 1000;
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'));
  for (const event of ['checkContinue', 'checkExpectation']) server.on(event, (_request, response) => reply(response, 417, 'H02_EXPECTATION_DENIED'));
  return Object.freeze({ server,
    issueOwnerSession(tenantId, principal) {
      const product = products.get(tenantId); if (!product) deny('H02_NATIVE_TENANT_DENIED');
      const issued = product.sessions.issueOwnerSession(principal);
      const maxAge = /; Max-Age=([1-9][0-9]*)$/.exec(issued.setCookie)?.[1];
      if (!/^[a-f0-9]{64}$/.test(issued.csrf) || !maxAge) deny('H02_NATIVE_COOKIE_DENIED');
      // A non-authentication anti-CSRF token for the native prefixed page.
      // The HttpOnly session remains producer-owned; knowing this token alone
      // cannot authenticate, mint a principal, or grant mutation authority.
      return Object.freeze({ ...issued, csrfSetCookie: '__Host-ks293-csrf=' + issued.csrf
        + '; Path=/; Secure; SameSite=Strict; Max-Age=' + maxAge });
    },
  });
}
