// KaleidoSphere #236 — register the GUIDED local user journey surface in the
// content-addressed source map. SCOPED to the exact files this surface adds; every
// released, historical and frozen identity (including the released connected runner and
// the #239/#240/#238 surfaces it reuses) is left byte-identical.
//
// The suite file is registered by this script too, because a test that pins the map is
// itself tracked source. The two `derivedFiles` classes and the historical evidence are
// untouched: this surface adds no evidence document (that is the review/delivery owner's
// call, not this package's).
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const paths = [
  'services/bi-control/src/business-bi/net-revenue-guided-decisions.mjs',
  'services/bi-control/src/business-bi/net-revenue-guided-session.mjs',
  // R2 correction added this module (the practical dataset-bound view). It is tracked
  // source of this surface, so it is registered here like every other guided file.
  'services/bi-control/src/business-bi/net-revenue-guided-view.mjs',
  'scripts/run-guided-net-revenue-journey.mjs',
  'scripts/update-guided-journey-source-map.mjs',
  'tests/net-revenue-guided-journey.test.mjs',
];

const map = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
for (const path of paths) {
  map.files[path] = createHash('sha256').update(await readFile(path)).digest('hex');
}
map.files = Object.fromEntries(Object.entries(map.files).sort(([a], [b]) => a.localeCompare(b)));
await writeFile('SOURCE-MAP.json', `${JSON.stringify(map, null, 2)}\n`);
console.log(`guided-journey: registered ${paths.length} scoped source identities`);
