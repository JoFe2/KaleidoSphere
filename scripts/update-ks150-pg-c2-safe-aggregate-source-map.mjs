#!/usr/bin/env node
// KS150 / PG-KS-03 — content-address the four PostgreSQL C2 safe-aggregate bytes
// (the versioned C2 contract, the typed-plan execution module, the source-local
// clean-room runner, and the separately-versioned C2 certificate) plus the
// additively re-frozen legacy-technical-identity inventory.
//
// The inventory re-freeze (re-running the canonical scan additively, 0 removed,
// preserving the frozen schemaVersion + baseCommit anchors) is performed separately by
// the delivery record; this updater only re-binds the content-addressed entries. It
// hashes the raw bytes of every authored file present on disk, re-sorts the files table
// by localeCompare, and writes atomically (unique temp + rename). It content-addresses
// itself. Convention mirrors scripts/update-ks228-ks149-live-matrix-source-map.mjs.
//
// KS150 real-clean-room registration correction: also content-addresses the committed
// C2 test suite, the two byte-for-byte retained real clean-room evidence files, the
// real-run provenance record, the human readback evidence path, and SOURCE-MAP.md. It
// hashes what is on disk at run time and never rewrites those historical bytes.
// KS150 canonical-route correction: the two gate suites that carry/extend the canonical
// route set (the C1/C2 lifecycle parent gate and the CI-TOPOLOGY gate) are also
// content-addressed here, so the registration of this correction stays complete.
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');
const authoredFiles = [
  '.ks150-c2-real-cleanroom-post-restore-evidence.json',
  '.ks150-c2-real-cleanroom-primary-evidence.json',
  'contracts/connectors/postgresql/c2-safe-aggregate-v1.json',
  'docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json',
  'docs/evidence/postgresql-c2-real-cleanroom/README.md',
  'scripts/run-postgresql-c2-safe-aggregate-clean-room.mjs',
  'scripts/update-ks150-pg-c2-safe-aggregate-source-map.mjs',
  'services/bi-control/src/db-analyzer/postgresql-safe-analysis.mjs',
  'tests/canonical-test-topology.test.mjs',
  'tests/postgresql-c1-certification.test.mjs',
  'tests/postgresql-c2-safe-aggregate.test.mjs',
  'verification/postgresql-c2-safe-aggregate-v1.json',
  'SOURCE-MAP.md',
  'verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([left], [right]) => left.localeCompare(right)));
const temporary = `${sourceMapPath}.ks150-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS150 C2 source map updated: ${authoredFiles.filter((file) => Object.hasOwn(sourceMap.files, file)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);