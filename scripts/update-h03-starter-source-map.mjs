// Bounded H03 current registration; historical releases/reviews are not reminted.
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
const authored=[
  "services/bi-agent/src/server.mjs",
  "services/bi-agent/src/browser-starter-page.mjs",
  "services/bi-control/src/server.mjs",
  "services/bi-control/src/hosting/browser-starter.mjs",
  "services/bi-control/src/hosting/browser-starter-store.mjs",
  "tests/h03-starter-product.test.mjs",
  "tests/h03-starter-browser-surface.test.mjs",
  "tests/h03-starter-ci-binding.test.mjs",
  "scripts/update-h03-starter-source-map.mjs",
  "scripts/hosting/run-native-starter-browser.py",
  "scripts/hosting/native-starter-browser.mjs",
  "scripts/hosting/native-starter-mutation.py",
  "docs/hosting/ks294/README.md",
  "tests/source-map.test.mjs",
  "tests/canonical-test-topology.test.mjs"
];
const protectedPins={
  "README.md": "f68c19174eaeddadedca5485410e7c6f03c7245f6579a895908167a2f6f07bc1",
  "package.json": "85ca0ccac0fa41d937e2ce62768bff6b1cfe3b2ec3d04886343fcd905646c401",
  ".github/workflows/ci.yml": "3c8aac32f3711ad05330947025e60146c242539bd5cb92278ffb16830bd8be86",
  "services/bi-control/src/hosting/origin-session-ingress.mjs": "87ef088880d0a8bcd5d3cdcb257b6fedede96e5aac13953155efd8253c533028",
  "services/bi-control/src/runtime/pan-origin-source.mjs": "66c22d65f375e2e0bc9e67c323e0d2ccd64db7adc5e5e5415d7b2c4e6f898a81",
  "services/bi-agent/src/hosted-route-policy.mjs": "f3965b43815b925b8ee785e051eea908f8abb57f6e5ba11712e8df511070ad08",
  "services/bi-control/src/runtime/h05-shared-runtime-source.mjs": "d24044aceba34763c6f1dd2dfec9395db73434e13448a3679e4e1dc384e6d94e",
  "services/bi-control/src/runtime/h05-native-resource-store.mjs": "a533c97dddbd11ff55f86986bf294aaf1b58f6f2a35db6b77cabfd595d94ab9f",
  "scripts/run-invoice-date-o2c.mjs": "0068ce39530b7961c49177576dd48be7a162c136f473bfdc30313871db415777",
  "services/bi-control/src/business-bi/invoice-date-o2c.mjs": "7942c81b820efe6bccf24553951066c40a7e566c118e43a18d9f91696b999473",
  "services/bi-control/src/business-bi/invoice-date-o2c-views.mjs": "b262e14a9a90321c84b0b30f2ef1245c3d15c91c6a40a0e7ab800d69e001fd62"
};

for(const [name,expected] of Object.entries(protectedPins))if(createHash('sha256').update(await readFile(name)).digest('hex')!==expected)throw new Error('H03_PROTECTED_PREDECESSOR_CHANGED');
const map=JSON.parse(await readFile('SOURCE-MAP.json','utf8'));
for(const name of authored)map.files[name]=createHash('sha256').update(await readFile(name)).digest('hex');
map.files=Object.fromEntries(Object.entries(map.files).sort(([a],[b])=>a.localeCompare(b)));
const pending=`SOURCE-MAP.json.ks294-${process.pid}.tmp`;
await writeFile(pending,JSON.stringify(map,null,2)+'\n',{flag:'wx'});await rename(pending,'SOURCE-MAP.json');
console.log(JSON.stringify({authoredFiles:authored.length,totalEntries:Object.keys(map.files).length,historicalEvidenceReminted:false,packageCommandModified:false,protectedSourceSessionAndMetricImplementationModified:false}));
