import http from 'node:http';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {setTimeout as delay} from 'node:timers/promises';
import {canonicalJson} from './core.mjs';

export const BOUNDED_API_READ_PROFILE_SCHEMA = 'kaleidosphere.api/bounded-read-profile/v1';
const ENDPOINT = '/k07/v1/records';
const FIELDS = Object.freeze(['id', 'category', 'quantity']);
const fail = (code) => {const error = new Error(code); error.code = code; throw error;};
const hash = (value) => createHash('sha256').update(canonicalJson(value)).digest('hex');
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) => object(value) && Object.keys(value).length === allowed.length && allowed.every((key) => Object.hasOwn(value, key));
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;

export function validateBoundedApiReadProfile(profile) {
  if (!object(profile) || profile.schemaVersion !== BOUNDED_API_READ_PROFILE_SCHEMA) fail('K07_PROFILE_DENIED');
  if (profile.mode !== 'LOCAL_SYNTHETIC_FIXTURE' || profile.source?.kind !== 'k07-owned-rest-fixture-v1') fail('K07_SOURCE_NOT_AUTHORIZED');
  if (!keys(profile, ['schemaVersion', 'profileId', 'mode', 'source', 'scope', 'policy'])
    || typeof profile.profileId !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(profile.profileId)
    || !keys(profile.source, ['kind', 'origin', 'secretEnv'])
    || typeof profile.source.secretEnv !== 'string' || !/^KS289_LOCAL_FIXTURE_[A-F0-9]{16}$/.test(profile.source.secretEnv)
    || !keys(profile.scope, ['endpoint', 'fields']) || profile.scope.endpoint !== ENDPOINT
    || !Array.isArray(profile.scope.fields) || canonicalJson(profile.scope.fields) !== canonicalJson(FIELDS)) fail('K07_PROFILE_DENIED');
  let origin;
  try {origin = new URL(profile.source.origin);} catch {fail('K07_PROFILE_DENIED');}
  if (typeof profile.source.origin !== 'string' || origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1'
    || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash
    || profile.source.origin !== origin.origin || !integer(Number(origin.port), 1, 65535)) fail('K07_SOURCE_NOT_AUTHORIZED');
  const policy = profile.policy;
  if (!keys(policy, ['maxPages', 'maxObjects', 'maxPageBytes', 'requestTimeoutMs', 'totalTimeoutMs', 'minRequestIntervalMs'])
    || !integer(policy.maxPages, 1, 64) || !integer(policy.maxObjects, 1, 10000)
    || !integer(policy.maxPageBytes, 64, 1048576) || !integer(policy.requestTimeoutMs, 10, 30000)
    || !integer(policy.totalTimeoutMs, policy.requestTimeoutMs, 60000) || !integer(policy.minRequestIntervalMs, 0, 1000)) fail('K07_PROFILE_DENIED');
  return structuredClone(profile);
}

function requestPage({url, secret, expectedSnapshot, maxBytes, timeoutMs, signal}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let response;
    let timer;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      response?.destroy();
      request.destroy();
      if (error) reject(error); else resolve(value);
    };
    const rejectCode = (code) => {const error = new Error(code); error.code = code; finish(error);};
    const abort = () => rejectCode('K07_CANCELLED');
    const headers = {accept: 'application/json', authorization: `Bearer ${secret}`};
    if (expectedSnapshot !== null) headers['if-match'] = `"${expectedSnapshot}"`;
    const request = http.request(url, {method: 'GET', headers, agent: false, maxHeaderSize: 8192}, (res) => {
      response = res;
      if (res.statusCode !== 200) return finish(null, {status: res.statusCode});
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(res.headers['content-type'] ?? '')
        || ![undefined, 'identity'].includes(res.headers['content-encoding'])) return rejectCode('K07_RESPONSE_DENIED');
      let bytes = 0;
      const chunks = [];
      res.on('data', (chunk) => {bytes += chunk.length; if (bytes > maxBytes) rejectCode('K07_RESPONSE_LIMIT'); else chunks.push(chunk);});
      res.on('error', () => rejectCode('K07_NETWORK_ERROR'));
      res.on('aborted', () => rejectCode('K07_NETWORK_ERROR'));
      res.on('end', () => {
        if (settled) return;
        let page;
        try {page = JSON.parse(Buffer.concat(chunks).toString('utf8'));} catch {return rejectCode('K07_RESPONSE_DENIED');}
        finish(null, {status: 200, page, etag: res.headers.etag});
      });
    });
    request.on('error', () => {if (!settled) rejectCode('K07_NETWORK_ERROR');});
    timer = setTimeout(() => rejectCode('K07_TIMEOUT'), timeoutMs);
    signal?.addEventListener('abort', abort, {once: true});
    if (signal?.aborted) abort(); else request.end();
  });
}

