// Content-address the optional public producer crossing and its canonical test route.
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd();
const files = [
  'services/bi-control/src/business-bi/public-producer-status-crossing-v1.mjs',
  'scripts/run-ks256-public-producer-crossing.mjs',
  'tests/public-producer-status-crossing.test.mjs',
  'tests/source-map.test.mjs',
  'docs/evidence/ks256-public-producer-crossing-v1.md',
  'scripts/update-ks256-public-producer-crossing-source-map.mjs',
];
const target = path.join(root, 'SOURCE-MAP.json');
const map = JSON.parse(await readFile(target, 'utf8'));
for (const file of files) map.files[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
map.files = Object.fromEntries(Object.entries(map.files).sort(([a], [b]) => a.localeCompare(b)));
const temp = `${target}.ks256-crossing-${process.pid}.tmp`;
await writeFile(temp, `${JSON.stringify(map, null, 2)}\n`, { flag: 'wx' });
await rename(temp, target);
process.stdout.write(`KS256 public crossing source map: ${files.length} updated\n`);
