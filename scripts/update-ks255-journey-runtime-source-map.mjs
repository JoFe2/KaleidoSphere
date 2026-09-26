// KS255 (KS-OPS-03) — content-address the journey-runtime binding surface in SOURCE-MAP.json so
// the family stays tamper-evident without a full repository re-digest.
//
// Convention mirrors the sibling updaters
// (scripts/update-ks247-result-lineage-source-map.mjs): hash the raw bytes of every authored
// file present on disk, re-sort the files table by localeCompare, and write atomically
// (unique temp + rename).
//
// No package.json byte changes: the canonical command is byte-bound to the released C1
// certificate's live manifest digest, so the new suite rides the established imported-parent
// route in tests/source-map.test.mjs instead of becoming a direct root.  No historical
// evidence byte is re-minted: this migration is purely additive.
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');

const authoredFiles = [
  // The repository-owned runtime dependency binding and its pinned artifact manifest.
  'dependencies/ks-journey-runtime/package.json',
  'dependencies/ks-journey-runtime/package-lock.json',
  'contracts/dependencies/ks255-journey-runtime-v1.json',
  // The provisioner/measurement entry point.
  'scripts/provision-ks255-journey-runtime.mjs',
  // The registration surfaces: the imported-parent route in tests/source-map.test.mjs, the
  // topology declaration in tests/canonical-test-topology.test.mjs, and the runtime-root
  // ignore rule that keeps the installed artifact out of the repository.
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
  '.gitignore',
  // The focused suite and its evidence record.
  'tests/ks255-journey-runtime-binding.test.mjs',
  'docs/evidence/ks255-journey-runtime-binding-v1.md',
  // This updater is content-addressed too, so the migration is itself tamper-evident.
  'scripts/update-ks255-journey-runtime-source-map.mjs',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([l], [r]) => l.localeCompare(r)));
const temporary = `${sourceMapPath}.ks255-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS255 source map updated: ${authoredFiles.filter((f) => Object.hasOwn(sourceMap.files, f)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
