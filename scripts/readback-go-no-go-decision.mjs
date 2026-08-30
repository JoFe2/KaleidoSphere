import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

import { renderReceipt, runDecisionValidator } from './dry-run-go-no-go-decision.mjs';

const defaultInput = 'docs/future/remote-connector/fixtures/go-no-go-decision-valid.json';

function usage() {
  process.stderr.write('Usage: node scripts/readback-go-no-go-decision.mjs --local-only [--input <repository-relative-json>]\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const inputIndex = process.argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : defaultInput;
  if (!process.argv.includes('--local-only') || !inputPath) {
    usage();
    process.exitCode = 2;
  } else {
    const result = await runDecisionValidator(inputPath);
    process.stdout.write(`${JSON.stringify(renderReceipt(result, 'LOCAL_READBACK'), null, 2)}\n`);
  }
}
