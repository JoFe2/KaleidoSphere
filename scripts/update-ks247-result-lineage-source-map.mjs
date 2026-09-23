// KS247 — content-address the read-only result-lineage surface in SOURCE-MAP.json so the
// family stays tamper-evident without a full repository re-digest.
//
// Convention mirrors the sibling updaters (scripts/update-ks246-unfamiliar-schema-source-map.mjs):
// hash the raw bytes of every authored file present on disk, re-sort the files table by
// localeCompare, and write atomically (unique temp + rename).
//
// No package.json byte changes: the canonical command is byte-bound to the released C1
// certificate's live package.json digest, so the new suite rides the established
// imported-parent route in tests/source-map.test.mjs instead of becoming a direct root.
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');

const authoredFiles = [
  '.github/workflows/ci.yml',
  'tests/postgresql-c2-safe-aggregate.test.mjs',
  // The registration surface: the imported-parent route in tests/source-map.test.mjs and the
  // topology declaration in tests/canonical-test-topology.test.mjs.
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
  // The read-only result-lineage module and its single runnable CLI entry point.
  'services/bi-control/src/business-bi/result-lineage-v1.mjs',
  'scripts/run-result-lineage-journey.mjs',
  // The INDEPENDENTLY MAINTAINED expectation, the authored free-form explanation and the
  // separately confirmed effect status — all three are authored inputs, never run output.
  'tests/fixtures/business-bi/ks247-result-lineage/independent-expectation-v1.json',
  'tests/fixtures/business-bi/ks247-result-lineage/explanation-v1.json',
  'tests/fixtures/business-bi/ks247-result-lineage/effect-status-v1.json',
  // The focused suite and its evidence record.
  'tests/result-lineage-readonly.test.mjs',
  'docs/evidence/ks247-read-only-result-lineage-v1.md',
  // This updater is content-addressed too, so the migration is itself tamper-evident.
  'scripts/update-ks247-result-lineage-source-map.mjs',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([l], [r]) => l.localeCompare(r)));
const temporary = `${sourceMapPath}.ks247-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS247 source map updated: ${authoredFiles.filter((f) => Object.hasOwn(sourceMap.files, f)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
