// Current additive KS303 map only; immutable predecessor bindings and receipts stay unchanged.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,rename} from 'node:fs/promises';
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=[
 '.github/workflows/ci.yml','tests/source-map.test.mjs','tests/canonical-test-topology.test.mjs',
 'services/bi-control/src/assistant-foundation/pan549-k05-stock-read-pair-v1.mjs',
 'services/bi-control/src/assistant-foundation/pan549-existing-workspace-composition-v1.mjs',
 'services/bi-control/src/assistant-foundation/pan549-k05-read-companion-v1.mjs',
 'services/bi-control/src/assistant-foundation/pan549-k05-read-companion-v1.css',
 'scripts/provision-ks303-pan549-workspace.mjs','scripts/update-ks303-pan549-source-map.mjs',
 'tests/ks303-existing-pan549-k05-workspace.test.mjs','tests/ks303-k05-integrity-retirement.test.mjs',
 'docs/hosting/ks303/existing-pan549-k05-workspace-v1.md',
 'contracts/dependencies/pan549-stock-workspace-v1/README.md',
 'contracts/dependencies/pan549-stock-workspace-v1/binding.json',
 'contracts/dependencies/pan549-stock-workspace-v1/ui-attribution-v1.json',
 'contracts/dependencies/pan549-stock-workspace-v1/source/workspace-analysis-v1.ts',
 'contracts/dependencies/pan549-stock-workspace-v1/source/canonical-json.ts',
 'contracts/dependencies/pan549-stock-workspace-v1/runtime/workspace-analysis-v1.js',
 'contracts/dependencies/pan549-stock-workspace-v1/runtime/canonical-json.js',
 'contracts/dependencies/pan549-stock-workspace-v1/runtime/package.json',
 'contracts/dependencies/pan549-stock-workspace-v1/workspace-byte-closure-v28.json',
 'contracts/dependencies/pan549-stock-workspace-v1/owned-browser/read-companion-v28.js',
 'contracts/dependencies/pan549-stock-workspace-v1/workspace-byte-closure-v30.json',
 'contracts/dependencies/pan549-stock-workspace-v1/owned-browser/read-companion-v30.js',
 'scripts/build-ks303-owned-browser.mjs','scripts/qualify-ks303-owned-compiler.py',
 ...['package.json','package-lock.json','compiler-integrity-v1.json','THIRD-PARTY-LICENSES.txt'].map(p=>'dependencies/ks303-owned-browser-build/'+p),
 'tests/h03-starter-ci-binding.test.mjs','tests/h08-runtime-ci-binding.test.mjs',
 'tests/ks255-journey-runtime-binding.test.mjs','tests/postgresql-c2-safe-aggregate.test.mjs'
];
const protectedFiles=['package.json','README.md','contracts/dependencies/pan541-browser-shell-v1/binding.json','contracts/dependencies/pan520-stock-source-v1.json','services/bi-control/src/business-bi/pan520-stock-consumer.mjs'];
const map=JSON.parse(await readFile('SOURCE-MAP.json','utf8'));
for(const path of protectedFiles)assert.equal(sha(await readFile(path)),map.files[path],'KS303_PROTECTED_PREDECESSOR_CHANGED: '+path);
for(const path of names)map.files[path]=sha(await readFile(path));
map.files=Object.fromEntries(Object.entries(map.files).sort(([a],[b])=>a.localeCompare(b)));
const temporary='SOURCE-MAP.json.ks303-own-'+process.pid+'.tmp';await writeFile(temporary,JSON.stringify(map,null,2)+'\n',{flag:'wx'});await rename(temporary,'SOURCE-MAP.json');
console.log(JSON.stringify({currentAuthoredPaths:names.length,totalCurrentPins:Object.keys(map.files).length,protectedPredecessorsUnchanged:true,historicalEvidenceReminted:false,packageCommandModified:false}));
