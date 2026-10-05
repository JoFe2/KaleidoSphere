import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { H05NativeModelTransportV1 } from '../services/bi-control/src/runtime/h05-native-model-transport.mjs';
import { ReconciliationLedger } from '../services/bi-control/src/bi-specialist/local-openai-adapter.mjs';

const options = { idempotencyKey: 'ks295-uncertain-equal-operation', messages: [{ role: 'user', content: 'owned synthetic status request' }] };
if (process.argv[2] === 'owned-native-child') {
  const [baseUrl, ledgerPath, mode] = process.argv.slice(3);
  const ledger = mode === 'resume' ? ReconciliationLedger.restore(JSON.parse(readFileSync(ledgerPath, 'utf8'))) : new ReconciliationLedger();
  const adapter = new H05NativeModelTransportV1({ optIn: true, baseUrl, model: 'owned-synthetic-only', maxRetries: 0, timeoutMs: 1000, ledger });
  let outcome;
  try { await adapter.complete(options); outcome = 'complete'; }
  catch (error) { outcome = error.code ?? error.message ?? error.name; }
  writeFileSync(ledgerPath, JSON.stringify(ledger.snapshot()));
  console.log(JSON.stringify({ pid: process.pid, outcome, ledger: ledger.snapshot().map(({ state, attempts }) => ({ state, attempts })) }));
} else {
  test('H05 actual fresh native process with restored unresolved ledger cannot blindly redispatch an accepted POST whose ACK was lost', async () => {
    const own = mkdtempSync(join(tmpdir(), 'ks295-native-unknown-restart-'));
    const ledgerPath = join(own, 'native-ledger.json');
    let dispatches = 0;
    const server = createServer(async (request, response) => {
      for await (const chunk of request) { /* consume the actual full POST */ }
      dispatches += 1;
      if (dispatches === 1) { request.socket.destroy(); return; }
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'STATUS' } }], usage: { total_tokens: 1 } }));
    });
    async function runChild(baseUrl, mode) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'owned-native-child', baseUrl, ledgerPath, mode], { stdio: ['ignore', 'pipe', 'pipe'] });
        let out = '', err = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('owned native child timeout')); }, 10000);
        child.stdout.on('data', bytes => { out += bytes; });
        child.stderr.on('data', bytes => { err += bytes; });
        child.once('error', error => { clearTimeout(timer); reject(error); });
        child.once('exit', code => { clearTimeout(timer); if (code !== 0) return reject(new Error(`native child exit ${code}: ${err}`)); try { resolve(JSON.parse(out)); } catch (error) { reject(error); } });
      });
    }
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
      const first = await runChild(baseUrl, 'first');
      assert.equal(dispatches, 1, 'the first complete POST must actually be accepted before losing its ACK');
      const second = await runChild(baseUrl, 'resume');
      console.log(JSON.stringify({ scope: 'actual distinct native child processes/restored native ledger/synthetic loopback HTTP, NOT full durable budget qualification', first, second, actualProviderDispatches: dispatches, expectedDispatches: 1 }));
      assert.notEqual(first.pid, second.pid);
      assert.equal(dispatches, 1, 'uncertain usage must not trigger a second provider dispatch on process restart');
      assert.equal(second.outcome, 'H05_UNKNOWN_MODEL_USAGE_RECONCILIATION_REQUIRED');
      assert.deepEqual(second.ledger, first.ledger, 'held unresolved native evidence must not be erased or charged twice');
      assert.equal(JSON.parse(readFileSync(ledgerPath, 'utf8'))[0].attempts, 1);
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      rmSync(own, { recursive: true, force: true });
    }
  });
}
