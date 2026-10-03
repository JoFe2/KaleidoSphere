#!/usr/bin/env node
// Internal candidate program; invoke through the mandatory isolated product launcher.
import { readFileSync } from 'node:fs';
import { computePermittedAggregate } from '../services/bi-control/src/business-bi/permitted-aggregate-candidate.mjs';
try {
  const bytes = readFileSync(0);
  if (bytes.length > 16384) throw new Error('K01_INPUT_BUDGET_DENIED');
  const result = computePermittedAggregate(JSON.parse(bytes));
  process.stdout.write(JSON.stringify(result) + '\n');
} catch {
  process.stdout.write(JSON.stringify({ outcome: 'DENIED', reasonCode: 'K01_CANDIDATE_INPUT_DENIED', numbers: null }) + '\n');
  process.exitCode = 1;
}
