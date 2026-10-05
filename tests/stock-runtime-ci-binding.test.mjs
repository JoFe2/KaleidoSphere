import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const suites=['pan520-stock-pair','stock-deadline-product','stock-deadline-negatives','stock-source-boundary','stock-historical-profile','stock-runtime-ci-binding'];
test('K05 mandatory exact producer and synthetic separated stock scopes are registered without suppression in CI',()=>{
 const ci=readFileSync(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 const start=ci.indexOf('      - name: Execute required stock provenance and bounded deadline product');assert.ok(start>=0,'Missing required K05 actual product CI step');
 const end=ci.indexOf('\n      - ',start+10),block=ci.slice(start,end);
 assert.ok(ci.indexOf('KS285_PAN520_SOURCE=',0)<start);for(const n of suites)assert.ok(block.includes('tests/'+n+'.test.mjs'),n);
 assert.ok(block.includes('${KS285_PAN520_SOURCE:?}'));assert.doesNotMatch(block,/continue-on-error|\|\|\s*true|--test-skip-pattern|--test-name-pattern|--test-only|GITHUB_TOKEN|GH_TOKEN/);
});
