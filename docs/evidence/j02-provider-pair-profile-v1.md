# J02 — exact BI provider identity, operations and scoped gates

This additive provider profile complements the existing External API v2. The real product identity remains `superset-bi-agent` / `v0.18.1` from the qualified `services/bi-agent/package.json` artifact. KaleidoSphere root `v0.26.0` is not a replacement for it. No version bump or renamed service identity is claimed.

## Operator / consumer entry

```
node scripts/describe-bi-provider.mjs
```

The existing agent service now also exposes `GET /v2/provider-profile`. It uses the same runtime function as the CLI; `/v2/capabilities`, `/v2/capability-manifest` and `/v2/intents` retain their qualified outputs and dispatch boundaries. No general endpoint override, arbitrary operation executor, registry writer or new source authority is introduced. The provider CLI accepts no caller flags or positionals; the HTTP path accepts no identity query override.

`contracts/analytics/provider-profile-v1.json` is the exact deterministic metadata output of that function, not caller-authored authority. The provider binds:

- the actual agent package name, version and SHA-256; substituted artifact bytes fail before an attestation can be advertised;
- External API contract `2.0.0`, one complete capability attestation with nine descriptors and its existing digest;
- exactly six external operations: status, discovery, analyze, plan, preview and readback; the three trusted capabilities remain explicitly `externalIntent:false` and are not dispatchable via External API intents;
- the unchanged consumer profile and its existing digest;
- the independent registry-admission boundary and source/right requirements, without treating descriptive metadata as evidence of a permission or successful execution.

The profile is deeply immutable and has a canonical SHA-256 integrity digest. `validateProviderProfileV1` compares any proposed description with the exact runtime-owned profile; a caller cannot substitute an expected value or repair a false claim merely by recomputing its digest. Product/version, undocumented operation, promotion and broad-hold forgeries are refused.

## Original AC1–AC4 executable checks

- AC1: an alien agent package and a package relabeled with the root version are denied on their real bytes. A separate root package, environment variables and caller-provided product object cannot change the qualified identity.
- AC2: the genuine CLI and actual HTTP service return the same frozen description. The old attestation and consumer digests remain unchanged. Unknown operations, trusted apply and product input are rejected by the actual HTTP intent path, not merely omitted in documentation.
- AC3: the actual HELD synthetic projection request reaches `ingestProjectionProfile` and is denied with `XRA_KS01_RELEASE_HELD` / no candidate or ordinary answer. A real, separately released and byte-qualified PAN order-source handoff still executes to `CONSUMED` over the explicitly labeled local synthetic ERP fixture. The live legacy registry bytes are unchanged across profile checks, HTTP requests and direct consumption. Handshake metadata is not registry promotion, and the HELD scope is not a repository-wide stop switch.
- AC4: a genuinely missing retained source gives `RETAINED_SOURCE_BYTES_MISSING`; a disabled source authority is denied by the real released producer reader. The actual HTTP analysis request with no control token returns `AGENT_CONTROL_TOKEN_MISSING` before control dispatch. In the same scoped regression, the independent pinned DuckDB CSV CLI still reads values and produces both the independently expected table and CSV export in test-owned scratch.

The HTTP regression runs the actual service entry in private mount/PID/network namespaces, with no credentials, control token or host network. All temporary resources are test-owned; the namespace dies with its parent. The K01 AppArmor qualification, K02 file executor and existing native database/C2 paths are not rewritten.

```
node scripts/provision-duckdb-file-runtime.mjs --install
node --test tests/provider-pair-profile.test.mjs \
            tests/provider-pair-http.test.mjs \
            tests/provider-pair-execution.test.mjs
```

Only the three new suites are registered through the existing canonical source-map parent, exactly once; the root package / test command is unchanged. Existing current-workflow hash bindings are advanced, while historical certificate/closure pins and earlier evidence are retained.

## Pair / release limits

An immutable early provider contract and a separately named profile supplement are supplied to the existing Main/PAN J01 route; their complete v2 attestation requires `v0.18.1` / `2.0.0`, not PAN version `v0.8.0` or KS root version. This local product proof does not claim an actual new PAN J01 consumer run, its public closure or arbitrary pair compatibility. The exact final source review, mandatory hosted CI, merge/Main CI, new functional release and anonymous downloaded-product readback are separate delivery gates; no CLOSED cycle is required with PAN.

The retained consumer-support manifest is historical and still binds the unchanged capability/consumer outputs; it is not re-minted as a new release receipt. HELD promotion still needs the exact profile's function and rights evidence. There is no new permission for the historical #250 second source/context or marketplace/auth scopes. This evidence does not assert production access, upstream truth, human comprehension, tenant-wide rights, or real business benefit.
