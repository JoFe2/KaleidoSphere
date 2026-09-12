// KS228 / PG-KS-02 — KS149 public-evidence delivery correction: content-address the
// two recovered parent-executed live-matrix evidence artifacts, the provenance record
// that binds them to the tested source and the delivered release, and re-hash the gate
// tests, the regenerated legacy-identity inventory, and the SOURCE-MAP note that this
// correction touched.
//
// The two evidence artifacts are historical bytes of the 2026-09-11 Qwen live run
// against the tested head f60ba0f227c87bac01a0b57edf27edfca862fdc5. They were recovered
// byte-for-byte from the retained test-VM clone and are bound to the recorded original
// digests; this updater never rewrites them, and the gate tests pin those originals so
// a re-mint or substitution fails the source map.
//
// Convention mirrors scripts/update-ks149-pg-c1-live-matrix-source-map.mjs: hash the
// raw bytes of every authored file present on disk, re-sort the files table by
// localeCompare, and write atomically (unique temp + rename). The updater
// content-addresses itself.
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');
const authoredFiles = [
  'docs/evidence/legacy-identity/legacy-technical-identity-inventory-v1.json',
  'docs/evidence/postgresql-c1-live-matrix/README.md',
  'scripts/update-ks228-ks149-live-matrix-source-map.mjs',
  'SOURCE-MAP.md',
  'tests/postgresql-c1-certification.test.mjs',
  'tests/postgresql-product-dispatch.test.mjs',
  'tests/source-map.test.mjs',
  'verification/postgresql/postgresql-c1-live-matrix-provenance-v1.json',
  'verification/postgresql/postgresql-c1-live-matrix-v1.json',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([left], [right]) => left.localeCompare(right)));
const temporary = `${sourceMapPath}.ks228-ks149-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS228 KS149 source map updated: ${authoredFiles.filter((file) => Object.hasOwn(sourceMap.files, file)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);