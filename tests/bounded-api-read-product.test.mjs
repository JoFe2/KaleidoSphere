import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {runAnalyzeProfile} from '../services/bi-control/src/db-analyzer/workflow.mjs';

const SNAPSHOT = 'fixture-revision-one';
const ROWS = Object.freeze([
  {id: 'one', category: 'A', quantity: 2},
  {id: 'two', category: null, quantity: 0},
  {id: 'three', category: 'B', quantity: 4},
  {id: 'four', category: 'A', quantity: null},
]);
const PAGES = Object.freeze({
  FIRST: {snapshot: SNAPSHOT, totalCount: 4, items: ROWS.slice(0, 2), nextCursor: 'p2'},
  p2: {snapshot: SNAPSHOT, totalCount: 4, items: [ROWS[1], ROWS[2]], nextCursor: 'p3'},
  p3: {snapshot: SNAPSHOT, totalCount: 4, items: [ROWS[3]], nextCursor: null},
});
const jsonReply = (res, value, {status = 200, headers = {}} = {}) => {
  res.writeHead(status, {'content-type': 'application/json; charset=utf-8', etag: `"${SNAPSHOT}"`, ...headers});
  res.end(JSON.stringify(value));
};
async function ownFixture(t, {reply, editProfile = (profile) => profile} = {}) {
  const secret = randomBytes(32).toString('hex');
  const secretEnv = `KS289_LOCAL_FIXTURE_${randomBytes(8).toString('hex').toUpperCase()}`;
  process.env[secretEnv] = secret;
  const observations = [];
  const root = await mkdtemp(path.join(process.env.TMPDIR ?? os.tmpdir(), 'ks289-fixture-'));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const observed = {receivedAtMs: performance.now(), method: req.method, path: url.pathname, authorized: req.headers.authorization === `Bearer ${secret}`, ifMatch: req.headers['if-match'] ?? null, fields: url.searchParams.get('fields'), cursor: url.searchParams.get('cursor')};
    observations.push(observed);
    if (!observed.authorized || req.method !== 'GET' || url.pathname !== '/k07/v1/records') return jsonReply(res, {error: 'DENIED'}, {status: 403});
    if (reply) return reply({req, res, url, observed, observations, secret});
    jsonReply(res, PAGES[observed.cursor ?? 'FIRST']);
  });
  await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
  t.after(async () => {server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); delete process.env[secretEnv]; delete process.env[`${secretEnv}_ORIGIN`]; await rm(root, {recursive: true, force: true});});
  process.env[`${secretEnv}_ORIGIN`] = `http://127.0.0.1:${server.address().port}`;
  const profile = editProfile({schemaVersion: 'kaleidosphere.api/bounded-read-profile/v1', profileId: 'ks289-local-fixture', mode: 'LOCAL_SYNTHETIC_FIXTURE', source: {kind: 'k07-owned-rest-fixture-v1', origin: `http://127.0.0.1:${server.address().port}`, secretEnv}, scope: {endpoint: '/k07/v1/records', fields: ['id', 'category', 'quantity']}, policy: {maxPages: 8, maxObjects: 16, maxPageBytes: 4096, requestTimeoutMs: 500, totalTimeoutMs: 5000, minRequestIntervalMs: 0}});
  const profileFile = path.join(root, 'profile.json');
  await writeFile(profileFile, JSON.stringify(profile), {mode: 0o600});
  return {profile, profileFile, observations, secret, secretEnv};
}

