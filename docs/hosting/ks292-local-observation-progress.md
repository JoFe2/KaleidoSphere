# KS292 local observation work: scope and measured evidence

This is independent KS-local adapter work, not the portable runtime contract or complete H01 delivery. PAN526 owns the single shared contract; no duplicate RuntimeIdentity, ReadinessReceipt, Desired/Observed or lifecycle schema is defined here.

## Existing demo qualification

Executed source commit: dfc7f2ae2399109b90fe8a101f2d4eed465a7cef; Git tree: ff9949615ec27bb37d848b0b01ca41d55f6994b7. Ten qualified cached-image cold starts recreate containers and empty owned state under one x86_64 profile; these are not uncached image pulls. Each trial actually runs init, idle, load, byte-hashed backup/extraction and restored-generation readback. The original failed strict-symlink restore attempt is retained separately.

Qualified built image IDs:
- superset-init: sha256:f7c3fd96b2ae884d7fe2acf5e6fcaf2dce2bec5a32e5b0bb9136650504269adc
- superset: sha256:f7c3fd96b2ae884d7fe2acf5e6fcaf2dce2bec5a32e5b0bb9136650504269adc
- bi-control: sha256:0aec85f2f1d0b8446f107b798d7826633b0c580cec5d6d13df02be20d33cc472
- bi-agent: sha256:8d36d93aa4c04bd1578432744df073a8d7963c415f628d79013cf32df25ed386

Runtime bases: pinned Superset 6.1.0 and Node 24.14.0. Existing product execution uses only the public synthetic MSSQL metadata fixture and deterministic offline agent path. No live MSSQL, native model, production or arbitrary-tenant capability is claimed.

## Actual four-phase resource evidence

The 10 completed trials contain 40 phase records and 3948 raw samples. Time below is derived from monotonic phase counters; resource values are observations, not estimates.

| Phase | Raw samples | Median seconds | Largest sampled aggregate memory usage bytes |
| --- | ---: | ---: | ---: |
| INIT | 1725 | 44.313962 | 621580288 |
| IDLE | 160 | 4.008996 | 615047168 |
| LOAD | 40 | 0.810635 | 650272768 |
| RESTORE | 2023 | 52.560778 | 645808128 |

Docker memory usage includes cache as reported. Sampling reads containers serially; these aggregates are not synchronized RSS/working-set/whole-host peaks. CPU endpoint deltas are recorded only over their observed intervals, not estimated total phase CPU. Raw samples and their individual SHA-256 values are retained in the qualified evidence set; derived-summary SHA-256: 0cd20c63fc34b9510a0a32449d9e4f425534b99e42b8946163ec95b0cb81c814.

The x86_64 host description captured after the measurements reports 16 logical CPUs, 98716954624 bytes of memory, Docker 29.1.3, kernel 7.0.11-76070011-generic, and cgroup 2. This capture is labeled current host description, not a retroactive measurement. Default Compose file and installer bytes remain unchanged.

## Local observation helpers

- `h01-observed-json.mjs`: bounded data-only decoding; proxies, accessors, cycles, unsupported behavior and unsafe values are refused without executing input callbacks.
- `h01-local-demo-probe.mjs`: checks the existing synthetic metadata business oracle, not HTTP liveness.
- `h01-local-bound-readback.mjs`: compares the actual KS254 projection generation with operator-held verified bytes. This is not the shared deployment RuntimeIdentity generation.
- `h01-local-image-observations.mjs`: compares KS-local Docker service image observations with qualified operator-held SHA-256 image IDs, rejects mutable aliases, unknown local roles, duplicates and permission metadata. These local Docker service names are not a second portable Component-ID registry. Nonempty partial observations are intentionally permitted; the eventual actual readiness caller must enforce its required service completeness separately. A matching subset is never whole-stack readiness.
- `h01-owned-backup-guard.mjs`: retains only the exact existing confined KS254 generation-pointer archive layout. Absolute/escaping/unknown pointers, special files and writes through accepted pointers remain denied.

Matching observation facts never authorize a route or permission. Every helper keeps `hostedRouteOpen: false`; privileged observation collection must remain in the trusted task-owned driver, never model-supplied metadata.

## Actual image versions and data conversion

