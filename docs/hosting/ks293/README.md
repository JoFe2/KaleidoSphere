# KS-H02: optional protected native origin/session consumer

This opt-in adapter exposes the existing KS agent page, approved brand assets and bounded chat POST on an explicit loopback HTTPS origin. It does not replace the default local installer, Compose profile or self-hosting HTTP endpoints.

## Exact shared implementation

The common origin, signing, persisted session, cookie, binding and CSRF implementation is PANSPHAIRA, not a second KS implementation:

- Executable session candidate: commit `6a7752be07405bd03ccbc40c13a9936d1b8d0d2b`, tree `43f33d0c3c14aacc23f1497aae7a0f83f1cd7f30`.
- Contract: `contracts/hosted-origin-session/candidates/origin-session-development-v3.json`, SHA256 `cd87f1a1a5942bea20ac19cc8b08d5e32861c1e2499b9895b9d759fb4ba7b20b`.
- Consumer selector: `contracts/dependencies/pan527-origin-session-source-development-v3.json`. It pins the producer source, built import closure and locked runtime dependencies. The loader checks those bytes at loading and each session operation, including response-cookie creation and issuance. Copied/released handles and later source drift are denied.
- The v1 origin-only selector remains a negative predecessor. It cannot issue KS protected sessions and is never implicitly promoted. The superseded v2 candidate is not selected.

Acquire the exact public producer into an owned directory, check HEAD/tree, then run `npm ci --ignore-scripts && npm run build` there. The required CI step performs this acquisition without credentials for both retained v1 and executable v3; the KS loaders validate the declared closure. An arbitrary branch tip, package name, metadata record or successful unrelated test is not an accepted source.

## Explicit operator-owned binding and use

Import `loadH02PanSessionSourceV1` and `releaseH02PanOriginSourceV1` from `services/bi-control/src/runtime/pan-origin-source.mjs`, then `createH02OptionalNativeIngressV1` from `services/bi-control/src/hosting/origin-session-ingress.mjs`.

`createH02OptionalNativeIngressV1` requires exactly:

- `optIn: true` and the real loaded source handle;
- `origin`: one explicit `https://127.0.0.1:<port>` origin for this qualified loopback profile;
- `tls: { keyPath, certPath }`: absolute owner-owned regular single-link files, mode 0600, with final symlink targets refused;
- `tenants`: one to eight exact `{ routeBinding, stateRoot, agentOrigin }` specifications. Each upstream is an explicit, distinct `http://127.0.0.1:<port>` native agent; private session roots are distinct and not nested.

Each protected binding contains `schemaVersion: 'pansphaira.hosted-origin-session/protected-route-binding/v1'`, `componentId: 'kaleidosphere-bi-control'`, `entrypointPath: 'services/bi-control/src/server.mjs'`, the acquired source commit/tree and entrypoint SHA256, actual Node runtime, explicit native instance identity, fixed tenant and positive safe-integer native process generation. Read the native bytes/version and exact instance-name-to-container-ID/tenant ownership relation before configuring it. Preserve a raw Docker ID separately: a digit-leading ID is not a valid ScopeId and must not be silently repaired. Native process generation is not the analytics generation digest.

This is a distinct protected control-route binding. The portable RuntimeIdentity enum remains exactly `pansphaira-local-demo` and `kaleidosphere-bi-agent`; do not relabel control as agent or add control to that enum.

Configure the native agent with owner-fixed `AGENT_ROUTE_PREFIX=/t/<tenant>`. Start the returned HTTPS `server` only at the declared port on `127.0.0.1`. Internal control routing and its token file remain operator-owned; caller headers never become control credentials.

There is deliberately no HTTP login/issuance route. `issueOwnerSession(tenantId, { subjectId, role, expiresAtMs })` is an in-process owner operation. Only `reader` and `reviewer` are accepted. Transfer the resulting cookies through an authorized owner-controlled mechanism; never log or publish issued cookie/token values. The technical browser harness seeds only its own isolated synthetic contexts, not a real portal identity.

