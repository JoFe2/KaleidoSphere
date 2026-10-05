# K06: one optional MariaDB SQLAlchemy Core worker

## Decision and scope

The source-bound six-scope observation is `verification/relational-core-worker-comparison-v1.json`. It records a comparison before implementation against real pinned PostgreSQL and MariaDB servers, using identical declared synthetic tables and an independently specified counts/keys/Decimal oracle. It is not production data, source permission, a broad driver benchmark, or a hosted-CI/release receipt.

SQLAlchemy Core and the suitable ADBC candidates both executed the common aggregate query on both servers and matched the oracle. SQLAlchemy returned ordered composite PK/FK and Decimal(20,4) metadata. The actual MariaDB ADBC GetObjects constraint list was null: that remains UNKNOWN, not an absence-of-constraints or blanket ADBC failure. Aggregate Arrow Decimal(42,4) does not establish the source column's precision. MariaDB SQLAlchemy reflection did not itself supply collation; the adopted worker therefore reads narrowly scoped actual column metadata as well. PostgreSQL native OID/validation details are not inferred for a portable driver. The existing native PostgreSQL workflow was exercised separately: its own aggregate policy did not execute Decimal SUM. No full numeric-policy equivalence is claimed.

Exactly one new useful target was adopted: optional MariaDB 11.8.3-MariaDB-ubu2404 via SQLAlchemy 2.0.54/PyMySQL 1.1.2 in a process-private CPython 3.12.3 Linux AMD64 child. The existing native PostgreSQL adapter is not replaced. MySQL is not delivered or counted as MariaDB success. ADBC is a valid retained comparison, not an integrated production dependency. No ORM, arbitrary caller SQL, sample rows, source credentials, execution-authority grant, or new marketplace/data-source rights are provided.

## Reproducible optional runtime

The four minimal official wheel hashes, interpreter/platform and immutable chosen server reference are in `contracts/dependencies/relational-core-worker-lock-v1.json`. The optional runtime is separate from the existing Node PostgreSQL path.

From a checkout with exact CPython 3.12.3 on Linux AMD64:

    python scripts/provision-relational-core-runtime.py --install
    python scripts/provision-relational-core-runtime.py --verify
    export KS288_RELATIONAL_PYTHON="$PWD/.ks-relational-core-runtime/venv/bin/python"

The installer only creates its task-private virtual environment, downloads exact official wheel bytes, checks SHA256/size, installs with no index and required hashes, verifies package versions, and records installed file identities. Verification refuses byte drift; installation never blindly overwrites a completed or partial root. No global package, Python, Docker-registry or provider configuration is changed. A later clean invocation must use a new explicitly owned root if an earlier installation failed.

## Profile and approval

The existing `runAnalyzeProfile(profilePath, {signal})` dispatches only the new exact schema to the optional path. The strict input is:

    {
      "schemaVersion": "kaleidosphere.db/relational-core-profile/v1",
      "profileId": "declared-mariadb-scope",
      "engine": "mariadb",
      "mode": "RUNTIME",
      "scope": {"database": "ks288", "tables": ["accounts", "payments"]},
      "policy": {
        "access": "READ_ONLY", "allowRowSamples": false,
        "maxQueryTimeoutMs": 5000, "maxMetadataRows": 128
      },
      "adapter": {
        "kind": "sqlalchemy-core", "host": "127.0.0.1", "port": 3306,
        "user": "ks288_reader", "passwordEnv": "CM_MARIADB_PASSWORD", "ssl": false
      },
      "approval": {"state": "PREVIEW_ONLY", "schemaSha256": null}
    }

This example describes an explicitly owned synthetic scope, not an endpoint or authorization to access another source. Host/credentials must be supplied by the source owner through the existing permitted process environment; never store credential values in profiles or evidence. The fixture uses a private bridge with no published ports, so its actual internal host is derived from its owner-bound runtime configuration rather than this illustrative loopback address. Plaintext transport is exercised only on that owned isolated fixture; no TLS or remote-production qualification is claimed by these tests.

