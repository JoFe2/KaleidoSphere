// Bounded current K07 source-map migration; never re-mint historical evidence.
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
const authored = [
  ".github/workflows/ci.yml",
  "services/bi-control/src/db-analyzer/workflow.mjs",
  "services/bi-control/src/db-analyzer/bounded-api-read-workflow.mjs",
  "tests/bounded-api-read-product.test.mjs",
  "tests/bounded-api-read-ci-binding.test.mjs",
  "tests/canonical-test-topology.test.mjs",
  "tests/source-map.test.mjs",
  "tests/ks255-journey-runtime-binding.test.mjs",
  "tests/postgresql-c2-safe-aggregate.test.mjs",
  "scripts/update-bounded-api-read-source-map.mjs",
  "docs/evidence/bounded-api-read-local-v1.md",
  "verification/bounded-api-read-local-v1.json"
];
const map=JSON.parse(await readFile('SOURCE-MAP.json','utf8'));
for(const name of authored)map.files[name]=createHash('sha256').update(await readFile(name)).digest('hex');
map.files=Object.fromEntries(Object.entries(map.files).sort(([a],[b])=>a.localeCompare(b)));
const temporary=`SOURCE-MAP.json.ks289-${process.pid}.tmp`;
await writeFile(temporary,JSON.stringify(map,null,2)+'\n',{flag:'wx'});await rename(temporary,'SOURCE-MAP.json');
console.log(JSON.stringify({authoredFiles:authored.length,totalEntries:Object.keys(map.files).length,historicalEvidenceReminted:false,packageCommandModified:false}));
