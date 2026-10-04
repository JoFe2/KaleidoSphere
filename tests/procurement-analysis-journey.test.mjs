import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const fixtureUrl = new URL('../examples/p2p/common-trade-01.json', import.meta.url);
const coreUrl = new URL('../services/bi-control/src/business-bi/procurement-analysis.mjs', import.meta.url);

// Namespace import makes absence of the new core an assertion, not a syntax error.
async function core() {
  let module;
  try { module = await import(coreUrl.href); }
  catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
  assert.equal(typeof module?.deriveProcurementV1, 'function', 'K04 procurement operation is absent on qualified Main');
  return module;
}
async function fixture() { return JSON.parse(await readFile(fixtureUrl)); }

test('K04 COMMON quantity, price and dated acceptance remain independent of invoice receipt fanout', async () => {
  const { deriveProcurementV1 } = await core();
  const result = deriveProcurementV1(await fixture());
  assert.equal(result.outcome, 'COMPLETE');
  assert.equal(result.profile, 'p2p-procurement/v1');
  assert.deepEqual(result.lines.map(line => [line.po_id, line.po_line_id]), [['PO-01', '1']]);
  const line = result.lines[0];
  assert.deepEqual(line.quantity, { status: 'KNOWN', ordered: 10, accepted: 10, invoiced: 10, receivedNotInvoiced: 0, invoicedNotReceived: 0 });
  assert.deepEqual(line.price, { status: 'KNOWN', expectedNetMinor: 60000, invoiceNetMinor: 62000, varianceMinor: 2000 });
  assert.deepEqual(line.timing, { status: 'KNOWN', onTimeAccepted: 8, lateAccepted: 2, unknownTimeAccepted: 0, denominator: 10 });
  assert.equal(result.mutationAuthority, false);
  assert.equal(result.invoiceMatcherImplemented, false);
});
