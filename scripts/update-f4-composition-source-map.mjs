// KaleidoSphere #238 — register the positive local F4 composition surface in the
// content-addressed source map. Scoped to the exact files this surface adds or touches;
// historical evidence and the frozen C2 clean-room records are left byte-identical.
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const paths = [
  'services/bi-control/src/business-bi/net-revenue-f4-composition.mjs',
  'scripts/run-net-revenue-f4-composition.mjs',
  'scripts/update-f4-composition-source-map.mjs',
  'tests/net-revenue-f4-composition.test.mjs',
  'tests/fixtures/business-bi/net-revenue-f4-composition-v1.json',
  'tests/fixtures/business-bi/net-revenue-f4-composition-v2.json',
  'docs/evidence/net-revenue-f4-composition-v1.md',
  'README.md',
  'docs/ROADMAP.md',
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
];

const map = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
for (const path of paths) {
  map.files[path] = createHash('sha256').update(await readFile(path)).digest('hex');
}
map.files = Object.fromEntries(Object.entries(map.files).sort(([a], [b]) => a.localeCompare(b)));
await writeFile('SOURCE-MAP.json', `${JSON.stringify(map, null, 2)}\n`);
console.log(`F4-composition: registered ${paths.length} scoped source identities`);