test('K07 actual product workflow reads all three real HTTP pages and deduplicates bounded IDs without exporting source rows or credentials', async (t) => {
  const fixture = await ownFixture(t);
  const evidence = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(evidence.state, 'COMPLETE');
  assert.equal(evidence.complete, true);
  assert.equal(evidence.proofClass, 'LOCAL_SYNTHETIC_FIXTURE_NOT_AUTHORIZED_VENDOR');
  assert.deepEqual(evidence.facts, {objectCount: 4, duplicateCount: 1, nonNullFieldCounts: {id: 4, category: 3, quantity: 3}});
  assert.equal(evidence.coverage.pagesRead, 3);
  assert.equal(evidence.coverage.terminalObserved, true);
  assert.equal(evidence.actualVendorQualified, false);
  assert.equal(fixture.observations.length, 3);
  assert.deepEqual(fixture.observations.map((entry) => entry.ifMatch), [null, `"${SNAPSHOT}"`, `"${SNAPSHOT}"`]);
  assert.ok(fixture.observations.every((entry) => entry.method === 'GET' && entry.authorized && entry.fields === 'id,category,quantity'));
  const serialized = JSON.stringify(evidence);
  for (const excluded of [fixture.secret, fixture.secretEnv, 'Bearer ', ...ROWS.map((row) => row.id)]) assert.equal(serialized.includes(excluded), false, 'blocked source/credential material must not be exported');
  assert.equal(Object.hasOwn(evidence, 'rows'), false);
});

test('K07 rejects unselected live/vendor source before any request; local fixture does not confer source rights', async (t) => {
  const fixture = await ownFixture(t, {editProfile: (profile) => ({...profile, mode: 'LIVE_VENDOR', source: {...profile.source, origin: 'https://example.invalid'}})});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_SOURCE_NOT_AUTHORIZED'});
  assert.equal(fixture.observations.length, 0);
});

for (const changed of ['revision', 'count']) test(`K07 rejects collection ${changed} drift across actually read HTTP pages instead of publishing mixed facts`, async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, observed}) => {
    const page = structuredClone(PAGES[observed.cursor ?? 'FIRST']);
    if (observed.cursor !== null) {
      if (changed === 'revision') page.snapshot = 'fixture-revision-two';
      else page.totalCount = 5;
    }
    jsonReply(res, page, {headers: {etag: `"${page.snapshot}"`}});
  }});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_SNAPSHOT_CHANGED'});
  assert.equal(fixture.observations.length, 2);
});

test('K07 actual conditional request412 refuses a changed collection without returning mixed business facts', async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, observed}) => observed.cursor === null ? jsonReply(res, PAGES.FIRST) : jsonReply(res, {error: 'snapshot changed'}, {status: 412})});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_SNAPSHOT_CHANGED'});
  assert.equal(fixture.observations.length, 2);
});

test('K07 conflicting duplicate ID inside the same bound snapshot is rejected rather than silently counted once', async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, observed}) => {
    const page = structuredClone(PAGES[observed.cursor ?? 'FIRST']);
    if (observed.cursor === 'p2') page.items[0].quantity = 9;
    jsonReply(res, page);
  }});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_DUPLICATE_CONFLICT'});
  assert.equal(fixture.observations.length, 2);
});

test('K07 repeated opaque cursor stops before a third HTTP request and is incomplete, never an apparent end', async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, observed}) => {
    const page = structuredClone(PAGES[observed.cursor ?? 'FIRST']);
    if (observed.cursor === 'p2') page.nextCursor = 'p2';
    jsonReply(res, page);
  }});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_PAGINATION_LOOP');
  assert.equal(result.complete, false);
  assert.equal(result.coverage.terminalObserved, false);
  assert.equal(fixture.observations.length, 2);
});

test('K07 explicit terminal cursor with too few unique objects stays incomplete despite an HTTP200 end', async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, observed}) => jsonReply(res, {...PAGES[observed.cursor ?? 'FIRST'], totalCount: 5})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_COUNT_MISMATCH');
  assert.equal(result.complete, false);
  assert.equal(result.coverage.terminalObserved, true);
  assert.equal(result.facts.objectCount, 4);
  assert.equal(result.coverage.declaredTotalCount, 5);
});

