import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('H02 CI acquires exact anonymous origin-only and executable session producers before canonical tests', async () => {
  const workflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const heading = '      - name: Provision and execute the exact public PAN527 origin and protected-session contract';
  const start = workflow.indexOf(heading);
  assert.notEqual(start, -1, 'Missing required exact PAN527 CI acquisition');
  const next = workflow.indexOf('      - run: npm run dist:agent-skill', start);
  assert.ok(next > start); const block = workflow.slice(start, next);
  for (const pin of ['KS293_PAN527_SOURCE', 'KS293_PAN527_SESSION_SOURCE',
    '8ed580342b1b7392ff3c56175d507084cdbaa8ad', '83c8f0f439969736624a5bd6f0d165fc9dc4f6b6',
    '6a7752be07405bd03ccbc40c13a9936d1b8d0d2b', '43f33d0c3c14aacc23f1497aae7a0f83f1cd7f30',
    'npm ci --ignore-scripts && npm run build', '-c credential.helper= -c http.extraheader=',
    'tests/h02-pan-origin-source.test.mjs', 'tests/h02-pan-session-source.test.mjs',
    'tests/h02-native-protected-ingress.test.mjs', 'tests/h02-https-network-boundary.test.mjs', 'GITHUB_ENV']) assert.ok(block.includes(pin), pin);
  assert.doesNotMatch(block, /continue-on-error|\|\|\s*true|--test-skip-pattern|--test-name-pattern|refs\/heads\/main|latest/);
  assert.ok(workflow.indexOf('      - run: npm test', next) > next);
});
