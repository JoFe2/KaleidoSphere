import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const family=[
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
  ".github/workflows/ci.yml": "09807b18dbd5594d93bd9355eb653d1e9fc931e0dc0f360d86512bea934160ec",
  "services/bi-control/src/hosting/origin-session-ingress.mjs": "87ef088880d0a8bcd5d3cdcb257b6fedede96e5aac13953155efd8253c533028",
  "services/bi-control/src/runtime/pan-origin-source.mjs": "66c22d65f375e2e0bc9e67c323e0d2ccd64db7adc5e5e5415d7b2c4e6f898a81",
  "services/bi-agent/src/hosted-route-policy.mjs": "f3965b43815b925b8ee785e051eea908f8abb57f6e5ba11712e8df511070ad08",
  "services/bi-control/src/runtime/h05-shared-runtime-source.mjs": "d24044aceba34763c6f1dd2dfec9395db73434e13448a3679e4e1dc384e6d94e",
  "services/bi-control/src/runtime/h05-native-resource-store.mjs": "a533c97dddbd11ff55f86986bf294aaf1b58f6f2a35db6b77cabfd595d94ab9f",
  "scripts/run-invoice-date-o2c.mjs": "0068ce39530b7961c49177576dd48be7a162c136f473bfdc30313871db415777",
  "services/bi-control/src/business-bi/invoice-date-o2c.mjs": "7942c81b820efe6bccf24553951066c40a7e566c118e43a18d9f91696b999473",
  "services/bi-control/src/business-bi/invoice-date-o2c-views.mjs": "b262e14a9a90321c84b0b30f2ef1245c3d15c91c6a40a0e7ab800d69e001fd62"
};

// Recover the WHOLE original workflow, not a selected subset of its gates.
// Only the approved runner-label delta and exact pre-existing diagnostics may
// be reversed. All other bytes still have to match the retained original pin.
function originalCiWorkflow(workflow){
 const pinned='    runs-on: ubuntu-24.04\n';
 assert.equal(workflow.split(pinned).length-1,1,'exactly one required-job runner pin');
 assert.equal(workflow.split('ubuntu-24.04').length-1,1,'no duplicate/hidden runner pin');
 let original=workflow.replace(pinned,'    runs-on: ubuntu-latest\n');
 const diagnostics=[
  '          ks283_audit_since="$(date +%s)"\n',
  '          # Diagnostics cannot replace a failed gate or change its exit status.\n',
  String.raw`          trap 'ks283_status=$?; trap - EXIT; if [ "$ks283_status" -ne 0 ]; then if node scripts/ci/ks283-sandbox-diagnostics.mjs failure "$ks283_audit_since"; then :; else printf "%s\n" "K01 diagnostics unavailable; original failure retained"; fi; fi; exit "$ks283_status"' EXIT`+'\n',
  '          node scripts/ci/ks283-sandbox-diagnostics.mjs before\n'
 ];
 for(const line of diagnostics){
  assert.equal(original.split(line).length-1,1,'exactly one unchanged diagnostic line');
  original=original.replace(line,'');
 }
 const pidLog='console.log("K01 runner sandbox status:",p.status,"signal:",p.signal,"error:",p.error?.code??null,"pid:",p.pid??null);';
 assert.equal(original.split(pidLog).length-1,1,'exactly one unchanged PID logging addition');
 return original.replace(pidLog,pidLog.replace(',"pid:",p.pid??null',''));
}

test('H03 actual product, served-script and binding suites are current source-addressed and reachable exactly once',()=>{
 const map=JSON.parse(readFileSync('SOURCE-MAP.json','utf8'));
 for(const p of family){assert.match(map.files[p]??'',/^[a-f0-9]{64}$/,p);assert.equal(map.files[p],digest(readFileSync(p)),p);}
 const parent=readFileSync('tests/source-map.test.mjs','utf8');const pkg=JSON.parse(readFileSync('package.json','utf8'));
 for(const name of ['h03-starter-product.test.mjs','h03-starter-browser-surface.test.mjs','h03-starter-ci-binding.test.mjs']){
  assert.equal(parent.split("import './"+name+"';").length-1,1,name);assert.equal(pkg.scripts.test.split(/\s+/).includes('tests/'+name),false,name);
 }
 for(const [p,expected] of Object.entries(protectedPins)){
  const bytes=readFileSync(p);
  assert.equal(digest(p==='.github/workflows/ci.yml'?originalCiWorkflow(bytes.toString('utf8')):bytes),expected,p);
 }
 const native=readFileSync('scripts/hosting/native-starter-browser.mjs','utf8');
 for(const actual of ['acceptInsecureCerts:false','actual-browser-real-interruption-restart-UNKNOWN-reset-hold','actual-non-admin-browser-abort-known-child-completion',
 'actual-browser-wrong-actual-business-value-not-UI-success','actual-browser-first-value-frozen-after-status-refresh'])assert.ok(native.includes(actual),actual);
});

test('K01 CI diagnostics pins the qualified distro and rejects every unrelated workflow delta',()=>{
 const workflow=readFileSync('.github/workflows/ci.yml','utf8');
 const verify=value=>assert.equal(digest(originalCiWorkflow(value)),protectedPins['.github/workflows/ci.yml']);
 verify(workflow);
 // In-memory negative fixtures only, not alternate jobs or native CI results.
 const pin='    runs-on: ubuntu-24.04\n';
 for(const altered of [
  workflow.replace(pin,''),
  workflow.replace('ubuntu-24.04','ubuntu-latest'),
  workflow.replace(pin,pin+pin),
  workflow+'# ubuntu-24.04\n',
  workflow.replace('      - run: npm test','      - run: npm test -- --skip'),
  workflow.replace('maxBuffer:1048576','maxBuffer:1048577'),
  workflow.replace('assert.deepEqual(after,','void(after,'),
  workflow.replace('["CapEff","CapPrm","CapAmb"]','["CapEff","CapAmb"]'),
  workflow.replace('if-no-files-found: error','if-no-files-found: warn'),
  workflow.replace('exit "$ks283_status"','exit 0'),
  workflow.replace('node-version: \'24\'','node-version: \'22\''),
  workflow.replace(',"pid:",p.pid??null','')
 ]){
  assert.notEqual(altered,workflow,'negative fixture must actually change the workflow');
  assert.throws(()=>verify(altered),assert.AssertionError);
 }
});
