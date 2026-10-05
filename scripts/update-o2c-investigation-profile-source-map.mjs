// Bounded current K08 registration; preserve historical evidence and protected predecessors.
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
const authored=[
  "scripts/run-o2c-investigation-profile.mjs",
  "services/bi-control/src/business-bi/o2c-investigation-profile.mjs",
  "tests/o2c-investigation-profile-product.test.mjs",
  "tests/o2c-investigation-profile-ci-binding.test.mjs",
  "scripts/update-o2c-investigation-profile-source-map.mjs",
  "docs/evidence/o2c-investigation-profile-v1.md",
  "tests/source-map.test.mjs",
  "tests/canonical-test-topology.test.mjs"
];
const protectedPredecessorPins={
  "scripts/run-invoice-date-o2c.mjs": "0068ce39530b7961c49177576dd48be7a162c136f473bfdc30313871db415777",
  "services/bi-control/src/business-bi/invoice-date-o2c.mjs": "7942c81b820efe6bccf24553951066c40a7e566c118e43a18d9f91696b999473",
  "services/bi-control/src/business-bi/invoice-date-o2c-views.mjs": "b262e14a9a90321c84b0b30f2ef1245c3d15c91c6a40a0e7ab800d69e001fd62",
  "package.json": "85ca0ccac0fa41d937e2ce62768bff6b1cfe3b2ec3d04886343fcd905646c401",
  "README.md": "f68c19174eaeddadedca5485410e7c6f03c7245f6579a895908167a2f6f07bc1"
};
for(const [name,expected] of Object.entries(protectedPredecessorPins))if(createHash('sha256').update(await readFile(name)).digest('hex')!==expected)throw new Error('K08_PROTECTED_PREDECESSOR_CHANGED');
const map=JSON.parse(await readFile('SOURCE-MAP.json','utf8'));
for(const name of authored)map.files[name]=createHash('sha256').update(await readFile(name)).digest('hex');
map.files=Object.fromEntries(Object.entries(map.files).sort(([a],[b])=>a.localeCompare(b)));
const pending=`SOURCE-MAP.json.ks290-${process.pid}.tmp`;
await writeFile(pending,JSON.stringify(map,null,2)+'\n',{flag:'wx'});await rename(pending,'SOURCE-MAP.json');
console.log(JSON.stringify({authoredFiles:authored.length,totalEntries:Object.keys(map.files).length,historicalEvidenceReminted:false,packageCommandModified:false,protectedO2cImplementationModified:false}));
