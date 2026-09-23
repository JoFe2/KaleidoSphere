// KS246 — content-address the unfamiliar-schema proposal surface in SOURCE-MAP.json so the
// family stays tamper-evident without a full repository re-digest.
//
// Convention mirrors the sibling updaters (scripts/update-ks238-order-source-consumption-source-map.mjs):
// hash the raw bytes of every authored file present on disk, re-sort the files table by
// localeCompare, and write atomically (unique temp + rename).
import { createHash } from 'node:crypto';
import { access, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const sourceMapPath = resolve(root, 'SOURCE-MAP.json');

const authoredFiles = [
  // Registering this suite mutates no package.json: the canonical command is byte-bound to
  // the released C1 certificate, so the suite rides the imported-parent route instead. The
  // live bytes are still content-addressed here so the map stays a true live-tree digest.
  'package.json',
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
  'docs/evidence/ks246-unfamiliar-schema-proposal-v1.md',
  'scripts/run-unfamiliar-schema-proposal.mjs',
  'scripts/update-ks246-unfamiliar-schema-source-map.mjs',
  'services/bi-control/src/business-bi/unfamiliar-schema-proposal.mjs',
  'tests/fixtures/business-bi/ks246-unfamiliar-schema/aggregate-profile-v1.json',
  'tests/fixtures/business-bi/ks246-unfamiliar-schema/metadata-v1.json',
  'tests/unfamiliar-schema-proposal.test.mjs',
  // KS246 AC03/AC04 metric journey (the local composition successor): the separately
  // identified executable source fixture, the caller's authored record-kind decision
  // input, the composition module, its CLI, its focused suite and its evidence record.
  'services/bi-control/src/business-bi/net-revenue-unfamiliar-composition.mjs',
  'scripts/run-unfamiliar-schema-metric-journey.mjs',
  'tests/fixtures/business-bi/ks246-unfamiliar-schema/source-pay-feed-v1.json',
  'tests/fixtures/business-bi/ks246-unfamiliar-schema/kind-decisions-v1.json',
  // The caller's CLOSED, SOURCE-BOUND confirmation of the admitted amount column's business
  // meaning (KS246 C3 correction): a separate authored input, never adopted implicitly.
  'tests/fixtures/business-bi/ks246-unfamiliar-schema/business-semantics-v1.json',
  'tests/unfamiliar-schema-metric-journey.test.mjs',
  'docs/evidence/ks246-unfamiliar-metric-journey-v1.md',
];

const sourceMap = JSON.parse(await readFile(sourceMapPath, 'utf8'));
for (const file of authoredFiles) {
  try { await access(resolve(root, file)); } catch { continue; }
  sourceMap.files[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
}
sourceMap.files = Object.fromEntries(Object.entries(sourceMap.files).sort(([l], [r]) => l.localeCompare(r)));
const temporary = `${sourceMapPath}.ks246-${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(sourceMap, null, 2)}\n`, { flag: 'wx' });
await rename(temporary, sourceMapPath);
process.stdout.write(
  `KS246 source map updated: ${authoredFiles.filter((f) => Object.hasOwn(sourceMap.files, f)).length} authored files, ${Object.keys(sourceMap.files).length} total entries\n`,
);
