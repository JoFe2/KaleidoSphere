#!/usr/bin/env node
// Offline consumer of product-produced plan/receipt bytes. No DB or credential path.
import {readFile} from 'node:fs/promises';
import {parseArgs} from 'node:util';
import {canonicalJson} from '../services/bi-control/src/canonical-json.js';
import {createNetRevenueVisualInputV1, projectNetRevenueVisualV1, renderNetRevenueVisualHtmlV1} from '../services/bi-control/src/business-bi/net-revenue-visual-v1.mjs';

try {
  const {values} = parseArgs({options: {
    plan: {type: 'string'}, receipt: {type: 'string'}, metric: {type: 'string'}, oracle: {type: 'string'},
    format: {type: 'string', default: 'HTML'}, period: {type: 'string', default: 'all'},
  }, allowPositionals: false, strict: true});
  if (!['plan', 'receipt', 'metric', 'oracle'].every(k => values[k]) || !['HTML', 'JSON'].includes(values.format)) {
    throw new Error('VISUAL_CLI_ARGUMENTS_DENIED: --plan FILE --receipt FILE --metric FILE --oracle FILE [--format HTML|JSON] [--period all|comparison|current]');
  }
  const boundedRead = async path => {
    const bytes = await readFile(path);
    if (bytes.length > 262144) throw new Error('VISUAL_CLI_INPUT_LIMIT_DENIED');
    return bytes;
  };
  const [plan, receipt, metricContractBytes, oracleBytes] = await Promise.all(
    [values.plan, values.receipt, values.metric, values.oracle].map(boundedRead));
  const input = createNetRevenueVisualInputV1({plan: JSON.parse(plan), receipt: JSON.parse(receipt), metricContractBytes, oracleBytes});
  const options = {period: values.period};
  process.stdout.write(values.format === 'HTML' ? renderNetRevenueVisualHtmlV1(input, options) : `${canonicalJson(projectNetRevenueVisualV1(input, options))}\n`);
} catch (error) {
  process.stderr.write(`${error.code ?? error.message}\n`);
  process.exitCode = 1;
}
