// KS149 / PG-KS-02 — PostgreSQL C1 regular-product live matrix: content-address the
// newly authored live-matrix runner and its parent-executable wrapper, and re-hash the
// regular-product PostgreSQL wiring (compose.yaml, bin/bi) that this delivery completed.
//
// The two live evidence artifacts the runner writes on a parent-executed live run
// (verification/postgresql/postgresql-c1-live-matrix-v1.json and
// docs/evidence/postgresql-c1-live-matrix/README.md) are deliberately NOT added here:
// they do not exist on disk until the parent live operator runs the matrix, and a missing
// live result is never pre-bound or marked PASS. The live matrix result is a
// parent-owned prerequisite of issue #149.
//
// Convention mirrors scripts/update-m6-05-source-map.mjs: hash the raw bytes of every
// authored file present on disk, re-sort the files table by localeCompare, and write
// atomically (unique temp + rename). The updater content-addresses itself.
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');
const authoredFiles = [
  'bin/bi',
  'compose.yaml',
  'scripts/run-postgresql-c1-live-matrix.mjs',
  'scripts/run-postgresql-c1-live-matrix.sh',
  'scripts/update-ks149-pg-c1-live-matrix-source-map.mjs',
  'services/bi-control/src/db-analyzer/core.mjs',
  'services/bi-control/src/server.mjs',
  'tests/postgresql-product-dispatch.test.mjs',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([left], [right]) => left.localeCompare(right)));
const temporary = `${sourceMapPath}.ks149-pg-c1-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS149 PG-C1 source map updated: ${authoredFiles.filter((file) => Object.hasOwn(sourceMap.files, file)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);