# K02 — bounded guided CSV / Parquet profile

Scope: only the two checked-in, explicitly bound synthetic examples. This is an additive Linux x64 glibc / Node 24 CLI executor, not a general file picker or a replacement for existing PostgreSQL paths. Disable the new entry to fall back; existing database paths and C2 contracts are unchanged.

## Operator entry

From the delivered source checkout, provision the optional task-private runtime once:

```sh
node scripts/provision-duckdb-file-runtime.mjs --install
node scripts/provision-duckdb-file-runtime.mjs --verify
```

The provisioner uses the committed npm lock, disables install scripts, uses empty task-private npm configuration and verifies every installed closure byte. It installs only `.ks-file-runtime`, never global packages. A pre-existing installed root is not silently overwritten. `--verify --runtime-root <path>` verifies a separately provisioned exact closure read-only. Provisioning verification does not run the engine or establish a product PASS.

Inspect declared metadata, without value reads, inference, hashing or loading DuckDB:

```sh
node scripts/run-file-profile.mjs --source examples/file-profile/approved.csv --question sum-units-by-category --mode METADATA_ONLY
```

Infer schema, explicitly reading source values but doing no calculation/export:

```sh
node scripts/run-file-profile.mjs --source examples/file-profile/approved.parquet --question sum-units-by-category --mode SCHEMA_INFERENCE
```

Execute the allowed question to a table and a new CSV result:

```sh
node scripts/run-file-profile.mjs --source examples/file-profile/approved.csv --question sum-units-by-category --export ./new-result.csv
```

Repeat with `approved.parquet` and a different new export name. Independent expected rows are alpha: sum_units `11`, null_units `1`; beta: `5`, `0`. The CLI supplies inferred types, explicit category/units binding, executed SQL, source row/null counts, exact source hash, observed local mtime, runtime identity, rights used and budgets. Local mtime is not upstream freshness. NULL units are excluded from SUM and counted separately; sums are decimal strings rather than lossy JavaScript numbers. Existing export targets, including a source file, are never overwritten.

## Fixed authority and executing boundary

Metadata stat, schema inference that reads values, and the combined read/query/export capability are distinct operations. `WRITE`, raw caller SQL, caller roles and unknown capabilities are not granted. Source selection is an exact path AND byte-identity binding; changing types or content after approval revokes execution. A new source requires independently reviewed trusted grant bytes; caller hashes or metadata do not grant authority.

The in-memory engine must report v1.5.6; the client and native binding are 1.5.6-r.1, with a full committed installed-byte manifest. CSV and Parquet readers are built in to those bytes. Automatic known-extension installation/loading, unsigned extensions and community extensions are disabled. External access is disabled, allowed_paths contains only the one read-only snapshot and configuration is locked. No arbitrary SQL is accepted from an operator.

The child receives only the read-only source snapshot, worker, verified dependency closure, Node and its system runtime mounts. Host checkout, credentials, outside evaluator and host network are not supplied. Kernel Mount/PID/network namespaces and a read-only root complement rather than rely solely on DuckDB settings. No unavailable-isolation fallback or user-host policy load is provided. CI reuses the already qualified narrow repository-owned hosted runner profiles, without changing sysctls or sharing the host network.

Budgets are 1048576 source bytes, 10000 source rows, 100 result groups, 64MB DuckDB allocator, one engine thread, 64MiB Node heap, 5000ms child deadline and 65536 bytes captured output. These are bounded engine/heap/deadline/output controls, not a claim of a total RSS/cgroup ceiling. Source reads use a non-following, nonblocking descriptor plus regular-file/inode/size checks and a bounded read, so validation→FIFO replacement cannot hang. Executor scratch is removed on success and refusal.

## Executable evidence and proof separation

```sh
node --test tests/duckdb-file-profile.test.mjs tests/duckdb-file-security.test.mjs tests/duckdb-file-runtime.test.mjs tests/duckdb-file-boundary.test.mjs
```

The profile suite executes the unmodified worker for both formats and independently computes the CSV reference with BigInt. Security tests cover traversal, URL/wildcard, caller authority, changed types/content, symlink/FIFO/race, oversized Parquet, wrong runtime bytes, invalid Parquet, type/row budgets and overwrite. Synthetic test-only regrants exercise the unchanged worker's defense after the input binding; they do not grant new production or private sources.

The boundary suite reuses exact independently qualified development probe bytes in disposable snapshots, substituting only the worker. It proves executing SQL read/network/INSTALL/LOAD/COPY/unlock refusals, native EROFS/ENOENT/TCP refusal, real 64MB OOM, a killed infinite child and 100k output refusal. Those are explicitly boundary fault injections, not unmodified final-worker or release acceptance. Actual unmodified positive runs, independent frozen source acceptance, complete CI, merge, functional release and anonymous downloaded product readback remain separately required before issue completion.

Every public CLI refusal returns a bounded intelligible German diagnostic with DENIED, a reason code, null table/export and partialSuccess false. Parser/version/resource failures never become partial success. This qualification makes no claim for arbitrary platforms, data sources, tenant roles, external permissions or human comprehension studies.
