# H08: optional owner-local portable native generation

This opt-in extension uses the existing KaleidoSphere control server, SQLite
projection and receipt-generation store. It does not create a new BI platform,
hosted route, account or permission. Only the existing MSSQL synthetic fixture
scope is qualified. No production/customer data, external infrastructure or
arbitrary provider/runtime combination is claimed.

## Bound export and fresh restore

`kaleidosphere/export-bundle/v1` contains AES-256-GCM encrypted projection and
receipt bytes. Its authenticated `kaleidosphere/checkpoint-manifest/v1` binds
file sizes/digests, generation and generation manifest, configuration, native
store/projection contract versions, exact Node/product versions and native
implementation pins. The key is not in the bundle. The owner supplies a private
32-byte key file; no operator account is required. Checkpoint metadata is not
secret and must not contain credentials, caller roles or live-source grants.

The tested runtime is Linux with `/proc/self/fd` and the exact Node version in
the checkpoint. A mismatch is denied, not silently migrated. The supported
configuration is exactly `{engine: 'mssql', sourceMode: 'fixture'}`. An export
from a corrupt store fails. Missing/wrong keys, corrupt/incomplete bundles,
wrong generation and mismatched configuration/contracts/runtime/source pins
cannot qualify or activate a restored candidate.

Restore requires a fresh owner-private target separated from the declared
original receipt store: same store, ancestor and descendant destinations are
refused before any error-path write. Unknown source bounds permit no target
writes. On other failures, quarantine is persisted only in a fresh safe target
created by that invocation, with descriptor/device/inode/private-mode identity
and exclusive no-follow file creation. Preexisting or replaced foreign targets
are not reused or overwritten. A denial with no authorized safe destination
returns `quarantinePersisted: false`; it is not a persisted-quarantine claim.
`RESTORED_LOCAL` and stored facts never imply runtime READY or execution rights.

## Fixed-argument cold owner CLI

Create a synthetic generation through the existing local control `/v1/analyze`
path first. All path arguments below must be absolute canonical paths. The
bundle filename and restore target must not already exist. Provision the key
privately, without putting it in command arguments, the environment or logs:

    node --input-type=module -e 'import {writeFileSync} from "node:fs"; import {randomBytes} from "node:crypto"; writeFileSync("/YOUR/PRIVATE/key32",randomBytes(32),{flag:"wx",mode:0o600});'

    node scripts/hosting/portable-runtime.mjs export --local-synthetic-opt-in --key-file /YOUR/PRIVATE/key32 --bundle /YOUR/PRIVATE/retained.ksbundle --receipt-dir /YOUR/PRIVATE/origin/receipts
    node scripts/hosting/portable-runtime.mjs restore --local-synthetic-opt-in --key-file /YOUR/PRIVATE/key32 --bundle /YOUR/PRIVATE/retained.ksbundle --target-root /YOUR/PRIVATE/new-restore --generation EXACT_EXPORTED_64_HEX_GENERATION

The CLI refuses missing/duplicate/unknown options, symlink/special/nonprivate
key files and malformed generation tokens. It does not execute shell text or
consume a model response as authority. Read the restore result's `receiptDir`
and `projectionDb`; run the existing local control process with those explicit
paths for the actual restored catalog question and generation readback. The
native product test starts a distinct cold process and compares actual
`largest_tables` rows and provenance with the stopped origin.

## Honest lifecycle and retained backups

The restore creates an authenticated owner marker binding its private root,
device/inode, exact generation, runtime and retained bundle digest. A later
fresh CLI process must prove this same binding and key, not merely claim an
owner role. `inspect`, `tombstone` and `cleanup` use the same restore flags:

    node scripts/hosting/portable-runtime.mjs tombstone --local-synthetic-opt-in --key-file /YOUR/PRIVATE/key32 --bundle /YOUR/PRIVATE/retained.ksbundle --target-root /YOUR/PRIVATE/new-restore --generation EXACT_EXPORTED_64_HEX_GENERATION
    node scripts/hosting/portable-runtime.mjs cleanup --local-synthetic-opt-in --key-file /YOUR/PRIVATE/key32 --bundle /YOUR/PRIVATE/retained.ksbundle --target-root /YOUR/PRIVATE/new-restore --generation EXACT_EXPORTED_64_HEX_GENERATION

`TOMBSTONED` still retains the restored data. Cleanup requires tombstone first
and an exact qualified owned tree; an extra foreign resource prevents removal.
Only that restored root's fixed receipts/projection paths are removed. The
marker/status remain. `SCOPED_DATA_REMOVED` is not global erasure: the declared
backup remains, the source remains and `externalBackupErasure` is `UNKNOWN`.
A retained bundle can reacquire the same generation in another fresh root; the
lifecycle test runs the real control readback after this reacquisition.

## Executable verification

    node --test --test-reporter=tap tests/h08-portable-native-product.test.mjs tests/h08-portable-lifecycle.test.mjs tests/h08-portable-cli.test.mjs tests/h08-runtime-ci-binding.test.mjs
    node scripts/check-canonical-test-topology.mjs
    npm test

The four suites are reached exactly once through the existing source-map test
parent. The original package command, CI workflow and protected predecessor
implementations remain unchanged. Required hosted CI, SHA-bound merge, release
and anonymous exact downloaded-product verification are separate delivery gates;
local execution, a checkpoint, a review or an archive is not whole-issue closure.