PREVIEW returns scoped metadata without aggregate facts. APPROVED_SCOPE requires the actual preview's string SHA256 in `approval.schemaSha256`; this is a content binding, never authority to acquire an unpermitted source. A changed schema, Decimal precision/scale or native collation cannot reuse the old approval. The worker checks the schema again before and after approved aggregates. Counts/null/distinct facts are aggregate-only; Decimal sums are exact strings, not floats. Missing vendor metadata stays UNKNOWN. Views, invalid scopes, missing/unpinned drivers, wrong server/engine, write-capable principals and malformed inputs fail closed without partial success.

The worker verifies the actual server, database, principal, MariaDB/PyMySQL dialect and read-only session; its principal is limited to SELECT/USAGE on the scoped database. Connections are process/thread owned, pooled only within that child and disposed at the end. Statement timeout is enforced by the actual server. A real AbortSignal sends SIGTERM; cancellation targets only the child's own connection ID through a separate same-reader control connection. Physical invalidation occurs after the interrupted DBAPI read unwinds, not reentrantly inside the signal handler. A clean cancellation claim requires the actual child cleanup packet and clean stderr; otherwise it is `K06_CANCELLED_UNVERIFIED_CLEANUP`.

## Required product checks

Provision an owned synthetic fixture with the exact runtime:

    export KS288_FIXTURE_ROOT="$TMPDIR/ks288-owned-native-fixture"
    "$KS288_RELATIONAL_PYTHON" -I -B scripts/prepare-relational-core-native-fixture.py --start --root "$KS288_FIXTURE_ROOT"
    export KS288_NATIVE_TEST_CONFIG="$KS288_FIXTURE_ROOT/config.json"
    export KS288_TEST_OWNER="$("$KS288_RELATIONAL_PYTHON" -I -B -c 'import json,os; from pathlib import Path; print(json.loads((Path(os.environ["KS288_FIXTURE_ROOT"])/"owned-state.json").read_text())["nonce"])')"
    node --test --test-concurrency=1 tests/relational-core-product.test.mjs tests/relational-core-runtime-ci-binding.test.mjs

Fourteen actual product cases cover metadata/ordered keys/native collation; preview versus approved exact aggregates; real schema/Decimal/collation changes and restoration; physical DML/DDL refusal; thread/fork ownership with healthy parent; actual query timeout; live SIGTERM and AbortSignal cancellation with pool/control/direct reader-residue readback; real empty-driver runtime; real authentication-error redaction; and MySQL/typed identity refusal. Five separate binding/input cases check exact required setup, minimal artifact pins, fixture ownership, string-only approval and malformed cancellation before runtime selection. The distinction is retained: nineteen total tests is not nineteen native SQL tests.

Both suites have one canonical imported-parent route, preserving the byte-bound historical package command and existing topology/source-map guards. CI installs the exact runtime and actual owned server before both the explicit native command and canonical npm test; no missing-runtime skip or SQLite substitution is permitted. The fixture must stay alive until canonical execution finishes. Afterwards:

    "$KS288_RELATIONAL_PYTHON" -I -B scripts/prepare-relational-core-native-fixture.py --cleanup --root "$KS288_FIXTURE_ROOT"

Cleanup verifies exact owner labels and IDs, removes only that owned container/network, reads their absence back, deletes only the generated fixture credential files, and leaves the state/evidence. It does not touch other containers or existing producer roots. A setup failure is retained separately; never count it as an executed product refusal or restart into its partial directory blindly.

Local execution and current-workflow bindings do not establish hosted CI, merge, release, downloaded artifact execution or original issue closure. Those remain separate exact-SHA delivery gates.

## Primary reference material

The comparison was qualified against the publisher documentation at `https://docs.sqlalchemy.org/en/20/dialects/mysql.html`, `https://arrow.apache.org/adbc/current/driver/postgresql.html` and `https://adbc-drivers.org/drivers/mysql/`. Exact artifact versions and observed metadata limits come from the pinned acquisition and actual comparison, not from assuming that current documentation or a successful query proves vendor parity.
