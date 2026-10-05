import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const family=[
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
test('K08 actual cold product and binding suites are source-addressed and canonically reachable exactly once',()=>{
 const map=JSON.parse(readFileSync('SOURCE-MAP.json','utf8'));
 for(const path of family){assert.match(map.files[path]??'',/^[a-f0-9]{64}$/,path);assert.equal(digest(readFileSync(path)),map.files[path],path);}
 const parent=readFileSync('tests/source-map.test.mjs','utf8'),pkg=JSON.parse(readFileSync('package.json','utf8'));
 for(const name of ['o2c-investigation-profile-product.test.mjs','o2c-investigation-profile-ci-binding.test.mjs']){
  assert.equal(parent.split("import './"+name+"';").length-1,1,name);
  assert.equal(pkg.scripts.test.split(/\s+/).includes('tests/'+name),false,name);
 }
 for(const [path,expected] of Object.entries(protectedPredecessorPins))assert.equal(digest(readFileSync(path)),expected,path);
});
