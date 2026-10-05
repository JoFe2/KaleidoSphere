import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
test('H05 CI provisions the exact public shared source and executes every native product suite without skips',async()=>{
 const workflow=await readFile(new URL('../.github/workflows/ci.yml',import.meta.url),'utf8');
 const heading='      - name: Provision and execute the exact public PAN529 template and native budget contract';
 const start=workflow.indexOf(heading);assert.notEqual(start,-1,'Missing required exact PAN529 CI acquisition');
 const end=workflow.indexOf('      - run: npm run dist:agent-skill',start);assert.ok(end>start);
 const block=workflow.slice(start,end);
 for(const pin of ['KS_H05_PAN_SOURCE_ROOT','6be212953b2cb52f46347e10132d13b95f881f29','3b8d7b6b5f29fe4b0736a00d3db5dd380bfefcef',
  '-c credential.helper= -c http.extraheader=','npm ci --ignore-scripts && npm run build',
  'tests/h05-closed-runtime-template.test.mjs','tests/h05-native-broker-runtime.test.mjs','tests/h05-native-control-route.test.mjs',
  'tests/h05-native-model-idempotency.test.mjs','tests/h05-native-model-retry-custody.test.mjs','tests/h05-native-model-unknown-restart.test.mjs',
  'tests/h05-native-openai-consumer.test.mjs','tests/h05-native-resource-store.test.mjs','tests/h05-shared-runtime-source.test.mjs',
  'tests/h05-template-native-product-route.test.mjs','tests/h05-runtime-ci-binding.test.mjs','GITHUB_ENV'])assert.ok(block.includes(pin),pin);
 assert.match(block,/node --test --test-concurrency=1\s/,'CPU-heavy source qualification must be isolated across suites; the actual service100 test remains concurrent');
 assert.ok(block.includes('git -C "$KS_H05_PAN_SOURCE_ROOT" update-index --refresh'),'Refresh only the acquired source index stat cache before read-only repeated use-time provenance guards');
 assert.doesNotMatch(block,/--assume-unchanged|--skip-worktree|--fsmonitor-valid|core\.ignorestat|continue-on-error|\|\|\s*true|--test-skip-pattern|--test-name-pattern|refs\/heads\/main|latest/);
 assert.ok(workflow.indexOf('      - run: npm test',end)>end);
});
