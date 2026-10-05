const assets = new Set(['kaleidosphere-logo.svg', 'kaleidosphere-logo.png', 'favicon-16x16.png',
  'favicon-32x32.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'site.webmanifest']);

// KS-owned closed native page/asset/read-request dispatch policy, not a common
// session contract. The ingress must authenticate with the pinned PAN producer
// BEFORE using a selected route. A policy result grants no effect authority.
export function resolveH02NativeBrowserRouteV1(tenantId, method, requestTarget) {
  const deny = () => { throw new Error('H02_PRODUCT_ROUTE_DENIED'); };
  if (typeof tenantId !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(tenantId)
    || typeof requestTarget !== 'string' || requestTarget.length > 256) deny();
  const prefix = '/t/' + tenantId;
  let kind;
  if (method === 'GET' && requestTarget === prefix + '/') kind = 'page';
  else if (method === 'POST' && requestTarget === prefix + '/api/chat') kind = 'read-operation';
  else if (method === 'GET' && requestTarget.startsWith(prefix + '/assets/')
    && assets.has(requestTarget.slice((prefix + '/assets/').length))) kind = 'asset';
  else deny();
  return Object.freeze({ tenantId, requestTarget, kind });
}
