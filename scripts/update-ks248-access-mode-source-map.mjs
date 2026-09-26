// KS248 — content-address the access-mode journey comparison surface in SOURCE-MAP.json so the
// family stays tamper-evident without a full repository re-digest.
//
// Convention mirrors the sibling updaters (scripts/update-ks247-result-lineage-source-map.mjs):
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
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
  'services/bi-control/src/business-bi/access-mode-journey-comparison-v1.mjs',
  'scripts/run-access-mode-journey-comparison.mjs',
  // The evaluator-owned frozen case set and the two disjoint evidence populations.
  'tests/fixtures/business-bi/ks248-access-modes/cases-v1.json',
  'tests/fixtures/business-bi/ks248-access-modes/holdout-v1.json',
  'tests/fixtures/business-bi/ks248-access-modes/calibration-v1.json',
  'tests/fixtures/business-bi/ks248-access-modes/holdout-denied-credits-v1.json',
  'tests/fixtures/business-bi/ks248-access-modes/calibration-denied-credits-v1.json',
  'tests/fixtures/business-bi/ks248-access-modes/source-identity-v1.json',
  'tests/fixtures/business-bi/ks248-access-modes/rights-profile-a-v1.json',
  'tests/fixtures/business-bi/ks248-access-modes/rights-profile-b-v1.json',
  'tests/access-mode-journey-comparison.test.mjs',
  'docs/evidence/ks248-access-mode-journey-comparison-v1.md',
  'scripts/update-ks248-access-mode-source-map.mjs',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([l], [r]) => l.localeCompare(r)));
const temporary = `${sourceMapPath}.ks248-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS248 source map updated: ${authoredFiles.filter((f) => Object.hasOwn(sourceMap.files, f)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