for (const [status, code] of [[410, 'K07_CURSOR_EXPIRED'], [429, 'K07_RATE_LIMITED']]) test(`K07 actual HTTP${status} is incomplete, not terminal pagination success or fabricated zero`, async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, observed, secret}) => observed.cursor === null ? jsonReply(res, PAGES.FIRST) : jsonReply(res, {error: secret}, {status, headers: {'retry-after': '2'}})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, code);
  assert.equal(result.complete, false);
  assert.equal(result.coverage.terminalObserved, false);
  assert.equal(result.facts.objectCount, 2);
  assert.equal(fixture.observations.length, 2);
  assert.equal(JSON.stringify(result).includes(fixture.secret), false);
});

test('K07 actual foreign-host redirect is denied and target receives neither a request nor credentials', async (t) => {
  let foreignRequests = 0;
  const foreign = http.createServer((_req, res) => {foreignRequests += 1; res.end('foreign');});
  await new Promise((resolve) => foreign.listen(0, '127.0.0.1', resolve));
  t.after(async () => {foreign.closeAllConnections(); await new Promise((resolve) => foreign.close(resolve));});
  const fixture = await ownFixture(t, {reply: ({res, secret}) => jsonReply(res, {error: secret}, {status: 302, headers: {location: `http://localhost:${foreign.address().port}/foreign`}})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_REDIRECT_DENIED');
  assert.equal(result.complete, false);
  assert.equal(fixture.observations.length, 1);
  assert.equal(foreignRequests, 0);
  assert.equal(JSON.stringify(result).includes(fixture.secret), false);
});

test('K07 configured rate interval is executed between actual server requests', async (t) => {
  const fixture = await ownFixture(t, {editProfile: (profile) => ({...profile, policy: {...profile.policy, minRequestIntervalMs: 40}})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'COMPLETE');
  const arrivals = fixture.observations.map((request) => request.receivedAtMs);
  for (let index = 1; index < arrivals.length; index += 1) assert.ok(arrivals[index] - arrivals[index - 1] >= 38, 'actual observed rate interval, permitting2ms transport/timer measurement tolerance');
});

test('K07 rate wait cannot outlive the whole-operation deadline or dispatch another request', async (t) => {
  const fixture = await ownFixture(t, {editProfile: (profile) => ({...profile, policy: {...profile.policy, minRequestIntervalMs: 200, requestTimeoutMs: 50, totalTimeoutMs: 100}})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_TIMEOUT');
  assert.equal(result.coverage.terminalObserved, false);
  assert.equal(fixture.observations.length, 1);
});

test('K07 actual response timeout is incomplete with zero observations, never end-of-collection', async (t) => {
  const fixture = await ownFixture(t, {reply: () => {}, editProfile: (profile) => ({...profile, policy: {...profile.policy, requestTimeoutMs: 30}})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_TIMEOUT');
  assert.equal(result.complete, false);
  assert.equal(result.coverage.terminalObserved, false);
  assert.equal(result.coverage.pagesRead, 0);
  assert.equal(fixture.observations.length, 1);
});

test('K07 live abort destroys its actual own HTTP connection and never continues pagination', async (t) => {
  let requestStarted;
  let connectionClosed;
  const started = new Promise((resolve) => {requestStarted = resolve;});
  const closed = new Promise((resolve) => {connectionClosed = resolve;});
  const controller = new AbortController();
  const fixture = await ownFixture(t, {reply: ({req}) => {req.socket.once('close', connectionClosed); requestStarted();}});
  const pending = runAnalyzeProfile(fixture.profileFile, {signal: controller.signal});
  await started;
  controller.abort();
  const result = await pending;
  await closed;
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_CANCELLED');
  assert.equal(result.coverage.pagesRead, 0);
  assert.equal(fixture.observations.length, 1);
});

for (const [name, mutation] of [
  ['POST', (p) => ({...p, method: 'POST'})],
  ['out-of-scope field', (p) => ({...p, scope: {...p.scope, fields: ['id', 'password']}})],
  ['source endpoint', (p) => ({...p, scope: {...p.scope, endpoint: '/other'}})],
  ['unbounded page policy', (p) => ({...p, policy: {...p.policy, maxPages: 0}})],
  ['fractional timeout', (p) => ({...p, policy: {...p.policy, requestTimeoutMs: 20.5}})],
  ['caller headers', (p) => ({...p, headers: {authorization: 'caller-supplied'}})],
]) test(`K07 ${name} profile is denied before actual source request`, async (t) => {
  const fixture = await ownFixture(t, {editProfile: mutation});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_PROFILE_DENIED'});
  assert.equal(fixture.observations.length, 0);
});

for (const [label, origin] of [['hostname', 'http://localhost:1234'], ['other-loopback', 'http://127.0.0.2:1234'], ['query', 'http://127.0.0.1:1234?token=x'], ['userinfo', `http://${randomBytes(8).toString('hex')}:${randomBytes(8).toString('hex')}@127.0.0.1:1234`]]) test(`K07 disallowed source origin is denied before request (${label})`, async (t) => {
  const fixture = await ownFixture(t, {editProfile: (profile) => ({...profile, source: {...profile.source, origin}})});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_SOURCE_NOT_AUTHORIZED'});
  assert.equal(fixture.observations.length, 0);
});

test('K07 oversized actual response is bounded and incomplete, no source body or credential echo escapes', async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, secret}) => jsonReply(res, {error: secret.repeat(32)}), editProfile: (profile) => ({...profile, policy: {...profile.policy, maxPageBytes: 256}})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_RESPONSE_LIMIT');
  assert.equal(result.complete, false);
  assert.equal(JSON.stringify(result).includes(fixture.secret), false);
});

test('K07 actual out-of-scope response field rejects rather than persists a private source row', async (t) => {
  const fixture = await ownFixture(t, {reply: ({res, secret}) => {
    const page = structuredClone(PAGES.FIRST);
    page.items[0].unapproved = secret;
    jsonReply(res, page);
  }});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_RESPONSE_DENIED'});
  assert.equal(fixture.observations.length, 1);
});

test('K07 page cap preserves observed partial coverage and does not mark absence or complete', async (t) => {
  const fixture = await ownFixture(t, {editProfile: (profile) => ({...profile, policy: {...profile.policy, maxPages: 1}})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'INCOMPLETE');
  assert.equal(result.reasonCode, 'K07_PAGE_LIMIT');
  assert.equal(result.coverage.terminalObserved, false);
  assert.equal(result.facts.objectCount, 2);
  assert.equal(fixture.observations.length, 1);
});

test('K07 a truly empty bound collection has observed terminal and declared zero, not an unavailable-page substitute', async (t) => {
  const fixture = await ownFixture(t, {reply: ({res}) => jsonReply(res, {snapshot: SNAPSHOT, totalCount: 0, items: [], nextCursor: null})});
  const result = await runAnalyzeProfile(fixture.profileFile);
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.coverage.declaredTotalCount, 0);
  assert.equal(result.coverage.terminalObserved, true);
  assert.equal(result.facts.objectCount, 0);
  assert.equal(result.coverage.pagesRead, 1);
});

test('K07 caller profile cannot redirect executor-owned fixture credential to another loopback origin', async (t) => {
  let decoyRequests = 0;
  const decoy = http.createServer((_req, res) => {decoyRequests += 1; jsonReply(res, {snapshot: SNAPSHOT, totalCount: 0, items: [], nextCursor: null});});
  await new Promise((resolve) => decoy.listen(0, '127.0.0.1', resolve));
  t.after(async () => {decoy.closeAllConnections(); await new Promise((resolve) => decoy.close(resolve));});
  const fixture = await ownFixture(t, {editProfile: (profile) => ({...profile, source: {...profile.source, origin: `http://127.0.0.1:${decoy.address().port}`}})});
  await assert.rejects(runAnalyzeProfile(fixture.profileFile), {code: 'K07_SOURCE_NOT_AUTHORIZED'});
  assert.equal(decoyRequests, 0);
  assert.equal(fixture.observations.length, 0);
});
