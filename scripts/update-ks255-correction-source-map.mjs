// KS255 (KS-OPS-03) targeted correction — re-content-address the CURRENT integrity bindings of the
// correction surface in SOURCE-MAP.json.
//
// Convention mirrors the sibling updaters
// (scripts/update-ks255-journey-runtime-source-map.mjs): hash the raw bytes of every authored file
// present on disk, re-sort the files table by localeCompare, and write atomically (unique temp +
// rename).
//
// This migration is bounded and additive:
//   * only the files this correction actually authored are re-hashed;
//   * no entry is removed and no historical evidence byte is re-minted — the historical
//     C2-correction workflow original and every frozen proof binding keep their recorded identity;
//   * the only workflow binding that moves is the CURRENT `.github/workflows/ci.yml` digest, which
//     the same correction updates in tests/postgresql-c2-safe-aggregate.test.mjs.
//
// No package.json byte changes: the canonical command stays byte-bound to the released C1
// certificate's live manifest digest.
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');

const authoredFiles = [
  // The current CI workflow: now consumes the committed pinned provisioner and executes every
  // required SQL suite over the provisioned closure.
  '.github/workflows/ci.yml',
  // The corrected measurement/verification entry point.
  'scripts/provision-ks255-journey-runtime.mjs',
  // The corrected focused suite.
  'tests/ks255-journey-runtime-binding.test.mjs',
  // The current-workflow hash binding (historical pins in the same file are unchanged).
  'tests/postgresql-c2-safe-aggregate.test.mjs',
  // The source gate that content-addresses the KS255 family.
  'tests/source-map.test.mjs',
  // The evidence record.
  'docs/evidence/ks255-journey-runtime-binding-v1.md',
  // This updater is content-addressed too, so the migration is itself tamper-evident.
  'scripts/update-ks255-correction-source-map.mjs',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  const exists = await access(resolve(root, file)).then(() => true, () => false);
  if (!exists) continue;
  // Every file this correction touches must already be a content-addressed member (except this
  // updater, which is additive) — a silent no-op migration is refused rather than trusted.
  if (file !== 'scripts/update-ks255-correction-source-map.mjs'
    && !Object.hasOwn(sourceMap.files, file)) {
    throw new Error(`KS255 correction migration: ${file} is not a content-addressed member`);
  }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([l], [r]) => l.localeCompare(r)));
const temporary = `${sourceMapPath}.ks255-correction-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS255 correction source map updated: ${authoredFiles.filter((f) => Object.hasOwn(sourceMap.files, f)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