`docs/evidence/hosting/ks292-native-image-versions-v1.json` records actual network-none, read-only native commands against the held image IDs. The control and agent run Node 24.14.0; the agent package is 0.18.1. Superset is a distinct service: 6.1.0 on Python 3.10.20, with SQLAlchemy 1.4.54. The failed attempt to invoke Python in the Node agent image remains a failed private probe, not a version claim. All exact owned version-probe containers were removed.

`h01-local-wire-data.mjs` converts only bounded, already-decoded KS data to ordinary plain wire JSON, preserving exact component/runtime values, keys and generation representations. It does not define a runtime schema, coerce a version, create authority or turn a KS254 content digest into a deployment generation. Getter/proxy/toJSON callbacks, cycles and out-of-bound data are rejected before conversion. An early producer schema/runtime mismatch must be corrected by the single PAN contract producer; native Node observations are never relabeled Superset to pass it. Early private schema comparison is not final/native/lifecycle acceptance.

## Real isolated control HTTP negative proof

The original qualified control image runs in a fresh owned actor: network none, no host ports, read-only root, all capabilities dropped, no-new-privileges, 512 MiB memory and 128 PIDs. The preserved verified backup is extracted into fresh owned state; the baseline archive is never modified.

1. Real HTTP readback returns 200 and the correct business facts.
2. Original `/v1/analyze` actually produces a different KS254 projection generation with correct business facts. Comparison with stale held generation bytes returns `NOT_READY` / `LOCAL_DEMO_ACTUAL_GENERATION_MISMATCH`.
3. A deliberate semantic fault changes relation_count from 2 to 3 in an isolated native projection generation; the actual projection/receipt bytes are rehashed and verified, and the mirror is in sync. Real HTTP returns 200, but the business adapter returns `NOT_READY` / `LOCAL_DEMO_BUSINESS_VALUE_MISMATCH`. Liveness still returns 200; no hosted route opens.
4. Exact previous verified generation bytes are restored and read back; its summary equals the pre-fault summary. Exact owned actor cleanup is read back as zero remaining containers.

Native proof receipt SHA-256: 44b317791cfb0b33d2c8abd4c6014a35bc71f8d493d0bcfd6b861866ea898217. This proves the tested local observation path only, not common-contract RuntimeIdentity, admitted lifecycle or universal runtime behavior.

## Verification and remaining delivery

Ten local adapter tests pass with no failures or skips. All five suites are reached once through the existing source-map parent; the frozen canonical package command is byte-identical. The combined local adapters, canonical topology and compatibility-census verification has 75 pass, zero fail/skip. The current full owner-local regression has 1919 pass, 0 fail and 17 honest retained optional/environment-unavailable skips; it is not hosted CI and omitted legs are not counted as pass. The additive legacy identity census preserves all predecessor occurrences, classifications and history.

The required six-suite real-SQL regression was additionally executed in a task-owned isolated Node image over a complete byte-verified private checkout of the scoped Git index. The pinned PGlite dependency mount stayed read-only; only the private source copy was writable for existing mutation tests. The original repository was not mounted, and no global `/workspace` fallback was created. The first parallel read-only-source attempt failed with OOM and denied mutation writes; its evidence and cleanup were retained. Sequential execution produced 107 pass, zero fail, two explicit Python/PTY skips (not SQL skips), no OOM, and zero owned containers remaining. Both real terminal legs pass in the owner-local canonical run; results from separate executions are not summed or labeled hosted CI. Complete snapshot tree: f0120b892ec6e89a6ecdec77906d0620e5168f7f; native SQL receipt SHA-256: bacce14322ce7e087614024d71c09ec22d5d31488662242aa43296885cc9aa61.

Independent reviews are consumed only for their byte-matching scopes: raw-measurement integrity, prior local guards and the unchanged five-file data-only delta. They are not full H01 acceptance.

Remaining H01 work requires the exact immutable PAN-led contract candidate: real RuntimeIdentity and deployment generation, tenant/instance/audience/digest-bound Desired/Observed and lifecycle with opaque secret references and outcome_unknown, full required positive/negative product execution, required hosted CI, SHA-bound merge, new functional release, anonymous exact artifact/product readback and original issue closure. This is a technical producer dependency, not a Main approval, human confirmation or CLOSED gate. KS292 remains the only active delivery.
