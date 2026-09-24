// KS249 — content-address the metric-compiler adapter surface in SOURCE-MAP.json so the
// family stays tamper-evident without a full repository re-digest.
//
// Convention mirrors the sibling updaters (scripts/update-ks246-unfamiliar-schema-source-map.mjs,
// scripts/update-ks247-result-lineage-source-map.mjs): hash the raw bytes of every authored file
// present on disk, re-sort the files table by localeCompare, and write atomically.
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
  // The registration surface: the imported-parent route in tests/source-map.test.mjs and the
  // topology declaration in tests/canonical-test-topology.test.mjs.
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
  // The credential-free pilot-protocol module and its single runnable CLI entry point.
  'services/bi-control/src/business-bi/metric-compiler-adapter-v1.mjs',
  'scripts/run-metric-compiler-adapter.mjs',
  // The authored contract pin, the declared channels, the declared applicability, the OBSERVED
  // registry metadata and the adopt-or-reject decision — all authored inputs, never run output.
  'tests/fixtures/business-bi/ks249-metric-compiler/contract-pin-v1.json',
  'tests/fixtures/business-bi/ks249-metric-compiler/channels-v1.json',
  'tests/fixtures/business-bi/ks249-metric-compiler/applicability-v1.json',
  'tests/fixtures/business-bi/ks249-metric-compiler/registry-observations-v1.json',
  'tests/fixtures/business-bi/ks249-metric-compiler/adopt-or-reject-decision-v1.json',
  // The focused suite and its evidence record.
  'tests/metric-compiler-adapter.test.mjs',
  'docs/evidence/ks249-metric-compiler-adapter-v1.md',
  // This updater is content-addressed too, so the migration is itself tamper-evident.
  'scripts/update-ks249-metric-compiler-source-map.mjs',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([l], [r]) => l.localeCompare(r)));
const temporary = `${sourceMapPath}.ks249-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS249 source map updated: ${authoredFiles.filter((f) => Object.hasOwn(sourceMap.files, f)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