The producer owns `__Host-ks293-session` with Path=/, Secure, HttpOnly, SameSite=Strict and remaining lifetime. The companion `__Host-ks293-csrf` is an anti-CSRF token, not authentication or mutation authority. The prefixed native form reads exactly one valid current token at each click and supplies `x-pan527-csrf` on its same-origin POST. Missing, malformed or duplicate tokens do not dispatch. The unprefixed local page remains byte-identical and does not read cookies or add a CSRF header.

## Closed boundary and lifecycle

Route selection alone is not authorization. The shared producer authenticates each request, authorizes each read POST with same-origin CSRF, and is rechecked after the asynchronous body and before response/cookie release. The returned principal must match the configured tenant/instance/generation and protected control component. There is no `authorizeMutation` method and no hosted trusted-effect endpoint.

Only the exact scoped page, approved asset GETs and existing bounded chat POST are dispatched. Foreign tenant cookies, caller roles/tenants/auth/forwarding headers, duplicate authority headers, arbitrary file URLs, effect routes and URL aliases are refused. The existing native agent still refuses SQL, credentials, publication and unknown actions; read dispatch does not permit publication or trusted effects. Upstream redirects are not followed or forwarded. WebSocket upgrades are refused. The transport requires TLS 1.3 and same-origin connections; no HTTP or OIDC/portal fallback widens access.

Use an actual server leaf certificate and separately trusted root when testing certificate verification: root CA:TRUE/keyCertSign, signed leaf CA:FALSE/serverAuth with the exact IP/DNS SANs. Trust only the root in an owned test NSS profile. Do not disable certificate verification or change system trust.

Close the HTTPS listener and release the exact source handle on removal. The supplied owned harness removes its containers, networks, browser profile and transient session/TLS/control-token state, preserving only non-secret technical evidence. Failed attempts are retained as failures; missing authority never activates an unsecured substitute. The original installer/self-hosting path requires no hosted source, session store, certificates or portal.

## Executed scopes and reproduction

The retained evidence under `docs/hosting/ks293/evidence/` distinguishes:

1. Actual native Firefox TLS/page/cookie/Status/Analyze journey, with two distinct existing KS native image instances and a read-only current agent-server overlay. Synthetic database fixture and model stub, not a newly built image, real model, external portal or general hosted deployment qualification.
2. Actual unprefixed local/self-hosting browser regression against the current agent overlay, with native analysis/readback and distinct persistence.
3. Controlled real TLS protocol regressions for upstream redirect refusal, duplicate headers, no credential forwarding, and expiry during request-body/upstream-response awaits. The controlled upstream responses in this third scope are not native KS journey evidence.

To reproduce the native protected scope, provision the committed `dependencies/ks293-browser-runtime` lock with `npm ci --ignore-scripts` in that directory, and provide:

- Docker, OpenSSL, Python with Requests, Firefox and certutil;
- an owned writable `TMPDIR`;
- `KS293_PAN527_SESSION_SOURCE` pointing to the exact acquired/built v3 checkout;
- `KS293_BROWSER_WORKSPACE` for the locked Puppeteer runtime (defaults to that dependency directory);
- `KS293_CERTUTIL` and optionally `KS293_FIREFOX` for actual executables;
- optionally `KS293_EVIDENCE_ROOT` outside the source tree.

Run `python3 scripts/hosting/run-native-protected-browser.py`.

The default agent/control test image IDs are the exact accepted baseline images recorded in the evidence. If recreating them, build the unchanged service Dockerfiles at baseline commit `67c611c6b523d8d8ee329a65f8a00a589de81e1e` and supply the actual full `sha256:` IDs as `KS293_AGENT_IMAGE` and `KS293_CONTROL_IMAGE`. The harness preserves those identities, acquires actual Node/entrypoint bytes and asserts the baseline control source hash; it mounts only the current agent server read-only and does not claim it was baked into the old image. It refuses an unavailable/mismatching prerequisite rather than inventing observations.

The native run also tests a valid-MAC wrong-audience record in its own synthetic store using the producer's exact canonical encoder and an ephemeral owned key. No signing/store implementation is added to KS product code; original store bytes are restored before teardown, and neither key nor cookie values enter evidence.

Canonical source/CI, exact merge, new release and anonymous downloaded-product checks are separate delivery obligations. A development native PASS alone does not close #293 or imply general provider/customer/portal admission. The preserved mobile-brand containment finding remains the already-authorized #303 UI follow-up, not an added H02 gate.
