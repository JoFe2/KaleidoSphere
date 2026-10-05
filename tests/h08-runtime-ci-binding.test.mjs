import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
const family=[
  "services/bi-control/src/hosting/portable-runtime.mjs",
  "services/bi-control/src/hosting/portable-runtime-lifecycle.mjs",
  "scripts/hosting/portable-runtime.mjs",
  "tests/h08-portable-native-product.test.mjs",
  "tests/h08-portable-lifecycle.test.mjs",
  "tests/h08-portable-cli.test.mjs",
  "tests/h08-runtime-ci-binding.test.mjs",
  "scripts/update-h08-source-map.mjs",
  "docs/hosting/ks296/README.md",
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
const digest=value=>createHash('sha256').update(value).digest('hex');
test('H08 current real product lifecycle CLI and required suites are source-addressed with exactly one canonical route',()=>{
 const map=JSON.parse(readFileSync('SOURCE-MAP.json'));for(const name of family){assert.match(map.files[name]??'',/^[a-f0-9]{64}$/,name);assert.equal(map.files[name],digest(readFileSync(name)),name);}
 const parent=readFileSync('tests/source-map.test.mjs','utf8'),topology=readFileSync('tests/canonical-test-topology.test.mjs','utf8'),pkg=JSON.parse(readFileSync('package.json'));
 for(const name of ['h08-portable-native-product.test.mjs','h08-portable-lifecycle.test.mjs','h08-portable-cli.test.mjs','h08-runtime-ci-binding.test.mjs']){
 assert.equal(parent.split("import './"+name+"';").length-1,1,name);assert.equal(pkg.scripts.test.split(/\s+/).includes('tests/'+name),false,name);assert.ok(topology.includes("suite: 'tests/"+name+"'"),name);}
 for(const [name,expected] of Object.entries(protectedPins))assert.equal(digest(readFileSync(name)),expected,name);
});