export async function runBoundedApiReadProfile(rawProfile, {signal} = {}) {
  const profile = validateBoundedApiReadProfile(rawProfile);
  if (signal !== undefined && (typeof signal?.aborted !== 'boolean' || typeof signal?.addEventListener !== 'function'
    || typeof signal?.removeEventListener !== 'function')) fail('K07_CANCELLATION_INVALID');
  // Caller profile values cannot expand the executor-owned local fixture origin.
  if (process.env[`${profile.source.secretEnv}_ORIGIN`] !== profile.source.origin) fail('K07_SOURCE_NOT_AUTHORIZED');
  const secret = process.env[profile.source.secretEnv];
  if (typeof secret !== 'string' || !/^[\x21-\x7e]{16,4096}$/.test(secret)) fail('K07_CREDENTIAL_UNAVAILABLE');
  const deadline = performance.now() + profile.policy.totalTimeoutMs;
  const seen = new Map();
  const nonNullFieldCounts = Object.fromEntries(FIELDS.map((field) => [field, 0]));
  let duplicateCount = 0;
  let pagesRead = 0;
  let receivedObjects = 0;
  let snapshot = null;
  let totalCount = null;
  let cursor = null;
  const requestedCursors = new Set();
  let nextAllowedRequestAt = 0;
  const report = (state, reasonCode, terminalObserved = false) => ({
    schemaVersion: 'kaleidosphere.api/bounded-read-evidence/v1',
    state, complete: state === 'COMPLETE', reasonCode,
    proofClass: 'LOCAL_SYNTHETIC_FIXTURE_NOT_AUTHORIZED_VENDOR', actualVendorQualified: false,
    scope: {endpoint: ENDPOINT, fields: [...FIELDS], profileSha256: hash(profile), method: 'GET'},
    coverage: {pagesRead, receivedObjects, terminalObserved, declaredTotalCount: totalCount},
    facts: {objectCount: seen.size, duplicateCount, nonNullFieldCounts},
    snapshotSha256: snapshot === null ? null : hash(snapshot),
    sourceRowsExported: false, sourceCredentialsExported: false,
  });
  while (pagesRead < profile.policy.maxPages) {
    if (requestedCursors.has(cursor)) return report('INCOMPLETE', 'K07_PAGINATION_LOOP');
    requestedCursors.add(cursor);
    if (signal?.aborted) return report('INCOMPLETE', 'K07_CANCELLED');
    while (performance.now() < nextAllowedRequestAt) {
      const waitMs = Math.ceil(nextAllowedRequestAt - performance.now());
      if (waitMs >= deadline - performance.now()) return report('INCOMPLETE', 'K07_TIMEOUT');
      try {await delay(waitMs, undefined, {signal});}
      catch {return report('INCOMPLETE', 'K07_CANCELLED');}
    }
    const remainingMs = Math.floor(deadline - performance.now());
    if (remainingMs <= 0) return report('INCOMPLETE', 'K07_TIMEOUT');
    const url = new URL(ENDPOINT, profile.source.origin);
    url.searchParams.set('fields', FIELDS.join(','));
    if (cursor !== null) url.searchParams.set('cursor', cursor);
    let result;
    try {result = await requestPage({url, secret, expectedSnapshot: snapshot, maxBytes: profile.policy.maxPageBytes,
      timeoutMs: Math.min(profile.policy.requestTimeoutMs, remainingMs), signal});}
    catch (error) {return report('INCOMPLETE', error.code ?? 'K07_NETWORK_ERROR');}
    nextAllowedRequestAt = performance.now() + profile.policy.minRequestIntervalMs;
    if (integer(result.status, 300, 399)) return report('INCOMPLETE', 'K07_REDIRECT_DENIED');
    if (result.status === 412) fail('K07_SNAPSHOT_CHANGED');
    if (result.status === 410) return report('INCOMPLETE', 'K07_CURSOR_EXPIRED');
    if (result.status === 429) return report('INCOMPLETE', 'K07_RATE_LIMITED');
    if (result.status !== 200) return report('INCOMPLETE', 'K07_HTTP_ERROR');
    const page = result.page;
    if (!keys(page, ['snapshot', 'totalCount', 'items', 'nextCursor']) || typeof page.snapshot !== 'string'
      || !/^[a-zA-Z0-9_-]{1,128}$/.test(page.snapshot) || result.etag !== `"${page.snapshot}"`
      || !integer(page.totalCount, 0, profile.policy.maxObjects) || !Array.isArray(page.items)
      || !(page.nextCursor === null || typeof page.nextCursor === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(page.nextCursor))) fail('K07_RESPONSE_DENIED');
    if (snapshot === null) {snapshot = page.snapshot; totalCount = page.totalCount;}
    else if (snapshot !== page.snapshot || totalCount !== page.totalCount) fail('K07_SNAPSHOT_CHANGED');
    pagesRead += 1;
    receivedObjects += page.items.length;
    for (const row of page.items) {
      if (!keys(row, FIELDS) || typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.id)
        || !(row.category === null || typeof row.category === 'string' && row.category.length <= 128)
        || !(row.quantity === null || Number.isSafeInteger(row.quantity))) fail('K07_RESPONSE_DENIED');
      const digest = hash(row);
      if (seen.has(row.id)) {
        if (seen.get(row.id) !== digest) fail('K07_DUPLICATE_CONFLICT');
        duplicateCount += 1;
        continue;
      }
      if (seen.size >= profile.policy.maxObjects) return report('INCOMPLETE', 'K07_OBJECT_LIMIT');
      seen.set(row.id, digest);
      for (const field of FIELDS) if (row[field] !== null) nonNullFieldCounts[field] += 1;
    }
    if (page.nextCursor === null) {
      if (seen.size !== totalCount) return report('INCOMPLETE', 'K07_COUNT_MISMATCH', true);
      return report('COMPLETE', null, true);
    }
    cursor = page.nextCursor;
  }
  return report('INCOMPLETE', 'K07_PAGE_LIMIT');
}
