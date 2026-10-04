import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('H01 required shared contract suites are backed by exact anonymous SDK provisioning in canonical hosted CI', () => {
  const binding = JSON.parse(readFileSync(new URL('../contracts/dependencies/pan526-runtime-source-v1.json', import.meta.url), 'utf8'));
  const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const begin = workflow.indexOf('      - name: Provision and execute the exact public PAN526 shared runtime contract');
  assert.ok(begin >= 0, 'Missing required exact public runtime-contract CI acquisition');
  const end = workflow.indexOf('\n      - ', begin + 10);
  const body = workflow.slice(begin, end);
  assert.ok(body.includes('git -C "$KS292_PAN526_SOURCE" -c credential.helper= -c http.extraheader= fetch --depth=1 https://github.com/JoFe2/PANSPHAIRA.git ' + binding.producerCommit));
  assert.ok(body.includes('rev-parse HEAD)" = ' + binding.producerCommit));
  assert.ok(body.includes("rev-parse 'HEAD^{tree}')\" = " + binding.producerTree));
  assert.ok(body.includes('npm ci --ignore-scripts && npm run build'));
  for (const suite of ['h01-local-stack-facts', 'h01-pan-runtime-source', 'h01-local-runtime-context']) {
    assert.ok(body.includes('tests/' + suite + '.test.mjs'), 'Required actual common-source suite omitted: ' + suite);
  }
  assert.ok(body.includes('process.env.GITHUB_ENV'));
  assert.ok(body.includes('KS292_PAN526_SOURCE='));
  assert.doesNotMatch(body, /continue-on-error|GITHUB_TOKEN|GH_TOKEN|\|\|\s*true/);
});
