# K07 bounded read-only local HTTP path — real-target boundary retained

This is the authorized local implementation and synthetic precheck for issue #289, not a selected manufacturer integration. The original AC4 remains BLOCKED_EXTERNAL_AUTHORIZED_TARGET_ACCESS_DATA. No real source, source permission, read-only identity or permitted real data is inferred from a caller profile, public URL, repository release or passing fixture. The original issue remains open.

## Exact supported local scope

`runAnalyzeProfile` dispatches schema `kaleidosphere.api/bounded-read-profile/v1` to the additive bounded reader. Existing SQL, PostgreSQL, Oracle and optional MariaDB paths retain their predecessor code. Only mode `LOCAL_SYNTHETIC_FIXTURE`, source kind `k07-owned-rest-fixture-v1`, an exact plain `http://127.0.0.1:<port>` origin, endpoint `/k07/v1/records` and fields `id`, `category`, `quantity` are accepted. No arbitrary API generator or vendor adapter is supplied.

The executor owns a generated credential in the profile's `KS289_LOCAL_FIXTURE_<16 uppercase hex>` environment reference and independently owns its exact `<reference>_ORIGIN` binding. A caller cannot move that credential to another loopback origin. Credentials are never supplied in profile content or emitted in evidence. Every actual request uses GET, the fixed field projection and no redirect following. Raw source rows, raw origin, credential reference and token are omitted from the aggregate-only evidence.

A page has exactly `snapshot`, `totalCount`, `items`, `nextCursor`; the strong ETag must equal the quoted collection snapshot. Subsequent requests use that collection-wide If-Match. This is an explicit local fixture protocol, not a claim that unrelated APIs implement collection-wide ETags. Snapshot/count changes, HTTP412 and conflicting duplicate IDs reject the operation without a mixed final result. No provider timestamp, real-data freshness guarantee or external snapshot consistency is claimed.

Page, unique-object, body-byte, header-byte, per-request, whole-operation and inter-request limits are finite. Identical duplicate IDs count once. A null terminal cursor with the declared unique cardinality proves local completeness. A loop, expired cursor410, rate response429, actual timeout, page cap, body cap or missing cardinality is INCOMPLETE, never a fabricated zero or a terminal success. Live abort closes its actual owned connection; the rate interval is measured at the actual server and cannot dispatch beyond the total deadline.

## Executed local product proof

Command: `node --test --test-reporter=tap --test-concurrency=1 tests/bounded-api-read-product.test.mjs`.

The source-bound run in `verification/bounded-api-read-local-v1.json` returned 30 tests, 30 PASS, zero FAIL/cancelled/skipped/todo, exit0 and empty stderr. It includes actual native HTTP servers and real requests, not substituted workflow results. The independent declared four-row collection yields four unique objects, one duplicate, three pages, and non-null counts id4/category3/quantity3. An actually empty collection is separately distinguished from unavailable coverage.

The original five negative cases execute: looping cursor, expired cursor, rate response/timeout never interpreted as end, foreign-host redirect with zero second-server requests, and equal/conflicting IDs across pages. Additional actual checks cover collection revision/count drift, HTTP412, rate timing/deadline, connection cancellation, strict profile/method/origin/field refusal, response bytes/private fields, cardinality mismatch and page cap. Test-private profiles, generated executor bindings and owned server connections are removed by awaited test cleanup. No real/vendor requests are made.

## Original acceptance and delivery boundary

AC1–AC3 have LOCAL_SCOPE_VERIFIED_REAL_TARGET_UNVERIFIED evidence, not full original acceptance. AC4 is unsatisfied because the original issue explicitly leaves endpoint and test access unselected. Hosted CI, merge and functional release are separate delivery gates and are not established by the local verification file. The retained canonical root imports this suite exactly once; the required CI step also executes the native HTTP suite without skips or vendor access.

Resume only on a concrete authorized endpoint/protocol, object/field scope, existing permitted executor identity/read-only access, minimized permitted real data and an independently declared expected result. Add only that selected real adapter; execute positive/negative tests against the real target, then satisfy the original full delivery contract. No new source rights, additional human review gate or Main-preapproval wait is added. Rollback is disabling this optional profile; it has no source-write method.
