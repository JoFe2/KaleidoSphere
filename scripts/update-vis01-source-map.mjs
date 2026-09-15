import {createHash} from 'node:crypto';
import {readFile, writeFile} from 'node:fs/promises';
const paths = [
  'package.json',
  'tests/source-map.test.mjs',
  'tests/canonical-test-topology.test.mjs',
  'docs/evidence/vis01-net-revenue.md',
  'scripts/render-net-revenue-visual-v1.mjs',
  'scripts/update-vis01-source-map.mjs',
  'services/bi-control/src/business-bi/net-revenue-visual-v1.mjs',
  'tests/net-revenue-visual-v1.test.mjs',
];
const map = JSON.parse(await readFile('SOURCE-MAP.json', 'utf8'));
for (const path of paths) map.files[path] = createHash('sha256').update(await readFile(path)).digest('hex');
map.files = Object.fromEntries(Object.entries(map.files).sort(([a], [b]) => a.localeCompare(b)));
await writeFile('SOURCE-MAP.json', `${JSON.stringify(map, null, 2)}\n`);
console.log(`VIS-01: registered ${paths.length} scoped source identities; historical evidence unchanged`);
