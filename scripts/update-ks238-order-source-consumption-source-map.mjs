// KS238 — content-address the receiving-side order/source consumption surface in
// SOURCE-MAP.json so the family stays tamper-evident without a full repository re-digest.
//
// Convention mirrors the sibling updaters (scripts/update-ks228-ks149-live-matrix-source-map.mjs):
// hash the raw bytes of every authored file present on disk, re-sort the files table by
// localeCompare, and write atomically (unique temp + rename).
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');

const authoredFiles = [
  // The canonical test registration (`package.json#scripts.test`) is part of this
  // surface's migration, so its bytes are content-addressed here too.
  'package.json',
  '.gitignore',
  // The pinned-artifact provision (FINDING 3/4): the manifest is the tamper-evident root of
  // the provisioned dependency, and the provisioner is the code that verifies it. The
  // provisioned closure bytes are transitively covered by this manifest, so only the root
  // needs its own entry here.
  'contracts/dependencies/pansphaira-order-source-v1.json',
  'scripts/provision-ks238-order-source-dependency.mjs',
  'scripts/build-ks238-order-source-fixtures.mjs',
  'scripts/run-ks238-order-source-consumption.mjs',
  'scripts/update-ks238-order-source-consumption-source-map.mjs',
  'services/bi-control/src/business-bi/order-source-consumption.mjs',
  'tests/fixtures/business-bi/ks238-order-source/erp-read-contract-v1.json',
  'tests/fixtures/business-bi/ks238-order-source/erp-supported-export-v1.json',
  'tests/ks238-order-source-consumption.test.mjs',
  // FINDING 5: the C2 evidence-boundary regression and the provenance record whose historical
  // versus current identities this increment reconciles.
  'tests/postgresql-c2-safe-aggregate.test.mjs',
  'verification/postgresql/postgresql-c2-real-cleanroom-provenance-v1.json',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([l], [r]) => l.localeCompare(r)));
const temporary = `${sourceMapPath}.ks238-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS238 source map updated: ${authoredFiles.filter((f) => Object.hasOwn(sourceMap.files, f)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
